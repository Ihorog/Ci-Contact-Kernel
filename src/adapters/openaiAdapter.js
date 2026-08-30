'use strict';

/**
 * OpenAI adapter stub for Ci+ Control Plane.
 *
 * Role: OPTIONAL semantic enrichment for ambiguous/unstructured material.
 * Authority limits: AI output is source_type=ai / derived candidate.
 * AI may NOT approve external/physical/financial actions.
 * AI output is never automatically VERIFIED.
 *
 * Actual OpenAI API calls require OPENAI_API_KEY env var (reference only, never stored).
 */

const { BaseAdapter } = require('./baseAdapter');

class OpenAIAdapter extends BaseAdapter {
  constructor() {
    super('openai');
    this.version = '1.0.0';
  }

  async observe(unit) {
    const hasKeyRef = !!(unit.credential_ref || process.env.OPENAI_API_KEY);
    return {
      status: hasKeyRef ? 'healthy' : 'unverified',
      evidence: {
        credential_ref_present: !!unit.credential_ref,
        key_env_configured: !!process.env.OPENAI_API_KEY,
        provider: 'openai',
        note: 'Stub: actual API call requires live network access. AI output is derived/candidate only.',
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
        { check: 'key_configured', passed: !!process.env.OPENAI_API_KEY },
      ],
      version: this.version,
    };
  }

  async plan(_unit, _desiredState) {
    return {
      actions: [{ action: 'verify', description: 'Verify OpenAI API key validity.' }],
      version: this.version,
    };
  }

  /**
   * OpenAI adapter has no write apply operations for the control plane.
   * It is an enrichment source only.
   */
  async apply(_unit, action, _approvalId) {
    return {
      applied: false,
      result: null,
      error: `OpenAI adapter does not support apply() for action "${action}". It is an enrichment source only.`,
      version: this.version,
    };
  }
}

module.exports = { OpenAIAdapter };
