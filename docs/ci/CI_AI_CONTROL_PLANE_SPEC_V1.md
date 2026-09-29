# CI AI CONTROL PLANE SPEC v1.0

Status: CANONICAL CANDIDATE

## Authority

Ci is the single control plane. AI vendors, GitHub Actions, Cihub/Orange, Supabase, Vercel and file/communication services are executors or evidence providers, not independent control planes.

## Lifecycle

```
intent -> state -> plan -> route -> execute -> evidence -> verify -> reconcile -> status
```

## Invariants

1. No executor may promote its own result to COMPLETE.
2. COMPLETE requires VERIFIED evidence for every mandatory acceptance criterion.
3. Existing verified execution rails are reused before a new executor is introduced.
4. Current verified state outranks prediction, target state and historical context.
5. An unavailable executor produces BLOCKED, not FAILED, unless failure evidence exists.
6. Secrets and credentials never enter prompts, manifests, logs or evidence payloads.
7. Ci coordinates; heavy execution remains isolated in specialized executors.

## Execution states

| State | Meaning |
|---|---|
| PLANNED | accepted intent, no execution |
| QUEUED | accepted by an execution queue |
| RUNNING | current execution evidence exists |
| EXECUTED | action completed but acceptance is not fully proven |
| VERIFIED | all mandatory acceptance checks passed |
| BLOCKED | external dependency prevents progress |
| FAILED | verified execution failure |

State transitions are monotonic except explicit retry/reconciliation. No state may be inferred from elapsed time.

## Router

- local/device -> Cihub -> Orange Pi / Termux / authorized local nodes
- code -> GitHub / GitHub Actions
- data/state -> Supabase
- deploy -> Vercel
- files -> Google Drive; archive -> approved local storage
- communication -> Gmail
- schedule -> Calendar
- research/reasoning -> specialized AI executor

## Token-efficient orchestration

Default: direct specialized executor.

Complex work:
```
Router -> Executor -> Result+Evidence -> Reviewer
```

Scout is introduced only when information gathering is required. Large working context stays outside Ci.

## Evidence contract

Every completion claim must include an evidence reference appropriate to the executor: commit/run ID, API response, durable state row, deployment ID, probe result, hash, or equivalent.

Ci reports the strongest state actually proven by evidence; it never upgrades a state because the intended action was queued.

## Reconciliation

The control plane continuously compares desired and observed state through the existing registry/observer/reconciler/policy/audit/status modules. New automation must extend that loop rather than create a parallel scheduler or duplicate source of truth.

## Current Orange release gate

The release chain remains:
```
exact release -> strict MCP probe -> ci_resource_audit -> Vault live status -> VERIFIED runtime
```

When Cihub/Orange is offline, the release remains QUEUED/BLOCKED. Recovery resumes the existing queue; it must not enqueue duplicate releases.

## Multi-vendor rule

Vendor instructions are executor adapters only. They may tune tool use, repository awareness, research behavior or output format, but cannot override this control-plane contract.
