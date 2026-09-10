'use strict';
var mesh = require('MeshAgent');
var worker = null;
var pending = {};
var sequence = 0;
function stop(error) {
    var child = worker; worker = null;
    if (child) { try { child.stdin.end(); } catch (e) {} try { child.kill(); } catch (e) {} }
    var old = pending; pending = {};
    Object.keys(old).forEach(function (key) { clearTimeout(old[key].timer); old[key].reply({type: 'error', error: error}); });
}
function execute(payload, reply) {
    if (process.platform !== 'linux') { reply({type: 'error', error: 'Only Linux OmniOS is supported'}); return; }
    try {
        if (!worker) {
            // MeshAgent execFile argv includes argv[0], unlike Node.js execFile.
            var child = require('child_process').execFile('/usr/bin/python3', ['python3', '-I', '-u', '-c', require('omniosfiles-helper')], {});
            if (!child || !child.stdin || !child.stdout || !child.stderr) throw Error('Cannot start Python file worker');
            worker = child; child.buffer = ''; child.errors = '';
            child.stdout.on('data', function (chunk) {
                if (worker !== child) return;
                child.buffer += chunk.toString();
                if (child.buffer.length > 400000) { stop('Worker response limit exceeded'); return; }
                var newline;
                while ((newline = child.buffer.indexOf('\n')) !== -1) {
                    var line = child.buffer.substring(0, newline); child.buffer = child.buffer.substring(newline + 1);
                    try {
                        var data = JSON.parse(line), item = pending[data.id];
                        if (!item) continue;
                        delete pending[data.id]; clearTimeout(item.timer); item.reply(data.result);
                    } catch (e) { stop('Invalid worker response'); return; }
                }
            });
            child.stderr.on('data', function (chunk) { child.errors = (child.errors + chunk.toString()).slice(-4096); });
            child.on('error', function () { if (worker === child) stop('File worker process failed'); });
            child.on('exit', function () { if (worker === child) stop('File worker stopped: ' + child.errors); });
        }
        if (Object.keys(pending).length >= 8) { reply({type: 'error', error: 'File worker is busy'}); return; }
        var id = String(++sequence);
        pending[id] = {reply: reply, timer: setTimeout(function () { if (pending[id]) stop('File worker timed out; inspect the device before retrying a mutation'); }, 25000)};
        worker.stdin.write(JSON.stringify({id: id, payload: payload}) + '\n');
    } catch (e) { stop('Cannot run file worker: ' + e.message); if (!pending[String(sequence)]) reply({type: 'error', error: 'Cannot run file worker: ' + e.message}); }
}
var guard = require('omniosfiles-auth').create(function (command) { mesh.SendCommand(command); }, execute);
// Reconnection invalidates transfers. Python also expires idle handles independently.
mesh.on('Connected', function (state) { if (!state) stop('Agent disconnected'); });
module.exports = {consoleaction: function (args) { guard(args); }};
