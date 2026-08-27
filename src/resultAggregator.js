/**
 * ResultAggregator – aggregates multi-branch results according to a policy.
 *
 * Supported policies:
 *   all_required – all branches must succeed
 *   any_success  – at least one branch must succeed
 *   quorum       – majority of branches must succeed
 *   best_effort  – aggregates whatever succeeded; never fails the whole task
 */

const { AGGREGATION_POLICIES } = require('./constants');

/**
 * Aggregate an array of branch result objects.
 * Each branch: { id, executionCenter, status, result, error }
 * Returns: { policy, summary, outcome, partialResults, conflict }
 */
function aggregate(branches, policy = AGGREGATION_POLICIES.ALL_REQUIRED) {
  const total = branches.length;
  const succeeded = branches.filter((b) => b.status === 'success');
  const failed = branches.filter((b) => b.status === 'failed');
  const blocked = branches.filter((b) => b.status === 'blocked');
  const pending = branches.filter((b) => b.status === 'pending');

  const partialResults = branches.map((b) => ({
    id: b.id,
    executionCenter: b.executionCenter,
    status: b.status,
    result: b.result || null,
    error: b.error || null,
    verification: b.verification || null,
    checkpointId: b.checkpointId || null,
    approvalState: b.approvalState || null
  }));

  let outcome;
  let conflictReason = null;

  if (policy === AGGREGATION_POLICIES.ALL_REQUIRED) {
    if (failed.length > 0 || blocked.length > 0) {
      outcome = 'failed';
      conflictReason = `${failed.length} branch(es) failed, ${blocked.length} branch(es) blocked of ${total}.`;
    } else if (pending.length > 0) {
      outcome = 'pending';
    } else {
      outcome = 'success';
    }
  } else if (policy === AGGREGATION_POLICIES.ANY_SUCCESS) {
    if (succeeded.length > 0) {
      outcome = 'success';
    } else if (pending.length > 0) {
      outcome = 'pending';
    } else {
      outcome = 'failed';
      conflictReason = `No branch succeeded (${total} total).`;
    }
  } else if (policy === AGGREGATION_POLICIES.QUORUM) {
    const quorum = Math.floor(total / 2) + 1;
    if (succeeded.length >= quorum) {
      outcome = 'success';
    } else if (pending.length > 0 && succeeded.length + pending.length >= quorum) {
      outcome = 'pending';
    } else {
      outcome = 'failed';
      conflictReason = `Quorum not met: ${succeeded.length}/${quorum} required.`;
    }
  } else if (policy === AGGREGATION_POLICIES.BEST_EFFORT) {
    outcome = pending.length > 0 ? 'pending' : 'success';
  } else {
    outcome = 'failed';
    conflictReason = `Unknown aggregation policy: ${policy}`;
  }

  return {
    policy,
    total,
    succeeded: succeeded.length,
    failed: failed.length,
    blocked: blocked.length,
    pending: pending.length,
    outcome,
    conflict: conflictReason ? { reason: conflictReason } : null,
    partialResults
  };
}

module.exports = { aggregate };
