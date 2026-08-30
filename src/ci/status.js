'use strict';

/**
 * Ci+ Unified Health Status Surface
 *
 * Provides a read-only health view aggregated across all registered units,
 * reconciliation reports, and audit records.
 */

function now() {
  return new Date().toISOString();
}

class ControlPlaneStatus {
  /**
   * @param {import('./registry').ControlPlaneRegistry} registry
   * @param {import('./reconciler').ControlPlaneReconciler} reconciler
   * @param {import('./audit').ControlPlaneAudit} audit
   */
  constructor(registry, reconciler, audit) {
    this._registry = registry;
    this._reconciler = reconciler;
    this._audit = audit;
  }

  /**
   * Returns a full health summary:
   * {
   *   timestamp,
   *   total_units,
   *   healthy, degraded, offline, unverified, unknown,
   *   drifted,
   *   last_reconcile_at,
   *   open_approval_requests,
   *   recent_audit_events
   * }
   */
  summary() {
    const units = this._registry.list();
    const counts = { healthy: 0, degraded: 0, offline: 0, unverified: 0, unknown: 0 };
    for (const u of units) {
      const s = u.observed_status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    }

    const lastReport = this._reconciler.lastReport();
    const drifted = this._registry.listDrifted();

    return {
      timestamp: now(),
      total_units: units.length,
      healthy: counts.healthy,
      degraded: counts.degraded,
      offline: counts.offline,
      unverified: counts.unverified,
      unknown: counts.unknown,
      drifted: drifted.length,
      last_reconcile_at: lastReport ? lastReport.timestamp : null,
      open_diffs: lastReport ? lastReport.diffs.length : 0,
      recent_audit_events: this._audit.all(5),
    };
  }

  /**
   * Health status for a single provider.
   */
  providerStatus(provider) {
    const units = this._registry.findByProvider(provider);
    return {
      provider,
      units: units.map((u) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        observed_status: u.observed_status,
        desired_status: u.desired_status,
        drift_status: u.drift_status,
        last_verified_at: u.last_verified_at,
      })),
    };
  }
}

module.exports = { ControlPlaneStatus };
