# Ci Operator — Analytics Baseline v1

## Measurement purpose
Measure whether `CI.OPERATOR.ORANGE` reduces the path from intent to verified result without weakening permission, safety, reversibility, evidence or causality.

## Current verified baseline
- Registry coordinates: 28.
- Verified/callable coordinates: 27.
- Blocked coordinates: 1.
- Partial/limited coordinates: 3.
- Public MCP probe: PASS.
- Orange command queue: VERIFIED executor.
- Keenetic Vault operator archive: VERIFIED, byte compare PASS.
- Orange-native SaaS direct-read candidates: 0 at the last acceptance snapshot because provider CLIs were absent.

## Primary KPIs
| KPI | Definition | Target now |
|---|---|---|
| successRate | successful operator events / all operator events | baseline first |
| evidenceCompleteness | executed events with evidence / executed events | 1.0 policy invariant |
| latency p50/p95 | measured end-to-end operator latency | baseline first |
| fallbackRate | delegated fallback events / all events | baseline first |
| executedRate | real executor attempts / all events | baseline first |

## Guardrails
- `secretExposure = 0`.
- `unverifiedCompletion = 0`.
- `unsupportedQueueAction = 0`.
- Registry or Memory must never be counted as live availability evidence.
- Missing measurements are not imputed.

## Data contract
Source schema: `ci.operator.telemetry/v1`.
Command schema: `ci.operator.command/v1`.
Telemetry stores timestamps, coordinate, route, outcome, latency, execution/evidence/fallback flags and bounded error codes only.
It does not store user intent, payload, provider response bodies, stdout/stderr, credentials, tokens, cookies or authorization headers.

## Decision rule
Do not set performance thresholds until a representative live baseline exists. After deployment, collect real events, report coverage, p50/p95 latency, success/evidence/fallback rates, and only then propose thresholds with provenance.
