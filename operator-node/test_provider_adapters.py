#!/usr/bin/env python3
import os
import unittest
from unittest.mock import patch

import provider_adapters as adapters


class ProviderAdapterTests(unittest.TestCase):
    def test_unknown_adapter_is_closed(self):
        value = adapters.probe('CI.UNKNOWN')
        self.assertEqual(value['state'], 'NO_ADAPTER')
        self.assertFalse(value['directRead'])

    @patch('provider_adapters.shutil.which', return_value=None)
    def test_missing_cli_is_not_ready(self, _which):
        value = adapters.probe('CI.GITHUB')
        self.assertEqual(value['state'], 'MISSING_CLI')
        self.assertFalse(value['directRead'])

    @patch('provider_adapters._present_path', return_value=False)
    @patch('provider_adapters.shutil.which', return_value='/usr/bin/gh')
    def test_cli_without_auth_signal_is_not_ready(self, _which, _path):
        with patch.dict(os.environ, {}, clear=True):
            value = adapters.probe('CI.GITHUB')
        self.assertEqual(value['state'], 'AUTH_NOT_DETECTED')
        self.assertFalse(value['directRead'])

    @patch('provider_adapters._present_path', return_value=False)
    @patch('provider_adapters.shutil.which', return_value='/usr/bin/gh')
    def test_auth_env_only_exposes_name_not_value(self, _which, _path):
        with patch.dict(os.environ, {'GH_TOKEN': 'secret-value'}, clear=True):
            value = adapters.probe('CI.GITHUB')
        self.assertEqual(value['state'], 'CANDIDATE_READY')
        self.assertTrue(value['directRead'])
        self.assertEqual(value['credentialEnvNames'], ['GH_TOKEN'])
        self.assertNotIn('secret-value', str(value))

    def test_write_operation_is_not_in_catalog(self):
        value = adapters.execute_read('CI.GITHUB', 'write')
        self.assertFalse(value['ok'])
        self.assertEqual(value['error'], 'unsupported_read_operation')


if __name__ == '__main__':
    unittest.main()
