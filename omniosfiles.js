'use strict';
module.exports.omniosfiles = function (parent) {
    var obj = {};
    var service = require('./server').create(parent, require('./server').settings(require('./config.json').settings));
    obj.serveraction = service.serveraction;
    obj.exports = ['onDeviceRefreshEnd', 'result', 'request', 'render', 'navigate', 'mutate', 'upload', 'download', 'uploadNext', 'downloadNext', 'finish', 'cancel', 'status', 'hash'];
    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) return;
        var p = pluginHandler.omniosfiles;
        p.nodes = p.nodes || {}; p.pending = p.pending || {}; p.transfers = p.transfers || {}; p.sequence = p.sequence || 0;
        var node = currentNode._id;
        var state = p.nodes[node] || (p.nodes[node] = {path: '/', items: [], status: '', caps: null});
        pluginHandler.registerPluginTab({tabId: 'omniosfiles', tabTitle: 'OmniOS Files'});
        p.render(node);
        if (!state.checking) {
            state.checking = true;
            p.request(node, 'capabilities', {}, function (data, error) {
                state.checking = false; state.caps = error ? null : data;
                if (error) p.status(node, error); else p.navigate(node, state.path);
                p.render(node);
            });
        }
    };
    obj.request = function (node, action, args, callback, id) {
        var p = pluginHandler.omniosfiles;
        id = id || ('b' + Date.now() + '-' + (++p.sequence));
        if (p.pending[id]) { callback(null, 'Request is already pending'); return; }
        var entry = {node: node, callback: callback};
        p.pending[id] = entry;
        entry.timer = setTimeout(function () {
            if (p.pending[id] !== entry) return;
            delete p.pending[id]; callback(null, 'Request timed out; device operation may still be running');
        }, 35000);
        try { meshserver.send(Object.assign({action: 'plugin', plugin: 'omniosfiles', pluginaction: action, nodeid: node, requestId: id, protocol: 2}, args)); }
        catch (e) { clearTimeout(entry.timer); delete p.pending[id]; callback(null, 'Connection failed'); }
        return id;
    };
    obj.result = function (server, message) {
        var p = pluginHandler.omniosfiles, entry = (p.pending || {})[message.requestId];
        if (message.protocol !== 2 || !entry || entry.node !== message.nodeid) return;
        clearTimeout(entry.timer); delete p.pending[message.requestId];
        entry.callback(message.data, message.error || (message.data && message.data.error));
    };
    obj.status = function (node, text) {
        var p = pluginHandler.omniosfiles;
        if (p.nodes[node]) p.nodes[node].status = text;
        p.render(node);
    };
    obj.navigate = function (node, path) {
        var p = pluginHandler.omniosfiles, state = p.nodes[node];
        var token = {}; state.listing = token;
        p.request(node, 'listDir', {path: path}, function (data, error) {
            if (state.listing !== token) return;
            state.listing = null;
            if (error) { p.status(node, error); return; }
            state.path = data.path; state.items = data.items; p.render(node);
        });
    };
    obj.render = function (node) {
        if (typeof currentNode === 'undefined' || !currentNode || currentNode._id !== node) return;
        var p = pluginHandler.omniosfiles, state = p.nodes[node], host = document.getElementById('omniosfiles');
        if (!host || !state) return;
        host.textContent = '';
        function element(tag, text, parent) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; parent.appendChild(e); return e; }
        function button(label, fn, disabled, parent) { var b = element('button', label, parent); b.disabled = !!disabled; b.addEventListener('click', fn); b.style.margin = '4px'; return b; }
        var bar = element('div', undefined, host), caps = state.caps;
        var active = Object.keys(p.transfers).some(function (id) { return p.transfers[id].node === node; });
        button('Refresh', function () { p.onDeviceRefreshEnd(); }, false, bar);
        button('Upload', function () {
            var input = document.createElement('input'); input.type = 'file';
            input.addEventListener('change', function () { if (input.files[0]) p.upload(node, state.path, input.files[0]); }); input.click();
        }, !caps || !caps.write || active, bar);
        button('New folder', function () { var name = prompt('Folder name:'); if (name && !/[\/\0]/.test(name) && name !== '.' && name !== '..') p.mutate(node, 'createDir', {path: (state.path === '/' ? '' : state.path) + '/' + name}); }, !caps || !caps.write || active, bar);
        element('div', '/var/nr' + (state.path === '/' ? '' : state.path), host);
        element('p', state.status || (caps ? 'Ready' : 'Checking access...'), host);
        Object.keys(p.transfers).forEach(function (id) {
            var t = p.transfers[id]; if (t.node !== node) return;
            var row = element('div', t.name + ': ' + t.offset + ' / ' + t.total + ' bytes' + (t.cancelling ? ' (cancelling)' : ''), host);
            button('Cancel', function () { p.cancel(id); }, t.cancelling, row);
        });
        if (!caps) return;
        if (state.path !== '/') button('Parent directory', function () { p.navigate(node, state.path.replace(/\/[^/]+\/?$/, '') || '/'); }, false, host);
        var table = element('table', undefined, host); table.style.width = '100%';
        state.items.forEach(function (item) {
            var row = element('tr', undefined, table);
            var cell = element('td', undefined, row);
            if (item.isDirectory && item.supported) button(item.name + '/', function () { p.navigate(node, item.path); }, false, cell);
            else element('span', item.name + (item.isLink ? ' (symlink)' : !item.supported ? ' (unsupported)' : ''), cell);
            element('td', item.isDirectory ? '' : String(item.size) + ' bytes', row);
            element('td', new Date(item.mtime).toLocaleString(), row);
            var ops = element('td', undefined, row);
            if (!item.isDirectory) button('Download', function () { p.download(node, item); }, active || !item.supported, ops);
            button('Rename', function () {
                var name = prompt('New name:', item.name);
                if (name && !/[\/\0]/.test(name) && name !== '.' && name !== '..') p.mutate(node, 'rename', {srcPath: item.path, dstPath: item.path.replace(/[^/]+$/, '') + name});
            }, !caps.write || active || !item.supported, ops);
            button('Delete', function () { if (confirm('Delete ' + item.name + (item.isDirectory ? ' and its contents?' : '?'))) p.mutate(node, 'delete', {path: item.path}); }, !caps.write || active || !item.supported, ops);
        });
        if (!state.items.length) element('p', 'Directory is empty', host);
    };
    obj.mutate = function (node, action, args) {
        var p = pluginHandler.omniosfiles;
        p.request(node, action, args, function (data, error) { p.status(node, error || 'Operation completed'); if (!error) p.navigate(node, p.nodes[node].path); });
    };
    obj.upload = function (node, path, file) {
        var p = pluginHandler.omniosfiles, caps = p.nodes[node].caps;
        if (!caps || !caps.write || file.size > caps.maxFileSize) { p.status(node, 'Access denied or file exceeds the qualified size limit'); return; }
        var id = 'u' + Date.now() + '-' + (++p.sequence);
        var t = {id: id, node: node, name: file.name, file: file, upload: true, total: file.size, offset: 0, index: 0, hash: p.hash(), path: path};
        p.transfers[id] = t;
        p.request(node, 'startUpload', {path: (path === '/' ? '' : path) + '/' + file.name, totalSize: file.size}, function (data, error) {
            if (error) { p.finish(t, error); return; }
            t.started = true; p.uploadNext(t);
        }, id);
        p.render(node);
    };
    obj.uploadNext = function (t) {
        var p = pluginHandler.omniosfiles;
        if (p.transfers[t.id] !== t) return;
        if (t.cancelling) { p.cancel(t.id); return; }
        if (t.offset === t.total) {
            p.request(t.node, 'finishUpload', {checksum: t.hash.digest()}, function (data, error) { p.finish(t, error); }, t.id); return;
        }
        var reader = new FileReader(); t.reader = reader;
        reader.onerror = function () { p.finish(t, 'Cannot read local file'); };
        reader.onload = function () {
            t.reader = null;
            if (p.transfers[t.id] !== t) return;
            if (t.cancelling) { p.cancel(t.id); return; }
            var bytes = new Uint8Array(reader.result), text = '';
            for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
            t.hash.update(bytes);
            p.request(t.node, 'uploadChunk', {chunkIndex: t.index, data: btoa(text)}, function (data, error) {
                if (error) { p.finish(t, error); return; }
                if (data.chunkIndex !== t.index || data.receivedBytes !== t.offset + bytes.length) { p.finish(t, 'Invalid upload acknowledgment'); return; }
                t.offset += bytes.length; t.index++; p.render(t.node); p.uploadNext(t);
            }, t.id);
        };
        reader.readAsArrayBuffer(t.file.slice(t.offset, Math.min(t.offset + 65536, t.total)));
    };
    obj.download = function (node, item) {
        var p = pluginHandler.omniosfiles, caps = p.nodes[node].caps;
        if (!caps || item.size > caps.maxFileSize) { p.status(node, 'File exceeds the qualified size limit'); return; }
        var t = {id: 'd' + Date.now() + '-' + (++p.sequence), node: node, name: item.name, upload: false, total: item.size, offset: 0, index: 0, hash: p.hash(), chunks: []};
        p.transfers[t.id] = t;
        function begin() {
            if (p.transfers[t.id] !== t) { if (t.writer) t.writer.abort().catch(function () {}); return; }
            p.request(node, 'startDownload', {path: item.path}, function (data, error) {
                if (error) { p.finish(t, error); return; }
                t.started = true;
                if (!Number.isSafeInteger(data.totalSize) || data.totalSize < 0 || data.totalSize > caps.maxFileSize) { p.finish(t, 'Invalid file size'); return; }
                t.total = data.totalSize; p.downloadNext(t);
            }, t.id);
        }
        // Request the picker synchronously during the user's click gesture.
        if (typeof window.showSaveFilePicker === 'function') {
            window.showSaveFilePicker({suggestedName: item.name}).then(function (handle) { return handle.createWritable(); }).then(function (writer) { t.writer = writer; begin(); }).catch(function (error) { p.finish(t, 'Download was not started: ' + error.message); });
        } else begin();
        p.render(node);
    };
    obj.downloadNext = function (t) {
        var p = pluginHandler.omniosfiles;
        if (p.transfers[t.id] !== t) return;
        if (t.cancelling) { p.cancel(t.id); return; }
        if (t.offset === t.total) {
            p.request(t.node, 'finishDownload', {checksum: t.hash.digest()}, function (data, error) {
                if (error) { p.finish(t, error); return; }
                if (t.writer) t.writer.close().then(function () { t.writer = null; p.finish(t); }).catch(function () { p.finish(t, 'Cannot save download'); });
                else {
                    var url = URL.createObjectURL(new Blob(t.chunks, {type: 'application/octet-stream'}));
                    var a = document.createElement('a'); a.href = url; a.download = t.name; document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(function () { URL.revokeObjectURL(url); }, 1000); p.finish(t);
                }
            }, t.id); return;
        }
        p.request(t.node, 'requestChunk', {chunkIndex: t.index}, function (data, error) {
            if (error) { p.finish(t, error); return; }
            try {
                var text = atob(data.data), bytes = new Uint8Array(text.length);
                if (data.chunkIndex !== t.index || text.length !== Math.min(65536, t.total - t.offset)) throw Error('Invalid download chunk');
                for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
                t.hash.update(bytes);
                var save = t.writer ? t.writer.write(bytes) : Promise.resolve(t.chunks.push(bytes));
                save.then(function () { t.offset += bytes.length; t.index++; p.render(t.node); p.downloadNext(t); }).catch(function () { p.finish(t, 'Cannot write download'); });
            } catch (e) { p.finish(t, e.message); }
        }, t.id);
    };
    obj.finish = function (t, error) {
        var p = pluginHandler.omniosfiles;
        if (p.transfers[t.id] !== t) return;
        delete p.transfers[t.id];
        if (t.writer) t.writer.abort().catch(function () {});
        if (error && t.started && !p.pending[t.id]) p.request(t.node, 'cancel', {}, function () {}, t.id);
        p.status(t.node, error || 'Completed: ' + t.name);
        if (!error && t.upload) p.navigate(t.node, t.path);
    };
    obj.cancel = function (id) {
        var p = pluginHandler.omniosfiles, t = p.transfers[id];
        if (!t) return;
        t.cancelling = true; p.render(t.node);
        if (p.pending[id] || t.reader) return;
        if (!t.started) { p.finish(t, 'Cancelled before transfer'); return; }
        p.request(t.node, 'cancel', {}, function (data, error) { t.started = false; p.finish(t, error || 'Cancelled'); }, id);
    };
    obj.hash = function () {
        // Incremental SHA-256; holds one 64-byte block regardless of file size.
        var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        var k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        var block = new Uint8Array(64), used = 0, length = 0, final = null;
        function r(x,n) { return (x >>> n) | (x << (32-n)); }
        function compress() {
            var w = new Int32Array(64), i;
            for (i=0;i<16;i++) w[i]=(block[i*4]<<24)|(block[i*4+1]<<16)|(block[i*4+2]<<8)|block[i*4+3];
            for (i=16;i<64;i++) { var x=w[i-15],y=w[i-2]; w[i]=(w[i-16]+(r(x,7)^r(x,18)^(x>>>3))+w[i-7]+(r(y,17)^r(y,19)^(y>>>10)))|0; }
            var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],v=h[7];
            for (i=0;i<64;i++) { var t1=(v+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0; var t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0; v=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0; }
            var out=[a,b,c,d,e,f,g,v]; for(i=0;i<8;i++)h[i]=(h[i]+out[i])|0;
        }
        function push(byte) { block[used++]=byte; if(used===64){compress();used=0;} }
        return {update: function(bytes){if(final)throw Error('Hash already finalized');length+=bytes.length;for(var i=0;i<bytes.length;i++)push(bytes[i]);}, digest:function(){
            if(final)return final;var bits=length*8;push(128);while(used!==56)push(0);var high=Math.floor(bits/4294967296),low=bits>>>0;
            for(var n=24;n>=0;n-=8)push((high>>>n)&255);for(n=24;n>=0;n-=8)push((low>>>n)&255);
            final=h.map(function(x){return ('00000000'+(x>>>0).toString(16)).slice(-8);}).join('');return final;
        }};
    };
    return obj;
};
