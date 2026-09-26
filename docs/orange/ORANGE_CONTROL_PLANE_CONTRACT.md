# Orange Control Plane Contract v1

Status: proposed runtime contract
Date: 2026-09-26

## Role

Orange is the persistent control plane for Ci. It MUST coordinate work, not absorb development workloads.

Canonical loop:

```
intent/event
→ normalize task
→ select capability/executor
→ dispatch minimal task contract
→ observe lifecycle
→ receive result + evidence reference
→ verify acceptance
→ update unified state
→ DONE | BLOCKED | FAILED | NEEDS_HUMAN
```

## Task contract

Every delegated task MUST carry:

- task_id
- goal
- acceptance_criteria
- required_capability
- authorization_level
- timeout/retry budget
- evidence_required
- minimal relevant context

Orange MUST NOT forward full chat history or unrelated project context to an executor.

## Control-plane workload allowed on Orange

- capability registry and executor health
- routing and queue metadata
- authorization/policy checks
- task lifecycle state
- timeouts, bounded retries and rerouting
- compact evidence verification
- state/evidence ledger
- lightweight local probes
- event-driven recovery

## Workload that MUST be delegated

Orange MUST NOT be the default runtime for:

- repository development or coding agents
- Android/project builds
- large test suites
- long AI research sessions
- browser automation
- media processing
- large repository checkouts
- bulk artifact transfer
- full executor logs

These belong to GitHub Actions, Grok/Copilot/AI workers, CiHub/Windows, Android/device executors, cloud services, or other registered nodes.

## Result contract

Executors return compact metadata, not the whole artifact:

```json
{
  "task_id": "...",
  "status": "DONE",
  "executor": "...",
  "result_ref": "...",
  "evidence_ref": "...",
  "checks": [{"name": "...", "status": "PASS"}],
  "verified_at": "..."
}
```

DONE is forbidden without accepted evidence.

## Independence

Orange runtime MUST remain operational when CiHub/Windows is OFF.
CiHub is an optional Windows executor, never a control-plane dependency.

ChatGPT/Ci is the user-facing conversational/contact layer.
Android Ci is a contact/device executor.
Orange is the coordination authority.
GitHub is source-of-truth and development execution surface.

## UI contract

Default interaction remains Zero UI:

- Ci logo/contact point
- click
- voice
- swipe-left materializes no more than three current context cards
- full Orange UI is reserved for complex/manual intervention

## Safety

Destructive actions, WAN exposure, credential/permission expansion, payments and external publication require the applicable explicit authorization policy.
Loss-of-access network mutations require a recovery path before dispatch.

## Acceptance

Control plane is green only when:

1. task can be delegated without performing development on Orange;
2. executor returns result/evidence references;
3. verifier can reject unsupported DONE;
4. retry/reroute is bounded;
5. CiHub can be offline without breaking Orange;
6. existing Orange API/MCP/UI/audio surfaces remain functional;
7. Android three-card context contract remains intact.
