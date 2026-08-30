-- Ci Graph schema migration
-- Legacy tables such as ci_nodes, ci_routing, and ci_memory are intentionally
-- preserved during this migration. This file adds the graph-native schema and
-- compatibility projections without dropping legacy structures.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE ci_data_role AS ENUM (
  'TRANSPORT_RAW','IDENTITY_MASTER','SEMANTIC_MASTER','ASSERTION',
  'EVIDENCE_RECORD','CURRENT_STATE','HISTORICAL_RECORD','TARGET_STATE',
  'PREDICTED_STATE','RELATION_MASTER','EXECUTION_CONTROL','RESULT_RECORD',
  'AUDIT_PROVENANCE','CONFLICT_RECORD','ROUTING_INDEX','SEARCH_PROJECTION','CACHE'
);

CREATE TABLE IF NOT EXISTS ci_graph_ingest (
  ingest_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_actor_ci_id TEXT NULL,
  media_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_timestamp TIMESTAMPTZ NULL,
  ingest_status TEXT NOT NULL CHECK (ingest_status IN ('RECEIVED','HASHED','QUEUED','PARSED','CLASSIFIED','RESOLVED','ROUTED','QUARANTINED','FAILED')),
  error_metadata JSONB NULL,
  classifier_version TEXT NULL
);

CREATE TABLE IF NOT EXISTS ci_graph_nodes (
  ci_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  primary_class TEXT NOT NULL,
  subtype TEXT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  owner_scope TEXT NOT NULL,
  owner_domain TEXT NOT NULL,
  semantic_address TEXT NULL,
  identity_status TEXT NOT NULL DEFAULT 'ACTIVE',
  lifecycle_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  truth_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (ci_id)
);

CREATE TABLE IF NOT EXISTS ci_graph_external_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ci_id TEXT NOT NULL REFERENCES ci_graph_nodes(ci_id) ON DELETE CASCADE,
  external_system TEXT NOT NULL,
  external_id TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ NULL,
  notes TEXT NULL,
  UNIQUE (external_system, external_id, valid_from)
);

CREATE TABLE IF NOT EXISTS ci_graph_claims (
  claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ci_id TEXT NULL,
  predicate TEXT NOT NULL,
  object_value TEXT NULL,
  object_ci_id TEXT NULL,
  temporal_layer TEXT NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  truth_status TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  confidence_basis TEXT NULL,
  source_ingest_id UUID NULL REFERENCES ci_graph_ingest(ingest_id) ON DELETE SET NULL,
  classifier_version TEXT NOT NULL,
  supersedes_claim_id UUID NULL REFERENCES ci_graph_claims(claim_id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (object_value IS NOT NULL OR object_ci_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS ci_graph_edges (
  edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_ci_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  to_ci_id TEXT NOT NULL,
  truth_status TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  temporal_layer TEXT NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  provenance_claim_id UUID NULL REFERENCES ci_graph_claims(claim_id) ON DELETE SET NULL,
  evidence_ref TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ci_graph_states (
  state_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ci_id TEXT NOT NULL,
  canonical_lifecycle_state TEXT NOT NULL,
  domain_state TEXT NULL,
  temporal_layer TEXT NOT NULL,
  value JSONB NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  truth_status TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  claim_ref UUID NULL REFERENCES ci_graph_claims(claim_id) ON DELETE SET NULL,
  evidence_ref TEXT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ci_graph_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_ci_id TEXT NULL,
  subject_ci_id TEXT NULL,
  target_ci_id TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NULL,
  valid_to TIMESTAMPTZ NULL,
  scope TEXT NOT NULL,
  domain TEXT NOT NULL,
  payload_summary JSONB NULL,
  provenance_ref TEXT NULL,
  evidence_ref TEXT NULL
);

CREATE TABLE IF NOT EXISTS ci_graph_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_type TEXT NOT NULL,
  source_ref TEXT NULL,
  storage_ref TEXT NULL,
  content_hash TEXT NULL,
  supports_claim_id UUID NULL REFERENCES ci_graph_claims(claim_id) ON DELETE SET NULL,
  refutes_claim_id UUID NULL REFERENCES ci_graph_claims(claim_id) ON DELETE SET NULL,
  supports_action_ref TEXT NULL,
  verifier_identity TEXT NULL,
  verifier_type TEXT NULL,
  verifier_version TEXT NULL,
  verification_status TEXT NOT NULL,
  verified_at TIMESTAMPTZ NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ci_graph_classification_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_id UUID NULL REFERENCES ci_graph_ingest(ingest_id) ON DELETE SET NULL,
  classifier_version TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  candidate_output JSONB NOT NULL,
  resolved_output JSONB NULL,
  unresolved_fields JSONB NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL,
  error TEXT NULL
);

CREATE TABLE IF NOT EXISTS ci_graph_conflicts (
  conflict_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  involved_record_refs JSONB NOT NULL,
  conflict_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED','ESCALATED')),
  resolution_action TEXT NULL,
  resolution_decision TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS ci_graph_routes (
  route_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_ref TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  owner_domain TEXT NOT NULL,
  consumer_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  consumer_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  execution_centers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  routing_rule_version TEXT NOT NULL,
  route_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ci_graph_ingest_content_hash ON ci_graph_ingest (content_hash);
CREATE INDEX IF NOT EXISTS idx_ci_graph_ingest_status ON ci_graph_ingest (ingest_status);
CREATE INDEX IF NOT EXISTS idx_ci_graph_nodes_owner_domain ON ci_graph_nodes (owner_domain);
CREATE INDEX IF NOT EXISTS idx_ci_graph_nodes_truth_status ON ci_graph_nodes (truth_status);
CREATE INDEX IF NOT EXISTS idx_ci_graph_nodes_ci_id ON ci_graph_nodes (ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_external_ids_ci_id ON ci_graph_external_ids (ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_claims_subject_ci_id ON ci_graph_claims (subject_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_claims_object_ci_id ON ci_graph_claims (object_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_claims_truth_status ON ci_graph_claims (truth_status);
CREATE INDEX IF NOT EXISTS idx_ci_graph_claims_active ON ci_graph_claims (is_active);
CREATE INDEX IF NOT EXISTS idx_ci_graph_edges_from_ci_id ON ci_graph_edges (from_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_edges_to_ci_id ON ci_graph_edges (to_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_edges_truth_status ON ci_graph_edges (truth_status);
CREATE INDEX IF NOT EXISTS idx_ci_graph_edges_active ON ci_graph_edges (is_active);
CREATE INDEX IF NOT EXISTS idx_ci_graph_states_ci_id ON ci_graph_states (ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_states_truth_status ON ci_graph_states (truth_status);
CREATE INDEX IF NOT EXISTS idx_ci_graph_events_occurred_at ON ci_graph_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_ci_graph_events_actor_ci_id ON ci_graph_events (actor_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_events_subject_ci_id ON ci_graph_events (subject_ci_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_evidence_content_hash ON ci_graph_evidence (content_hash);
CREATE INDEX IF NOT EXISTS idx_ci_graph_classification_runs_ingest_id ON ci_graph_classification_runs (ingest_id);
CREATE INDEX IF NOT EXISTS idx_ci_graph_routes_owner_domain ON ci_graph_routes (owner_domain);
CREATE INDEX IF NOT EXISTS idx_ci_graph_routes_source_record_ref ON ci_graph_routes (source_record_ref);

ALTER TABLE ci_graph_ingest ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_classification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_graph_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ci_graph_ingest_default_deny ON ci_graph_ingest FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_nodes_default_deny ON ci_graph_nodes FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_external_ids_default_deny ON ci_graph_external_ids FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_claims_default_deny ON ci_graph_claims FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_edges_default_deny ON ci_graph_edges FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_states_default_deny ON ci_graph_states FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_events_default_deny ON ci_graph_events FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_evidence_default_deny ON ci_graph_evidence FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_classification_runs_default_deny ON ci_graph_classification_runs FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_conflicts_default_deny ON ci_graph_conflicts FOR ALL TO public USING (false) WITH CHECK (false);
CREATE POLICY ci_graph_routes_default_deny ON ci_graph_routes FOR ALL TO public USING (false) WITH CHECK (false);

CREATE OR REPLACE VIEW v_ci_nodes_compat AS
SELECT
  ci_id,
  canonical_name AS name,
  primary_class AS class,
  subtype,
  roles,
  scopes AS scope,
  domains AS domain,
  owner_scope,
  owner_domain,
  semantic_address,
  identity_status,
  lifecycle_state AS state,
  truth_status,
  confidence,
  created_at,
  updated_at,
  retired_at,
  metadata
FROM ci_graph_nodes;

COMMENT ON VIEW v_ci_nodes_compat IS
'Compatibility projection for legacy ci_nodes consumers. Maps ci_nodes.name -> ci_graph_nodes.canonical_name, ci_nodes.class -> primary_class, and ci_nodes.scope/domain -> scopes/domains. Legacy ci_nodes must NOT be dropped in this migration; cutover should happen after downstream readers move to the new graph schema.';

COMMENT ON TABLE ci_graph_routes IS
'Canonical routing projection. Legacy ci_routing concepts should be mapped here during cutover, but ci_routing must remain in place until all readers migrate.';

COMMENT ON TABLE ci_graph_ingest IS
'Raw transport mailbox index. Legacy ci_memory records may project into ci_graph_ingest, ci_graph_events, ci_graph_claims, or ci_graph_evidence depending semantic interpretation; ci_memory must not be dropped in this migration.';
