#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then
  echo "usage: $0 METHOD PATH [BODY_FILE]" >&2
  exit 64
fi

METHOD="${1^^}"
PATH_VALUE="$2"
BODY_FILE="${3:-}"
KEY_DIR="${CI_PERSONAL_BRIDGE_KEY_DIR:-$HOME/.config/ci/bridge}"
PRIVATE_KEY="$KEY_DIR/ed25519-private.pem"
KEY_ID="${CI_PERSONAL_BRIDGE_KEY_ID:-personal-ci-orange-v1}"

if [[ ! -f "$PRIVATE_KEY" ]]; then
  echo "private_key_missing:$PRIVATE_KEY" >&2
  exit 2
fi

if [[ -n "$BODY_FILE" ]]; then
  RAW_BODY="$(cat "$BODY_FILE")"
else
  RAW_BODY=""
fi

TIMESTAMP="$(date +%s)"
BODY_SHA="$(
  printf '%s' "$RAW_BODY" | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
)"
MESSAGE="$TIMESTAMP
$METHOD
$PATH_VALUE
$BODY_SHA"

SIG_FILE="$(mktemp)"
trap 'rm -f "$SIG_FILE"' EXIT

printf '%s' "$MESSAGE" | openssl pkeyutl -sign -rawin -inkey "$PRIVATE_KEY" -out "$SIG_FILE"

SIGNATURE="$(
  python3 - "$SIG_FILE" <<'PY'
import base64
import pathlib
import sys

sig = pathlib.Path(sys.argv[1]).read_bytes()
if len(sig) != 64:
    raise SystemExit("unexpected_ed25519_signature_length")
print(base64.urlsafe_b64encode(sig).decode().rstrip("="))
PY
)"

printf 'X-Ci-Bridge-Key-Id: %s\n' "$KEY_ID"
printf 'X-Ci-Bridge-Timestamp: %s\n' "$TIMESTAMP"
printf 'X-Ci-Bridge-Signature: %s\n' "$SIGNATURE"
