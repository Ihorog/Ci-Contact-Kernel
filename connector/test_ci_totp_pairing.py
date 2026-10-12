"""2FAS Auth provisioning regressions: standard QR and no unverified enrollment."""
import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import ci_totp_pairing as pair


class TwoFasPairingTests(unittest.TestCase):
    def setUp(self):
        from cryptography.fernet import Fernet
        self.folder = tempfile.TemporaryDirectory()
        self.old_db = pair.DB_PATH
        pair.DB_PATH = pathlib.Path(self.folder.name) / "ci-2fas-test.db"
        self.keypatch = patch.dict(os.environ, {
            "CI_TOTP_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
        })
        self.keypatch.start()
        self.binding = {
            "ticket_digest": "a"*64,
            "client_id": "ci-owner-2fas",
            "redirect_uri": "https://mcp-http.cimeika.com.ua/owner/2fas",
            "scope": "ci:act",
            "resource": "https://mcp-http.cimeika.com.ua",
            "challenge": "pkce-test",
        }
        self.owner_ref = "ci-passkey:test-reference"
        self.proof = {"user_verified": True, "evidence_ref": self.owner_ref}
        self.start = 1760000000

    def tearDown(self):
        self.keypatch.stop()
        pair.DB_PATH = self.old_db
        self.folder.cleanup()

    def test_unverified_reference_cannot_start_enrollment(self):
        with self.assertRaises(pair.TotpError):
            pair.begin_pairing(self.owner_ref, now=self.start)
        with self.assertRaises(pair.TotpError):
            pair.begin_pairing({**self.binding, "scope": "ci:read"}, now=self.start)
        with patch("ci_owner_webauthn.consume_verified_oauth_grant", return_value=None):
            with self.assertRaises(pair.TotpError):
                pair.begin_pairing(self.binding, now=self.start)

    def test_qr_is_2fas_compatible_and_enrollment_is_one_time(self):
        import pyotp
        with patch("ci_owner_webauthn.consume_verified_oauth_grant", return_value=self.proof) as consume:
            record = pair.begin_pairing(self.binding, now=self.start)
        consume.assert_called_once_with(self.binding)
        url = record["otpauth_uri"]
        parts = urlparse(url)
        self.assertEqual(parts.scheme, "otpauth")
        self.assertEqual(parts.netloc, "totp")
        settings = parse_qs(parts.query)
        self.assertEqual(settings["issuer"][0], "Ci")
        self.assertEqual(pair.provisioning_label(url)["digits"], "6")
        self.assertEqual(record["expires_at"], self.start+180)
        self.assertTrue(pair.qr_png_bytes(url).startswith(b"\x89PNG\r\n\x1a\n"))
        code = pyotp.TOTP(settings["secret"][0]).at(self.start)
        wrong_code = "000000" if code != "000000" else "999999"
        with self.assertRaises(pair.TotpError):
            pair.confirm_pairing(record["pairing_token"], wrong_code,
                                 self.owner_ref, now=self.start)
        self.assertTrue(pair.confirm_pairing(record["pairing_token"], code,
                                             self.owner_ref, now=self.start)["paired"])
        self.assertFalse(pair.verify_additional_factor(code, now=self.start))
        next_code = pyotp.TOTP(settings["secret"][0]).at(self.start + 30)
        self.assertTrue(pair.verify_additional_factor(next_code, now=self.start + 30))
        self.assertFalse(pair.verify_additional_factor(next_code, now=self.start + 30))
        with self.assertRaises(pair.TotpError):
            pair.confirm_pairing(record["pairing_token"], code,
                                 self.owner_ref, now=self.start)

    def test_binding_mismatch_or_expired_qr_must_fail(self):
        import pyotp
        from cryptography.fernet import Fernet
        with patch("ci_owner_webauthn.consume_verified_oauth_grant", return_value=self.proof):
            record = pair.begin_pairing(self.binding, now=self.start)
        secret = parse_qs(urlparse(record["otpauth_uri"]).query)["secret"][0]
        code = pyotp.TOTP(secret).at(self.start)
        with self.assertRaises(pair.TotpError):
            pair.confirm_pairing(record["pairing_token"], code,
                                 "ci-passkey:other", now=self.start)
        with self.assertRaises(pair.TotpError):
            pair.confirm_pairing(record["pairing_token"], code,
                                 self.owner_ref, now=self.start + 181)
        with patch.dict(os.environ, {"CI_TOTP_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii")}):
            with self.assertRaises(pair.TotpError):
                pair.confirm_pairing(record["pairing_token"], code,
                                     self.owner_ref, now=self.start)


if __name__ == "__main__":
    unittest.main()
