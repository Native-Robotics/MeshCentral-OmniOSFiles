'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto'), vm = require('vm');
const factory = require('../omniosfiles').omniosfiles;
function browser() {
    const sent = [], timers = new Set();
    const ctx = {pluginHandler: {omniosfiles: {}}, currentNode: {_id: 'node//a'}, Uint8Array, Int32Array, Object, Number, Date, Error, Promise,
        meshserver: {send: m => sent.push(m)}, setTimeout: fn => {timers.add(fn); return fn;}, clearTimeout: fn => timers.delete(fn)};
    const source = factory({parent: {webserver: {}}});
    for (const name of source.exports) ctx.pluginHandler.omniosfiles[name] = vm.runInNewContext('(' + source[name].toString() + ')', ctx);
    const p = ctx.pluginHandler.omniosfiles;
    Object.assign(p, {nodes: {'node//a': {caps: {write: true, maxFileSize: 104857600}, path: '/', items: []}, 'node//b': {path: '/', items: []}}, pending: {}, transfers: {}, sequence: 0});
    p.render = () => {};
    return {p, ctx, sent, timers};
}
test('incremental SHA-256 matches independent Node crypto across padding/chunk boundaries', () => {
    const {p} = browser();
    for (const length of [0,1,55,56,63,64,65,65536,1000000]) {
        const bytes = crypto.randomBytes(length), hash = p.hash();
        for (let i=0;i<length;i+=117) hash.update(bytes.subarray(i,i+117));
        assert.equal(hash.digest(), crypto.createHash('sha256').update(bytes).digest('hex'));
        assert.equal(hash.digest(), crypto.createHash('sha256').update(bytes).digest('hex'));
    }
});
test('serialized frontend uses the actual core dispatch signature and rejects wrong node/late results', () => {
    const {p, sent, timers} = browser(); let results = [];
    const id = p.request('node//a', 'listDir', {path: '/'}, (data,error) => results.push({data,error}));
    p.result({}, {protocol:2,nodeid:'node//b',requestId:id,data:{items:[]}}); assert.equal(results.length,0);
    const timer = [...timers][0]; timer();
    p.result({}, {protocol:2,nodeid:'node//a',requestId:id,data:{items:[]}}); assert.equal(results.length,1); assert.match(results[0].error,/timed out/);
    assert.equal(sent[0].sessionid, undefined);
});
test('FileReader completion remains bound to the originating device after navigation', () => {
    const {p,ctx,sent} = browser(); let reader;
    ctx.FileReader = class {constructor(){reader=this;} readAsArrayBuffer(){} };
    ctx.btoa = s => Buffer.from(s,'binary').toString('base64');
    const t = {id:'upload',node:'node//a',name:'file',upload:true,total:1,offset:0,index:0,hash:p.hash(),file:{slice(){return {};}}};
    p.transfers.upload=t; p.uploadNext(t); ctx.currentNode={_id:'node//b'};
    reader.result = new Uint8Array([42]).buffer; reader.onload();
    assert.equal(sent[0].nodeid,'node//a');
    p.result({}, {protocol:2,nodeid:'node//a',requestId:'upload',error:'test end'});
});
test('out-of-order directory responses cannot overwrite the latest navigation', () => {
    const {p,sent}=browser(); p.navigate('node//a','/old');p.navigate('node//a','/new');
    p.result({}, {protocol:2,nodeid:'node//a',requestId:sent[1].requestId,data:{path:'/new',items:[]}});
    p.result({}, {protocol:2,nodeid:'node//a',requestId:sent[0].requestId,data:{path:'/old',items:[]}});
    assert.equal(p.nodes['node//a'].path,'/new');
});
exports.browser=browser;
