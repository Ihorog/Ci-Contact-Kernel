import json
import unittest
from pathlib import Path


class ChatGPTActionSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).with_name('chatgpt-action-openapi.json')
        cls.schema = json.loads(path.read_text(encoding='utf-8'))

    def test_openapi_and_server_are_pinned(self):
        self.assertEqual(self.schema['openapi'], '3.1.0')
        self.assertEqual(self.schema['servers'], [{'url': 'https://ci-link.vercel.app'}])

    def test_only_ci_link_path_is_exposed(self):
        self.assertEqual(set(self.schema['paths']), {'/ci'})
        self.assertEqual(self.schema['paths']['/ci']['get']['operationId'], 'getCiLinkStatus')
        self.assertEqual(self.schema['paths']['/ci']['post']['operationId'], 'contactOrSyncCi')

    def test_source_and_modes_are_fail_closed(self):
        props = self.schema['paths']['/ci']['post']['requestBody']['content']['application/json']['schema']['properties']
        self.assertEqual(props['source']['enum'], ['chatgpt-ci'])
        self.assertEqual(set(props['mode']['enum']), {'contact', 'sync'})

    def test_secret_shaped_fields_are_not_in_request_schema(self):
        body = json.dumps(self.schema['paths']['/ci']['post']['requestBody']).lower()
        for forbidden in ['api_key', 'apikey', 'password', 'cookie', 'authorization', 'private_key', 'bearer']:
            self.assertNotIn('"' + forbidden + '"', body)


if __name__ == '__main__':
    unittest.main()
