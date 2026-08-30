'use strict';

/**
 * Ci+ Control Plane Registry
 *
 * Canonical metadata inventory for all managed units: accounts, services,
 * credential references, devices, environments and nodes.
 *
 * NEVER stores plaintext passwords, private keys or API secrets.
 * Only references, scopes, ownership, health/expiry metadata and approval policy.
 */

const crypto = require('node:crypto');

function now() {
  return new Date().toISOString();
}

/**
 * Canonical managed-unit state model.
 *
 * id             — stable UUID assigned at registration, never changes
 * type           — 'account'|'service'|'credential_ref'|'node'|'device'|'environment'
 * provider       — 'github'|'vercel'|'supabase'|'cloudflare'|'google'|'openai'|'local'|…
 * name           — human-readable label
 * owner_ref      — ci_id of the owning account/identity (never a secret)
 * environment    — 'production'|'staging'|'development'|'local'
 * service_ref    — ci_id of associated service/node (optional)
 * auth_method    — 'oauth'|'token'|'key_ref'|'cert'|'none'
 * credential_ref — opaque reference (e.g. vault path, env-var name) — never the secret
 * scopes         — string[]
 * permissions    — string[]
 * observed_status  — 'healthy'|'degraded'|'offline'|'unverified'|'unknown'
 * desired_status   — 'active'|'inactive'|'decommissioned'
 * last_verified_at — ISO timestamp or null
 * expires_at       — ISO timestamp or null
 * rotation_due_at  — ISO timestamp or null
 * approval_class   — 'read_only'|'low_risk'|'high_risk'|'critical'
 * source_of_truth  — where the authoritative record lives
 * drift_status     — 'in_sync'|'drift'|'conflict'|'unknown'
 * created_at / updated_at
 * metadata         — arbitrary JSON metadata (no secrets)
 */
function createUnit(fields = {}) {
  const id = fields.id || crypto.randomUUID();
  const ts = now();
  return {
    id,
    type: fields.type || 'service',
    provider: fields.provider || 'unknown',
    name: fields.name || id,
    owner_ref: fields.owner_ref || null,
    environment: fields.environment || 'production',
    service_ref: fields.service_ref || null,
    auth_method: fields.auth_method || 'none',
    credential_ref: fields.credential_ref || null,
    scopes: Array.isArray(fields.scopes) ? fields.scopes : [],
    permissions: Array.isArray(fields.permissions) ? fields.permissions : [],
    observed_status: fields.observed_status || 'unknown',
    desired_status: fields.desired_status || 'active',
    last_verified_at: fields.last_verified_at || null,
    expires_at: fields.expires_at || null,
    rotation_due_at: fields.rotation_due_at || null,
    approval_class: fields.approval_class || 'low_risk',
    source_of_truth: fields.source_of_truth || 'registry',
    drift_status: fields.drift_status || 'unknown',
    created_at: fields.created_at || ts,
    updated_at: ts,
    metadata: fields.metadata || {},
  };
}

class ControlPlaneRegistry {
  constructor() {
    /** @type {Map<string, object>} id → unit */
    this._units = new Map();
    /** @type {Map<string, string>} "provider:name" → id */
    this._index = new Map();
  }

  /**
   * Register a new managed unit.  Returns the created unit.
   */
  register(fields = {}) {
    const unit = createUnit(fields);
    this._units.set(unit.id, unit);
    this._index.set(`${unit.provider}:${unit.name}`, unit.id);
    return unit;
  }

  /**
   * Update observed state for a managed unit.
   * Does NOT allow changing id, created_at, or provider/name index key.
   */
  updateObserved(id, observedFields = {}) {
    const unit = this._units.get(id);
    if (!unit) return null;
    const allowed = ['observed_status', 'last_verified_at', 'drift_status', 'metadata'];
    for (const key of allowed) {
      if (key in observedFields) {
        unit[key] = observedFields[key];
      }
    }
    unit.updated_at = now();
    return unit;
  }

  /**
   * Update desired state for a managed unit.
   */
  updateDesired(id, desiredFields = {}) {
    const unit = this._units.get(id);
    if (!unit) return null;
    const allowed = ['desired_status', 'scopes', 'permissions', 'approval_class', 'expires_at', 'rotation_due_at'];
    for (const key of allowed) {
      if (key in desiredFields) {
        unit[key] = desiredFields[key];
      }
    }
    unit.updated_at = now();
    return unit;
  }

  get(id) {
    return this._units.get(id) || null;
  }

  findByProvider(provider) {
    return [...this._units.values()].filter((u) => u.provider === provider);
  }

  findByType(type) {
    return [...this._units.values()].filter((u) => u.type === type);
  }

  findByName(provider, name) {
    const id = this._index.get(`${provider}:${name}`);
    return id ? this._units.get(id) : null;
  }

  list() {
    return [...this._units.values()];
  }

  /**
   * Returns units with drift_status === 'drift' or 'conflict'.
   */
  listDrifted() {
    return [...this._units.values()].filter(
      (u) => u.drift_status === 'drift' || u.drift_status === 'conflict'
    );
  }

  /**
   * Returns units whose observed_status is not 'healthy'.
   */
  listUnhealthy() {
    return [...this._units.values()].filter((u) => u.observed_status !== 'healthy');
  }
}

module.exports = { ControlPlaneRegistry, createUnit };
