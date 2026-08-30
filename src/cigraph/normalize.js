'use strict';

/**
 * Ci Graph — input normalization.
 *
 * Hard invariant: raw input is immutable provenance, not normalized truth.
 * This module never mutates the original payload.
 */

const { createHash } = require('crypto');
const { SOURCE_TYPE } = require('./registry');

const VALID_SOURCE_TYPES = new Set(Object.values(SOURCE_TYPE));

/**
 * Compute a stable SHA-256 hex hash of a raw input object/string.
 * @param {*} raw
 * @returns {string}
 */
function hashRaw(raw) {
  const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Normalize provenance fields from an arbitrary input object.
 * Unknown fields in `raw` are preserved unchanged under the returned envelope.
 *
 * @param {object} raw  Arbitrary intake payload
 * @param {object} [context]  Optional context/override
 * @returns {object}  Normalized provenance object
 */
function normalizeProvenance(raw = {}, context = {}) {
  const now = new Date().toISOString();

  const prov = raw && typeof raw.provenance === 'object' && raw.provenance !== null ? raw.provenance : {};
  const sourceType = resolveSourceType(prov.source_type || raw.source_type || context.source_type);

  return {
    ingest_id: prov.ingest_id || raw.ingest_id || context.ingest_id || null,
    source_type: sourceType,
    source_ref: prov.source_ref || raw.source_ref || context.source_ref || null,
    source_actor_ci_id: prov.source_actor_ci_id || raw.source_actor_ci_id || context.source_actor_ci_id || null,
    received_at: prov.received_at || raw.received_at || context.received_at || now,
    source_timestamp: prov.source_timestamp || raw.source_timestamp || raw.timestamp || context.source_timestamp || null,
    raw_hash: prov.raw_hash || raw.raw_hash || hashRaw(raw),
    parent_claim_ids: Array.isArray(prov.parent_claim_ids)
      ? [...prov.parent_claim_ids]
      : (Array.isArray(raw.parent_claim_ids) ? [...raw.parent_claim_ids] : []),
    transform_chain: Array.isArray(prov.transform_chain)
      ? [...prov.transform_chain]
      : (Array.isArray(raw.transform_chain) ? [...raw.transform_chain] : []),
    _extra: {
      ...(prov && prov._extra && typeof prov._extra === 'object' ? { ...prov._extra } : {}),
      ...(raw && raw._extra && typeof raw._extra === 'object' ? { ...raw._extra } : {}),
      ...(prov.source_repo ? { source_repo: prov.source_repo } : {}),
      ...(prov.path ? { path: prov.path } : {}),
      ...(prov.blob_sha ? { blob_sha: prov.blob_sha } : {}),
      ...(prov.content_hash ? { content_hash: prov.content_hash } : {}),
    },
  };
}

/**
 * Resolve and validate a source_type value; falls back to 'user' if unrecognised.
 * @param {*} value
 * @returns {string}
 */
function resolveSourceType(value) {
  if (typeof value === 'string' && value.toLowerCase() === 'github') {
    return SOURCE_TYPE.REPO;
  }
  if (typeof value === 'string' && VALID_SOURCE_TYPES.has(value.toLowerCase())) {
    return value.toLowerCase();
  }
  return SOURCE_TYPE.USER;
}

/**
 * Normalise raw input into a shallow cleaned object without mutating the original.
 * Unknown/extra fields are preserved under `_extra`.
 *
 * @param {*} raw
 * @returns {object}
 */
function normalizeInput(raw) {
  if (raw === null || raw === undefined) return { _extra: {} };
  if (typeof raw === 'string') return { text: raw, _extra: {} };

  const KNOWN_FIELDS = new Set([
    'ci_id', 'kind', 'scope', 'domain', 'class', 'subtype', 'role',
    'temporal_layer', 'truth_status', 'state', 'confidence',
    'provenance', 'relations', 'evidence_refs', 'classifier_version',
    'classification', 'type', 'fact', 'event', 'text', 'name',
    'source_type', 'source_ref', 'ingest_id', 'received_at',
    'source_timestamp', 'timestamp', 'raw_hash',
    'parent_claim_ids', 'transform_chain', 'source_actor_ci_id',
    'valid_from', 'valid_to', 'observed_at', 'recorded_at', 'supersedes_ci_id',
    'confidence_basis', 'verification_status',
    'criticality', 'safety_impact', 'financial_impact', 'privacy_impact',
    'availability_impact', 'dependency_impact', 'time_sensitivity',
    'reversibility', 'execution_class',
  ]);

  const known = {};
  const extra = {};
  for (const [k, v] of Object.entries(raw)) {
    if (KNOWN_FIELDS.has(k)) {
      known[k] = v;
    } else {
      extra[k] = v;
    }
  }
  return { ...known, _extra: extra };
}

module.exports = { hashRaw, normalizeProvenance, normalizeInput, resolveSourceType };
