'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm');
const server = require('../server');
function setup(options = {}) {
    const sent = [], wire = [], executed = [], timers = new Set(), jobTimers = new Set();
    let implementation = server;
    if (options.fakeClock) {
        const env = {exports: {}, require, setTimeout(fn, ms) { const timer = {fn, ms, unref() {}}; jobTimers.add(timer); return timer; }, clearTimeout(timer) { jobTimers.delete(timer); }};
        vm.runInNewContext(fs.readFileSync(require.resolve('../server'), 'utf8'), env); implementation = env.exports;
    }
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
    service = implementation.create(parent, server.settings({}));
    function request(extra = {}) { service.serveraction(Object.assign({pluginaction: 'listDir', nodeid: agent.dbNodeKey, requestId: 'client', path: '/'}, extra), source); }
    return {sent, wire, executed, request, service, agent, source, web, parent, guard, timers, jobTimers, rights(r, w, v = true) {read = r; write = w; visible = v;}};
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

test('a read transfer ID does not grant mutation permissions', () => {
    const h = setup(); h.rights(true, false); h.request({pluginaction: 'startDownload'});
    assert.equal(h.executed.length, 1); h.request({pluginaction: 'delete'});
    assert.equal(h.executed.length, 1); assert.equal(h.sent.at(-1).error, 'Access denied');
});
test('replaced agent cannot approve or complete a pending operation', () => {
    const h=setup({hold:true});h.request();const proposal=h.wire[0];
    h.web.wsagents[h.agent.dbNodeKey]={dbNodeKey:h.agent.dbNodeKey,send(){}};
    h.guard(proposal);assert.equal(h.wire.length,1);assert.equal(h.executed.length,0);
    // Let the original job finish through an error response only after restoring the
    // connection for cleanup; this is not an authorization grant to the replacement.
    h.web.wsagents[h.agent.dbNodeKey]=h.agent;
    h.service.serveraction({pluginaction:'authorize',requestId:proposal.requestId,payload:proposal.payload,challenge:'b'.repeat(64)},h.agent);
    h.guard(h.wire[1]);assert.equal(h.executed.length,1);
});
test('changed proposal payload cannot be approved by the server', () => {
    const h=setup({hold:true});h.request();const original=h.wire[0];
    h.guard({...original,payload:JSON.stringify({protocol:2,action:'delete'})});
    assert.equal(h.wire.length,1);assert.equal(h.executed.length,0);
    // Expire the unapproved agent proposal, then complete the real proposal.
    for(const fn of [...h.timers])fn();assert.match(h.sent.at(-1).error,/authorization/);
    h.request({requestId:'retry'});h.guard(h.wire[1]);h.guard(h.wire[2]);
    assert.equal(h.executed[0].action,'listDir');
});

test('timeouts remove jobs and late replies or old timers cannot finish newer requests', () => {
    const h=setup({hold:true,fakeClock:true});h.request();const first=h.wire[0],timer=[...h.jobTimers][0];
    timer.fn();assert.match(h.sent[0].error,/agent module did not respond/);assert.equal(h.sent[0].stage,'awaitingAgent');
    h.request({requestId:'new'});timer.fn();assert.equal(h.sent.length,1);
    h.guard(first);assert.equal(h.wire.length,2);
    h.guard(h.wire[1]);h.guard(h.wire[2]);assert.equal(h.sent[1].requestId,'new');assert.equal(h.executed.length,1);
    for(const fn of [...h.timers])fn();
});
test('another authenticated session cannot continue the original session transfer', () => {
    const h=setup();h.request({pluginaction:'startDownload'});
    const messages=[],ws={sessionId:'other',send:s=>messages.push(JSON.parse(s))},user={_id:'user//other'};
    h.web.wssessions2.other=ws;h.web.users[user._id]=user;
    h.service.serveraction({pluginaction:'cancel',nodeid:'node//n',requestId:'client'}, {ws,user,domain:{id:''}});
    assert.equal(messages[0].error,'Unknown transfer');assert.equal(h.executed.length,1);
});

test('agent initialization failures return immediately without granting file execution', () => {
    const h=setup({hold:true,fakeClock:true});h.request();const requestId=h.wire[0].requestId;
    h.service.serveraction({pluginaction:'agentError',requestId,error:'Secure random generator failed'},h.agent);
    assert.match(h.sent[0].error,/Secure random generator/);assert.equal(h.jobTimers.size,0);assert.equal(h.executed.length,0);
});
test('timeouts distinguish module receipt from worker execution', () => {
    for(const stage of ['received','executing']) {
        const h=setup({hold:true,fakeClock:true});h.request();
        h.service.serveraction({pluginaction:'agentStatus',requestId:h.wire[0].requestId,stage},h.agent);
        [...h.jobTimers][0].fn();assert.equal(h.sent[0].stage,stage);
        assert.match(h.sent[0].error,stage==='received'?/authorization/:/worker/);
    }
});
