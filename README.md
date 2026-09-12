# MeshCentral OmniOS Files

A file manager restricted to `/var/nr` on Linux OmniOS PCs. It provides directory browsing, upload, download, directory creation, rename and recursive deletion through separately assigned plugin permissions. The device Plugins tab contains a toolbar, breadcrumbs, directory-first file listing, compact action buttons and transfer progress.

The 2.0 protocol replaces the 1.x implementation. **This is a release candidate for device qualification**, not a claim that the deployed MeshAgent has been tested. See [PLAN.md](PLAN.md) for completed tasks and [the deployment checklist](docs/DEPLOYMENT-CHECKLIST.md) for real-device checks.

## File browser interface

The interface adapts selected SVAR Willow styling to MeshCentral's light and
night themes. Table actions use local SVG drawings; no Svelte runtime, icon
font, or CDN resource is loaded. See [third-party notices](THIRD_PARTY_NOTICES.md).
Create, rename and delete use modal dialogs with keyboard focus, Enter to
submit and Escape to cancel. Pending mutations disable further changes;
errors and final transfer verification remain visible.

For an upgrade **from rc.3–rc.5 to rc.6**, reload the installed server plugin and
fully reload the browser page. Agent modules are unchanged; this UI update
alone does not require rebuilding or distributing the agent core.

**rc.7 changes the agent modules and the Python worker** (the protocol 3 chunk
tunnel, see [Files and transfers](#files-and-transfers)): reload the server
plugin, rebuild and distribute the default agent core (see
[Install and update](#install-and-update)), then fully reload the browser
page. Skipping the core rebuild is not a failure — protocol 3 is
feature-detected and transfers keep working over the unchanged protocol 2
path — but it does mean the stalled-large-upload fix this release exists for
is not actually in effect yet on that device.

The displayed installed version is metadata, not proof that the running browser
exports were refreshed. If the old interface remains, run the same Reload
command used by this MeshCentral fork's admin UI in the browser console:

```js
meshserver.send({action: 'reloadplugin', plugin: 'omniosfiles'});
```

Check the server log for `Plugin reloaded successfully: omniosfiles`, then
fully reload the page. `meshserver.send()` returning `undefined` is normal;
it does not report reload success. On the reloaded device page,
`typeof pluginHandler.omniosfiles.dialog` and
`typeof pluginHandler.omniosfiles.icon` should both be `"function"`.

After deployment, verify light/night themes, narrow layouts and long names;
create/rename/delete with Enter and Escape; upload/download and cancellation;
read-only plugin access with standard `No Files`; and switching devices/tabs
during requests. Check the browser console for CSP errors and confirm that
other MeshCentral tabs keep their styling. Local rendering and automated tests
do not replace these checks on the deployed server.

## Access

This plugin requires the **local MeshCentral fork's plugin permission API** (`registerPermissions`, `checkPluginPermission`, `getPluginPermissions`). The manifest's minimum version alone does not guarantee these APIs exist in another MeshCentral build. Missing APIs deny operations.

- `read`: list directories, inspect files and download.
- `write`: upload, create directories, rename and delete. Mutation also requires `read`.
- Both default to denied for ordinary users. Full administrators follow the MeshCentral core override.
- Users must also have access to the device in their authenticated domain.
- `No Files` continues to disable the standard Files tool. Explicit OmniOSFiles permissions grant access only through this plugin.

Configure the plugin's read/write grants in the fork's plugin permission interface. Check ordinary users as well as administrators. The agent validates one-time server approvals, including for commands arriving through alternate plugin routes; hiding buttons is not the access control mechanism. See [the protocol](docs/PROTOCOL.md).

## Files and transfers

Virtual `/` means `/var/nr`. The browser cannot choose another filesystem root. File operations run in a Python worker that drops privileges to **user:user**, opens directories by descriptor and rejects paths through symlinks. Listing marks symlinks and unsupported objects; recursive deletion unlinks nested symlinks without following their targets. Special files and regular files with multiple hard links cannot be transferred.

Uploads use exclusive temporary files in the destination directory. The worker validates byte counts and SHA-256, sets the final file mode to `0664`, and publishes with Linux `renameat2(RENAME_NOREPLACE)`. New directories receive mode `0775` regardless of the worker umask; staging files remain private (`0600`). Existing destinations are never silently replaced. Create/rename/delete return errors when access or an operation fails. Recursive deletion can be partially completed before an error; it is not transactional.

Transfers use 16 KiB chunks with mandatory incremental SHA-256 validation. Empty files work. A changed download source, size mismatch or checksum mismatch fails the operation. Conflicting operations on a path are rejected while a transfer is active. One browser tab offers one transfer per device; the worker/server allow up to three across sessions.

The chunk size was reduced from an original 64 KiB after a real-device failure: a single stdin write of a full 64 KiB `uploadChunk` line (base64 + JSON framing, ~88 KB) to the Python worker was silently truncated by native MeshAgent's `child_process` implementation once it crossed roughly a pipe's default 64 KiB buffer, hanging the worker forever on the first chunk of any real upload. 16 KiB stays comfortably clear of that limit; see `tests/native-runtime.test.js`, which reproduces the exact failure against the real native binary with the chunk size forced back to 64 KiB.

Chunks travel over protocol 3: a dedicated agent tunnel (MeshCentral core's protocol 7) opened once `startUpload`/`startDownload` succeeds, pipelining up to 8 chunks instead of paying a full authorize round trip per chunk. `startUpload`/`startDownload`/`finishUpload`/`finishDownload`/`cancel` stay on the original protocol 2 control channel; a heartbeat over that same channel refreshes the transfer's idle timer and re-checks permission roughly every 20 seconds in place of the per-chunk RPC check protocol 3 removes. A browser or agent core that predates protocol 3 falls back automatically to the sequential protocol 2 `uploadChunk`/`requestChunk` RPC loop — no coordinated update is required for this fallback, unlike the propose/authorize/approve challenge protocol 2 itself needs. See [the protocol](docs/PROTOCOL.md) for the full design and its accepted trade-offs.

### Limits and cancellation

- The current hard maximum is **100 MiB (104857600 bytes)** per file in either direction. The former 3 GB claim has been removed pending browser/device qualification.
- Where `showSaveFilePicker` is available, downloads write incrementally to a browser-managed file stream. Other browsers use a Blob fallback bounded by the same 100 MiB limit. A target-browser test is still required; JavaScript feature detection is not a browser compatibility certification.
- At most 500 directory entries are returned; very large responses fail explicitly.
- Agent authorization challenges expire after 10 seconds; helper command waiting is limited to 25 seconds, server waiting to 30 seconds, and browser waiting to 35 seconds. These apply to every control-channel request (`startUpload`/`startDownload`/`finishUpload`/`finishDownload`/`cancel`, and to `uploadChunk`/`requestChunk` on the protocol 2 fallback path).
- On a protocol 3 chunk tunnel, the agent sends a heartbeat roughly every 20 seconds and tears the tunnel down after 90 seconds without any chunk activity (independent of the browser ever closing it cleanly); the browser applies its own coarse ~60-second inactivity watchdog to the same tunnel.
- Idle transfers expire on the worker and server after 120 seconds. An idle worker with no transfers exits after 120 seconds; disconnecting the agent also stops it. Browser/session loss prevents further authorization; helper inactivity cleanup releases abandoned handles.
- Cancel waits for an in-flight chunk before requesting cancellation. Once a file has already been committed, Cancel does not undo it. A waiting timeout is not confirmation that a mutation was rolled back; inspect the device before retrying a timed-out mutation.

The worker uses a locked `.omniosfiles-lock` file and reserves the `.omniosfiles-` prefix. Graceful shutdown and cancellation remove its own temporary files. A hard kill or power loss can leave `.omniosfiles-<random>.part` files; they are hidden from the plugin. Recovery is deliberately manual: with all workers/transfers stopped and the lock no longer held, inspect the exact orphan file and remove only that confirmed orphan. The plugin never scans and deletes files by a wildcard during startup.

The local `user` account and administrators who can modify/move the filesystem tree or worker files remain trusted. Descriptor-relative access prevents symlink redirection, but it is not an OS sandbox against a hostile process with the same UID or root privileges. Keep the ancestry of `/var/nr` under trusted administration.

## Device requirements

- Linux OmniOS with `/usr/bin/python3` (Python 3.8 or newer), Linux `renameat2`, and local `user` user/group.
- `user` must have read/write access to `/var/nr` for worker locking and staging, plus the relevant access to target directories/files.
- MeshAgent must support `EncryptionStream.GenerateRandom`, subprocess stdin/stdout/stderr and process termination. These native contracts require qualification on the actual agent binary.
- The worker is bundled in the default agent core; no separately installed helper service or Python package is required.

## Configuration

`config.json` contains the plugin manifest and these server-controlled settings:

```json
{
  "settings": {
    "maxFileSize": 104857600,
    "maxConcurrentTransfers": 3,
    "filterMode": "blacklist",
    "allowedExtensions": [],
    "blockedExtensions": [".exe", ".bat", ".cmd", ".com", ".scr", ".pif"],
    "debug": false
  }
}
```

`debug` (default `false`) turns on lifecycle logging for diagnosing a stuck or failed transfer without opening the browser's DevTools Network tab: the server logs each job/transfer event to its own process log (`console.log`, prefixed `[omniosfiles]`), the agent reports the same for its side through the device's Console tab (`mesh.SendCommand({action:'msg', type:'console', ...})`, per [the plugin development guide](../MeshCentral/meshcentral-plugin-development-prompt.md)), and the browser logs to its own console. It is not a security boundary and reveals internal identifiers such as `transferId` and job IDs to anyone who can read those three logs — leave it off outside active troubleshooting.

`maxFileSize` can be reduced but cannot exceed 100 MiB. `maxConcurrentTransfers` must be 1–3. An empty whitelist rejects all filenames. Extension rules apply to upload destinations and rename destinations, including filenames supplied outside the UI. Browsing/downloading existing files is governed by read permission. Chunk size, root and execution account are fixed; the old configurable `basePath`, `runAsUser`, `runAsGroup`, `chunkSize` and optional-checksum settings no longer apply.

## Install and update

Enable plugins in MeshCentral's running data configuration. Install through its plugin manager. For manual installation, copy into `<meshcentral-data>/plugins/omniosfiles/` and register `omniosfiles` through the plugin database or `settings.plugins.list`. Copying a repository directory alone does not register it.

Server, agent and browser **must be updated together** for protocol 2. Old uncorrelated agent commands are not accepted. Avoid core redistribution during active device operations. Protocol 3 (the chunk tunnel) is an addition on top of protocol 2, not a coordinated cutover: it is feature-detected from `transferId` in the `startUpload`/`startDownload` response, so an agent core or browser tab that has not picked up this update keeps working over the unchanged protocol 2 `uploadChunk`/`requestChunk` loop automatically.

1. Copy the intended files to the installed plugin directory and reload the server plugin.
2. Rebuild and synchronize the default core on one test device from an authenticated administrator browser console:

   ```javascript
   meshserver.send({action: 'uploadagentcore', type: 'default', nodeids: ['node/<domain>/<device-id>']});
   ```

3. Wait for the agent core to become stable and fully reload the browser page.
4. Verify permissions, filesystem behavior, cancellation and checksum on the test device before synchronizing more devices.

For the currently selected device, the complete browser console command is:

```javascript
meshserver.send({action: 'uploadagentcore', type: 'default', nodeids: [currentNode._id]});
```

`uploadagentcore` is an action name inside this message, not a standalone JavaScript function. If the core bundle has already been rebuilt by installation/startup, `distributeCore()` can synchronize that existing bundle.

A failed listing is shown as an error, not an empty directory. A successful Refresh clears the previous listing error. Request timeouts identify whether the server is waiting for the agent module, authorization, or the file worker; agent initialization/randomness errors are reported explicitly.

In this MeshCentral checkout, `distributeCore()` synchronizes a bundle already held in memory; it does not rebuild edited modules. Reload alone does not refresh installed manifest metadata; use normal upgrade/startup handling for that metadata.

## Development and qualification

Source order: [MeshCentral implementation](../MeshCentral/) first, plugin code second, documentation/tests as supporting evidence. See [the current development guide](../MeshCentral/meshcentral-plugin-development-prompt.md).

Edit `helper/omniosfiles.py`, then regenerate its distributable module:

```sh
node scripts/build-helper.js
MESHCENTRAL_SOURCE=../MeshCentral node --test tests/*.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
git diff --check
```

Tests use Node.js 18+ and an isolated Linux filesystem. Set `MESHCENTRAL_SOURCE` to the actual core checkout for the permission integration test; without an available checkout that one test is explicitly skipped. The round-trip test runs the actual Python worker transport with a temporary root/current UID, adapting MeshAgent subprocess argv semantics to Node.js. It does not execute as the deployed `user` or certify the deployed MeshAgent binary. An additional native smoke test runs the Linux x86-64 MeshAgent binary from the selected checkout, with only network transport and the test root/UID substituted. This exercises actual module loading, secure randomness, subprocess argv/streams, timers and worker JSON. Set `MESHAGENT_BINARY` to another compatible local binary if needed; the native test is explicitly skipped when unavailable.

Before production use, complete the remaining checkboxes in [PLAN.md](PLAN.md): real permission UI and `No Files`, native randomness/process APIs, execution as user:user, supported browsers, disconnect/core replacement and resource cleanup. Large-file support beyond 100 MiB is a separate qualification gate. Resume after restart and drag-and-drop are outside this release candidate.

### Browser UI regression checks

`node --test tests/browser-ui.test.js` runs the actual serialized frontend in
headless Chromium through its local debugging interface. It checks keyboard
navigation, submission/cancellation, focus return, disabled controls, text
contrast and narrow layouts with long paths. It requires a Node runtime with
global `WebSocket` and Chrome at `/usr/bin/google-chrome`, or `CHROME_BINARY`.
The test skips explicitly when these requirements are absent. It uses only
a temporary local page and profile, without connecting to a deployed server.

To save local visual samples for review (light/night themes, a long Unicode
path, empty/error states, transfer progress and the rename dialog):

```bash
OMNIOSFILES_SCREENSHOTS=/tmp/omniosfiles-ui-review node --test tests/browser-ui.test.js
```

These screenshots use synthetic data in a narrow viewport; they are not
evidence of deployed-device operation. The round-trip test separately checks
create/rename/upload/download/delete and final filesystem modes through the
server and agent bridge with a real Python worker in a temporary directory.

### Native Buffer framing fix (rc.11)

This update changes the agent module. After installing the plugin files and
reloading the server plugin, rebuild and synchronize the default agent core
using the update procedure above, then fully reload the browser. A plugin Reload
alone does not replace code already running on a device. Repeat the previously
failing 13 MiB upload and download, comparing SHA-256 of both files. See
[NATIVE_RUNTIME.md](NATIVE_RUNTIME.md) for the Buffer audit and native test scope.

### Worker exit diagnostics (rc.12)

After updating the server plugin, rebuild/synchronize the agent core and reload
the browser; both the agent bridge and bundled Python helper changed. A tunnel
error now preserves the actual stop reason. For `File worker exited`, record
`code`, `signal`, and `stderr` (some native builds may omit exit arguments).
The helper emits `omniosfiles-worker exit=... processed=N buffered=N` to stderr
on EOF, idle exit, SIGTERM and exceptions. SIGKILL cannot emit this summary.
With debug enabled, the agent's `stop` line also lists pending operation names
and chunk indices. No request contents are added to these diagnostics.

A local native upload of 13 MiB with an eight-chunk window passes. This does
not explain or resolve an unexpected worker exit on another device; capture
the new exit details during the failing deployment before assigning a cause.

### Debug logging and disconnects (rc.13)

MeshCentral's agent Console repetition guard closes an agent connection after
more than 30 repeated console messages. The previous debug logger emitted
the same `execute uploadChunk <transferId>` (or requestChunk) for each chunk.
This can terminate a transfer while the MeshAgent service PID remains unchanged.
rc.13 suppresses per-chunk Console logging; lifecycle/error diagnostics remain.
The server guard is unchanged. Install the update, Reload the plugin, rebuild
and synchronize the agent core, and reload the page before retesting.

### Upload buffer ownership (rc.14)

Incoming tunnel buffers are copied before asynchronous queueing, including
unescaped chunks. A regression test deliberately reuses the input storage;
the native upload test now overwrites every incoming frame after its callback.
The helper distinguishes size mismatch from SHA-256 mismatch. Neither failure
publishes the destination. This addresses a reproducible queue-lifetime hazard;
the reported deployed-file mismatch still needs a retest. Update the server
plugin and rebuild/synchronize the agent core, then reload the browser.

### RTT control frames (rc.16)

The browser redirect sends a text RTT control frame every ten seconds. With a
13-digit timestamp its JSON length is 56 characters. Native WebSocket text
callbacks deliver a string, so checking only numeric data[0] === 123 misclassifies
that string as binary upload data. rc.16 parses text frames separately and delegates
core controls to the original tunnel handler; RTT and ping remain functional.
Update the plugin, Reload, rebuild/synchronize the agent core and reload the
page before repeating the affected file. The native regression test includes
these control frames; earlier isolated binary-only tunnel tests did not.
