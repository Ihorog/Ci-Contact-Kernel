# CI Verification Layer

Every task stores verification metadata.

Verification statuses:

- `verified`
- `failed`
- `blocked`
- `unknown`

Verification methods:

- `direct_result`
- `state_check`
- `manual_confirmation_required`
- `stub`
- `none`

Enforcement:

- `COMPLETED` is only possible when `verification.status = verified`.
- Stubbed unsafe actions produce `verification.status = blocked`.
