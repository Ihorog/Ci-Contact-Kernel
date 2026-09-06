# Domivka Graph Core — STI v2.0 to ci_graph_* mapping

Maps STI v2.0 onto existing Ci-Contact-Kernel schema. No second graph.

Authoritative in-repo:
- src/cigraph/id.js
- src/cigraph/registry.js
- supabase/migrations/20240101000000_ci_graph_schema.sql
- docs/ci/CI_GRAPH_SCHEMA.md

## Chain of meaning

STI: Node -> Relation -> State -> Event -> Action -> Evidence

| STI | Table |
|-----|-------|
| Node | ci_graph_nodes |
| Relation | ci_graph_edges |
| Claim | ci_graph_claims |
| State | ci_graph_states |
| Event | ci_graph_events |
| Evidence | ci_graph_evidence |
| Ingest | ci_graph_ingest |
## Was / is / will-be -> TEMPORAL_LAYER

| STI axis | TEMPORAL_LAYER |
|----------|----------------|
| was | HIST |
| is | ACTUAL |
| will-be | TARGET |
| forecast | PREDICTED |
| unknown | UNKNOWN_TIME |

Do not collapse TARGET into ACTUAL. Do not rewrite HIST as ACTUAL.
Phase 1 seed uses ACTUAL.

## Truth statuses

| TRUTH_STATUS | Meaning |
|--------------|---------|
| OBSERVED | Seen in situ (devices) |
| VERIFIED | Document-backed (unit/rooms) |
| CONFLICTING | Open conflict |
| REJECTED | Discarded |
| UNKNOWN | Default |

confidence is real in [0,1]. Seed: 0.95 VERIFIED, 0.70 OBSERVED.
## Ownership

- owner_scope / scopes: HOME
- spaces: HOUSING_SPACE
- panels: ENERGY
- meters/boiler: WATER
- Keenetic / Orange Pi: NETWORK_COMPUTE
- USB storage: STORAGE_BACKUP
- primary_class: SPACE or DEVICE
- subtype: English snake (unit, room, electrical_panel, ...)
- canonical_name: human label; Ukrainian allowed

## Relations in Phase 1 seed

- CONTAINS / PART_OF — space hierarchy
- LOCATED_IN — device in space (bath for meters/boiler)
- MOUNTED_ON — USB on Keenetic

## Forbidden practices

1. No parallel schema (no spaces/nodes/relations tables).
2. No secrets in graph columns.
3. No in-place history rewrite; supersede via new claim/event.
4. No Ci-ID mutation.
5. No treating OBSERVED as VERIFIED.
6. No encoding meaning into Ci-ID.
7. No rewriting 20240101000000_ci_graph_schema.sql.
8. No fake execute from Graph Core alone.

## Corrections model

POST /ci/graph/events is append-only. Corrections insert a new event
(optional supersedes_event_id) and preferably a superseding claim.
Do not UPDATE historical event bodies.

## Phase 1 boundary

In: space+device identity, structural edges, evidence pointer, homeSeed, sketch API.
Out: Action Bridge execution, vault secrets, circuit tracing, real serial export.
