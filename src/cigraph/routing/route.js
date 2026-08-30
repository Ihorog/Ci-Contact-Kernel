'use strict';

const { resolveOwnership } = require('./ownershipRegistry');
const { resolveConnectorOwnership } = require('./connectorRegistry');
const { resolveStorageTargets } = require('./storagePolicy');
const { resolveRequiredVerifiers } = require('./verificationPolicy');
const { DATA_ROLES } = require('../storage/dataRoles');
const { CLASS, TRUTH_STATUS } = require('../registry');

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null) return [];
  return [value];
}

function routeRecord(classifiedRecord, dataRole, options = {}) {
  const record = classifiedRecord || {};
  const routing_reasons = [];
  const ownershipResult = resolveOwnership(record);
  routing_reasons.push(...ownershipResult.reasons);

  const sourceName = options.sourceName
    || record.source_name
    || record.source_type
    || (record.provenance && (record.provenance.source_name || record.provenance.source_type))
    || null;
  const connectorResolution = resolveConnectorOwnership(sourceName, record);
  if (connectorResolution.connector) {
    routing_reasons.push(
      `Connector ${connectorResolution.connector.name} trust level ${connectorResolution.connector.trust_level} does not override semantic ownership.`
    );
  }

  let effective_data_role = dataRole;
  if (connectorResolution.connector && connectorResolution.connector.name === 'analytics' && dataRole !== DATA_ROLES.PREDICTED_STATE) {
    effective_data_role = DATA_ROLES.PREDICTED_STATE;
    routing_reasons.push('Analytics connector output is stored as PREDICTED_STATE.');
  }

  let resolved_truth_status = record.truth_status || TRUTH_STATUS.UNKNOWN;
  if (connectorResolution.connector && connectorResolution.connector.trust_level === 'enricher') {
    if (resolved_truth_status !== TRUTH_STATUS.CONFLICTING && resolved_truth_status !== TRUTH_STATUS.REJECTED) {
      resolved_truth_status = TRUTH_STATUS.CANDIDATE;
      routing_reasons.push('Enricher connector output is treated as CANDIDATE until independently verified.');
    }
  }

  let execution_centers = ownershipResult.execution_centers.slice();
  const requiresExecutor = effective_data_role === DATA_ROLES.EXECUTION_CONTROL
    || record.class === CLASS.ACTION
    || record.class === CLASS.TASK
    || record.execution_class === 'COMMAND';

  if (requiresExecutor) {
    if (Array.isArray(options.executionCenters) && options.executionCenters.length > 0) {
      execution_centers = options.executionCenters.slice();
      routing_reasons.push('Execution centers resolved from explicit options.executionCenters.');
    } else if (record.executor_ci_id) {
      execution_centers = execution_centers.length > 0 ? execution_centers : ['local_node'];
      routing_reasons.push(`Executor ${record.executor_ci_id} available for execution routing.`);
    } else {
      execution_centers = [];
      routing_reasons.push('Execution-capable record has no executor identity; routing is blocked.');
    }
  }

  const storage_targets = resolveStorageTargets(ownershipResult, effective_data_role);
  if (storage_targets.length > 0) {
    routing_reasons.push(`Storage targets resolved: ${storage_targets.join(', ')}.`);
  }

  const required_permissions = ownershipResult.required_permissions.slice();
  const required_verifiers = resolveRequiredVerifiers(
    ownershipResult,
    effective_data_role,
    ownershipResult.sensitivity_class
  );

  const blocked = requiresExecutor && execution_centers.length === 0;
  const result = {
    canonical_owner_scope: ownershipResult.canonical_owner_scope,
    canonical_owner_domain: ownershipResult.canonical_owner_domain,
    consumer_scopes: ownershipResult.consumer_scopes.slice(),
    consumer_domains: ownershipResult.consumer_domains.slice(),
    storage_targets,
    execution_centers,
    required_permissions,
    required_verifiers,
    retention_class: ownershipResult.retention_class,
    sensitivity_class: ownershipResult.sensitivity_class,
    routing_rule_version: ownershipResult.routing_rule_version,
    routing_reasons,
    ambiguous: ownershipResult.ambiguous,
    needs_quarantine: ownershipResult.needs_quarantine,
    resolved_truth_status,
    effective_data_role,
    source_connector: connectorResolution.connector ? connectorResolution.connector.name : null,
    blocked,
    blocking_reason: blocked ? 'No execution center available for execution-capable record.' : null
  };

  if (result.routing_reasons.length === 0) {
    result.routing_reasons.push('Record routed with default fallbacks.');
  }

  const scopeValues = asArray(record.scope);
  const domainValues = asArray(record.domain);
  if (scopeValues.length > 1 || domainValues.length > 1) {
    result.routing_reasons.push('Multiple scope/domain candidates were supplied; ownership resolution used highest-priority rule.');
  }

  return result;
}

module.exports = { routeRecord };
