'use strict';

/**
 * Vercel adapter stub for Ci+ Control Plane.
 *
 * Semantic ownership: WORK/DEPLOYMENT for deployments/projects.
 * Role: edge deployment executor, project/domain health source.
 *
 * Actual Vercel API calls require VERCEL_TOKEN env var (reference only).
 */

const { BaseAdapter } = require('./baseAdapter');

class VercelAdapter extends BaseAdapter {
  constructor() {
    super('vercel');
    this.version = '1.0.0';
  }

  async observe(unit) {
    const hasTokenRef = !!(unit.credential_ref || process.env.VERCEL_TOKEN);
    return {
      status: hasTokenRef ? 'healthy' : 'unverified',
      evidence: {
        credential_ref_present: !!unit.credential_ref,
        token_env_configured: !!process.env.VERCEL_TOKEN,
        provider: 'vercel',
        note: 'Stub: actual API call requires live network access.',
      },
      version: this.version,
    };
  }

  async verify(unit) {
    const obs = await this.observe(unit);
    return {
      verified: obs.status === 'healthy',
      checks: [
        { check: 'credential_ref_present', passed: !!unit.credential_ref },
        { check: 'token_configured', passed: !!process.env.VERCEL_TOKEN },
      ],
      version: this.version,
    };
  }

  async plan(unit, desiredState) {
    return {
      actions: desiredState.desired_status === 'active'
        ? [{ action: 'verify', description: 'Verify Vercel token and project access.' }]
        : [],
      version: this.version,
    };
  }

  async apply(unit, action, approvalId) {
    if (!approvalId) {
      return { applied: false, result: null, error: 'approvalId required for Vercel write operations.', version: this.version };
    }
    return {
      applied: false,
      result: null,
      error: `Stub: action "${action}" on unit "${unit.name}" not yet wired to live Vercel API.`,
      version: this.version,
    };
  }
}

module.exports = { VercelAdapter };
