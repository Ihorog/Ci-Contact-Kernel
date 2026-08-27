/**
 * Mechanical Completion Contract
 *
 * COMPLETED is unreachable unless all required verifiers pass according to the
 * completion policy.  Failed verification retries up to maxVerificationRetries;
 * exhausted retries record an incident and transition to VERIFICATION_FAILED.
 */

const crypto = require('crypto');
const { COMPLETION_POLICIES, VERIFIER_STATUS } = require('./constants');

function now() {
  return new Date().toISOString();
}

/**
 * Build a default completion contract for a task.
 * Callers may inject custom requiredVerifiers.
 */
function buildDefaultContract(opts = {}) {
  return {
    completionPolicy: opts.completionPolicy || COMPLETION_POLICIES.ALL_VERIFIERS,
    requiredVerifiers: opts.requiredVerifiers || ['result_outcome'],
    verificationResults: [],
    verificationAttempt: 0,
    maxVerificationRetries: typeof opts.maxVerificationRetries === 'number' ? opts.maxVerificationRetries : 2,
    incidentRecord: null
  };
}

/**
 * Record a verifier result into a task's contract.
 */
function recordVerifierResult(task, verifierId, status, evidence = null, meta = {}) {
  const entry = {
    id: crypto.randomUUID(),
    verifierId,
    type: meta.type || verifierId,
    status,
    timestamp: now(),
    evidence,
    version: meta.version || null,
    hash: meta.hash || null
  };
  task.verificationResults.push(entry);
  return entry;
}

/**
 * Evaluate whether the completion policy passes.
 * Returns { passed: boolean, reason: string }.
 */
function evaluatePolicy(task) {
  const required = task.requiredVerifiers || [];
  const results = task.verificationResults || [];
  const policy = task.completionPolicy || COMPLETION_POLICIES.ALL_VERIFIERS;

  const byVerifier = {};
  for (const r of results) {
    byVerifier[r.verifierId] = r.status;
  }

  if (policy === COMPLETION_POLICIES.ALL_VERIFIERS) {
    const failing = required.filter((v) => byVerifier[v] !== VERIFIER_STATUS.PASS);
    if (failing.length > 0) {
      return { passed: false, reason: `Verifiers not passing: ${failing.join(', ')}` };
    }
    return { passed: true, reason: 'All required verifiers passed.' };
  }

  if (policy === COMPLETION_POLICIES.ANY_VERIFIER) {
    const passing = required.filter((v) => byVerifier[v] === VERIFIER_STATUS.PASS);
    if (passing.length === 0) {
      return { passed: false, reason: 'No required verifier passed.' };
    }
    return { passed: true, reason: `Verifier(s) passed: ${passing.join(', ')}` };
  }

  return { passed: false, reason: `Unknown completion policy: ${policy}` };
}

/**
 * Run the verification step for a task given its execution result.
 * Returns: { canComplete, exhausted, policyResult }
 */
function runVerification(task, result) {
  task.verificationAttempt = (task.verificationAttempt || 0) + 1;

  const status = result && result.outcome === 'ok' ? VERIFIER_STATUS.PASS : VERIFIER_STATUS.FAIL;
  recordVerifierResult(task, 'result_outcome', status, { outcome: result && result.outcome }, {
    type: 'result_outcome'
  });

  const policyResult = evaluatePolicy(task);

  if (policyResult.passed) {
    return { canComplete: true, exhausted: false, policyResult };
  }

  const maxRetries = typeof task.maxVerificationRetries === 'number' ? task.maxVerificationRetries : 2;
  const exhausted = task.verificationAttempt > maxRetries;

  if (exhausted) {
    task.incidentRecord = {
      id: crypto.randomUUID(),
      timestamp: now(),
      taskId: task.id,
      reason: policyResult.reason,
      verificationAttempt: task.verificationAttempt,
      verificationResults: task.verificationResults.slice()
    };
  }

  return { canComplete: false, exhausted, policyResult };
}

module.exports = { buildDefaultContract, recordVerifierResult, evaluatePolicy, runVerification };
