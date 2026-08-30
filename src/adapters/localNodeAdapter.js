'use strict';

/**
 * Local node adapter for Ci+ Control Plane (Orange Pi / NAS / Cihub node).
 *
 * Role: local-first execution and observation, device/home-service adapters,
 *       local evidence/raw binary storage, backup and private data boundary.
 *
 * Authority: physical action completed only with actual executor + verification evidence.
 * Unavailable executor → BLOCKED, never simulated completion.
 */

const { BaseAdapter } = require('./baseAdapter');

class LocalNodeAdapter extends BaseAdapter {
  constructor() {
    super('local');
    this.version = '1.0.0';
  }

  async observe(unit) {
    // In a real implementation this would ping the local node over internal network.
    return {
      status: 'unverified',
      evidence: {
        provider: 'local',
        node_ref: unit.service_ref || unit.name,
        note: 'Stub: local node health check requires live node connectivity.',
      },
      version: this.version,
    };
  }

  async verify(unit) {
    return {
      verified: false,
      checks: [
        { check: 'node_reachable', passed: false, note: 'Stub: requires live network.' },
        { check: 'executor_present', passed: false, note: 'Physical executor verification not implemented in stub.' },
      ],
      version: this.version,
    };
  }

  async plan(unit, desiredState) {
    if (desiredState.desired_status === 'active') {
      return {
        actions: [
          { action: 'verify', description: `Verify local node "${unit.name}" is online and executor is present.` },
        ],
        version: this.version,
      };
    }
    return { actions: [], version: this.version };
  }

  async apply(unit, action, approvalId) {
    if (!approvalId) {
      return { applied: false, result: null, error: 'approvalId required for local node write operations.', version: this.version };
    }
    // Physical actions require real executor
    return {
      applied: false,
      result: null,
      error: `Stub: local node action "${action}" on "${unit.name}" requires physical executor confirmation. Status: BLOCKED.`,
      version: this.version,
    };
  }
}

module.exports = { LocalNodeAdapter };
