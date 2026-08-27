'use strict';

/**
 * Ci Graph — relation validation.
 *
 * Hard invariant: Do NOT infer CAUSES from co-occurrence.
 * Relations are first-class graph objects with independent provenance/evidence.
 */

const { RELATION, CAUSAL_RELATIONS, TRUTH_STATUS } = require('./registry');

const VALID_RELATIONS = new Set(Object.values(RELATION));

/**
 * Validate a relation object.
 * Returns { valid: true } or { valid: false, reason: string }.
 *
 * @param {object} relation
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateRelation(relation) {
  if (!relation || typeof relation !== 'object') {
    return { valid: false, reason: 'relation must be an object' };
  }

  const { type, from_ci_id, to_ci_id, truth_status, evidence_refs } = relation;

  if (!VALID_RELATIONS.has(type)) {
    return { valid: false, reason: `unknown relation type: ${type}` };
  }

  if (!from_ci_id || !to_ci_id) {
    return { valid: false, reason: 'relation requires from_ci_id and to_ci_id' };
  }

  // Causal relations require explicit evidence
  if (CAUSAL_RELATIONS.has(type)) {
    const hasEvidence =
      Array.isArray(evidence_refs) && evidence_refs.length > 0;
    const isVerified = truth_status === TRUTH_STATUS.VERIFIED;
    if (!hasEvidence || !isVerified) {
      return {
        valid: false,
        reason: `causal relation ${type} requires verified evidence_refs; ` +
                'do not infer CAUSES from co-occurrence alone',
      };
    }
  }

  return { valid: true };
}

/**
 * Validate an array of relations; returns only valid ones plus a list of errors.
 *
 * @param {Array} relations
 * @returns {{ valid: object[], errors: string[] }}
 */
function filterValidRelations(relations) {
  if (!Array.isArray(relations)) return { valid: [], errors: [] };

  const valid = [];
  const errors = [];
  for (const rel of relations) {
    const result = validateRelation(rel);
    if (result.valid) {
      valid.push(rel);
    } else {
      errors.push(result.reason);
    }
  }
  return { valid, errors };
}

module.exports = { validateRelation, filterValidRelations, VALID_RELATIONS };
