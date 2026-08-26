# Ci Memory Loop

Memory records are appended to local JSONL storage (`data/ci-memory.jsonl`) and include:

- timestamp
- signal
- classification
- node
- permission decision
- execution result
- verification
- error
- next suggested action

`GET /ci/memory` returns the latest records.
