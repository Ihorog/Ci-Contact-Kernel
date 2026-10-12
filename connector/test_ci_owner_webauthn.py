"""Owner WebAuthn state-machine tests; crypto itself is supplied by py_webauthn."""
import os
import sys
import tempfile
import time
import pathlib
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ci_owner_webauthn as owner


class FakeLibrary:
    def generate_registration_options(self, **kwargs):
        self.register_kwargs = kwargs
        return {"challenge": owner._b64(kwargs["challenge"])}

    def generate_authentication_options(self, **kwargs):
        self.auth_kwargs = kwargs
        return {"challenge": owner._b64(kwargs["challenge"])}

    def options_to_json(self, result):
        import json
        return json.dumps(result)

    def verify_registration_response(self, **kwargs):
        assert kwargs["expected_rp_id"] == owner.RP_ID
        assert kwargs["expected_origin"] == owner.ORIGIN
        assert kwargs["require_user_verification"] is True
        return types.SimpleNamespace(credential_id=b"credential", credential_public_key=b"pubkey", sign_count=1)

    def verify_authentication_response(self, **kwargs):
        assert kwargs["expected_rp_id"] == owner.RP_ID
        assert kwargs["expected_origin"] == owner.ORIGIN
        assert kwargs["require_user_verification"] is True
        assert kwargs["credential_current_sign_count"] == 1
        return types.SimpleNamespace(new_sign_count=2)


class Criteria:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class Descriptor:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class Values:
    REQUIRED = "required"
    PREFERRED = "preferred"


class PasskeyStateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_state = owner.STATE
        owner.STATE = pathlib.Path(self.tmp.name) / "owner-auth.db"
        self.fake = FakeLibrary()
        self.patch = patch.object(owner, "_lib", return_value=(self.fake, Criteria, Descriptor, Values, Values))
        self.patch.start()
        self.bootstrap = "one-time-local-secret"
        c = owner._db()
        c.execute("INSERT INTO bootstrap VALUES (?,?)",
                  (owner._digest(self.bootstrap), int(time.time()) + 90))
        c.close()

    def tearDown(self):
        self.patch.stop()
        owner.STATE = self.old_state
        self.tmp.cleanup()

    def test_local_cli_requires_owner_tty_and_explicit_flag(self):
        with self.assertRaises(owner.OwnerAuthError):
            owner.issue_local_bootstrap()

    def test_enrollment_is_once_only_and_requires_challenge(self):
        owner.registration_options(self.bootstrap)
        owner.finish_registration(self.bootstrap, {"id": owner._b64(b"credential")})
        c = owner._db()
        self.assertEqual(c.execute("SELECT COUNT(*) FROM credential").fetchone()[0], 1)
        c.close()
        with self.assertRaises(owner.OwnerAuthError):
            owner.finish_registration(self.bootstrap, {"id": "replay"})
        with self.assertRaises(owner.OwnerAuthError):
            owner.registration_options(self.bootstrap)

    def test_oauth_grant_bound_to_ticket_and_one_time(self):
        owner.registration_options(self.bootstrap)
        owner.finish_registration(self.bootstrap, {"id": owner._b64(b"credential")})
        pending = {"client_id": "chatgpt-client", "redirect_uri": "https://chatgpt.com/callback",
                   "scope": "ci:read", "resource": "https://mcp-http.cimeika.com.ua",
                   "challenge": "pkce-challenge", "expires": time.time() + 90}
        owner.authentication_options("ticket1", pending)
        owner.finish_authentication("ticket1", pending, {"id": owner._b64(b"credential")})
        wrong = {**owner._binding("ticket1", pending), "scope": "ci:act"}
        self.assertIsNone(owner.consume_verified_oauth_grant(wrong))
        correct = owner._binding("ticket1", pending)
        grant = owner.consume_verified_oauth_grant(correct)
        self.assertEqual(grant["authority"], "CI.AUTH.GATEWAY")
        self.assertTrue(grant["user_verified"])
        self.assertEqual(grant["verification_method"], "webauthn")
        self.assertIsNone(owner.consume_verified_oauth_grant(correct))
        with self.assertRaises(owner.OwnerAuthError):
            owner.finish_authentication("ticket1", pending, {"id": owner._b64(b"credential")})

    def test_wrong_ticket_cannot_authenticate(self):
        owner.registration_options(self.bootstrap)
        owner.finish_registration(self.bootstrap, {"id": owner._b64(b"credential")})
        pending = {"client_id": "chatgpt-client", "redirect_uri": "https://chatgpt.com/callback",
                   "scope": "ci:read", "resource": "https://mcp-http.cimeika.com.ua",
                   "challenge": "pkce-challenge", "expires": time.time() + 60}
        owner.authentication_options("ticket1", pending)
        with self.assertRaises(owner.OwnerAuthError):
            owner.finish_authentication("ticket2", pending, {"id": owner._b64(b"credential")})


if __name__ == "__main__":
    unittest.main()
