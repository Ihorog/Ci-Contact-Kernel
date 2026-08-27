'use strict';

/**
 * Ci Graph — multi-axis canonical classifier.
 *
 * Exposes: classifyCiGraph(input, context) -> { canonicalRecord, candidates, unresolved, reasons }
 *
 * Classification rules (from spec):
 *  - Explicit valid fields beat heuristics.
 *  - Rules may produce multiple candidate domains/scopes with scores.
 *  - Structural class must be one primary class.
 *  - Ambiguous subtype/role remains null/unknown.
 *  - Resolver must output classification_reasons[] and evidence/source features used.
 *  - Never mutate original payload.
 *  - Never discard unknown fields; retain them under raw/provenance.
 *  - Automatic classification must be deterministic/reproducible from input + rules + version.
 */

const {
  CLASSIFIER_VERSION,
  SCOPE, DOMAIN, CLASS, TEMPORAL_LAYER, TRUTH_STATUS,
  LIFECYCLE_STATE, KIND, SCOPE_DOMAINS,
} = require('./registry');
const { generateCiId } = require('./id');
const { normalizeInput, normalizeProvenance } = require('./normalize');
const { resolveTemporalLayer, extractTemporalFields } = require('./temporal');
const { resolveTruthStatus } = require('./truth');
const { buildRecord } = require('./record');

// ── Scope heuristics ─────────────────────────────────────────────────────────

const SCOPE_HINTS = [
  { scope: SCOPE.HOME,   hints: ['energy', 'breaker', 'heating', 'water', 'house', 'home', 'room', 'device', 'sensor', 'climate', 'hvac', 'appliance'] },
  { scope: SCOPE.WORK,   hints: ['repo', 'repository', 'commit', 'branch', 'deploy', 'ci', 'cd', 'project', 'sprint', 'ticket', 'pr', 'pull request', 'pipeline'] },
  { scope: SCOPE.DATA,   hints: ['file', 'document', 'media', 'dataset', 'archive', 'backup', 'knowledge', 'memory'] },
  { scope: SCOPE.ACTION, hints: ['task', 'event', 'signal', 'automation', 'schedule', 'notification', 'execution', 'result'] },
  { scope: SCOPE.FIN,    hints: ['payment', 'invoice', 'budget', 'account', 'subscription', 'purchase', 'valuation', 'financial'] },
  { scope: SCOPE.LIFE,   hints: ['person', 'family', 'health', 'food', 'travel', 'routine', 'learning', 'wellbeing', 'communication'] },
  { scope: SCOPE.CORE,   hints: ['identity', 'permission', 'policy', 'orchestration', 'verification', 'security', 'observability'] },
];

// ── Domain heuristics ─────────────────────────────────────────────────────────

const DOMAIN_HINTS = [
  { domain: DOMAIN.ENERGY,        hints: ['energy', 'breaker', 'power', 'electricity', 'solar', 'battery'] },
  { domain: DOMAIN.SOURCE_CONTROL, hints: ['repo', 'repository', 'commit', 'branch', 'pull request', 'pr', 'git'] },
  { domain: DOMAIN.DOCUMENTS,     hints: ['document', 'doc', 'pdf', 'report', 'contract'] },
  { domain: DOMAIN.FILES,         hints: ['file', 'path', 'directory', 'folder', 'upload'] },
  { domain: DOMAIN.TASKS,         hints: ['task', 'todo', 'action item', 'checklist'] },
  { domain: DOMAIN.SIGNALS,       hints: ['signal', 'message', 'event signal'] },
  { domain: DOMAIN.EVENTS,        hints: ['event', 'log entry', 'occurrence'] },
  { domain: DOMAIN.IDENTITY_ACCESS, hints: ['identity', 'user', 'access', 'permission', 'auth', 'credential'] },
  { domain: DOMAIN.DEPLOYMENT,    hints: ['deploy', 'release', 'pipeline', 'ci/cd'] },
  { domain: DOMAIN.KNOWLEDGE,     hints: ['knowledge', 'fact', 'truth', 'concept'] },
  { domain: DOMAIN.MEMORY,        hints: ['memory', 'remember', 'recall', 'note'] },
  { domain: DOMAIN.PROJECTS,      hints: ['project', 'sprint', 'milestone', 'backlog'] },
  { domain: DOMAIN.NETWORK_COMPUTE, hints: ['network', 'server', 'compute', 'dns', 'ip', 'router', 'switch'] },
  { domain: DOMAIN.SAFETY_SECURITY, hints: ['safety', 'alarm', 'camera', 'lock', 'intrusion'] },
  { domain: DOMAIN.PAYMENTS,      hints: ['payment', 'invoice', 'transaction', 'wire'] },
  { domain: DOMAIN.BUDGET,        hints: ['budget', 'expense', 'cost', 'spend'] },
  { domain: DOMAIN.WELLBEING,     hints: ['health', 'wellbeing', 'fitness', 'sleep', 'medication'] },
  { domain: DOMAIN.PEOPLE_RELATIONS, hints: ['person', 'contact', 'friend', 'colleague', 'relation'] },
  { domain: DOMAIN.AUTOMATION,    hints: ['automation', 'workflow', 'trigger', 'rule'] },
  { domain: DOMAIN.SCHEDULING,    hints: ['schedule', 'calendar', 'appointment', 'reminder'] },
];

// ── Class heuristics ──────────────────────────────────────────────────────────

const CLASS_HINTS = [
  { cls: CLASS.ASSET,      hints: ['breaker', 'appliance', 'hardware asset', 'equipment'] },
  { cls: CLASS.DEVICE,     hints: ['device', 'sensor', 'iot', 'smart home', 'thermostat', 'raspberry', 'arduino'] },
  { cls: CLASS.REPOSITORY, hints: ['repo', 'repository', 'git', 'github', 'gitlab', 'codebase'] },
  { cls: CLASS.DOCUMENT,   hints: ['document', 'doc', 'pdf', 'report', 'contract', 'invoice'] },
  { cls: CLASS.FILE,       hints: ['file', 'path', 'upload', 'attachment'] },
  { cls: CLASS.TASK,       hints: ['task', 'todo', 'action item', 'checklist item'] },
  { cls: CLASS.EVENT,      hints: ['event', 'occurrence', 'log entry'] },
  { cls: CLASS.SIGNAL,     hints: ['signal', 'message', 'ping', 'notification signal'] },
  { cls: CLASS.ACTOR,      hints: ['person', 'user', 'actor', 'agent', 'human', 'bot'] },
  { cls: CLASS.ACCOUNT,    hints: ['account', 'login', 'profile', 'credential'] },
  { cls: CLASS.SERVICE,    hints: ['service', 'api', 'microservice', 'endpoint'] },
  { cls: CLASS.PROCESS,    hints: ['process', 'pipeline', 'workflow'] },
  { cls: CLASS.POLICY,     hints: ['policy', 'rule', 'regulation', 'governance'] },
  { cls: CLASS.RESULT,     hints: ['result', 'output', 'response'] },
  { cls: CLASS.EVIDENCE,   hints: ['evidence', 'proof', 'attestation', 'check result'] },
  { cls: CLASS.INTENT,     hints: ['intent', 'want', 'wish', 'desire', 'goal'] },
  { cls: CLASS.DECISION,   hints: ['decision', 'choice', 'approve', 'reject'] },
  { cls: CLASS.KNOWLEDGE_ITEM, hints: ['fact', 'knowledge', 'truth', 'concept', 'definition'] },
  { cls: CLASS.MEMORY_ITEM, hints: ['memory', 'remember', 'recall'] },
  { cls: CLASS.METRIC,     hints: ['metric', 'measurement', 'kpi', 'gauge'] },
  { cls: CLASS.ALERT,      hints: ['alert', 'alarm', 'warning', 'notification'] },
  { cls: CLASS.ACTION,     hints: ['action', 'execute', 'run', 'perform', 'deploy'] },
  { cls: CLASS.AUTOMATION, hints: ['automation', 'trigger', 'automated'] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function textFrom(input) {
  if (typeof input === 'string') return input.toLowerCase();
  return JSON.stringify(input || {}).toLowerCase();
}

/**
 * Score a list of heuristic rules against a text blob.
 * Returns array of { value, score } sorted descending.
 */
function scoreHints(hintRules, text) {
  const scores = [];
  for (const { hints, ...rest } of hintRules) {
    const value = rest.scope || rest.domain || rest.cls;
    let score = 0;
    for (const hint of hints) {
      // Use word-boundary regex to avoid false partial matches (e.g. 'repo' inside 'report')
      const pattern = new RegExp(`(?<![a-z])${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'i');
      if (pattern.test(text)) score += 1;
    }
    if (score > 0) scores.push({ value, score });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

/**
 * Resolve an explicit array/string value against a valid set.
 * Returns { resolved: string[], reasons: string[] }
 */
function resolveExplicit(raw, validSet, label) {
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const resolved = [];
  const reasons = [];
  for (const v of values) {
    const up = typeof v === 'string' ? v.toUpperCase() : v;
    if (validSet.has(up)) {
      resolved.push(up);
      reasons.push(`explicit ${label}: ${up}`);
    }
  }
  return { resolved, reasons };
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify input according to the full Ci Graph multi-axis taxonomy.
 *
 * @param {*} input  Raw intake payload (any shape)
 * @param {object} [context]  Optional context for provenance/overrides
 * @returns {{
 *   canonicalRecord: object,
 *   candidates: object[],
 *   unresolved: string[],
 *   reasons: string[]
 * }}
 */
function classifyCiGraph(input, context = {}) {
  const reasons = [];
  const unresolved = [];
  const candidates = [];

  // 1. Normalize input — never mutate original
  const normalized = normalizeInput(input);
  const text = textFrom(input);

  // 2. ci_id — reuse existing or generate new opaque id
  let ciId = normalized.ci_id || context.ci_id || null;
  if (!ciId) {
    ciId = generateCiId();
    reasons.push('ci_id: generated new opaque id');
  } else {
    reasons.push(`ci_id: reused from input: ${ciId}`);
  }

  // 3. kind
  const kindValues = new Set(Object.values(KIND));
  let kind = KIND.NODE;
  if (normalized.kind && kindValues.has(normalized.kind.toUpperCase())) {
    kind = normalized.kind.toUpperCase();
    reasons.push(`kind: explicit: ${kind}`);
  }

  // 4. scope — explicit beats heuristics
  const VALID_SCOPES = new Set(Object.values(SCOPE));
  let resolvedScopes = [];
  if (normalized.scope) {
    const { resolved, reasons: r } = resolveExplicit(normalized.scope, VALID_SCOPES, 'scope');
    resolvedScopes = resolved;
    reasons.push(...r);
  }
  if (resolvedScopes.length === 0) {
    const scored = scoreHints(SCOPE_HINTS, text);
    if (scored.length > 0) {
      resolvedScopes = [scored[0].value];
      reasons.push(`scope: heuristic match: ${scored[0].value} (score=${scored[0].score})`);
      for (const s of scored.slice(1)) {
        candidates.push({ axis: 'scope', value: s.value, score: s.score });
      }
    } else {
      unresolved.push('scope');
    }
  }

  // 5. domain — explicit beats heuristics; validate against scope
  const VALID_DOMAINS = new Set(Object.values(DOMAIN));
  let resolvedDomains = [];
  if (normalized.domain) {
    const { resolved, reasons: r } = resolveExplicit(normalized.domain, VALID_DOMAINS, 'domain');
    resolvedDomains = resolved;
    reasons.push(...r);
  }
  if (resolvedDomains.length === 0) {
    const scored = scoreHints(DOMAIN_HINTS, text);
    if (scored.length > 0) {
      resolvedDomains = [scored[0].value];
      reasons.push(`domain: heuristic match: ${scored[0].value} (score=${scored[0].score})`);
      for (const s of scored.slice(1)) {
        candidates.push({ axis: 'domain', value: s.value, score: s.score });
      }
    } else {
      unresolved.push('domain');
    }
  }

  // 6. class — must resolve to exactly one primary class
  const VALID_CLASSES = new Set(Object.values(CLASS));
  let resolvedClass = null;
  if (normalized.class) {
    const up = normalized.class.toUpperCase();
    if (VALID_CLASSES.has(up)) {
      resolvedClass = up;
      reasons.push(`class: explicit: ${resolvedClass}`);
    }
  }
  if (!resolvedClass) {
    const scored = scoreHints(CLASS_HINTS.map(h => ({ ...h, scope: undefined, domain: undefined })), text);
    if (scored.length > 0) {
      resolvedClass = scored[0].value;
      reasons.push(`class: heuristic match: ${resolvedClass} (score=${scored[0].score})`);
    } else {
      resolvedClass = CLASS.UNKNOWN_CLASS;
      unresolved.push('class');
      reasons.push('class: unresolved → UNKNOWN_CLASS');
    }
  }

  // 7. subtype / role — ambiguous remains null
  const subtype = normalized.subtype || null;
  const role = normalized.role ? (Array.isArray(normalized.role) ? normalized.role : [normalized.role]) : [];
  if (subtype) reasons.push(`subtype: explicit: ${subtype}`);
  if (role.length > 0) reasons.push(`role: explicit: ${role.join(',')}`);

  // 8. temporal layer
  const temporalLayer = resolveTemporalLayer(normalized.temporal_layer || context.temporal_layer);
  if (temporalLayer === TEMPORAL_LAYER.UNKNOWN_TIME) {
    if (normalized.temporal_layer) unresolved.push('temporal_layer');
    reasons.push(`temporal_layer: ${temporalLayer}`);
  } else {
    reasons.push(`temporal_layer: ${temporalLayer}`);
  }
  const temporalFields = extractTemporalFields(normalized);

  // 9. truth status
  const truthStatus = resolveTruthStatus(
    normalized.truth_status || context.truth_status,
    { confidence: normalized.confidence, evidence_refs: normalized.evidence_refs }
  );
  reasons.push(`truth_status: ${truthStatus}`);

  // 10. lifecycle state
  const VALID_STATES = new Set(Object.values(LIFECYCLE_STATE));
  let state = LIFECYCLE_STATE.UNKNOWN;
  if (normalized.state) {
    const up = normalized.state.toUpperCase();
    if (VALID_STATES.has(up)) {
      state = up;
      reasons.push(`state: explicit: ${state}`);
    }
  }

  // 11. confidence
  let confidence = null;
  if (typeof normalized.confidence === 'number') {
    confidence = Math.max(0, Math.min(1, normalized.confidence));
    reasons.push(`confidence: ${confidence}`);
  }

  // 12. provenance
  const provenance = normalizeProvenance(normalized, context);

  // 13. Build canonical record
  const canonicalRecord = buildRecord({
    ci_id: ciId,
    kind,
    scope: resolvedScopes,
    domain: resolvedDomains,
    class: resolvedClass,
    subtype,
    role,
    temporal_layer: temporalLayer,
    truth_status: truthStatus,
    state,
    confidence,
    confidence_basis: normalized.confidence_basis || null,
    verification_status: normalized.verification_status || null,
    provenance,
    relations: Array.isArray(normalized.relations) ? normalized.relations : [],
    evidence_refs: Array.isArray(normalized.evidence_refs) ? normalized.evidence_refs : [],
    classifier_version: CLASSIFIER_VERSION,
    ...temporalFields,
    execution_class: normalized.execution_class || null,
    executor_ci_id: normalized.executor_ci_id || null,
    criticality: normalized.criticality || null,
  });

  // 14. Attach classification reasons to the record
  canonicalRecord.classification_reasons = [...reasons];

  return { canonicalRecord, candidates, unresolved, reasons };
}

module.exports = { classifyCiGraph };
