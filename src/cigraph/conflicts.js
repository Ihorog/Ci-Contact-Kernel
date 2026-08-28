'use strict';

/**
 * Ci Graph — explicit contradiction detection hooks.
 *
 * Hard invariants:
 *  6. Unknown/conflicting data remains UNKNOWN, CANDIDATE, CONFLICTING or QUARANTINED.
 *  9. Historical truth is append-only; corrections supersede prior claims.
 */

const { TRUTH_STATUS, TEMPORAL_LAYER } = require('./registry');

/**
 * Check whether two claim objects conflict with each other.
 * Returns { conflict: false } when no contradiction is detected.
 *
 * @param {object} claimA
 * @param {object} claimB
 * @returns {{ conflict: boolean, reason?: string, resolution?: string }}
 */
function detectConflict(claimA, claimB) {
  if (!claimA || !claimB) return { conflict: false };

  // Same ci_id with different truth-bearing attributes in the same temporal layer
  if (claimA.ci_id && claimA.ci_id === claimB.ci_id) {
    if (
      claimA.temporal_layer === claimB.temporal_layer &&
      claimA.temporal_layer !== TEMPORAL_LAYER.HIST &&
      claimA.truth_status !== TRUTH_STATUS.REJECTED &&
      claimB.truth_status !== TRUTH_STATUS.REJECTED
    ) {
      // Different class or scope signals a genuine conflict
      if (claimA.class !== claimB.class && claimA.class && claimB.class) {
        return {
          conflict: true,
          reason: `ci_id ${claimA.ci_id}: class conflict: ${claimA.class} vs ${claimB.class}`,
          resolution: 'Mark both CONFLICTING; require human review or supersede chain',
        };
      }
    }
  }

  return { conflict: false };
}

/**
 * Resolve conflicting claims by marking them CONFLICTING.
 * Does NOT delete or overwrite history — returns new objects.
 *
 * @param {object} claimA
 * @param {object} claimB
 * @returns {{ claimA: object, claimB: object }}
 */
function markConflicting(claimA, claimB) {
  return {
    claimA: { ...claimA, truth_status: TRUTH_STATUS.CONFLICTING },
    claimB: { ...claimB, truth_status: TRUTH_STATUS.CONFLICTING },
  };
}

/**
 * Process an array of claims and flag any that conflict with each other.
 * Returns the same array with conflicting entries tagged.
 *
 * @param {object[]} claims
 * @returns {{ claims: object[], conflicts: string[] }}
 */
function resolveConflicts(claims) {
  if (!Array.isArray(claims) || claims.length < 2) {
    return { claims: claims || [], conflicts: [] };
  }

  const result = [...claims];
  const conflictMessages = [];

  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const check = detectConflict(result[i], result[j]);
      if (check.conflict) {
        conflictMessages.push(check.reason);
        const { claimA, claimB } = markConflicting(result[i], result[j]);
        result[i] = claimA;
        result[j] = claimB;
      }
    }
  }

  return { claims: result, conflicts: conflictMessages };
}

module.exports = { detectConflict, markConflicting, resolveConflicts };
