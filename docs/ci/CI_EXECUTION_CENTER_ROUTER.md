# CI Execution Center Router

Router maps classified tasks to execution centers:

- `fact`, `memory` → `memory`
- `intent`, `task` → `ai`
- `event`, `unknown` → `local`
- `service_action` → `service`
- `repo_action` → `repo`
- `device_action`, `deploy_action` → `device`
- `human_action` → `human`

Current safe behavior:

- `local` and `memory` handlers execute and can verify as completed.
- `ai`, `service`, `repo`, `device`, `human` are stubbed and return blocked verification.
