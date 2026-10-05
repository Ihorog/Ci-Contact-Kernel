#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import home_repair


class HomeRepairTests(unittest.TestCase):
    def test_unsupported_action_is_fail_closed(self):
        result = home_repair.execute("shell.exec", "abcdefgh")
        self.assertFalse(result["ok"])
        self.assertFalse(result["executed"])
        self.assertEqual(result["error"], "unsupported_home_repair_action")

    def test_network_ensure_end0_uses_fixed_ip_command(self):
        with tempfile.TemporaryDirectory() as td,              patch.object(home_repair, "STATE", Path(td)),              patch.object(home_repair, "network_status", side_effect=[
                 {"ok": True, "exists": True, "adminUp": False, "linkUp": False},
                 {"ok": True, "exists": True, "adminUp": True, "linkUp": True},
             ]),              patch.object(home_repair, "_run", return_value={"rc": 0, "stdout": "", "stderr": ""}) as runner:
            result = home_repair.ensure_end0("network-test-001")
        self.assertTrue(result["ok"])
        self.assertTrue(result["verified"])
        runner.assert_called_once_with(["sudo", "-n", "ip", "link", "set", "dev", home_repair.END0, "up"])

    def test_vault_ensure_rw_uses_mount_target_only(self):
        before = {"ok": False, "readable": False, "writable": False}
        after = {"ok": True, "readable": True, "writable": True}
        with tempfile.TemporaryDirectory() as td,              patch.object(home_repair, "STATE", Path(td)),              patch.object(home_repair.vault_node, "status", side_effect=[before, after]),              patch.object(home_repair, "_probe_vault_write", side_effect=[
                 {"ok": True, "evidence": "probe"},
             ]),              patch.object(home_repair, "_run", side_effect=[
                 {"rc": 1, "stdout": "", "stderr": ""},
                 {"rc": 0, "stdout": "", "stderr": ""},
             ]) as runner:
            result = home_repair.ensure_vault_rw("vault-test-001")
        self.assertTrue(result["ok"])
        self.assertEqual(runner.call_args_list[1].args[0], ["sudo", "-n", "mount", str(home_repair.VAULT_ROOT)])

    def test_acceptance_refresh_updates_only_live_home_coordinates(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            acceptance_dir = root / "acceptance"
            acceptance_dir.mkdir()
            snapshot_path = acceptance_dir / "old.json"
            snapshot = {
                "kind": "CI_REGISTRY_ACCEPTANCE_SNAPSHOT",
                "version": "1.3",
                "generated_at": "2026-01-01T00:00:00Z",
                "provenance": {},
                "coordinates": [
                    {"id": "CI.ORANGE", "state": "VERIFIED"},
                    {"id": "CI.HOME", "state": "VERIFIED"},
                    {"id": "CI.GITHUB", "state": "VERIFIED", "last_verified": "2026-01-01T00:00:00Z"},
                ],
            }
            snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")
            pointer = {
                "kind": "CI_REGISTRY_ACCEPTANCE_POINTER",
                "current": snapshot_path.name,
                "sha256": "old",
            }
            current = acceptance_dir / "current.json"
            current.write_text(json.dumps(pointer), encoding="utf-8")

            with patch.object(home_repair, "STATE", root / "state"),                  patch.object(home_repair, "ACCEPTANCE", current),                  patch.object(home_repair, "network_status", return_value={"ok": True, "linkUp": True}),                  patch.object(home_repair.vault_node, "status", return_value={"ok": True, "root": str(home_repair.VAULT_ROOT), "readable": True, "writable": True, "writeProbe": {"ok": True, "evidence": "create_fsync_delete_probe"}}):
                result = home_repair.refresh_acceptance("acceptance-test-001")

            self.assertTrue(result["ok"])
            new_pointer = json.loads(current.read_text(encoding="utf-8"))
            refreshed = json.loads((acceptance_dir / new_pointer["current"]).read_text(encoding="utf-8"))
            rows = {row["id"]: row for row in refreshed["coordinates"]}
            self.assertIn("last_verified", rows["CI.ORANGE"])
            self.assertIn("last_verified", rows["CI.HOME"])
            self.assertIn("last_verified", rows["CI.VAULT"])
            self.assertEqual(rows["CI.VAULT"]["state"], "VERIFIED")
            self.assertEqual(rows["CI.VAULT"]["authority"]["kind"], "owner")
            self.assertEqual(rows["CI.HOME"]["authority"]["scope"], "HOME.CI")
            self.assertIn("create_fsync_delete_probe", rows["CI.VAULT"]["provenance"]["checks"])
            self.assertEqual(rows["CI.GITHUB"]["last_verified"], "2026-01-01T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
