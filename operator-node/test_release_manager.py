import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import release_manager


class ReleaseManagerTests(unittest.TestCase):
    def test_rejects_non_exact_commit(self):
        result = release_manager.deploy('main', False)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'exact_40_hex_commit_required')

    def test_rejects_non_boolean_activation(self):
        result = release_manager.deploy('a' * 40, 'false')
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'activate_must_be_boolean')

    def test_connector_patch_failure_restores_connector(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / 'operator'
            target.mkdir()
            connector = root / 'connector.py'
            connector.write_text('VALUE = 1\n', encoding='utf-8')
            runtime_backup = root / 'runtime-backup'
            runtime_backup.mkdir()
            installer = b"print('installer')\n"
            with patch.object(release_manager, 'CONNECTOR', connector), \
                 patch.object(release_manager.updater, 'TARGET', target), \
                 patch.object(release_manager.updater, 'ALLOWED', ['ci_operator.py']), \
                 patch.object(release_manager.updater, '_fetch_file', return_value=(installer, 'b' * 40)), \
                 patch.object(release_manager.updater, 'apply', return_value={
                     'ok': True, 'executed': True, 'backup': str(runtime_backup), 'files': []
                 }), \
                 patch.object(release_manager.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='', stderr='boom')):
                result = release_manager.deploy('a' * 40, False)
            self.assertFalse(result['ok'])
            self.assertTrue(result['rollback']['connectorRestored'])
            self.assertEqual(connector.read_text(encoding='utf-8'), 'VALUE = 1\n')


if __name__ == '__main__':
    unittest.main()
