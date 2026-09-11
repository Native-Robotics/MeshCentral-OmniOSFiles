# MeshCentral OmniOS Files

A file manager restricted to `/var/nr` on Linux OmniOS PCs. It provides directory browsing, upload, download, directory creation, rename and recursive deletion through separately assigned plugin permissions. The device Plugins tab contains a toolbar, breadcrumbs, directory-first file listing, compact action buttons and transfer progress.

The 2.0 protocol replaces the 1.x implementation. **This is a release candidate for device qualification**, not a claim that the deployed MeshAgent has been tested. See [PLAN.md](PLAN.md) for completed tasks and [the deployment checklist](docs/DEPLOYMENT-CHECKLIST.md) for real-device checks.

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

Uploads use exclusive temporary files in the destination directory. The worker validates byte counts and SHA-256, sets the final mode to `0644`, and publishes with Linux `renameat2(RENAME_NOREPLACE)`. Existing destinations are never silently replaced. Create/rename/delete return errors when access or an operation fails. Recursive deletion can be partially completed before an error; it is not transactional.

Transfers use sequential 64 KiB chunks with mandatory incremental SHA-256 validation. Empty files work. A changed download source, duplicate/out-of-order chunk, size mismatch or checksum mismatch fails the operation. Conflicting operations on a path are rejected while a transfer is active. One browser tab offers one transfer per device; the worker/server allow up to three across sessions.

### Limits and cancellation

- The current hard maximum is **100 MiB (104857600 bytes)** per file in either direction. The former 3 GB claim has been removed pending browser/device qualification.
- Where `showSaveFilePicker` is available, downloads write incrementally to a browser-managed file stream. Other browsers use a Blob fallback bounded by the same 100 MiB limit. A target-browser test is still required; JavaScript feature detection is not a browser compatibility certification.
- At most 500 directory entries are returned; very large responses fail explicitly.
- Agent authorization challenges expire after 10 seconds; helper command waiting is limited to 25 seconds, server waiting to 30 seconds, and browser waiting to 35 seconds.
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
    "blockedExtensions": [".exe", ".bat", ".cmd", ".com", ".scr", ".pif"]
  }
}
```

`maxFileSize` can be reduced but cannot exceed 100 MiB. `maxConcurrentTransfers` must be 1–3. An empty whitelist rejects all filenames. Extension rules apply to upload destinations and rename destinations, including filenames supplied outside the UI. Browsing/downloading existing files is governed by read permission. Chunk size, root and execution account are fixed; the old configurable `basePath`, `runAsUser`, `runAsGroup`, `chunkSize` and optional-checksum settings no longer apply.

## Install and update

Enable plugins in MeshCentral's running data configuration. Install through its plugin manager. For manual installation, copy into `<meshcentral-data>/plugins/omniosfiles/` and register `omniosfiles` through the plugin database or `settings.plugins.list`. Copying a repository directory alone does not register it.

Server, agent and browser **must be updated together** for protocol 2. Old uncorrelated agent commands are not accepted. Avoid core redistribution during active device operations.

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
