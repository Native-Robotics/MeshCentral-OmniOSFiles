'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const {EventEmitter}=require('events');
function bridge(failSpawn=false,clock=null){
    const mesh=new EventEmitter(),sent=[],timers=new Set();mesh.SendCommand=m=>sent.push(m);
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.writes=[];child.killed=0;
    child.stdin={write:s=>child.writes.push(JSON.parse(s)),end(){}};child.kill=()=>{child.killed++;child.emit('exit',0);};
    // A real setTimeout callback, once it fires, is done -- a later clearTimeout() on it is a
    // safe no-op. Model that here (real MeshAgent's native clearTimeout throws "Invalid
    // Parameter" on an already-elapsed handle instead, which is exactly the bug this harness
    // exists to catch, so tests must not rely on a fired timer lingering in `timers`).
    function schedule(fn,ms){const t={ms};t.fn=function(){timers.delete(t);fn();};timers.add(t);return t;}
    // Mirror the observed native strictness: clearTimeout() on a handle that isn't currently
    // pending (already fired, already cleared, or never scheduled) throws, instead of the
    // Node.js/browser no-op -- otherwise this exact bug class stays invisible to the suite.
    function clearScheduled(t){if(!timers.has(t))throw Error('timers.clearTimeout(): Invalid Parameter');timers.delete(t);}
    const auth={exports:{},setTimeout:schedule,clearTimeout:clearScheduled};
    vm.runInNewContext(fs.readFileSync(require.resolve('../modules_meshcore/omniosfiles-auth'),'utf8'),auth);
    const env={module:{exports:{}},process:{platform:'linux'},Buffer,setTimeout:schedule,clearTimeout:clearScheduled,
        ...(clock?{Date:{now:()=>clock.now}}:{}),require(name){
        if(name==='MeshAgent')return mesh;
        if(name==='omniosfiles-helper')return 'helper';
        if(name==='omniosfiles-auth')return {create:(send,execute)=>auth.exports.create(send,execute,()=>crypto.randomBytes(32).toString('hex'))};
        if(name==='child_process')return {execFile(){if(failSpawn)throw Error('missing');return child;}};
        throw Error(name);
    }};
    vm.runInNewContext(fs.readFileSync(require.resolve('../modules_meshcore/omniosfiles'),'utf8'),env);
    const consoleaction=env.module.exports.consoleaction;
    function start(){const requestId=crypto.randomBytes(24).toString('hex');consoleaction({pluginaction:'propose',requestId,payload:JSON.stringify({protocol:2,action:'listDir'})});const challenge=sent.at(-1).challenge;consoleaction({pluginaction:'approve',requestId,challenge,allowed:true});}
    function startTransfer(action,transferId,policy={}){
        const requestId=crypto.randomBytes(24).toString('hex');
        consoleaction({pluginaction:'propose',requestId,payload:JSON.stringify({protocol:2,action,args:{},transferId,policy})});
        const challenge=sent.at(-1).challenge;
        consoleaction({pluginaction:'approve',requestId,challenge,allowed:true});
    }
    function respond(result){const w=child.writes[child.writes.length-1];child.stdout.emit('data',JSON.stringify({id:w.id,result})+'\n');}
    return {mesh,sent,timers,child,start,startTransfer,respond,consoleaction};
}
function fakeTunnel(){const writes=[];return {writes,write(buf){writes.push(Buffer.from(buf));},data:null};}
function frames(tunnel){return tunnel.writes.map(b=>b[0]===123?JSON.parse(b.toString()):b);}
test('worker timeout kills process and completes each pending operation once',()=>{
    const h=bridge();h.start();h.start();const timer=[...h.timers].find(t=>t.ms===25000);timer.fn();
    assert.equal(h.child.killed,1);assert.equal(h.sent.filter(m=>m.pluginaction==='response').length,2);assert.equal(h.timers.size,0);
    h.child.emit('error',Error('late'));h.child.emit('exit',1);assert.equal(h.sent.filter(m=>m.pluginaction==='response').length,2);
});
test('disconnect releases pending callbacks and stops the worker',()=>{
    const h=bridge();h.start();h.mesh.emit('Connected',0);assert.equal(h.child.killed,1);assert.match(h.sent.at(-1).result.error,/disconnected/);assert.equal(h.timers.size,0);
});
test('unavailable subprocess returns a single explicit error',()=>{
    const h=bridge(true);h.start();const replies=h.sent.filter(m=>m.pluginaction==='response');assert.equal(replies.length,1);assert.match(replies[0].result.error,/Cannot run/);
});
test('debug logging is off by default and only emitted when the policy enables it',()=>{
    const off=bridge();const t1='1'.repeat(48);
    off.startTransfer('startUpload',t1);off.respond({type:'uploadReady',totalSize:0,fileName:'x',chunkSize:65536,transferId:t1});
    assert.ok(!off.sent.some(m=>m.type==='console'));
    const on=bridge();const t2='2'.repeat(48);
    on.startTransfer('startUpload',t2,{debug:true});on.respond({type:'uploadReady',totalSize:0,fileName:'x',chunkSize:65536,transferId:t2});
    assert.ok(on.sent.some(m=>m.type==='console'&&m.value.includes('execute')));
});
test('bindTransfer only accepts a live, single-use authorized transferId',()=>{
    const h=bridge();const transferId='a'.repeat(48);
    h.startTransfer('startUpload',transferId);h.respond({type:'uploadReady',totalSize:0,fileName:'x',chunkSize:65536,transferId});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    assert.deepEqual(frames(tunnel)[0],{action:'plugin',plugin:'omniosfiles',pluginaction:'bound',transferId});
    assert.equal(typeof tunnel.data,'function');
    const reused=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,reused);
    assert.equal(frames(reused)[0].pluginaction,'bindError');
    const unknown=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId:'b'.repeat(48)},null,null,unknown);
    assert.equal(frames(unknown)[0].pluginaction,'bindError');
    const noWrite=fakeTunnel();delete noWrite.write;h.consoleaction({pluginaction:'bindTransfer',transferId:'c'.repeat(48)},null,null,noWrite);
});
test('bound upload tunnel submits chunks to the worker one at a time and acks each in order',()=>{
    const h=bridge();const transferId='d'.repeat(48);
    h.startTransfer('startUpload',transferId);h.respond({type:'uploadReady',totalSize:2,fileName:'x',chunkSize:65536,transferId});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    const before=h.child.writes.length;
    tunnel.data(Buffer.from([65]));tunnel.data(Buffer.from([66]));
    assert.equal(h.child.writes.length,before+1);
    assert.equal(h.child.writes[before].payload.action,'uploadChunk');assert.equal(h.child.writes[before].payload.args.chunkIndex,0);
    assert.equal(Buffer.from(h.child.writes[before].payload.args.data,'base64').toString(),'A');
    h.respond({type:'uploadAck',chunkIndex:0,receivedBytes:1});
    assert.equal(h.child.writes.length,before+2);
    assert.equal(h.child.writes[before+1].payload.args.chunkIndex,1);
    assert.equal(Buffer.from(h.child.writes[before+1].payload.args.data,'base64').toString(),'B');
    assert.equal(frames(tunnel).filter(m=>m.pluginaction==='chunkAck').length,1);
    h.respond({type:'uploadAck',chunkIndex:1,receivedBytes:2});
    assert.equal(frames(tunnel).filter(m=>m.pluginaction==='chunkAck').length,2);
});
test('bound download tunnel is single-flight against the worker and paces further chunks on chunkAck credits',()=>{
    const h=bridge();const transferId='e'.repeat(48);
    h.startTransfer('startDownload',transferId);h.respond({type:'downloadStart',totalSize:20*16384,fileName:'x',chunkSize:16384,transferId});
    const before=h.child.writes.length;
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    assert.equal(h.child.writes.length,before+1); // binding immediately requests the first of the 8 primed chunks
    assert.equal(h.child.writes[before].payload.action,'requestChunk');assert.equal(h.child.writes[before].payload.args.chunkIndex,0);
    let answered=0;
    function respondNext(){const w=h.child.writes[before+answered];answered++;h.respond({type:'downloadChunk',chunkIndex:w.payload.args.chunkIndex,receivedBytes:0,data:Buffer.from('x').toString('base64')});}
    for(let i=0;i<7;i++)respondNext();
    assert.equal(h.child.writes.length,before+8); // the 8-wide priming window is fully in flight without any browser ack
    respondNext(); // answers the 8th and last primed request; the credit budget is now exhausted
    assert.equal(h.child.writes.length,before+8);
    tunnel.data(Buffer.from(JSON.stringify({action:'plugin',plugin:'omniosfiles',pluginaction:'chunkAck'})));
    assert.equal(h.child.writes.length,before+9);
    assert.equal(h.child.writes[before+8].payload.args.chunkIndex,8);
    assert.equal(frames(tunnel).filter(f=>Buffer.isBuffer(f)).length,8);
});
test('a download never primes a chunk request past the transfer\'s total size',()=>{
    const h=bridge();const transferId='0'.repeat(48);
    // Exactly two chunks (16384 + 1 byte): with the 8-wide priming window uncapped by size,
    // the agent would otherwise fire a 3rd, out-of-bounds requestChunk that the Python worker
    // rejects and cleans up the transfer for, orphaning it before finishDownload ever arrives.
    h.startTransfer('startDownload',transferId);h.respond({type:'downloadStart',totalSize:16385,fileName:'x',chunkSize:16384,transferId});
    const before=h.child.writes.length;
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    assert.equal(h.child.writes.length,before+1);assert.equal(h.child.writes[before].payload.args.chunkIndex,0);
    h.respond({type:'downloadChunk',chunkIndex:0,receivedBytes:0,data:Buffer.from('x'.repeat(16384)).toString('base64')});
    assert.equal(h.child.writes.length,before+2);assert.equal(h.child.writes[before+1].payload.args.chunkIndex,1);
    h.respond({type:'downloadChunk',chunkIndex:1,receivedBytes:0,data:Buffer.from('x').toString('base64')});
    assert.equal(h.child.writes.length,before+2); // no 3rd, out-of-bounds request
});
test('abortTransfer on the control channel tears down the bound tunnel and cancels the worker transfer',()=>{
    const h=bridge();const transferId='f'.repeat(48);
    h.startTransfer('startUpload',transferId);h.respond({type:'uploadReady',totalSize:1,fileName:'x',chunkSize:65536,transferId});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    h.consoleaction({pluginaction:'abortTransfer',transferId});
    assert.equal(frames(tunnel).find(m=>m.pluginaction==='tunnelError')?.error,'Transfer was cancelled by the server');
    const before=h.child.writes.length;
    tunnel.data(Buffer.from([65]));
    assert.equal(h.child.writes.length,before); // the detached handler ignores stray data after teardown
    const cancelWrite=h.child.writes.find(w=>w.payload.action==='cancel'&&w.payload.transferId===transferId);
    assert.ok(cancelWrite);
    h.consoleaction({pluginaction:'abortTransfer',transferId:'unknown'.padEnd(48,'0')}); // unknown transferId is a no-op
});
test('worker timeout preserves the cause on the control channel and tunnel',()=>{
    const h=bridge();h.start();
    const transferId='9'.repeat(48);
    h.startTransfer('startUpload',transferId);h.respond({type:'uploadReady',totalSize:1,fileName:'x',chunkSize:65536,transferId});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    tunnel.data(Buffer.from([65]));
    const timer=[...h.timers].find(t=>t.ms===25000);timer.fn();
    // Two 'response' messages: startUpload's own successful completion, plus the timed-out listDir
    // command. The timed-out upload chunk is reported over the tunnel, not this channel.
    const replies=h.sent.filter(m=>m.pluginaction==='response');
    assert.equal(replies.length,2);
    assert.ok(replies.some(m=>m.result&&m.result.error&&/inspect the device/.test(m.result.error)));
    assert.ok(!replies.some(m=>m.result&&m.result.error&&/retry the transfer/.test(m.result.error)));
    const tunnelError=frames(tunnel).find(m=>m.pluginaction==='tunnelError');
    assert.ok(tunnelError);assert.match(tunnelError.error,/File worker timed out/);
});
test('an idle bound tunnel stops heartbeating and tears itself down instead of being kept alive forever',()=>{
    const clock={now:Date.now()};
    const h=bridge(false,clock);
    const transferId='8'.repeat(48);
    h.startTransfer('startUpload',transferId);h.respond({type:'uploadReady',totalSize:1,fileName:'x',chunkSize:65536,transferId});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId},null,null,tunnel);
    const firstHeartbeat=[...h.timers].find(t=>t.ms===20000);assert.ok(firstHeartbeat);
    clock.now+=20000;firstHeartbeat.fn();
    assert.equal(h.sent.filter(m=>m.pluginaction==='transferHeartbeat').length,1);
    const secondHeartbeat=[...h.timers].find(t=>t.ms===20000);assert.ok(secondHeartbeat);
    clock.now+=91000; // no chunk activity at all in the meantime
    secondHeartbeat.fn();
    assert.equal(h.sent.filter(m=>m.pluginaction==='transferHeartbeat').length,1); // no further heartbeat is sent
    assert.equal(frames(tunnel).find(m=>m.pluginaction==='tunnelError')?.error,'Transfer idle; closing the tunnel');
    const before=h.child.writes.length;
    tunnel.data(Buffer.from([65]));
    assert.equal(h.child.writes.length,before); // no lingering tunnel state left behind
});

test('worker exit preserves code, signal and stderr for an idle bound tunnel',()=>{
    const h=bridge(),id='e'.repeat(48);
    h.startTransfer('startUpload',id);h.respond({type:'uploadReady',totalSize:10});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId:id},null,null,tunnel);
    h.child.stderr.emit('data','omniosfiles-worker exit=stdin-eof processed=108 buffered=0');
    h.child.emit('exit',0,null);
    const error=frames(tunnel).find(m=>m.pluginaction==='tunnelError').error;
    assert.match(error,/code=0, signal=null/);assert.match(error,/exit=stdin-eof processed=108/);
    assert.equal(h.timers.size,0);
});

const corePath=require('path').join(process.env.MESHCENTRAL_SOURCE || require('path').resolve(__dirname,'../../MeshCentral'),'meshagent.js');
test('debug upload logging does not trip the real MeshCentral console repetition guard', {skip:!fs.existsSync(corePath)},()=>{
    const core=fs.readFileSync(corePath,'utf8');
    const start=core.indexOf("if (command.type == 'console')",core.indexOf('function processAgentData'));
    const end=core.indexOf('// Route a message',start);
    assert.ok(start>=0&&end>start);
    const guard=new vm.Script('(function(){'+core.slice(start,end)+'})()');
    const h=bridge(),id='f'.repeat(48);let disconnected=0;
    const agent={close(){disconnected++;}};
    h.startTransfer('startUpload',id,{debug:true});h.respond({type:'uploadReady',totalSize:256});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId:id},null,null,tunnel);
    for(let i=0;i<256;i++) {tunnel.data(Buffer.from([65]));h.respond({type:'uploadAck',chunkIndex:i,receivedBytes:i+1});}
    for(const command of h.sent.filter(m=>m.type==='console')) guard.runInNewContext({command,obj:agent});
    assert.equal(disconnected,0,'debug logging must not disconnect the agent');
    assert.ok(h.sent.filter(m=>m.type==='console').length<20,'no per-chunk console flood');
    assert.equal(frames(tunnel).filter(m=>m.pluginaction==='chunkAck').length,256);
    // Confirm this exact guard really detects the old constant per-chunk message.
    for(let i=0;i<40;i++)guard.runInNewContext({command:{type:'console',value:'old repeated uploadChunk'},obj:agent});
    assert.ok(disconnected>0);
});

test('queued upload bytes survive reuse of the incoming tunnel buffer',()=>{
    const h=bridge(),id='7'.repeat(48);
    h.startTransfer('startUpload',id);h.respond({type:'uploadReady',totalSize:2});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId:id},null,null,tunnel);
    tunnel.data(Buffer.from([65]));
    const incoming=Buffer.from([66]);tunnel.data(incoming);incoming[0]=90;
    h.respond({type:'uploadAck',chunkIndex:0,receivedBytes:1});
    const payload=h.child.writes.at(-1).payload;
    assert.equal(Buffer.from(payload.args.data,'base64').toString(),'B');
});

test('upload errors include frame metadata without dumping bytes',()=>{
    const h=bridge(),id='8'.repeat(48);
    h.startTransfer('startUpload',id);h.respond({type:'uploadReady',totalSize:1});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId:id},null,null,tunnel);
    tunnel.data(Buffer.from([0,0]));h.respond({type:'error',error:'Unexpected chunk length: expected=1, actual=0'});
    const error=frames(tunnel).find(m=>m.pluginaction==='tunnelError').error;
    assert.match(error,/expected=1, actual=0/);assert.match(error,/upload chunk=0, frame=2, copied=1, escaped=true/);
});

test('text RTT frames use the original core handler instead of becoming upload bytes',()=>{
    const h=bridge(),id='6'.repeat(48),controls=[];
    h.startTransfer('startUpload',id);h.respond({type:'uploadReady',totalSize:2});
    const tunnel=fakeTunnel();tunnel.data=function(data){assert.equal(this,tunnel);controls.push(data);};
    h.consoleaction({pluginaction:'bindTransfer',transferId:id},null,null,tunnel);
    tunnel.data(Buffer.from([65]));
    const rtt=JSON.stringify({ctrlChannel:102938,type:'rtt',time:1789243648688});assert.equal(rtt.length,56);
    tunnel.data(rtt);tunnel.data(Buffer.from(rtt));tunnel.data('not JSON');
    tunnel.data(Buffer.from([66]));
    h.respond({type:'uploadAck',chunkIndex:0,receivedBytes:1});
    assert.equal(Buffer.from(h.child.writes.at(-1).payload.args.data,'base64').toString(),'B');
    h.respond({type:'uploadAck',chunkIndex:1,receivedBytes:2});
    assert.equal(h.child.writes.filter(w=>w.payload.action==='uploadChunk').length,2);
    assert.deepEqual(controls,[rtt,Buffer.from(rtt)]);
});

test('download chunkAck routed through consoleaction does not trip the real MeshCentral console repetition guard',{skip:!fs.existsSync(corePath)},()=>{
    // Real MeshCentral core additionally routes protocol-7 JSON control frames through the
    // plugin's own consoleaction entry point, not only through the tunnel's own data handler
    // (which every other test in this file drives directly via tunnel.data()). That extra path
    // isn't modeled by fakeTunnel, so a download's chunkAck credit message -- sent once per
    // DOWNLOAD_WINDOW slot, identically every time -- reaches consoleaction's own debugLog call
    // unfiltered, confirmed against a real deployment's log immediately before "Agent
    // disconnected". Drive that exact call site directly here.
    const core=fs.readFileSync(corePath,'utf8');
    const start=core.indexOf("if (command.type == 'console')",core.indexOf('function processAgentData'));
    const end=core.indexOf('// Route a message',start);
    assert.ok(start>=0&&end>start);
    const guard=new vm.Script('(function(){'+core.slice(start,end)+'})()');
    const h=bridge(),id='d'.repeat(48);let disconnected=0;
    const agent={close(){disconnected++;}};
    h.startTransfer('startDownload',id,{debug:true});h.respond({type:'downloadStart',totalSize:256*16384,fileName:'x',chunkSize:16384,transferId:id});
    const tunnel=fakeTunnel();h.consoleaction({pluginaction:'bindTransfer',transferId:id},null,null,tunnel);
    for(let i=0;i<256;i++) h.consoleaction({pluginaction:'chunkAck',transferId:id},null,null,tunnel);
    for(const command of h.sent.filter(m=>m.type==='console')) guard.runInNewContext({command,obj:agent});
    assert.equal(disconnected,0,'chunkAck console routing must not disconnect the agent');
    assert.ok(h.sent.filter(m=>m.type==='console').length<20,'no per-chunkAck console flood');
    // Confirm this exact guard really detects the old constant per-chunkAck message.
    for(let i=0;i<40;i++)guard.runInNewContext({command:{type:'console',value:'old repeated consoleaction chunkAck via-tunnel'},obj:agent});
    assert.ok(disconnected>0);
});
