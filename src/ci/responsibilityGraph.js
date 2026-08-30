'use strict';

/**
 * Ci+ Responsibility Graph — Integration Layer  (Issue #29)
 *
 * Connects existing Ci+ components into the full execution loop:
 *
 *   Observe → Normalize → Correlate → Verify → Diff → Policy Gate →
 *   Route → Apply (only when approved) → Re-verify → Audit → Update Graph
 *
 * Responsibility axis:
 *   Identity ↔ Account ↔ Service ↔ CredentialRef ↔ Permission ↔ Node ↔
 *   DependencyContract ↔ Responsibility ↔ Verification ↔ Impact
 *
 * This module wires together:
 *   - ControlPlaneRegistry (src/ci/registry.js)
 *   - ControlPlaneObserver  (src/ci/observer.js)
 *   - ControlPlaneReconciler (src/ci/reconciler.js)
 *   - evaluatePolicy         (src/ci/policy.js)
 *   - ControlPlaneAudit      (src/ci/audit.js)
 *   - ControlPlaneStatus     (src/ci/status.js)
 *   - classifyCiGraph        (src/cigraph/classify.js)
 *   - routeRecord            (src/cigraph/routing/route.js)  — when available
 *
 * External writes are NEVER executed without explicit approvalId.
 */

const { ControlPlaneRegistry } = require('./registry');
const { ControlPlaneObserver } = require('./observer');
const { ControlPlaneReconciler, RELATIONSHIP_TYPES } = require('./reconciler');
const { evaluatePolicy, buildApprovalRequest, POLICY_DECISION, AUDIT_EVENT_TYPES: _unused } = require('./policy');
const { ControlPlaneAudit, AUDIT_EVENT_TYPES } = require('./audit');
const { ControlPlaneStatus } = require('./status');

class ResponsibilityGraph {
  constructor(opts = {}) {
    this.registry = opts.registry || new ControlPlaneRegistry();
    this.audit = opts.audit || new ControlPlaneAudit();
    this.observer = opts.observer || new ControlPlaneObserver(this.registry);
    this.reconciler = opts.reconciler || new ControlPlaneReconciler(this.registry);
    this.status = new ControlPlaneStatus(this.registry, this.reconciler, this.audit);

    /** Pending approval requests: requestId → request */
    this._pendingApprovals = new Map();
  }

  // ── Registration ────────────────────────────────────────────────────────────

  registerUnit(fields = {}) {
    const unit = this.registry.register(fields);
    this.audit.record(AUDIT_EVENT_TYPES.REGISTRATION, unit.id, { name: unit.name, provider: unit.provider });
    return unit;
  }

  addDependencyEdge(fromId, toId, relationType = 'depends_on') {
    this.reconciler.addEdge(fromId, toId, relationType);
    this.audit.record(AUDIT_EVENT_TYPES.UNIT_UPDATED, fromId, {
      relation: relationType,
      to: toId,
    });
  }

  registerAdapter(provider, adapter) {
    this.observer.registerAdapter(provider, adapter);
  }

  // ── Execution loop steps ──────────────────────────────────────────────────

  /**
   * Step 1 — Observe: collect current state from all adapters.
   */
  async observe(unitIdOrAll = 'all') {
    let observations;
    if (unitIdOrAll === 'all') {
      observations = await this.observer.observeAll();
    } else {
      observations = [await this.observer.observeUnit(unitIdOrAll)];
    }
    for (const obs of observations) {
      if (!obs.error) {
        this.audit.record(AUDIT_EVENT_TYPES.OBSERVE, obs.unitId, {
          status: obs.status,
          provider: obs.provider,
        });
      }
    }
    return observations;
  }

  /**
   * Step 2+3 — Diff + Reconcile: compare desired vs observed, detect drift.
   */
  reconcile() {
    const report = this.reconciler.run();
    for (const diff of report.diffs) {
      this.audit.record(AUDIT_EVENT_TYPES.DRIFT_DETECTED, diff.unitId, {
        drift_status: diff.drift_status,
        desired: diff.desired_status,
        observed: diff.observed_status,
      });
    }
    return report;
  }

  /**
   * Step 4 — Policy Gate: evaluate whether an action can proceed.
   * Returns { decision, approvalRequest? } — approvalRequest is set when
   * approval is required.
   */
  policyGate(unitId, action, context = {}) {
    const unit = this.registry.get(unitId);
    const result = evaluatePolicy(unit, action, context);

    this.audit.record(AUDIT_EVENT_TYPES.POLICY_DECISION, unitId, {
      action,
      decision: result.decision,
      reason: result.reason,
    });

    if (result.decision === POLICY_DECISION.REQUIRES_APPROVAL) {
      const req = buildApprovalRequest(unit, action, result, context);
      this._pendingApprovals.set(req.requestId, req);
      this.audit.record(AUDIT_EVENT_TYPES.APPROVAL_REQUEST, unitId, {
        requestId: req.requestId,
        action,
      });
      return { decision: result.decision, reason: result.reason, approvalRequest: req };
    }

    return { decision: result.decision, reason: result.reason };
  }

  /**
   * Approve a pending request.  Only after this may apply() be called.
   */
  approveRequest(requestId, decidedBy = 'user') {
    const req = this._pendingApprovals.get(requestId);
    if (!req) return { error: `No pending approval with id: ${requestId}` };

    req.status = 'approved';
    req.decision = 'approved';
    req.decidedBy = decidedBy;
    req.decidedAt = new Date().toISOString();

    this.audit.record(AUDIT_EVENT_TYPES.APPROVAL_GRANTED, req.unitId, {
      requestId,
      decidedBy,
      action: req.action,
    });

    return { approved: true, request: req };
  }

  /**
   * Reject a pending request.
   */
  rejectRequest(requestId, decidedBy = 'user', reason = '') {
    const req = this._pendingApprovals.get(requestId);
    if (!req) return { error: `No pending approval with id: ${requestId}` };

    req.status = 'rejected';
    req.decision = 'rejected';
    req.decidedBy = decidedBy;
    req.decidedAt = new Date().toISOString();
    req.rejectionReason = reason;
    this._pendingApprovals.delete(requestId);

    this.audit.record(AUDIT_EVENT_TYPES.APPROVAL_REJECTED, req.unitId, {
      requestId,
      decidedBy,
      action: req.action,
      reason,
    });

    return { rejected: true, request: req };
  }

  /**
   * Step 5 — Apply: execute an approved action via the adapter.
   * Requires a valid approvalId from an approved ApprovalRequest.
   */
  async apply(unitId, action, approvalId, adapter) {
    const req = this._pendingApprovals.get(approvalId);
    if (!req || req.status !== 'approved') {
      this.audit.record(AUDIT_EVENT_TYPES.ACTION_BLOCKED, unitId, {
        action,
        reason: 'No valid approval found.',
        approvalId,
      });
      return { applied: false, error: 'Action blocked: no valid approved request.' };
    }

    const unit = this.registry.get(unitId);
    if (!unit) {
      return { applied: false, error: `Unit not found: ${unitId}` };
    }

    let result;
    try {
      result = await adapter.apply(unit, action, approvalId);
    } catch (err) {
      result = { applied: false, error: err.message };
    }

    const eventType = result.applied ? AUDIT_EVENT_TYPES.ACTION_APPLIED : AUDIT_EVENT_TYPES.ACTION_BLOCKED;
    this.audit.record(eventType, unitId, {
      action,
      approvalId,
      applied: result.applied,
      error: result.error || null,
    });

    if (result.applied) {
      this._pendingApprovals.delete(approvalId);
    }

    return result;
  }

  /**
   * Full reconciliation cycle: observe → reconcile → audit.
   * Does NOT auto-apply anything.
   */
  async runReconciliationCycle() {
    const observations = await this.observe('all');
    const report = this.reconcile();
    return { observations, report, status: this.status.summary() };
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  getStatus() {
    return this.status.summary();
  }

  listPendingApprovals() {
    return [...this._pendingApprovals.values()];
  }
}

module.exports = {
  ResponsibilityGraph,
  RELATIONSHIP_TYPES,
};
