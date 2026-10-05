#!/usr/bin/env python3
import importlib
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["CI_REGISTRY_PATH"] = str(ROOT / "public" / "ci-registry" / "v1.1.0" / "ci-registry.json")
os.environ["CI_ACCEPTANCE_PATH"] = str(ROOT / "public" / "ci-registry" / "v1.1.0" / "acceptance" / "current.json")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_operator
importlib.reload(ci_operator)


def trusted_snapshot(coordinate, authority_kind="owner"):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "kind": "CI_REGISTRY_ACCEPTANCE_SNAPSHOT",
        "generated_at": now,
        "coordinates": [{
            "id": coordinate,
            "state": "VERIFIED",
            "evidence": "test-evidence",
            "provenance": {"source": "unit-test"},
            "authority": {"kind": authority_kind, "principal": "test-principal"},
            "last_verified": now,
        }],
    }


def unverified_snapshot(coordinate):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "kind": "CI_REGISTRY_ACCEPTANCE_SNAPSHOT",
        "generated_at": now,
        "coordinates": [{
            "id": coordinate,
            "state": "VERIFIED",
            "evidence": "test-evidence",
            "provenance": {"source": "unit-test"},
            "last_verified": now,
        }],
    }


class DelegationContractTest(unittest.TestCase):
    def test_github_trusted_resolves_to_connector_delegation(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.GITHUB")):
            result = ci_operator.resolve("перевір репозиторій GitHub")
        self.assertEqual(result["coordinate"], "CI.GITHUB")
        self.assertEqual(result["execution"], "DELEGATE_CONNECTOR")
        self.assertEqual(result["personalResource"]["verification_status"], "OWNED_VERIFIED")
        self.assertTrue(result["personalResource"]["trusted"])
        self.assertEqual(result["connectorHint"], "GitHub")
        self.assertEqual(result["delegation"]["kind"], "chatgpt_connector")

    def test_unverified_visible_github_is_blocked(self):
        with patch.object(ci_operator, "_acceptance", return_value=unverified_snapshot("CI.GITHUB")):
            result = ci_operator.resolve("перевір репозиторій GitHub")
        self.assertEqual(result["coordinate"], "CI.GITHUB")
        self.assertEqual(result["execution"], "PERSONAL_TRUST_BLOCKED")
        self.assertFalse(result["ok"])
        self.assertIsNone(result["delegation"])
        self.assertIn(result["personalResource"]["verification_status"], {"STALE", "AVAILABLE_UNVERIFIED", "BLOCKED"})

    def test_external_dispatch_does_not_claim_execution_without_verified_resource(self):
        with patch.object(ci_operator, "_acceptance", return_value=unverified_snapshot("CI.GITHUB")):
            result = ci_operator.dispatch("перевір репозиторій GitHub")
        self.assertFalse(result["ok"])
        self.assertFalse(result["executed"])
        self.assertEqual(result["error"], "personal_resource_unverified")

    def test_trusted_external_dispatch_delegates_to_caller_runtime(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.GITHUB")):
            result = ci_operator.dispatch("перевір репозиторій GitHub")
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "delegate")
        self.assertFalse(result["executed"])
        self.assertEqual(result["executor"], "CALLER_RUNTIME")
        self.assertEqual(result["delegation"]["executor"], "GitHub")

    def test_native_route_is_machine_readable_and_not_personal_gated(self):
        result = ci_operator.resolve("пошук в інтернеті")
        self.assertEqual(result["coordinate"], "CI.WEB")
        self.assertEqual(result["delegation"]["kind"], "native_tool")
        self.assertEqual(result["delegation"]["executor"], "web")
        self.assertFalse(result["personalResource"]["personal_resource"])

    def test_known_github_read_is_automatic_only_when_trusted(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.GITHUB")):
            result = ci_operator.delegate("перевір GitHub", "read_repo", "CI.GITHUB")
        self.assertTrue(result["ok"])
        self.assertTrue(result["automatic"])
        self.assertFalse(result["permissionRequired"])
        self.assertEqual(result["delegation"]["executor"], "GitHub")

    def test_github_write_keeps_executor_but_requires_permission_when_trusted(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.GITHUB")):
            result = ci_operator.delegate("оновити GitHub", "repo_write_when_authorized", "CI.GITHUB")
        self.assertTrue(result["ok"])
        self.assertFalse(result["automatic"])
        self.assertTrue(result["permissionRequired"])
        self.assertEqual(result["delegation"]["executor"], "GitHub")

    def test_orange_status_requires_verified_personal_authority(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.ORANGE")):
            result = ci_operator.delegate("стан Orange", "status", "CI.ORANGE")
        self.assertTrue(result["automatic"])
        self.assertEqual(result["delegation"]["executor"], "CI.OPERATOR.ORANGE")

    def test_stale_personal_resource_fails_closed_and_keeps_no_executor(self):
        snapshot = trusted_snapshot("CI.GITHUB")
        snapshot["coordinates"][0]["last_verified"] = "2000-01-01T00:00:00Z"
        with patch.object(ci_operator, "_acceptance", return_value=snapshot):
            result = ci_operator.delegate("перевір GitHub", "read_repo", "CI.GITHUB")
        self.assertFalse(result["ok"])
        self.assertFalse(result["automatic"])
        self.assertIsNone(result["delegation"])
        self.assertEqual(result["nextAction"], "REVERIFY_PERSONAL_RESOURCE")
        self.assertEqual(result["resolution"]["personalResource"]["verification_status"], "STALE")

    def test_operator_status_exposes_only_aggregate_personal_resource_trust(self):
        snapshot = trusted_snapshot("CI.GITHUB")
        with patch.object(ci_operator, "_acceptance", return_value=snapshot):
            result = ci_operator.status()
        summary = result["personalResources"]
        self.assertEqual(summary["contract"], "ci-personal-resource-trust/v1")
        self.assertTrue(summary["serverAuthoritative"])
        self.assertEqual(summary["ownedVerified"], 1)
        self.assertGreaterEqual(summary["trustedResources"], 1)
        self.assertNotIn("resources", summary)
        self.assertNotIn("authority", summary)
        self.assertNotIn("evidence", summary)

    def test_vault_live_state_requires_write_probe(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.VAULT")), \
             patch.object(ci_operator.vault_node, "status", return_value={
                 "ok": True,
                 "readable": True,
                 "writable": False,
                 "writeProbe": {"ok": False, "error": "write_failed"},
             }):
            result = ci_operator.resolve("стан Vault", "CI.VAULT")
        self.assertEqual(result["state"], "VERIFIED_PARTIAL")
        self.assertFalse(result["evidenceCurrent"])
        self.assertEqual(result["execution"], "PERSONAL_TRUST_BLOCKED")
        self.assertFalse(result["personalResource"]["trusted"])
        self.assertEqual(result["personalResource"]["blocker"], "vault_live_rw_probe_failed")

    def test_vault_live_state_is_verified_after_rw_probe(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.VAULT")), \
             patch.object(ci_operator.vault_node, "status", return_value={
                 "ok": True,
                 "readable": True,
                 "writable": True,
                 "writeProbe": {"ok": True, "evidence": "create_fsync_delete_probe"},
             }):
            result = ci_operator.resolve("стан Vault", "CI.VAULT")
        self.assertEqual(result["state"], "VERIFIED")
        self.assertTrue(result["evidenceCurrent"])

    def test_partial_personal_state_is_not_trusted_even_with_owner_authority(self):
        snapshot = trusted_snapshot("CI.HOME")
        snapshot["coordinates"][0]["state"] = "VERIFIED_PARTIAL"
        with patch.object(ci_operator, "_acceptance", return_value=snapshot):
            result = ci_operator.resource_audit("CI.HOME")
        resource = result["resource"]
        self.assertFalse(resource["trusted"])
        self.assertEqual(resource["verification_status"], "AVAILABLE_UNVERIFIED")
        self.assertEqual(resource["blocker"], "resource_not_fully_verified")

    def test_resource_audit_has_required_shape(self):
        with patch.object(ci_operator, "_acceptance", return_value=trusted_snapshot("CI.GITHUB")):
            result = ci_operator.resource_audit("CI.GITHUB")
        resource = result["resource"]
        for key in ("ci_id", "route", "authority", "verification_status", "evidence", "last_verified", "allowed_ops", "blocker"):
            self.assertIn(key, resource)
        self.assertEqual(resource["verification_status"], "OWNED_VERIFIED")


if __name__ == "__main__":
    unittest.main()
