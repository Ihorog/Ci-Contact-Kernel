# CI Task Schema

Each `CiTask` is normalized with the following fields:

- `id`
- `createdAt`
- `updatedAt`
- `source`
- `signalId`
- `type`
- `priority`
- `status`
- `classification`
- `targetNode`
- `executionCenter`
- `requestedAction`
- `permissionLevel`
- `permissionDecision`
- `payload`
- `result`
- `verification`
- `error`
- `memoryRecordId`
- `nextSuggestedAction`

`verification` always includes:

- `status`: `verified | failed | blocked | unknown`
- `method`: `direct_result | state_check | manual_confirmation_required | stub | none`

`COMPLETED` is only set when verification status is `verified`.
