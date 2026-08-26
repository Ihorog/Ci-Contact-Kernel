# Ci Execution Center Registry

Registered centers:

- local
- ai
- memory
- service
- repo
- device
- human

Current implementation executes only safe local stubs. External write centers (`service`, `repo`, `device`) return STUB or BLOCKED and do not perform real writes.
