'use strict';

/**
 * Ci Graph — canonical record envelope validation and building.
 *
 * Every canonical record must conform to the logical envelope defined in the spec.
 * Storage may normalize the structure; this module enforces the API contract.
 */

const {
  KIND, SCOPE, DOMAIN, CLASS, TEMPORAL_LAYER, TRUTH_STATUS,
  LIFECYCLE_STATE, CLASSIFIER_VERSION,
} = require('./registry');
const { isValidCiId } = require('./id');

const VALID_KINDS = new Set(Object.values(KIND));
const VALID_SCOPES = new Set(Object.values(SCOPE));
const VALID_DOMAINS = new Set(Object.values(DOMAIN));
const VALID_CLASSES = new Set(Object.values(CLASS));
const VALID_TEMPORAL_LAYERS = new Set(Object.values(TEMPORAL_LAYER));
const VALID_TRUTH_STATUSES = new Set(Object.values(TRUTH_STATUS));
const VALID_STATES = new Set(Object.values(LIFECYCLE_STATE));

/**
 * Build a canonical record envelope from normalized classification output.
 * Does NOT mutate the input. Returns a new frozen-shape object.
 *
 * @param {object} fields
 * @returns {object}
 */
function buildRecord(fields = {}) {
  return {
    ci_id: fields.ci_id || null,
    kind: fields.kind || KIND.NODE,
    scope: Array.isArray(fields.scope) ? fields.scope : (fields.scope ? [fields.scope] : []),
    domain: Array.isArray(fields.domain) ? fields.domain : (fields.domain ? [fields.domain] : []),
    class: fields.class || null,
    subtype: fields.subtype || null,
    role: Array.isArray(fields.role) ? fields.role : (fields.role ? [fields.role] : []),
    temporal_layer: fields.temporal_layer || TEMPORAL_LAYER.UNKNOWN_TIME,
    truth_status: fields.truth_status || TRUTH_STATUS.RAW,
    state: fields.state || LIFECYCLE_STATE.UNKNOWN,
    confidence: typeof fields.confidence === 'number' ? fields.confidence : null,
    confidence_basis: fields.confidence_basis || null,
    verification_status: fields.verification_status || null,
    provenance: fields.provenance || null,
    relations: Array.isArray(fields.relations) ? fields.relations : [],
    evidence_refs: Array.isArray(fields.evidence_refs) ? fields.evidence_refs : [],
    classifier_version: fields.classifier_version || CLASSIFIER_VERSION,
    // Optional temporal interval fields
    valid_from: fields.valid_from || null,
    valid_to: fields.valid_to || null,
    observed_at: fields.observed_at || null,
    recorded_at: fields.recorded_at || null,
    supersedes_ci_id: fields.supersedes_ci_id || null,
    // Execution/risk fields (optional)
    execution_class: fields.execution_class || null,
    executor_ci_id: fields.executor_ci_id || null,
    criticality: fields.criticality || null,
  };
}

/**
 * Validate a canonical record envelope.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 *
 * @param {object} record
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateRecord(record) {
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['record must be an object'] };
  }

  const errors = [];

  if (!record.ci_id) {
    errors.push('ci_id is required');
  } else if (!isValidCiId(record.ci_id)) {
    errors.push(`invalid ci_id: ${record.ci_id}`);
  }

  if (!VALID_KINDS.has(record.kind)) {
    errors.push(`invalid kind: ${record.kind}`);
  }

  for (const s of (record.scope || [])) {
    if (!VALID_SCOPES.has(s)) errors.push(`invalid scope: ${s}`);
  }

  for (const d of (record.domain || [])) {
    if (!VALID_DOMAINS.has(d)) errors.push(`invalid domain: ${d}`);
  }

  if (record.class !== null && !VALID_CLASSES.has(record.class)) {
    errors.push(`invalid class: ${record.class}`);
  }

  if (!VALID_TEMPORAL_LAYERS.has(record.temporal_layer)) {
    errors.push(`invalid temporal_layer: ${record.temporal_layer}`);
  }

  if (!VALID_TRUTH_STATUSES.has(record.truth_status)) {
    errors.push(`invalid truth_status: ${record.truth_status}`);
  }

  if (!VALID_STATES.has(record.state)) {
    errors.push(`invalid state: ${record.state}`);
  }

  if (record.confidence !== null && record.confidence !== undefined) {
    if (typeof record.confidence !== 'number' || record.confidence < 0 || record.confidence > 1) {
      errors.push('confidence must be a number between 0 and 1');
    }
  }

  // Classifier version must be present
  if (!record.classifier_version) {
    errors.push('classifier_version is required');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

module.exports = { buildRecord, validateRecord };
