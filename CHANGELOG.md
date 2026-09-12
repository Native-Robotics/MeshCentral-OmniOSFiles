# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-rc.17]

### Fixed

- Stop logging every download chunkAck to the agent Console. Real MeshCentral core routes protocol-7 tunnel JSON control frames through the plugin's `consoleaction` entry point in addition to the tunnel's own data handler; a download's flow-control chunkAck arrives there once per window credit, identically each time, and tripped the same >30-repeat Console disconnect guard that rc.13 already fixed for upload chunk logging in `execute()`. Confirmed against a real deployment: "consoleaction chunkAck via-tunnel" repeated ~31 times immediately before "Agent disconnected" mid-download.

### Tests

- Drive 256 chunkAck calls through `consoleaction` directly (the delivery path `fakeTunnel` does not model) against the real repetition guard extracted from `meshagent.js`; verify no disconnect and confirm the same guard does trip on the old unfiltered message.

## [2.0.0-rc.16]

### Fixed

- Recognize native WebSocket text frames before queueing upload data. MeshCentral's periodic RTT JSON is 56 characters long and was incorrectly converted into a 56-byte file chunk, causing length or checksum failures.
- Retain the original tunnel data handler and delegate core control frames to it so RTT/ping continue working. Text frames never enter the binary upload queue.

### Tests

- Reproduce the 56-byte RTT corruption and verify text/binary control routing.
- Exercise the native 13 MiB upload with repeated text RTT/ping frames and the real MeshCentral control handler; verify control responses, file bytes and SHA-256.

## [2.0.0-rc.15]

### Diagnostics

- Report expected/actual chunk lengths, index, offset and total size from the worker.
- Preserve input frame length, copied byte count and escape status alongside upload errors. No payload bytes are logged. Length and checksum enforcement are unchanged.

## [2.0.0-rc.14]

### Fixed

- Copy every incoming upload chunk into owned storage before queueing it, including ordinary unescaped frames. Reuse of a tunnel input buffer must not change bytes awaiting worker processing.
- Distinguish received-size mismatch from SHA-256 mismatch and report byte counts; failed uploads remain unpublished.

### Tests

- Reproduce queued buffer mutation and exercise the native 13 MiB upload while overwriting each input frame after its callback returns.

## [2.0.0-rc.13]

### Fixed

- Stop logging every upload/download chunk to the agent Console. Repeated identical debug messages trigger MeshCentral's console repetition guard, disconnecting the agent and its transfer tunnel without restarting the service. Lifecycle and error logging remain available.
- Test 256 upload acknowledgements with debug enabled against the repetition guard extracted from the actual MeshCentral source, and verify that the old repeated message trips it.

## [2.0.0-rc.12]

### Changed

- Preserve the actual worker stop cause in tunnel and control-channel errors instead of replacing it with "File worker restarted" or claiming unconfirmed cleanup.
- Report worker exit code/signal and captured stderr. Debug stop logs include pending operation names and chunk indices, without file contents.
- Emit a Python exit summary for EOF, idle expiry, SIGTERM or exceptions, including processed-command and buffered-byte counts.

### Tests

- Upload 13 MiB plus a short final chunk through a real native MeshAgent tunnel with an eight-chunk window; verify exact file bytes and SHA-256.
- Verify EOF/SIGTERM diagnostics and forwarding of exit details to an idle tunnel. The deployed unexpected process exit has not been reproduced locally.

## [2.0.0-rc.11]

### Fixed

- Copy escaped upload bytes into an allocated native Buffer before base64 encoding, avoiding broken typed-array view conversion in MeshAgent.
- Allocate and copy download escape frames instead of Buffer.from([0]), which can silently omit the prefix in native MeshAgent.

### Tests

- Verify both framing markers in native upload/download paths, ordinary chunks, a short final download chunk, checksums and exact bytes. Record the agent-module Buffer audit in NATIVE_RUNTIME.md.
- Close Chromium gracefully before removing its temporary test profile.

## [2.0.0-rc.10]

### Fixed

- Fix real uploads hanging on the very first chunk after the tunnel opened and bound correctly ("Transfer aborted safely; the worker already removed any partial temp file, retry the transfer" after a ~25s wait). Confirmed against the real native MeshAgent binary: a single stdin write of a full 64 KiB `uploadChunk` line (base64 + JSON framing, ~88 KB) to the Python worker was silently truncated once it crossed roughly a pipe's default 64 KiB buffer. The chunk size drops to 16 KiB across the server, Python worker, agent module and browser client. `tests/native-runtime.test.js` now drives a full upload through the real binary and reproduces the exact failure if the chunk size is forced back to 64 KiB.

## [2.0.0-rc.9]

### Fixed

- Fix the plugin getting stuck on "Checking access..." forever after every full MeshCentral server restart (confirmed on a production deployment's log: `Error loading plugin handler (TypeError: Cannot read properties of null (reading 'wssessions2'))`, repeated until a manual plugin reload). Core can construct plugins before `parent.parent.webserver` exists yet; the plugin used to capture that reference once and keep it frozen as `null` for its whole process lifetime. It is now re-read on every use. Pre-existing behavior, unrelated to protocol 3.
- Any other unexpected exception while handling a browser request now sends a real error back instead of silently leaving the browser to hit its own 35-second client-side timeout.

## [2.0.0-rc.8]

### Fixed

- Fix protocol 3 chunk tunnels never receiving any response on a real device: the agent's heartbeat reschedule and worker-timeout cleanup both called `clearTimeout()` on a timer from within its own just-fired callback, which is a safe no-op in Node.js/browsers but throws "Invalid Parameter" in the real MeshAgent runtime and derails whatever the agent was doing next. Reproduced on-device as a tunnel that opens (WebSocket upgrades) but never gets a `bound`/`bindError` response and stalls the browser's 60-second watchdog.

### Added

- A `debug` setting (default `false`) logs transfer lifecycle events to the server process log, the device's Console tab, and the browser console, to diagnose a stuck or failed transfer without needing DevTools' Network tab.

## [2.0.0-rc.7]

### Fixed

- Fix large-file uploads and downloads stalling at 0% and failing with "The file worker did not return a result": every 64 KiB chunk used to pay for a full propose/authorize/approve/execute round trip, so a single slow round trip out of the ~220 a 14 MB file needed could abort the whole transfer.
- Clear a stale status (e.g. "Operation completed" from an earlier createDir/rename/delete) when a new transfer starts.

### Added

- Protocol 3: chunk transfer moves to a dedicated agent tunnel (MeshCentral core's protocol 7), authorized once per transfer instead of once per chunk, with an 8-chunk pipelining window in both directions. `startUpload`/`startDownload`/`finishUpload`/`finishDownload`/`cancel` stay on the unchanged protocol 2 control channel. A heartbeat replaces the per-chunk permission re-check the RPC path used to provide. See [docs/PROTOCOL.md](docs/PROTOCOL.md).

### Compatibility

- Protocol 3 is additive and feature-detected, not a coordinated cutover: an agent core or browser tab that has not picked up this update keeps working over the unchanged protocol 2 `uploadChunk`/`requestChunk` loop.
- Rebuilding and distributing the agent core is required to actually get the stalled-upload fix; the plugin degrades safely, not silently broken, if that step is skipped.

## [2.0.0-rc.6]

### Fixed

- Use theme-specific, higher-contrast focus outlines for dialog inputs and buttons.

### Tests

- Add an optional headless Chromium check for Tab/Shift+Tab, Enter/Escape, focus restoration, disabled controls, theme text contrast and long Unicode paths in a narrow viewport.

## [2.0.0-rc.5]

### Fixed

- Coalesce repeated device refreshes while capabilities or the directory listing is pending, preserving active transfers.
- Show directory unavailability instead of a stale item count after a listing failure.
- Cover refresh and device-switch lifecycle regressions with browser tests.

## [2.0.0-rc.4]

### Changed

- Adapt the SVAR Willow table and toolbar styling to MeshCentral light/night themes, with local outline SVG icons and no runtime or CDN dependencies.
- Replace browser prompts with keyboard-accessible dialogs for folder creation, rename and deletion.
- Prevent repeated mutations and stale dialog submissions after device/path/permission changes; show mutation errors explicitly.
- Preserve the originating upload directory while the file picker is open and display the final verification phase.

## [2.0.0-rc.3]

### Fixed

- Set new directory permissions to `0775` and completed upload permissions to `0664` as user:user, independently of the worker's restrictive umask.
- Keep upload staging files private with mode `0600` until publication.

## [2.0.0-rc.2]

### Fixed

- Restore the compact toolbar, breadcrumbs, table headers, readable sizes, action icons and progress bar while keeping filenames in DOM text and event handlers.
- Distinguish failed/loading/unloaded directories from successful empty listings; clear a previous listing error after refresh.
- Report agent startup and randomness failures explicitly and identify the stage of a timed-out request.
- Keep the agent entry module loadable when a supporting module is unavailable so it can report the initialization error.
- Add a native MeshAgent regression test and clarify the complete `uploadagentcore` browser command.

## [2.0.0-rc.1]

### Changed

- Require explicit read/write plugin grants and device access independently of standard `No Files` restrictions.
- Replace the 1.x wire protocol with one-time reverse authorization and correlated requests scoped to device, agent and browser session.
- Execute file operations in a bundled Python worker as user:user with descriptor-relative, no-follow paths and exclusive atomic upload publication.
- Validate sequential chunks, exact sizes and incremental SHA-256 in both directions; handle empty files, cancellation, timeouts and conflicting paths.
- Replace filename interpolation in inline JavaScript with DOM text and event handlers; bind asynchronous transfers to their original device.
- Stream downloads when the browser provides a file writer and cap all transfers at 100 MiB pending device/browser qualification.
- Fix the root and worker account; reject invalid settings and make checksum verification mandatory.

### Compatibility

- Update the server plugin, agent core and browser together. Requires the local MeshCentral fork's plugin permission APIs and Linux/Python worker prerequisites.
- This release candidate has local automated coverage; deployed MeshAgent/browser qualification remains open in PLAN.md. Existing files are never overwritten. Orphan recovery after hard termination is manual.

## [1.0.0] - 2026-01-30

### Added

- Initial release
- Custom "OmniOS Files" tab in device panel
- Restricted file browser for `/var/nr` directory
- File operations: upload, download, delete, rename, create directory
- Chunked file transfer supporting files up to 3GB (64KB chunks)
- SHA-256 checksum verification for file integrity
- Path traversal and symlink escape protection
- File ownership set to `user:user` for all created files
- Configurable file extension whitelist/blacklist filtering
- Progress bar with cancel functionality for transfers
- Breadcrumb navigation
