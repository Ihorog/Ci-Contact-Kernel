'use strict';

const { TEMPORAL_LAYER } = require('./cigraph/registry');

function evaluateMemoryTrigger(signal = {}, task = {}) {
  const context = { ...task, ...signal };
  if (context.unresolvedEntity) {
    return { shouldTraverse: true, reason: 'unresolvedEntity', traversalHints: { lookupBy: 'ci_id' } };
  }
  if (context.conflictingClaim) {
    return { shouldTraverse: true, reason: 'conflictingClaim', traversalHints: { includeConflicts: true } };
  }
  if (context.needsHistoricalEvidence) {
    return { shouldTraverse: true, reason: 'needsHistoricalEvidence', traversalHints: { temporalLayer: TEMPORAL_LAYER.HIST } };
  }
  if (context.retryFromCheckpoint) {
    return { shouldTraverse: true, reason: 'retryFromCheckpoint', traversalHints: { resume: true } };
  }
  return { shouldTraverse: false, reason: 'no-explicit-trigger', traversalHints: {} };
}

function rankTemporalLayer(layer) {
  if (layer === TEMPORAL_LAYER.ACTUAL) return 3;
  if (layer === TEMPORAL_LAYER.HIST) return 2;
  if (layer === TEMPORAL_LAYER.PREDICTED || layer === TEMPORAL_LAYER.TARGET) return 1;
  return 0;
}

function groupKey(record) {
  return [
    record.ci_id || record.subject_ci_id || record.from_ci_id || 'unknown',
    record.predicate || record.relation_type || record.state || record.domain_state || 'record'
  ].join('|');
}

function applyConflictPolicy(records) {
  const preserved = (records || []).slice().sort((a, b) => rankTemporalLayer(b.temporal_layer) - rankTemporalLayer(a.temporal_layer));
  const grouped = new Map();

  for (const record of preserved) {
    const key = groupKey(record);
    const list = grouped.get(key) || [];
    list.push(record);
    grouped.set(key, list);
  }

  const conflicts = [];
  for (const list of grouped.values()) {
    const distinctValues = new Set(list.map((record) => JSON.stringify({
      object_ci_id: record.object_ci_id || null,
      object_value: record.object_value || null,
      value: record.value || null,
      state: record.state || null,
      truth_status: record.truth_status || null,
      temporal_layer: record.temporal_layer || null
    })));
    if (distinctValues.size > 1) conflicts.push(list.slice());
  }

  return { records: preserved, conflicts };
}

module.exports = { evaluateMemoryTrigger, applyConflictPolicy };
