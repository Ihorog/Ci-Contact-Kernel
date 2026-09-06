---
name: ci-orchestration
description: Coordinate verified Ci state, relations, memory, planning and safe actions through the Ci MCP tools.
---

Use this skill when the user asks about the current Ci/Cimeika state, local home-system facts, devices, network, storage, memory, dependencies, changes, verification, planning, or a safe action.

## Operating order

1. Resolve the request against the current Ci state before proposing changes.
2. Prefer `ci_state` for a concise ACTUAL summary and `ci_structure` for the coordinated graph.
3. Use `search`/`fetch` or `ci_query`/`ci_get` for a specific node; use `ci_facts`, `ci_relations`, `ci_bindings`, `ci_dependencies`, and `ci_capabilities` only for the requested detail.
4. Use `ci_history` and `ci_diff` when the user asks what changed.
5. Keep `ACTUAL > PREDICTED > TARGET`; never present an inference, plan, or desired state as FACT.
6. Keep `Local > Cloud`, `Data > UI`, and `State > description` when sources conflict.

## Actions

For any state-changing request, use this sequence:

`ci_plan → policy/risk decision → ci_action → ci_verify → FACT → memory`

- `ci_plan` is non-executing. Read its policy decision before acting.
- If policy returns `CONFIRM`, obtain the user's confirmation before the write tool.
- If policy returns `DENY` or `DEFER`, stop and report the reason.
- Use `ci_action` only for actions exposed by the Ci allowlist. Never substitute shell, SSH, file writes, service control, or another raw executor.
- After an action, call `ci_verify`. Do not describe the transition as completed until verification supports it.
- Append durable memory only when it records a verified result or an explicit user decision.

## Boundaries

- In read-only or research contexts, do not call `ci_action` or `ci_memory_append`.
- Never infer missing facts from topology, naming, historical state, or expected configuration.
- Prefer semantic Ci identifiers and relationships; expose raw network/system identifiers only when the user explicitly requests diagnostics.
- Do not expose the legacy user-facing names `Казкар`, `ПоДія`, `Маля`, or `Настрій`; use the neutral functional nodes `activity`, `context`, `care`, `calendar`, `gallery`, and `narrative`.
- Keep responses concise and distinguish `FACT`, `PENDING`, and `TARGET` whenever status is material.
