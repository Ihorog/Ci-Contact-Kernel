#!/usr/bin/env python3
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import technical_model


def _git(args, cwd):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True)


class TechnicalModelIngestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='ci-h9-ingest-'))
        self.vault = self.tmp / 'vault'
        self.model = self.tmp / 'model'
        self.staging = self.vault / 'ci' / 'staging' / 'technical-model'
        self.staging.mkdir(parents=True)
        self.model.mkdir(parents=True)
        _git(['git', 'init', '-b', 'main'], self.model)
        _git(['git', 'config', 'user.name', 'test'], self.model)
        _git(['git', 'config', 'user.email', 't@localhost'], self.model)
        (self.model / 'README').write_text('base\n', encoding='utf-8')
        _git(['git', 'add', 'README'], self.model)
        _git(['git', 'commit', '-m', 'base'], self.model)
        self.base = subprocess.run(
            ['git', 'rev-parse', 'HEAD'], cwd=self.model, capture_output=True, text=True, check=True,
        ).stdout.strip()

        # Source repo with a new commit to bundle
        self.src = self.tmp / 'src'
        shutil.copytree(self.model, self.src)
        (self.src / 'operator-node').mkdir()
        (self.src / 'operator-node' / 'marker.py').write_text('X=1\n', encoding='utf-8')
        _git(['git', 'add', 'operator-node/marker.py'], self.src)
        _git(['git', 'commit', '-m', 'add marker'], self.src)
        self.new = subprocess.run(
            ['git', 'rev-parse', 'HEAD'], cwd=self.src, capture_output=True, text=True, check=True,
        ).stdout.strip()
        self.bundle = self.staging / 'release.bundle'
        _git(['git', 'bundle', 'create', str(self.bundle), 'HEAD'], self.src)
        self.digest = hashlib.sha256(self.bundle.read_bytes()).hexdigest()

        self.patches = [
            mock.patch.object(technical_model, 'ROOT', self.model),
            mock.patch.object(technical_model, 'VAULT_ROOT', self.vault),
            mock.patch.object(technical_model, 'CIT', self.tmp / 'cit'),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rejects_bad_prefix(self):
        value = technical_model.ingest_from_vault('ci/other/x.bundle', self.digest, confirm=False)
        self.assertFalse(value['ok'])
        self.assertEqual(value['error'], 'ingest_path_not_allowlisted')

    def test_rejects_sha_mismatch(self):
        value = technical_model.ingest_from_vault(
            'ci/staging/technical-model/release.bundle', '0' * 64, confirm=False,
        )
        self.assertFalse(value['ok'])
        self.assertEqual(value['error'], 'sha256_mismatch')

    def test_dry_run_does_not_fetch(self):
        value = technical_model.ingest_from_vault(
            'ci/staging/technical-model/release.bundle', self.digest, confirm=False,
            expected_commit=self.new,
        )
        self.assertTrue(value['ok'])
        self.assertFalse(value['executed'])
        self.assertTrue(value.get('confirmRequired'))
        probe = subprocess.run(
            ['git', 'cat-file', '-t', self.new], cwd=self.model, capture_output=True, text=True,
        )
        self.assertNotEqual(probe.returncode, 0)

    def test_confirm_ingests_commit_objects(self):
        value = technical_model.ingest_from_vault(
            'ci/staging/technical-model/release.bundle', self.digest, confirm=True,
            expected_commit=self.new,
        )
        self.assertTrue(value['ok'], value)
        self.assertTrue(value['executed'])
        self.assertEqual(value.get('ingestedCommit'), self.new)
        data, _ = technical_model.read_blob(self.new, 'operator-node/marker.py')
        self.assertEqual(data, b'X=1\n')


class SourceStatusHonestyTests(unittest.TestCase):
    def test_local_source_disables_fallback_flag(self):
        import self_update
        with mock.patch.object(self_update, 'SOURCE', 'local'):
            with mock.patch.object(self_update.technical_model, 'status', return_value={'ok': True}):
                status = self_update.source_status()
        self.assertFalse(status['githubRequired'])
        self.assertFalse(status['githubFallbackAvailable'])
        self.assertFalse(status['githubFallbackAutomatic'])
        self.assertEqual(status['updateAuthority'], 'local_technical_model')


if __name__ == '__main__':
    unittest.main()
