'use strict';

/**
 * Ci Unified Structure Contract v1.1
 *
 * Framework-agnostic logical contract for GPTs Ci and adapters.
 * Runtime implementations must resolve ACTUAL state from authoritative
 * facts/evidence sources. This module is not a second truth store.
 */

const SCHEMA_VERSION = '1.1.0';

const STATE_PRECEDENCE = Object.freeze(['ACTUAL', 'PREDICTED', 'TARGET']);

const CANONICAL_COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'ci://component/home/activity',
    key: 'activity',
    role: 'tasks_events_routines_execution_progress',
  }),
  Object.freeze({
    id: 'ci://component/home/context',
    key: 'context',
    role: 'signals_context_current_state_transitions',
  }),
  Object.freeze({
    id: 'ci://component/home/care',
    key: 'care',
    role: 'needs_profiles_care_dependent_processes',
  }),
  Object.freeze({
    id: 'ci://component/home/calendar',
    key: 'calendar',
    role: 'time_events_planning',
  }),
  Object.freeze({
    id: 'ci://component/home/gallery',
    key: 'gallery',
    role: 'media_visual_memory',
  }),
  Object.freeze({
    id: 'ci://component/home/narrative',
    key: 'narrative',
    role: 'explanation_history_language_projection',
  }),
]);

const CORE_READ_TOOLS = Object.freeze([
  'ci_structure',
  'ci_get',
  'ci_query',
  'ci_state',
  'ci_relations',
  'ci_bindings',
  'ci_dependencies',
  'ci_capabilities',
  'ci_facts',
  'ci_history',
  'ci_diff',
  'ci_verify',
  'search',
  'fetch',
]);

const CORE_WRITE_TOOLS = Object.freeze([
  'ci_plan',
  'ci_action',
  'ci_memory_append',
]);

const FORBIDDEN_PUBLIC_EXECUTOR_TOOLS = Object.freeze([
  'shell',
  'exec',
  'ssh',
  'systemctl',
  'write_file',
  'rm',
  'sudo',
  'raw_sql',
]);

const POLICY_DECISIONS = Object.freeze(['ALLOW', 'CONFIRM', 'DENY', 'DEFER']);
const VERIFICATION_OUTCOMES = Object.freeze(['SUCCESS', 'DEVIATION', 'UNCERTAIN', 'NOT_EXECUTED']);

const INVARIANTS = Object.freeze([
  'identity_required',
  'actual_requires_provenance',
  'action_requires_policy',
  'complete_requires_verification',
  'change_requires_event',
  'fact_requires_timestamp_and_source',
  'no_duplicate_logical_truth_registry',
  'local_over_cloud_when_equivalent',
  'data_over_ui',
  'state_over_description',
  'deprecated_personified_labels_forbidden_in_active_structure',
]);

function isCiId(value) {
  return typeof value === 'string' && /^ci:\/\/[a-z0-9._-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(value);
}

function canonicalComponentByKey(key) {
  return CANONICAL_COMPONENTS.find((component) => component.key === key) || null;
}

function createStructureEnvelope({
  structureVersion,
  generatedAt,
  actualAt,
  components = [],
  entities = [],
  relations = [],
  bindings = [],
  dependencies = [],
  capabilities = [],
  facts = [],
  issues = [],
  sources = [],
} = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    structure_version: structureVersion || 'unversioned',
    generated_at: generatedAt || new Date().toISOString(),
    actual_at: actualAt || null,
    components,
    entities,
    relations,
    bindings,
    dependencies,
    capabilities,
    facts,
    issues,
    sources,
  };
}

module.exports = {
  CANONICAL_COMPONENTS,
  CORE_READ_TOOLS,
  CORE_WRITE_TOOLS,
  FORBIDDEN_PUBLIC_EXECUTOR_TOOLS,
  INVARIANTS,
  POLICY_DECISIONS,
  SCHEMA_VERSION,
  STATE_PRECEDENCE,
  VERIFICATION_OUTCOMES,
  canonicalComponentByKey,
  createStructureEnvelope,
  isCiId,
};
