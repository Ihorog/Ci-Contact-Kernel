#!/usr/bin/env python3
import importlib
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["CI_REGISTRY_PATH"] = str(ROOT / "public" / "ci-registry" / "v1.1.0" / "ci-registry.json")
os.environ["CI_ACCEPTANCE_PATH"] = str(ROOT / "public" / "ci-registry" / "v1.1.0" / "acceptance" / "current.json")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_operator
importlib.reload(ci_operator)


class DelegationContractTest(unittest.TestCase):
    def test_github_resolves_to_connector_delegation(self):
        result = ci_operator.resolve("перевір репозиторій GitHub")
        self.assertEqual(result["coordinate"], "CI.GITHUB")
        self.assertEqual(result["execution"], "DELEGATE_CONNECTOR")
        self.assertEqual(result["connectorHint"], "GitHub")
        self.assertEqual(result["delegation"]["kind"], "chatgpt_connector")
        self.assertEqual(result["delegation"]["executor"], "GitHub")
        self.assertTrue(result["delegation"]["requiresLiveCheck"])
        self.assertTrue(result["delegation"]["requiresEvidence"])

    def test_external_dispatch_does_not_claim_cilink_execution(self):
        result = ci_operator.dispatch("перевір репозиторій GitHub")
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "delegate")
        self.assertFalse(result["executed"])
        self.assertEqual(result["executor"], "CALLER_RUNTIME")
        self.assertEqual(result["delegation"]["executor"], "GitHub")
        self.assertNotIn("upstream", result)

    def test_native_route_is_machine_readable(self):
        result = ci_operator.resolve("пошук в інтернеті")
        self.assertEqual(result["coordinate"], "CI.WEB")
        self.assertEqual(result["delegation"]["kind"], "native_tool")
        self.assertEqual(result["delegation"]["executor"], "web")


if __name__ == "__main__":
    unittest.main()
