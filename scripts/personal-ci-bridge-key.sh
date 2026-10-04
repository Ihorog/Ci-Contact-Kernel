#!/usr/bin/env bash
set -euo pipefail

KEY_DIR="${CI_PERSONAL_BRIDGE_KEY_DIR:-$HOME/.config/ci/bridge}"
KEY_ID="${CI_PERSONAL_BRIDGE_KEY_ID:-personal-ci-orange-v1}"
PRIVATE_KEY="$KEY_DIR/ed25519-private.pem"
PUBLIC_DER="$KEY_DIR/ed25519-public.der"

umask 077
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl_not_found" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3_not_found" >&2
  exit 1
fi

if [[ -e "$PRIVATE_KEY" ]]; then
  echo "private_key_already_exists:$PRIVATE_KEY" >&2
  exit 2
fi

openssl genpkey -algorithm Ed25519 -out "$PRIVATE_KEY"
chmod 600 "$PRIVATE_KEY"
openssl pkey -in "$PRIVATE_KEY" -pubout -outform DER -out "$PUBLIC_DER"
chmod 644 "$PUBLIC_DER"

PUBLIC_B64URL="$(
  python3 - "$PUBLIC_DER" <<'PY'
import base64
import pathlib
import sys

data = pathlib.Path(sys.argv[1]).read_bytes()
prefix = bytes.fromhex("302a300506032b6570032100")
if len(data) != len(prefix) + 32 or not data.startswith(prefix):
    raise SystemExit("unexpected_ed25519_spki")
raw = data[len(prefix):]
print(base64.urlsafe_b64encode(raw).decode().rstrip("="))
PY
)"

printf 'CI_PERSONAL_BRIDGE_KEY_ID=%s\n' "$KEY_ID"
printf 'CI_PERSONAL_BRIDGE_PUBLIC_KEY=%s\n' "$PUBLIC_B64URL"
printf 'PRIVATE_KEY_PATH=%s\n' "$PRIVATE_KEY"
printf 'PRIVATE_KEY_EXPORTED=false\n'
