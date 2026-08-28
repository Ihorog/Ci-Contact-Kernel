# Ci Graph Architecture

## Overview

Ci Graph is the canonical semantic graph shared by all Ci+ domains. It provides a stable, versioned vocabulary for identity, classification, relations, temporal layering, epistemic status, provenance, and lifecycle management across all Ci+ environments.

**Current registry version:** `cigraf-1.0`

## Modules (`src/cigraph/`)

| Module | Responsibility |
|---|---|
| `registry.js` | Versioned canonical enums for all axes (scope, domain, class, etc.) |
| `id.js` | Opaque `ci_id` generation and validation — no semantic content encoded |
| `normalize.js` | Input normalization; raw payload is never mutated |
| `classify.js` | Multi-axis `classifyCiGraph()` function |
| `relations.js` | Relation type validation; CAUSES requires verified evidence |
| `truth.js` | Epistemic/evidence rules; confidence ≠ verification |
| `temporal.js` | Temporal layer resolution; TARGET/PREDICTED never overwrite ACTUAL |
| `conflicts.js` | Contradiction detection and CONFLICTING tagging |
| `record.js` | Canonical record envelope builder and validator |

## Canonical semantic chain

```
Signal → Claim → Entity → Relation → State → Event → Intent → Decision → Action → Result → Evidence
```

Operational graph chain:
```
Node → Relation → State → Event → Action → Evidence
```

## Classification address

Each resolved record has a mutable versioned semantic address:
```
scope / domain / class / subtype / role
```
Example: `HOME / ENERGY / ASSET / BREAKER / PROTECTION`

## Canonical record envelope

```json
{
  "ci_id": "ci_opaque_id",
  "kind": "NODE|EDGE|STATE|EVENT|ACTION|EVIDENCE",
  "scope": ["HOME"],
  "domain": ["ENERGY"],
  "class": "ASSET",
  "subtype": "BREAKER",
  "role": ["PROTECTION"],
  "temporal_layer": "ACTUAL",
  "truth_status": "OBSERVED",
  "state": "ACTIVE",
  "confidence": 0.92,
  "provenance": {},
  "relations": [],
  "evidence_refs": [],
  "classifier_version": "cigraf-1.0",
  "classification_reasons": []
}
```

## Hard invariants

1. Every unique managed real/digital unit has an **immutable opaque `ci_id`**.
2. Mutable meaning must **never** be encoded into `ci_id`.
3. Raw input is **immutable provenance**, not normalized truth.
4. No claim becomes `VERIFIED` without accepted evidence/check.
5. No external/physical action becomes `COMPLETED` without a real executor and result evidence.
6. Unknown/conflicting data remains `UNKNOWN`, `CANDIDATE`, `CONFLICTING` or `QUARANTINED`; never invent missing semantics.
7. Preserve source, timestamps, hash, transformation history and classifier version.
8. Relations are first-class graph objects with independent provenance/evidence.
9. Historical truth is **append-only**; corrections supersede prior claims.
10. Automatic classification must be **deterministic/reproducible** from input + rules + version.

## Axes

### A — Ci+ Scope
`CORE | HOME | LIFE | WORK | FIN | DATA | ACTION`

### B — Functional Domain
See `docs/ci/cigraph-registry.json` → `DOMAIN` for the complete list organized by scope.

### C — Structural Class
See `docs/ci/cigraph-registry.json` → `CLASS` for the complete list.

### D — Temporal Layer
`HIST | ACTUAL | TARGET | PREDICTED | UNKNOWN_TIME`

### E — Epistemic/Truth Status
`RAW | PARSED | CLAIMED | CANDIDATE | OBSERVED | VERIFIED | CONFLICTING | REJECTED | UNKNOWN`

### F — Provenance fields
`ingest_id, source_type, source_ref, source_actor_ci_id, received_at, source_timestamp, raw_hash, parent_claim_ids[], transform_chain[]`

### G — Relation types
`CONTAINS, PART_OF, ...` (structural), `DEPENDS_ON, CONTROLS, ...` (operational), `DESCRIBES, CAUSES, ...` (semantic/causal), `REQUESTS, AUTHORIZED_BY, ...` (action lifecycle).

> **Invariant:** `CAUSES` must never be inferred from co-occurrence alone. It requires `VERIFIED` status and explicit `evidence_refs`.

### H — Lifecycle State
`UNKNOWN | DISCOVERED | REGISTERED | ACTIVE | INACTIVE | AVAILABLE | UNAVAILABLE | DEGRADED | FAILED | BLOCKED | PENDING | PLANNED | RUNNING | VERIFYING | COMPLETED | ARCHIVED | RETIRED`

### I — Execution Class
`OBSERVE | RECOMMEND | PREPARE | EXECUTE_REVERSIBLE | EXECUTE_EXTERNAL | EXECUTE_PHYSICAL | EXECUTE_FINANCIAL | EXECUTE_SAFETY_CRITICAL`

### J — Risk/Criticality
`LOW | NORMAL | HIGH | CRITICAL`

## Compatibility

`classifySignal()` in `src/classifier.js` is preserved unchanged for backward compatibility. The new `classifyCiGraph()` in `src/cigraph/classify.js` is a separate, independent API.

## Extending the registry

- New enum values may only be **added** to `registry.js`, never renamed or removed.
- Use a `DEPRECATED_` prefix for values that become obsolete.
- Increment `CLASSIFIER_VERSION` on any breaking change to classification rules.
