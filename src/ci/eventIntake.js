'use strict';

/**
 * Event Intake and Idempotency Ledger for Ci Code
 *
 * Normalizes GitHub & system events into canonical work units.
 * Guarantees idempotency: one problem = one correlation_id = one work unit.
 */

const { generateCorrelationId, buildCiContact } = require('./contracts');
const { RepoRegistry } = require('./repoRegistry');

class EventIntake {
  constructor(opts = {}) {
    this.repoRegistry = opts.repoRegistry || new RepoRegistry();
    /** Idempotency ledger: correlation_id -> canonical work unit */
    this.ledger = new Map();
    /** Event log for audit */
    this.eventHistory = [];
  }

  /**
   * Process incoming event payload.
   * If correlation_id already seen in ledger, return existing work unit marked duplicate.
   */
  intake(eventPayload = {}) {
    const contact = buildCiContact(eventPayload);
    const correlationId = contact.correlation_id;

    if (this.ledger.has(correlationId)) {
      const existing = this.ledger.get(correlationId);
      return {
        duplicate: true,
        correlation_id: correlationId,
        work_unit: existing,
        reason: `Duplicate event detected for correlation_id: ${correlationId}`
      };
    }

    const repoId = contact.repository_id;
    const repoInfo = this.repoRegistry.get(repoId) || {
      repository_id: repoId,
      role: 'PRODUCT',
      risk_class: 'R1',
      default_branch: 'main'
    };

    // Classify work type & risk class
    const workType = this.classifyWorkType(eventPayload);
    const riskClass = eventPayload.risk_class || repoInfo.risk_class || 'R1';

    const workUnit = {
      correlation_id: correlationId,
      repository_id: repoId,
      event_type: contact.event_type,
      work_type: workType,
      title: contact.title,
      risk_class: riskClass,
      role: repoInfo.role,
      payload: eventPayload,
      status: 'INTAKEN',
      received_at: contact.received_at,
      execution_history: []
    };

    this.ledger.set(correlationId, workUnit);
    this.eventHistory.push({
      timestamp: contact.received_at,
      correlation_id: correlationId,
      repository_id: repoId,
      event_type: contact.event_type
    });

    return {
      duplicate: false,
      correlation_id: correlationId,
      work_unit: workUnit,
      reason: 'New event intaken successfully'
    };
  }

  classifyWorkType(payload = {}) {
    const eventType = (payload.event_type || payload.type || '').toLowerCase();
    if (payload.pull_request || /pull_request|pr/.test(eventType)) return 'PULL_REQUEST';
    if (payload.issue || /issue/.test(eventType)) return 'ISSUE';
    if (payload.review || /review/.test(eventType)) return 'PR_REVIEW';
    if (payload.workflow_run || payload.check_run || /workflow|actions|check/.test(eventType)) return 'WORKFLOW_RUN';
    if (payload.deployment || /deployment/.test(eventType)) return 'DEPLOYMENT';
    if (payload.dependabot || /dependabot/.test(eventType)) return 'DEPENDENCY_UPDATE';
    if (payload.alert || /codeql|security|secret/.test(eventType)) return 'SECURITY_ALERT';
    if (payload.copilot || /copilot/.test(eventType)) return 'COPILOT_PROPOSAL';
    if (payload.drift || /drift/.test(eventType)) return 'REPOSITORY_DRIFT';
    return 'GENERIC_EVENT';
  }

  getWorkUnit(correlationId) {
    return this.ledger.get(correlationId) || null;
  }

  clear() {
    this.ledger.clear();
    this.eventHistory.clear();
  }
}

module.exports = { EventIntake };
