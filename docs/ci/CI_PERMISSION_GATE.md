# CI Permission Gate

Permission levels:

- `L0_READ`
- `L1_DRAFT`
- `L2_LOCAL_WRITE`
- `L3_REPO_WRITE`
- `L4_EXTERNAL_API_WRITE`
- `L5_DEPLOY_OR_DEVICE_ACTION`

Rules:

- `L0_READ` and `L1_DRAFT` execute by default.
- `L2_LOCAL_WRITE` requires explicit `localWrite` permission.
- `L3_REPO_WRITE` requires explicit `repoWrite` delegation.
- `L4_EXTERNAL_API_WRITE` requires explicit `externalApiWrite` permission.
- `L5_DEPLOY_OR_DEVICE_ACTION` requires explicit `deployOrDeviceConfirm` confirmation.

If required permission is missing, task transitions to `BLOCKED` and is never marked completed.
