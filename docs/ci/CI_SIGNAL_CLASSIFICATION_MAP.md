# Ci Signal Classification Map

Supported classifications:

- fact
- intent
- task
- event
- memory
- service_action
- device_action
- repo_action
- unknown

Classification uses explicit `payload.type` when present, otherwise keyword and source heuristics.
