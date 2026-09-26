import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import hashlib
import json

import release_manager



def acceptance_bundle():
    snapshot = {
        "kind": "CI_REGISTRY_ACCEPTANCE_SNAPSHOT",
        "version": "1.3",
        "generated_at": "2026-09-26T22:41:53.863Z",
        "coordinates": [],
    }
    snapshot_bytes = (json.dumps(snapshot, separators=(",", ":")) + "\n").encode("utf-8")
    digest = hashlib.sha256(snapshot_bytes).hexdigest()
    pointer = {
        "kind": "CI_REGISTRY_ACCEPTANCE_POINTER",
        "registry_version": "1.1.0",
        "current": "20260926T224153Z.json",
        "sha256": digest,
    }
    pointer_bytes = (json.dumps(pointer, separators=(",", ":")) + "\n").encode("utf-8")
    return {
        "pointer_content": pointer_bytes,
        "pointer_blob": "p" * 40,
        "pointer": pointer,
        "snapshot_content": snapshot_bytes,
        "snapshot_blob": "s" * 40,
        "snapshot_name": pointer["current"],
        "snapshot_sha256": digest,
    }


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
                 patch.object(release_manager, '_fetch_repo_file', return_value=(b'{"kind":"CI_CONNECTION_REGISTRY_RUNTIME"}', 'c' * 40)), \
                 patch.object(release_manager, '_fetch_acceptance_bundle', return_value=acceptance_bundle()), \
                 patch.object(release_manager, 'ACCEPTANCE_TARGET_DIR', root / 'acceptance'), \
                 patch.object(release_manager.updater, 'apply', return_value={
                     'ok': True, 'executed': True, 'backup': str(runtime_backup), 'files': []
                 }), \
                 patch.object(release_manager.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='', stderr='boom')):
                result = release_manager.deploy('a' * 40, False)
            self.assertFalse(result['ok'])
            self.assertTrue(result['rollback']['connectorRestored'])
            self.assertEqual(connector.read_text(encoding='utf-8'), 'VALUE = 1\n')

    def test_success_syncs_registry_with_release(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            target = root / 'operator'
            target.mkdir()
            connector = root / 'connector.py'
            connector.write_text('VALUE = 1\n', encoding='utf-8')
            registry = root / 'ci-registry.json'
            registry.write_text('{"kind":"OLD"}', encoding='utf-8')
            runtime_backup = root / 'runtime-backup'
            runtime_backup.mkdir()
            installer = b"print('installer')\n"
            registry_bytes = b'{"kind":"CI_CONNECTION_REGISTRY_RUNTIME","version":"1.1.0"}'
            with patch.object(release_manager, 'CONNECTOR', connector), \
                 patch.object(release_manager, 'REGISTRY_TARGET', registry), \
                 patch.object(release_manager.updater, 'TARGET', target), \
                 patch.object(release_manager.updater, '_fetch_file', return_value=(installer, 'b' * 40)), \
                 patch.object(release_manager, '_fetch_repo_file', return_value=(registry_bytes, 'c' * 40)), \
                 patch.object(release_manager, '_fetch_acceptance_bundle', return_value=acceptance_bundle()), \
                 patch.object(release_manager, 'ACCEPTANCE_TARGET_DIR', root / 'acceptance'), \
                 patch.object(release_manager.updater, 'apply', return_value={
                     'ok': True, 'executed': True, 'backup': str(runtime_backup), 'files': []
                 }), \
                 patch.object(release_manager.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='ok', stderr='')):
                result = release_manager.deploy('a' * 40, False)
            self.assertTrue(result['ok'])
            self.assertTrue(result['evidence']['registrySynced'])
            self.assertTrue(result['evidence']['acceptanceSynced'])
            self.assertTrue(result['evidence']['acceptanceSnapshotSha256Verified'])
            self.assertEqual(registry.read_bytes(), registry_bytes)
            self.assertTrue((root / 'acceptance' / 'current.json').exists())
            self.assertTrue((root / 'acceptance' / '20260926T224153Z.json').exists())
            self.assertEqual(result['registry']['gitBlobSha'], 'c' * 40)


if __name__ == '__main__':
    unittest.main()
