# Ci Permission Gate

Permission states:

- BLOCKED
- READY
- UNKNOWN
- EXECUTABLE

Explicit permission is required for:

- repo_write
- deploy
- external_api_write
- device_action
- destructive_action

Unsafe actions are blocked by default when required permissions are missing.
