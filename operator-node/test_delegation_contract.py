#!/usr/bin/env python3
import importlib
import os
import sys
import unittest
from unittest.mock import patch
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

    def test_known_github_read_is_automatic_external_delegation(self):
        result = ci_operator.delegate("перевір GitHub", "read_repo", "CI.GITHUB")
        self.assertTrue(result["ok"])
        self.assertTrue(result["automatic"])
        self.assertFalse(result["permissionRequired"])
        self.assertFalse(result["searchRequired"])
        self.assertEqual(result["delegation"]["executor"], "GitHub")
        self.assertFalse(result["client"]["executesOperation"])

    def test_github_write_keeps_executor_but_requires_permission(self):
        result = ci_operator.delegate("оновити GitHub", "repo_write_when_authorized", "CI.GITHUB")
        self.assertTrue(result["ok"])
        self.assertFalse(result["automatic"])
        self.assertTrue(result["permissionRequired"])
        self.assertFalse(result["searchRequired"])
        self.assertEqual(result["delegation"]["executor"], "GitHub")

    def test_orange_status_executes_outside_client_device(self):
        result = ci_operator.delegate("стан Orange", "status", "CI.ORANGE")
        self.assertTrue(result["automatic"])
        self.assertEqual(result["delegation"]["executor"], "CI.OPERATOR.ORANGE")
        self.assertEqual(result["delegation"]["executionPlane"], "external_node")
        self.assertFalse(result["delegation"]["clientExecution"])

    def test_stale_snapshot_keeps_bound_executor_and_requires_live_check(self):
        stale = {"status": "STALE", "generatedAt": "2000-01-01T00:00:00Z", "ageSeconds": 1, "maxAgeSeconds": 1}
        with patch.object(ci_operator, '_snapshot_freshness', return_value=stale):
            result = ci_operator.delegate("перевір GitHub", "read_repo", "CI.GITHUB")
        self.assertTrue(result["automatic"])
        self.assertFalse(result["permissionRequired"])
        self.assertTrue(result["freshnessCheckRequired"])
        self.assertFalse(result["searchRequired"])
        self.assertEqual(result["delegation"]["executor"], "GitHub")
        self.assertEqual(result["nextAction"], "VERIFY_BOUND_NODE_THEN_EXECUTE")
        self.assertEqual(result["resolution"]["effectiveState"], "VERIFY_REQUIRED")
        self.assertFalse(result["resolution"]["evidenceCurrent"])


if __name__ == "__main__":
    unittest.main()
