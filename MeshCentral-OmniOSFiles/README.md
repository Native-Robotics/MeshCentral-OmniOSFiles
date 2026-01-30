# MeshCentral-OmniOSFiles

A MeshCentral plugin that provides a restricted file browser for the `/var/nr` directory with full file operations support.

## Features

- **Restricted Access**: File operations are limited to `/var/nr` directory only
- **Custom Tab**: Dedicated "OmniOS Files" tab in the device panel
- **Full File Operations**: Upload, download, delete, rename, create directories
- **Large File Support**: Chunked transfer supports files up to 3GB
- **SHA-256 Verification**: Optional checksum verification for file integrity
- **Security**: 
  - Path traversal protection
  - Symlink escape prevention
  - File operations run as `user:user`
  - Configurable file extension whitelist/blacklist

## Requirements

- MeshCentral >= 1.1.35
- Node.js >= 12.x
- Target devices must have `/var/nr` directory

## Installation

1. Download or clone this repository
2. Copy the `MeshCentral-OmniOSFiles` folder to your MeshCentral's `meshcentral-data/plugins/` directory
3. Enable the plugin in MeshCentral's config.json:

```json
{
  "settings": {
    "plugins": {
      "enabled": true
    }
  }
}
```

4. Restart MeshCentral
5. Enable the plugin in the MeshCentral web interface (My Server → Plugins)

## Configuration

Edit `config.json` to customize plugin behavior:

```json
{
  "settings": {
    "basePath": "/var/nr",
    "runAsUser": "user",
    "runAsGroup": "user",
    "filterMode": "blacklist",
    "allowedExtensions": [],
    "blockedExtensions": [".exe", ".bat", ".cmd", ".com", ".scr", ".pif"],
    "maxFileSize": 3221225472,
    "chunkSize": 65536,
    "enableChecksum": true,
    "maxConcurrentTransfers": 3
  }
}
```

### Settings Description

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `basePath` | string | `/var/nr` | Root directory for file operations |
| `runAsUser` | string | `user` | User ownership for created files |
| `runAsGroup` | string | `user` | Group ownership for created files |
| `filterMode` | string | `blacklist` | Filter mode: `whitelist` or `blacklist` |
| `allowedExtensions` | array | `[]` | Extensions allowed in whitelist mode |
| `blockedExtensions` | array | `[".exe", ...]` | Extensions blocked in blacklist mode |
| `maxFileSize` | number | `3221225472` | Maximum file size in bytes (3GB) |
| `chunkSize` | number | `65536` | Transfer chunk size in bytes (64KB) |
| `enableChecksum` | boolean | `true` | Enable SHA-256 verification |
| `maxConcurrentTransfers` | number | `3` | Maximum concurrent transfers |

## Usage

1. Navigate to a device in MeshCentral
2. Click the "OmniOS Files" tab
3. Use the interface to:
   - **Navigate**: Click folders or use breadcrumb
   - **Upload**: Click "Upload" button and select a file
   - **Download**: Click ⬇️ button next to a file
   - **New Folder**: Click "New Folder" button
   - **Rename**: Click ✏️ button
   - **Delete**: Click 🗑️ button

## Security Considerations

### Disabling Standard File Browser

To fully restrict file access, disable the standard file browser for device groups:

1. Go to MeshCentral → Mesh → Edit Group
2. In user permissions, enable "No Files" (`MESHRIGHT_NOFILES`)
3. Users will only be able to access files through this plugin

### Path Security

The plugin implements multiple security layers:
- Path normalization and validation
- Prevention of `../` traversal attacks
- Symlink target verification
- All paths must resolve within `/var/nr`

## Roadmap

- [ ] v1.1: Drag & drop upload, multiple file selection
- [ ] v2.0: Resume interrupted transfers

## License

Apache License 2.0 - See [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please submit pull requests to the GitHub repository.

## Support

For issues and feature requests, please use the GitHub issue tracker.
