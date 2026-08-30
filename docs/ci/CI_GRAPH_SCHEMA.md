# Ci Graph schema

## Purpose

The Ci Graph schema separates transport, identity, assertions, evidence, routing, and audit history so semantic ownership can be traced without collapsing contradictory facts.

## Tables

- `ci_graph_ingest`: raw mailbox index for inbound source material.
- `ci_graph_nodes`: canonical node registry with owner scope/domain, lifecycle, truth, and metadata.
- `ci_graph_external_ids`: external-system identity bindings over time.
- `ci_graph_claims`: atomic assertions about nodes or literal values.
- `ci_graph_edges`: typed graph relations between canonical nodes.
- `ci_graph_states`: append-only lifecycle or domain state history.
- `ci_graph_events`: canonical event timeline.
- `ci_graph_evidence`: verification and attestation metadata.
- `ci_graph_classification_runs`: deterministic audit log for classification inputs/outputs.
- `ci_graph_conflicts`: unresolved contradictory records preserved for review.
- `ci_graph_routes`: resolved owner/consumer routing projection.

## Data roles

The SQL enum and JS registry share the same roles:

- `TRANSPORT_RAW`
- `IDENTITY_MASTER`
- `SEMANTIC_MASTER`
- `ASSERTION`
- `EVIDENCE_RECORD`
- `CURRENT_STATE`
- `HISTORICAL_RECORD`
- `TARGET_STATE`
- `PREDICTED_STATE`
- `RELATION_MASTER`
- `EXECUTION_CONTROL`
- `RESULT_RECORD`
- `AUDIT_PROVENANCE`
- `CONFLICT_RECORD`
- `ROUTING_INDEX`
- `SEARCH_PROJECTION`
- `CACHE`

## Ownership model

Ownership is resolved per semantic record, not per connector. Connectors such as GitHub, Supabase, Cloudflare, and analytics may transport or enrich data, but canonical ownership stays with the scope/domain selected by routing rules. Consumer scopes and consumer domains are tracked separately in `ci_graph_routes` so downstream projections can subscribe without claiming semantic authority.

## Security and provenance

All graph tables enable row-level security with default-deny policies. Service-role access is expected for trusted server-side writers. Provenance is preserved through ingest rows, classification runs, evidence, and append-oriented state/event history.

## Legacy mapping notes

- `ci_nodes` is not dropped. `v_ci_nodes_compat` projects `ci_graph_nodes` into a legacy-friendly shape (`canonical_name -> name`, `primary_class -> class`, `scopes/domains -> scope/domain`).
- `ci_routing` should migrate toward `ci_graph_routes`, which adds consumer lists, execution centers, and routing rule versioning.
- `ci_memory` should remain available during cutover. Depending on the record, legacy memory rows may map into `ci_graph_ingest`, `ci_graph_claims`, `ci_graph_events`, or `ci_graph_evidence` rather than a single replacement table.
