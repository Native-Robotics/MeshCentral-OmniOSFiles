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
    const sandbox={module:{exports:{}},process:{platform:'linux'},Buffer,setTimeout,clearTimeout,require(name){
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
    // Fake CreateAgentRedirect: bridges the browser-side tunnel module straight to the real
    // agent module's protocol-7 entry point (bindTransfer), then to the real tunnel.data
    // handler it installs -- exercising the actual protocol 3 chunk tunnel end to end, same as
    // a real meshrelay.ashx byte-for-byte relay would, minus the network hop.
    ctx.serverPublicNamePort=null;ctx.authCookie='';ctx.authRelayCookie='';ctx.domainUrl='/';
    let tunnelOpens=0;
    ctx.CreateAgentRedirect=function(meshserverArg,module){
        tunnelOpens++;
        const agentTunnel={data:null,write(buf){const bytes=Buffer.isBuffer(buf)?buf:Buffer.from(buf);setTimeout(()=>module.ProcessBinaryData(new Uint8Array(bytes)),0);}};
        let bound=false;
        function toAgent(payload){
            const bytes=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
            if(!bound){
                let cmd;try{cmd=JSON.parse(bytes.toString('utf8'));}catch(e){return;}
                agentModule.consoleaction(cmd,null,null,agentTunnel);
                if(typeof agentTunnel.data==='function')bound=true;
                return;
            }
            agentTunnel.data(bytes);
        }
        return {
            Start(){setTimeout(()=>{module.xxStateChange(1);setTimeout(()=>{module.xxStateChange(2);setTimeout(()=>module.xxStateChange(3),0);},0);},0);},
            send(bytes){toAgent(bytes);},
            sendText(json){toAgent(typeof json==='string'?json:JSON.stringify(json));},
            Stop(){}
        };
    };
    for(const key of obj.exports)p[key]=vm.runInNewContext('('+obj[key].toString()+')',ctx);
    Object.assign(p,{nodes:{'node//test':{path:'/',caps:{write:true,maxFileSize:104857600},items:[]}},pending:{},transfers:{},sequence:0});
    p.render=()=>{};ctx.meshserver={send:m=>obj.serveraction(m,source)};
    try {
        const mutate = async (action,args) => {
            p.mutate('node//test',action,args);
            await waitFor(()=>Object.keys(p.pending).length===0);
            assert.equal(p.nodes['node//test'].operationError,null);
        };
        await mutate('createDir',{path:'/каталог'});
        assert.equal(fs.statSync(path.join(root,'каталог')).mode&0o777,0o775);
        await mutate('rename',{srcPath:'/каталог',dstPath:'/renamed'});
        assert.equal(fs.existsSync(path.join(root,'каталог')),false);
        assert.equal(fs.statSync(path.join(root,'renamed')).isDirectory(),true);
        const bytes=crypto.randomBytes(65537), file=new Blob([bytes]);file.name='test.bin';
        p.upload('node//test','/',file);
        await waitFor(()=>Object.keys(p.transfers).length===0);
        assert.match(p.nodes['node//test'].status,/Completed/);
        assert.deepEqual(fs.readFileSync(path.join(root,'test.bin')),bytes);
        assert.equal(tunnelOpens,1); // the upload actually went over the protocol 3 tunnel, not a silent RPC fallback
        p.download('node//test',{name:'test.bin',path:'/test.bin',size:bytes.length});
        await waitFor(()=>Object.keys(p.transfers).length===0);
        assert.match(p.nodes['node//test'].status,/Completed/);
        assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()),bytes);
        assert.equal(tunnelOpens,2); // ditto for the download
        await waitFor(()=>Object.keys(p.pending).length===0);
        assert.equal(fs.statSync(path.join(root,'test.bin')).mode&0o777,0o664);
        await mutate('rename',{srcPath:'/test.bin',dstPath:'/renamed/test.bin'});
        assert.deepEqual(fs.readFileSync(path.join(root,'renamed','test.bin')),bytes);
        await mutate('delete',{path:'/renamed'});
        assert.equal(fs.existsSync(path.join(root,'renamed')),false);
        assert.deepEqual(Array.from(p.nodes['node//test'].items),[]);
    } finally {
        const closed=child&&once(child,'close');mesh.emit('Connected',0);if(closed)await closed;
        for(const e of Object.values(p.pending))clearTimeout(e.timer);
        fs.rmSync(root,{recursive:true,force:true});
    }
});
