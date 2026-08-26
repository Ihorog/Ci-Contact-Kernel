# Ci-Contact-Kernel

Lightweight Ci contact kernel foundation with:

- Event-driven `CiHub` module bus
- Normalized `CiTask` orchestration queue
- Permission-gated background worker
- Verification layer and local JSONL memory loop
- API endpoints for signal/task intake and status
- Minimal orchestration monitor at `/ci/monitor`

## Run

```bash
npm install
npm start
```

## Core endpoints

- `POST /ci/signal`
- `POST /ci/task`
- `GET /ci/task/:id`
- `GET /ci/tasks`
- `POST /ci/task/:id/run`
- `GET /ci/status`
- `GET /ci/memory`
- `POST /ci/command`
- `POST /ciopen/webhook`
