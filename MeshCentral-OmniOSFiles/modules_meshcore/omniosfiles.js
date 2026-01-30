/**
 * MeshCentral-OmniOSFiles Agent Module
 * Restricted file browser for /var/nr directory
 * 
 * All file operations run as user:user for security
 */

"use strict";

var mesh;
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

// Configuration
var BASE_PATH = '/var/nr';
var RUN_AS_USER = 'user';
var RUN_AS_GROUP = 'user';
var CHUNK_SIZE = 65536; // 64KB

// Active transfers tracking
var activeDownloads = {};
var activeUploads = {};

/**
 * Debug logging
 */
function dbg(msg) {
    if (typeof console !== 'undefined') {
        console.log('OmniOSFiles: ' + msg);
    }
}

/**
 * Send command back to server
 */
function sendCommand(cmd) {
    if (mesh) {
        mesh.SendCommand(cmd);
    }
}

/**
 * Validate that path is within allowed base path
 * Prevents directory traversal attacks
 */
function isPathAllowed(requestedPath) {
    try {
        // Normalize and resolve the path
        var resolved = path.resolve(BASE_PATH, requestedPath);
        
        // Ensure it starts with BASE_PATH
        if (!resolved.startsWith(BASE_PATH + '/') && resolved !== BASE_PATH) {
            return { allowed: false, resolved: null, error: 'Path outside allowed directory' };
        }
        
        // Check if path exists for read operations
        if (fs.existsSync(resolved)) {
            // Check for symlinks that might escape
            var realPath = fs.realpathSync(resolved);
            if (!realPath.startsWith(BASE_PATH + '/') && realPath !== BASE_PATH) {
                return { allowed: false, resolved: null, error: 'Symlink points outside allowed directory' };
            }
        } else {
            // For create operations, check parent directory
            var parentDir = path.dirname(resolved);
            if (fs.existsSync(parentDir)) {
                var parentReal = fs.realpathSync(parentDir);
                if (!parentReal.startsWith(BASE_PATH) && parentReal !== BASE_PATH) {
                    return { allowed: false, resolved: null, error: 'Parent directory outside allowed area' };
                }
            }
        }
        
        return { allowed: true, resolved: resolved, error: null };
    } catch (e) {
        return { allowed: false, resolved: null, error: e.message };
    }
}

/**
 * Change file ownership to user:user
 */
function changeOwnership(filePath, callback) {
    var ownerGroup = RUN_AS_USER + ':' + RUN_AS_GROUP;
    var proc = childProcess.execFile('/usr/bin/chown', [ownerGroup, filePath]);
    
    proc.stdout.str = '';
    proc.stderr.str = '';
    proc.stdout.on('data', function(c) { proc.stdout.str += c.toString(); });
    proc.stderr.on('data', function(c) { proc.stderr.str += c.toString(); });
    
    proc.on('exit', function(code) {
        if (callback) {
            callback(code === 0, code === 0 ? null : proc.stderr.str);
        }
    });
}

/**
 * Compute SHA-256 checksum of a file
 */
function computeChecksum(filePath, callback) {
    var crypto = require('SHA256Stream');
    var hash = crypto.create();
    var fileStream;
    
    try {
        fileStream = fs.createReadStream(filePath, { flags: 'rb' });
    } catch (e) {
        callback(null, e.message);
        return;
    }
    
    fileStream.on('data', function(chunk) {
        hash.write(chunk);
    });
    
    fileStream.on('end', function() {
        var digest = hash.finalize();
        callback(digest.toString('hex'), null);
    });
    
    fileStream.on('error', function(e) {
        callback(null, e.message);
    });
}

/**
 * Alternative checksum computation using child process (fallback)
 */
function computeChecksumFallback(filePath, callback) {
    var proc = childProcess.execFile('/usr/bin/sha256sum', [filePath]);
    
    proc.stdout.str = '';
    proc.stderr.str = '';
    proc.stdout.on('data', function(c) { proc.stdout.str += c.toString(); });
    proc.stderr.on('data', function(c) { proc.stderr.str += c.toString(); });
    
    proc.on('exit', function(code) {
        if (code === 0) {
            var hash = proc.stdout.str.split(/\s+/)[0];
            callback(hash, null);
        } else {
            callback(null, proc.stderr.str || 'Failed to compute checksum');
        }
    });
}

/**
 * List directory contents
 */
function listDirectory(args) {
    var requestedPath = args.path || '/';
    var validation = isPathAllowed(requestedPath);
    
    if (!validation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'listDirResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: validation.error
        });
        return;
    }
    
    var dirPath = validation.resolved;
    var items = [];
    
    try {
        if (!fs.existsSync(dirPath)) {
            throw new Error('Directory does not exist');
        }
        
        var stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            throw new Error('Path is not a directory');
        }
        
        var entries = fs.readdirSync(dirPath);
        
        for (var i = 0; i < entries.length; i++) {
            var name = entries[i];
            var fullPath = path.join(dirPath, name);
            
            try {
                var itemStat = fs.statSync(fullPath);
                items.push({
                    name: name,
                    path: fullPath.substring(BASE_PATH.length) || '/',
                    isDirectory: itemStat.isDirectory(),
                    size: itemStat.size,
                    mtime: itemStat.mtime.getTime(),
                    mode: itemStat.mode
                });
            } catch (e) {
                // Skip items we can't stat
                dbg('Cannot stat ' + fullPath + ': ' + e.message);
            }
        }
        
        // Sort: directories first, then by name
        items.sort(function(a, b) {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'listDirResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: true,
            path: dirPath.substring(BASE_PATH.length) || '/',
            items: items
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'listDirResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: e.message
        });
    }
}

/**
 * Create a new directory
 */
function createDirectory(args) {
    var requestedPath = args.path;
    var validation = isPathAllowed(requestedPath);
    
    if (!validation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'createDirResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: validation.error
        });
        return;
    }
    
    var dirPath = validation.resolved;
    
    try {
        if (fs.existsSync(dirPath)) {
            throw new Error('Directory already exists');
        }
        
        fs.mkdirSync(dirPath, { recursive: true });
        
        // Change ownership
        changeOwnership(dirPath, function(success, error) {
            sendCommand({
                action: 'plugin',
                plugin: 'omniosfiles',
                pluginaction: 'createDirResult',
                requestId: args.requestId,
                sessionid: args.sessionid,
                success: true,
                path: dirPath.substring(BASE_PATH.length)
            });
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'createDirResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: e.message
        });
    }
}

/**
 * Delete a file or directory
 */
function deleteItem(args) {
    var requestedPath = args.path;
    var validation = isPathAllowed(requestedPath);
    
    if (!validation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'deleteResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: validation.error
        });
        return;
    }
    
    var targetPath = validation.resolved;
    
    // Prevent deleting base path itself
    if (targetPath === BASE_PATH) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'deleteResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: 'Cannot delete root directory'
        });
        return;
    }
    
    try {
        if (!fs.existsSync(targetPath)) {
            throw new Error('File or directory does not exist');
        }
        
        var stat = fs.statSync(targetPath);
        
        if (stat.isDirectory()) {
            // Recursive directory deletion
            deleteFolderRecursive(targetPath);
        } else {
            fs.unlinkSync(targetPath);
        }
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'deleteResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: true,
            path: targetPath.substring(BASE_PATH.length)
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'deleteResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: e.message
        });
    }
}

/**
 * Recursively delete a directory
 */
function deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
        var files = fs.readdirSync(folderPath);
        for (var i = 0; i < files.length; i++) {
            var curPath = path.join(folderPath, files[i]);
            if (fs.statSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        }
        fs.rmdirSync(folderPath);
    }
}

/**
 * Rename/move a file or directory
 */
function renameItem(args) {
    var srcValidation = isPathAllowed(args.srcPath);
    var dstValidation = isPathAllowed(args.dstPath);
    
    if (!srcValidation.allowed || !dstValidation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'renameResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: srcValidation.error || dstValidation.error
        });
        return;
    }
    
    try {
        if (!fs.existsSync(srcValidation.resolved)) {
            throw new Error('Source does not exist');
        }
        
        if (fs.existsSync(dstValidation.resolved)) {
            throw new Error('Destination already exists');
        }
        
        fs.renameSync(srcValidation.resolved, dstValidation.resolved);
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'renameResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: true,
            srcPath: srcValidation.resolved.substring(BASE_PATH.length),
            dstPath: dstValidation.resolved.substring(BASE_PATH.length)
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'renameResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: e.message
        });
    }
}

/**
 * Start file download - send metadata and prepare for chunked transfer
 */
function startDownload(args) {
    var requestedPath = args.path;
    var validation = isPathAllowed(requestedPath);
    
    if (!validation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'downloadError',
            requestId: args.requestId,
            sessionid: args.sessionid,
            error: validation.error
        });
        return;
    }
    
    var filePath = validation.resolved;
    
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('File does not exist');
        }
        
        var stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            throw new Error('Cannot download a directory');
        }
        
        var totalSize = stat.size;
        var totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
        var requestId = args.requestId;
        
        // Open file handle
        var fileHandle = fs.openSync(filePath, 'r');
        
        // Store download state
        activeDownloads[requestId] = {
            fileHandle: fileHandle,
            filePath: filePath,
            totalSize: totalSize,
            totalChunks: totalChunks,
            currentChunk: 0,
            sessionid: args.sessionid,
            cancelled: false
        };
        
        // Send metadata
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'downloadStart',
            requestId: requestId,
            sessionid: args.sessionid,
            fileName: path.basename(filePath),
            totalSize: totalSize,
            totalChunks: totalChunks,
            chunkSize: CHUNK_SIZE
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'downloadError',
            requestId: args.requestId,
            sessionid: args.sessionid,
            error: e.message
        });
    }
}

/**
 * Send next chunk for download
 */
function sendDownloadChunk(args) {
    var requestId = args.requestId;
    var chunkIndex = args.chunkIndex;
    var state = activeDownloads[requestId];
    
    if (!state || state.cancelled) {
        return;
    }
    
    try {
        var offset = chunkIndex * CHUNK_SIZE;
        var bytesToRead = Math.min(CHUNK_SIZE, state.totalSize - offset);
        
        if (bytesToRead <= 0) {
            // Download complete - compute checksum
            fs.closeSync(state.fileHandle);
            
            computeChecksumFallback(state.filePath, function(checksum, error) {
                sendCommand({
                    action: 'plugin',
                    plugin: 'omniosfiles',
                    pluginaction: 'downloadComplete',
                    requestId: requestId,
                    sessionid: state.sessionid,
                    checksum: checksum,
                    checksumError: error
                });
                
                delete activeDownloads[requestId];
            });
            return;
        }
        
        var buffer = Buffer.alloc(bytesToRead);
        var bytesRead = fs.readSync(state.fileHandle, buffer, 0, bytesToRead, offset);
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'downloadChunk',
            requestId: requestId,
            sessionid: state.sessionid,
            chunkIndex: chunkIndex,
            data: buffer.toString('base64'),
            bytesRead: bytesRead,
            isLast: (offset + bytesRead >= state.totalSize)
        });
        
        state.currentChunk = chunkIndex + 1;
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'downloadError',
            requestId: requestId,
            sessionid: state.sessionid,
            error: e.message
        });
        
        try { fs.closeSync(state.fileHandle); } catch (ex) {}
        delete activeDownloads[requestId];
    }
}

/**
 * Cancel an active download
 */
function cancelDownload(args) {
    var state = activeDownloads[args.requestId];
    if (state) {
        state.cancelled = true;
        try { fs.closeSync(state.fileHandle); } catch (e) {}
        delete activeDownloads[args.requestId];
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'downloadCancelled',
            requestId: args.requestId,
            sessionid: args.sessionid
        });
    }
}

/**
 * Start file upload - prepare to receive chunks
 */
function startUpload(args) {
    var requestedPath = args.path;
    var validation = isPathAllowed(requestedPath);
    
    if (!validation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'uploadError',
            requestId: args.requestId,
            sessionid: args.sessionid,
            error: validation.error
        });
        return;
    }
    
    var filePath = validation.resolved;
    var requestId = args.requestId;
    
    try {
        // Ensure parent directory exists
        var parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        
        // Create/truncate file
        var fileHandle = fs.openSync(filePath, 'w');
        
        // Store upload state
        activeUploads[requestId] = {
            fileHandle: fileHandle,
            filePath: filePath,
            totalSize: args.totalSize,
            receivedBytes: 0,
            sessionid: args.sessionid,
            clientChecksum: args.checksum,
            cancelled: false
        };
        
        // Signal ready
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'uploadReady',
            requestId: requestId,
            sessionid: args.sessionid
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'uploadError',
            requestId: args.requestId,
            sessionid: args.sessionid,
            error: e.message
        });
    }
}

/**
 * Receive upload chunk
 */
function receiveUploadChunk(args) {
    var requestId = args.requestId;
    var state = activeUploads[requestId];
    
    if (!state || state.cancelled) {
        return;
    }
    
    try {
        var buffer = Buffer.from(args.data, 'base64');
        var offset = args.chunkIndex * CHUNK_SIZE;
        
        fs.writeSync(state.fileHandle, buffer, 0, buffer.length, offset);
        state.receivedBytes += buffer.length;
        
        // Send acknowledgment
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'uploadAck',
            requestId: requestId,
            sessionid: state.sessionid,
            chunkIndex: args.chunkIndex,
            receivedBytes: state.receivedBytes
        });
        
        // Check if upload complete
        if (args.isLast || state.receivedBytes >= state.totalSize) {
            fs.closeSync(state.fileHandle);
            
            // Change ownership
            changeOwnership(state.filePath, function(ownerSuccess, ownerError) {
                // Compute checksum
                computeChecksumFallback(state.filePath, function(checksum, checksumError) {
                    var checksumMatch = state.clientChecksum ? 
                        (checksum === state.clientChecksum) : true;
                    
                    sendCommand({
                        action: 'plugin',
                        plugin: 'omniosfiles',
                        pluginaction: 'uploadComplete',
                        requestId: requestId,
                        sessionid: state.sessionid,
                        path: state.filePath.substring(BASE_PATH.length),
                        checksum: checksum,
                        checksumMatch: checksumMatch,
                        ownershipSet: ownerSuccess
                    });
                    
                    delete activeUploads[requestId];
                });
            });
        }
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'uploadError',
            requestId: requestId,
            sessionid: state.sessionid,
            error: e.message
        });
        
        try { 
            fs.closeSync(state.fileHandle);
            fs.unlinkSync(state.filePath);
        } catch (ex) {}
        delete activeUploads[requestId];
    }
}

/**
 * Cancel an active upload
 */
function cancelUpload(args) {
    var state = activeUploads[args.requestId];
    if (state) {
        state.cancelled = true;
        try { 
            fs.closeSync(state.fileHandle);
            fs.unlinkSync(state.filePath); // Delete partial file
        } catch (e) {}
        delete activeUploads[args.requestId];
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'uploadCancelled',
            requestId: args.requestId,
            sessionid: args.sessionid
        });
    }
}

/**
 * Get file info (stat)
 */
function getFileInfo(args) {
    var requestedPath = args.path;
    var validation = isPathAllowed(requestedPath);
    
    if (!validation.allowed) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'fileInfoResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: validation.error
        });
        return;
    }
    
    try {
        var stat = fs.statSync(validation.resolved);
        
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'fileInfoResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: true,
            info: {
                path: validation.resolved.substring(BASE_PATH.length),
                name: path.basename(validation.resolved),
                isDirectory: stat.isDirectory(),
                size: stat.size,
                mtime: stat.mtime.getTime(),
                mode: stat.mode
            }
        });
        
    } catch (e) {
        sendCommand({
            action: 'plugin',
            plugin: 'omniosfiles',
            pluginaction: 'fileInfoResult',
            requestId: args.requestId,
            sessionid: args.sessionid,
            success: false,
            error: e.message
        });
    }
}

/**
 * Main console action handler - entry point for all commands
 */
function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    
    if (!args.pluginaction) {
        dbg('No pluginaction specified');
        return;
    }
    
    // Add sessionid to args for response routing
    args.sessionid = sessionid;
    
    dbg('Action: ' + args.pluginaction);
    
    switch (args.pluginaction) {
        // Directory operations
        case 'listDir':
            listDirectory(args);
            break;
        case 'createDir':
            createDirectory(args);
            break;
        case 'delete':
            deleteItem(args);
            break;
        case 'rename':
            renameItem(args);
            break;
        case 'fileInfo':
            getFileInfo(args);
            break;
            
        // Download operations
        case 'startDownload':
            startDownload(args);
            break;
        case 'requestChunk':
            sendDownloadChunk(args);
            break;
        case 'cancelDownload':
            cancelDownload(args);
            break;
            
        // Upload operations
        case 'startUpload':
            startUpload(args);
            break;
        case 'uploadChunk':
            receiveUploadChunk(args);
            break;
        case 'cancelUpload':
            cancelUpload(args);
            break;
            
        default:
            dbg('Unknown action: ' + args.pluginaction);
    }
}

module.exports = { consoleaction: consoleaction };
