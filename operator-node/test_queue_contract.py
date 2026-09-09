import unittest

import queue_contract


class QueueContractTests(unittest.TestCase):
    def test_health_is_fixed_allowlisted_command(self):
        item = queue_contract.build("operator.health")
        self.assertEqual(item["schema"], "ci.operator.command/v1")
        self.assertEqual(item["target"], "orange")
        self.assertEqual(item["argv"][:2], ["curl", "-fsS"])

    def test_unknown_action_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsupported_action"):
            queue_contract.build("shell.exec", {"cmd": "id"})

    def test_update_requires_exact_commit(self):
        with self.assertRaisesRegex(ValueError, "invalid_commit"):
            queue_contract.build("operator.self_update", {"commit": "main", "activate": True})
        item = queue_contract.build("operator.self_update", {"commit": "a" * 40, "activate": False})
        self.assertIn("operator_update", item["legacyShell"])

    def test_release_is_pinned_and_uses_release_manager_surface(self):
        item = queue_contract.build("operator.release", {"commit": "b" * 40, "activate": True})
        self.assertEqual(item["risk"], "elevated_write")
        self.assertIn("operator_release", item["legacyShell"])
        self.assertIn("b" * 40, item["legacyShell"])
        with self.assertRaisesRegex(ValueError, "invalid_commit"):
            queue_contract.build("operator.release", {"commit": "main", "activate": True})

    def test_update_rejects_string_boolean(self):
        with self.assertRaisesRegex(ValueError, "activate_must_be_boolean"):
            queue_contract.build("operator.self_update", {"commit": "a" * 40, "activate": "false"})

    def test_metrics_limit_is_bounded(self):
        with self.assertRaisesRegex(ValueError, "limit_out_of_range"):
            queue_contract.build("operator.metrics", {"limit": 5001})
        with self.assertRaisesRegex(ValueError, "limit_must_be_integer"):
            queue_contract.build("operator.metrics", {"limit": True})
        item = queue_contract.build("operator.metrics", {"limit": 250})
        self.assertIn("metrics(250)", item["legacyShell"])

    def test_request_id_must_be_uuid(self):
        with self.assertRaisesRegex(ValueError, "invalid_request_id"):
            queue_contract.build("operator.health", request_id="../../bad")


if __name__ == "__main__":
    unittest.main()
