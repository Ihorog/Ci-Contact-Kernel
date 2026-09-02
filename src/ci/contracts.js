'use strict';

/**
 * Ci Code Canonical Minimal Contracts
 *
 * Implements:
 * - CiCoordinate: Canonical coordinate representation across Ihorog repos.
 * - CiCapability: Capability definition, manifest hashing, risk-class evaluation.
 * - CiContact: Idempotent intake contract & correlation_id generator.
 * - CiCompletion: Mechanical completion verifier extending completionContract.js.
 */

const crypto = require('node:crypto');
const { buildDefaultContract, runVerification, evaluatePolicy, recordVerifierResult } = require('../completionContract');
const { evaluatePermission } = require('../permissionGate');
const { VERIFIER_STATUS } = require('../constants');

function now() {
  return new Date().toISOString();
}

/**
 * ── CiCoordinate ─────────────────────────────────────────────────────────────
 */
function buildCoordinate(opts = {}) {
  const repositoryId = opts.repository_id || opts.repositoryId || 'Ihorog/Ci-Contact-Kernel';
  const domain = opts.domain || 'WORK/SOURCE_CONTROL';
  const pathStr = opts.path || '/';
  const ref = opts.ref || 'main';
  const stateHash = opts.state_hash || opts.stateHash || crypto.createHash('sha256').update(`${repositoryId}:${domain}:${pathStr}:${ref}`).digest('hex');

  return {
    repository_id: repositoryId,
    domain,
    path: pathStr,
    ref,
    state_hash: stateHash,
    created_at: opts.created_at || now()
  };
}

function validateCoordinate(coord) {
  if (!coord || typeof coord !== 'object') return false;
  if (!coord.repository_id || typeof coord.repository_id !== 'string') return false;
  if (!coord.domain || typeof coord.domain !== 'string') return false;
  if (!coord.ref || typeof coord.ref !== 'string') return false;
  return true;
}

/**
 * ── CiCapability ─────────────────────────────────────────────────────────────
 */
function buildCapability(opts = {}) {
  const capabilityId = opts.capability_id || opts.capabilityId || `cap-${crypto.randomUUID().slice(0, 8)}`;
  const name = opts.name || 'unnamed_capability';
  const version = opts.version || '1.0.0';
  const allowedActions = Array.isArray(opts.allowed_actions) ? opts.allowed_actions : (Array.isArray(opts.allowedActions) ? opts.allowedActions : ['read']);
  const riskClass = opts.risk_class || opts.riskClass || 'R1';
  const policyVersion = opts.policy_version || opts.policyVersion || 'v1';

  const manifest = { capabilityId, name, version, allowedActions, riskClass, policyVersion };
  const manifestHash = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

  return {
    capability_id: capabilityId,
    name,
    version,
    allowed_actions: allowedActions,
    risk_class: riskClass,
    policy_version: policyVersion,
    manifest_hash: opts.manifest_hash || manifestHash
  };
}

function computeCapabilityHash(capability) {
  if (!capability) return null;
  const payload = {
    capability_id: capability.capability_id,
    name: capability.name,
    version: capability.version,
    allowed_actions: capability.allowed_actions,
    risk_class: capability.risk_class,
    policy_version: capability.policy_version
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function evaluateCapabilityAccess(capability, action, targetRiskClass = 'R1') {
  if (!capability || !Array.isArray(capability.allowed_actions)) {
    return { allowed: false, reason: 'Invalid capability.' };
  }

  if (!capability.allowed_actions.includes(action) && !capability.allowed_actions.includes('*')) {
    return { allowed: false, reason: `Action "${action}" is not allowed by capability "${capability.name}".` };
  }

  // Risk class authority check: R3 operations require explicit R3 capability authorization
  const riskOrder = { R0: 0, R1: 1, R2: 2, R3: 3 };
  const capLevel = riskOrder[capability.risk_class] ?? 1;
  const targetLevel = riskOrder[targetRiskClass] ?? 1;

  if (targetLevel > capLevel) {
    return {
      allowed: false,
      reason: `Capability risk class ${capability.risk_class} insufficient for target risk class ${targetRiskClass}.`
    };
  }

  return { allowed: true, reason: 'Capability authorization valid.' };
}

/**
 * ── CiContact ────────────────────────────────────────────────────────────────
 */
function generateCorrelationId(eventPayload = {}) {
  const repo = eventPayload.repository?.full_name || eventPayload.repository_id || 'Ihorog/Ci-Contact-Kernel';
  const eventType = eventPayload.event_type || eventPayload.type || 'generic';
  
  // Extract canonical identifier key depending on event type
  let entityId = 'default';
  if (eventPayload.pull_request?.number) entityId = `pr-${eventPayload.pull_request.number}`;
  else if (eventPayload.issue?.number) entityId = `issue-${eventPayload.issue.number}`;
  else if (eventPayload.check_run?.id) entityId = `check-${eventPayload.check_run.id}`;
  else if (eventPayload.workflow_run?.id) entityId = `run-${eventPayload.workflow_run.id}`;
  else if (eventPayload.deployment?.id) entityId = `deploy-${eventPayload.deployment.id}`;
  else if (eventPayload.alert?.number) entityId = `alert-${eventPayload.alert.number}`;
  else if (eventPayload.head_commit?.id) entityId = `commit-${eventPayload.head_commit.id.slice(0, 10)}`;
  else if (eventPayload.title) entityId = `title-${crypto.createHash('sha256').update(eventPayload.title).digest('hex').slice(0, 10)}`;

  const canonicalKey = `${repo}:${eventType}:${entityId}`;
  const hash = crypto.createHash('sha256').update(canonicalKey).digest('hex').slice(0, 16);
  return `corr-${hash}`;
}

function buildCiContact(eventPayload = {}, opts = {}) {
  const correlationId = opts.correlation_id || generateCorrelationId(eventPayload);
  const repoId = eventPayload.repository?.full_name || eventPayload.repository_id || opts.repository_id || 'Ihorog/Ci-Contact-Kernel';
  const eventType = eventPayload.event_type || eventPayload.type || 'generic';

  return {
    correlation_id: correlationId,
    repository_id: repoId,
    event_type: eventType,
    title: eventPayload.title || eventPayload.issue?.title || eventPayload.pull_request?.title || `Event ${eventType} on ${repoId}`,
    payload: eventPayload,
    received_at: opts.received_at || now(),
    status: 'RECEIVED'
  };
}

/**
 * ── CiCompletion ─────────────────────────────────────────────────────────────
 */
class CiCompletion {
  constructor(opts = {}) {
    this.requiredVerifiers = opts.requiredVerifiers || ['result_outcome', 'final_sha_verified', 'evidence_verified'];
    this.maxVerificationRetries = typeof opts.maxVerificationRetries === 'number' ? opts.maxVerificationRetries : 2;
  }

  createTaskContract(task) {
    if (!task.requiredVerifiers) {
      task.requiredVerifiers = [...this.requiredVerifiers];
    }
    if (typeof task.maxVerificationRetries !== 'number') {
      task.maxVerificationRetries = this.maxVerificationRetries;
    }
    if (!Array.isArray(task.verificationResults)) {
      task.verificationResults = [];
    }
    return task;
  }

  verifyTask(task, executionResult, evidence = {}) {
    this.createTaskContract(task);
    task.verificationAttempt = (task.verificationAttempt || 0) + 1;

    // 1. Result outcome verifier
    const outcomeStatus = executionResult && executionResult.status === 'SUCCESS' ? VERIFIER_STATUS.PASS : (executionResult && executionResult.outcome === 'ok' ? VERIFIER_STATUS.PASS : VERIFIER_STATUS.FAIL);
    recordVerifierResult(task, 'result_outcome', outcomeStatus, { summary: executionResult?.summary });

    // 2. Final SHA verifier
    if (this.requiredVerifiers.includes('final_sha_verified')) {
      const shaStatus = evidence.final_sha || evidence.last_verified_sha ? VERIFIER_STATUS.PASS : VERIFIER_STATUS.FAIL;
      recordVerifierResult(task, 'final_sha_verified', shaStatus, { final_sha: evidence.final_sha || evidence.last_verified_sha || null });
    }

    // 3. Evidence verifier
    if (this.requiredVerifiers.includes('evidence_verified')) {
      const evStatus = evidence.evidence_refs && evidence.evidence_refs.length > 0 ? VERIFIER_STATUS.PASS : (evidence.passed !== false ? VERIFIER_STATUS.PASS : VERIFIER_STATUS.FAIL);
      recordVerifierResult(task, 'evidence_verified', evStatus, { evidence_refs: evidence.evidence_refs || [] });
    }

    // Evaluate overall policy
    const policyEval = evaluatePolicy(task);
    const canComplete = policyEval.passed;
    const exhausted = !canComplete && task.verificationAttempt > task.maxVerificationRetries;

    if (exhausted) {
      task.incidentRecord = {
        id: crypto.randomUUID(),
        timestamp: now(),
        taskId: task.id,
        reason: policyEval.reason,
        attempts: task.verificationAttempt,
        verificationResults: [...task.verificationResults]
      };
      // For self-modified instruction tasks: trigger automatic rollback status flag
      if (task.isSelfModifiedInstruction) {
        task.rollbackTriggered = true;
        task.rollbackReason = `Self-modified instruction failed verification after ${task.verificationAttempt} attempts: ${policyEval.reason}`;
      }
    }

    return {
      canComplete,
      exhausted,
      policyResult: policyEval,
      rollbackTriggered: !!task.rollbackTriggered,
      rollbackReason: task.rollbackReason || null
    };
  }
}

module.exports = {
  buildCoordinate,
  validateCoordinate,
  buildCapability,
  computeCapabilityHash,
  evaluateCapabilityAccess,
  generateCorrelationId,
  buildCiContact,
  CiCompletion
};
