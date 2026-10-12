"""Optional Ci 2FAuth/TOTP pairing, not a substitute for WebAuthn.

Only an internal handler that has just verified a Ci owner passkey may call
begin_pairing(). Never publish the provisioning URI, QR or TOTP secret to logs,
GitHub, CI output or chat. No HTTP endpoint is defined by this module.

Requires pyotp + cryptography. Encryption key must be supplied as a separate
root-provisioned CI_TOTP_ENCRYPTION_KEY, never created or stored in Git.
"""
import hashlib
import importlib
import os
from pathlib import Path
import secrets
import sqlite3
import time
from urllib.parse import urlparse, parse_qs

DB_PATH = Path(os.environ.get("CI_TOTP_DB_PATH", "/home/kazkar/cit/state/ci_totp.db"))
ISSUER = "Ci"
ACCOUNT = "Ci Owner"
PAIRING_TTL = 180


class TotpError(ValueError):
    pass


def _digest(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _require_dependencies():
    try:
        return importlib.import_module("pyotp"), importlib.import_module("cryptography.fernet").Fernet
    except ImportError as exc:
        raise TotpError("totp_dependency_unavailable") from exc


def _cipher():
    _, Fernet = _require_dependencies()
    key = os.environ.get("CI_TOTP_ENCRYPTION_KEY")
    if not key:
        raise TotpError("totp_encryption_key_not_provisioned")
    try:
        return Fernet(key.encode("ascii"))
    except Exception as exc:
        raise TotpError("invalid_encryption_key") from exc


def _db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not DB_PATH.exists():
        fd = os.open(str(DB_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    conn = sqlite3.connect(str(DB_PATH), timeout=5, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pending (
            pair_digest TEXT PRIMARY KEY, secret_cipher BLOB NOT NULL,
            expires INTEGER NOT NULL, verified_owner_ref TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS totp (
            owner_handle TEXT PRIMARY KEY, secret_cipher BLOB NOT NULL,
            last_counter INTEGER NOT NULL, enrolled INTEGER NOT NULL);
    """)
    return conn


def _totp(secret):
    pyotp, _ = _require_dependencies()
    return pyotp.TOTP(secret, digits=6, interval=30, digest="sha1")


def begin_pairing(verified_owner_ref, *, now=None):
    """Call only after independent server-side passkey assertion verification.

    verified_owner_ref is an opaque server-issued reference, not client input.
    Returns a sensitive otpauth URI: only expose inside protected owner UX.
    """
    if not isinstance(verified_owner_ref, str) or not verified_owner_ref.startswith("ci-passkey:"):
        raise TotpError("verified_passkey_required")
    cipher = _cipher()
    pyotp, _ = _require_dependencies()
    now = int(time.time() if now is None else now)
    secret = pyotp.random_base32()
    token = secrets.token_urlsafe(32)
    otp_uri = _totp(secret).provisioning_uri(name=ACCOUNT, issuer_name=ISSUER)
    conn = _db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT COUNT(*) FROM totp WHERE owner_handle=?", (ACCOUNT,)).fetchone()[0]:
            raise TotpError("already_paired")
        conn.execute("DELETE FROM pending WHERE expires<=?", (now,))
        conn.execute("INSERT INTO pending VALUES (?,?,?,?)",
                     (_digest(token), cipher.encrypt(secret.encode("ascii")),
                      now + PAIRING_TTL, verified_owner_ref))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"pairing_token": token, "otpauth_uri": otp_uri, "expires_at": now + PAIRING_TTL}


def confirm_pairing(pairing_token, otp_code, verified_owner_ref, *, now=None):
    """Commit only after 2FAuth generated a valid six-digit code.

    Confirmation requires the same server-side owner reference that initiated
    pairing, so possession of a QR image alone does not enroll the account.
    """
    if not isinstance(pairing_token, str) or len(pairing_token) > 160:
        raise TotpError("invalid_pairing_token")
    if not isinstance(verified_owner_ref, str):
        raise TotpError("verified_passkey_required")
    if not isinstance(otp_code, str) or len(otp_code) != 6 or not otp_code.isdecimal():
        raise TotpError("invalid_otp_format")
    now = int(time.time() if now is None else now)
    cipher = _cipher()
    conn = _db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        record = conn.execute("SELECT * FROM pending WHERE pair_digest=?", (_digest(pairing_token),)).fetchone()
        if not record or record["expires"] <= now or record["verified_owner_ref"] != verified_owner_ref:
            raise TotpError("missing_or_expired_pairing")
        if conn.execute("SELECT COUNT(*) FROM totp WHERE owner_handle=?", (ACCOUNT,)).fetchone()[0]:
            raise TotpError("already_paired")
        try:
            secret = cipher.decrypt(record["secret_cipher"]).decode("ascii")
        except Exception as exc:
            raise TotpError("totp_key_mismatch") from exc
        # Do not accept adjacent time windows during enrollment: confirm that
        # owner can read a current, freshly generated token from 2FAuth.
        code_ok = _totp(secret).verify(otp_code, for_time=now, valid_window=0)
        if not code_ok:
            raise TotpError("invalid_otp_code")
        conn.execute("INSERT INTO totp VALUES (?,?,?,?)",
                     (ACCOUNT, record["secret_cipher"], now//30, now))
        conn.execute("DELETE FROM pending WHERE pair_digest=?", (_digest(pairing_token),))
        conn.commit()
        return {"paired": True, "method": "TOTP", "issuer": ISSUER}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def verify_additional_factor(otp_code, *, now=None):
    """Optional factor only; does not mint an OAuth grant or bypass a passkey.

    Replay protection is enforced atomically. A valid one-time password is not
    legal identity proof and never authorizes critical Ci actions by itself.
    """
    if not isinstance(otp_code, str) or len(otp_code)!=6 or not otp_code.isdecimal():
        return False
    now = int(time.time() if now is None else now)
    cipher = _cipher()
    conn = _db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        record = conn.execute("SELECT * FROM totp WHERE owner_handle=?", (ACCOUNT,)).fetchone()
        if not record:
            conn.rollback()
            return False
        try:
            secret = cipher.decrypt(record["secret_cipher"]).decode("ascii")
        except Exception:
            conn.rollback()
            return False
        counter = now // 30
        if counter <= record["last_counter"] or not _totp(secret).verify(otp_code, for_time=now, valid_window=0):
            conn.rollback()
            return False
        conn.execute("UPDATE totp SET last_counter=? WHERE owner_handle=?", (counter, ACCOUNT))
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def provisioning_label(uri):
    """Safely expose only nonsecret issuer/label metadata for testing."""
    parsed = urlparse(uri)
    if parsed.scheme != "otpauth" or parsed.netloc != "totp":
        raise TotpError("invalid_provisioning_uri")
    data = parse_qs(parsed.query)
    return {"issuer": data.get("issuer", [""])[0], "digits": data.get("digits", ["6"])[0]}
