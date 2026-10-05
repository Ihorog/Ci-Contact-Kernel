# Personal Ci → Ci Moment bridge key

This bridge key belongs to the **PERSONAL.CI** contour.

## Invariants

- The Ed25519 private key is generated and stored only on the Personal Ci executor.
- The private key must never be copied to Ci Moment, Vercel, Supabase, GitHub, or logs.
- Ci Moment receives only the raw 32-byte Ed25519 public key encoded as base64url plus the key ID.
- Default key directory: `$HOME/.config/ci/bridge`.
- Default key ID: `personal-ci-orange-v1`.

## Generate on the Personal Ci operator

```bash
bash scripts/personal-ci-bridge-key.sh
```

The command prints only:

- `CI_PERSONAL_BRIDGE_KEY_ID`
- `CI_PERSONAL_BRIDGE_PUBLIC_KEY`
- local private-key path
- confirmation that the private key was not exported

If a private key already exists, the script fails closed instead of overwriting it.

## Sign an intent locally

Prepare the exact JSON body in a file, then:

```bash
bash scripts/personal-ci-bridge-sign.sh POST /api/control/process body.json
```

Use the emitted headers with the exact raw body bytes sent to:

`https://cimoment.com/api/control/process`

The signature covers:

```text
timestamp
HTTP_METHOD
request_path
sha256(raw_body)
```

Only the public key and key ID cross from Personal Ci into Ci Moment.
