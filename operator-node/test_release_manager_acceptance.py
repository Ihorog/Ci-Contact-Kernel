#!/usr/bin/env python3
import hashlib
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_manager


class AcceptanceBundleTests(unittest.TestCase):
    def _fixture(self, current="20260926T224153Z.json", mutate_hash=False):
        snapshot = {
            "kind": "CI_REGISTRY_ACCEPTANCE_SNAPSHOT",
            "version": "1.3",
            "generated_at": "2026-09-26T22:41:53.863Z",
            "coordinates": [],
        }
        snapshot_bytes = (json.dumps(snapshot, separators=(",", ":")) + "\n").encode("utf-8")
        digest = hashlib.sha256(snapshot_bytes).hexdigest()
        if mutate_hash:
            digest = "0" * 64
        pointer = {
            "kind": "CI_REGISTRY_ACCEPTANCE_POINTER",
            "registry_version": "1.1.0",
            "current": current,
            "sha256": digest,
        }
        pointer_bytes = (json.dumps(pointer, separators=(",", ":")) + "\n").encode("utf-8")
        return pointer_bytes, snapshot_bytes

    def test_valid_bundle_is_verified(self):
        pointer_bytes, snapshot_bytes = self._fixture()

        def fake_fetch(path, commit):
            if path.endswith("/current.json"):
                return pointer_bytes, "pointer-blob"
            if path.endswith("/20260926T224153Z.json"):
                return snapshot_bytes, "snapshot-blob"
            raise AssertionError(path)

        with patch.object(release_manager, "_fetch_repo_file", side_effect=fake_fetch):
            result = release_manager._fetch_acceptance_bundle("a" * 40)

        self.assertEqual(result["snapshot_name"], "20260926T224153Z.json")
        self.assertEqual(result["snapshot_sha256"], hashlib.sha256(snapshot_bytes).hexdigest())
        self.assertEqual(result["pointer_blob"], "pointer-blob")
        self.assertEqual(result["snapshot_blob"], "snapshot-blob")

    def test_sha_mismatch_fails_closed(self):
        pointer_bytes, snapshot_bytes = self._fixture(mutate_hash=True)

        def fake_fetch(path, commit):
            if path.endswith("/current.json"):
                return pointer_bytes, "pointer-blob"
            return snapshot_bytes, "snapshot-blob"

        with patch.object(release_manager, "_fetch_repo_file", side_effect=fake_fetch):
            with self.assertRaisesRegex(RuntimeError, "acceptance_snapshot_sha256_mismatch"):
                release_manager._fetch_acceptance_bundle("b" * 40)

    def test_pointer_path_traversal_is_rejected(self):
        pointer_bytes, snapshot_bytes = self._fixture(current="../secret.json")

        def fake_fetch(path, commit):
            if path.endswith("/current.json"):
                return pointer_bytes, "pointer-blob"
            return snapshot_bytes, "snapshot-blob"

        with patch.object(release_manager, "_fetch_repo_file", side_effect=fake_fetch):
            with self.assertRaisesRegex(RuntimeError, "acceptance_pointer_target_invalid"):
                release_manager._fetch_acceptance_bundle("c" * 40)


if __name__ == "__main__":
    unittest.main()
