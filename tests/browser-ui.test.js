'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const chrome=process.env.CHROME_BINARY || '/usr/bin/google-chrome';
test('Chromium checks dialog keyboard navigation, theme contrast and narrow paths', {skip:!fs.existsSync(chrome)||typeof WebSocket==='undefined',timeout:30000}, async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omniosfiles-ui-'));
    const source=require('../omniosfiles').omniosfiles({parent:{webserver:{}}});
    const code=source.exports.map(k=>'p.'+k+'='+source[k].toString()+';').join('\n');
    fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><meta charset="utf-8"><style>body{margin:16px}</style><button id="outside">Outside</button><div id="omniosfiles"></div><script>var currentNode={_id:"a"},p={},pluginHandler={omniosfiles:p};'+code+`;p.nodes={a:{path:'/',caps:{write:true},loaded:true,items:[{name:'file.txt',path:'/file.txt',size:10,mtime:0,supported:true}]}};p.pending={};p.transfers={};p.sequence=0;p.render('a');p.mutate=(...args)=>window.mutation=args;</script>`);
    const child=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+dir,'file://'+path.join(dir,'index.html')],{stdio:'ignore'});
    let socket;
    try {
        const portFile=path.join(dir,'DevToolsActivePort');
        for(let i=0;!fs.existsSync(portFile)&&i<100;i++)await new Promise(r=>setTimeout(r,50));
        const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
        const pages=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
        socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
        await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
        let id=0;const pending=new Map();
        socket.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}};
        const send=(method,params={})=>new Promise((r,j)=>{pending.set(++id,[r,j]);socket.send(JSON.stringify({id,method,params}));});
        const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
        const key=async(key,code,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text:key==='Enter'?'\r':undefined,windowsVirtualKeyCode:key==='Tab'?9:key==='Enter'?13:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
        for(let i=0;i<100&&!await evaluate('typeof p !== "undefined" && !!p.dialog');i++)await new Promise(r=>setTimeout(r,20));
        await evaluate(`document.querySelector('[title="Rename"]').focus();document.querySelector('[title="Rename"]').click()`);
        assert.equal(await evaluate('document.activeElement.id'),'of-dialog-name');
        await key('Tab','Tab');assert.equal(await evaluate('document.activeElement.textContent'),'Cancel');
        await key('Tab','Tab');assert.equal(await evaluate('document.activeElement.textContent'),'Save');
        await key('Tab','Tab',8);assert.equal(await evaluate('document.activeElement.textContent'),'Cancel');
        for(let i=0;i<5;i++) {await key('Tab','Tab');assert.equal(await evaluate('document.activeElement.id === "outside"'),false);}
        await key('Tab','Tab',8);assert.equal(await evaluate('document.activeElement.id === "outside"'),false);
        await key('Escape','Escape');
        assert.equal(await evaluate('document.querySelector("dialog") === null'),true);
        assert.equal(await evaluate('document.activeElement.title'),'Rename');
        await evaluate(`document.activeElement.click();document.querySelector('input').value='renamed.txt';document.querySelector('input').focus()`);
        await key('Enter','Enter');
        assert.deepEqual(await evaluate('window.mutation'),['a','rename',{srcPath:'/file.txt',dstPath:'/renamed.txt'}]);
        // Check text and focus colors against both normal and hover surfaces.
        for(const theme of ['','night']) {
            const ratios=await evaluate(`(()=>{document.body.className=${JSON.stringify(theme)};const s=getComputedStyle(document.getElementById('omniosfiles'));const rgb=c=>{const e=document.createElement('span');e.style.color=c;document.body.appendChild(e);const n=getComputedStyle(e).color.match(/[\\d.]+/g).slice(0,3).map(Number);e.remove();return n;};const lum=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const contrast=(a,b)=>{a=lum(s.getPropertyValue(a));b=lum(s.getPropertyValue(b));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};return ['--of-bg','--of-surface','--of-hover'].flatMap(bg=>['--of-text','--of-muted','--of-accent','--of-error'].map(fg=>({fg,bg,ratio:contrast(fg,bg)})));})()`);
            for(const r of ratios)assert.ok(r.ratio>=4.5,theme+' '+JSON.stringify(r));
        }
        await evaluate(`p.nodes.a.caps.write=false;p.render('a');document.querySelector('#omniosfiles-toolbar button').focus()`);
        await key('Tab','Tab');assert.equal(await evaluate('document.activeElement.textContent'),'/var/nr','Tab skips disabled upload/create buttons');
        await evaluate(`p.nodes.a.caps.write=true;p.render('a')`);
        await send('Emulation.setDeviceMetricsOverride',{width:500,height:720,deviceScaleFactor:1,mobile:false});
        await evaluate(`p.nodes.a.path='/'+ 'длинный'.repeat(30);p.nodes.a.items[0].name='Unicode <file> '+ 'я'.repeat(240);p.render('a')`);
        assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'page must not overflow horizontally');
        await evaluate(`document.querySelector('[title="Delete"]').focus()`);
        assert.equal(await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()`),true,'keyboard reveals scrolled actions');
        if (process.env.OMNIOSFILES_SCREENSHOTS) {
            const output=path.resolve(process.env.OMNIOSFILES_SCREENSHOTS);fs.mkdirSync(output,{recursive:true});
            for(const theme of ['light','night'])for(const state of ['list','empty','error','transfer','dialog']) {
                await evaluate(`document.body.className=${JSON.stringify(theme)};p.nodes.a.listError=null;p.transfers={};p.nodes.a.items=[{name:'Unicode <file> '+ 'я'.repeat(240),path:'/file.txt',size:10,mtime:0,supported:true}];`);
                if(state==='empty')await evaluate('p.nodes.a.items=[]');
                if(state==='error')await evaluate("p.nodes.a.listError='Device request timed out'");
                if(state==='transfer')await evaluate("p.transfers.u={node:'a',name:'test.bin',upload:true,total:100,offset:42}");
                await evaluate("p.render('a')");
                if(state==='dialog')await evaluate("p.dialog('a','rename',{name:'file.txt',path:'/file.txt'})");
                const shot=await send('Page.captureScreenshot',{format:'png'});
                fs.writeFileSync(path.join(output,theme+'-'+state+'.png'),Buffer.from(shot.data,'base64'));
                if(state==='dialog')await evaluate('p.openDialog.close()');
            }
        }

    } finally {
        if(socket)socket.close();child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
});
