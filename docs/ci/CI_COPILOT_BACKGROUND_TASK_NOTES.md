# CI Copilot Background Task Notes

## Scope delivered

- Lightweight in-process background orchestration worker.
- Normalized CiTask lifecycle and schema.
- Classifier + router + permission gate + verification + memory persistence.
- API endpoints for signal/task intake, task execution, status, and memory logs.
- Minimal orchestration monitor UI.

## Safe-by-default limits

- No real repository writes through the app.
- No real external API writes through the app.
- No real deploy/device actions.
- Unsupported or unsafe centers are returned as blocked/stub outcomes.

## Next recommended step

- Add pluggable signed permission delegation records per task and user identity, then connect verified execution adapters one center at a time.
