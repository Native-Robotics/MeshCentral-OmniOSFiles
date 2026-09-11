'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
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
        const payload={protocol:2,action:'listDir',args:{path:'/'},transferId:null,policy:{maxFileSize:104857600,chunkSize:65536,maxConcurrentTransfers:3,filterMode:'blacklist',allowedExtensions:[],blockedExtensions:[]}};
        script+='require("omniosfiles").consoleaction('+JSON.stringify({pluginaction:'propose',requestId:'a'.repeat(48),payload:JSON.stringify(payload)})+');\nsetTimeout(function(){console.log("NATIVE_TIMEOUT");process.exit(2);},5000);\n';
        fs.writeFileSync(path.join(tmp,'test.js'),script);
        const output=cp.execFileSync(path.join(tmp,'meshagent'),['test.js'],{cwd:tmp,timeout:8000,encoding:'utf8'});
        const line=output.split('\n').find(l=>l.startsWith('NATIVE_RESULT:'));assert.ok(line,output);
        const result=JSON.parse(line.slice('NATIVE_RESULT:'.length));assert.equal(result.type,'listDirResult',output);
        assert.deepEqual(result.items.map(i=>i.name),['config','apps.ver']);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
