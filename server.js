'use strict';
const crypto = require('crypto');
const writes = new Set(['createDir', 'delete', 'rename', 'startUpload', 'uploadChunk', 'finishUpload']);
// uploadChunk/requestChunk are the protocol 2 per-chunk RPC path, kept only as a fallback for a
// browser or agent core that predates the protocol 3 chunk tunnel (see docs/PROTOCOL.md); new
// clients feature-detect the tunnel via transferId in the startUpload/startDownload response and
// never send these two. Remove once fleet-wide agent-core rebuild is confirmed.
const continuation = new Set(['uploadChunk', 'requestChunk', 'finishUpload', 'finishDownload', 'cancel']);
const actions = new Set(['listDir', 'fileInfo', 'createDir', 'delete', 'rename', 'startUpload', 'startDownload', ...continuation]);
// 16 KiB, not 64 KiB: the base64+JSON line for a full-size uploadChunk written to the Python
// worker's stdin must stay comfortably under a pipe's typical 64 KiB buffer, or the native
// MeshAgent runtime's write appears to silently truncate it -- observed on a real device as the
// worker hanging forever on the very first chunk (no error, no response, 25s timeout).
const CHUNK = 16384, MAX = 100 * 1024 * 1024;
exports.settings = function (raw) {
    raw = raw || {};
    const s = Object.assign({maxFileSize: MAX, maxConcurrentTransfers: 3, filterMode: 'blacklist', allowedExtensions: [], blockedExtensions: [], debug: false}, raw);
    if (!Number.isSafeInteger(s.maxFileSize) || s.maxFileSize < 0 || s.maxFileSize > MAX || !Number.isInteger(s.maxConcurrentTransfers) || s.maxConcurrentTransfers < 1 || s.maxConcurrentTransfers > 3 || !['whitelist', 'blacklist'].includes(s.filterMode) || typeof s.debug !== 'boolean') throw Error('Invalid OmniOSFiles settings');
    for (const k of ['allowedExtensions', 'blockedExtensions']) {
        if (!Array.isArray(s[k]) || s[k].length > 100 || s[k].some(x => typeof x !== 'string' || !/^\.[a-z0-9_-]{1,20}$/i.test(x))) throw Error('Invalid extension filter');
        s[k] = s[k].map(x => x.toLowerCase());
    }
    return {maxFileSize: s.maxFileSize, maxConcurrentTransfers: s.maxConcurrentTransfers, chunkSize: CHUNK, filterMode: s.filterMode, allowedExtensions: s.allowedExtensions, blockedExtensions: s.blockedExtensions, debug: s.debug};
};
exports.create = function (parent, settings) {
    // parent.parent.webserver can still be null when plugins are constructed during server
    // startup (observed on a real deployment: every request then throws "Cannot read
    // properties of null" forever, since a plain `const web = ...` freezes that null in this
    // closure for the plugin's whole lifetime until the next manual reloadplugin). Read it
    // fresh on every use instead of capturing it once.
    function web() { return parent.parent.webserver; }
    const jobs = new Map(), transfers = new Map();
    let api = false;
    function initialize() {
        api = ['registerPermissions', 'checkPluginPermission', 'getPluginPermissions'].every(k => typeof parent[k] === 'function');
        if (api) parent.registerPermissions('omniosfiles', {
            read: {title: 'Read OmniOS files', desc: 'List and download under /var/nr', default: 'denied'},
            write: {title: 'Modify OmniOS files', desc: 'Upload, create, rename and delete under /var/nr', default: 'denied'}
        });
    }
    // The manual-list loader constructs plugins before defining the permissions API.
    initialize();
    const id = () => crypto.randomBytes(24).toString('hex');
    const live = c => { const w = web(); return !!w && w.wssessions2[c.ws.sessionId] === c.ws; };
    function access(c, write, cb) {
        if (!api || !live(c)) return cb(false);
        web().GetNodeWithRights(c.domain, c.userId, c.nodeid, function (node, rights, visible) {
            const user = web().users[c.userId];
            if (!node || !visible || !user || !live(c)) return cb(false);
            // The fork merges saved defaults instead of registered defaults. Seed missing
            // entries to denied, otherwise its inherited fallback grants access.
            const saved = parent.pluginPermissionsCache && parent.pluginPermissionsCache.omniosfiles;
            if (saved) saved.defaults = Object.assign({read: 'denied', write: 'denied'}, saved.defaults);
            if (!parent.getPluginPermissions('omniosfiles')) return cb(false);
            let permitted = false;
            try { permitted = parent.checkPluginPermission(user, 'omniosfiles', 'read', node._id, node.meshid) && (!write || parent.checkPluginPermission(user, 'omniosfiles', 'write', node._id, node.meshid)); }
            catch (e) { }
            cb(permitted);
        });
    }
    function debugLog() {
        if (!settings.debug) return;
        try { console.log.apply(console, ['[omniosfiles]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { }
    }
    function send(c, body) {
        if (!live(c)) return;
        try { c.ws.send(JSON.stringify(Object.assign({action: 'plugin', plugin: 'omniosfiles', method: 'result', protocol: 2, nodeid: c.nodeid, requestId: c.requestId}, body))); } catch (e) { }
    }
    function remove(j) { clearTimeout(j.timer); jobs.delete(j.id); }
    function stop(t) { if (t) { clearTimeout(t.timer); transfers.delete(t.id); } }
    function touch(t) {
        t.time = Date.now(); clearTimeout(t.timer);
        t.timer = setTimeout(function () { stop(t); }, 120000);
        if (t.timer.unref) t.timer.unref();
    }
    function normalize(cmd) {
        const args = {};
        function path(v) {
            if (typeof v !== 'string' || v.length > 4096 || v[0] !== '/' || v.includes('\0') || v.split('/').some(x => x === '.' || x === '..')) throw Error('Invalid path');
            return v;
        }
        function ext(v) {
            const e = require('path').posix.extname(v).toLowerCase();
            if (settings.filterMode === 'whitelist' ? !settings.allowedExtensions.includes(e) : settings.blockedExtensions.includes(e)) throw Error('File extension not allowed');
        }
        if (['listDir', 'fileInfo', 'createDir', 'delete', 'startUpload', 'startDownload'].includes(cmd.pluginaction)) args.path = path(cmd.path);
        if (cmd.pluginaction === 'rename') { args.srcPath = path(cmd.srcPath); args.dstPath = path(cmd.dstPath); ext(args.dstPath); }
        if (cmd.pluginaction === 'startUpload') {
            ext(args.path);
            if (!Number.isSafeInteger(cmd.totalSize) || cmd.totalSize < 0 || cmd.totalSize > settings.maxFileSize) throw Error('Invalid file size');
            args.totalSize = cmd.totalSize;
        }
        if (['uploadChunk', 'requestChunk'].includes(cmd.pluginaction)) {
            if (!Number.isSafeInteger(cmd.chunkIndex) || cmd.chunkIndex < 0) throw Error('Invalid chunk index');
            args.chunkIndex = cmd.chunkIndex;
        }
        if (cmd.pluginaction === 'uploadChunk') {
            if (typeof cmd.data !== 'string' || cmd.data.length > Math.ceil(CHUNK / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cmd.data)) throw Error('Invalid chunk');
            args.data = cmd.data;
        }
        if (['finishUpload', 'finishDownload'].includes(cmd.pluginaction)) {
            if (typeof cmd.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(cmd.checksum)) throw Error('SHA-256 required');
            args.checksum = cmd.checksum;
        }
        return args;
    }
    function launch(c, action, args, write, t) {
        const agent = web().wsagents[c.nodeid];
        if (!agent || (t && t.agent !== agent)) { stop(t); return send(c, {error: 'Device is offline or reconnected'}); }
        if (jobs.size >= 128 || [...jobs.values()].filter(j => j.agent === agent).length >= 8 || (t && t.busy)) { if (t && !t.busy) stop(t); return send(c, {error: 'Device is busy'}); }
        const j = {id: id(), c, agent, t, write, phase: 'awaitingAgent'};
        j.payload = JSON.stringify({protocol: 2, action, args, transferId: t ? t.id : null, policy: settings});
        jobs.set(j.id, j); if (t) t.busy = true;
        debugLog('launch', action, 'job=' + j.id, t ? 'transfer=' + t.id : '');
        j.timer = setTimeout(function () {
            if (!jobs.has(j.id)) return;
            remove(j); stop(t);
            const error = j.phase === 'awaitingAgent'
                ? 'OmniOSFiles agent module did not respond. Rebuild and upload the default agent core, then reload this page.'
                : j.phase === 'received'
                    ? 'The agent received the request but did not complete authorization.'
                    : j.phase === 'authorizing'
                        ? 'The agent did not confirm server authorization.'
                        : 'The file worker did not return a result; the operation may still be running.';
            debugLog('job timeout', 'job=' + j.id, 'phase=' + j.phase, error);
            send(c, {error: error, stage: j.phase});
        }, 30000);
        try { agent.send(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'propose', requestId: j.id, payload: j.payload})); }
        catch (e) { remove(j); stop(t); send(c, {error: 'Cannot contact device'}); }
    }
    function agentMessage(cmd, agent) {
        if (web().wsagents[agent.dbNodeKey] !== agent) return;
        if (cmd.pluginaction === 'transferHeartbeat') {
            // Protocol 3 chunk tunnel: chunks bypass this dispatcher entirely (core relays the
            // tunnel's bytes directly), so this periodic message is what replaces the per-chunk
            // idle-timer refresh and permission re-check that the RPC continuations used to provide.
            if (typeof cmd.transferId !== 'string') return;
            const t = transfers.get(cmd.transferId);
            if (!t || t.agent !== agent) return;
            touch(t);
            debugLog('transferHeartbeat', 'transfer=' + cmd.transferId);
            access(t.c, t.write, function (ok) {
                if (ok || transfers.get(cmd.transferId) !== t) return;
                debugLog('transferHeartbeat revoked', 'transfer=' + cmd.transferId);
                stop(t);
                try { agent.send(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'abortTransfer', transferId: cmd.transferId})); } catch (e) { }
            });
            return;
        }
        const j = jobs.get(cmd.requestId);
        if (!j || j.agent !== agent) return;
        if (cmd.pluginaction === 'agentStatus') {
            debugLog('agentStatus', 'job=' + j.id, 'stage=' + cmd.stage);
            const phases = ['awaitingAgent', 'received', 'authorizing', 'executing'];
            if (['received', 'executing'].includes(cmd.stage) && phases.indexOf(cmd.stage) > phases.indexOf(j.phase)) j.phase = cmd.stage;
            return;
        }
        if (cmd.pluginaction === 'agentError') {
            debugLog('agentError', 'job=' + j.id, cmd.error);
            remove(j); stop(j.t);
            access(j.c, j.write, function (ok) {
                send(j.c, {error: ok ? 'OmniOSFiles agent: ' + String(cmd.error || 'Initialization failed').slice(0, 4096) : 'Access denied'});
            });
            return;
        }
        if (cmd.pluginaction === 'authorize') {
            if (j.approved || cmd.payload !== j.payload || typeof cmd.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(cmd.challenge)) return;
            j.approved = true; j.phase = 'authorizing';
            debugLog('authorize', 'job=' + j.id);
            access(j.c, j.write, function (ok) {
                if (!jobs.has(j.id) || web().wsagents[j.c.nodeid] !== agent) return;
                debugLog('approve', 'job=' + j.id, 'allowed=' + ok);
                try { agent.send(JSON.stringify({action: 'plugin', plugin: 'omniosfiles', pluginaction: 'approve', requestId: j.id, challenge: cmd.challenge, allowed: ok})); } catch (e) { }
                if (!ok) { remove(j); stop(j.t); send(j.c, {error: 'Access denied'}); }
            });
        } else if (cmd.pluginaction === 'response' && j.approved) {
            remove(j);
            if (j.t) { j.t.busy = false; touch(j.t); }
            const data = cmd.result;
            debugLog('response', 'job=' + j.id, data && data.type, data && data.error);
            if (!data || typeof data !== 'object' || typeof data.type !== 'string' || JSON.stringify(data).length > 200000) { stop(j.t); return send(j.c, {error: 'Invalid device response'}); }
            if (['uploadComplete', 'downloadComplete', 'cancelled', 'error'].includes(data.type) || data.error) stop(j.t);
            access(j.c, j.write, function (ok) {
                if (web().wsagents[j.c.nodeid] !== agent) { stop(j.t); return send(j.c, {error: 'Device reconnected'}); }
                if (!ok) { stop(j.t); return send(j.c, {error: 'Access denied'}); }
                send(j.c, {data});
            });
        }
    }
    return {server_startup: initialize, serveraction(cmd, source) {
        if (!api) initialize();
        if (!cmd || !source) return;
        if (source.dbNodeKey) return agentMessage(cmd, source);
        if (!source.user || !source.domain || !source.ws) return;
        const c = {ws: source.ws, userId: source.user._id, domain: source.domain, nodeid: cmd.nodeid, requestId: typeof cmd.requestId === 'string' ? cmd.requestId.slice(0, 100) : ''};
        if (!c.requestId || typeof c.nodeid !== 'string' || c.nodeid.length > 128 || c.nodeid.split('/').length !== 3 || c.nodeid.split('/')[0] !== 'node' || c.nodeid.split('/')[1] !== c.domain.id) return send(c, {error: 'Invalid request'});
        if (!api) return send(c, {error: 'MeshCentral plugin permissions API is required'});
        const action = cmd.pluginaction;
        if (!actions.has(action) && action !== 'capabilities') return;
        const t = [...transfers.values()].find(t => t.c.ws === c.ws && t.c.requestId === c.requestId && t.c.nodeid === c.nodeid);
        const write = continuation.has(action) && t ? t.write : writes.has(action);
        access(c, write, function (ok) {
            // Any unexpected exception in here would otherwise only be logged by core's own
            // wrapper around this whole plugin call (meshuser.js's "Error loading plugin
            // handler"), leaving the browser with no response at all -- stuck on its own
            // client-side timeout instead of a real error. Convert it into one instead.
            try {
                if (!ok) return send(c, {error: 'Access denied'});
                if (action === 'capabilities') return access(c, true, canWrite => send(c, {data: {type: 'capabilities', read: true, write: canWrite, maxFileSize: settings.maxFileSize, chunkSize: CHUNK, debug: settings.debug}}));
                const args = normalize(cmd);
                if (continuation.has(action)) {
                    if (!t) throw Error('Unknown transfer');
                    if (action !== 'cancel' && t.write !== ['uploadChunk', 'finishUpload'].includes(action)) throw Error('Wrong transfer direction');
                    launch(c, action, args, write, t);
                } else if (['startUpload', 'startDownload'].includes(action)) {
                    for (const old of transfers.values()) if (Date.now() - old.time > 120000 || !live(old.c) || web().wsagents[old.c.nodeid] !== old.agent) stop(old);
                    if (t || [...transfers.values()].filter(t => t.c.nodeid === c.nodeid).length >= settings.maxConcurrentTransfers) throw Error('Transfer limit reached');
                    const next = {id: id(), c, agent: web().wsagents[c.nodeid], write, time: Date.now()};
                    transfers.set(next.id, next); touch(next); launch(c, action, args, write, next);
                } else launch(c, action, args, write, null);
            } catch (e) { send(c, {error: e.message || 'Internal error'}); }
        });
    }};
};
