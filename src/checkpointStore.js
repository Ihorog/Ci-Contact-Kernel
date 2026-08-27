/**
 * CheckpointStore – persists checkpoint state for tool-level approval/resume.
 *
 * A checkpoint captures everything required to resume a sensitive invocation
 * without replaying already-completed steps.
 */

const crypto = require('crypto');

function now() {
  return new Date().toISOString();
}

class CheckpointStore {
  constructor() {
    this.checkpoints = new Map();
  }

  /**
   * Create and persist a checkpoint for a task immediately before a sensitive
   * invocation.  Returns the checkpoint object.
   */
  create(task, context = {}) {
    const checkpoint = {
      id: crypto.randomUUID(),
      taskId: task.id,
      createdAt: now(),
      status: 'pending_approval',
      approvalDecision: null,
      approvalActor: null,
      approvalTimestamp: null,
      approvalReason: null,
      context,
      taskSnapshot: {
        status: task.status,
        executionCenter: task.executionCenter,
        executionCenters: task.executionCenters ? task.executionCenters.slice() : [],
        result: task.result,
        verificationResults: (task.verificationResults || []).slice()
      }
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    return checkpoint;
  }

  get(checkpointId) {
    return this.checkpoints.get(checkpointId) || null;
  }

  /**
   * Record an approval decision (approved | rejected).
   */
  decide(checkpointId, decision, actor = 'unknown', reason = '') {
    const cp = this.checkpoints.get(checkpointId);
    if (!cp) throw new Error(`Checkpoint not found: ${checkpointId}`);
    cp.approvalDecision = decision;
    cp.approvalActor = actor;
    cp.approvalTimestamp = now();
    cp.approvalReason = reason;
    cp.status = decision === 'approved' ? 'approved' : 'rejected';
    return cp;
  }

  all() {
    return Array.from(this.checkpoints.values());
  }
}

module.exports = { CheckpointStore };
