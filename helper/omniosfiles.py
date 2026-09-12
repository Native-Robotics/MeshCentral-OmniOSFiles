"""Restricted Linux file worker. Commands arrive only from the authorized agent module."""
import base64
import ctypes
import errno
import fcntl
import grp
import hashlib
import json
import os
import pwd
import re
import select
import signal
import stat
import sys
import time
import uuid

# Kept in sync with server.js's CHUNK -- see the comment there for why 16 KiB, not 64 KiB.
CHUNK = 16384
MAX_SIZE = 100 * 1024 * 1024
DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE = os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
RESERVED = '.omniosfiles-'


def rename_exclusive(src_fd, src, dst_fd, dst):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, 'renameat2', None)
    if fn is None:
        raise RuntimeError('renameat2 is required for safe rename')
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(src_fd, os.fsencode(src), dst_fd, os.fsencode(dst), 1) != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))


class Worker:
    def __init__(self, root):
        self.root = os.open(root, DIR)
        self.transfers = {}
        self.lock = None
        try:
            self.lock = os.open('.omniosfiles-lock', os.O_CREAT | os.O_RDWR | FILE, 0o600, dir_fd=self.root)
            if not stat.S_ISREG(os.fstat(self.lock).st_mode) or os.fstat(self.lock).st_nlink != 1:
                raise ValueError('Invalid worker lock')
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            if self.lock is not None:
                os.close(self.lock)
            os.close(self.root)
            raise

    def close(self):
        for key in list(self.transfers):
            self.cleanup(key)
        os.close(self.lock)
        os.close(self.root)

    @staticmethod
    def parts(path):
        if not isinstance(path, str) or not path.startswith('/') or len(path) > 4096 or '\0' in path:
            raise ValueError('Invalid path')
        parts = [p for p in path.split('/') if p]
        if any(p in ('.', '..') or p.startswith(RESERVED) for p in parts):
            raise ValueError('Invalid or reserved path')
        return parts

    def directory(self, parts):
        fd = os.dup(self.root)
        try:
            for part in parts:
                new = os.open(part, DIR, dir_fd=fd)
                os.close(fd)
                fd = new
            return fd
        except Exception:
            os.close(fd)
            raise

    def parent(self, path):
        parts = self.parts(path)
        if not parts:
            raise ValueError('Cannot modify or transfer the root directory')
        return self.directory(parts[:-1]), parts[-1]

    @staticmethod
    def regular(st):
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise ValueError('Only regular files with one link are supported')

    @staticmethod
    def policy(value):
        if not isinstance(value, dict):
            raise ValueError('Policy required')
        size = value.get('maxFileSize')
        count = value.get('maxConcurrentTransfers')
        if type(size) is not int or not 0 <= size <= MAX_SIZE or type(count) is not int or not 1 <= count <= 3 or value.get('chunkSize') != CHUNK:
            raise ValueError('Invalid transfer limits')
        if value.get('filterMode') not in ('whitelist', 'blacklist'):
            raise ValueError('Invalid filter mode')
        for key in ('allowedExtensions', 'blockedExtensions'):
            entries = value.get(key)
            if not isinstance(entries, list) or len(entries) > 100 or any(not isinstance(x, str) or not re.fullmatch(r'\.[a-z0-9_-]{1,20}', x) for x in entries):
                raise ValueError('Invalid extension filter')
        return value

    @staticmethod
    def extension(path, policy):
        ext = os.path.splitext(path)[1].lower()
        if (policy['filterMode'] == 'whitelist' and ext not in policy['allowedExtensions']) or (policy['filterMode'] == 'blacklist' and ext in policy['blockedExtensions']):
            raise ValueError('File extension not allowed')

    def conflict(self, path):
        path = '/' + '/'.join(self.parts(path))
        for t in self.transfers.values():
            other = t['path']
            if other == path or other.startswith(path + '/') or path.startswith(other + '/'):
                raise ValueError('Path has an active transfer')

    def cleanup(self, key):
        t = self.transfers.pop(key, None)
        if not t:
            return
        try:
            os.close(t['fd'])
        finally:
            if t['upload']:
                try:
                    # No wildcard cleanup: only this worker's exact private temporary file.
                    os.unlink(t['temp'], dir_fd=t['parent'])
                except FileNotFoundError:
                    pass
            os.close(t['parent'])

    def expire(self):
        for key, t in list(self.transfers.items()):
            if time.monotonic() - t['time'] > 120:
                self.cleanup(key)

    def remove_tree(self, parent, name):
        st = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if stat.S_ISLNK(st.st_mode):
            # Never follow even nested links. Remove the link itself, not its target.
            os.unlink(name, dir_fd=parent)
        elif stat.S_ISDIR(st.st_mode):
            fd = os.open(name, DIR, dir_fd=parent)
            try:
                for child in os.listdir(fd):
                    if child.startswith(RESERVED):
                        raise ValueError('Directory contains worker state; manual inspection required')
                    self.remove_tree(fd, child)
            finally:
                os.close(fd)
            os.rmdir(name, dir_fd=parent)
        else:
            self.regular(st)
            os.unlink(name, dir_fd=parent)

    def operate(self, message):
        if message.get('protocol') != 2:
            raise ValueError('Unsupported protocol')
        action, args = message.get('action'), message.get('args', {})
        policy = self.policy(message.get('policy'))
        if not isinstance(args, dict):
            raise ValueError('Invalid arguments')
        key = message.get('transferId')
        if key is not None and (not isinstance(key, str) or not re.fullmatch('[a-f0-9]{48}', key)):
            raise ValueError('Invalid transfer ID')
        self.expire()
        if action in ('listDir', 'fileInfo'):
            parts = self.parts(args.get('path'))
            if action == 'listDir':
                fd = self.directory(parts)
                try:
                    items = []
                    for name in os.listdir(fd):
                        if name.startswith(RESERVED):
                            continue
                        if len(items) >= 500:
                            raise ValueError('Directory exceeds 500 entries; narrow it on the device')
                        st = os.stat(name, dir_fd=fd, follow_symlinks=False)
                        items.append(dict(name=name, path='/' + '/'.join(parts + [name]), isDirectory=stat.S_ISDIR(st.st_mode), isLink=stat.S_ISLNK(st.st_mode), supported=stat.S_ISDIR(st.st_mode) or (stat.S_ISREG(st.st_mode) and st.st_nlink == 1), size=st.st_size, mtime=st.st_mtime * 1000))
                    items.sort(key=lambda x: (not x['isDirectory'], x['name']))
                    return dict(type='listDirResult', path='/' + '/'.join(parts), items=items)
                finally:
                    os.close(fd)
            fd, name = self.parent(args.get('path'))
            try:
                st = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if not stat.S_ISDIR(st.st_mode):
                    self.regular(st)
                return dict(type='fileInfoResult', size=st.st_size, mtime=st.st_mtime * 1000)
            finally:
                os.close(fd)
        if action in ('createDir', 'delete', 'rename'):
            src = args.get('srcPath') if action == 'rename' else args.get('path')
            self.conflict(src)
            fd, name = self.parent(src)
            try:
                if action == 'createDir':
                    os.mkdir(name, 0o775, dir_fd=fd)
                    # Keep the worker umask restrictive for temporary files, then set
                    # the requested final mode on the newly opened directory itself.
                    created = os.open(name, DIR, dir_fd=fd)
                    try:
                        os.fchmod(created, 0o775)
                    finally:
                        os.close(created)
                elif action == 'delete':
                    # Explicit paths through symlinks are rejected; recursive deletion unlinks nested links.
                    if stat.S_ISLNK(os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode):
                        raise ValueError('Symlink operations are not supported')
                    self.remove_tree(fd, name)
                else:
                    dst = args.get('dstPath')
                    self.conflict(dst)
                    self.extension(dst, policy)
                    st = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if not stat.S_ISDIR(st.st_mode):
                        self.regular(st)
                    dest_fd, dest = self.parent(dst)
                    try:
                        rename_exclusive(fd, name, dest_fd, dest)
                    finally:
                        os.close(dest_fd)
                return dict(type=action + 'Result')
            finally:
                os.close(fd)
        if action in ('startUpload', 'startDownload'):
            if key is None or key in self.transfers or len(self.transfers) >= policy['maxConcurrentTransfers']:
                raise ValueError('Transfer limit or duplicate ID')
            path = '/' + '/'.join(self.parts(args.get('path')))
            self.conflict(path)
            parent, name = self.parent(path)
            fd, temp = None, None
            upload = action == 'startUpload'
            try:
                if upload:
                    self.extension(path, policy)
                    total = args.get('totalSize')
                    if type(total) is not int or not 0 <= total <= policy['maxFileSize']:
                        raise ValueError('Invalid file size')
                    try:
                        os.stat(name, dir_fd=parent, follow_symlinks=False)
                    except FileNotFoundError:
                        pass
                    else:
                        raise FileExistsError('Destination already exists')
                    temp = RESERVED + uuid.uuid4().hex + '.part'
                    fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | FILE, 0o600, dir_fd=parent)
                    snapshot = None
                else:
                    fd = os.open(name, os.O_RDONLY | FILE, dir_fd=parent)
                    st = os.fstat(fd)
                    self.regular(st)
                    total = st.st_size
                    if total > policy['maxFileSize']:
                        raise ValueError('File exceeds the qualified size limit')
                    snapshot = (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
                self.transfers[key] = dict(fd=fd, parent=parent, name=name, path=path, temp=temp, upload=upload, total=total, offset=0, index=0, hash=hashlib.sha256(), time=time.monotonic(), snapshot=snapshot)
                return dict(type='uploadReady' if upload else 'downloadStart', totalSize=total, fileName=name, chunkSize=CHUNK, transferId=key)
            except Exception:
                if fd is not None:
                    os.close(fd)
                if temp:
                    try:
                        os.unlink(temp, dir_fd=parent)
                    except FileNotFoundError:
                        pass
                os.close(parent)
                raise
        t = self.transfers.get(key)
        if not t:
            raise ValueError('Unknown or expired transfer')
        t['time'] = time.monotonic()
        if action == 'cancel':
            self.cleanup(key)
            return dict(type='cancelled')
        try:
            if action in ('uploadChunk', 'requestChunk'):
                if type(args.get('chunkIndex')) is not int or args['chunkIndex'] != t['index']:
                    raise ValueError('Unexpected chunk index')
                if t['upload'] != (action == 'uploadChunk'):
                    raise ValueError('Wrong transfer direction')
                expected = min(CHUNK, t['total'] - t['offset'])
                if expected <= 0:
                    raise ValueError('No remaining bytes; finish the transfer')
                if t['upload']:
                    encoded = args.get('data')
                    if not isinstance(encoded, str) or len(encoded) > ((CHUNK + 2) // 3) * 4:
                        raise ValueError('Invalid chunk')
                    data = base64.b64decode(encoded, validate=True)
                    if len(data) != expected:
                        raise ValueError('Unexpected chunk length: index=' + str(args['chunkIndex']) + ', expected=' + str(expected) + ', actual=' + str(len(data)) + ', offset=' + str(t['offset']) + ', total=' + str(t['total']))
                    view = memoryview(data)
                    while view:
                        n = os.write(t['fd'], view)
                        if n <= 0:
                            raise OSError('Short write')
                        view = view[n:]
                else:
                    data = os.read(t['fd'], expected)
                    if len(data) != expected:
                        raise ValueError('Source file changed or short read')
                t['hash'].update(data)
                t['offset'] += len(data)
                t['index'] += 1
                result = dict(type='uploadAck' if t['upload'] else 'downloadChunk', chunkIndex=args['chunkIndex'], receivedBytes=t['offset'])
                if not t['upload']:
                    result['data'] = base64.b64encode(data).decode('ascii')
                return result
            if action not in ('finishUpload', 'finishDownload') or t['upload'] != (action == 'finishUpload'):
                raise ValueError('Invalid transfer action')
            if t['offset'] != t['total']:
                raise ValueError('Size mismatch: received ' + str(t['offset']) + ', expected ' + str(t['total']))
            if args.get('checksum') != t['hash'].hexdigest():
                raise ValueError('SHA-256 mismatch after ' + str(t['offset']) + ' bytes')
            if t['upload']:
                os.fsync(t['fd'])
                st = os.fstat(t['fd'])
                self.regular(st)
                if st.st_size != t['total']:
                    raise ValueError('Temporary file changed')
                os.fchmod(t['fd'], 0o664)
                rename_exclusive(t['parent'], t['temp'], t['parent'], t['name'])
                try:
                    os.fsync(t['parent'])
                except OSError as error:
                    raise RuntimeError('File was published but directory sync failed; inspect destination before retrying') from error
            else:
                st = os.fstat(t['fd'])
                if t['snapshot'] != (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns):
                    raise ValueError('Source file changed during download')
            result = dict(type='uploadComplete' if t['upload'] else 'downloadComplete', checksum=t['hash'].hexdigest())
            self.cleanup(key)
            return result
        except Exception:
            self.cleanup(key)
            raise


def main():
    worker = None
    exit_reason = 'exception'
    processed = 0
    buffer = b''
    def terminate(signum, frame):
        nonlocal exit_reason
        exit_reason = 'signal:' + str(signum)
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    try:
        if not sys.platform.startswith('linux'):
            raise RuntimeError('Only Linux OmniOS is supported')
        user, group = pwd.getpwnam('user'), grp.getgrnam('user')
        if os.geteuid() == 0:
            os.setgroups([])
            os.setgid(group.gr_gid)
            os.setuid(user.pw_uid)
        if os.geteuid() != user.pw_uid or os.getegid() != group.gr_gid:
            raise PermissionError('Worker must run as user:user')
        os.umask(0o077)
        worker = Worker('/var/nr')
        buffer = b''
        last_activity = time.monotonic()
        while True:
            worker.expire()
            if not worker.transfers and time.monotonic() - last_activity > 120:
                exit_reason = 'idle'
                break
            if not select.select([sys.stdin], [], [], 1)[0]:
                continue
            block = os.read(sys.stdin.fileno(), 65536)
            if not block:
                exit_reason = 'stdin-eof'
                break
            last_activity = time.monotonic()
            buffer += block
            if len(buffer) > 200000:
                raise ValueError('Input frame limit exceeded')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                message = json.loads(line)
                processed += 1
                try:
                    result = worker.operate(message['payload'])
                except Exception as e:
                    result = dict(type='error', error=str(e)[:4096])
                response = json.dumps(dict(id=message['id'], result=result), ensure_ascii=True)
                if len(response) > 190000:
                    response = json.dumps(dict(id=message['id'], result=dict(type='error', error='Directory response too large')))
                print(response, flush=True)
    finally:
        print('omniosfiles-worker exit=' + exit_reason + ' processed=' + str(processed) + ' buffered=' + str(len(buffer)), file=sys.stderr, flush=True)
        if worker:
            worker.close()


if __name__ == '__main__':
    main()
