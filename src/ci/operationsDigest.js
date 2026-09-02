'use strict';

/**
 * GitHub Operations Digest & Notification Noise Consolidation
 *
 * Implements:
 * 1. Single GitHub Operations Digest consolidating merged/fixed PRs, security state,
 *    final SHA/evidence, external gates, and action items for owner.
 * 2. Suppression of notification noise (successful CI, standard merge, dependency PR, rerun, transient recovery, Copilot proposal).
 * 3. Immediate notification filtering for critical triggers only:
 *    - security_incident
 *    - secret_exposure
 *    - production_outage
 *    - r3_authorization
 *    - finance_legal_risk
 *    - unrecoverable_blocker
 * 4. Explicit markers for EXTERNAL_GATE_NOTIFICATION_SETTINGS and EXTERNAL_GATE_CROSS_REPO_PERMISSIONS.
 */

function now() {
  return new Date().toISOString();
}

const IMMEDIATE_TRIGGERS = new Set([
  'security_incident',
  'secret_exposure',
  'production_outage',
  'r3_authorization',
  'finance_legal_risk',
  'unrecoverable_blocker'
]);

const NOISE_EVENT_TYPES = new Set([
  'ci_success',
  'standard_merge',
  'dependency_pr_merged',
  'ci_rerun',
  'transient_recovery',
  'copilot_proposal'
]);

const KNOWN_EXTERNAL_GATES = Object.freeze({
  NOTIFICATION_SETTINGS: 'EXTERNAL_GATE_NOTIFICATION_SETTINGS',
  CROSS_REPO_PERMISSIONS: 'EXTERNAL_GATE_CROSS_REPO_PERMISSIONS'
});

class OperationsDigest {
  constructor() {
    this.mergedFixed = [];
    this.securityState = {
      openAlerts: 0,
      resolvedAlerts: 0,
      incidents: []
    };
    this.finalShaByRepo = new Map();
    this.evidenceLedger = [];
    this.decisionsRequiringOwner = [];
    this.immediateAlerts = [];
    this.suppressedNoiseCount = 0;
  }

  /**
   * Process an action event into digest or immediate alert based on policy.
   */
  processEvent(event = {}) {
    const trigger = event.immediate_trigger || event.trigger;

    // Check if event qualifies for immediate notification
    if (trigger && IMMEDIATE_TRIGGERS.has(trigger)) {
      const alert = {
        timestamp: now(),
        trigger,
        repository_id: event.repository_id || 'Ihorog/Ci-Contact-Kernel',
        title: event.title || `Critical trigger: ${trigger}`,
        details: event.details || {},
        externalGate: event.externalGate || (trigger === 'r3_authorization' ? KNOWN_EXTERNAL_GATES.CROSS_REPO_PERMISSIONS : null)
      };
      this.immediateAlerts.push(alert);
      return { action: 'IMMEDIATE_NOTIFICATION_SENT', alert };
    }

    // Check if event is noise to be suppressed from individual notification
    const isNoise = NOISE_EVENT_TYPES.has(event.event_type) || NOISE_EVENT_TYPES.has(event.type);
    if (isNoise) {
      this.suppressedNoiseCount++;
    }

    // Record into digest categories
    if (event.status === 'MERGED' || event.status === 'FIXED' || event.merged) {
      this.mergedFixed.push({
        repository_id: event.repository_id,
        title: event.title || 'Merged work unit',
        correlation_id: event.correlation_id,
        timestamp: now()
      });
    }

    if (event.final_sha) {
      this.finalShaByRepo.set(event.repository_id, {
        sha: event.final_sha,
        timestamp: now()
      });
    }

    if (event.evidence) {
      this.evidenceLedger.push({
        repository_id: event.repository_id,
        evidence: event.evidence,
        timestamp: now()
      });
    }

    if (event.requiresOwnerDecision || event.authorization?.requiresApproval) {
      this.decisionsRequiringOwner.push({
        repository_id: event.repository_id,
        title: event.title || 'Owner approval required',
        reason: event.reason || event.authorization?.reason,
        externalGate: event.externalGate || KNOWN_EXTERNAL_GATES.CROSS_REPO_PERMISSIONS,
        timestamp: now()
      });
    }

    return { action: 'RECORDED_IN_DIGEST', suppressed: isNoise };
  }

  updateSecurityState(state = {}) {
    if (typeof state.openAlerts === 'number') this.securityState.openAlerts = state.openAlerts;
    if (typeof state.resolvedAlerts === 'number') this.securityState.resolvedAlerts = state.resolvedAlerts;
    if (Array.isArray(state.incidents)) this.securityState.incidents = state.incidents;
  }

  generateDigestSummary() {
    const finalShas = {};
    for (const [repo, data] of this.finalShaByRepo.entries()) {
      finalShas[repo] = data.sha;
    }

    return {
      generated_at: now(),
      summary: {
        total_merged_fixed: this.mergedFixed.length,
        suppressed_noise_notifications: this.suppressedNoiseCount,
        decisions_requiring_owner: this.decisionsRequiringOwner.length,
        immediate_alerts_triggered: this.immediateAlerts.length
      },
      merged_fixed: this.mergedFixed,
      security_state: this.securityState,
      final_sha_by_repository: finalShas,
      evidence_ledger_count: this.evidenceLedger.length,
      external_gates: [
        {
          id: KNOWN_EXTERNAL_GATES.NOTIFICATION_SETTINGS,
          description: 'GitHub account notification settings consolidation (EXTERNAL_GATE)',
          status: 'ACTIVE_DIGEST_ONLY'
        },
        {
          id: KNOWN_EXTERNAL_GATES.CROSS_REPO_PERMISSIONS,
          description: 'Cross-repository GitHub token/app permission boundaries (EXTERNAL_GATE)',
          status: 'ENFORCED'
        }
      ],
      decisions_requiring_owner: this.decisionsRequiringOwner,
      immediate_alerts: this.immediateAlerts
    };
  }
}

module.exports = {
  OperationsDigest,
  IMMEDIATE_TRIGGERS,
  NOISE_EVENT_TYPES,
  KNOWN_EXTERNAL_GATES
};
