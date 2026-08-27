# Completion Contract, Tool Approval Checkpoints, Multi-target Routing

## Overview

Three architectural upgrades added in issue #6, layered on top of the existing framework without replacing it.

---

## 1. Mechanical Completion Contract (`src/completionContract.js`)

`COMPLETED` is now mechanically gated — a task cannot transition to `COMPLETED` unless the completion policy evaluates to `true` against all recorded verifier results.

### Task fields added

| Field | Description |
|---|---|
| `completionPolicy` | `all_verifiers` (default) or `any_verifier` |
| `requiredVerifiers` | Array of verifier IDs that must pass |
| `verificationResults` | Array of recorded verifier results (id, verifierId, status, timestamp, evidence) |
| `verificationAttempt` | How many verification attempts have been made |
| `maxVerificationRetries` | Maximum retries before `VERIFICATION_FAILED` (default 2) |
| `incidentRecord` | Set when retries are exhausted; includes reason, attempt count, and all results |

### New task state: `VERIFICATION_FAILED`

When retries are exhausted and the policy still fails, the task transitions to `VERIFICATION_FAILED` (never `COMPLETED`).

### Classification-based permission inference

`createTask` now infers `permissionLevel` from classification when no explicit level is provided:

| Classification | Inferred level |
|---|---|
| `deploy_action`, `device_action` | `L5_DEPLOY_OR_DEVICE_ACTION` |
| `service_action` | `L4_EXTERNAL_API_WRITE` |
| `repo_action` | `L3_REPO_WRITE` |
| `human_action` | `L2_LOCAL_WRITE` |
| `task` | `L1_DRAFT` |
| others | `L0_READ` |

---

## 2. Tool-level Approval + Persistent Checkpoint/Resume (`src/checkpointStore.js`)

Sensitive execution centers (`service`, `repo`, `device`, `human`) now pause before execution unless explicitly approved.

### Task fields added

| Field | Description |
|---|---|
| `approvalPolicy` | `null` (default — inferred from center), `require_human`, or `auto` |
| `approvalState` | `null`, `pending`, `approved`, or `rejected` |
| `checkpointId` | UUID of the persisted checkpoint |

### New task state: `WAITING_APPROVAL`

A task transitions to `WAITING_APPROVAL` immediately before sensitive execution. The checkpoint captures task state, center, and phase. On approval, the task resumes from the checkpoint without replaying completed steps.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/ci/task/:id/approve` | Approve a checkpoint; body: `{ checkpointId, actor, reason }` |
| `POST` | `/ci/task/:id/reject` | Reject a checkpoint; produces `BLOCKED` with auditable reason |
| `GET` | `/ci/checkpoints` | List all checkpoints |
| `GET` | `/ci/checkpoint/:id` | Get a specific checkpoint |

### Memory/audit records

Every approval decision is appended to the memory store with: `event`, `decision`, `actor`, `reason`, `checkpointId`, `taskId`, `timestamp`.

---

## 3. Multi-target Semantic Routing (`src/resultAggregator.js`)

A single signal can now fan-out to N execution centers. Branches are tracked independently and aggregated by policy.

### Task fields added

| Field | Description |
|---|---|
| `executionCenters` | Array of center IDs (defaults to `[executionCenter]`) |
| `branches` | Per-branch state: `id`, `executionCenter`, `status`, `result`, `error`, `verification`, `checkpointId`, `approvalState` |
| `aggregationPolicy` | `all_required` (default), `any_success`, `quorum`, `best_effort` |
| `aggregationSummary` | Output of aggregation: total, succeeded, failed, blocked, pending, outcome, conflict |

### Aggregation policies

| Policy | Outcome rule |
|---|---|
| `all_required` | All branches must succeed |
| `any_success` | At least one branch must succeed |
| `quorum` | Majority of branches must succeed |
| `best_effort` | Always succeeds; records whatever completed |

### Multi-center request example

```json
POST /ci/task
{
  "type": "signal",
  "classification": "event",
  "executionCenters": ["local", "memory", "ai"],
  "aggregationPolicy": "any_success"
}
```

---

## Migration notes

- All existing single-center tasks continue to work unchanged; `executionCenters` defaults to `[executionCenter]`.
- `WAITING_PERMISSION` state is preserved for backward compatibility.
- The new `WAITING_APPROVAL` and `VERIFICATION_FAILED` states are additive.
- `permissionLevel` is now inferred from classification when not explicitly provided; existing callers that set it explicitly are unaffected.
- The `verification` object is preserved on all tasks; `verificationResults` is the new structured array.
