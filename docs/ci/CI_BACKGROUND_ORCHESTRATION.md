# CI Background Orchestration

Ci is implemented as a contact kernel pipeline:

signal → contact → classification → orchestration queue → permission gate → execution center → verification → memory → new signal.

## Implemented foundation

- In-process orchestrator with a lightweight queue and worker.
- Task lifecycle with normalized statuses:
  - CREATED, CLASSIFIED, ROUTED, WAITING_PERMISSION, QUEUED, RUNNING, VERIFYING, COMPLETED, BLOCKED, FAILED, UNKNOWN.
- Event-driven module registration via `CiHub` (`EventEmitter`).
- Safe execution behavior: only local/memory handlers can complete.
- External/service/repo/device/human paths are stubbed and blocked, never fake-success.

## Run locally

```bash
npm install
npm start
```

Then open:

- `http://localhost:3000/ci/monitor`
- `http://localhost:3000/ci/status`

## Example test calls

```bash
curl -X POST http://localhost:3000/ci/signal -H "content-type: application/json" -d '{"message":"store memory fact"}'
curl http://localhost:3000/ci/tasks
curl http://localhost:3000/ci/memory
```
