# Ci-Contact-Kernel

Lightweight Ci contact kernel foundation with:

- Event-driven `CiHub` module bus
- Normalized `CiTask` orchestration queue
- Permission-gated background worker
- Verification layer and local JSONL memory loop
- API endpoints for signal/task intake and status
- Single-icon Ci+ contact widget
- Minimal orchestration monitor at `/ci/monitor`
- Registered one-click water executor `Водяний` at `HOME.WATER.VODYANYI`

## Run

```bash
npm install
npm start
```

Open:

- `http://localhost:3000/ci-widget.html` — Ci+ launcher and signal interface
- `http://localhost:3000/ci/monitor` — orchestration monitor
- `http://localhost:3000/ci/status` — kernel health

The widget starts as one transparent Ci icon. Activating it opens the signal surface, sends signals to `POST /ci/signal`, follows the task lifecycle through `GET /ci/task/:id`, and shows the real classification, route, permission state, execution status, and verification proof returned by the kernel.

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
- `GET /ci/vodyanyi/status`
- `POST /ci/vodyanyi/signal`

See [`docs/VODYANYI.md`](docs/VODYANYI.md) for the NFC/UI/voice one-click contract, delivery confirmation and executor adapter contract.
