'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const {EventEmitter}=require('events');
function bridge(failSpawn=false){
    const mesh=new EventEmitter(),sent=[],timers=new Set();mesh.SendCommand=m=>sent.push(m);
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.writes=[];child.killed=0;
    child.stdin={write:s=>child.writes.push(JSON.parse(s)),end(){}};child.kill=()=>{child.killed++;child.emit('exit',0);};
    function schedule(fn,ms){const t={fn,ms};timers.add(t);return t;}
    const auth={exports:{},setTimeout:schedule,clearTimeout:t=>timers.delete(t)};
    vm.runInNewContext(fs.readFileSync(require.resolve('../modules_meshcore/omniosfiles-auth'),'utf8'),auth);
    const env={module:{exports:{}},process:{platform:'linux'},setTimeout:schedule,clearTimeout:t=>timers.delete(t),require(name){
        if(name==='MeshAgent')return mesh;
        if(name==='omniosfiles-helper')return 'helper';
        if(name==='omniosfiles-auth')return {create:(send,execute)=>auth.exports.create(send,execute,()=>crypto.randomBytes(32).toString('hex'))};
        if(name==='child_process')return {execFile(){if(failSpawn)throw Error('missing');return child;}};
        throw Error(name);
    }};
    vm.runInNewContext(fs.readFileSync(require.resolve('../modules_meshcore/omniosfiles'),'utf8'),env);
    function start(){const requestId=crypto.randomBytes(24).toString('hex');env.module.exports.consoleaction({pluginaction:'propose',requestId,payload:JSON.stringify({protocol:2,action:'listDir'})});const challenge=sent.at(-1).challenge;env.module.exports.consoleaction({pluginaction:'approve',requestId,challenge,allowed:true});}
    return {mesh,sent,timers,child,start};
}
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
