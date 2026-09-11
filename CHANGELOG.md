# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
