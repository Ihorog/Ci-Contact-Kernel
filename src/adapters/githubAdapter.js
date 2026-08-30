'use strict';

/**
 * GitHub adapter stub for Ci+ Control Plane.
 *
 * Semantic ownership: WORK/SOURCE_CONTROL for repos/code/PRs.
 * Role: source provenance, Cigrafin mailbox source, code change executor,
 *       CI/test evidence source.
 *
 * Actual GitHub API calls require GITHUB_TOKEN env var (reference only, never stored).
 */

const { BaseAdapter } = require('./baseAdapter');

class GitHubAdapter extends BaseAdapter {
  constructor() {
    super('github');
    this.version = '1.0.0';
  }

  /**
   * Observe GitHub connectivity and token health.
   * Returns status based on whether GITHUB_TOKEN ref is configured.
   */
  async observe(unit) {
    const hasTokenRef = !!(unit.credential_ref || process.env.GITHUB_TOKEN);
    return {
      status: hasTokenRef ? 'healthy' : 'unverified',
      evidence: {
        credential_ref_present: !!unit.credential_ref,
        token_env_configured: !!process.env.GITHUB_TOKEN,
        provider: 'github',
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
        { check: 'token_configured', passed: !!process.env.GITHUB_TOKEN },
      ],
      version: this.version,
    };
  }

  async plan(unit, desiredState) {
    return {
      actions: desiredState.desired_status === 'active'
        ? [{ action: 'verify', description: 'Verify GitHub token is valid and scopes are sufficient.' }]
        : [],
      version: this.version,
    };
  }

  /**
   * apply() requires an explicit approvalId.
   * External GitHub mutations are NOT executed without policy approval.
   */
  async apply(unit, action, approvalId) {
    if (!approvalId) {
      return { applied: false, result: null, error: 'approvalId required for GitHub write operations.', version: this.version };
    }
    return {
      applied: false,
      result: null,
      error: `Stub: action "${action}" on unit "${unit.name}" not yet wired to live GitHub API.`,
      version: this.version,
    };
  }
}

module.exports = { GitHubAdapter };
