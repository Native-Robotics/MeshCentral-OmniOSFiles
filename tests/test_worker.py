import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'helper/omniosfiles.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
POLICY = dict(maxFileSize=100*1024*1024, chunkSize=65536, maxConcurrentTransfers=3, filterMode='blacklist', allowedExtensions=[], blockedExtensions=['.exe'])
KEY = 'a'*48

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'root'
        self.root.mkdir()
        self.outside = Path(self.tmp.name) / 'outside'
        self.outside.mkdir()
        (self.outside / 'keep').write_text('original')
        self.w = module.Worker(str(self.root))

    def tearDown(self):
        self.w.close()
        self.tmp.cleanup()

    def call(self, action, key=None, **args):
        return self.w.operate(dict(protocol=2, action=action, args=args, transferId=key, policy=POLICY))

    def upload(self, name, data, key=KEY):
        self.call('startUpload', key, path=name, totalSize=len(data))
        for i in range(0, len(data), 65536):
            self.call('uploadChunk', key, chunkIndex=i//65536, data=base64.b64encode(data[i:i+65536]).decode())
        return self.call('finishUpload', key, checksum=hashlib.sha256(data).hexdigest())

    def test_basic_operations_and_root_mapping(self):
        self.call('createDir', path='/folder')
        self.assertEqual(self.call('listDir', path='/')['items'][0]['name'], 'folder')
        self.call('rename', srcPath='/folder', dstPath='/renamed')
        self.call('delete', path='/renamed')
        self.assertEqual(self.call('listDir', path='/')['items'], [])

    def test_paths_and_root_mutations(self):
        for path in ('/../outside', '/../root-other', 'relative', '/x/../y', '/\0', '/.omniosfiles-lock'):
            with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                self.call('createDir', path=path)
        for action in ('delete', 'createDir', 'startDownload'):
            with self.assertRaises(ValueError):
                self.call(action, path='/')
        with self.assertRaises(ValueError):
            self.call('rename', srcPath='/', dstPath='/other')

    def test_symlink_parents_and_recursive_delete(self):
        (self.root / 'escape').symlink_to(self.outside, target_is_directory=True)
        for action in ('listDir', 'startDownload', 'startUpload', 'createDir'):
            with self.subTest(action=action), self.assertRaises(OSError):
                self.call(action, KEY, path='/escape/keep', totalSize=1)
        folder = self.root / 'folder'; folder.mkdir()
        (folder / 'nested').symlink_to(self.outside, target_is_directory=True)
        self.call('delete', path='/folder')
        self.assertEqual((self.outside / 'keep').read_text(), 'original')
        self.assertTrue(self.call('listDir', path='/')['items'][0]['isLink'])

    def test_special_files_and_hardlinks(self):
        os.mkfifo(self.root / 'fifo')
        os.link(self.outside / 'keep', self.root / 'hard')
        for path in ('/fifo', '/hard'):
            with self.assertRaises(ValueError):
                self.call('startDownload', KEY, path=path)

    def test_roundtrip_boundaries(self):
        for size in (0, 1, 65536, 65537, 3*65536+7):
            with self.subTest(size=size):
                data = os.urandom(size)
                name = '/f'+str(size)
                self.assertEqual(self.upload(name, data)['type'], 'uploadComplete')
                self.assertEqual((self.root / name[1:]).read_bytes(), data)
                self.call('startDownload', KEY, path=name)
                downloaded = b''
                for index in range((size+65535)//65536):
                    downloaded += base64.b64decode(self.call('requestChunk', KEY, chunkIndex=index)['data'])
                self.assertEqual(downloaded, data)
                self.assertEqual(self.call('finishDownload', KEY, checksum=hashlib.sha256(data).hexdigest())['type'], 'downloadComplete')
                self.assertEqual(self.w.transfers, {})

    def test_existing_file_is_never_truncated_or_replaced(self):
        (self.root / 'keep').write_text('old')
        with self.assertRaises(FileExistsError):
            self.upload('/keep', b'new')
        self.assertEqual((self.root / 'keep').read_text(), 'old')
        self.call('startUpload', KEY, path='/new', totalSize=0)
        (self.root / 'new').write_text('racing writer')
        with self.assertRaises(FileExistsError):
            self.call('finishUpload', KEY, checksum=hashlib.sha256(b'').hexdigest())
        self.assertEqual((self.root / 'new').read_text(), 'racing writer')

    def test_cancel_and_expire_remove_only_partial_file(self):
        self.call('startUpload', KEY, path='/new', totalSize=1)
        self.call('cancel', KEY)
        self.assertFalse((self.root / 'new').exists())
        self.assertFalse(list(self.root.glob('*.part')))
        self.call('startUpload', KEY, path='/new', totalSize=1)
        self.w.transfers[KEY]['time'] = time.monotonic()-121
        self.w.expire()
        self.assertEqual(self.w.transfers, {})

    def test_bad_chunks_and_checksum_never_publish(self):
        for args in (dict(chunkIndex=1, data='YQ=='), dict(chunkIndex=0, data='!!!'), dict(chunkIndex=0, data='YWI=')):
            self.call('startUpload', KEY, path='/new', totalSize=1)
            with self.assertRaises((ValueError, Exception)):
                self.call('uploadChunk', KEY, **args)
            self.assertFalse((self.root / 'new').exists())
            self.assertEqual(self.w.transfers, {})
        self.call('startUpload', KEY, path='/new', totalSize=0)
        with self.assertRaises(ValueError):
            self.call('finishUpload', KEY, checksum='0'*64)
        self.assertFalse((self.root / 'new').exists())

    def test_partial_write_and_disk_full(self):
        original = os.write
        with mock.patch.object(module.os, 'write', side_effect=lambda fd, data: original(fd, data[:1])):
            self.upload('/partial', b'abc')
        self.assertEqual((self.root / 'partial').read_bytes(), b'abc')
        self.call('startUpload', KEY, path='/full', totalSize=1)
        with mock.patch.object(module.os, 'write', side_effect=OSError('No space left')), self.assertRaises(OSError):
            self.call('uploadChunk', KEY, chunkIndex=0, data='YQ==')
        self.assertFalse((self.root / 'full').exists())
        self.assertEqual(self.w.transfers, {})

    def test_conflicting_paths_and_extension_rename(self):
        self.call('createDir', path='/folder')
        self.call('startUpload', KEY, path='/folder/new', totalSize=0)
        for action in ('delete', 'rename'):
            with self.assertRaises(ValueError):
                self.call(action, path='/folder', srcPath='/folder', dstPath='/moved')
        self.call('cancel', KEY)
        self.upload('/safe', b'')
        with self.assertRaises(ValueError):
            self.call('rename', srcPath='/safe', dstPath='/blocked.exe')

    def test_changed_download_fails_integrity_check(self):
        self.upload('/file', b'abc')
        self.call('startDownload', KEY, path='/file')
        self.call('requestChunk', KEY, chunkIndex=0)
        (self.root / 'file').write_bytes(b'xyz')
        with self.assertRaises(ValueError):
            self.call('finishDownload', KEY, checksum=hashlib.sha256(b'abc').hexdigest())

    def test_parent_symlink_swap_after_open_does_not_redirect_write(self):
        folder = self.root / 'folder'; folder.mkdir()
        original = self.w.parent
        def swap(path):
            fd, name = original(path)
            folder.rename(self.root / 'moved')
            folder.symlink_to(self.outside, target_is_directory=True)
            return fd, name
        with mock.patch.object(self.w, 'parent', side_effect=swap):
            self.call('createDir', path='/folder/new')
        self.assertTrue((self.root / 'moved/new').is_dir())
        self.assertFalse((self.outside / 'new').exists())

    def test_duplicate_chunk_aborts_without_publishing(self):
        self.call('startUpload', KEY, path='/new', totalSize=65537)
        data = base64.b64encode(b'x'*65536).decode()
        self.call('uploadChunk', KEY, chunkIndex=0, data=data)
        with self.assertRaises(ValueError):
            self.call('uploadChunk', KEY, chunkIndex=0, data=data)
        self.assertFalse((self.root / 'new').exists())
        self.assertEqual(self.w.transfers, {})

    def test_directory_sync_error_reports_committed_file(self):
        self.call('startUpload', KEY, path='/new', totalSize=0)
        sync = os.fsync
        def fail_directory(fd):
            if fd == self.w.transfers[KEY]['parent']:
                raise OSError('directory sync failed')
            return sync(fd)
        with mock.patch.object(module.os, 'fsync', side_effect=fail_directory):
            with self.assertRaisesRegex(RuntimeError, 'File was published'):
                self.call('finishUpload', KEY, checksum=hashlib.sha256(b'').hexdigest())
        self.assertTrue((self.root / 'new').is_file())
        self.assertEqual(self.w.transfers, {})

    def test_only_one_worker_and_no_leaked_fds(self):
        before = len(os.listdir('/proc/self/fd'))
        with self.assertRaises(BlockingIOError):
            module.Worker(str(self.root))
        for i in range(10):
            self.call('startUpload', KEY, path='/new', totalSize=0)
            self.call('cancel', KEY)
        self.assertEqual(len(os.listdir('/proc/self/fd')), before)

if __name__ == '__main__':
    unittest.main()
