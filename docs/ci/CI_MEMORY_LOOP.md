# CI Memory Loop

Task lifecycle records are persisted to local JSONL storage:

- File: `data/ci-memory.jsonl`

Each record includes:

- `timestamp`
- `taskId`
- `signal`
- `classification`
- `node`
- `executionCenter`
- `permissionDecision`
- `statusBefore`
- `statusAfter`
- `result`
- `verification`
- `error`
- `nextSuggestedAction`

This creates a durable loop for post-run introspection and follow-up signal generation.
