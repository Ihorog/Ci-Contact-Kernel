'use strict';

/**
 * Ci+ Control Plane Reconciler
 *
 * Computes the diff between desired state and observed state for every managed
 * unit, classifies the drift, propagates impact across dependency edges, and
 * produces a reconciliation plan.
 *
 * WRITE operations (plan.apply items) are NEVER executed automatically.
 * They must pass through ci-policy approval before any mutation occurs.
 */

function now() {
  return new Date().toISOString();
}

const DRIFT_STATUS = Object.freeze({
  IN_SYNC: 'in_sync',
  DRIFT: 'drift',
  CONFLICT: 'conflict',
  DEGRADED: 'degraded',
  UNKNOWN: 'unknown',
});

const RELATIONSHIP_TYPES = Object.freeze([
  'depends_on',
  'verifies',
  'provides',
  'consumes',
  'authorizes',
  'affects',
  'responsible_for',
  'evidence_for',
]);

/**
 * Classify drift for a single managed unit.
 *
 * @param {object} unit - registry unit with observed_status and desired_status
 * @returns {string} one of DRIFT_STATUS values
 */
function classifyDrift(unit) {
  if (unit.observed_status === 'unknown') return DRIFT_STATUS.UNKNOWN;
  if (unit.desired_status === 'active' && unit.observed_status === 'healthy') return DRIFT_STATUS.IN_SYNC;
  if (unit.desired_status === 'active' && unit.observed_status === 'degraded') return DRIFT_STATUS.DEGRADED;
  if (unit.desired_status === 'active' && unit.observed_status === 'offline') return DRIFT_STATUS.DRIFT;
  if (unit.desired_status === 'inactive' && unit.observed_status !== 'offline') return DRIFT_STATUS.DRIFT;
  if (unit.desired_status === 'decommissioned' && unit.observed_status !== 'offline') return DRIFT_STATUS.DRIFT;
  if (unit.observed_status === 'unverified') return DRIFT_STATUS.UNKNOWN;
  return DRIFT_STATUS.UNKNOWN;
}

/**
 * Build a reconciliation action item for a drifted unit.
 * These are NOT auto-applied; they require policy approval.
 */
function buildAction(unit, driftStatus) {
  const actions = {
    [DRIFT_STATUS.DRIFT]: {
      action: 'reconcile',
      description: `Desired status "${unit.desired_status}" does not match observed "${unit.observed_status}". Manual reconciliation required.`,
      approval_required: unit.approval_class !== 'read_only',
    },
    [DRIFT_STATUS.DEGRADED]: {
      action: 'investigate',
      description: `Unit "${unit.name}" is degraded. Health check recommended.`,
      approval_required: false,
    },
    [DRIFT_STATUS.UNKNOWN]: {
      action: 'verify',
      description: `Unit "${unit.name}" has unknown status. Verification required.`,
      approval_required: false,
    },
  };
  return actions[driftStatus] || null;
}

class ControlPlaneReconciler {
  /**
   * @param {import('./registry').ControlPlaneRegistry} registry
   */
  constructor(registry) {
    this._registry = registry;
    /** @type {Map<string, Set<string>>} unitId → Set of dependent unitIds */
    this._dependencyGraph = new Map();
    this._runHistory = [];
  }

  /**
   * Declare a dependency edge: `from` depends_on `to`.
   * Supported relation types: see RELATIONSHIP_TYPES.
   */
  addEdge(fromId, toId, relationType = 'depends_on') {
    if (!RELATIONSHIP_TYPES.includes(relationType)) {
      throw new Error(`Unknown relation type: ${relationType}`);
    }
    if (!this._dependencyGraph.has(fromId)) {
      this._dependencyGraph.set(fromId, new Map());
    }
    this._dependencyGraph.get(fromId).set(toId, relationType);
  }

  /**
   * Run a full reconciliation cycle.
   * Returns a reconciliation report: { runId, timestamp, diffs[], plan[] }
   */
  run() {
    const runId = require('node:crypto').randomUUID();
    const timestamp = now();
    const units = this._registry.list();
    const diffs = [];
    const plan = [];

    for (const unit of units) {
      const drift = classifyDrift(unit);
      this._registry.updateObserved(unit.id, { drift_status: drift });

      if (drift !== DRIFT_STATUS.IN_SYNC) {
        const diff = {
          unitId: unit.id,
          provider: unit.provider,
          name: unit.name,
          desired_status: unit.desired_status,
          observed_status: unit.observed_status,
          drift_status: drift,
          timestamp,
        };
        diffs.push(diff);

        const action = buildAction(unit, drift);
        if (action) {
          plan.push({ ...action, unitId: unit.id, provider: unit.provider, name: unit.name });
        }
      }
    }

    // Impact propagation: if a dependency is unhealthy, mark downstream as affected
    const impactMap = this._propagateImpact(units);
    for (const [affectedId, impactedBy] of impactMap) {
      const unit = this._registry.get(affectedId);
      if (unit && unit.drift_status === DRIFT_STATUS.IN_SYNC) {
        // Downstream is "in_sync" itself but impacted by unhealthy dependency
        diffs.push({
          unitId: affectedId,
          provider: unit.provider,
          name: unit.name,
          desired_status: unit.desired_status,
          observed_status: unit.observed_status,
          drift_status: 'impacted',
          impacted_by: impactedBy,
          timestamp,
        });
      }
    }

    const report = { runId, timestamp, diffs, plan };
    this._runHistory.push(report);
    return report;
  }

  /**
   * Propagate impact from unhealthy units to their dependents.
   * Returns Map<affectedId, impactedByIds[]>.
   */
  _propagateImpact(units) {
    const unhealthyIds = new Set(
      units
        .filter((u) => u.observed_status !== 'healthy' && u.observed_status !== 'unknown')
        .map((u) => u.id)
    );

    const impactMap = new Map();

    for (const [fromId, edges] of this._dependencyGraph) {
      for (const [toId] of edges) {
        if (unhealthyIds.has(toId)) {
          if (!impactMap.has(fromId)) impactMap.set(fromId, []);
          impactMap.get(fromId).push(toId);
        }
      }
    }

    return impactMap;
  }

  lastReport() {
    return this._runHistory[this._runHistory.length - 1] || null;
  }

  runHistory() {
    return [...this._runHistory];
  }
}

module.exports = { ControlPlaneReconciler, classifyDrift, DRIFT_STATUS, RELATIONSHIP_TYPES };
