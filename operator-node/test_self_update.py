#!/usr/bin/env python3
import unittest

import self_update


class SelfUpdateTests(unittest.TestCase):
    def test_rejects_non_exact_commit(self):
        value = self_update.prepare('main')
        self.assertFalse(value['ok'])
        self.assertEqual(value['error'], 'exact_40_hex_commit_required')

    def test_rejects_short_sha(self):
        value = self_update.prepare('a' * 12)
        self.assertFalse(value['ok'])

    def test_runtime_allowlist_is_narrow(self):
        self.assertEqual(
            self_update.ALLOWED,
            ['ci_operator.py', 'provider_adapters.py', 'ci_operator_runtime.py'],
        )
        self.assertNotIn('ci_connector_server.py', self_update.ALLOWED)

    def test_git_blob_sha_is_deterministic(self):
        self.assertEqual(
            self_update._git_blob_sha(b'test\n'),
            '9daeafb9864cf43055ae93beb0afd6c7d144bfa4',
        )


if __name__ == '__main__':
    unittest.main()
