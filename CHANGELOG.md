# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
