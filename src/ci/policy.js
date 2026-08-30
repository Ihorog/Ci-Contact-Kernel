'use strict';

/**
 * Ci+ Control Plane Policy Gate
 *
 * Evaluates whether a proposed action on a managed unit is allowed to proceed
 * without human approval or whether it must be gated.
 *
 * Rules:
 * - Read-only / health-check operations: always allowed automatically.
 * - Low-risk writes: allowed with audit record.
 * - High-risk / critical writes (permissions, secrets, account registration,
 *   authorization, billing, deletion, destructive state): ALWAYS require
 *   explicit user approval.  Never auto-approved.
 */

function now() {
  return new Date().toISOString();
}

const APPROVAL_CLASS = Object.freeze({
  READ_ONLY: 'read_only',
  LOW_RISK: 'low_risk',
  HIGH_RISK: 'high_risk',
  CRITICAL: 'critical',
});

const POLICY_DECISION = Object.freeze({
  ALLOWED: 'allowed',
  REQUIRES_APPROVAL: 'requires_approval',
  BLOCKED: 'blocked',
});

/** Actions that ALWAYS require explicit approval regardless of approval_class. */
const ALWAYS_REQUIRES_APPROVAL = new Set([
  'delete',
  'decommission',
  'rotate_credential',
  'grant_permission',
  'revoke_permission',
  'register_account',
  'authorize_external',
  'modify_billing',
  'destructive_state_change',
  'apply_write',
]);

/** Actions that are always read-only safe. */
const ALWAYS_ALLOWED = new Set([
  'observe',
  'verify',
  'health_check',
  'status_read',
  'list',
  'inspect',
]);

/**
 * Evaluate whether a proposed action should proceed automatically, be gated,
 * or be blocked.
 *
 * @param {object} unit        - managed unit from registry
 * @param {string} action      - proposed action name
 * @param {object} context     - optional context (requestedBy, reason, etc.)
 * @returns {{ decision, reason, approvalClass, requiresApproval }}
 */
function evaluatePolicy(unit, action, context = {}) {
  if (!unit) {
    return {
      decision: POLICY_DECISION.BLOCKED,
      reason: 'Unit not found in registry.',
      approvalClass: null,
      requiresApproval: false,
    };
  }

  if (ALWAYS_ALLOWED.has(action)) {
    return {
      decision: POLICY_DECISION.ALLOWED,
      reason: `Action "${action}" is read-only and always permitted.`,
      approvalClass: unit.approval_class,
      requiresApproval: false,
    };
  }

  if (ALWAYS_REQUIRES_APPROVAL.has(action)) {
    return {
      decision: POLICY_DECISION.REQUIRES_APPROVAL,
      reason: `Action "${action}" always requires explicit user approval regardless of risk class.`,
      approvalClass: unit.approval_class,
      requiresApproval: true,
    };
  }

  const approvalClass = unit.approval_class || APPROVAL_CLASS.LOW_RISK;

  if (approvalClass === APPROVAL_CLASS.READ_ONLY) {
    return {
      decision: POLICY_DECISION.BLOCKED,
      reason: `Unit "${unit.name}" is read-only; write action "${action}" is not permitted.`,
      approvalClass,
      requiresApproval: false,
    };
  }

  if (approvalClass === APPROVAL_CLASS.LOW_RISK) {
    return {
      decision: POLICY_DECISION.ALLOWED,
      reason: `Action "${action}" is permitted for low-risk unit "${unit.name}" with audit record.`,
      approvalClass,
      requiresApproval: false,
    };
  }

  // HIGH_RISK or CRITICAL
  return {
    decision: POLICY_DECISION.REQUIRES_APPROVAL,
    reason: `Action "${action}" on "${unit.name}" (approval_class=${approvalClass}) requires explicit approval.`,
    approvalClass,
    requiresApproval: true,
  };
}

/**
 * Build an approval request record for a gated action.
 */
function buildApprovalRequest(unit, action, policyResult, context = {}) {
  return {
    requestId: require('node:crypto').randomUUID(),
    unitId: unit.id,
    provider: unit.provider,
    unitName: unit.name,
    action,
    approvalClass: policyResult.approvalClass,
    reason: policyResult.reason,
    requestedBy: context.requestedBy || 'system',
    requestedAt: now(),
    status: 'pending',
    decision: null,
    decidedBy: null,
    decidedAt: null,
    context: context.extra || {},
  };
}

module.exports = {
  evaluatePolicy,
  buildApprovalRequest,
  APPROVAL_CLASS,
  POLICY_DECISION,
  ALWAYS_REQUIRES_APPROVAL,
  ALWAYS_ALLOWED,
};
