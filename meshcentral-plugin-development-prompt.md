# MeshCentral Plugin Development Guide

This document provides comprehensive examples and patterns for developing MeshCentral plugins based on existing community plugins.

## Table of Contents
1. [Plugin Structure Overview](#plugin-structure-overview)
2. [config.json - Plugin Manifest](#configjson---plugin-manifest)
3. [Main Plugin File (Backend)](#main-plugin-file-backend)
4. [Database Module](#database-module)
5. [Agent-Side Code (modules_meshcore)](#agent-side-code-modules_meshcore)
6. [Views (Handlebars Templates)](#views-handlebars-templates)
7. [Hook System](#hook-system)
8. [Communication Patterns](#communication-patterns)
9. [Complete Plugin Examples](#complete-plugin-examples)

---

## Plugin Structure Overview

A typical MeshCentral plugin has the following structure:

```
plugin-name/
├── config.json              # Plugin manifest (required)
├── pluginname.js            # Main backend plugin file (required)
├── db.js                    # Database operations (optional)
├── admin.js                 # Admin panel handler (optional)
├── modules_meshcore/        # Agent-side code (optional)
│   └── pluginname.js
├── views/                   # Handlebars templates (optional)
│   ├── admin.handlebars
│   └── user.handlebars
└── includes/                # Static assets (optional)
    ├── css/
    └── js/
```

---

## config.json - Plugin Manifest

The `config.json` file is required for every plugin. It defines metadata and installation information.

### Example 1: Simple Plugin (Sample)
```json
{
  "name": "Sample Plugin",
  "shortName": "sample",
  "version": "0.0.2",
  "author": "Ryan Blenis",
  "description": "A sample plugin. Prompt for note on remote desktop disconnect.",
  "hasAdminPanel": false,
  "homepage": "https://github.com/ryanblenis/MeshCentral-Sample",
  "changelogUrl": "https://raw.githubusercontent.com/ryanblenis/MeshCentral-Sample/master/changelog.md",
  "configUrl": "https://raw.githubusercontent.com/ryanblenis/MeshCentral-Sample/master/config.json",
  "downloadUrl": "https://github.com/ryanblenis/MeshCentral-Sample/archive/master.zip",
  "repository": {
    "type": "git",
    "url": "https://github.com/ryanblenis/MeshCentral-Sample.git"
  },
  "versionHistoryUrl": "https://api.github.com/repos/ryanblenis/MeshCentral-Sample/tags",
  "meshCentralCompat": ">=0.4.4-s"
}
```

### Example 2: Complex Plugin (ScriptTask)
```json
{
  "name": "ScriptTask",
  "shortName": "scripttask",
  "version": "0.0.20",
  "author": "Ryan Blenis",
  "description": "Script (PowerShell, BAT, Bash) runner for endpoints",
  "hasAdminPanel": false,
  "homepage": "https://github.com/ryanblenis/MeshCentral-ScriptTask",
  "changelogUrl": "https://raw.githubusercontent.com/ryanblenis/MeshCentral-ScriptTask/master/changelog.md",
  "configUrl": "https://raw.githubusercontent.com/ryanblenis/MeshCentral-ScriptTask/master/config.json",
  "downloadUrl": "https://github.com/ryanblenis/MeshCentral-ScriptTask/archive/master.zip",
  "repository": {
    "type": "git",
    "url": "https://github.com/ryanblenis/MeshCentral-ScriptTask.git"
  },
  "versionHistoryUrl": "https://api.github.com/repos/ryanblenis/MeshCentral-ScriptTask/tags",
  "meshCentralCompat": ">=1.1.35"
}
```

### Example 3: Hook Scheduler Plugin
```json
{
  "name": "Plugin Hook Scheduler",
  "shortName": "pluginhookscheduler",
  "version": "0.0.2",
  "author": "Daniel Hammerschmidt",
  "description": "Schedule plugin hook invocation order to resolve dependencies",
  "hasAdminPanel": false,
  "homepage": "https://github.com/bitctrl/MeshCentral-PluginHookScheduler",
  "changelogUrl": "https://raw.githubusercontent.com/bitctrl/MeshCentral-PluginHookScheduler/main/CHANGELOG.md",
  "configUrl": "https://raw.githubusercontent.com/bitctrl/MeshCentral-PluginHookScheduler/main/config.json",
  "downloadUrl": "https://github.com/bitctrl/MeshCentral-PluginHookScheduler/archive/main.zip",
  "repository": {
    "type": "git",
    "url": "https://github.com/bitctrl/MeshCentral-PluginHookScheduler.git"
  },
  "versionHistoryUrl": "https://github.com/bitctrl/MeshCentral-PluginHookScheduler/tags",
  "meshCentralCompat": ">=1.1.36"
}
```

### config.json Fields Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name of the plugin |
| `shortName` | Yes | Unique identifier (lowercase, no spaces) - used in code |
| `version` | Yes | Semantic version (X.Y.Z) |
| `author` | Yes | Plugin author name |
| `description` | Yes | Brief description |
| `hasAdminPanel` | Yes | `true` if plugin has admin UI panel |
| `homepage` | No | URL to plugin homepage/docs |
| `changelogUrl` | No | URL to changelog file |
| `configUrl` | Yes | URL to this config.json (for updates) |
| `downloadUrl` | Yes | URL to download plugin archive |
| `repository` | No | Repository information |
| `versionHistoryUrl` | No | URL to version tags |
| `meshCentralCompat` | No | MeshCentral version compatibility |

---

## Main Plugin File (Backend)

The main plugin file exports a function that returns an object with hooks and methods.

### Example 1: Simple Plugin (Sample)
```javascript
/** 
* @description MeshCentral Sample Plugin
* @author Ryan Blenis
* @license Apache-2.0
*/

"use strict";

module.exports.sample = function (parent) {
    var obj = {};
    obj.parent = parent; // Keep reference to pluginHandler
    
    // Export functions to web UI
    obj.exports = [
      "onDesktopDisconnect"
    ];
    
    // Called when desktop disconnect button is clicked
    obj.onDesktopDisconnect = function() {
        writeDeviceEvent(encodeURIComponent(currentNode._id));
        Q('d2devEvent').value = Date().toLocaleString() + ': ';
        focusTextBox('d2devEvent');
    }
    
    return obj;
}
```

### Example 2: DevTools Plugin (With Admin Panel)
```javascript
/** 
* @description MeshCentral DevTools Plugin
* @author Ryan Blenis
* @license Apache-2.0
*/

"use strict";

module.exports.devtools = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.VIEWS = __dirname + '/views/';
    
    // Handle admin panel requests
    obj.handleAdminReq = function(req, res, user) {
        if ((user.siteadmin & 0xFFFFFFFF) == 0) { 
            res.sendStatus(401); 
            return; 
        }
        var vars = {};
        res.render(obj.VIEWS + 'admin', vars);
    };
    
    // Handle server-side actions from frontend
    obj.serveraction = function(command, myparent, grandparent) {
        switch (command.pluginaction) {
            case 'addPluginConfig':
                if (command.cfg.status == null) command.cfg.status = 1;
                obj.meshServer.db.addPlugin(command.cfg, function() {
                    obj.meshServer.db.getPlugins(function(err, docs) {
                        try { 
                            myparent.ws.send(JSON.stringify({ 
                                action: 'updatePluginList', 
                                list: docs, 
                                result: err 
                            })); 
                        } catch (ex) { } 
                    });
                });
                break;
                
            case 'refreshPluginHandler':
                var targets = ['*', 'server-users'];
                obj.meshServer.DispatchEvent(targets, obj, { 
                    action: 'pluginStateChange' 
                });
                break;
                
            case 'getPluginConfig':
                obj.meshServer.db.getPlugin(command.id, (err, conf) => {
                    myparent.ws.send(JSON.stringify({ 
                        action: 'plugin', 
                        plugin: "devtools", 
                        method: "loadEditPluginConfig", 
                        conf: conf, 
                        result: err 
                    }));
                });
                break;
                
            case 'savePluginConfig':
                obj.meshServer.db.updatePlugin(command.id, command.conf, (err, conf) => {
                    obj.meshServer.db.getPlugins(function(err, docs) {
                        try { 
                            myparent.ws.send(JSON.stringify({ 
                                action: 'updatePluginList', 
                                list: docs, 
                                result: err 
                            })); 
                        } catch (ex) { } 
                    });
                });
                break;
                
            case 'deletePluginConfig':
                obj.meshServer.db.deletePlugin(command.id, (err, conf) => {
                    obj.meshServer.db.getPlugins(function(err, docs) {
                        try { 
                            myparent.ws.send(JSON.stringify({ 
                                action: 'updatePluginList', 
                                list: docs, 
                                result: err 
                            })); 
                        } catch (ex) { } 
                    });
                });
                break;
                
            case 'restartServer':
                process.exit(123);
                break;
                
            default:
                console.log('PLUGIN: devtools: unknown action');
                break;
        }
    };
    
    return obj;
}
```

### Example 3: FileDist Plugin (Complex with hooks, db, agent communication)
```javascript
/** 
* @description MeshCentral File Distribution Plugin
* @author Ryan Blenis
* @license Apache-2.0
*/

"use strict";

module.exports.filedist = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.db = null;  // Will be set later
    obj.VIEWS = __dirname + '/views/';
    obj.path = require('path');
    obj.intervalTimer = null;
    
    // Functions exported to web UI
    obj.exports = [
      'onDeviceRefreshEnd',
      'mapData'
    ];
    
    var PLUGIN_L = 'filedist';  // lowercase
    var PLUGIN_C = 'FileDist';  // capitalized
    
    // Send all file maps to agent
    obj.sendAllMaps = function(comp, maps) {
        const command = {
            action: 'plugin',
            plugin: 'filedist',
            pluginaction: 'setMaps',
            maps: maps
        };
        try { 
            obj.debug('PLUGIN', PLUGIN_C, 'Sending file maps to ' + comp);
            obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
        } catch (e) { 
            obj.debug('PLUGIN', PLUGIN_C, 'Could not send file maps to ' + comp); 
        }
    };
    
    // Send single file map to agent
    obj.sendMap = function(comp, map) {
        const command = {
            action: 'plugin',
            plugin: 'filedist',
            pluginaction: 'addMap',
            map: map
        };
        try { 
            obj.debug('PLUGIN', PLUGIN_C, 'Sending file map to ' + comp);
            obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
        } catch (e) { 
            obj.debug('PLUGIN', PLUGIN_C, 'Could not send file map to ' + comp); 
        }
    };
    
    // Hook: Called when agent core is stable
    obj.hook_agentCoreIsStable = function(myparent, gp) {
        obj.db.getFileMapsForNode(myparent.dbNodeKey)
        .then((maps) => {
            if (maps.length) {
                obj.sendAllMaps(myparent.dbNodeKey, maps);
            }
        })
    };
    
    // Periodic check of file sizes
    obj.checkFileSizes = function() {
        var onlineAgents = Object.keys(obj.meshServer.webserver.wsagents);
        var checked = [];
        obj.db.getServerFiles()
        .then((maps) => {
            if (maps.length) {
                maps.forEach(function(m) {
                    if (checked.indexOf(m.serverpath) == -1) {
                        // Check file and update if needed
                        checked.push(m.serverpath);
                    }
                });
            }
        });
    };
    
    return obj;
}
```

### Example 4: EventLog Plugin (With database, hooks, admin panel)
```javascript
/** 
* @description MeshCentral event log plugin
* @author Ryan Blenis
* @license Apache-2.0
*/

"use strict";

module.exports.eventlog = function(parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.db = null;
    obj.VIEWS = __dirname + '/views/';
    
    // Admin panel handler
    obj.handleAdminReq = function(req, res, user) {
        var adminObj = require('./admin.js').admin(obj);
        return adminObj.req(req, res, user);
    };
    
    // Hook: Agent core is stable
    obj.hook_agentCoreIsStable = function(myparent, grandparent) {
        if (grandparent == null) {
            // Backward compatibility
            grandparent = myparent[1];
            myparent = myparent[0];
        }
        
        // Send service check command to agent
        myparent.send(JSON.stringify({ 
            action: 'plugin', 
            pluginaction: 'serviceCheck', 
            plugin: 'eventlog',
            nodeid: myparent.dbNodeKey, 
            rights: true,
            sessionid: true
        }));
        
        // Send config to agent
        obj.db.getConfigFor(myparent.dbNodeKey, myparent.dbMeshKey)
        .then((cfgBlob) => {
            myparent.send(JSON.stringify({ 
                action: 'plugin', 
                pluginaction: 'setConfigBlob', 
                plugin: 'eventlog',
                nodeid: myparent.dbNodeKey, 
                rights: true,
                sessionid: true,
                cfg: cfgBlob
            }));
        });
    };
    
    // Server action handler
    obj.serveraction = function(command, myparent, grandparent) {
        var myobj = { parent: myparent };

        switch (command.pluginaction) {
            case 'sendlog':
                command.method = 'fe_on_message';
                if (command.sessionid != null) {
                    if (typeof command.sessionid != 'string') break;
                    var splitsessionid = command.sessionid.split('/');
                    // Process and forward to user session
                }
                break;
                
            case 'getNodeHistory':
                try {
                    obj.db.getConfigFor(command.nodeid, command.meshid)
                    .then((cfg) => {
                        obj.db.getEventsFor(command.nodeid, cfg, function(events) {
                            if (myobj.parent.ws != null) {
                                myobj.parent.ws.send(JSON.stringify({ 
                                    action: 'plugin', 
                                    plugin: 'eventlog', 
                                    method: 'onLoadHistory', 
                                    events: events, 
                                    config: cfg 
                                }));
                            }
                        });
                    });
                } catch (e) { 
                    console.log('PLUGIN: eventlog: getNodeHistory error: ', e); 
                }
                break;
                
            case 'adminSaveConfig':
                let opts = {...command.opts, ...{}};
                if (command.id == '_default') {
                    obj.db.updateDefaultConfig(opts)
                    .catch((e) => console.log('EVENTLOG: Error saving config'));
                } else {
                    obj.db.updateConfig(command.id, opts)
                    .then((d) => {
                        return obj.db.getAllConfigSets();
                    })
                    .then((d) => {
                        var x = { 
                            action: "plugin", 
                            plugin: "eventlog", 
                            method: "adminUpdateConfigSets", 
                            sets: d,
                            selected: command.id
                        };
                        myobj.parent.ws.send(JSON.stringify(x));
                    })
                    .catch((e) => console.log('EVENTLOG: Error saving config', e));
                }
                break;
                
            default:
                break;
        }
    };
    
    return obj;
};
```

### Example 5: RoutePlus Plugin (Complex networking)
```javascript
/** 
* @description MeshCentral RoutePlus Plugin
* @author Ryan Blenis
* @license Apache-2.0
*/

"use strict";

module.exports.routeplus = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.db = null;
    obj.VIEWS = __dirname + '/views/';
    obj.onlineNodes = [];
    
    obj.exports = [
        'mapUpdate',
        'myComputerUpdate',
        'setUserRdpLinks',
        'cantMap',
        'openSettings',
        'resizeContent',
        'goPageStart',
        'dlRDPfile',
        'updateRdpDeviceLinks',
        'onDeviceRefreshEnd'
    ];
    
    // Start route on agent
    obj.startRoute = function(comp, map, rcookie) {
        const command = {
            action: 'plugin',
            plugin: 'routeplus',
            pluginaction: 'startRoute',
            mid: map._id,
            rauth: rcookie,
            nodeid: map.toNode,
            remotetarget: map.toIP,
            remoteport: map.port,
            localport: map.localport,
            forceSrcPort: map.forceSrcPort ? map.forceSrcPort : false
        };
        try { 
            obj.debug('PLUGIN', 'RoutePlus', 'Starting route ' + map._id + ' to ' + comp);
            obj.meshServer.webserver.wsagents[comp].send(JSON.stringify(command)); 
        } catch (e) { 
            obj.debug('PLUGIN', 'RoutePlus', 'Could not send map to ' + comp); 
        }
    };
    
    // Hook: User logged in
    obj.hook_userLoggedIn = function(user) {
        var myComp = null;
        const rcookie = parent.parent.encodeCookie(
            { userid: user._id, domainid: user.domain }, 
            obj.meshServer.loginCookieEncryptionKey
        );
        obj.debug('PLUGIN', 'RoutePlus', 'User logged in... Processing');
        obj.onlineNodes = Object.keys(obj.meshServer.webserver.wsagents);
        
        obj.db.getMyComputer(user._id)
        .then(mys => {
            if (mys.length) {
                myComp = mys[0].node;
            }
            return obj.db.getUserMaps(user._id);
        })
        .then((maps) => {
            if (myComp == null) return;
            obj.debug('PLUGIN', 'RoutePlus', 'Number of user maps found: ' + maps.length);
            if (maps.length == 0) return;
            maps.forEach(map => {
                obj.startRoute(myComp, map, rcookie);
            });
        })
        .catch(e => console.log('PLUGIN: RoutePlus: Error: ', e));
    };
    
    // Hook: Agent core is stable
    obj.hook_agentCoreIsStable = function(myparent, gp) {
        obj.db.getMyComputerByNode(myparent.dbNodeKey)
        .then((mys) => {
            if (mys.length) {
                var my = mys[0];
                obj.db.getUserMaps(my.user)
                .then(maps => {
                    var onlineUsers = Object.keys(obj.meshServer.webserver.wssessions);
                    if (maps.length && onlineUsers.indexOf(my.user) !== -1) {
                        var uinfo = my.user.split('/');
                        var rcookie = parent.parent.encodeCookie(
                            { userid: my.user, domainid: uinfo[1] }, 
                            obj.meshServer.loginCookieEncryptionKey
                        );
                        maps.forEach(function(map) {
                            obj.startRoute(my.node, map, rcookie);
                        });
                    }
                })
                .catch(e => console.log('PLUGIN: RoutePlus: Error: ', e));
            }
        })
        .catch(e => console.log('PLUGIN: RoutePlus: Error: ', e));
    };
    
    // Admin request handler
    obj.handleAdminReq = function(req, res, user) {
        if ((user.siteadmin & 0xFFFFFFFF) == 1 && req.query.admin == 1) {
            var vars = {};
            res.render(obj.VIEWS + 'admin', vars);
            return;
        } else {
            var vars = {};
            obj.db.getUserMaps(user._id)
            .then(maps => {
                vars.mappings = maps.length ? JSON.stringify(maps) : 'null';
                return obj.db.getMyComputer(user._id);
            })
            .then(mys => {
                vars.myComputer = mys.length ? JSON.stringify(mys[0]) : 'null';
                return Promise.resolve();
            })
            .then(() => {
                res.render(obj.VIEWS + 'user', vars);
            })
            .catch(e => console.log('PLUGIN: RoutePlus: Error: ', e));
            return;
        }
        res.sendStatus(401);
    };
    
    // Server action handler
    obj.serveraction = function(command, myparent, grandparent) {
        switch (command.pluginaction) {
            case 'addMap':
                var newMapId = null, myComp = null;
                obj.db.addMap(
                    command.user, 
                    command.toNode, 
                    command.port, 
                    command.srcport, 
                    command.forceSrcPort, 
                    command.toIP
                )
                .then((newMapInfo) => {
                    newMapId = newMapInfo.insertedId;
                    return obj.db.getUserMaps(command.user);
                })
                .then(maps => {
                    var x = { 
                        action: "plugin", 
                        plugin: "routeplus", 
                        method: "mapUpdate", 
                        data: maps
                    };
                    myparent.ws.send(JSON.stringify(x));
                    return obj.db.getMyComputer(command.user);
                })
                .then((mcs) => {
                    myComp = mcs[0].node;
                    return obj.db.get(newMapId);
                })
                .then((maps) => {
                    var uinfo = command.user.split('/');
                    var rcookie = parent.parent.encodeCookie(
                        { userid: command.user, domainid: uinfo[1] }, 
                        obj.meshServer.loginCookieEncryptionKey
                    );
                    obj.startRoute(myComp, maps[0], rcookie);
                })
                .catch(e => console.log('PLUGIN: RoutePlus: Error: ', e));
                break;
                
            case 'removeMap':
                obj.removeMapFromComp(command.id);
                break;
                
            case 'setMyComputer':
                // Complex logic to update computer mappings
                break;
                
            default:
                console.log('PLUGIN: routeplus: unknown action');
                break;
        }
    };
    
    // Update frontend via events
    obj.updateFrontEnd = function(ids) {
        if (ids.user != null) {
            obj.db.getUserMaps(ids.user)
            .then((userMaps) => {
                var targets = ['*', 'server-users'];
                obj.meshServer.DispatchEvent(targets, obj, { 
                    nolog: true, 
                    action: 'plugin', 
                    plugin: 'routeplus', 
                    method: 'mapUpdate', 
                    data: userMaps 
                });
            });
        }
    };
    
    return obj;
};
```

---

## Database Module

Database modules provide data persistence using MongoDB or NeDB.

### Example: WorkFromHome Database
```javascript
/** 
* @description MeshCentral-WorkFromHome database module
* @author Ryan Blenis
* @license Apache-2.0
*/

"use strict";
require('promise');
var Datastore = null;

module.exports.CreateDB = function(meshserver) {
    var obj = {};
    var formatId = null;
    
    if (meshserver.args.mongodb) {
        // MongoDB setup
        require('mongodb').MongoClient.connect(
            meshserver.args.mongodb, 
            { useNewUrlParser: true, useUnifiedTopology: true }, 
            function (err, client) {
                if (err != null) { 
                    console.log("Unable to connect to database: " + err); 
                    process.exit(); 
                    return; 
                }
                Datastore = client;
                
                var dbname = 'meshcentral';
                if (meshserver.args.mongodbname) { 
                    dbname = meshserver.args.mongodbname; 
                }
                const db = client.db(dbname);
                
                obj.file = db.collection('plugin_workfromhome');
                obj.file.indexes(function (err, indexes) {
                    var indexesByName = {}, indexCount = 0;
                    for (var i in indexes) { 
                        indexesByName[indexes[i].name] = indexes[i]; 
                        indexCount++; 
                    }
                    if (indexCount != 1) {
                        console.log('Resetting plugin (WorkFromHome) indexes...');
                        obj.file.dropIndexes(function (err) {
                            // Create indexes
                        }); 
                    }
                });
                
                // Set up formatId
                if (typeof require('mongodb').ObjectID == 'function') {
                    formatId = require('mongodb').ObjectID;
                } else {
                    formatId = require('mongodb').ObjectId;
                }
                obj.initFunctions();
            }
        );  
    } else {
        // NeDB setup
        try { 
            Datastore = require('@seald-io/nedb'); 
        } catch (ex) { }
        
        if (Datastore == null) {
            try { 
                Datastore = require('@yetzt/nedb'); 
            } catch (ex) { }
            if (Datastore == null) { 
                Datastore = require('nedb'); 
            }
        }

        if (obj.filex == null) {
            obj.filex = new Datastore({ 
                filename: meshserver.getConfigFilePath('plugin-workfromhome.db'), 
                autoload: true 
            });
            obj.filex.setAutocompactionInterval(40000);
        }
        
        obj.file = new NEMongo(obj.filex);
        formatId = function(id) { return id; };
        obj.initFunctions();
    }
    
    // Initialize database functions
    obj.initFunctions = function() {
        // Get all maps for a user
        obj.getMaps = function(nodeId) {
            return obj.file.find({ fromNode: nodeId }).toArray();
        };
        
        // Add a new map
        obj.addMap = function(fromNode, toNode, port, label) {
            return obj.file.insertOne({ 
                fromNode: fromNode, 
                toNode: toNode, 
                port: port, 
                rdplabel: label,
                type: 'workMap' 
            });
        };
        
        // Get by ID
        obj.get = function(id) {
            return obj.file.find({ _id: formatId(id) }).toArray();
        };
        
        // Delete by ID
        obj.delete = function(id) {
            return obj.file.deleteOne({ _id: formatId(id) });
        };
        
        // Update by ID
        obj.update = function(id, args) {
            return obj.file.updateOne(
                { _id: formatId(id) }, 
                { $set: args }
            );
        };
    };
    
    return obj;
}

// NeDB to MongoDB compatibility wrapper
function NEMongo(nedb) {
    this.nedb = nedb;
    
    this.find = function(query) {
        var self = this;
        return {
            toArray: function() {
                return new Promise((resolve, reject) => {
                    self.nedb.find(query, function(err, docs) {
                        if (err) reject(err);
                        else resolve(docs);
                    });
                });
            }
        };
    };
    
    this.insertOne = function(doc) {
        var self = this;
        return new Promise((resolve, reject) => {
            self.nedb.insert(doc, function(err, newDoc) {
                if (err) reject(err);
                else resolve({ insertedId: newDoc._id });
            });
        });
    };
    
    this.updateOne = function(query, update) {
        var self = this;
        return new Promise((resolve, reject) => {
            self.nedb.update(query, update, {}, function(err, numAffected) {
                if (err) reject(err);
                else resolve({ modifiedCount: numAffected });
            });
        });
    };
    
    this.deleteOne = function(query) {
        var self = this;
        return new Promise((resolve, reject) => {
            self.nedb.remove(query, {}, function(err, numRemoved) {
                if (err) reject(err);
                else resolve({ deletedCount: numRemoved });
            });
        });
    };
}
```

---

## Agent-Side Code (modules_meshcore)

Agent-side code runs on the mesh agent and communicates with the server.

### Example 1: Simple Agent Module (OmniOS Version)
```javascript
/**
* @description MeshCentral OmniOS Version plugin (agent side)
*/

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();
var fs = require('fs');

function dbg(msg) {
    try {
        require('MeshAgent').SendCommand({ 
            action: 'msg', 
            type: 'console', 
            value: '[omniosversion-agent] ' + msg 
        });
    } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;
    
    // Handle websocket vs console calls
    if (typeof args['_'] == 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
        args['_'][2] = null;
        isWsconnection = true;
    }

    var fnname = args['_'][1];
    mesh = parent;
    
    dbg('consoleaction called with action: ' + fnname);

    switch (fnname) {
        case 'readOmni':
            dbg('readOmni action called');
            readOmniFile();
            break;
        case 'readLaunchpad':
            dbg('readLaunchpad action called');
            readLaunchpadFile();
            break;
        default:
            dbg('Unknown action: ' + fnname);
            break;
    }
}

function readOmniFile() {
    dbg('readOmniFile called');
    var cacheKey = 'plugin_OmniOSVersion_cache';
    var cached = db.Get(cacheKey);
    
    if (cached && cached.version !== undefined) {
        dbg('Found cached version: ' + cached.version);
        sendVersion(cached.version);
        return;
    }
    
    dbg('No cache found, reading file /etc/OmniOS');
    var version = null;
    
    try {
        if (fs.existsSync('/etc/OmniOS')) {
            dbg('File /etc/OmniOS exists, reading...');
            var content = fs.readFileSync('/etc/OmniOS').toString();
            var lines = content.split(/\r?\n/);
            
            lines.forEach(function (line) {
                if (!line) return;
                var parts = line.split('=');
                if (parts.length >= 2 && parts[0].trim() === 'VERSION') {
                    version = parts[1].trim();
                }
            });
            
            if (version) {
                db.Put(cacheKey, { version: version });
            }
        }
    } catch (e) {
        dbg('Error reading file: ' + e.message);
    }
    
    sendVersion(version);
}

function sendVersion(version) {
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'omniData',
            sessionid: _sessionid,
            tag: 'console',
            version: version
        };
        dbg('Sending version to server: ' + version);
        mesh.SendCommand(cmd);
    } catch (e) {
        dbg('Error sending version: ' + e.message);
    }
}

function sendConsoleText(text, sessionid) {
    if (typeof text == 'object') { text = JSON.stringify(text); }
    mesh.SendCommand({ 
        "action": "msg", 
        "type": "console", 
        "value": text, 
        "sessionid": sessionid 
    });
}

module.exports = { consoleaction: consoleaction };
```

### Example 2: ScriptTask Agent Module
```javascript
/**
* @description MeshCentral ScriptTask plugin (agent side)
*/

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();
var pendingDownload = [];
var runningJobs = [];
var runningJobPIDs = {};
var debug_flag = false;

// Array remove helper
Array.prototype.remove = function(from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

function dbg(msg) {
    if (!debug_flag) return;
    require('MeshAgent').SendCommand({ 
        action: 'msg', 
        type: 'console', 
        value: 'ScriptTask: ' + msg 
    });
}

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;
    
    if (typeof args['_'] == 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
        args['_'][2] = null;
        isWsconnection = true;
    }
    
    var fnname = args['_'][1];
    mesh = parent;
    
    switch (fnname) {
        case 'triggerJob':
            var jObj = { 
                jobId: args.jobId,
                scriptId: args.scriptId,
                replaceVars: args.replaceVars,
                scriptHash: args.scriptHash,
                dispatchTime: args.dispatchTime
            };
            var sObj = getScriptFromCache(jObj.scriptId);
            
            if (sObj == null || sObj.contentHash != jObj.scriptHash) {
                // Get script from server
                mesh.SendCommand({ 
                    "action": "plugin", 
                    "plugin": "scripttask",
                    "pluginaction": "getScript",
                    "scriptId": jObj.scriptId, 
                    "sessionid": _sessionid,
                    "tag": "console"
                });
                pendingDownload.push(jObj);
            } else {
                runScript(sObj, jObj);
            }
            break;
            
        case 'cacheScript':
            var sObj = args.script;
            cacheScript(sObj);
            var setRun = [];
            if (pendingDownload.length) {
                pendingDownload.forEach(function(pd, k) { 
                    if (pd.scriptId == sObj._id && pd.scriptHash == sObj.contentHash) {
                        if (setRun.indexOf(pd) === -1) {
                            runScript(sObj, pd);
                            setRun.push(pd);
                        }
                        pendingDownload.remove(k);
                    }
                });
            }
            break;
            
        case 'clearAll':
            clearCache();
            mesh.SendCommand({ 
                "action": "plugin", 
                "plugin": "scripttask",
                "pluginaction": "clearAllPendingJobs",
                "sessionid": _sessionid,
                "tag": "console"
            });
            return 'Cache cleared. All pending jobs cleared.';
            
        case 'clearCache':
            clearCache();
            return 'The script cache has been cleared';
            
        case 'debug':
            debug_flag = !debug_flag;
            return 'Debug is now ' + (debug_flag ? 'on' : 'off');
    }
}

function getScriptFromCache(id) {
    var script = db.Get('pluginScriptTask_script_' + id);
    if (script == '' || script == null) return null;
    try {
        script = JSON.parse(script);
    } catch (e) { return null; }
    return script;
}

function cacheScript(sObj) {
    db.Put('pluginScriptTask_script_' + sObj._id, sObj);
}

function clearCache() {
    db.Keys.forEach(function(k) {
        if (k.indexOf('pluginScriptTask_script_') === 0) {
            db.Put(k, null);
            db.Delete(k);
        }
    });
}

function runScript(sObj, jObj) {
    if (jobIsRunning(jObj)) { 
        dbg('Job already running: ' + jObj.jobId); 
        return; 
    }
    
    // Replace variables
    if (jObj.replaceVars != null) {
        Object.getOwnPropertyNames(jObj.replaceVars).forEach(function(key) {
            var val = jObj.replaceVars[key];
            sObj.content = sObj.content.replace(new RegExp('#'+key+'#', 'g'), val);
            dbg('Replacing var ' + key + ' with ' + val);
        });
        sObj.content = sObj.content.replace(new RegExp('#(.*?)#', 'g'), 'VAR_NOT_FOUND');
    }
    
    runningJobs.push(jObj.jobId);
    dbg('Running Script ' + sObj._id);
    
    switch (sObj.filetype) {
        case 'ps1':
            runPowerShell(sObj, jObj);
            break;
        case 'bat':
            runBat(sObj, jObj);
            break;
        case 'bash':
            runBash(sObj, jObj);
            break;
        default:
            dbg('Unknown filetype: ' + sObj.filetype);
            break;
    }
}

function runBash(sObj, jObj) {
    // Implementation for bash scripts
    try {
        var fs = require('fs');
        var path = '/tmp/';
        var pName = 'script_' + jObj.jobId + '.sh';
        var oName = 'output_' + jObj.jobId + '.txt';
        
        fs.writeFileSync(path + pName, sObj.content);
        
        var child = require('child_process').execFile(
            '/bin/bash', 
            [path + pName], 
            { cwd: path }
        );
        
        runningJobPIDs[jObj.jobId] = child.pid;
        child.stdout.str = '';
        child.stderr.str = '';
        
        child.stdout.on('data', function(c) { this.str += c.toString(); });
        child.stderr.on('data', function(c) { this.str += c.toString(); });
        
        child.on('exit', function(code) {
            var outstr = this.stdout.str;
            try {
                fs.unlinkSync(path + pName);
            } catch (e) { }
            finalizeJob(jObj, outstr);
        });
    } catch (e) { 
        dbg('Error: ' + e);
        finalizeJob(jObj, null, e);
    }
}

function finalizeJob(jObj, retVal, errVal) {
    var idx = runningJobs.indexOf(jObj.jobId);
    if (idx !== -1) runningJobs.remove(idx);
    delete runningJobPIDs[jObj.jobId];
    
    mesh.SendCommand({ 
        "action": "plugin", 
        "plugin": "scripttask",
        "pluginaction": "jobComplete",
        "jobId": jObj.jobId,
        "scriptId": jObj.scriptId,
        "retVal": retVal,
        "errVal": errVal,
        "dispatchTime": jObj.dispatchTime,
        "sessionid": _sessionid,
        "tag": "console"
    });
}

function jobIsRunning(jObj) {
    return runningJobs.indexOf(jObj.jobId) !== -1;
}

function sendConsoleText(text, sessionid) {
    if (typeof text == 'object') { text = JSON.stringify(text); }
    mesh.SendCommand({ 
        "action": "msg", 
        "type": "console", 
        "value": text, 
        "sessionid": sessionid 
    });
}

module.exports = { consoleaction: consoleaction };
```

### Example 3: RoutePlus Agent Module (Networking)
```javascript
/**
* @description MeshCentral RoutePlus plugin (agent side)
*/

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();
var net = require('net');
var http = require('http');

var routeTrack = {};
var latestAuthCookie = null;
var waitTimer = {};
var debug_flag = false;

function dbg(msg) {
    if (!debug_flag) return;
    try {
        require('MeshAgent').SendCommand({ 
            action: 'msg', 
            type: 'console', 
            value: 'RoutePlus: ' + msg 
        });
    } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;
    
    if (typeof args['_'] == 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
        isWsconnection = true;
    }
    
    var fnname = args['_'][1];
    mesh = parent;
    
    switch (fnname) {
        case 'startRoute':
            // Check for existing route
            if (routeTrack[args.mid] != null) {
                try {
                    if (routeTrack[args.mid].tcpserver.address() != null) {
                        dbg('Route exists, leaving intact');
                        return;
                    }
                } catch (e) { }
                dbg('Destroying connection to rebuild: ' + args.mid);
                routeTrack[args.mid].tcpserver.close();
                delete routeTrack[args.mid];
            }
            
            if (waitTimer[args.mid] != null) clearTimeout(waitTimer[args.mid]);
            dbg('Starting Route');
            
            latestAuthCookie = args.rauth;
            var r = new RoutePlusRoute();
            var settings = {
                serverurl: mesh.ServerUrl.replace('agent.ashx', 'meshrelay.ashx'),
                remotenodeid: args.nodeid,
                remotetarget: args.remotetarget,
                remoteport: args.remoteport,
                localport: args.localport == null ? 0 : args.localport,
                forceSrcPort: args.forceSrcPort
            };
            
            var was_error = false;
            try {
                r.startRouter(settings);
                routeTrack[args.mid] = r;
            } catch (e) { 
                was_error = true; 
            }
            
            if (was_error && args.forceSrcPort == true) {
                dbg('Source port unavailable: ' + args.localport);
                mesh.SendCommand({ 
                    "action": "plugin", 
                    "plugin": "routeplus",
                    "pluginaction": "cantMapPort",
                    "sessionid": _sessionid,
                    "tag": "console",
                    "mid": args.mid
                });
                return;
            }
            
            if (was_error && args.forceSrcPort == false) {
                settings.localport = 0;
                try {
                    r.startRouter(settings);
                    routeTrack[args.mid] = r;
                } catch (e) { 
                    was_error = true; 
                }
            }
            
            var actualLocalPort = r.tcpserver.address().port;
            dbg('Listening on ' + actualLocalPort);
            
            if (args.localport != actualLocalPort) {
                dbg('Sending updated port ' + actualLocalPort);
                mesh.SendCommand({ 
                    "action": "plugin", 
                    "plugin": "routeplus",
                    "pluginaction": "updateMapPort",
                    "sessionid": _sessionid,
                    "tag": "console",
                    "mid": args.mid,
                    "port": actualLocalPort
                });
            }
            break;
            
        case 'endRoute':
            dbg('Attempting to end route for ' + args.mid);
            if (routeTrack[args.mid] != null) {
                dbg('Ending route for ' + args.mid);
                routeTrack[args.mid].tcpserver.close();
                delete routeTrack[args.mid];
            }
            break;
            
        case 'updateCookie':
            latestAuthCookie = args.rauth;
            break;
            
        case 'list':
            var s = '', count = 1;
            Object.keys(routeTrack).forEach(function (k) {
                s += count + ': Port ' + routeTrack[k].tcpserver.address().port + 
                     ' (Map ID: ' + k + ')\n';
                count++;
            });
            return s == '' ? 'No active port mappings' : s;
            
        default:
            dbg('Unknown action: ' + fnname);
            break;
    }
}

function RoutePlusRoute() {
    var rObj = {};
    rObj.settings = null;
    rObj.tcpserver = null;
    
    rObj.startRouter = function(settings) {
        this.settings = settings;
        this.tcpserver = net.createServer(this.OnTcpClientConnected);
        this.tcpserver.on('error', function (e) { 
            dbg("ERROR: " + JSON.stringify(e)); 
        });
        
        var t = this;
        this.tcpserver.listen(this.settings.localport, function () {
            if (t.settings.remotetarget == null) {
                dbg('Redirecting local port to remote port ' + t.settings.remoteport);
            } else {
                dbg('Redirecting to ' + t.settings.remotetarget + ':' + t.settings.remoteport);
            }
        });
    };
    
    rObj.OnTcpClientConnected = function (c) {
        try {
            c.on('end', function () { 
                disconnectTunnel(this, this.websocket, "Client closed"); 
            });
            c.pause();
            
            var options = http.parseUri(
                rObj.settings.serverurl + '?noping=1&auth=' + latestAuthCookie + 
                '&nodeid=' + rObj.settings.remotenodeid + 
                '&tcpport=' + rObj.settings.remoteport + 
                (rObj.settings.remotetarget == null ? '' : 
                 '&tcpaddr=' + rObj.settings.remotetarget)
            );
            options.rejectUnauthorized = false;
            
            c.websocket = http.request(options);
            c.websocket.tcp = c;
            c.websocket.tunneling = false;
            c.websocket.upgrade = OnWebSocket;
            c.websocket.on('error', function (e) { 
                dbg("ERROR: " + JSON.stringify(e)); 
            });
            c.websocket.end();
        } catch (e) { 
            dbg('Error: ' + e); 
        }
    };
    
    return rObj;
}

function OnWebSocket(msg, s, head) {
    dbg("Websocket connected");
    s.on('data', function (msg) {
        if (this.parent.tunneling == false) {
            msg = msg.toString();
            if ((msg == 'c') || (msg == 'cr')) {
                this.parent.tunneling = true;
                this.pipe(this.parent.tcp);
                this.parent.tcp.pipe(this);
                dbg("Tunnel active");
            } else if ((msg.length > 6) && (msg.substring(0, 6) == 'error:')) {
                disconnectTunnel(this.tcp, this, msg.substring(6));
            }
        }
    });
    s.on('error', function (msg) { 
        disconnectTunnel(this.tcp, this, 'Websocket error'); 
    });
    s.on('close', function (msg) { 
        disconnectTunnel(this.tcp, this, 'Websocket closed'); 
    });
    s.parent = this;
}

function disconnectTunnel(tcp, ws, msg) {
    if (ws != null) { try { ws.end(); } catch (e) { } }
    if (tcp != null) { try { tcp.end(); } catch (e) { } }
    dbg("Tunnel disconnected: " + msg);
}

function sendConsoleText(text, sessionid) {
    if (typeof text == 'object') { text = JSON.stringify(text); }
    mesh.SendCommand({ 
        "action": "msg", 
        "type": "console", 
        "value": text, 
        "sessionid": sessionid 
    });
}

module.exports = { consoleaction: consoleaction };
```

---

## Views (Handlebars Templates)

Views are rendered using Handlebars templates.

### Example 1: Admin Panel View
```html
<html>
<head>
    <script type="text/javascript" src="scripts/common-0.0.1.js"></script>
    <script type="text/javascript">
    var addPluginConfigEx = function() {
        var config = parent.Q('plugintextinput').value;
        var parsed = false;
        try {
            config = JSON.parse(config);
            parsed = true;
        } catch (e) { 
            parent.setDialogMode(2, 'Oops!', 1, null, "Plugin config is not valid JSON"); 
            return; 
        }
        if (!parsed) return;
        parent.meshserver.send({ 
            action: 'plugin', 
            plugin: 'devtools', 
            pluginaction: 'addPluginConfig', 
            cfg: config 
        });
    }
    
    var refreshHandlerEx = function() {
        parent.meshserver.send({ 
            action: 'plugin', 
            plugin: 'devtools', 
            pluginaction: 'refreshPluginHandler' 
        });
        setTimeout(initPtools, 2000);
    };
    
    var editPluginConfigEx1 = function() {
        parent.meshserver.send({ 
            action: 'plugin', 
            plugin: 'devtools', 
            pluginaction: 'getPluginConfig', 
            id: parent.Q('dtEditPluginConf').value 
        });
    };
    
    var deletePluginConfigEx = function() {
        parent.meshserver.send({ 
            action: 'plugin', 
            plugin: 'devtools', 
            pluginaction: 'deletePluginConfig', 
            id: parent.Q('dtDeletePluginConf').value 
        });
    };
    
    var restartServerEx = function() {
        parent.meshserver.send({ 
            action: 'plugin', 
            plugin: 'devtools', 
            pluginaction: 'restartServer' 
        });
    }
    
    function addPluginConfig() {
        parent.setDialogMode(2, "Plugin Config JSON", 3, addPluginConfigEx, 
            '<textarea id=plugintextinput style=width:100% />'); 
        parent.focusTextBox('plugintextinput');
    }
    
    function refreshHandler() {
        parent.setDialogMode(2, "Refresh Plugin Handler?", 3, refreshHandlerEx, 'Are you sure?');
    }
    
    function editPluginConfig() {
        var sel = '<select id="dtEditPluginConf">'
        parent.installedPluginList.forEach((plugin) => {
            sel += `<option value="${plugin._id}">${plugin.name}</option>`;
        });
        sel += '</select>';
        parent.setDialogMode(2, "Edit which Plugin?", 3, editPluginConfigEx1, sel);
    }
    
    function deletePluginConfig() {
        var sel = '<select id="dtDeletePluginConf">'
        parent.installedPluginList.forEach((plugin) => {
            sel += `<option value="${plugin._id}">${plugin.name}</option>`;
        });
        sel += '</select>';
        parent.setDialogMode(2, "Delete which Plugin?", 3, deletePluginConfigEx, sel);
    }
    
    function restartServer() {
        parent.setDialogMode(2, "Restart Server?", 3, restartServerEx, 'Are you sure?');
    }
    
    function initPtools() {
        parent.pluginHandler.devtools.loadEditPluginConfig = function(args, msg) {
            var conf = msg.conf[0];
            var id = conf._id;
            delete conf._id;
            parent.setDialogMode(2, "Plugin Config: "+conf.name, 3, editPluginConfigEx2, 
                '<input type="hidden" id="diPIConfig_id" value="'+id+'" />' +
                '<textarea width="500" height="700" id="dtPIConfig">' +
                JSON.stringify(conf, null, 2) + '</textarea>');
        };
    }
    initPtools();
    </script>
</head>
<style>
    body {
        font-family: "Trebuchet MS", Arial, Helvetica, sans-serif;
    }
</style>
<body>
<div id="devToolsAdmin">
    <br />
    <a href="#" onclick="addPluginConfig(); return false;">Add plugin config</a><br /><br />
    <a href="#" onclick="deletePluginConfig(); return false;">Delete a plugin config</a><br /><br />
    <a href="#" onclick="refreshHandler(); return false;">Refresh PluginHandler</a><br /><br />
    <a href="#" onclick="editPluginConfig(); return false;">Edit a plugin config</a><br /><br />
    <a href="#" onclick="restartServer(); return false;">Restart Server</a><br /><br />
</div>
</body>
</html>
```

### Example 2: User View with Data
```html
<html>
<head>
    <script type="text/javascript" src="scripts/common-0.0.1.js"></script>
</head>
<style>
    body {
        font-family: "Trebuchet MS", Arial, Helvetica, sans-serif;
    }
    #goAdd, .delMap {
        cursor: pointer;
    }
</style>
<body onload="doOnLoad();">
<div id="fileDistUser">
    <div id="fileDist_main">
        <table id="fdMaps">
            <tr>
                <th width="40%">Server Path</th>
                <th width="40%">Client Path</th>
                <th width="20%">Delete</th>
            </tr>
        </table>
        <span id="goAdd" onclick="goAdd();">[+]</span>
    </div>
</div>
</body>
<script type="text/javascript">
var filemaps = {{{filemaps}}};  // Handlebars variable
var sPathsToNPaths = {};
var fTree = {};

function resizeIframe() {
    document.body.style.height = 0;
    parent.pluginHandler.scripttask.resizeContent();
}

function doOnLoad() {
    fTree = {};
    parseFileTree();
    parseNicePaths();
    redrawMaps();
}

function parseNicePaths() {
    sPathsToNPaths = {};
    fTree.forEach(function(f) {
        sPathsToNPaths[f.linkpath] = f.nicepath;
    });
}

function redrawMaps() {
    var fdMapTbl = Q('fdMaps');
    var fdMapRows = document.querySelectorAll('.fmRow');
    
    fdMapRows.forEach(function(r) {
        r.parentNode.removeChild(r);
    });
    
    filemaps.forEach(function(m) {
        let tpl = '<td>' + sPathsToNPaths[m.serverpath] + '</td>' +
            '<td>' + m.clientpath + '</td>' +
            '<td><span class="delMap" onclick="deleteMap(this);">X</span></td>';
        let tr = fdMapTbl.insertRow(-1);
        tr.innerHTML = tpl;
        tr.classList.add('fmRow');
        tr.setAttribute('x-data-id', m._id);
    });
}

function goAddEx2() {
    var spath = parent.Q('fdspath').value;
    var cpath = parent.Q('fdclientPath').value;
    parent.meshserver.send({ 
        action: 'plugin', 
        plugin: 'filedist', 
        pluginaction: 'addFileMap', 
        spath: spath, 
        cpath: cpath, 
        currentNodeId: parent.currentNode._id 
    });
}

function deleteMap(el) {
    var row = el.closest('.fmRow');
    var id = row.getAttribute('x-data-id');
    parent.meshserver.send({ 
        action: 'plugin', 
        plugin: 'filedist', 
        pluginaction: 'removeFileMap', 
        id: id 
    });
}
</script>
</html>
```

---

## Hook System

MeshCentral plugins can hook into various server events.

### Available Hooks

#### Server-Side Hooks

| Hook Name | Description | Arguments |
|-----------|-------------|-----------|
| `server_startup` | Called on server startup | None |
| `hook_setupHttpHandlers` | Called when HTTP handlers are set up | `webserver`, `parent` |
| `hook_userLoggedIn` | Called when a user logs in | `user` |
| `hook_processAgentData` | Called when agent data is received | `command`, `meshagent`, `parent` |
| `hook_agentCoreIsStable` | Called when agent core is stable | `meshagent`, `parent` |
| `hook_beforeCreateMeshAgent` | Before agent creation | `parent`, `db`, `ws`, `req`, `args`, `domain` |
| `hook_afterCreateMeshAgent` | After agent creation | `meshagent`, `parent`, `db`, `ws`, `req`, `args`, `domain` |
| `hook_beforeCreateMeshRelay` | Before relay creation | `parent`, `ws`, `req`, `domain`, `user`, `cookie` |
| `hook_afterCreateMeshRelay` | After relay creation | `meshrelay`, `parent`, `ws`, `req`, `domain`, `user`, `cookie` |
| `hook_beforeCreateLocalRelay` | Before local relay creation | `parent`, `ws`, `req`, `domain`, `user`, `cookie` |
| `hook_afterCreateLocalRelay` | After local relay creation | `localrelay`, `parent`, `ws`, `req`, `domain`, `user`, `cookie` |
| `hook_beforeCreateMeshUser` | Before user creation | `parent`, `db`, `ws`, `req`, `args`, `domain`, `user` |
| `hook_afterCreateMeshUser` | After user creation | `meshuser`, `parent`, `db`, `ws`, `req`, `args`, `domain`, `user` |
| `hook_beforeNotifyUserOfDeviceStateChange` | Before device state notification | `__`, `nodeid`, `connectTime`, `connectType`, `powerState`, `serverid`, `stateSet`, `extraInfo` |
| `hook_afterNotifyUserOfDeviceStateChange` | After device state notification | `__`, `meshid`, `nodeid`, `connectTime`, `connectType`, `powerState`, `serverid`, `stateSet`, `extraInfo` |
| `hook_agentWebSocketDisconnected` | Called when agent disconnects | `meshagent` |

#### Special Methods (not hooks, but called by server)

| Method Name | Description | Arguments |
|-------------|-------------|-----------|
| `uiCustomEvent` | Called when frontend sends 'uicustomevent' action | `command`, `meshuser` |
| `on_device_header` | Returns HTML for device panel header | None (returns string) |
| `on_device_page` | Returns HTML for device panel content | None (returns string) |

### Hook Example: PluginHookExample
```javascript
'use strict';

const PLUGIN_SHORT_NAME = 'pluginhookexample';

module.exports = {
    [PLUGIN_SHORT_NAME]: function (pluginHandler) {
        const meshserver = pluginHandler.parent;
        let webserver;
        
        return {
            server_startup() {
                webserver = meshserver.webserver;
                console.log(new Date().toISOString(), PLUGIN_SHORT_NAME + '.server_startup');
            },
            
            hook_beforeCreateMeshAgent(parent, db, ws, req, args, domain) {
                console.log(new Date().toISOString(), 'hook_beforeCreateMeshAgent', 
                    req.url, req.socket.remotePort);
            },
            
            hook_afterCreateMeshAgent(meshagent, parent, db, ws, req, args, domain) {
                console.log(new Date().toISOString(), 'hook_afterCreateMeshAgent', 
                    encodeURIComponent(meshagent.nonce).slice(0, 24));
                return meshagent;
            },
            
            hook_agentCoreIsStable(meshagent) {
                console.log(new Date().toISOString(), 'hook_agentCoreIsStable', 
                    meshagent.agentName ?? meshagent.name ?? meshagent.nodeid);
            },
            
            hook_agentWebSocketDisconnected(meshagent) {
                console.log(new Date().toISOString(), 'hook_agentWebSocketDisconnected', 
                    meshagent.agentName ?? meshagent.name ?? meshagent.nodeid);
            },
            
            hook_beforeCreateMeshRelay(parent, ws, req, domain, user, cookie) {
                console.log(new Date().toISOString(), 'hook_beforeCreateMeshRelay', req.url);
            },
            
            hook_afterCreateMeshRelay(meshrelay, parent, ws, req, domain, user, cookie) {
                console.log(new Date().toISOString(), 'hook_afterCreateMeshRelay');
                return meshrelay;
            },
            
            hook_beforeCreateLocalRelay(parent, ws, req, domain, user, cookie) {
                console.log(new Date().toISOString(), 'hook_beforeCreateLocalRelay', req.url);
            },
            
            hook_afterCreateLocalRelay(localrelay, parent, ws, req, domain, user, cookie) {
                console.log(new Date().toISOString(), 'hook_afterCreateLocalRelay');
                return localrelay;
            },
            
            hook_beforeCreateMeshUser(parent, db, ws, req, args, domain, user) {
                console.log(new Date().toISOString(), 'hook_beforeCreateMeshUser', req.url);
            },
            
            hook_afterCreateMeshUser(meshuser, parent, db, ws, req, args, domain, user) {
                console.log(new Date().toISOString(), 'hook_afterCreateMeshUser');
                return meshuser;
            },
            
            hook_beforeNotifyUserOfDeviceStateChange(__, nodeid, connectTime, connectType, 
                    powerState, serverid, stateSet, extraInfo) {
                console.log(new Date().toISOString(), 'hook_beforeNotifyUserOfDeviceStateChange', 
                    stateSet);
            },
            
            hook_afterNotifyUserOfDeviceStateChange(__, meshid, nodeid, connectTime, connectType, 
                    powerState, serverid, stateSet, extraInfo) {
                console.log(new Date().toISOString(), 'hook_afterNotifyUserOfDeviceStateChange');
                return stateSet;
            },
        };
    }
};
```

---

## Communication Patterns

### Server to Agent Communication
```javascript
// Send command to specific agent
const command = {
    action: 'plugin',
    plugin: 'myplugin',
    pluginaction: 'doSomething',
    data: { key: 'value' }
};

// Get agent by nodeId
var agent = obj.meshServer.webserver.wsagents[nodeId];
if (agent != null) {
    agent.send(JSON.stringify(command));
}
```

### Agent to Server Communication
```javascript
// In modules_meshcore/myplugin.js
mesh.SendCommand({ 
    action: 'plugin', 
    plugin: 'myplugin',
    pluginaction: 'dataReceived',
    data: { key: 'value' },
    sessionid: _sessionid,
    tag: 'console'
});
```

### Server to Frontend Communication
```javascript
// Send to specific user session
myparent.ws.send(JSON.stringify({ 
    action: 'plugin', 
    plugin: 'myplugin', 
    method: 'updateData', 
    data: myData 
}));

// Broadcast to all users via event
var targets = ['*', 'server-users'];
obj.meshServer.DispatchEvent(targets, obj, { 
    nolog: true, 
    action: 'plugin', 
    plugin: 'myplugin', 
    method: 'updateData', 
    data: myData 
});
```

### Frontend to Server Communication
```javascript
// In views or frontend exports
parent.meshserver.send({ 
    action: 'plugin', 
    plugin: 'myplugin', 
    pluginaction: 'doAction', 
    data: { key: 'value' } 
});
```

### Frontend Method Exports
```javascript
// In main plugin file
obj.exports = [
    'onMethodName',
    'anotherMethod'
];

obj.onMethodName = function() {
    // This function is available in web UI as pluginHandler.myplugin.onMethodName()
};
```

---

## Complete Plugin Examples

### Minimal Plugin Template
```javascript
// config.json
{
    "name": "My Plugin",
    "shortName": "myplugin",
    "version": "0.0.1",
    "author": "Your Name",
    "description": "Plugin description",
    "hasAdminPanel": false,
    "configUrl": "https://example.com/myplugin/config.json",
    "downloadUrl": "https://example.com/myplugin/archive.zip",
    "meshCentralCompat": ">=1.1.35"
}

// myplugin.js
"use strict";

module.exports.myplugin = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    
    // Functions exported to web UI
    obj.exports = [];
    
    // Hook: Agent core is stable
    obj.hook_agentCoreIsStable = function(myparent, grandparent) {
        console.log('Agent connected: ' + myparent.dbNodeKey);
    };
    
    // Server action handler
    obj.serveraction = function(command, myparent, grandparent) {
        switch (command.pluginaction) {
            case 'myAction':
                // Handle action
                myparent.ws.send(JSON.stringify({ 
                    action: 'plugin', 
                    plugin: 'myplugin', 
                    method: 'result', 
                    data: 'success' 
                }));
                break;
            default:
                console.log('PLUGIN: myplugin: unknown action');
                break;
        }
    };
    
    return obj;
};
```

---

## MeshCentral Server Configuration

Enable plugins in `meshcentral-data/config.json`:

```json
{
    "$schema": "https://raw.githubusercontent.com/Ylianst/MeshCentral/master/meshcentral-config-schema.json",
    "settings": {
        "plugins": {
            "enabled": true,
            "pluginSettings": {
                "pluginhookscheduler": {
                    "backendhooks": [
                        ["server_startup", ["myplugin"]],
                        ["hook_agentCoreIsStable", []],
                        ["*", []]
                    ]
                }
            }
        }
    }
}
```

---

## Key Objects Reference

### pluginHandler (parent)
- `parent.parent` - meshServer
- `parent.plugins` - loaded plugins
- `parent.callHook(hookName, ...args)` - call hook

### meshServer (parent.parent)
- `meshServer.webserver` - web server instance
- `meshServer.webserver.wsagents` - connected agents (by nodeId)
- `meshServer.webserver.wssessions` - user sessions
- `meshServer.db` - database
- `meshServer.debug(category, subcategory, message)` - debug logging
- `meshServer.DispatchEvent(targets, source, event)` - dispatch event
- `meshServer.loginCookieEncryptionKey` - for encoding cookies
- `meshServer.getConfigFilePath(filename)` - get config file path

### Agent (in modules_meshcore)
- `mesh.SendCommand(command)` - send to server
- `require('SimpleDataStore').Shared()` - agent local storage
- `require('MeshAgent')` - mesh agent module
- `require('child_process')` - run commands
- `require('fs')` - file system

---

## Useful Patterns

### Check User Admin Rights
```javascript
if ((user.siteadmin & 0xFFFFFFFF) == 0) { 
    res.sendStatus(401); 
    return; 
}
```

### Generate Auth Cookie
```javascript
var uinfo = userId.split('/');
var rcookie = parent.parent.encodeCookie(
    { userid: userId, domainid: uinfo[1] }, 
    obj.meshServer.loginCookieEncryptionKey
);
```

### Get Online Agents
```javascript
var onlineAgents = Object.keys(obj.meshServer.webserver.wsagents);
```

### Get Online Users
```javascript
var onlineUsers = Object.keys(obj.meshServer.webserver.wssessions);
```

### Device View Panel Methods

Plugins can add custom panels to the device details page using `on_device_header()` and `on_device_page()`:

```javascript
module.exports.myplugin = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    
    // Return HTML for the device panel header (tab)
    obj.on_device_header = function() {
        return '<span onclick="return pluginHandler.myplugin.showPanel();">My Plugin</span>';
    };
    
    // Return HTML for the device panel content
    obj.on_device_page = function() {
        return '<div id="myplugin-panel">Plugin content here</div>';
    };
    
    return obj;
};
```

These methods are called by `pluginHandler.deviceViewPanel()` when rendering device details.

### Custom UI Events (uiCustomEvent)

Plugins can handle custom UI events triggered from the frontend:

```javascript
// In main plugin file
obj.uiCustomEvent = function(command, meshuser) {
    // command contains: section, element, userid, selectedDevices, src, values
    console.log('Custom UI event from section:', command.section);
    console.log('Element clicked:', command.element);
    console.log('Selected devices:', command.selectedDevices);
    
    // Process the event and optionally respond
    meshuser.ws.send(JSON.stringify({
        action: 'plugin',
        plugin: 'myplugin',
        method: 'uiEventResponse',
        data: 'Event processed'
    }));
};

// Frontend: Trigger custom UI event
meshserver.send({
    action: 'uicustomevent',
    section: 'devices',
    element: 'mybutton',
    selectedDevices: getSelectedDevices(),
    values: { customField: 'value' }
});
```

---

## Installation

1. Create plugin directory in `meshcentral-data/plugins/`
2. Add `config.json` and main plugin file
3. Enable plugins in MeshCentral config
4. Restart MeshCentral server
5. Install plugin via web UI using config.json URL

Or use DevTools plugin to inject directly into database.

---

*This guide was generated from analysis of existing MeshCentral plugins including Sample, DevTools, EventLog, ScriptTask, RoutePlus, FileDist, WorkFromHome, PluginHookScheduler, and PluginHookExample.*

---

## Server Architecture Reference (from MeshCentral source code)

This section provides detailed technical reference from the MeshCentral server codebase for plugin developers.

### MeshCentral Server Object Hierarchy

```
MeshCentral (meshcentral.js)
├── obj.db                    // Database module
├── obj.webserver             // Web server module (webserver.js)
│   ├── wsagents              // Connected agents by nodeId
│   ├── wssessions            // User sessions by userId
│   ├── wssessions2           // User sessions by sessionId
│   ├── meshes                // Device groups
│   └── users                 // User objects
├── obj.pluginHandler         // Plugin handler module
│   ├── plugins               // Loaded plugin objects
│   ├── exports               // Frontend exported functions
│   └── callHook()            // Hook invocation method
├── obj.mpsserver             // Intel AMT MPS server
├── obj.amtManager            // Intel AMT manager
├── obj.mailserver            // Email server
├── obj.smsserver             // SMS gateway
├── obj.msgserver             // Messaging server
├── obj.firebase              // Push notification service
├── obj.taskManager           // Script task manager
├── obj.certificates          // TLS certificates
├── obj.loginCookieEncryptionKey  // Cookie encryption key
├── obj.invitationLinkEncryptionKey // Invitation link key
└── obj.multiServer           // Multi-server support
```

### Plugin Handler Internal Structure (pluginHandler.js)

```javascript
// Plugin Handler Object
pluginHandler = {
    fs: require('fs'),
    path: require('path'),
    common: require('./common.js'),
    parent: meshCentralServer,  // Reference to main server
    pluginPath: '<datapath>/plugins',
    plugins: {},                // Loaded plugin instances by shortName
    exports: {},                // Frontend exports by shortName
    loadList: {},               // List of plugins to load
    
    // Methods
    callHook(hookName, ...args),      // Call a hook on all plugins
    prepExports(),                     // Prepare frontend exports
    refreshJS(req, res),               // Refresh plugin JavaScript
    addMeshCoreModules(modulesAdd),   // Add agent modules
    deviceViewPanel(),                 // Get device panel views
    isValidConfig(conf, url),          // Validate plugin config
    getPluginConfig(configUrl),        // Fetch plugin config
    versionCompare(current, minimal),  // Compare versions
    getPluginLatest(),                 // Get latest plugin versions
    addPlugin(pluginConfig),           // Add plugin to database
    installPlugin(id, version, url, func), // Install plugin
    getPluginVersions(id),             // Get plugin versions
    disablePlugin(id, func),           // Disable plugin
    removePlugin(id, func),            // Remove plugin
    handleAdminReq(req, res, user, serv), // Handle admin requests
    handleAdminPostReq(req, res, user, serv) // Handle POST requests
}
```

### Hook Call Flow

```
1. Server Startup (meshcentral.js)
   └── pluginHandler.callHook('server_startup')

2. HTTP Handlers Setup (webserver.js)
   └── pluginHandler.callHook('hook_setupHttpHandlers', webserver, parent)

3. User Login (meshuser.js)
   └── pluginHandler.callHook('hook_userLoggedIn', user)

4. Agent Core Stable (meshagent.js)
   └── pluginHandler.callHook('hook_agentCoreIsStable', meshAgent, parent)

5. Agent Data Processing (meshagent.js)
   └── pluginHandler.callHook('hook_processAgentData', command, meshAgent, parent)
```

### Server Action Processing (meshuser.js)

When a plugin command is received from the frontend:

```javascript
// In meshuser.js, case 'plugin':
case 'plugin': {
    if (parent.parent.pluginHandler == null) break;
    command.userid = user._id;
    if (command.routeToNode === true) {
        // Route command to agent
        routeCommandToNode(command);
    } else {
        // Process on server
        try {
            parent.parent.pluginHandler.plugins[command.plugin].serveraction(command, obj, parent);
        } catch (ex) { 
            console.log('Error loading plugin handler (' + ex + ')'); 
        }
    }
    break;
}
```

#### Using routeToNode for Agent Communication

The `routeToNode` flag allows plugins to send commands directly to agents through the standard plugin action mechanism:

```javascript
// Frontend: Send command that will be routed to agent
meshserver.send({
    action: 'plugin',
    plugin: 'myplugin',
    pluginaction: 'agentAction',
    nodeid: currentNode._id,
    routeToNode: true,  // This flag routes the command to the agent
    mydata: 'some data'
});
```

When `routeToNode: true` is set:
1. The server adds user session info (`sessionid`, `rights`, `consent`, `username`, `userid`)
2. The command is sent directly to the agent via WebSocket
3. The agent processes it through `case 'plugin'` in processServerData()

### Agent-Side Plugin Communication (meshcore.js)

Agent handles plugin commands in two ways:

#### 1. Direct Server Command
```javascript
// In meshcore.js, processServerData()
case 'plugin': {
    try { 
        require(data.plugin).consoleaction(data, data.rights, data.sessionid, this); 
    } catch (ex) { throw ex; }
    break;
}
```

#### 2. Console Command
```javascript
// In meshcore.js, processConsoleCommand()
case 'plugin': {
    if (args['_'].length > 1) {
        try {
            // Load and execute plugin module
            response = require(args['_'][0]).consoleaction(args, rights, sessionid, mesh);
        } catch (ex) {
            response = "There was an error in the plugin (" + ex + ")";
        }
    } else {
        response = "Proper usage: plugin [pluginName] [args].";
    }
    break;
}
```

#### 3. Protocol 7 - Plugin Data Exchange
```javascript
// In tunnel handling code
} else if (this.httprequest.protocol == 7) { // Plugin data exchange
    try {
        var cmd = JSON.parse(data);
        switch (cmd.action) {
            case 'plugin': {
                try { 
                    require(cmd.plugin).consoleaction(cmd, null, null, this); 
                } catch (ex) { throw ex; }
                break;
            }
        }
    } catch (ex) { }
}
```

### Database Methods Available to Plugins

From `db.js`, these methods are available through `meshServer.db`:

```javascript
// Core Database Methods
obj.Set(doc)                              // Set/update document
obj.Get(id, func)                         // Get document by ID
obj.Remove(id, func)                      // Remove document by ID
obj.GetAll(func)                          // Get all documents
obj.GetHash(id, func)                     // Get document hash
obj.GetAllType(type, func)                // Get all by type
obj.GetAllTypeNoTypeField(type, domain, func) // Get all by type without type field

// User Methods
obj.GetAllUsers(func)                     // Get all users
obj.GetAllUsersOfDomain(domain, func)     // Get users in domain
obj.SetUser(user)                         // Set/update user
obj.GetUser(userid, func)                 // Get user

// Mesh (Device Group) Methods
obj.GetAllMeshes(func)                    // Get all meshes
obj.GetMesh(meshid, func)                 // Get specific mesh
obj.SetMesh(mesh)                         // Set/update mesh

// Node (Device) Methods
obj.GetAllTypeNodeFiltered(nodes, domain, type, id, func) // Filter nodes
obj.GetNode(nodeid, func)                 // Get specific node
obj.SetNode(node)                         // Set/update node

// Event Methods
obj.GetEvents(ids, domain, filter, func)  // Get events
obj.GetEventsWithLimit(ids, domain, limit, filter, func) // Get limited events
obj.StoreEvent(event)                     // Store event

// Plugin-Specific Methods (when plugins enabled)
obj.addPlugin(plugin, func)               // Add plugin to DB
obj.getPlugins(func)                      // Get all plugins
obj.getPlugin(id, func)                   // Get plugin by ID
obj.deletePlugin(id, func)                // Delete plugin
obj.setPluginStatus(id, status, func)     // Set plugin status
obj.updatePlugin(id, args, func)          // Update plugin config
```

### Mesh Rights Constants (for permission checking)

```javascript
// From webserver.js and meshrelay.js
const MESHRIGHT_EDITMESH            = 0x00000001; // 1
const MESHRIGHT_MANAGEUSERS         = 0x00000002; // 2
const MESHRIGHT_MANAGECOMPUTERS     = 0x00000004; // 4
const MESHRIGHT_REMOTECONTROL       = 0x00000008; // 8
const MESHRIGHT_AGENTCONSOLE        = 0x00000010; // 16
const MESHRIGHT_SERVERFILES         = 0x00000020; // 32
const MESHRIGHT_WAKEDEVICE          = 0x00000040; // 64
const MESHRIGHT_SETNOTES            = 0x00000080; // 128
const MESHRIGHT_REMOTEVIEWONLY      = 0x00000100; // 256
const MESHRIGHT_NOTERMINAL          = 0x00000200; // 512
const MESHRIGHT_NOFILES             = 0x00000400; // 1024
const MESHRIGHT_NOAMT               = 0x00000800; // 2048
const MESHRIGHT_DESKLIMITEDINPUT    = 0x00001000; // 4096
const MESHRIGHT_LIMITEVENTS         = 0x00002000; // 8192
const MESHRIGHT_CHATNOTIFY          = 0x00004000; // 16384
const MESHRIGHT_UNINSTALL           = 0x00008000; // 32768
const MESHRIGHT_NODESKTOP           = 0x00010000; // 65536
const MESHRIGHT_REMOTECOMMAND       = 0x00020000; // 131072
const MESHRIGHT_RESETOFF            = 0x00040000; // 262144
const MESHRIGHT_GUESTSHARING        = 0x00080000; // 524288
const MESHRIGHT_DEVICEDETAILS       = 0x00100000; // 1048576
const MESHRIGHT_RELAY               = 0x00200000; // 2097152
const MESHRIGHT_ADMIN               = 0xFFFFFFFF;

// Site Rights
const SITERIGHT_SERVERBACKUP        = 0x00000001;
const SITERIGHT_MANAGEUSERS         = 0x00000002;
const SITERIGHT_SERVERRESTORE       = 0x00000004;
const SITERIGHT_FILEACCESS          = 0x00000008;
const SITERIGHT_SERVERUPDATE        = 0x00000010;
const SITERIGHT_LOCKED              = 0x00000020;
const SITERIGHT_NONEWGROUPS         = 0x00000040;
const SITERIGHT_NOMESHCMD           = 0x00000080;
const SITERIGHT_USERGROUPS          = 0x00000100;
const SITERIGHT_RECORDINGS          = 0x00000200;
const SITERIGHT_LOCKSETTINGS        = 0x00000400;
const SITERIGHT_ALLEVENTS           = 0x00000800;
const SITERIGHT_NONEWDEVICES        = 0x00001000;
const SITERIGHT_ADMIN               = 0xFFFFFFFF;

// User Consent Flags (for command.consent)
const USERCONSENT_DesktopNotifyUser      = 0x0001; // 1 - Notify on desktop connect
const USERCONSENT_TerminalNotifyUser     = 0x0002; // 2 - Notify on terminal connect
const USERCONSENT_FilesNotifyUser        = 0x0004; // 4 - Notify on files connect
const USERCONSENT_DesktopPromptUser      = 0x0008; // 8 - Prompt for desktop
const USERCONSENT_TerminalPromptUser     = 0x0010; // 16 - Prompt for terminal
const USERCONSENT_FilesPromptUser        = 0x0020; // 32 - Prompt for files
const USERCONSENT_ShowConnectionToolbar  = 0x0040; // 64 - Show privacy bar
```

### Tunnel Protocol Types

```javascript
// From meshrelay.js and meshcore.js
// Protocol values for req.query.p or cookie.p:
// 1 = Terminal (admin)
// 2 = Desktop
// 5 = Files
// 6 = Admin PowerShell
// 7 = Plugin Data Exchange  <-- Use this for plugin tunnels
// 8 = User Shell
// 9 = User PowerShell
// 10 = Web-RDP
// 11 = Web-SSH
// 12 = Web-VNC
// 13 = Web-SSH-Files
// 14 = Web-TCP
// 100 = Intel AMT WSMAN
// 101 = Intel AMT Redirection
// 200 = Messenger
```

### Event Dispatch System

```javascript
// Dispatch event to targets
obj.meshServer.DispatchEvent(targets, source, event);

// Target types:
// '*'           - All connected sessions
// 'server-users' - All server users
// 'user/domain/userid' - Specific user
// 'mesh/domain/meshid' - Mesh members
// 'node/domain/nodeid' - Node watchers
// 'server-shareremove' - Share removal watchers

// Event structure
var event = {
    etype: 'user|node|mesh|ugrp',  // Entity type
    action: 'actionname',           // Action name
    userid: 'user/_/name',          // User ID (if applicable)
    nodeid: 'node/_/id',            // Node ID (if applicable)
    meshid: 'mesh/_/id',            // Mesh ID (if applicable)
    domain: 'domainid',             // Domain ID
    nolog: 1,                       // Don't log this event
    msg: 'Human readable message',  // Message
    msgid: 123,                     // Message ID for translation
    msgArgs: ['arg1', 'arg2']       // Message arguments
};

// Helper method to create dispatch targets for a mesh
var targets = parent.CreateMeshDispatchTargets(meshid, [additionalTargets]);
// Returns array like: ['mesh/domain/meshid', 'node/domain/nodeid', ...]

// Example: Dispatch event to all users who can see a specific node
parent.parent.DispatchEvent(
    parent.CreateMeshDispatchTargets(node.meshid, [node._id, user._id]), 
    obj, 
    event
);
```

### Agent Module Loading

Plugin agent-side code is loaded through the `modules_meshcore` directory:

```javascript
// From pluginHandler.js - addMeshCoreModules()
// Modules are loaded from: <pluginPath>/<pluginName>/modules_meshcore/

// Module naming conventions:
// - 'amt-*' or 'smbios' → Only Windows-AMT and Linux-AMT cores
// - 'win-*' → Only Windows cores
// - 'linux-*' → Only Linux cores (AMT and non-AMT)
// - All others → All cores (Windows-AMT, Linux-AMT, Linux-noAMT)

// Module injection format:
var moduleData = [
    'try { addModule("', moduleName, '", "', 
    escapedModuleCode, 
    '"); addedModules.push("', moduleName, '"); } catch (e) { }\r\n'
];
```

### Agent SimpleDataStore API

On the agent side, plugins can use persistent storage:

```javascript
// In modules_meshcore plugin code
var db = require('SimpleDataStore').Shared();

// Store data
db.Put('key', value);           // value can be string, object, etc.
db.Put('key', JSON.stringify(obj)); // For objects

// Retrieve data
var value = db.Get('key');      // Returns stored value or null
var obj = JSON.parse(db.Get('key')); // Parse stored JSON

// Delete data
db.Delete('key');

// List keys
db.Keys.forEach(function(k) {
    // Process each key
});
```

### Agent Mesh Object Methods

```javascript
// Send command to server
mesh.SendCommand(commandObject);
mesh.SendCommand(JSON.stringify(commandObject));

// Server URL
mesh.ServerUrl  // e.g., 'wss://server:443/agent.ashx'

// Send console message
mesh.SendCommand({ 
    action: 'msg', 
    type: 'console', 
    value: 'message text',
    sessionid: sessionid 
});

// Send plugin action to server
mesh.SendCommand({ 
    action: 'plugin', 
    plugin: 'pluginname',
    pluginaction: 'actionname',
    sessionid: sessionid,
    tag: 'console',
    // ... additional data
});
```

### Agent Available Modules

Built-in modules available on the agent side for plugin use:

```javascript
// Core Node.js modules
var fs = require('fs');                    // File system
var os = require('os');                    // OS information
var net = require('net');                  // Networking
var http = require('http');                // HTTP client
var https = require('https');              // HTTPS client
var child_process = require('child_process'); // Execute commands

// MeshAgent-specific modules
var MeshAgent = require('MeshAgent');      // Agent control
var db = require('SimpleDataStore').Shared(); // Persistent storage

// MeshAgent properties
MeshAgent.SendCommand(cmd);                // Send to server
MeshAgent.getRemoteDesktopStream();        // Desktop streaming
MeshAgent.ExecPowerShell(cmd);             // PowerShell (Windows)
MeshAgent.ExecBash(cmd);                   // Bash (Linux/macOS)

// Process information
process.platform;                          // 'win32', 'linux', 'darwin', 'freebsd'
process.arch;                              // 'x64', 'arm', 'ia32'
process.execPath;                          // Agent executable path
process.cwd();                             // Current working directory
```

### Agent Console Commands

From the agent console (terminal), plugin commands can be invoked:

```
plugin <pluginName> <action> [args...]
```

Example:
```
plugin myplugin status
plugin myplugin setconfig value1 value2
```

### WebSocket Session Object (meshuser.js)

```javascript
// User session object (obj in meshuser.js)
obj = {
    ws: websocket,              // WebSocket connection
    user: userObject,           // User object from database
    domain: domainConfig,       // Domain configuration
    db: database,               // Database reference
    meshes: {},                 // User's device groups
    visibleDevices: {},         // Visible devices (if paging)
    deviceSkip: 0,              // Paging skip
    deviceLimit: 100            // Paging limit
};

// Send to user
obj.ws.send(JSON.stringify({
    action: 'plugin',
    plugin: 'pluginname',
    method: 'methodname',
    data: data
}));
```

### Frontend Plugin Handler (browser-side)

```javascript
// Available in browser as: pluginHandler
pluginHandler = {
    pluginname: {
        // Exported functions from plugin
        exportedFunc1: function() { ... },
        exportedFunc2: function() { ... }
    },
    
    // Built-in methods
    callHook: function(hookName, ...args) { ... },
    registerPluginTab: function(pluginRegInfo) { ... },
    callPluginPage: function(id, el) { ... },
    addPluginEx: function() { ... },
    addPluginDlg: function() { ... },
    refreshPluginHandler: function() { ... }
};

// Register a tab in device details
pluginHandler.registerPluginTab({
    tabId: 'mytab',
    tabTitle: 'My Tab Title'
});

// Call hook on all plugins
pluginHandler.callHook('onDeviceRefreshEnd', nodeid, panel, refresh, event);
```

### Frontend Hooks (from default.handlebars)

```javascript
// Available frontend hooks (called by pluginHandler.callHook)
'onWebUIStartupEnd'      // When web UI has finished loading
'onDesktopDisconnect'    // When desktop session disconnects
'onDeviceRefreshEnd'     // When device panel refresh completes (nodeid, panel, refresh, event)
'goPageStart'            // When navigating to a page (pagenum, event)
'goPageEnd'              // After page navigation complete (pagenum, event)
```

### Debug Logging

```javascript
// Server-side debug logging
obj.meshServer.debug('PLUGIN', 'PluginName', 'Debug message');
// or
parent.parent.debug('PLUGIN', 'PluginName', 'Debug message');

// Agent-side debug logging
function dbg(msg) {
    require('MeshAgent').SendCommand({ 
        action: 'msg', 
        type: 'console', 
        value: '[pluginname-agent] ' + msg 
    });
}
```

To enable plugin debug output on server, start with:
```bash
node meshcentral --debug plugin
# or in config.json:
# "settings": { "debug": "plugin" }
```

Available debug categories: `cookie`, `dispatch`, `main`, `peer`, `agent`, `agentupdate`, `cert`, `db`, `email`, `web`, `webrequest`, `relay`, `httpheaders`, `authlog`, `amt`, `webrelay`, `mps`, `mpscmd`, `plugin`.

### Cookie Encoding/Decoding

```javascript
// Encode a cookie (for agent authentication)
var cookie = parent.parent.encodeCookie(
    { userid: userId, domainid: domainId }, 
    obj.meshServer.loginCookieEncryptionKey
);

// Decode a cookie
var rcookie = parent.parent.decodeCookie(
    cookieString, 
    parent.parent.loginCookieEncryptionKey, 
    240  // Timeout in minutes
);
```

### Plugin Database Operations Example

For plugins that need their own database collection:

```javascript
// Using MongoDB
if (meshserver.args.mongodb) {
    require('mongodb').MongoClient.connect(
        meshserver.args.mongodb, 
        { useNewUrlParser: true, useUnifiedTopology: true }, 
        function (err, client) {
            var dbname = meshserver.args.mongodbname || 'meshcentral';
            const db = client.db(dbname);
            obj.collection = db.collection('plugin_yourplugin');
            // Create indexes as needed
        }
    );
}

// Using NeDB (fallback)
else {
    var Datastore = require('@seald-io/nedb');
    obj.file = new Datastore({ 
        filename: meshserver.getConfigFilePath('plugin-yourplugin.db'), 
        autoload: true 
    });
    obj.file.setAutocompactionInterval(40000);
}
```

### Complete Plugin Lifecycle

```
1. Installation
   └── Plugin archive downloaded and extracted to plugins/<shortname>/
   
2. Loading (server startup)
   └── pluginHandler loads plugin module
   └── Plugin constructor called with pluginHandler reference
   └── Agent modules registered (if modules_meshcore exists)
   
3. Server Startup
   └── server_startup hook called
   
4. Runtime
   ├── Frontend loads plugin exports
   ├── User interactions trigger serveraction()
   ├── Agent connections trigger hook_agentCoreIsStable
   ├── Agent data triggers hook_processAgentData
   └── User login triggers hook_userLoggedIn
   
5. Disable/Remove
   └── Plugin removed from plugins object
   └── Agent core updated (removes plugin modules)
```

---

## Quick Reference Cheatsheet

### Plugin File Checklist
- [ ] `config.json` - Plugin manifest (required)
- [ ] `<shortname>.js` - Main plugin file (required)
- [ ] `db.js` - Database module (optional)
- [ ] `admin.js` - Admin panel handler (optional)
- [ ] `modules_meshcore/<shortname>.js` - Agent module (optional)
- [ ] `views/admin.handlebars` - Admin view (optional)
- [ ] `views/user.handlebars` - User view (optional)

### Essential Plugin Properties
```javascript
module.exports.pluginname = function (parent) {
    var obj = {};
    obj.parent = parent;                    // pluginHandler
    obj.meshServer = parent.parent;         // MeshCentral server
    obj.db = null;                          // Plugin database
    obj.VIEWS = __dirname + '/views/';      // Views path
    obj.exports = ['func1', 'func2'];       // Frontend exports
    
    // Required methods
    obj.serveraction = function(command, myparent, grandparent) { };
    
    // Optional hooks
    obj.server_startup = function() { };
    obj.hook_agentCoreIsStable = function(myparent, grandparent) { };
    obj.hook_userLoggedIn = function(user) { };
    obj.hook_processAgentData = function(command, obj, parent) { };
    obj.hook_setupHttpHandlers = function(webserver, parent) { };
    
    // Optional admin panel
    obj.handleAdminReq = function(req, res, user) { };
    obj.handleAdminPostReq = function(req, res, user) { };
    
    return obj;
};
```

### Agent Module Template
```javascript
"use strict";
var mesh;
var db = require('SimpleDataStore').Shared();

function consoleaction(args, rights, sessionid, parent) {
    mesh = parent;
    var fnname = args.pluginaction || args['_'][1];
    
    switch (fnname) {
        case 'myaction':
            // Handle action
            mesh.SendCommand({ 
                action: 'plugin', 
                plugin: 'myplugin',
                pluginaction: 'response',
                sessionid: sessionid,
                tag: 'console',
                data: 'result'
            });
            break;
    }
}

module.exports = { consoleaction: consoleaction };
```

### Communication Quick Reference

| Direction | Method |
|-----------|--------|
| Frontend → Server | `meshserver.send({ action: 'plugin', plugin: 'name', ... })` |
| Server → Frontend | `ws.send(JSON.stringify({ action: 'plugin', plugin: 'name', method: 'func', ... }))` |
| Server → Agent | `agent.send(JSON.stringify({ action: 'plugin', plugin: 'name', ... }))` |
| Agent → Server | `mesh.SendCommand({ action: 'plugin', plugin: 'name', ... })` |
| Server → All Users | `meshServer.DispatchEvent(['*', 'server-users'], obj, event)` |

---

*Updated with detailed server architecture reference from MeshCentral source code analysis.*
