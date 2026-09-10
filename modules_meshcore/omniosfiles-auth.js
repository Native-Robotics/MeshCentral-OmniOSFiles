'use strict';
// Challenges are sent only to the authenticated server, never the requesting tunnel.
exports.create = function (send, execute, random) {
    var pending = {}, count = 0;
    random = random || function () { return require('EncryptionStream').GenerateRandom(32).toString('hex'); };
    return function (args) {
        if (!args || typeof args.requestId !== 'string' || !/^[a-f0-9]{48}$/.test(args.requestId)) return;
        if (args.pluginaction === 'propose') {
            if (count >= 8 || pending[args.requestId] || typeof args.payload !== 'string' || args.payload.length > 100000) return;
            var challenge;
            try { challenge = random(); } catch (e) { return; }
            if (!/^[a-f0-9]{64}$/.test(challenge)) return;
            var entry = {payload: args.payload, challenge: challenge};
            pending[args.requestId] = entry; count++;
            entry.timer = setTimeout(function () { if (pending[args.requestId] === entry) { delete pending[args.requestId]; count--; } }, 10000);
            send({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'authorize', requestId: args.requestId, payload: args.payload, challenge: challenge});
        } else if (args.pluginaction === 'approve') {
            var entry = pending[args.requestId];
            if (!entry || args.challenge !== entry.challenge) return;
            clearTimeout(entry.timer); delete pending[args.requestId]; count--;
            if (args.allowed !== true) return;
            var done = false;
            function reply(data) { if (done) return; done = true; send({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'response', requestId: args.requestId, result: data}); }
            try { var payload = JSON.parse(entry.payload); if (payload.protocol !== 2) throw Error('Unsupported protocol'); execute(payload, reply); }
            catch (e) { reply({type: 'error', error: String(e.message || e)}); }
        }
    };
};
