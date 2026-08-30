'use strict';

/**
 * Ci+ Control Plane Audit
 *
 * Immutable append-only action and verification history for all control-plane
 * operations.  Records are never deleted or overwritten.
 */

const crypto = require('node:crypto');

function now() {
  return new Date().toISOString();
}

const AUDIT_EVENT_TYPES = Object.freeze({
  OBSERVE: 'observe',
  RECONCILE: 'reconcile',
  POLICY_DECISION: 'policy_decision',
  APPROVAL_REQUEST: 'approval_request',
  APPROVAL_GRANTED: 'approval_granted',
  APPROVAL_REJECTED: 'approval_rejected',
  ACTION_APPLIED: 'action_applied',
  ACTION_BLOCKED: 'action_blocked',
  VERIFICATION: 'verification',
  DRIFT_DETECTED: 'drift_detected',
  IMPACT_PROPAGATED: 'impact_propagated',
  REGISTRATION: 'registration',
  UNIT_UPDATED: 'unit_updated',
});

class ControlPlaneAudit {
  constructor() {
    /** @type {Array<object>} append-only ledger */
    this._records = [];
  }

  /**
   * Append an audit record.  Returns the created record.
   * No secrets must be in the payload.
   */
  record(eventType, unitId, payload = {}, actor = 'system') {
    const entry = {
      auditId: crypto.randomUUID(),
      eventType,
      unitId: unitId || null,
      actor,
      timestamp: now(),
      payload,
    };
    this._records.push(entry);
    return entry;
  }

  /**
   * Query records for a specific unit (most recent first).
   */
  forUnit(unitId, limit = 50) {
    return [...this._records]
      .filter((r) => r.unitId === unitId)
      .reverse()
      .slice(0, limit);
  }

  /**
   * Query records by event type.
   */
  byType(eventType, limit = 100) {
    return [...this._records]
      .filter((r) => r.eventType === eventType)
      .reverse()
      .slice(0, limit);
  }

  /**
   * All records, most recent first.
   */
  all(limit = 200) {
    return [...this._records].reverse().slice(0, limit);
  }

  size() {
    return this._records.length;
  }
}

module.exports = { ControlPlaneAudit, AUDIT_EVENT_TYPES };
