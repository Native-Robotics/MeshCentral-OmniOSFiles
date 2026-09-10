'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm');
const server = require('../server');
function setup(options = {}) {
    const sent = [], wire = [], executed = [], timers = new Set();
    let read = true, write = true, visible = true;
    const ws = {sessionId: 'own', send: s => sent.push(JSON.parse(s))};
    const user = {_id: 'user//u'}, source = {ws, user, domain: {id: ''}};
    const web = {users: {[user._id]: user}, wsagents: {}, wssessions2: {own: ws}, GetNodeWithRights(d, u, n, cb) { cb({_id: n, meshid: 'mesh//m'}, 0x408, visible); }};
    const parent = {parent: {webserver: web}, pluginPermissionsCache: {}, registerPermissions(n, d) { this.defs = d; }, getPluginPermissions() { return {}; }, checkPluginPermission(u, n, p) { return p === 'read' ? read : write; }};
    if (options.missingAPI) delete parent.registerPermissions;
    const context = {exports: {}, require, setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); }};
    vm.runInNewContext(fs.readFileSync(require.resolve('../modules_meshcore/omniosfiles-auth'), 'utf8'), context);
    let service;
    const agent = {dbNodeKey: 'node//n', send(s) { const m = JSON.parse(s); wire.push(m); if (!options.hold) guard(m); }};
    const guard = context.exports.create(m => service.serveraction(m, agent), (p, reply) => { executed.push(p); reply({type: 'listDirResult', items: []}); }, () => 'b'.repeat(64));
    web.wsagents[agent.dbNodeKey] = agent;
    service = server.create(parent, server.settings({}));
    function request(extra = {}) { service.serveraction(Object.assign({pluginaction: 'listDir', nodeid: agent.dbNodeKey, requestId: 'client', path: '/'}, extra), source); }
    return {sent, wire, executed, request, service, agent, source, web, parent, guard, timers, rights(r, w, v = true) {read = r; write = w; visible = v;}};
}
test('No Files does not block separately authorized reads; sessions and IDs are server-owned', () => {
    const h = setup(); h.request({sessionid: 'victim'});
    assert.equal(h.executed.length, 1); assert.equal(h.sent[0].requestId, 'client');
    assert.notEqual(h.wire[0].requestId, 'client'); assert.equal(h.parent.defs.read.default, 'denied');
    assert.equal(h.sent[0].data.type, 'listDirResult');
});
test('node visibility and separate write rights deny operations before sending', () => {
    const h = setup(); h.rights(true, false); h.request({pluginaction: 'delete'});
    h.rights(true, true, false); h.request(); h.request({nodeid: 'node/other/n'});
    assert.equal(h.executed.length, 0); assert.equal(h.wire.length, 0);
});
test('missing permission API fails closed', () => { const h = setup({missingAPI: true}); h.request(); assert.match(h.sent[0].error, /API/); });
test('browser cannot impersonate agent replies or approve an operation', () => {
    const h = setup(); h.service.serveraction({pluginaction: 'response', requestId: 'fake'}, h.source);
    h.guard({pluginaction: 'approve', requestId: 'a'.repeat(48), challenge: 'b'.repeat(64), allowed: true});
    assert.equal(h.executed.length, 0);
});
test('challenge is single-use, payload is immutable, permission revocation rejects execution', () => {
    const h = setup({hold: true}); h.request(); const proposal = h.wire[0];
    h.guard(proposal); const approval = h.wire[1];
    h.guard(Object.assign({}, approval, {challenge: 'c'.repeat(64)})); assert.equal(h.executed.length, 0);
    h.guard(approval); h.guard(approval); assert.equal(h.executed.length, 1);
    h.request({requestId: 'second'}); h.rights(false, false); h.guard(h.wire[2]); h.guard(h.wire[3]);
    assert.equal(h.executed.length, 1);
});
test('unregistered direct proposals never execute and expire', () => {
    const h = setup(); h.guard({pluginaction: 'propose', requestId: 'd'.repeat(48), payload: JSON.stringify({protocol: 2, action: 'delete'})});
    assert.equal(h.executed.length, 0); for (const timer of h.timers) timer(); assert.equal(h.executed.length, 0);
});
test('request schema rejects oversized, negative, traversal and disguised upload names', () => {
    const h = setup(); for (const size of [-1, 1.5, 200 * 1024 * 1024]) h.request({pluginaction: 'startUpload', totalSize: size});
    h.request({path: '/../outside'}); assert.equal(h.executed.length, 0);
    assert.throws(() => server.settings({maxFileSize: 3221225472}));
});
test('unknown transfer cannot be continued or cancelled', () => {
    const h = setup(); h.request({pluginaction: 'uploadChunk', chunkIndex: 0, data: 'YQ=='}); h.request({pluginaction: 'cancel'});
    assert.equal(h.executed.length, 0);
});
