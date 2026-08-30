'use strict';

const { SCOPE, DOMAIN, CLASS, TEMPORAL_LAYER, TRUTH_STATUS } = require('../registry');

const RULE_VERSION = '2024-01-01';

const OWNERSHIP_RULES = Object.freeze([
  {
    primary_class: '*',
    scope_hint: SCOPE.HOME,
    domain_hint: DOMAIN.ENERGY,
    canonical_owner_scope: SCOPE.HOME,
    canonical_owner_domain: DOMAIN.ENERGY,
    consumer_scopes: [SCOPE.DATA, SCOPE.ACTION],
    consumer_domains: [DOMAIN.FILES, DOMAIN.TASKS, DOMAIN.EVENTS],
    storage_targets: ['supabase', 'local_kv'],
    execution_centers: ['local_node'],
    required_permissions: ['device:read'],
    required_verifiers: ['sensor_attestation'],
    retention_class: 'LONG_LIVED',
    sensitivity_class: 'INTERNAL',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.WORK,
    domain_hint: DOMAIN.SOURCE_CONTROL,
    canonical_owner_scope: SCOPE.WORK,
    canonical_owner_domain: DOMAIN.SOURCE_CONTROL,
    consumer_scopes: [SCOPE.DATA, SCOPE.ACTION],
    consumer_domains: [DOMAIN.FILES, DOMAIN.PROJECTS, DOMAIN.TASKS],
    storage_targets: ['supabase', 'cloudflare_kv'],
    execution_centers: ['github'],
    required_permissions: ['repo:read'],
    required_verifiers: ['repo_signature'],
    retention_class: 'AUDIT_LONG',
    sensitivity_class: 'INTERNAL',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.FIN,
    domain_hint: DOMAIN.PAYMENTS,
    canonical_owner_scope: SCOPE.FIN,
    canonical_owner_domain: DOMAIN.PAYMENTS,
    consumer_scopes: [SCOPE.ACTION, SCOPE.DATA],
    consumer_domains: [DOMAIN.TASKS, DOMAIN.RESULTS, DOMAIN.DOCUMENTS],
    storage_targets: ['supabase'],
    execution_centers: ['local_node'],
    required_permissions: ['financial:read'],
    required_verifiers: ['ledger_reconciliation'],
    retention_class: 'REGULATED',
    sensitivity_class: 'HIGH',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.HOME,
    domain_hint: DOMAIN.NETWORK_COMPUTE,
    canonical_owner_scope: SCOPE.HOME,
    canonical_owner_domain: DOMAIN.NETWORK_COMPUTE,
    consumer_scopes: [SCOPE.ACTION, SCOPE.DATA],
    consumer_domains: [DOMAIN.OPERATIONS, DOMAIN.FILES],
    storage_targets: ['supabase', 'cloudflare_kv'],
    execution_centers: ['cloudflare', 'local_node'],
    required_permissions: ['network:admin'],
    required_verifiers: ['network_attestation'],
    retention_class: 'LONG_LIVED',
    sensitivity_class: 'HIGH',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.WORK,
    domain_hint: DOMAIN.OPERATIONS,
    canonical_owner_scope: SCOPE.WORK,
    canonical_owner_domain: DOMAIN.OPERATIONS,
    consumer_scopes: [SCOPE.ACTION, SCOPE.DATA],
    consumer_domains: [DOMAIN.EXECUTION, DOMAIN.FILES],
    storage_targets: ['supabase', 'cloudflare_kv'],
    execution_centers: ['cloudflare', 'github'],
    required_permissions: ['ops:read'],
    required_verifiers: ['runtime_health'],
    retention_class: 'AUDIT_LONG',
    sensitivity_class: 'HIGH',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.HOME,
    domain_hint: DOMAIN.ASSET_REGISTRY,
    canonical_owner_scope: SCOPE.HOME,
    canonical_owner_domain: DOMAIN.ASSET_REGISTRY,
    consumer_scopes: [SCOPE.DATA, SCOPE.ACTION],
    consumer_domains: [DOMAIN.MEMORY, DOMAIN.TASKS],
    storage_targets: ['supabase', 'local_kv'],
    execution_centers: ['supabase', 'local_node'],
    required_permissions: ['asset:read'],
    required_verifiers: ['row_origin_check'],
    retention_class: 'LONG_LIVED',
    sensitivity_class: 'INTERNAL',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: CLASS.ACTION,
    scope_hint: SCOPE.ACTION,
    domain_hint: DOMAIN.TASKS,
    canonical_owner_scope: SCOPE.ACTION,
    canonical_owner_domain: DOMAIN.TASKS,
    consumer_scopes: [SCOPE.WORK, SCOPE.HOME, SCOPE.FIN],
    consumer_domains: [DOMAIN.EXECUTION, DOMAIN.RESULTS, DOMAIN.NOTIFICATIONS],
    storage_targets: ['supabase', 'local_kv'],
    execution_centers: [],
    required_permissions: ['task:dispatch'],
    required_verifiers: ['execution_receipt'],
    retention_class: 'WORKING_SET',
    sensitivity_class: 'HIGH',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: CLASS.TASK,
    scope_hint: SCOPE.ACTION,
    domain_hint: DOMAIN.TASKS,
    canonical_owner_scope: SCOPE.ACTION,
    canonical_owner_domain: DOMAIN.TASKS,
    consumer_scopes: [SCOPE.WORK, SCOPE.HOME, SCOPE.FIN],
    consumer_domains: [DOMAIN.EXECUTION, DOMAIN.RESULTS, DOMAIN.NOTIFICATIONS],
    storage_targets: ['supabase', 'local_kv'],
    execution_centers: [],
    required_permissions: ['task:dispatch'],
    required_verifiers: ['execution_receipt'],
    retention_class: 'WORKING_SET',
    sensitivity_class: 'HIGH',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.DATA,
    domain_hint: DOMAIN.FILES,
    canonical_owner_scope: SCOPE.DATA,
    canonical_owner_domain: DOMAIN.FILES,
    consumer_scopes: [SCOPE.WORK, SCOPE.ACTION],
    consumer_domains: [DOMAIN.SOURCE_CONTROL, DOMAIN.TASKS, DOMAIN.KNOWLEDGE],
    storage_targets: ['supabase', 'cloudflare_kv'],
    execution_centers: [],
    required_permissions: ['file:read'],
    required_verifiers: ['content_hash_match'],
    retention_class: 'ARCHIVAL',
    sensitivity_class: 'INTERNAL',
    routing_rule_version: RULE_VERSION
  },
  {
    primary_class: '*',
    scope_hint: SCOPE.CORE,
    domain_hint: DOMAIN.IDENTITY_ACCESS,
    canonical_owner_scope: SCOPE.CORE,
    canonical_owner_domain: DOMAIN.IDENTITY_ACCESS,
    consumer_scopes: [SCOPE.WORK, SCOPE.HOME, SCOPE.ACTION],
    consumer_domains: [DOMAIN.SOURCE_CONTROL, DOMAIN.NETWORK_COMPUTE, DOMAIN.EXECUTION],
    storage_targets: ['supabase'],
    execution_centers: ['supabase'],
    required_permissions: ['identity:admin'],
    required_verifiers: ['credential_proof'],
    retention_class: 'SECURITY_AUDIT',
    sensitivity_class: 'CRITICAL',
    routing_rule_version: RULE_VERSION
  }
]);

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value == null) return [];
  return [value];
}

function normalizeRecord(classifiedRecord = {}) {
  return {
    classes: asArray(classifiedRecord.primary_class || classifiedRecord.class),
    scopes: asArray(classifiedRecord.scope || classifiedRecord.scopes),
    domains: asArray(classifiedRecord.domain || classifiedRecord.domains),
    temporalLayer: classifiedRecord.temporal_layer || TEMPORAL_LAYER.UNKNOWN_TIME,
    truthStatus: classifiedRecord.truth_status || TRUTH_STATUS.UNKNOWN
  };
}

function scoreRule(rule, normalized) {
  let score = 0;
  const reasons = [];

  if (rule.primary_class === '*' || normalized.classes.includes(rule.primary_class)) {
    if (rule.primary_class !== '*') {
      score += 1;
      reasons.push(`class matched ${rule.primary_class}`);
    }
  } else {
    return null;
  }

  if (rule.scope_hint && normalized.scopes.includes(rule.scope_hint)) {
    score += 3;
    reasons.push(`scope matched ${rule.scope_hint}`);
  } else {
    return null;
  }

  if (rule.domain_hint && normalized.domains.includes(rule.domain_hint)) {
    score += 5;
    reasons.push(`domain matched ${rule.domain_hint}`);
  } else {
    return null;
  }

  return { score, reasons };
}

function buildAmbiguousResponse(reason, matches) {
  return {
    canonical_owner_scope: null,
    canonical_owner_domain: null,
    consumer_scopes: [],
    consumer_domains: [],
    storage_targets: [],
    execution_centers: [],
    required_permissions: [],
    required_verifiers: [],
    retention_class: 'QUARANTINE',
    sensitivity_class: 'UNKNOWN',
    routing_rule_version: RULE_VERSION,
    matched_rules: matches,
    ambiguous: true,
    needs_quarantine: true,
    reasons: [reason]
  };
}

function resolveOwnership(classifiedRecord = {}) {
  const normalized = normalizeRecord(classifiedRecord);
  const matches = [];

  for (const rule of OWNERSHIP_RULES) {
    const scored = scoreRule(rule, normalized);
    if (!scored) continue;
    matches.push({ rule, score: scored.score, reasons: scored.reasons });
  }

  if (matches.length === 0) {
    return buildAmbiguousResponse('No ownership rule matched the classified record.', []);
  }

  matches.sort((a, b) => b.score - a.score);
  const topScore = matches[0].score;
  const topMatches = matches.filter((match) => match.score === topScore);
  if (topMatches.length !== 1) {
    return buildAmbiguousResponse('Multiple ownership rules matched with the same priority.', topMatches.map((match) => match.rule));
  }

  const selected = topMatches[0];
  return {
    canonical_owner_scope: selected.rule.canonical_owner_scope,
    canonical_owner_domain: selected.rule.canonical_owner_domain,
    consumer_scopes: selected.rule.consumer_scopes.slice(),
    consumer_domains: selected.rule.consumer_domains.slice(),
    storage_targets: selected.rule.storage_targets.slice(),
    execution_centers: selected.rule.execution_centers.slice(),
    required_permissions: selected.rule.required_permissions.slice(),
    required_verifiers: selected.rule.required_verifiers.slice(),
    retention_class: selected.rule.retention_class,
    sensitivity_class: selected.rule.sensitivity_class,
    routing_rule_version: selected.rule.routing_rule_version,
    matched_rules: [selected.rule],
    ambiguous: false,
    needs_quarantine: false,
    reasons: selected.reasons
  };
}

module.exports = { OWNERSHIP_RULES, resolveOwnership, RULE_VERSION };
