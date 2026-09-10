'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), cp = require('child_process'), crypto = require('crypto');
const {EventEmitter, once} = require('events');
const factory = require('../omniosfiles').omniosfiles;
const waitFor = async fn => { const limit=Date.now()+5000; while(!fn()){if(Date.now()>limit)throw Error('Round trip timed out');await new Promise(r=>setTimeout(r,5));} };
test('serialized browser, actual server/auth/agent bridge and Python worker transfer bytes in both directions', async () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-roundtrip-'));
    const mesh=new EventEmitter(), blobs=[]; let child;
    const ctx={pluginHandler:{omniosfiles:{}},currentNode:{_id:'node//test'},Uint8Array,Int32Array,Promise,Object,Number,Date,Error,Blob,setTimeout,clearTimeout,
        btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),window:{},URL:{createObjectURL:b=>{blobs.push(b);return 'blob:test';},revokeObjectURL(){}},document:{createElement(){return {click(){},remove(){}};},body:{appendChild(){}}}};
    ctx.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onload();},()=>this.onerror());}};
    const p=ctx.pluginHandler.omniosfiles;
    const ws={sessionId:'session',send:s=>p.result({},JSON.parse(s))};
    const user={_id:'user//u'},source={user,ws,domain:{id:''}};
    const web={users:{[user._id]:user},wsagents:{},wssessions2:{session:ws},GetNodeWithRights(d,u,n,cb){cb({_id:n,meshid:'mesh//m'},0x408,true);}};
    const parent={parent:{webserver:web},registerPermissions(){},getPluginPermissions(){return {};},checkPluginPermission(){return true;}};
    const obj=factory(parent);
    const agent={dbNodeKey:'node//test',send:s=>agentModule.consoleaction(JSON.parse(s),null,null,{SendCommand(){throw Error('Untrusted parent must not receive secrets');}})};
    web.wsagents[agent.dbNodeKey]=agent;
    mesh.SendCommand=m=>obj.serveraction(m,agent);
    const sandbox={module:{exports:{}},process:{platform:'linux'},setTimeout,clearTimeout,require(name){
        if(name==='MeshAgent')return mesh;
        if(name==='omniosfiles-auth') {
            const auth={exports:{},setTimeout,clearTimeout,require:n=>{assert.equal(n,'EncryptionStream');return {GenerateRandom:n=>crypto.randomBytes(n)};}};
            vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules_meshcore/omniosfiles-auth.js'),'utf8'),auth);return auth.exports;
        }
        if(name==='omniosfiles-helper')return require('../modules_meshcore/omniosfiles-helper');
        if(name==='child_process')return {execFile(exe,args){
            assert.equal(exe,'/usr/bin/python3');assert.deepEqual(Array.from(args.slice(0,4)),['python3','-I','-u','-c']);
            // Run the exact helper main/transport under our current uid in an isolated
            // directory. Native argv[0] semantics are adapted explicitly for Node.
            const code=args[4].replace("if __name__ == '__main__':\n    main()",'');
            const bootstrap=code+'\nimport types\nOriginal=Worker\nWorker=lambda ignored: Original('+JSON.stringify(root)+')\npwd.getpwnam=lambda name: types.SimpleNamespace(pw_uid=os.geteuid())\ngrp.getgrnam=lambda name: types.SimpleNamespace(gr_gid=os.getegid())\nmain()\n';
            child=cp.spawn(exe,['-I','-u','-c',bootstrap]);return child;
        }};
        throw Error('Unexpected module '+name);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules_meshcore/omniosfiles.js'),'utf8'),sandbox);
    const agentModule=sandbox.module.exports;
    for(const key of obj.exports)p[key]=vm.runInNewContext('('+obj[key].toString()+')',ctx);
    Object.assign(p,{nodes:{'node//test':{path:'/',caps:{write:true,maxFileSize:104857600},items:[]}},pending:{},transfers:{},sequence:0});
    p.render=()=>{};ctx.meshserver={send:m=>obj.serveraction(m,source)};
    try {
        const bytes=crypto.randomBytes(65537), file=new Blob([bytes]);file.name='test.bin';
        p.upload('node//test','/',file);
        await waitFor(()=>Object.keys(p.transfers).length===0);
        assert.match(p.nodes['node//test'].status,/Completed/);
        assert.deepEqual(fs.readFileSync(path.join(root,'test.bin')),bytes);
        p.download('node//test',{name:'test.bin',path:'/test.bin',size:bytes.length});
        await waitFor(()=>Object.keys(p.transfers).length===0);
        assert.match(p.nodes['node//test'].status,/Completed/);
        assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()),bytes);
        await waitFor(()=>Object.keys(p.pending).length===0);
    } finally {
        const closed=child&&once(child,'close');mesh.emit('Connected',0);if(closed)await closed;
        for(const e of Object.values(p.pending))clearTimeout(e.timer);
        fs.rmSync(root,{recursive:true,force:true});
    }
});
