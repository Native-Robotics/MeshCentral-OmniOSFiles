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
    Object.assign(p, {nodes: {'node//a': {caps: {write: true, maxFileSize: 104857600}, path: '/', items: [], loaded: true}, 'node//b': {path: '/', items: []}}, pending: {}, transfers: {}, sequence: 0});
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
test('filenames are DOM text, never inline JavaScript', () => {
    const {p,ctx}=browser();
    const nodes=[];
    function element(tag){const e={tag,children:[],events:{},appendChild(x){this.children.push(x);},addEventListener(k,fn){this.events[k]=fn;},style:{}};nodes.push(e);return e;}
    const host=element('div');ctx.document={getElementById(){return host;},createElement:element};
    const source=factory({parent:{webserver:{}}});p.render=vm.runInNewContext('('+source.render.toString()+')',ctx);
    const name="');window.attacked=true;//<img src=x>";
    p.nodes['node//a'].items=[{name,path:'/'+name,isDirectory:false,supported:true,size:1,mtime:0}];p.render('node//a');
    assert.ok(nodes.some(n=>n.textContent==='📄 '+name));assert.ok(nodes.every(n=>n.innerHTML===undefined&&n.onclick===undefined));
    let clicked;p.download=(node,item)=>{clicked={node,item};};nodes.find(n=>n.title==='Download').events.click();
    assert.equal(clicked.item.name,name);assert.equal(clicked.node,'node//a');
});
test('cancellation waits for the in-flight chunk before sending cancel', () => {
    const {p,sent}=browser();const t={id:'u',node:'node//a',started:true,total:1,offset:0,name:'x'};p.transfers.u=t;
    p.pending.u={};p.cancel('u');assert.equal(sent.length,0);assert.equal(t.cancelling,true);
    delete p.pending.u;p.cancel('u');assert.equal(sent[0].pluginaction,'cancel');
    p.result({}, {protocol:2,nodeid:'node//a',requestId:'u',data:{type:'cancelled'}});
    assert.equal(p.transfers.u,undefined);assert.equal(p.nodes['node//a'].status,'Cancelled');
});

test('successful refresh clears the previous listing error', () => {
    const {p,sent}=browser(),state=p.nodes['node//a'];state.listError='Device request timed out';state.status=state.listError;
    p.navigate('node//a','/');
    p.result({}, {protocol:2,nodeid:'node//a',requestId:sent[0].requestId,data:{path:'/',items:[]}});
    assert.equal(state.status,'');assert.equal(state.listError,null);assert.equal(state.loaded,true);
});
test('directory error, initial state and successful empty listing are distinct', () => {
    const {p,ctx}=browser();const nodes=[];
    function el(tag){const e={tag,children:[],events:{},style:{},appendChild(x){this.children.push(x);},addEventListener(k,f){this.events[k]=f;}};nodes.push(e);return e;}
    const host=el('div');ctx.document={getElementById(){return host;},createElement:el};
    p.render=vm.runInNewContext('('+factory({parent:{webserver:{}}}).render.toString()+')',ctx);
    const state=p.nodes['node//a'];state.loaded=false;state.listError='No agent response';p.render('node//a');
    assert.ok(nodes.some(n=>n.textContent==='Directory could not be loaded. Use Refresh to try again.'));
    assert.ok(!nodes.some(n=>n.textContent==='Directory is empty'));
    nodes.length=0;state.listError=null;state.listing={};p.render('node//a');assert.ok(nodes.some(n=>n.textContent==='Loading directory...'));
    nodes.length=0;state.listing=null;state.loaded=true;p.render('node//a');assert.ok(nodes.some(n=>n.textContent==='Directory is empty'));
    assert.deepEqual(nodes.filter(n=>n.tag==='th').map(n=>n.textContent),['Name','Size','Modified','Actions']);
});
