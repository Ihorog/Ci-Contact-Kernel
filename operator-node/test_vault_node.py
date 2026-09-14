import base64
import tempfile
import unittest
from pathlib import Path

import vault_node


class VaultNodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_root = vault_node.ROOT
        vault_node.ROOT = Path(self.tmp.name)

    def tearDown(self):
        vault_node.ROOT = self.old_root
        self.tmp.cleanup()

    def test_status_and_structure(self):
        status = vault_node.status()
        self.assertTrue(status['ok'])
        self.assertTrue(status['writable'])
        made = vault_node.execute('mkdir', path='docs')
        self.assertTrue(made['ok'])
        listing = vault_node.execute('list', path='')
        self.assertEqual(listing['items'][0]['name'], 'docs')

    def test_chunked_upload_download_move_rename_delete(self):
        vault_node.execute('mkdir', path='docs')
        a = b'hello '
        b = b'vault'
        first = vault_node.execute('upload', path='docs/a.bin', contentBase64=base64.b64encode(a).decode(), offset=0, truncate=True)
        self.assertTrue(first['ok'])
        second = vault_node.execute('upload', path='docs/a.bin', contentBase64=base64.b64encode(b).decode(), offset=len(a))
        self.assertEqual(second['totalBytes'], len(a + b))
        out = vault_node.execute('download', path='docs/a.bin', offset=0, limit=64)
        self.assertEqual(base64.b64decode(out['contentBase64']), a + b)
        self.assertTrue(out['eof'])

        renamed = vault_node.execute('rename', path='docs/a.bin', name='b.bin')
        self.assertTrue(renamed['ok'])
        moved = vault_node.execute('move', path='docs/b.bin', destination='archive/b.bin')
        self.assertTrue(moved['ok'])
        denied = vault_node.execute('delete', path='archive/b.bin')
        self.assertEqual(denied['error'], 'delete_requires_confirmation')
        deleted = vault_node.execute('delete', path='archive/b.bin', confirmDelete=True)
        self.assertTrue(deleted['ok'])

    def test_path_escape_is_denied(self):
        result = vault_node.execute('stat', path='../outside')
        self.assertFalse(result['ok'])
        self.assertIn('path_traversal_denied', result['error'])


if __name__ == '__main__':
    unittest.main()
