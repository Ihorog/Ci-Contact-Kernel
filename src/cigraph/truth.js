'use strict';

/**
 * Ci Graph — epistemic/evidence rules (truth status).
 *
 * Hard invariants:
 *  4. No claim becomes VERIFIED without accepted evidence/check.
 *  5. No external/physical action becomes COMPLETED without a real executor and result evidence.
 *  6. Unknown/conflicting data remains UNKNOWN, CANDIDATE, CONFLICTING or QUARANTINED.
 *  Confidence alone must NEVER equal VERIFIED status.
 */

const { TRUTH_STATUS, LIFECYCLE_STATE, EXECUTION_CLASS } = require('./registry');

/** Status values that represent non-final/uncertain states */
const UNCERTAIN_STATUSES = new Set([
  TRUTH_STATUS.UNKNOWN,
  TRUTH_STATUS.CANDIDATE,
  TRUTH_STATUS.CONFLICTING,
  TRUTH_STATUS.RAW,
  TRUTH_STATUS.PARSED,
  TRUTH_STATUS.CLAIMED,
]);

/**
 * Determine whether a truth status transition is allowed.
 * Confidence alone cannot produce VERIFIED.
 *
 * @param {string} currentStatus
 * @param {string} proposedStatus
 * @param {{ evidence_refs?: Array, confidence?: number }} context
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkTruthTransition(currentStatus, proposedStatus, context = {}) {
  if (proposedStatus === TRUTH_STATUS.VERIFIED) {
    const hasEvidence =
      Array.isArray(context.evidence_refs) && context.evidence_refs.length > 0;
    if (!hasEvidence) {
      return {
        allowed: false,
        reason: 'VERIFIED requires accepted evidence_refs; confidence alone is insufficient',
      };
    }
  }
  return { allowed: true };
}

/**
 * Check whether an action/task may transition to COMPLETED.
 * Requires a real executor AND result evidence for external/physical executions.
 *
 * @param {object} record  Canonical record fields
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkCompletionAllowed(record) {
  const { execution_class, executor_ci_id, evidence_refs, state } = record;

  const externalClasses = new Set([
    EXECUTION_CLASS.EXECUTE_EXTERNAL,
    EXECUTION_CLASS.EXECUTE_PHYSICAL,
    EXECUTION_CLASS.EXECUTE_FINANCIAL,
    EXECUTION_CLASS.EXECUTE_SAFETY_CRITICAL,
  ]);

  if (state === LIFECYCLE_STATE.COMPLETED && externalClasses.has(execution_class)) {
    if (!executor_ci_id) {
      return { allowed: false, reason: 'COMPLETED external action requires executor_ci_id' };
    }
    const hasEvidence = Array.isArray(evidence_refs) && evidence_refs.length > 0;
    if (!hasEvidence) {
      return { allowed: false, reason: 'COMPLETED external action requires result evidence_refs' };
    }
  }

  return { allowed: true };
}

/**
 * Resolve the canonical truth status for a new/updated record.
 * Never invents missing semantics — falls back to UNKNOWN or CANDIDATE.
 *
 * @param {string|null} inputStatus  Explicit status from input, if any
 * @param {{ confidence?: number, evidence_refs?: Array }} context
 * @returns {string}  Resolved TRUTH_STATUS value
 */
function resolveTruthStatus(inputStatus, context = {}) {
  if (inputStatus && Object.values(TRUTH_STATUS).includes(inputStatus)) {
    // Guard: cannot claim VERIFIED via confidence alone
    if (inputStatus === TRUTH_STATUS.VERIFIED) {
      const { allowed } = checkTruthTransition(null, TRUTH_STATUS.VERIFIED, context);
      if (!allowed) return TRUTH_STATUS.CLAIMED;
    }
    return inputStatus;
  }
  // No explicit status provided — start conservative
  if (context.confidence !== undefined && context.confidence >= 0.9) {
    return TRUTH_STATUS.OBSERVED;
  }
  return TRUTH_STATUS.RAW;
}

module.exports = {
  checkTruthTransition,
  checkCompletionAllowed,
  resolveTruthStatus,
  UNCERTAIN_STATUSES,
};
