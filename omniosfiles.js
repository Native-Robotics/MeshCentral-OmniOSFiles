'use strict';
module.exports.omniosfiles = function (parent) {
    var obj = {};
    var service = require('./server').create(parent, require('./server').settings(require('./config.json').settings));
    obj.serveraction = service.serveraction;
    obj.server_startup = service.server_startup;
    obj.exports = ['onDeviceRefreshEnd', 'result', 'request', 'render', 'navigate', 'mutate', 'upload', 'download', 'uploadNext', 'downloadNext', 'finish', 'cancel', 'status', 'formatSize', 'icon', 'dialog', 'hash'];
    obj.onDeviceRefreshEnd = function () {
        if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) return;
        var p = pluginHandler.omniosfiles;
        p.nodes = p.nodes || {}; p.pending = p.pending || {}; p.transfers = p.transfers || {}; p.sequence = p.sequence || 0;
        var node = currentNode._id;
        if (p.openDialog && p.openDialog.node !== node) p.openDialog.close();
        var state = p.nodes[node] || (p.nodes[node] = {path: '/', items: [], status: '', caps: null, loaded: false, listError: null});
        pluginHandler.registerPluginTab({tabId: 'omniosfiles', tabTitle: 'OmniOS Files'});
        p.render(node);
        if (!state.checking && !state.listing) {
            state.checking = true;
            p.request(node, 'capabilities', {}, function (data, error) {
                state.checking = false; state.caps = error ? null : data;
                if (error) { state.listError = error; p.status(node, error); } else p.navigate(node, state.path);
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
        if (state.listError && state.status === state.listError) state.status = '';
        state.listError = null;
        p.render(node);
        p.request(node, 'listDir', {path: path}, function (data, error) {
            if (state.listing !== token) return;
            state.listing = null;
            if (error) { state.listError = error; p.status(node, error); return; }
            state.path = data.path; state.items = data.items; state.loaded = true; state.listError = null; p.render(node);
        });
    };
    obj.formatSize = function (bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '';
        if (bytes === 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return parseFloat((bytes / Math.pow(1024, index)).toFixed(1)) + ' ' + units[index];
    };
    obj.render = function (node) {
        if (typeof currentNode === 'undefined' || !currentNode || currentNode._id !== node) return;
        var p = pluginHandler.omniosfiles, state = p.nodes[node], host = document.getElementById('omniosfiles');
        if (!host || !state) return;
        host.textContent = '';
        function element(tag, text, parent, id) {
            var e = document.createElement(tag); if (text !== undefined) e.textContent = text;
            if (id) e.id = id; parent.appendChild(e); return e;
        }
        function button(label, title, fn, disabled, parent, className) {
            var b = element('button', label, parent); b.type = 'button'; b.title = title; b.ariaLabel = title;
            var icons = {'Refresh directory and permissions':'refresh','Upload file':'upload','Create directory':'folder','Parent directory':'folder','Open directory':'folder','Download':'download','Rename':'edit','Delete':'trash'};
            if (icons[title]) { b.textContent = ''; b.appendChild(p.icon(icons[title])); if (label) element('span', label, b); }
            b.disabled = !!disabled; b.className = className || ''; b.addEventListener('click', fn); return b;
        }
        function link(label, path, parent) {
            var a = element('a', label, parent); a.href = '#';
            a.addEventListener('click', function (event) { event.preventDefault(); p.navigate(node, path); }); return a;
        }
        // Adapted Willow spacing/colors; see THIRD_PARTY_NOTICES.md.
        element('style',
            "#omniosfiles{--of-bg:#fff;--of-surface:#f2f3f7;--of-border:#ededf1;--of-text:#222;--of-muted:#666;--of-hover:#eaedf5;--of-accent:#235a8e;--of-error:#a12622}" +
            ".night #omniosfiles{--of-bg:#202329;--of-surface:#292d35;--of-border:#424751;--of-text:#eee;--of-muted:#bdc3ce;--of-hover:#353e4b;--of-accent:#9bc8f5;--of-error:#ffaaa5}" +
            "#omniosfiles-container{min-height:360px;display:flex;flex-direction:column;border:1px solid var(--of-border);border-radius:6px;background:var(--of-bg);color:var(--of-text);font:13px Arial,sans-serif;overflow:hidden}" +
            "#omniosfiles-toolbar{min-height:48px;padding:4px 12px;background:var(--of-surface);border-bottom:1px solid var(--of-border);display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
            "#omniosfiles-container button{font:inherit;color:inherit;cursor:pointer}" +
            "#omniosfiles-toolbar button,#omniosfiles-container .omniosfiles-action-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid var(--of-border);background:var(--of-bg);border-radius:4px}" +
            "#omniosfiles-container button:hover:not(:disabled){background:var(--of-hover)}" +
            "#omniosfiles-container button:focus-visible,#omniosfiles-container a:focus-visible{outline:2px solid var(--of-accent);outline-offset:2px}" +
            "#omniosfiles-container button:disabled{opacity:.45;cursor:default}" +
            "#omniosfiles-status{margin-left:auto;color:var(--of-muted);font-size:12px;overflow-wrap:anywhere}" +
            "#omniosfiles-breadcrumb{padding:12px 16px;border-bottom:1px solid var(--of-border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;overflow-wrap:anywhere}" +
            "#omniosfiles-breadcrumb a{color:var(--of-accent);text-decoration:none}" +
            "#omniosfiles-breadcrumb a:hover{text-decoration:underline}" +
            "#omniosfiles-list{flex:1;overflow:auto;max-height:65vh}" +
            "#omniosfiles-table{width:100%;min-width:570px;border-collapse:collapse;font:inherit;color:inherit}" +
            "#omniosfiles-table thead{background:var(--of-surface);position:sticky;top:0}" +
            "#omniosfiles-table th{padding:12px 16px;border-bottom:1px solid var(--of-border);text-align:left;font-weight:600;color:var(--of-muted)}" +
            "#omniosfiles-table tbody td{padding:9px 16px;border-bottom:1px solid var(--of-border)}" +
            "#omniosfiles-table tbody tr:hover{background:var(--of-hover)}" +
            "#omniosfiles-table .omniosfiles-name{overflow-wrap:anywhere}" +
            "#omniosfiles-table .omniosfiles-directory{border:0;background:none;color:var(--of-accent);padding:0;text-align:left;display:inline-flex;align-items:center;gap:8px}" +
            "#omniosfiles-container .omniosfiles-action-btn{padding:5px;margin:0 2px;background:transparent;border-color:transparent}" +
            "#omniosfiles-container .danger{color:var(--of-error)}" +
            "#omniosfiles-table .omniosfiles-placeholder{padding:40px 16px;text-align:center;color:var(--of-muted)}" +
            "#omniosfiles-container .omniosfiles-error{padding:12px 16px;color:var(--of-error);border-bottom:1px solid var(--of-border);overflow-wrap:anywhere}" +
            "#omniosfiles-container .omniosfiles-progress{padding:12px 16px;background:var(--of-surface);border-top:1px solid var(--of-border)}" +
            "#omniosfiles-container .omniosfiles-progress-label{display:flex;align-items:center;gap:10px;flex-wrap:wrap;overflow-wrap:anywhere}" +
            "#omniosfiles-container .omniosfiles-progress-track{margin-top:8px;background:var(--of-border);height:6px;border-radius:4px;overflow:hidden}" +
            "#omniosfiles-container .omniosfiles-progress-fill{height:100%;background:var(--of-accent);transition:width .2s}" +
            "#omniosfiles .of-icon{width:20px;height:20px;vertical-align:middle;flex-shrink:0}" +
            "#omniosfiles .omniosfiles-name> .of-icon{margin-right:8px;color:var(--of-muted)}" +
            ".of-dialog{box-sizing:border-box;width:420px;max-width:90vw;padding:24px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#222;font:14px Arial,sans-serif;box-shadow:0 3px 10px #0003}" +
            ".night .of-dialog{background:#292d35;color:#eee;border-color:#424751}" +
            ".of-dialog::backdrop{background:#0006}" +
            ".of-dialog h3{margin:0 0 18px;font-size:18px}" +
            ".of-dialog p{overflow-wrap:anywhere;white-space:pre-wrap}" +
            ".of-dialog input{box-sizing:border-box;width:100%;margin:8px 0 16px;padding:8px;background:inherit;color:inherit;border:1px solid #888;border-radius:4px}" +
            ".of-dialog .of-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}" +
            ".of-dialog button{padding:7px 14px;cursor:pointer;border:1px solid #aaa;border-radius:4px;background:inherit;color:inherit}.of-dialog button:hover{background:#80808026}.of-dialog button:focus-visible,.of-dialog input:focus-visible{outline:2px solid #235a8e;outline-offset:2px}.night .of-dialog button:focus-visible,.night .of-dialog input:focus-visible{outline-color:#9bc8f5}" +
            ".of-dialog .of-dialog-error{color:#b3342c}" +
            ".night .of-dialog .of-dialog-error{color:#ffaaa5}", host);
        var panel = element('div', undefined, host, 'omniosfiles-container');
        var bar = element('div', undefined, panel, 'omniosfiles-toolbar'), caps = state.caps;
        var active = !!state.mutating || Object.keys(p.transfers).some(function (id) { return p.transfers[id].node === node; });
        button('Refresh', 'Refresh directory and permissions', function () { p.onDeviceRefreshEnd(); }, state.checking || !!state.listing, bar);
        button('Upload', 'Upload file', function () {
            var uploadPath = state.path;
            var input = document.createElement('input'); input.type = 'file';
            input.addEventListener('change', function () { if (input.files[0]) p.upload(node, uploadPath, input.files[0]); }); input.click();
        }, !caps || !caps.write || active || !!state.listing || !!state.listError, bar);
        button('New folder', 'Create directory', function () {
            p.dialog(node, 'createDir', {path: state.path});
        }, !caps || !caps.write || active || !!state.listing || !!state.listError, bar);
        element('span', state.listing ? 'Loading...' : state.listError ? 'Directory unavailable' : state.status || (state.loaded ? state.items.length + ' items' : 'Checking access...'), bar, 'omniosfiles-status');
        var breadcrumb = element('div', undefined, panel, 'omniosfiles-breadcrumb');
        breadcrumb.appendChild(p.icon('folder')); link('/var/nr', '/', breadcrumb);
        var prefix = '';
        state.path.split('/').filter(function (part) { return !!part; }).forEach(function (part) {
            prefix += '/' + part; element('span', ' / ', breadcrumb); link(part, prefix, breadcrumb);
        });
        if (state.listError || state.operationError) element('div', state.listError || state.operationError, panel).className = 'omniosfiles-error';
        var list = element('div', undefined, panel, 'omniosfiles-list');
        var table = element('table', undefined, list, 'omniosfiles-table');
        var header = element('tr', undefined, element('thead', undefined, table));
        ['Name', 'Size', 'Modified', 'Actions'].forEach(function (label, i) {
            var th = element('th', label, header); th.scope = 'col'; th.style.width = ['50%', '15%', '20%', '15%'][i];
            if (i === 1) th.style.textAlign = 'right'; if (i === 3) th.style.textAlign = 'center';
        });
        var body = element('tbody', undefined, table, 'omniosfiles-tbody');
        function placeholder(text) { var td = element('td', text, element('tr', undefined, body)); td.colSpan = 4; td.className = 'omniosfiles-placeholder'; }
        if (state.listing) placeholder('Loading directory...');
        else if (state.listError) placeholder('Directory could not be loaded. Use Refresh to try again.');
        else if (!caps || !state.loaded) placeholder(caps ? 'Directory has not been loaded' : 'Checking access...');
        else {
            if (state.path !== '/') {
                var parentCell = element('td', undefined, element('tr', undefined, body)); parentCell.colSpan = 4;
                button('..', 'Parent directory', function () { p.navigate(node, state.path.replace(/\/[^/]+\/?$/, '') || '/'); }, false, parentCell, 'omniosfiles-directory');
            }
            state.items.forEach(function (item) {
                var row = element('tr', undefined, body), cell = element('td', undefined, row); cell.className = 'omniosfiles-name';
                if (item.isDirectory && item.supported) button(item.name, 'Open directory', function () { p.navigate(node, item.path); }, false, cell, 'omniosfiles-directory');
                else { cell.appendChild(p.icon('file')); element('span', item.name + (item.isLink ? ' (symlink)' : !item.supported ? ' (unsupported)' : ''), cell); }
                element('td', item.isDirectory ? '' : p.formatSize(item.size), row).style.textAlign = 'right';
                element('td', new Date(item.mtime).toLocaleString(), row);
                var ops = element('td', undefined, row); ops.style.textAlign = 'center'; ops.style.whiteSpace = 'nowrap';
                if (!item.isDirectory) button('', 'Download', function () { p.download(node, item); }, active || !item.supported, ops, 'omniosfiles-action-btn');
                button('', 'Rename', function () {
                    p.dialog(node, 'rename', item);
                }, !caps.write || active || !item.supported, ops, 'omniosfiles-action-btn');
                button('', 'Delete', function () { p.dialog(node, 'delete', item); }, !caps.write || active || !item.supported, ops, 'omniosfiles-action-btn danger');
            });
            if (!state.items.length) placeholder('Directory is empty');
        }
        Object.keys(p.transfers).forEach(function (id) {
            var t = p.transfers[id]; if (t.node !== node) return;
            var percent = t.total ? Math.min(100, Math.round(t.offset * 100 / t.total)) : 0;
            var progress = element('div', undefined, panel); progress.className = 'omniosfiles-progress';
            var label = element('div', undefined, progress); label.className = 'omniosfiles-progress-label';
            element('span', (t.upload ? 'Uploading: ' : 'Downloading: ') + t.name + (t.cancelling ? ' (cancelling)' : t.offset === t.total ? ' (verifying)' : ''), label).style.flexGrow = '1';
            element('span', p.formatSize(t.offset) + ' / ' + p.formatSize(t.total) + ' · ' + percent + '%', label);
            button('Cancel', 'Cancel transfer', function () { p.cancel(id); }, t.cancelling, label, 'omniosfiles-action-btn danger');
            var track = element('div', undefined, progress); track.className = 'omniosfiles-progress-track';
            var fill = element('div', undefined, track); fill.className = 'omniosfiles-progress-fill'; fill.style.width = percent + '%';
        });
    };
    obj.icon = function (name) {
        // Original outline drawings, no external icon font or CDN dependency.
        var paths = {
            folder: 'M3 6h7l2 2h9v12H3z M3 6V4h7l2 2h7v2',
            file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
            refresh: 'M20 10a8 8 0 1 0-1 8 M20 4v6h-6',
            upload: 'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',
            download: 'M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4',
            edit: 'M4 16L16 4l4 4L8 20H4z M13 7l4 4',
            trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7'
        };
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'of-icon');
        svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[name] || paths.file); path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.6');
        path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path); return svg;
    };
    obj.dialog = function (node, action, item) {
        var p = pluginHandler.omniosfiles, state = p.nodes[node];
        if (!state || !state.caps || !state.caps.write || state.mutating) return;
        if (p.openDialog) p.openDialog.close();
        var previous = document.activeElement, originPath = state.path;
        var dialog = document.createElement('dialog'); dialog.className = 'of-dialog';
        function add(tag, text, parent) { var el = document.createElement(tag); if (text !== undefined) el.textContent = text; (parent || dialog).appendChild(el); return el; }
        var title = action === 'createDir' ? 'New folder' : action === 'rename' ? 'Rename' : 'Delete';
        add('h3', title).id = 'of-dialog-title'; dialog.setAttribute('aria-labelledby', 'of-dialog-title');
        var form = add('form'), input;
        if (action === 'delete') add('p', 'Delete ' + item.name + (item.isDirectory ? ' and all its contents?' : '?'), form);
        else {
            var label = add('label', action === 'createDir' ? 'Folder name' : 'New name', form); label.htmlFor = 'of-dialog-name';
            input = add('input', undefined, form); input.id = 'of-dialog-name'; input.value = action === 'rename' ? item.name : ''; input.required = true;
            input.autocomplete = 'off';
        }
        var error = add('p', '', form); error.className = 'of-dialog-error'; error.setAttribute('role', 'alert');
        var actions = add('div', undefined, form); actions.className = 'of-dialog-actions';
        var cancel = add('button', 'Cancel', actions); cancel.type = 'button';
        var submit = add('button', title === 'Rename' ? 'Save' : title === 'New folder' ? 'Create' : 'Delete', actions); submit.type = 'submit';
        var closed = false;
        function close() {
            if (closed) return; closed = true;
            dialog.close(); dialog.remove();
            if (p.openDialog && p.openDialog.close === close) p.openDialog = null;
            if (previous && previous.isConnected) previous.focus();
        }
        cancel.addEventListener('click', close);
        dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
        form.addEventListener('submit', function (event) {
            event.preventDefault(); if (closed || submit.disabled) return;
            if (!currentNode || currentNode._id !== node || state.path !== originPath || !state.caps || !state.caps.write || state.mutating || state.listing || Object.keys(p.transfers).some(function (id) { return p.transfers[id].node === node; })) { close(); return; }
            var name = input && input.value;
            if (input && (!name || /[\/\0]/.test(name) || name === '.' || name === '..' || name.indexOf('.omniosfiles-') === 0)) {
                error.textContent = 'Enter a valid name without slashes, NUL, or the reserved .omniosfiles- prefix.'; input.focus(); return;
            }
            var args = action === 'delete' ? {path: item.path} : action === 'rename' ? {srcPath: item.path, dstPath: item.path.replace(/[^/]+$/, '') + name} : {path: (item.path === '/' ? '' : item.path) + '/' + name};
            submit.disabled = true; close(); p.mutate(node, action, args);
        });
        document.body.appendChild(dialog); p.openDialog = {node: node, close: close};
        dialog.showModal(); (input || cancel).focus(); if (input) input.select();
    };
    obj.mutate = function (node, action, args) {
        var p = pluginHandler.omniosfiles;
        if (p.nodes[node].mutating) return;
        p.nodes[node].mutating = true; p.nodes[node].operationError = null; p.render(node);
        p.request(node, action, args, function (data, error) { p.nodes[node].mutating = false; p.nodes[node].operationError = error || null; p.status(node, error || 'Operation completed'); if (!error) p.navigate(node, p.nodes[node].path); });
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
