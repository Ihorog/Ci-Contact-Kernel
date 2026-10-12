"""Ci owner passkey boundary: local bootstrap; verified WebAuthn; one-use OAuth grants.

Uses the maintained py_webauthn verification library. Never accepts a browser
claim of verification or a plaintext biometric. Missing dependencies fail closed.
"""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import time
from pathlib import Path

RP_ID = "mcp-http.cimeika.com.ua"
ORIGIN = "https://" + RP_ID
STATE = Path(os.getenv("CI_OWNER_AUTH_STATE", "/home/kazkar/cit/state/ci_owner_auth.db"))
MAX_TTL = 300


class OwnerAuthError(ValueError):
    pass


def _digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(raw):
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def _binding(ticket, pending):
    return {
        "ticket_digest": _digest(ticket),
        "client_id": pending["client_id"],
        "redirect_uri": pending["redirect_uri"],
        "scope": pending["scope"],
        "resource": pending["resource"],
        "challenge": pending["challenge"],
    }


def _canonical(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def _db():
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not STATE.exists():
        fd = os.open(str(STATE), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    c = sqlite3.connect(str(STATE), timeout=8, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout = 8000")
    c.executescript("""
        CREATE TABLE IF NOT EXISTS bootstrap(
            token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS credential(
            credential_id TEXT PRIMARY KEY, public_key TEXT NOT NULL,
            sign_count INTEGER NOT NULL, owner_handle TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ceremony(
            key TEXT PRIMARY KEY, kind TEXT NOT NULL,
            challenge TEXT NOT NULL, binding TEXT NOT NULL,
            expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS grant(
            ticket_hash TEXT PRIMARY KEY, binding TEXT NOT NULL,
            expires INTEGER NOT NULL, reference TEXT NOT NULL);
    """)
    return c


def _lib():
    try:
        import webauthn
        from webauthn.helpers.structs import (
            AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
            UserVerificationRequirement, ResidentKeyRequirement
        )
        return webauthn, AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, UserVerificationRequirement, ResidentKeyRequirement
    except ImportError as exc:
        raise OwnerAuthError("webauthn_dependency_unavailable") from exc


def issue_local_bootstrap():
    """Only the owner in an interactive Orange shell may mint first enrollment."""
    import pwd
    if not sys.stdin.isatty() or os.geteuid() != pwd.getpwnam("kazkar").pw_uid:
        raise OwnerAuthError("interactive_owner_shell_required")
    if os.getenv("CI_OWNER_BOOTSTRAP_ENABLED") != "1":
        raise OwnerAuthError("local_bootstrap_not_enabled")
    c = _db()
    try:
        c.execute("BEGIN IMMEDIATE")
        if c.execute("SELECT COUNT(*) FROM credential").fetchone()[0]:
            raise OwnerAuthError("already_enrolled")
        token = secrets.token_urlsafe(32)
        c.execute("DELETE FROM bootstrap")
        c.execute("INSERT INTO bootstrap VALUES (?, ?)", (_digest(token), int(time.time()) + MAX_TTL))
        c.commit()
        return token
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def registration_options(bootstrap):
    lib, Criteria, _, UV, Resident = _lib()
    c = _db()
    try:
        row = c.execute("SELECT expires FROM bootstrap WHERE token_hash=?", (_digest(bootstrap),)).fetchone()
        if not row or row["expires"] <= time.time():
            raise OwnerAuthError("invalid_or_expired_bootstrap")
        if c.execute("SELECT COUNT(*) FROM credential").fetchone()[0]:
            raise OwnerAuthError("already_enrolled")
        challenge = secrets.token_bytes(32)
        opts = lib.generate_registration_options(
            rp_id=RP_ID, rp_name="Ci Owner", user_name="Ci owner",
            user_id=secrets.token_bytes(32), challenge=challenge,
            authenticator_selection=Criteria(
                user_verification=UV.REQUIRED, resident_key=Resident.PREFERRED),
        )
        c.execute("REPLACE INTO ceremony VALUES (?,?,?,?,?)",
                  (_digest(bootstrap), "enroll", _b64(challenge), "",
                   min(int(row["expires"]), int(time.time()) + 120)))
        return json.loads(lib.options_to_json(opts))
    finally:
        c.close()


def finish_registration(bootstrap, credential):
    lib, _, _, _, _ = _lib()
    key = _digest(bootstrap)
    c = _db()
    try:
        entry = c.execute("SELECT challenge,expires FROM ceremony WHERE key=? AND kind='enroll'", (key,)).fetchone()
        valid = c.execute("SELECT expires FROM bootstrap WHERE token_hash=?", (key,)).fetchone()
        if not entry or not valid or min(valid["expires"], entry["expires"]) <= time.time():
            raise OwnerAuthError("enrollment_challenge_expired")
        verified = lib.verify_registration_response(
            credential=credential, expected_challenge=_unb64(entry["challenge"]),
            expected_rp_id=RP_ID, expected_origin=ORIGIN, require_user_verification=True,
        )
        c.execute("BEGIN IMMEDIATE")
        if c.execute("SELECT COUNT(*) FROM credential").fetchone()[0]:
            raise OwnerAuthError("already_enrolled")
        latest = c.execute("SELECT challenge,expires FROM ceremony WHERE key=? AND kind='enroll'", (key,)).fetchone()
        if not latest or latest["challenge"] != entry["challenge"] or latest["expires"] <= time.time():
            raise OwnerAuthError("enrollment_replay")
        c.execute("INSERT INTO credential VALUES (?,?,?,?)",
                  (_b64(verified.credential_id), _b64(verified.credential_public_key),
                   verified.sign_count, "ci-owner"))
        c.execute("DELETE FROM bootstrap WHERE token_hash=?", (key,))
        c.execute("DELETE FROM ceremony WHERE key=?", (key,))
        c.commit()
        return {"verified": True, "enrolled": True}
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def authentication_options(ticket, pending):
    lib, _, Descriptor, UV, _ = _lib()
    binding = _binding(ticket, pending)
    c = _db()
    try:
        ids = [Descriptor(id=_unb64(row["credential_id"]))
               for row in c.execute("SELECT credential_id FROM credential")]
        if not ids:
            raise OwnerAuthError("owner_passkey_not_enrolled")
        challenge = secrets.token_bytes(32)
        opts = lib.generate_authentication_options(
            rp_id=RP_ID, challenge=challenge, allow_credentials=ids,
            user_verification=UV.REQUIRED,
        )
        expires = min(int(pending["expires"]), int(time.time()) + 120)
        if expires <= time.time():
            raise OwnerAuthError("oauth_ticket_expired")
        c.execute("REPLACE INTO ceremony VALUES (?,?,?,?,?)",
                  (_digest(ticket), "oauth", _b64(challenge), _canonical(binding), expires))
        return json.loads(lib.options_to_json(opts))
    finally:
        c.close()


def finish_authentication(ticket, pending, credential):
    lib, _, _, _, _ = _lib()
    binding = _canonical(_binding(ticket, pending))
    key = _digest(ticket)
    cred_id = credential.get("id", "")
    c = _db()
    try:
        record = c.execute("SELECT * FROM ceremony WHERE key=? AND kind='oauth'", (key,)).fetchone()
        owner = c.execute("SELECT * FROM credential WHERE credential_id=?", (cred_id,)).fetchone()
        if not record or not owner or record["binding"] != binding or record["expires"] <= time.time():
            raise OwnerAuthError("invalid_or_expired_oauth_challenge")
        verified = lib.verify_authentication_response(
            credential=credential, expected_challenge=_unb64(record["challenge"]),
            expected_rp_id=RP_ID, expected_origin=ORIGIN,
            credential_public_key=_unb64(owner["public_key"]),
            credential_current_sign_count=owner["sign_count"],
            require_user_verification=True,
        )
        c.execute("BEGIN IMMEDIATE")
        current = c.execute("SELECT * FROM ceremony WHERE key=? AND kind='oauth'", (key,)).fetchone()
        if not current or current["challenge"] != record["challenge"] or current["expires"] <= time.time():
            raise OwnerAuthError("oauth_assertion_replay")
        old = c.execute("SELECT sign_count FROM credential WHERE credential_id=?", (cred_id,)).fetchone()
        if not old or old["sign_count"] != owner["sign_count"]:
            raise OwnerAuthError("credential_counter_changed")
        c.execute("UPDATE credential SET sign_count=? WHERE credential_id=?",
                  (verified.new_sign_count, cred_id))
        evidence_ref = "ci-passkey:" + secrets.token_hex(16)
        c.execute("REPLACE INTO grant VALUES (?,?,?,?)",
                  (key, binding, min(int(pending["expires"]), int(time.time()) + 45), evidence_ref))
        c.execute("DELETE FROM ceremony WHERE key=?", (key,))
        c.commit()
        return {"verified": True}
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def consume_verified_oauth_grant(binding):
    """Atomic server-side consumption; no untrusted client can mint this record."""
    key = binding.get("ticket_digest")
    c = _db()
    try:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT binding,expires,reference FROM grant WHERE ticket_hash=?", (key,)).fetchone()
        if not row or row["binding"] != _canonical(binding) or row["expires"] <= time.time():
            c.rollback()
            return None
        c.execute("DELETE FROM grant WHERE ticket_hash=?", (key,))
        c.commit()
        return {
            **binding, "verified": True, "authority": "CI.AUTH.GATEWAY",
            "user_verified": True, "verification_method": "webauthn",
            "expires_at": row["expires"], "evidence_ref": row["reference"],
        }
    finally:
        c.close()


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] != "bootstrap":
        raise SystemExit("usage: CI_OWNER_BOOTSTRAP_ENABLED=1 python3 ci_owner_webauthn.py bootstrap")
    print(issue_local_bootstrap())
