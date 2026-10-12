"""Tests for Ci authorization moment and device-approval intent."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ci_auth_moment as auth


class AuthMomentTests(unittest.TestCase):
    def payload(self, **changes):
        base = dict(
            task_id="CI-20261013-100", principal="owner:HOME.CI",
            domain="HOME.CI", target="CI.OPERATOR.ORANGE",
            operation="acceptance.refresh", purpose="Оновити доказ актуальності Ci",
            effect="local_change", requested_scope="ci:act", policy_ref="HOME.CI/1.0",
            issued_at=1000, expires_at=1120, client_id="chatgpt-ci",
            resource="https://mcp-http.cimeika.com.ua", terms_sha256="a"*64,
        )
        base.update(changes)
        return base

    def test_canonical_digest_is_stable(self):
        first = auth.create_moment(**self.payload())
        self.assertEqual(auth.moment_digest(first), auth.moment_digest(dict(reversed(list(first.items())))))
        self.assertEqual(first["rp_id"], "mcp-http.cimeika.com.ua")
        self.assertEqual(first["user_verification"], "required")
        self.assertEqual(auth.acceptance_summary(first)["document_signature"], False)

    def test_purpose_target_and_terms_are_immutably_bound(self):
        basic = auth.create_moment(**self.payload())
        for modified in [
            dict(purpose="Доступ до платіжного акаунта"),
            dict(target="CI.VAULT"),
            dict(operation="vault.delete"),
            dict(terms_sha256="b"*64),
            dict(client_id="another-client"),
            dict(expires_at=1170),
        ]:
            with self.subTest(modified=modified):
                self.assertNotEqual(auth.moment_digest(basic), auth.moment_digest(auth.create_moment(**self.payload(**modified))))

    def test_expiry_rejects_unbounded_authority(self):
        for duration in [-1, 0, 301, 10000]:
            with self.subTest(duration=duration):
                with self.assertRaises(auth.ContractError):
                    auth.create_moment(**self.payload(expires_at=1000+duration))

    def test_local_authority_cannot_become_external(self):
        with self.assertRaisesRegex(auth.ContractError, "home_external_authority_forbidden"):
            auth.create_moment(**self.payload(effect="external_change"))
        with self.assertRaisesRegex(auth.ContractError, "scope_insufficient"):
            auth.create_moment(**self.payload(requested_scope="ci:read"))

    def test_passkey_cannot_claim_qualified_signature(self):
        with self.assertRaisesRegex(auth.ContractError, "qualified_signature_requires_separate_provider"):
            auth.create_moment(**self.payload(effect="document_signature"))

    def test_binding_rejects_other_origin_and_invalid_terms(self):
        with self.assertRaisesRegex(auth.ContractError, "wrong_resource"):
            auth.create_moment(**self.payload(resource="https://bank.example"))
        with self.assertRaisesRegex(auth.ContractError, "invalid_terms_hash"):
            auth.create_moment(**self.payload(terms_sha256="abc"))

    def test_hash_is_not_a_verification_credential(self):
        summary = auth.acceptance_summary(auth.create_moment(**self.payload()))
        self.assertEqual(summary["proof_status"], "AWAITING_VERIFIED_WEBAUTHN_ASSERTION")
        self.assertNotIn("access_token", summary)
        self.assertNotIn("biometric_data", summary)
        self.assertNotIn("private_key", summary)


if __name__ == "__main__":
    unittest.main()
