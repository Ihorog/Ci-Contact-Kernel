'use strict';

/**
 * Base adapter interface for Ci+ Control Plane provider adapters.
 *
 * All provider adapters MUST implement:
 *   observe(unit)  → Promise<{ status, evidence, version }>
 *   verify(unit)   → Promise<{ verified, checks[], version }>
 *   plan(unit, desiredState) → Promise<{ actions[], version }>
 *   apply(unit, action) → Promise<{ applied, result, version }>  ← ALWAYS gated by policy
 *
 * NEVER store plaintext secrets. Credential references only.
 * apply() must NEVER be called without an approved policy decision.
 */

class BaseAdapter {
  constructor(name) {
    this.name = name;
    this.version = '1.0.0';
  }

  // eslint-disable-next-line no-unused-vars
  async observe(_unit) {
    throw new Error(`${this.name}: observe() not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async verify(_unit) {
    throw new Error(`${this.name}: verify() not implemented`);
  }

  // eslint-disable-next-line no-unused-vars
  async plan(_unit, _desiredState) {
    throw new Error(`${this.name}: plan() not implemented`);
  }

  /**
   * apply() MUST NOT be called without explicit policy/approval gate.
   * Implementations should always check that an approvalId is present.
   */
  // eslint-disable-next-line no-unused-vars
  async apply(_unit, _action, _approvalId) {
    throw new Error(`${this.name}: apply() not implemented`);
  }
}

module.exports = { BaseAdapter };
