'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),crypto=require('crypto');
const meshRoot=process.env.MESHCENTRAL_SOURCE || path.resolve(__dirname,'../../MeshCentral');
const binary=process.env.MESHAGENT_BINARY || path.join(meshRoot,'agents/meshagent_x86-64');
test('native MeshAgent loads the bundled modules and reads through the Python worker', {skip:process.platform!=='linux'||process.arch!=='x64'||!fs.existsSync(binary)},()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-native-'));
    try {
        const root=path.join(tmp,'root');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'apps.ver'),'test=1');fs.mkdirSync(path.join(root,'config'));
        fs.copyFileSync(binary,path.join(tmp,'meshagent'));fs.chmodSync(path.join(tmp,'meshagent'),0o700);
        // Substitute only network transport and the test root/UID. Randomness, module
        // loading, subprocess argv, streams, timers and JSON run in native MeshAgent.
        let helper=fs.readFileSync(path.join(__dirname,'../helper/omniosfiles.py'),'utf8');
        helper=helper.replace("if __name__ == '__main__':\n    main()",'');
        helper+='\nimport types\nOriginal=Worker\nWorker=lambda ignored: Original('+JSON.stringify(root)+')\npwd.getpwnam=lambda name: types.SimpleNamespace(pw_uid=os.geteuid())\ngrp.getgrnam=lambda name: types.SimpleNamespace(gr_gid=os.getegid())\nmain()\n';
        let script='';
        for(const name of ['omniosfiles-auth','omniosfiles'])script+='addModule('+JSON.stringify(name)+','+JSON.stringify(fs.readFileSync(path.join(__dirname,'../modules_meshcore',name+'.js'),'utf8'))+');\n';
        script+='addModule("omniosfiles-helper",'+JSON.stringify('module.exports = '+JSON.stringify(helper)+';')+');\n';
        const transport="module.exports={on:function(){},SendCommand:function(cmd){if(cmd.pluginaction==='authorize'){this.timer=setTimeout(function(){require('omniosfiles').consoleaction({pluginaction:'approve',requestId:cmd.requestId,challenge:cmd.challenge,allowed:true});},100);}else if(cmd.pluginaction==='response'){console.log('NATIVE_RESULT:'+JSON.stringify(cmd.result));process.exit();}else if(cmd.pluginaction==='agentError'){console.log('NATIVE_ERROR:'+cmd.error);process.exit(1);}}};";
        script+='addModule("MeshAgent",'+JSON.stringify(transport)+');\n';
        const payload={protocol:2,action:'listDir',args:{path:'/'},transferId:null,policy:{maxFileSize:104857600,chunkSize:16384,maxConcurrentTransfers:3,filterMode:'blacklist',allowedExtensions:[],blockedExtensions:[]}};
        script+='require("omniosfiles").consoleaction('+JSON.stringify({pluginaction:'propose',requestId:'a'.repeat(48),payload:JSON.stringify(payload)})+');\nsetTimeout(function(){console.log("NATIVE_TIMEOUT");process.exit(2);},5000);\n';
        fs.writeFileSync(path.join(tmp,'test.js'),script);
        const output=cp.execFileSync(path.join(tmp,'meshagent'),['test.js'],{cwd:tmp,timeout:8000,encoding:'utf8'});
        const line=output.split('\n').find(l=>l.startsWith('NATIVE_RESULT:'));assert.ok(line,output);
        const result=JSON.parse(line.slice('NATIVE_RESULT:'.length));assert.equal(result.type,'listDirResult',output);
        assert.deepEqual(result.items.map(i=>i.name),['config','apps.ver']);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
test('native MeshAgent writes a full-size chunk to the Python worker without truncating it', {skip:process.platform!=='linux'||process.arch!=='x64'||!fs.existsSync(binary)},()=>{
    // Regression test for a real-device failure: a single stdin write of a full CHUNK-sized
    // uploadChunk line (base64 + JSON framing) was silently truncated by native MeshAgent's
    // child_process implementation once it crossed roughly a pipe's default 64 KiB buffer,
    // leaving the Python worker's readline() blocked forever on an incomplete line and the
    // agent's own 25s command timeout the only thing that ever fired -- confirmed directly: this
    // same harness with CHUNK forced back to 65536 reproduces the exact production error
    // ("Transfer aborted safely..."), and with the real, current CHUNK it completes normally.
    // Reads CHUNK from the actual helper source, not a copy, so bumping it back toward 64 KiB
    // without re-verifying against the real binary fails this test instead of shipping silently.
    // Exercises the exact execute()/worker.stdin.write() path end to end with real chunk-sized
    // data, through the real native binary -- Node.js's own child_process implementation never
    // showed this problem in any local test, which is why it went unnoticed until a real device.
    const helperSource=fs.readFileSync(path.join(__dirname,'../helper/omniosfiles.py'),'utf8');
    const chunkSize=Number(helperSource.match(/^CHUNK = (\d+)$/m)[1]);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-native-'));
    try {
        const root=path.join(tmp,'root');fs.mkdirSync(root);
        fs.copyFileSync(binary,path.join(tmp,'meshagent'));fs.chmodSync(path.join(tmp,'meshagent'),0o700);
        let helper=helperSource.replace("if __name__ == '__main__':\n    main()",'');
        helper+='\nimport types\nOriginal=Worker\nWorker=lambda ignored: Original('+JSON.stringify(root)+')\npwd.getpwnam=lambda name: types.SimpleNamespace(pw_uid=os.geteuid())\ngrp.getgrnam=lambda name: types.SimpleNamespace(gr_gid=os.getegid())\nmain()\n';
        let script='';
        for(const name of ['omniosfiles-auth','omniosfiles'])script+='addModule('+JSON.stringify(name)+','+JSON.stringify(fs.readFileSync(path.join(__dirname,'../modules_meshcore',name+'.js'),'utf8'))+');\n';
        script+='addModule("omniosfiles-helper",'+JSON.stringify('module.exports = '+JSON.stringify(helper)+';')+');\n';
        const policy={maxFileSize:104857600,chunkSize,maxConcurrentTransfers:3,filterMode:'blacklist',allowedExtensions:[],blockedExtensions:[]};
        const transferId='f'.repeat(48);
        const chunk=crypto.randomBytes(chunkSize);
        const checksum=crypto.createHash('sha256').update(chunk).digest('hex');
        const steps=[
            {requestId:'1'.repeat(48),payload:JSON.stringify({protocol:2,action:'startUpload',args:{path:'/test.bin',totalSize:chunk.length},transferId,policy})},
            {requestId:'2'.repeat(48),payload:JSON.stringify({protocol:2,action:'uploadChunk',args:{chunkIndex:0,data:chunk.toString('base64')},transferId,policy})},
            {requestId:'3'.repeat(48),payload:JSON.stringify({protocol:2,action:'finishUpload',args:{checksum},transferId,policy})}
        ];
        // This transport module intentionally mirrors the pattern above exactly, including
        // holding the authorize timer as `this.timer`: an unreferenced setTimeout() here was
        // observed to simply never fire on the real native runtime, unrelated to this test's
        // actual subject -- worth remembering for any future script driving this binary.
        const transport="var STEPS="+JSON.stringify(steps)+";var stepIndex=0;"
            +"module.exports={on:function(){},start:function(){require('omniosfiles').consoleaction({pluginaction:'propose',requestId:STEPS[0].requestId,payload:STEPS[0].payload});},SendCommand:function(cmd){"
            +"if(cmd.pluginaction==='authorize'){this.timer=setTimeout(function(){require('omniosfiles').consoleaction({pluginaction:'approve',requestId:cmd.requestId,challenge:cmd.challenge,allowed:true});},50);}"
            +"else if(cmd.pluginaction==='response'){stepIndex++;if(stepIndex<STEPS.length){var s=STEPS[stepIndex];require('omniosfiles').consoleaction({pluginaction:'propose',requestId:s.requestId,payload:s.payload});}else{console.log('NATIVE_RESULT:'+JSON.stringify(cmd.result));process.exit();}}"
            +"else if(cmd.pluginaction==='agentError'){console.log('NATIVE_ERROR:'+cmd.error+' at step '+stepIndex);process.exit(1);}"
            +"}};";
        script+='addModule("MeshAgent",'+JSON.stringify(transport)+');\n';
        script+='require("MeshAgent").start();\nsetTimeout(function(){console.log("NATIVE_TIMEOUT");process.exit(2);},30000);\n';
        fs.writeFileSync(path.join(tmp,'test.js'),script);
        const output=cp.execFileSync(path.join(tmp,'meshagent'),['test.js'],{cwd:tmp,timeout:35000,encoding:'utf8'});
        const line=output.split('\n').find(l=>l.startsWith('NATIVE_RESULT:'));assert.ok(line,output);
        const result=JSON.parse(line.slice('NATIVE_RESULT:'.length));
        assert.equal(result.type,'uploadComplete',output);
        assert.equal(result.checksum,checksum);
        assert.deepEqual(fs.readFileSync(path.join(root,'test.bin')),chunk);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
for (const marker of [0,123,42]) test('native MeshAgent de-escapes tunnel marker '+marker, {skip:process.platform!=='linux'||process.arch!=='x64'||!fs.existsSync(binary)},()=>{
    // Regression test for a real-device failure seen after the chunk-size fix above: uploads
    // worked for several chunks, then failed with the Python worker's genuine
    // "Only base64 data is allowed" (binascii.Error), specifically once a chunk's first content
    // byte happened to be 0x00 or 0x7B and needed the leading-0x00 escape byte stripped. A plain
    // `data.subarray(1)` view passed straight to .toString('base64') encoded corrupted bytes on
    // the real native runtime, even though the same call on a full, unsliced chunk (the common
    // case, and everything tests/native-runtime.test.js above already covers) worked fine. Every
    // chunk exercised here forces that first byte to 0x00, so this exercises the tunnel's
    // bindTransfer -> onTunnelChunk -> execute() path with the exact byte pattern that failed.
    const helperSource=fs.readFileSync(path.join(__dirname,'../helper/omniosfiles.py'),'utf8');
    const chunkSize=Number(helperSource.match(/^CHUNK = (\d+)$/m)[1]);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-native-'));
    try {
        const root=path.join(tmp,'root');fs.mkdirSync(root);
        fs.copyFileSync(binary,path.join(tmp,'meshagent'));fs.chmodSync(path.join(tmp,'meshagent'),0o700);
        let helper=helperSource.replace("if __name__ == '__main__':\n    main()",'');
        helper+='\nimport types\nOriginal=Worker\nWorker=lambda ignored: Original('+JSON.stringify(root)+')\npwd.getpwnam=lambda name: types.SimpleNamespace(pw_uid=os.geteuid())\ngrp.getgrnam=lambda name: types.SimpleNamespace(gr_gid=os.getegid())\nmain()\n';
        let script='';
        for(const name of ['omniosfiles-auth','omniosfiles'])script+='addModule('+JSON.stringify(name)+','+JSON.stringify(fs.readFileSync(path.join(__dirname,'../modules_meshcore',name+'.js'),'utf8'))+');\n';
        script+='addModule("omniosfiles-helper",'+JSON.stringify('module.exports = '+JSON.stringify(helper)+';')+');\n';
        const policy={maxFileSize:104857600,chunkSize,maxConcurrentTransfers:3,filterMode:'blacklist',allowedExtensions:[],blockedExtensions:[]};
        const transferId='9'.repeat(48);
        const original=crypto.randomBytes(chunkSize);original[0]=marker; // force the escape path
        const escaped=marker===42?original:Buffer.concat([Buffer.from([0]),original]);
        const checksum=crypto.createHash('sha256').update(original).digest('hex');
        const vars={transferId,policy,originalLength:original.length,escapedB64:escaped.toString('base64'),checksum};
        const transport="var V="+JSON.stringify(vars)+";var finished=false;"
            +"var fakeTunnel={data:null,write:function(buf){if(finished)return;"
            +"var msg;try{msg=JSON.parse(buf.toString());}catch(e){console.log('NATIVE_ERROR:non-json tunnel write');process.exit(1);return;}"
            +"if(msg.pluginaction==='bound'){fakeTunnel.data(Buffer.from(V.escapedB64,'base64'));}"
            +"else if(msg.pluginaction==='chunkAck'){require('omniosfiles').consoleaction({pluginaction:'propose',requestId:'3'.repeat(48),payload:JSON.stringify({protocol:2,action:'finishUpload',args:{checksum:V.checksum},transferId:V.transferId,policy:V.policy})});}"
            +"else{console.log('NATIVE_ERROR:'+(msg.error||msg.pluginaction));process.exit(1);}"
            +"}};"
            +"module.exports={on:function(){},"
            +"start:function(){require('omniosfiles').consoleaction({pluginaction:'propose',requestId:'1'.repeat(48),payload:JSON.stringify({protocol:2,action:'startUpload',args:{path:'/test.bin',totalSize:V.originalLength},transferId:V.transferId,policy:V.policy})});},"
            +"SendCommand:function(cmd){"
            +"if(cmd.pluginaction==='authorize'){this.timer=setTimeout(function(){require('omniosfiles').consoleaction({pluginaction:'approve',requestId:cmd.requestId,challenge:cmd.challenge,allowed:true});},50);}"
            +"else if(cmd.pluginaction==='response'){"
            +"if(cmd.result&&cmd.result.type==='uploadReady'){require('omniosfiles').consoleaction({pluginaction:'bindTransfer',transferId:V.transferId},null,null,fakeTunnel);}"
            +"else if(cmd.result&&cmd.result.type==='uploadComplete'){finished=true;console.log('NATIVE_RESULT:'+JSON.stringify(cmd.result));process.exit();}"
            +"else{console.log('NATIVE_ERROR:unexpected response '+JSON.stringify(cmd.result));process.exit(1);}"
            +"}"
            +"else if(cmd.pluginaction==='agentError'){console.log('NATIVE_ERROR:'+cmd.error);process.exit(1);}"
            +"}};";
        script+='addModule("MeshAgent",'+JSON.stringify(transport)+');\n';
        script+='require("MeshAgent").start();\nsetTimeout(function(){console.log("NATIVE_TIMEOUT");process.exit(2);},15000);\n';
        fs.writeFileSync(path.join(tmp,'test.js'),script);
        const run=cp.spawnSync(path.join(tmp,'meshagent'),['test.js'],{cwd:tmp,timeout:20000,encoding:'utf8'});
        const output=run.stdout;assert.equal(run.status,0,output+'\n'+run.stderr);
        const line=output.split('\n').find(l=>l.startsWith('NATIVE_RESULT:'));assert.ok(line,output);
        const result=JSON.parse(line.slice('NATIVE_RESULT:'.length));
        assert.equal(result.type,'uploadComplete',output);
        assert.equal(result.checksum,checksum);
        assert.deepEqual(fs.readFileSync(path.join(root,'test.bin')),original);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('native MeshAgent escapes download markers and preserves an ordinary and short final chunk', {skip:process.platform!=='linux'||process.arch!=='x64'||!fs.existsSync(binary)},()=>{
    const helperSource=fs.readFileSync(path.join(__dirname,'../helper/omniosfiles.py'),'utf8');
    const chunkSize=Number(helperSource.match(/^CHUNK = (\d+)$/m)[1]);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-native-download-'));
    try {
        const root=path.join(tmp,'root');fs.mkdirSync(root);
        const original=crypto.randomBytes(chunkSize*3+1);
        original[0]=0;original[chunkSize]=123;original[chunkSize*2]=42;original[chunkSize*3]=0;
        fs.writeFileSync(path.join(root,'test.bin'),original);
        fs.copyFileSync(binary,path.join(tmp,'meshagent'));fs.chmodSync(path.join(tmp,'meshagent'),0o700);
        let helper=helperSource.replace("if __name__ == '__main__':\n    main()",'');
        helper+='\nimport types\nOriginal=Worker\nWorker=lambda ignored: Original('+JSON.stringify(root)+')\npwd.getpwnam=lambda name: types.SimpleNamespace(pw_uid=os.geteuid())\ngrp.getgrnam=lambda name: types.SimpleNamespace(gr_gid=os.getegid())\nmain()\n';
        let script='';
        for(const name of ['omniosfiles-auth','omniosfiles'])script+='addModule('+JSON.stringify(name)+','+JSON.stringify(fs.readFileSync(path.join(__dirname,'../modules_meshcore',name+'.js'),'utf8'))+');\n';
        script+='addModule("omniosfiles-helper",'+JSON.stringify('module.exports = '+JSON.stringify(helper)+';')+');\n';
        const checksum=crypto.createHash('sha256').update(original).digest('hex');
        const vars={transferId:'d'.repeat(48),checksum,policy:{maxFileSize:104857600,chunkSize,maxConcurrentTransfers:3,filterMode:'blacklist',allowedExtensions:[],blockedExtensions:[]}};
        const transport="var V="+JSON.stringify(vars)+";var frames=0,finished=false;"
            +"function request(action,args,id){require('omniosfiles').consoleaction({pluginaction:'propose',requestId:id,payload:JSON.stringify({protocol:2,action:action,args:args,transferId:V.transferId,policy:V.policy})});}"
            +"var tunnel={write:function(buf){if(finished)return;if(buf[0]===123){var m=JSON.parse(buf.toString());if(m.pluginaction!=='bound'){console.log('NATIVE_ERROR:'+JSON.stringify(m));process.exit(1);}return;}"
            +"console.log('NATIVE_FRAME:'+buf.toString('base64'));frames++;if(frames===4)request('finishDownload',{checksum:V.checksum},'2'.repeat(48));}};"
            +"module.exports={on:function(){},start:function(){request('startDownload',{path:'/test.bin'},'1'.repeat(48));},SendCommand:function(cmd){"
            +"if(cmd.pluginaction==='authorize'){this.timer=setTimeout(function(){require('omniosfiles').consoleaction({pluginaction:'approve',requestId:cmd.requestId,challenge:cmd.challenge,allowed:true});},50);}"
            +"else if(cmd.pluginaction==='response'){if(cmd.result.type==='downloadStart'){require('omniosfiles').consoleaction({pluginaction:'bindTransfer',transferId:V.transferId},null,null,tunnel);}"
            +"else if(cmd.result.type==='downloadComplete'){finished=true;console.log('NATIVE_RESULT:'+JSON.stringify(cmd.result));process.exit();}else{console.log('NATIVE_ERROR:'+JSON.stringify(cmd.result));process.exit(1);}}"
            +"else if(cmd.pluginaction==='agentError'){console.log('NATIVE_ERROR:'+cmd.error);process.exit(1);}}};";
        script+='addModule("MeshAgent",'+JSON.stringify(transport)+');\n';
        script+='require("MeshAgent").start();\nsetTimeout(function(){console.log("NATIVE_TIMEOUT");process.exit(2);},15000);\n';
        fs.writeFileSync(path.join(tmp,'test.js'),script);
        const run=cp.spawnSync(path.join(tmp,'meshagent'),['test.js'],{cwd:tmp,timeout:20000,encoding:'utf8'});
        assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
        const frames=run.stdout.split('\n').filter(l=>l.startsWith('NATIVE_FRAME:')).map(l=>Buffer.from(l.slice(13),'base64'));
        assert.equal(frames.length,4);
        assert.deepEqual(frames.map(b=>b.length),[chunkSize+1,chunkSize+1,chunkSize,2]);
        assert.deepEqual(frames.map(b=>b[0]),[0,0,42,0]);
        // Decoding occurs in Node, independently from the agent's Buffer implementation.
        const decoded=Buffer.concat(frames.map(b=>b[0]===0?b.subarray(1):b));
        assert.deepEqual(decoded,original);
        const result=JSON.parse(run.stdout.split('\n').find(l=>l.startsWith('NATIVE_RESULT:')).slice(14));
        assert.equal(result.type,'downloadComplete');assert.equal(result.checksum,checksum);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('native MeshAgent uploads 13 MiB with an eight-chunk tunnel window', {skip:process.platform!=='linux'||process.arch!=='x64'||!fs.existsSync(binary)},()=>{
    // Exercise repeated tunnel frames with the browser's eight-chunk window,
    // cycling escaped and ordinary first bytes and ending with a short chunk.
    const helperSource=fs.readFileSync(path.join(__dirname,'../helper/omniosfiles.py'),'utf8');
    const chunkSize=Number(helperSource.match(/^CHUNK = (\d+)$/m)[1]);
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-native-'));
    try {
        const root=path.join(tmp,'root');fs.mkdirSync(root);
        fs.copyFileSync(binary,path.join(tmp,'meshagent'));fs.chmodSync(path.join(tmp,'meshagent'),0o700);
        let helper=helperSource.replace("if __name__ == '__main__':\n    main()",'');
        helper+='\nimport types\nOriginal=Worker\nWorker=lambda ignored: Original('+JSON.stringify(root)+')\npwd.getpwnam=lambda name: types.SimpleNamespace(pw_uid=os.geteuid())\ngrp.getgrnam=lambda name: types.SimpleNamespace(gr_gid=os.getegid())\nmain()\n';
        let script='';
        for(const name of ['omniosfiles-auth','omniosfiles'])script+='addModule('+JSON.stringify(name)+','+JSON.stringify(fs.readFileSync(path.join(__dirname,'../modules_meshcore',name+'.js'),'utf8'))+');\n';
        script+='addModule("omniosfiles-helper",'+JSON.stringify('module.exports = '+JSON.stringify(helper)+';')+');\n';
        const policy={maxFileSize:104857600,chunkSize,maxConcurrentTransfers:3,filterMode:'blacklist',allowedExtensions:[],blockedExtensions:[]};
        const transferId='9'.repeat(48);
        const patterns=[0,123,42].map(marker=>{const bytes=crypto.randomBytes(chunkSize);bytes[0]=marker;return bytes;});
        const tail=Buffer.alloc(37,7);tail[0]=0;
        const blocks=833;
        const original=Buffer.concat(Array.from({length:blocks},(_,i)=>i===blocks-1?tail:patterns[i%3]));
        const escapedFrames=patterns.concat([tail]).map(bytes=>((bytes[0]===0||bytes[0]===123)?Buffer.concat([Buffer.alloc(1),bytes]):bytes).toString('base64'));
        const checksum=crypto.createHash('sha256').update(original).digest('hex');
        const vars={transferId,policy,originalLength:original.length,escapedFrames,blocks,checksum};
        const core=fs.readFileSync(path.join(meshRoot,'agents/meshcore.js'),'utf8');
        const coreStart=core.indexOf('function onTunnelControlData(data, ws)');
        assert.ok(coreStart>=0);
        const coreHandler=core.slice(coreStart,core.indexOf('\n}',coreStart)+2);

        const transport=coreHandler+";var controlReplies=0;var V="+JSON.stringify(vars)+";var finished=false,sent=0,acked=0;function sendFrame(){var index=sent===V.blocks-1?3:sent%3;sent++;if(sent%16===0){fakeTunnel.data(JSON.stringify({ctrlChannel:102938,type:'rtt',time:1789243648688}));fakeTunnel.data(JSON.stringify({ctrlChannel:'102938',type:'ping'}));}var frame=Buffer.from(V.escapedFrames[index],'base64');fakeTunnel.data(frame);for(var i=0;i<frame.length;i++)frame[i]=255;}"
            +"var fakeTunnel={data:function(data){onTunnelControlData(data,this);},write:function(buf){if(finished)return;if(typeof buf==='object'&&buf.type==='rtt'){controlReplies++;return;}"
            +"var msg;try{msg=JSON.parse(buf.toString());}catch(e){console.log('NATIVE_ERROR:non-json tunnel write');process.exit(1);return;}"
            +"if(msg.ctrlChannel=='102938'&&msg.type==='pong'){controlReplies++;return;}if(msg.pluginaction==='bound'){while(sent<8)sendFrame();}"
            +"else if(msg.pluginaction==='chunkAck'){acked++;if(acked!==V.blocks){if(sent<V.blocks)sendFrame();return;}require('omniosfiles').consoleaction({pluginaction:'propose',requestId:'3'.repeat(48),payload:JSON.stringify({protocol:2,action:'finishUpload',args:{checksum:V.checksum},transferId:V.transferId,policy:V.policy})});}"
            +"else{console.log('NATIVE_ERROR:'+(msg.error||msg.pluginaction));process.exit(1);}"
            +"}};"
            +"module.exports={on:function(){},"
            +"start:function(){require('omniosfiles').consoleaction({pluginaction:'propose',requestId:'1'.repeat(48),payload:JSON.stringify({protocol:2,action:'startUpload',args:{path:'/test.bin',totalSize:V.originalLength},transferId:V.transferId,policy:V.policy})});},"
            +"SendCommand:function(cmd){"
            +"if(cmd.pluginaction==='authorize'){this.timer=setTimeout(function(){require('omniosfiles').consoleaction({pluginaction:'approve',requestId:cmd.requestId,challenge:cmd.challenge,allowed:true});},50);}"
            +"else if(cmd.pluginaction==='response'){"
            +"if(cmd.result&&cmd.result.type==='uploadReady'){require('omniosfiles').consoleaction({pluginaction:'bindTransfer',transferId:V.transferId},null,null,fakeTunnel);}"
            +"else if(cmd.result&&cmd.result.type==='uploadComplete'){if(controlReplies!==104){console.log('NATIVE_ERROR:missing control replies '+controlReplies);process.exit(1);return;}finished=true;console.log('NATIVE_RESULT:'+JSON.stringify(cmd.result));process.exit();}"
            +"else{console.log('NATIVE_ERROR:unexpected response '+JSON.stringify(cmd.result));process.exit(1);}"
            +"}"
            +"else if(cmd.pluginaction==='agentError'){console.log('NATIVE_ERROR:'+cmd.error);process.exit(1);}"
            +"}};";
        script+='addModule("MeshAgent",'+JSON.stringify(transport)+');\n';
        script+='require("MeshAgent").start();\nsetTimeout(function(){console.log("NATIVE_TIMEOUT");process.exit(2);},60000);\n';
        fs.writeFileSync(path.join(tmp,'test.js'),script);
        const run=cp.spawnSync(path.join(tmp,'meshagent'),['test.js'],{cwd:tmp,timeout:65000,encoding:'utf8'});
        const output=run.stdout;assert.equal(run.status,0,output+'\n'+run.stderr);
        const line=output.split('\n').find(l=>l.startsWith('NATIVE_RESULT:'));assert.ok(line,output);
        const result=JSON.parse(line.slice('NATIVE_RESULT:'.length));
        assert.equal(result.type,'uploadComplete',output);
        assert.equal(result.checksum,checksum);
        assert.deepEqual(fs.readFileSync(path.join(root,'test.bin')),original);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
