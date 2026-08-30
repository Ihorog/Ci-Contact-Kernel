'use strict';

/**
 * Ci+ Control Plane Observer
 *
 * Collects normalized status observations from adapters and stores them in
 * the registry.  Read-only / health-check operations may run automatically.
 * Write operations are NEVER triggered from the observer without policy approval.
 */

function now() {
  return new Date().toISOString();
}

// Normalized observation statuses
const OBSERVED_STATUS = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
  UNVERIFIED: 'unverified',
  UNKNOWN: 'unknown',
});

/**
 * Build a normalized observation result from an adapter response.
 *
 * @param {string} unitId      - registry unit id
 * @param {string} provider    - e.g. 'github'
 * @param {string} status      - one of OBSERVED_STATUS values
 * @param {object} evidence    - optional evidence metadata (no secrets)
 * @param {string} adapterVersion
 */
function buildObservation(unitId, provider, status, evidence = {}, adapterVersion = null) {
  return {
    unitId,
    provider,
    status: OBSERVED_STATUS[status.toUpperCase()] || OBSERVED_STATUS.UNKNOWN,
    evidence,
    observedAt: now(),
    adapterVersion,
  };
}

class ControlPlaneObserver {
  /**
   * @param {import('./registry').ControlPlaneRegistry} registry
   * @param {Map<string, object>} adapters  — provider → adapter instance
   */
  constructor(registry, adapters = new Map()) {
    this._registry = registry;
    this._adapters = adapters;
    this._observations = [];
  }

  /**
   * Register an adapter for a provider.
   * Adapter must implement: observe(unit) → Promise<{ status, evidence, version }>
   */
  registerAdapter(provider, adapter) {
    this._adapters.set(provider, adapter);
  }

  /**
   * Observe a single managed unit via its provider adapter.
   * Updates the registry with the observed status.
   * Returns the observation result.
   */
  async observeUnit(unitId) {
    const unit = this._registry.get(unitId);
    if (!unit) {
      return { error: `Unit not found: ${unitId}` };
    }

    const adapter = this._adapters.get(unit.provider);
    if (!adapter) {
      const obs = buildObservation(unitId, unit.provider, 'UNKNOWN', { reason: 'no_adapter' });
      this._observations.push(obs);
      return obs;
    }

    let result;
    try {
      result = await adapter.observe(unit);
    } catch (err) {
      result = {
        status: 'degraded',
        evidence: { error: err.message },
        version: null,
      };
    }

    const obs = buildObservation(unitId, unit.provider, result.status || 'unknown', result.evidence || {}, result.version || null);
    this._observations.push(obs);

    this._registry.updateObserved(unitId, {
      observed_status: obs.status,
      last_verified_at: obs.status === 'healthy' ? obs.observedAt : undefined,
    });

    return obs;
  }

  /**
   * Observe all units for a given provider.
   */
  async observeProvider(provider) {
    const units = this._registry.findByProvider(provider);
    return Promise.all(units.map((u) => this.observeUnit(u.id)));
  }

  /**
   * Observe all registered units across all providers.
   */
  async observeAll() {
    const units = this._registry.list();
    return Promise.all(units.map((u) => this.observeUnit(u.id)));
  }

  /**
   * Return recent observations (last N, default 100).
   */
  recentObservations(limit = 100) {
    return this._observations.slice(-limit);
  }
}

module.exports = { ControlPlaneObserver, buildObservation, OBSERVED_STATUS };
