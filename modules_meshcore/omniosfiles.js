'use strict';
var mesh = require('MeshAgent');
var worker = null;
var pending = {};
var sequence = 0;
// Protocol 3: one-time-per-transfer authorization for the chunk tunnel (protocol 7).
// authorized[transferId] is created only after a startUpload/startDownload payload that
// already passed the existing propose/authorize/approve challenge completes successfully,
// so presenting it in bindTransfer is proof of that authorization -- no new secret is needed.
var authorized = {};
var tunnels = {};
// Kept in sync with server.js's CHUNK -- see the comment there for why 16 KiB, not 64 KiB.
var CHUNK = 16384;
var AUTHORIZED_TTL_MS = 30000, HEARTBEAT_MS = 20000, DOWNLOAD_WINDOW = 8, IDLE_LIMIT_MS = 90000;
// Toggled from config.json's settings.debug (server.js embeds it in every job's policy), cached
// here since lifecycle events like a worker crash don't always have a payload/policy in scope.
var debugEnabled = false;
function debugLog() {
    if (!debugEnabled) return;
    var parts = [];
    for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; parts.push(typeof a === 'string' ? a : JSON.stringify(a)); }
    try { mesh.SendCommand({action: 'msg', type: 'console', value: '[omniosfiles] ' + parts.join(' ')}); } catch (e) {}
}
// Real MeshAgent's Buffer implementation mishandles a plain TypedArray *view*: a subarray's own
// .toString('base64') returns the literal string "[object Uint8Array]" instead of encoding it,
// and Buffer.from(view) silently produces a zero-length buffer -- both confirmed directly against
// the native binary. Reading a view by index works fine, so copy byte-by-byte into a freshly
// allocated (non-view) Buffer instead of ever handing a .subarray() result to those two calls.
// Own every queued chunk: the tunnel may reuse its input storage after the callback.
function copyUploadChunk(data) {
    var start = data[0] === 0 ? 1 : 0;
    var out = Buffer.alloc(data.length - start);
    for (var i = start; i < data.length; i++) out[i - start] = data[i];
    return out;
}
// Avoid Buffer.from([0]) and Buffer views on native MeshAgent, including on download.
function escapeFirstByte(data) {
    var out = Buffer.alloc(data.length + 1);
    out[0] = 0;
    for (var i = 0; i < data.length; i++) out[i + 1] = data[i];
    return out;
}
function sweepAuthorized() {
    var now = Date.now();
    Object.keys(authorized).forEach(function (id) { if (now > authorized[id].expires) delete authorized[id]; });
}
function stopHeartbeat(state) { if (state.heartbeat) { clearTimeout(state.heartbeat); state.heartbeat = null; } }
function startHeartbeat(state) {
    stopHeartbeat(state);
    state.heartbeat = setTimeout(function () {
        // This timer has already elapsed; MeshAgent's native clearTimeout() throws "Invalid
        // Parameter" if handed an already-fired handle (observed on device), so null it out
        // before doing anything else that could reach stopHeartbeat()/startHeartbeat() for
        // this same state (the idle-teardown branch below, or the reschedule at the bottom).
        state.heartbeat = null;
        if (tunnels[state.transferId] !== state) return;
        // Independent of the server's own idle expiry (which this heartbeat otherwise keeps
        // refreshing forever): if the browser vanished without a clean tunnel close (tab
        // closed, network dropped) and no chunk moved for a while, stop heartbeating so the
        // transfer can actually expire server-side instead of being kept alive indefinitely.
        if (Date.now() - state.lastActivity > IDLE_LIMIT_MS) { teardownTunnel(state, 'Transfer idle; closing the tunnel'); return; }
        debugLog('heartbeat', state.transferId);
        try { mesh.SendCommand({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'transferHeartbeat', transferId: state.transferId}); } catch (e) {}
        startHeartbeat(state);
    }, HEARTBEAT_MS);
    if (state.heartbeat.unref) state.heartbeat.unref();
}
function teardownTunnel(state, error) {
    if (tunnels[state.transferId] !== state) return;
    debugLog('teardownTunnel', state.transferId, error || '');
    delete tunnels[state.transferId];
    stopHeartbeat(state);
    try { state.tunnel.data = function () {}; } catch (e) {}
    if (error) { try { state.tunnel.write(Buffer.from(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'tunnelError', error: String(error).slice(0, 4096)}))); } catch (e) {} }
}
function pumpUpload(state) {
    if (state.busy || state.queue.length === 0) return;
    var queued = state.queue.shift(), bytes = queued.bytes, idx = state.nextIndex++;
    state.busy = true;
    var payload = {protocol: 2, action: 'uploadChunk', args: {chunkIndex: idx, data: bytes.toString('base64')}, transferId: state.transferId, policy: state.policy};
    execute(payload, function (result) {
        state.busy = false;
        if (tunnels[state.transferId] !== state) return;
        if (!result || result.type === 'error') { teardownTunnel(state, (result && result.error || 'Missing worker result') + ' [upload chunk=' + idx + ', frame=' + queued.frameLength + ', copied=' + bytes.length + ', escaped=' + queued.escaped + ']'); return; }
        state.lastActivity = Date.now();
        try { state.tunnel.write(Buffer.from(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'chunkAck'}))); } catch (e) {}
        pumpUpload(state);
    });
}
function pumpDownload(state) {
    if (state.busy || state.credits <= 0 || state.nextIndex * CHUNK >= state.total) return;
    state.busy = true; state.credits--;
    var idx = state.nextIndex++;
    var payload = {protocol: 2, action: 'requestChunk', args: {chunkIndex: idx}, transferId: state.transferId, policy: state.policy};
    execute(payload, function (result) {
        state.busy = false;
        if (tunnels[state.transferId] !== state) return;
        if (!result || result.type === 'error') { teardownTunnel(state, result && result.error); return; }
        state.lastActivity = Date.now();
        var bytes = Buffer.from(result.data, 'base64');
        var frame = (bytes.length && (bytes[0] === 0 || bytes[0] === 123)) ? escapeFirstByte(bytes) : bytes;
        try { state.tunnel.write(frame); } catch (e) {}
        pumpDownload(state);
    });
}
function onTunnelChunk(state, data) {
    if (!data || data.length === 0 || tunnels[state.transferId] !== state) return;
    state.lastActivity = Date.now();
    if (typeof data === 'string' || data[0] === 123) {
        // Native WebSocket text frames are strings, not Buffers. In particular the
        // redirect's periodic RTT message must never enter the binary upload queue.
        var cmd; try { cmd = JSON.parse(data.toString()); } catch (e) { return; }
        if (cmd && (cmd.ctrlChannel == '102938' || (cmd.type === 'offer' && cmd.sdp != null))) {
            if (state.coreData) state.coreData.call(state.tunnel, data);
            return;
        }
        if (cmd && cmd.pluginaction === 'chunkAck' && state.direction === 'download') { state.credits++; pumpDownload(state); }
        return;
    }
    if (state.direction !== 'upload') return;
    state.queue.push({bytes: copyUploadChunk(data), frameLength: data.length, escaped: data[0] === 0});
    pumpUpload(state);
}
function bindTransfer(args, tunnel) {
    if (!tunnel || typeof tunnel.write !== 'function') {
        debugLog('bindTransfer: no usable tunnel object', args && args.transferId);
        return;
    }
    var transferId = args.transferId, entry = typeof transferId === 'string' && authorized[transferId];
    function reject(message) { debugLog('bindTransfer rejected', transferId, message); try { tunnel.write(Buffer.from(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'bindError', error: message}))); } catch (e) {} }
    if (!entry || Date.now() > entry.expires) { reject('Unknown or expired transfer'); return; }
    if (tunnels[transferId]) { reject('Transfer already bound'); return; }
    delete authorized[transferId];
    if (entry.policy && typeof entry.policy.debug === 'boolean') debugEnabled = entry.policy.debug;
    var state = {tunnel: tunnel, coreData: typeof tunnel.data === 'function' ? tunnel.data : null, transferId: transferId, direction: entry.direction, policy: entry.policy, total: entry.total, queue: [], busy: false, nextIndex: 0, credits: 0, heartbeat: null, lastActivity: Date.now()};
    tunnels[transferId] = state;
    tunnel.data = function (data) { onTunnelChunk(state, data); };
    debugLog('bindTransfer bound', transferId, entry.direction, 'total=' + entry.total);
    try { tunnel.write(Buffer.from(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'bound', transferId: transferId}))); } catch (e) {}
    startHeartbeat(state);
    if (state.direction === 'download') { state.credits = DOWNLOAD_WINDOW; pumpDownload(state); }
}
function abortTransfer(args) {
    var transferId = args.transferId, state = typeof transferId === 'string' && tunnels[transferId];
    if (!state) { debugLog('abortTransfer: no bound tunnel', transferId); return; }
    teardownTunnel(state, 'Transfer was cancelled by the server');
    try { execute({protocol: 2, action: 'cancel', args: {}, transferId: transferId, policy: state.policy}, function () {}); } catch (e) {}
}
function stop(error) {
    debugLog('stop', error, 'pending=' + Object.keys(pending).map(function (id) { var item = pending[id]; return id + ':' + item.action + ':chunk=' + item.chunkIndex; }).join(','));
    var child = worker; worker = null;
    if (child) { try { child.stdin.end(); } catch (e) {} try { child.kill(); } catch (e) {} }
    var old = pending; pending = {};
    Object.keys(old).forEach(function (key) {
        var item = old[key];
        // item.timer is null for whichever entry's own 25s timeout just fired and triggered
        // this stop() call -- see the matching null-out in execute()'s setTimeout below.
        if (item.timer) clearTimeout(item.timer);
        item.reply({type: 'error', error: error});
    });
    Object.keys(tunnels).forEach(function (id) { teardownTunnel(tunnels[id], error); });
}
function execute(payload, reply) {
    if (payload && payload.policy && typeof payload.policy.debug === 'boolean') debugEnabled = payload.policy.debug;
    // MeshCentral disconnects agents that repeat the same Console message >30 times.
    // Chunk traffic is intentionally silent, even in debug mode; lifecycle/errors remain logged.
    if (!payload || (payload.action !== 'uploadChunk' && payload.action !== 'requestChunk')) {
        debugLog('execute', payload && payload.action, payload && payload.transferId);
    }
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
                    } catch (e) { stop('Worker response handling failed: ' + String(e.message || e)); return; }
                }
            });
            child.stderr.on('data', function (chunk) { child.errors = (child.errors + chunk.toString()).slice(-4096); });
            child.on('error', function () { if (worker === child) stop('File worker process failed'); });
            child.on('exit', function (code, signal) {
                if (worker !== child) return;
                stop('File worker exited: code=' + String(code) + ', signal=' + String(signal) +
                    ', stderr=' + (child.errors || '(empty)'));
            });
        }
        if (Object.keys(pending).length >= 8) { reply({type: 'error', error: 'File worker is busy'}); return; }
        var id = String(++sequence), isTransfer = !!(payload && typeof payload.transferId === 'string');
        var wrappedReply = reply;
        if (isTransfer && payload && (payload.action === 'startUpload' || payload.action === 'startDownload')) {
            var transferId = payload.transferId, direction = payload.action === 'startUpload' ? 'upload' : 'download', policy = payload.policy;
            wrappedReply = function (result) {
                if (result && (result.type === 'uploadReady' || result.type === 'downloadStart')) {
                    sweepAuthorized();
                    authorized[transferId] = {direction: direction, policy: policy, total: result.totalSize, expires: Date.now() + AUTHORIZED_TTL_MS};
                }
                reply(result);
            };
        }
        pending[id] = {reply: wrappedReply, transfer: isTransfer, action: payload.action, chunkIndex: payload.args && payload.args.chunkIndex, timer: setTimeout(function () {
            var item = pending[id];
            if (item) { item.timer = null; stop('File worker timed out; inspect the device before retrying a mutation'); }
        }, 25000)};
        worker.stdin.write(JSON.stringify({id: id, payload: payload}) + '\n');
    } catch (e) { stop('Cannot run file worker: ' + e.message); if (!pending[String(sequence)]) reply({type: 'error', error: 'Cannot run file worker: ' + e.message}); }
}
var guard = null;
var connectionHookInstalled = false;
module.exports = {consoleaction: function (args, rights, sessionid, tunnel) {
    if (!args) return;
    // Protocol 3 chunk tunnel: reachable through the same protocol-7 entry point core uses for
    // Files/Terminal/Desktop, so bindTransfer/abortTransfer are gated only by possession of an
    // unguessable transferId (see authorized{}/tunnels{} above), the same defense the existing
    // propose/authorize/approve challenge already relies on against a forged routeToNode/console/
    // protocol-7 caller (see PLAN.md's authorization notes). Keep this branch before the requestId
    // gate below: these two actions use transferId, not requestId.
    // Same guard as execute()'s uploadChunk/requestChunk exclusion: a download's flow-control
    // chunkAck is delivered here once per chunk (DOWNLOAD_WINDOW credits) in addition to the raw
    // tunnel.data path, identically every time, and would trip MeshCentral's >30-repeat Console
    // disconnect guard just as the unfiltered upload logging did before that fix.
    if (args.pluginaction !== 'chunkAck') {
        debugLog('consoleaction', args.pluginaction, tunnel && typeof tunnel.write === 'function' ? 'via-tunnel' : 'via-control-channel');
    }
    if (args.pluginaction === 'bindTransfer') { bindTransfer(args, tunnel); return; }
    if (args.pluginaction === 'abortTransfer') { abortTransfer(args); return; }
    if (typeof args.requestId !== 'string' || !/^[a-f0-9]{48}$/.test(args.requestId)) return;
    // Keep the entry module loadable even if a supporting module is missing/stale.
    // Report startup failures through the authenticated agent channel, not a tunnel.
    try {
        if (args.pluginaction === 'propose') mesh.SendCommand({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'agentStatus', requestId: args.requestId, stage: 'received'});
        if (!guard) guard = require('omniosfiles-auth').create(function (command) { mesh.SendCommand(command); }, execute);
        if (!connectionHookInstalled) {
            mesh.on('Connected', function (state) { if (!state) stop('Agent disconnected'); });
            connectionHookInstalled = true;
        }
        guard(args);
    } catch (e) {
        mesh.SendCommand({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'agentError', requestId: args.requestId, error: String(e.message || e).slice(0, 4096)});
    }
}};
