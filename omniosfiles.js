/**
 * MeshCentral-OmniOSFiles Server Plugin
 * Restricted file browser for /var/nr directory
 * 
 * Provides custom tab in device panel with file operations
 */

"use strict";

module.exports.omniosfiles = function (parent) {
    var obj = {};

    obj.parent = parent;                    // Plugin handler
    obj.meshServer = parent.parent;         // MeshCentral server
    obj.settings = null;                    // Plugin settings from config.json

    // Exported methods for frontend
    obj.exports = [
        // Lifecycle hooks
        'onDeviceRefreshEnd',
        // Tab content generator
        'getPluginTabContent',
        // Server response handlers
        'listDirResult',
        'createDirResult',
        'deleteResult',
        'renameResult',
        'fileInfoResult',
        'downloadStart',
        'downloadChunk',
        'downloadComplete',
        'downloadError',
        'downloadCancelled',
        'uploadReady',
        'uploadAck',
        'uploadComplete',
        'uploadError',
        'uploadCancelled',
        // UI action methods (called from HTML onclick handlers)
        'refresh',
        'navigateTo',
        'showUploadDialog',
        'handleFileSelect',
        'uploadFile',
        'downloadFile',
        'showNewDirDialog',
        'createDirectory',
        'confirmDelete',
        'deleteItem',
        'showRenameDialog',
        'renameItem',
        'cancelTransfer',
        // UI helper methods
        'renderFileList',
        'updateBreadcrumb',
        'showProgress',
        'hideProgress',
        'setStatus',
        'formatSize',
        'escapeHtml'
    ];

    /**
     * Load settings from config.json
     */
    obj.loadSettings = function () {
        if (obj.settings) return obj.settings;

        try {
            var configPath = require('path').join(__dirname, 'config.json');
            var config = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
            obj.settings = config.settings || {};
        } catch (e) {
            obj.settings = {
                basePath: '/var/nr',
                filterMode: 'blacklist',
                allowedExtensions: [],
                blockedExtensions: ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif'],
                maxFileSize: 3221225472,
                chunkSize: 65536,
                enableChecksum: true
            };
        }

        return obj.settings;
    };

    /**
     * Validate file extension based on filter settings
     */
    obj.isExtensionAllowed = function (filename) {
        var settings = obj.loadSettings();
        var ext = require('path').extname(filename).toLowerCase();

        if (settings.filterMode === 'whitelist') {
            if (!settings.allowedExtensions || settings.allowedExtensions.length === 0) {
                return true;
            }
            return settings.allowedExtensions.indexOf(ext) !== -1;
        } else {
            // blacklist mode
            if (!settings.blockedExtensions || settings.blockedExtensions.length === 0) {
                return true;
            }
            return settings.blockedExtensions.indexOf(ext) === -1;
        }
    };

    /**
     * Validate file size
     */
    obj.isFileSizeAllowed = function (size) {
        var settings = obj.loadSettings();
        return size <= (settings.maxFileSize || 3221225472);
    };

    /**
     * Hook: Called when agent core is stable
     */
    obj.hook_agentCoreIsStable = function (myparent, grandparent) {
        // Agent is ready - can request initial data if needed
    };

    /**
     * Handle server actions from frontend or agent
     */
    obj.serveraction = function (command, myparent, grandparent) {
        var nodeid = null;
        var sessionid = null;

        // Determine source (agent or browser)
        if (myparent && myparent.dbNodeKey) {
            // From agent
            nodeid = myparent.dbNodeKey;
        }

        if (command.sessionid) {
            sessionid = command.sessionid;
        }

        console.log('[omniosfiles] serveraction:', command.pluginaction, 'nodeid:', nodeid || command.nodeid);

        switch (command.pluginaction) {
            // =====================
            // Frontend -> Agent routing
            // =====================
            case 'listDir':
            case 'createDir':
            case 'delete':
            case 'rename':
            case 'fileInfo':
            case 'startDownload':
            case 'requestChunk':
            case 'cancelDownload':
            case 'cancelUpload':
                obj.routeToAgent(command, grandparent);
                break;

            case 'startUpload':
                // Validate before routing
                if (!obj.isExtensionAllowed(command.fileName)) {
                    obj.sendToSession(command.sessionid, {
                        action: 'plugin',
                        plugin: 'omniosfiles',
                        method: 'uploadError',
                        requestId: command.requestId,
                        error: 'File extension not allowed'
                    }, grandparent);
                    return;
                }
                if (!obj.isFileSizeAllowed(command.totalSize)) {
                    obj.sendToSession(command.sessionid, {
                        action: 'plugin',
                        plugin: 'omniosfiles',
                        method: 'uploadError',
                        requestId: command.requestId,
                        error: 'File size exceeds maximum allowed (' +
                            Math.round(obj.loadSettings().maxFileSize / 1073741824) + ' GB)'
                    }, grandparent);
                    return;
                }
                obj.routeToAgent(command, grandparent);
                break;

            case 'uploadChunk':
                obj.routeToAgent(command, grandparent);
                break;

            // =====================
            // Agent -> Frontend routing
            // =====================
            case 'listDirResult':
            case 'createDirResult':
            case 'deleteResult':
            case 'renameResult':
            case 'fileInfoResult':
            case 'downloadStart':
            case 'downloadChunk':
            case 'downloadComplete':
            case 'downloadError':
            case 'downloadCancelled':
            case 'uploadReady':
            case 'uploadAck':
            case 'uploadComplete':
            case 'uploadError':
            case 'uploadCancelled':
                obj.routeToFrontend(command, grandparent);
                break;

            default:
                // Unknown action
                break;
        }
    };

    /**
     * Route command to agent
     */
    obj.routeToAgent = function (command, grandparent) {
        console.log('[omniosfiles] routeToAgent:', command.pluginaction, 'nodeid:', command.nodeid);
        if (!command.nodeid) { console.log('[omniosfiles] routeToAgent: no nodeid'); return; }

        var agent = obj.meshServer.webserver.wsagents[command.nodeid];
        console.log('[omniosfiles] Agent found:', !!agent);
        if (agent) {
            try {
                agent.send(JSON.stringify({
                    action: 'plugin',
                    plugin: 'omniosfiles',
                    pluginaction: command.pluginaction,
                    requestId: command.requestId,
                    sessionid: command.sessionid,
                    // Pass through all other properties
                    path: command.path,
                    srcPath: command.srcPath,
                    dstPath: command.dstPath,
                    fileName: command.fileName,
                    totalSize: command.totalSize,
                    checksum: command.checksum,
                    chunkIndex: command.chunkIndex,
                    data: command.data,
                    isLast: command.isLast
                }));
                console.log('[omniosfiles] Sent to agent');
            } catch (e) {
                console.log('[omniosfiles] Agent send failed:', e);
            }
        } else {
            console.log('[omniosfiles] Agent not connected');
        }
    };

    /**
     * Route command to frontend session
     */
    obj.routeToFrontend = function (command, grandparent) {
        if (!command.sessionid) return;

        var msg = {
            action: 'plugin',
            plugin: 'omniosfiles',
            method: command.pluginaction,
            requestId: command.requestId,
            // Pass through relevant data
            success: command.success,
            error: command.error,
            path: command.path,
            items: command.items,
            info: command.info,
            srcPath: command.srcPath,
            dstPath: command.dstPath,
            fileName: command.fileName,
            totalSize: command.totalSize,
            totalChunks: command.totalChunks,
            chunkSize: command.chunkSize,
            chunkIndex: command.chunkIndex,
            data: command.data,
            bytesRead: command.bytesRead,
            isLast: command.isLast,
            checksum: command.checksum,
            checksumError: command.checksumError,
            checksumMatch: command.checksumMatch,
            receivedBytes: command.receivedBytes,
            ownershipSet: command.ownershipSet
        };

        obj.sendToSession(command.sessionid, msg, grandparent);
    };

    /**
     * Send message to a specific browser session
     */
    obj.sendToSession = function (sessionid, msg, grandparent) {
        if (!sessionid) return;

        var wss = obj.meshServer.webserver.wssessions2;
        if (wss && wss[sessionid]) {
            try {
                wss[sessionid].send(JSON.stringify(msg));
            } catch (e) {
                // Session send failed
            }
        }
    };

    /**
     * Generate tab HTML content for plugin tab
     */
    obj.getPluginTabContent = function () {
        return '<div id="omniosfiles-container" style="height: 100%; display: flex; flex-direction: column;">' +
            '<!-- Toolbar -->' +
            '<div id="omniosfiles-toolbar" style="padding: 8px; background: #f5f5f5; border-bottom: 1px solid #ddd; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">' +
            '<button id="omniosfiles-btn-refresh" onclick="return pluginHandler.omniosfiles.refresh();" title="Refresh">🔄 Refresh</button>' +
            '<button id="omniosfiles-btn-upload" onclick="return pluginHandler.omniosfiles.showUploadDialog();" title="Upload File">⬆️ Upload</button>' +
            '<button id="omniosfiles-btn-newdir" onclick="return pluginHandler.omniosfiles.showNewDirDialog();" title="New Folder">📁+ New Folder</button>' +
            '<span style="flex-grow: 1;"></span>' +
            '<span id="omniosfiles-status" style="color: #666; font-size: 12px;"></span>' +
            '</div>' +
            '<!-- Breadcrumb navigation -->' +
            '<div id="omniosfiles-breadcrumb" style="padding: 8px; background: #fafafa; border-bottom: 1px solid #eee; font-size: 13px;">' +
            '<span style="color: #666;">📂</span> <a href="#" onclick="return pluginHandler.omniosfiles.navigateTo(\'/\');">/</a>' +
            '</div>' +
            '<!-- File list -->' +
            '<div id="omniosfiles-list" style="flex-grow: 1; overflow: auto; padding: 0;">' +
            '<table id="omniosfiles-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">' +
            '<thead style="background: #f0f0f0; position: sticky; top: 0;">' +
            '<tr>' +
            '<th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd; width: 50%;">Name</th>' +
            '<th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd; width: 15%;">Size</th>' +
            '<th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd; width: 20%;">Modified</th>' +
            '<th style="text-align: center; padding: 8px; border-bottom: 1px solid #ddd; width: 15%;">Actions</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody id="omniosfiles-tbody">' +
            '<tr><td colspan="4" style="padding: 20px; text-align: center; color: #999;">Loading...</td></tr>' +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '<!-- Progress bar (hidden by default) -->' +
            '<div id="omniosfiles-progress" style="display: none; padding: 10px; background: #fff3cd; border-top: 1px solid #ffc107;">' +
            '<div style="display: flex; align-items: center; gap: 10px;">' +
            '<span id="omniosfiles-progress-text" style="flex-grow: 1;">Transferring...</span>' +
            '<span id="omniosfiles-progress-percent">0%</span>' +
            '<button onclick="return pluginHandler.omniosfiles.cancelTransfer();" style="color: red;">Cancel</button>' +
            '</div>' +
            '<div style="margin-top: 5px; background: #eee; height: 8px; border-radius: 4px; overflow: hidden;">' +
            '<div id="omniosfiles-progress-bar" style="height: 100%; background: #28a745; width: 0%; transition: width 0.3s;"></div>' +
            '</div>' +
            '</div>' +
            '<!-- Hidden file input for uploads -->' +
            '<input type="file" id="omniosfiles-file-input" style="display: none;" onchange="pluginHandler.omniosfiles.handleFileSelect(this);">' +
            '</div>' +
            '<style>' +
            '#omniosfiles-table tbody tr:hover { background: #f5f5f5; }' +
            '#omniosfiles-table tbody tr td { padding: 6px 8px; border-bottom: 1px solid #eee; }' +
            '#omniosfiles-toolbar button { padding: 5px 10px; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 3px; }' +
            '#omniosfiles-toolbar button:hover { background: #e9e9e9; }' +
            '.omniosfiles-action-btn { padding: 2px 6px; margin: 0 2px; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 3px; font-size: 12px; }' +
            '.omniosfiles-action-btn:hover { background: #e9e9e9; }' +
            '.omniosfiles-action-btn.danger:hover { background: #ffebee; border-color: #f44336; }' +
            '</style>';
    };

    /**
     * Called when device panel refreshes - initializes the plugin
     */
    obj.onDeviceRefreshEnd = function () {
        console.log('[omniosfiles] onDeviceRefreshEnd called');
        if (typeof document === 'undefined') { console.log('[omniosfiles] document undefined'); return; }
        if (typeof currentNode === 'undefined' || !currentNode || !currentNode._id) {
            console.log('[omniosfiles] currentNode undefined or no _id');
            return;
        }
        console.log('[omniosfiles] currentNode._id:', currentNode._id);

        // Register plugin tab if not already registered
        if (typeof pluginHandler !== 'undefined' && typeof pluginHandler.registerPluginTab === 'function') {
            console.log('[omniosfiles] Registering plugin tab...');
            pluginHandler.registerPluginTab({
                tabId: 'omniosfiles',
                tabTitle: 'OmniOS Files'
            });
            console.log('[omniosfiles] Plugin tab registered');
        } else {
            console.log('[omniosfiles] pluginHandler.registerPluginTab not available');
        }

        // Initialize state
        if (!pluginHandler.omniosfiles.state) {
            pluginHandler.omniosfiles.state = {};
        }

        // Initialize settings with defaults
        if (!pluginHandler.omniosfiles.settingsCache) {
            pluginHandler.omniosfiles.settingsCache = {
                basePath: '/var/nr',
                filterMode: 'blacklist',
                allowedExtensions: [],
                blockedExtensions: ['.exe', '.bat', '.cmd', '.com', '.scr', '.pif'],
                maxFileSize: 3221225472,
                chunkSize: 65536,
                enableChecksum: true
            };
        }

        var nodeId = currentNode._id;
        if (!pluginHandler.omniosfiles.state[nodeId]) {
            pluginHandler.omniosfiles.state[nodeId] = {
                currentPath: '/',
                items: [],
                transfers: {},
                pendingRequests: {}
            };
        }

        // Populate the tab content
        var tabDiv = document.getElementById('omniosfiles');
        console.log('[omniosfiles] tabDiv:', tabDiv);
        if (tabDiv && !tabDiv.querySelector('#omniosfiles-container')) {
            console.log('[omniosfiles] Populating tab content...');
            tabDiv.innerHTML = pluginHandler.omniosfiles.getPluginTabContent();
        }

        // Refresh file list after a short delay
        setTimeout(function () {
            if (document.getElementById('omniosfiles-container')) {
                console.log('[omniosfiles] Refreshing file list...');
                pluginHandler.omniosfiles.refresh();
            }
        }, 100);
    };

    /**
     * Navigate to a directory
     */
    obj.navigateTo = function (path) {
        if (typeof currentNode === 'undefined' || !currentNode) return false;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return false;

        state.currentPath = path;
        pluginHandler.omniosfiles.refresh();
        return false;
    };

    /**
     * Refresh current directory listing
     */
    obj.refresh = function () {
        console.log('[omniosfiles] refresh() called');
        if (typeof currentNode === 'undefined' || !currentNode) { console.log('[omniosfiles] refresh: no currentNode'); return false; }
        if (typeof meshserver === 'undefined') { console.log('[omniosfiles] refresh: no meshserver'); return false; }

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) { console.log('[omniosfiles] refresh: no state'); return false; }

        var requestId = 'list_' + Date.now();

        pluginHandler.omniosfiles.setStatus('Loading...');

        console.log('[omniosfiles] Sending listDir request:', {
            nodeid: currentNode._id,
            path: state.currentPath,
            requestId: requestId
        });

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'listDir',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: requestId,
            path: state.currentPath
        });

        return false;
    };

    /**
     * Handle directory listing result
     */
    obj.listDirResult = function (data) {
        console.log('[omniosfiles] listDirResult received:', data);
        if (typeof document === 'undefined') return;
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        if (!data.success) {
            console.log('[omniosfiles] listDirResult error:', data.error);
            pluginHandler.omniosfiles.setStatus('Error: ' + data.error);
            return;
        }

        console.log('[omniosfiles] listDirResult items:', data.items ? data.items.length : 0);
        state.currentPath = data.path;
        state.items = data.items || [];

        pluginHandler.omniosfiles.renderFileList();
        pluginHandler.omniosfiles.updateBreadcrumb();
        pluginHandler.omniosfiles.setStatus(state.items.length + ' items');
    };

    /**
     * Render file list table
     */
    obj.renderFileList = function () {
        if (typeof document === 'undefined') return;
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        var tbody = document.getElementById('omniosfiles-tbody');
        if (!tbody) return;

        var html = '';

        // Parent directory link (if not at root)
        if (state.currentPath !== '/') {
            var parentPath = state.currentPath.replace(/\/[^\/]+\/?$/, '') || '/';
            html += '<tr style="cursor: pointer;" onclick="pluginHandler.omniosfiles.navigateTo(\'' +
                pluginHandler.omniosfiles.escapeHtml(parentPath) + '\');">' +
                '<td>📁 ..</td><td></td><td></td><td></td></tr>';
        }

        // File/directory items
        for (var i = 0; i < state.items.length; i++) {
            var item = state.items[i];
            var icon = item.isDirectory ? '📁' : '📄';
            var size = item.isDirectory ? '' : pluginHandler.omniosfiles.formatSize(item.size);
            var mtime = new Date(item.mtime).toLocaleString();
            var itemPath = item.path;

            html += '<tr>';

            // Name column
            if (item.isDirectory) {
                html += '<td style="cursor: pointer;" onclick="pluginHandler.omniosfiles.navigateTo(\'' +
                    pluginHandler.omniosfiles.escapeHtml(itemPath) + '\');">' +
                    icon + ' ' + pluginHandler.omniosfiles.escapeHtml(item.name) + '</td>';
            } else {
                html += '<td>' + icon + ' ' + pluginHandler.omniosfiles.escapeHtml(item.name) + '</td>';
            }

            // Size column
            html += '<td style="text-align: right;">' + size + '</td>';

            // Modified column
            html += '<td>' + mtime + '</td>';

            // Actions column
            html += '<td style="text-align: center;">';
            if (!item.isDirectory) {
                html += '<button class="omniosfiles-action-btn" onclick="pluginHandler.omniosfiles.downloadFile(\'' +
                    pluginHandler.omniosfiles.escapeHtml(itemPath) + '\');" title="Download">⬇️</button>';
            }
            html += '<button class="omniosfiles-action-btn" onclick="pluginHandler.omniosfiles.showRenameDialog(\'' +
                pluginHandler.omniosfiles.escapeHtml(itemPath) + '\', \'' +
                pluginHandler.omniosfiles.escapeHtml(item.name) + '\');" title="Rename">✏️</button>';
            html += '<button class="omniosfiles-action-btn danger" onclick="pluginHandler.omniosfiles.confirmDelete(\'' +
                pluginHandler.omniosfiles.escapeHtml(itemPath) + '\', \'' +
                pluginHandler.omniosfiles.escapeHtml(item.name) + '\', ' + item.isDirectory + ');" title="Delete">🗑️</button>';
            html += '</td>';

            html += '</tr>';
        }

        if (state.items.length === 0 && state.currentPath === '/') {
            html += '<tr><td colspan="4" style="padding: 20px; text-align: center; color: #999;">Directory is empty</td></tr>';
        }

        tbody.innerHTML = html;
    };

    /**
     * Update breadcrumb navigation
     */
    obj.updateBreadcrumb = function () {
        if (typeof document === 'undefined') return;
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        var breadcrumb = document.getElementById('omniosfiles-breadcrumb');
        if (!breadcrumb) return;

        var parts = state.currentPath.split('/').filter(function (p) { return p; });
        var html = '<span style="color: #666;">📂</span> ';
        html += '<a href="#" onclick="return pluginHandler.omniosfiles.navigateTo(\'/\');">/var/nr</a>';

        var path = '';
        for (var i = 0; i < parts.length; i++) {
            path += '/' + parts[i];
            html += ' / <a href="#" onclick="return pluginHandler.omniosfiles.navigateTo(\'' +
                pluginHandler.omniosfiles.escapeHtml(path) + '\');">' +
                pluginHandler.omniosfiles.escapeHtml(parts[i]) + '</a>';
        }

        breadcrumb.innerHTML = html;
    };

    /**
     * Show upload file dialog
     */
    obj.showUploadDialog = function () {
        var input = document.getElementById('omniosfiles-file-input');
        if (input) input.click();
        return false;
    };

    /**
     * Handle file selection for upload
     */
    obj.handleFileSelect = function (input) {
        if (!input.files || input.files.length === 0) return;

        var file = input.files[0];
        input.value = ''; // Reset for next selection

        pluginHandler.omniosfiles.uploadFile(file);
    };

    /**
     * Start file upload
     */
    obj.uploadFile = function (file) {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (typeof meshserver === 'undefined') return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        var settings = pluginHandler.omniosfiles.settingsCache || {};
        var maxSize = settings.maxFileSize || 3221225472;

        // Validate file size
        if (file.size > maxSize) {
            alert('File size exceeds maximum allowed (' + Math.round(maxSize / 1073741824) + ' GB)');
            return;
        }

        var requestId = 'upload_' + Date.now();
        var targetPath = (state.currentPath === '/' ? '' : state.currentPath) + '/' + file.name;
        var chunkSize = settings.chunkSize || 65536;
        var totalChunks = Math.ceil(file.size / chunkSize);

        // Store upload state
        state.transfers[requestId] = {
            type: 'upload',
            file: file,
            fileName: file.name,
            totalSize: file.size,
            chunkSize: chunkSize,
            totalChunks: totalChunks,
            currentChunk: 0,
            inFlight: 0,
            maxInFlight: 8,
            cancelled: false,
            clientChecksum: null
        };

        // Show progress
        pluginHandler.omniosfiles.showProgress('Preparing upload: ' + file.name, 0);

        // Compute checksum if enabled and file is not too large
        if (settings.enableChecksum && file.size <= 104857600) { // 100MB limit for client checksum
            pluginHandler.omniosfiles.computeClientChecksum(file, requestId, function (checksum) {
                state.transfers[requestId].clientChecksum = checksum;
                pluginHandler.omniosfiles.sendUploadStart(requestId, targetPath, file, checksum);
            });
        } else {
            pluginHandler.omniosfiles.sendUploadStart(requestId, targetPath, file, null);
        }
    };

    /**
     * Compute SHA-256 checksum on client side
     */
    obj.computeClientChecksum = function (file, requestId, callback) {
        var reader = new FileReader();

        reader.onload = function (e) {
            crypto.subtle.digest('SHA-256', e.target.result).then(function (hashBuffer) {
                var hashArray = Array.from(new Uint8Array(hashBuffer));
                var hashHex = hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
                callback(hashHex);
            }).catch(function () {
                callback(null);
            });
        };

        reader.onerror = function () {
            callback(null);
        };

        reader.readAsArrayBuffer(file);
    };

    /**
     * Send upload start command
     */
    obj.sendUploadStart = function (requestId, targetPath, file, checksum) {
        if (typeof meshserver === 'undefined') return;
        if (typeof currentNode === 'undefined' || !currentNode) return;

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'startUpload',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: requestId,
            path: targetPath,
            fileName: file.name,
            totalSize: file.size,
            checksum: checksum
        });
    };

    /**
     * Handle upload ready signal
     */
    obj.uploadReady = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state || !state.transfers[data.requestId]) return;

        var transfer = state.transfers[data.requestId];
        if (transfer.cancelled) return;

        pluginHandler.omniosfiles.showProgress('Uploading: ' + transfer.fileName, 0);

        // Start sending chunks
        for (var i = 0; i < transfer.maxInFlight && i < transfer.totalChunks; i++) {
            pluginHandler.omniosfiles.sendUploadChunk(data.requestId, i);
        }
    };

    /**
     * Send an upload chunk
     */
    obj.sendUploadChunk = function (requestId, chunkIndex) {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (typeof meshserver === 'undefined') return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state || !state.transfers[requestId]) return;

        var transfer = state.transfers[requestId];
        if (transfer.cancelled) return;

        var start = chunkIndex * transfer.chunkSize;
        var end = Math.min(start + transfer.chunkSize, transfer.file.size);
        var slice = transfer.file.slice(start, end);

        var reader = new FileReader();
        reader.onload = function (e) {
            if (transfer.cancelled) return;

            var base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(e.target.result)));

            meshserver.send({
                action: 'plugin',
                plugin: 'omniosfiles',
                pluginaction: 'uploadChunk',
                nodeid: currentNode._id,
                sessionid: meshserver.socketid,
                requestId: requestId,
                chunkIndex: chunkIndex,
                data: base64,
                isLast: (end >= transfer.file.size)
            });

            transfer.inFlight++;
        };
        reader.readAsArrayBuffer(slice);
    };

    /**
     * Handle upload acknowledgment
     */
    obj.uploadAck = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state || !state.transfers[data.requestId]) return;

        var transfer = state.transfers[data.requestId];
        transfer.inFlight--;
        transfer.currentChunk++;

        var percent = Math.round((transfer.currentChunk / transfer.totalChunks) * 100);
        pluginHandler.omniosfiles.showProgress('Uploading: ' + transfer.fileName, percent);

        // Send next chunk if available
        var nextChunk = transfer.currentChunk + transfer.inFlight;
        if (nextChunk < transfer.totalChunks && !transfer.cancelled) {
            pluginHandler.omniosfiles.sendUploadChunk(data.requestId, nextChunk);
        }
    };

    /**
     * Handle upload complete
     */
    obj.uploadComplete = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        var transfer = state.transfers[data.requestId];
        delete state.transfers[data.requestId];

        pluginHandler.omniosfiles.hideProgress();

        if (data.checksumMatch === false) {
            alert('Upload completed but checksum verification failed. File may be corrupted.');
        } else {
            pluginHandler.omniosfiles.setStatus('Upload complete: ' + (transfer ? transfer.fileName : 'file'));
        }

        // Refresh file list
        pluginHandler.omniosfiles.refresh();
    };

    /**
     * Handle upload error
     */
    obj.uploadError = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (state && state.transfers[data.requestId]) {
            delete state.transfers[data.requestId];
        }

        pluginHandler.omniosfiles.hideProgress();
        alert('Upload failed: ' + data.error);
    };

    /**
     * Handle upload cancelled
     */
    obj.uploadCancelled = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (state && state.transfers[data.requestId]) {
            delete state.transfers[data.requestId];
        }

        pluginHandler.omniosfiles.hideProgress();
        pluginHandler.omniosfiles.setStatus('Upload cancelled');
    };

    /**
     * Start file download
     */
    obj.downloadFile = function (filePath) {
        if (typeof currentNode === 'undefined' || !currentNode) return false;
        if (typeof meshserver === 'undefined') return false;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return false;

        var requestId = 'download_' + Date.now();

        state.transfers[requestId] = {
            type: 'download',
            path: filePath,
            chunks: [],
            totalSize: 0,
            totalChunks: 0,
            receivedChunks: 0,
            fileName: '',
            cancelled: false
        };

        pluginHandler.omniosfiles.showProgress('Preparing download...', 0);

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'startDownload',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: requestId,
            path: filePath
        });

        return false;
    };

    /**
     * Handle download start
     */
    obj.downloadStart = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state || !state.transfers[data.requestId]) return;

        var transfer = state.transfers[data.requestId];
        transfer.fileName = data.fileName;
        transfer.totalSize = data.totalSize;
        transfer.totalChunks = data.totalChunks;
        transfer.chunks = new Array(data.totalChunks);

        pluginHandler.omniosfiles.showProgress('Downloading: ' + transfer.fileName, 0);

        // Request first batch of chunks
        for (var i = 0; i < 8 && i < data.totalChunks; i++) {
            pluginHandler.omniosfiles.requestDownloadChunk(data.requestId, i);
        }
    };

    /**
     * Request a download chunk
     */
    obj.requestDownloadChunk = function (requestId, chunkIndex) {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (typeof meshserver === 'undefined') return;

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'requestChunk',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: requestId,
            chunkIndex: chunkIndex
        });
    };

    /**
     * Handle download chunk
     */
    obj.downloadChunk = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state || !state.transfers[data.requestId]) return;

        var transfer = state.transfers[data.requestId];
        if (transfer.cancelled) return;

        // Store chunk
        transfer.chunks[data.chunkIndex] = atob(data.data);
        transfer.receivedChunks++;

        var percent = Math.round((transfer.receivedChunks / transfer.totalChunks) * 100);
        pluginHandler.omniosfiles.showProgress('Downloading: ' + transfer.fileName, percent);

        // Request next chunk (sliding window)
        var nextChunk = data.chunkIndex + 8;
        if (nextChunk < transfer.totalChunks && !transfer.cancelled) {
            pluginHandler.omniosfiles.requestDownloadChunk(data.requestId, nextChunk);
        }
    };

    /**
     * Handle download complete
     */
    obj.downloadComplete = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state || !state.transfers[data.requestId]) return;

        var transfer = state.transfers[data.requestId];

        pluginHandler.omniosfiles.hideProgress();

        // Combine all chunks into a Blob
        var blobParts = [];
        for (var i = 0; i < transfer.chunks.length; i++) {
            var chunk = transfer.chunks[i];
            if (chunk) {
                var bytes = new Uint8Array(chunk.length);
                for (var j = 0; j < chunk.length; j++) {
                    bytes[j] = chunk.charCodeAt(j);
                }
                blobParts.push(bytes);
            }
        }

        var blob = new Blob(blobParts, { type: 'application/octet-stream' });

        // Trigger browser download
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = transfer.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        delete state.transfers[data.requestId];
        pluginHandler.omniosfiles.setStatus('Download complete: ' + transfer.fileName);
    };

    /**
     * Handle download error
     */
    obj.downloadError = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (state && state.transfers[data.requestId]) {
            delete state.transfers[data.requestId];
        }

        pluginHandler.omniosfiles.hideProgress();
        alert('Download failed: ' + data.error);
    };

    /**
     * Handle download cancelled
     */
    obj.downloadCancelled = function (data) {
        if (typeof currentNode === 'undefined' || !currentNode) return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (state && state.transfers[data.requestId]) {
            delete state.transfers[data.requestId];
        }

        pluginHandler.omniosfiles.hideProgress();
        pluginHandler.omniosfiles.setStatus('Download cancelled');
    };

    /**
     * Cancel active transfer
     */
    obj.cancelTransfer = function () {
        if (typeof currentNode === 'undefined' || !currentNode) return false;
        if (typeof meshserver === 'undefined') return false;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return false;

        for (var requestId in state.transfers) {
            var transfer = state.transfers[requestId];
            transfer.cancelled = true;

            meshserver.send({
                action: 'plugin',
                plugin: 'omniosfiles',
                pluginaction: transfer.type === 'upload' ? 'cancelUpload' : 'cancelDownload',
                nodeid: currentNode._id,
                sessionid: meshserver.socketid,
                requestId: requestId
            });
        }

        return false;
    };

    /**
     * Show new directory dialog
     */
    obj.showNewDirDialog = function () {
        var name = prompt('Enter new folder name:');
        if (!name) return false;

        pluginHandler.omniosfiles.createDirectory(name);
        return false;
    };

    /**
     * Create new directory
     */
    obj.createDirectory = function (name) {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (typeof meshserver === 'undefined') return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        var newPath = (state.currentPath === '/' ? '' : state.currentPath) + '/' + name;

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'createDir',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: 'mkdir_' + Date.now(),
            path: newPath
        });
    };

    /**
     * Handle create directory result
     */
    obj.createDirResult = function (data) {
        if (data.success) {
            pluginHandler.omniosfiles.refresh();
        } else {
            alert('Failed to create directory: ' + data.error);
        }
    };

    /**
     * Confirm file/directory deletion
     */
    obj.confirmDelete = function (path, name, isDirectory) {
        var msg = 'Are you sure you want to delete ' +
            (isDirectory ? 'folder' : 'file') + ' "' + name + '"?';
        if (isDirectory) {
            msg += '\n\nThis will delete all contents inside the folder.';
        }

        if (confirm(msg)) {
            pluginHandler.omniosfiles.deleteItem(path);
        }
        return false;
    };

    /**
     * Delete file or directory
     */
    obj.deleteItem = function (path) {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (typeof meshserver === 'undefined') return;

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'delete',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: 'delete_' + Date.now(),
            path: path
        });
    };

    /**
     * Handle delete result
     */
    obj.deleteResult = function (data) {
        if (data.success) {
            pluginHandler.omniosfiles.refresh();
        } else {
            alert('Failed to delete: ' + data.error);
        }
    };

    /**
     * Show rename dialog
     */
    obj.showRenameDialog = function (path, currentName) {
        var newName = prompt('Enter new name:', currentName);
        if (!newName || newName === currentName) return false;

        pluginHandler.omniosfiles.renameItem(path, newName);
        return false;
    };

    /**
     * Rename file or directory
     */
    obj.renameItem = function (srcPath, newName) {
        if (typeof currentNode === 'undefined' || !currentNode) return;
        if (typeof meshserver === 'undefined') return;

        var state = pluginHandler.omniosfiles.state[currentNode._id];
        if (!state) return;

        var parentPath = srcPath.replace(/\/[^\/]+\/?$/, '') || '/';
        var dstPath = (parentPath === '/' ? '' : parentPath) + '/' + newName;

        meshserver.send({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'rename',
            nodeid: currentNode._id,
            sessionid: meshserver.socketid,
            requestId: 'rename_' + Date.now(),
            srcPath: srcPath,
            dstPath: dstPath
        });
    };

    /**
     * Handle rename result
     */
    obj.renameResult = function (data) {
        if (data.success) {
            pluginHandler.omniosfiles.refresh();
        } else {
            alert('Failed to rename: ' + data.error);
        }
    };

    /**
     * Handle file info result
     */
    obj.fileInfoResult = function (data) {
        // Currently not used, but available for future features
    };

    /**
     * Show progress bar
     */
    obj.showProgress = function (text, percent) {
        if (typeof document === 'undefined') return;

        var container = document.getElementById('omniosfiles-progress');
        var textEl = document.getElementById('omniosfiles-progress-text');
        var percentEl = document.getElementById('omniosfiles-progress-percent');
        var barEl = document.getElementById('omniosfiles-progress-bar');

        if (container) container.style.display = 'block';
        if (textEl) textEl.textContent = text;
        if (percentEl) percentEl.textContent = percent + '%';
        if (barEl) barEl.style.width = percent + '%';
    };

    /**
     * Hide progress bar
     */
    obj.hideProgress = function () {
        if (typeof document === 'undefined') return;

        var container = document.getElementById('omniosfiles-progress');
        if (container) container.style.display = 'none';
    };

    /**
     * Set status text
     */
    obj.setStatus = function (text) {
        if (typeof document === 'undefined') return;

        var statusEl = document.getElementById('omniosfiles-status');
        if (statusEl) statusEl.textContent = text;
    };

    /**
     * Format file size
     */
    obj.formatSize = function (bytes) {
        if (bytes === 0) return '0 B';
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    /**
     * Escape HTML
     */
    obj.escapeHtml = function (text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    return obj;
};
