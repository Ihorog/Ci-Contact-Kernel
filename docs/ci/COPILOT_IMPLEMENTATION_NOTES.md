# Copilot Implementation Notes

This initial implementation keeps changes minimal and modular:

- Added an Express runtime with endpoints for signal, command, webhook, status, and memory.
- Added `src/ci/kernel.js` to normalize, classify, route, gate, execute (stub), verify, and persist memory.
- Added a plain HTML widget at `/ci/widget` to demonstrate the end-to-end Ci flow.
- Added focused endpoint tests for orchestration output and default blocking behavior.
