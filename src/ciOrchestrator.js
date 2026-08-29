const crypto = require('crypto');
const path = require('path');
const ciHub = require('./ciHub');
const { classifySignal } = require('./classifier');
const { routeTask } = require('./router');
const { evaluatePermission } = require('./permissionGate');
const { MemoryStore } = require('./memoryStore');
const { CheckpointStore } = require('./checkpointStore');
const { buildDefaultContract, runVerification } = require('./completionContract');
const { aggregate } = require('./resultAggregator');
const {
  TASK_STATUS,
  EXECUTION_CENTERS,
  PERMISSION_LEVELS,
  CLASSIFICATIONS,
  AGGREGATION_POLICIES,
  APPROVAL_POLICIES
} = require('./constants');

const SENSITIVE_CENTERS = new Set([
  EXECUTION_CENTERS.SERVICE,
  EXECUTION_CENTERS.REPO,
  EXECUTION_CENTERS.DEVICE,
  EXECUTION_CENTERS.HUMAN
]);

const CLASSIFICATION_PERMISSION_MAP = {
  [CLASSIFICATIONS.DEPLOY_ACTION]: PERMISSION_LEVELS.L5_DEPLOY_OR_DEVICE_ACTION,
  [CLASSIFICATIONS.DEVICE_ACTION]: PERMISSION_LEVELS.L5_DEPLOY_OR_DEVICE_ACTION,
  [CLASSIFICATIONS.SERVICE_ACTION]: PERMISSION_LEVELS.L4_EXTERNAL_API_WRITE,
  [CLASSIFICATIONS.REPO_ACTION]: PERMISSION_LEVELS.L3_REPO_WRITE,
  [CLASSIFICATIONS.HUMAN_ACTION]: PERMISSION_LEVELS.L2_LOCAL_WRITE,
  [CLASSIFICATIONS.TASK]: PERMISSION_LEVELS.L1_DRAFT
};

function inferPermissionLevel(classification) {
  return CLASSIFICATION_PERMISSION_MAP[classification] || PERMISSION_LEVELS.L0_READ;
}

function now() {
  return new Date().toISOString();
}

function nextId() {
  return crypto.randomUUID();
}

class CiOrchestrator {
  constructor(options = {}) {
    this.tasks = new Map();
    this.maxTasksInMemory = options.maxTasksInMemory || 2000;
    this.queue = [];
    this.activeTaskId = null;
    const runtimeMemoryPath = process.env.VERCEL
      ? path.resolve('/tmp/ci-contact-kernel/ci-memory.jsonl')
      : path.resolve(process.cwd(), 'data/ci-memory.jsonl');
    this.memoryStore = new MemoryStore(options.memoryFilePath || runtimeMemoryPath);
    this.checkpointStore = new CheckpointStore();
    this.permissions = {
      localWrite: false,
      repoWrite: false,
      externalApiWrite: false,
      deployOrDeviceConfirm: false,
      ...(options.permissions || {})
    };
    this.worker = null;

    ciHub.registerModule('orchestrator', {
      createTask: this.createTask.bind(this),
      runTask: this.runTaskNow.bind(this)
    });
  }

  startWorker(intervalMs = 500) {
    if (this.worker) return;
    this.worker = setInterval(async () => {
      try {
        await this.processNext();
      } catch (error) {
        console.error('Ci worker error:', error);
      }
    }, intervalMs);
  }

  stopWorker() {
    if (this.worker) {
      clearInterval(this.worker);
      this.worker = null;
    }
  }

  transition(task, nextStatus, patch = {}) {
    const prev = task.status;
    const timestamp = now();
    task.status = nextStatus;
    task.updatedAt = timestamp;
    Object.assign(task, patch);

    this.memoryStore.append({
      timestamp,
      taskId: task.id,
      signal: task.payload,
      classification: task.classification,
      node: task.targetNode,
      executionCenter: task.executionCenter,
      executionCenters: task.executionCenters,
      permissionDecision: task.permissionDecision,
      statusBefore: prev,
      statusAfter: nextStatus,
      result: task.result,
      verification: task.verification,
      verificationResults: task.verificationResults,
      incidentRecord: task.incidentRecord,
      branches: task.branches,
      checkpointId: task.checkpointId,
      approvalState: task.approvalState,
      error: task.error,
      nextSuggestedAction: task.nextSuggestedAction
    });

    ciHub.emit('task.status.changed', { taskId: task.id, from: prev, to: nextStatus, task });
  }

  createTask(input = {}, source = 'api', shouldQueue = true) {
    const timestamp = now();
    const contract = buildDefaultContract({
      completionPolicy: input.completionPolicy,
      requiredVerifiers: input.requiredVerifiers,
      maxVerificationRetries: input.maxVerificationRetries
    });

    const approvalPolicy = input.approvalPolicy || null;

    const task = {
      id: nextId(),
      createdAt: timestamp,
      updatedAt: timestamp,
      source,
      signalId: input.signalId || null,
      type: input.type || 'signal',
      priority: input.priority || 'normal',
      status: TASK_STATUS.CREATED,
      classification: null,
      targetNode: null,
      executionCenter: null,
      executionCenters: [],
      requestedAction: input.requestedAction || input.action || null,
      permissionLevel: input.permissionLevel || PERMISSION_LEVELS.L0_READ,
      permissionDecision: 'PENDING',
      approvalPolicy,
      approvalState: null,
      checkpointId: null,
      payload: input,
      result: null,
      verification: {
        status: 'unknown',
        method: 'none'
      },
      // Completion contract fields
      completionPolicy: contract.completionPolicy,
      requiredVerifiers: contract.requiredVerifiers,
      verificationResults: contract.verificationResults,
      verificationAttempt: contract.verificationAttempt,
      maxVerificationRetries: contract.maxVerificationRetries,
      incidentRecord: contract.incidentRecord,
      // Multi-target fields
      aggregationPolicy: input.aggregationPolicy || AGGREGATION_POLICIES.ALL_REQUIRED,
      branches: [],
      aggregationSummary: null,
      error: null,
      memoryRecordId: null,
      nextSuggestedAction: null
    };

    this.tasks.set(task.id, task);
    this.pruneTasksIfNeeded();

    task.classification = classifySignal(input);
    if (!input.permissionLevel) {
      task.permissionLevel = inferPermissionLevel(task.classification);
    }
    this.transition(task, TASK_STATUS.CLASSIFIED);

    const route = routeTask(task);
    this.transition(task, TASK_STATUS.ROUTED, {
      targetNode: route.targetNode,
      executionCenter: route.executionCenter,
      executionCenters: route.executionCenters
    });

    this.evaluateAndQueueTask(task, shouldQueue);

    return task;
  }

  evaluateAndQueueTask(task, shouldQueue, permissionContext = this.permissions) {
    this.transition(task, TASK_STATUS.WAITING_PERMISSION);
    const decision = evaluatePermission(task, permissionContext);
    task.permissionDecision = `${decision.decision}: ${decision.reason}`;

    if (!decision.allowed) {
      task.verification = {
        status: 'blocked',
        method: 'manual_confirmation_required'
      };
      task.nextSuggestedAction = 'Provide required permission override and rerun task.';
      this.transition(task, TASK_STATUS.BLOCKED);
      return;
    }

    if (shouldQueue) {
      this.queue.push(task.id);
      this.transition(task, TASK_STATUS.QUEUED);
    }
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  recentTasks(limit = 50) {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Number(limit) || 50));
  }

  pruneTasksIfNeeded() {
    if (this.tasks.size <= this.maxTasksInMemory) return;
    const overflow = this.tasks.size - this.maxTasksInMemory;
    const oldIds = Array.from(this.tasks.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, overflow)
      .map((task) => task.id);
    oldIds.forEach((id) => this.tasks.delete(id));
    this.queue = this.queue.filter((id) => !oldIds.includes(id));
  }

  async processNext() {
    if (this.activeTaskId || this.queue.length === 0) return;

    const taskId = this.queue.shift();
    const task = this.getTask(taskId);
    if (!task) return;
    if (task.status !== TASK_STATUS.QUEUED) return;

    this.activeTaskId = task.id;
    try {
      await this.executeTask(task);
    } finally {
      this.activeTaskId = null;
    }
  }

  async runTaskNow(taskId, permissionOverrides = {}) {
    const task = this.getTask(taskId);
    if (!task) return null;
    if ([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.VERIFICATION_FAILED, TASK_STATUS.UNKNOWN].includes(task.status)) {
      task.nextSuggestedAction = 'Create a new task to execute this action again.';
      return task;
    }

    const permissionContext = { ...this.permissions, ...permissionOverrides };
    const decision = evaluatePermission(task, permissionContext);
    task.permissionDecision = `${decision.decision}: ${decision.reason}`;
    if (!decision.allowed) {
      task.verification = {
        status: 'blocked',
        method: 'manual_confirmation_required'
      };
      task.nextSuggestedAction = 'Grant required permission and retry.';
      this.transition(task, TASK_STATUS.BLOCKED);
      return task;
    }

    if (task.status === TASK_STATUS.RUNNING || task.status === TASK_STATUS.VERIFYING) {
      await this.waitForTaskToSettle(task.id);
      return this.getTask(task.id);
    }

    if (task.status !== TASK_STATUS.QUEUED) {
      this.transition(task, TASK_STATUS.QUEUED);
      this.queue.push(task.id);
    }

    if (this.activeTaskId && this.activeTaskId !== task.id) {
      return this.getTask(task.id);
    }

    await this.processNext();
    const settled = await this.waitForTaskToSettle(task.id);
    if (!settled) {
      const latest = this.getTask(task.id);
      if (latest) {
        latest.nextSuggestedAction = 'Execution still in progress. Poll task status or /ci/tasks.';
      }
    }
    return this.getTask(task.id);
  }

  /**
   * Approve a pending checkpoint, then resume execution of the associated task.
   */
  async approveTask(taskId, checkpointId, actor = 'unknown', reason = '') {
    const task = this.getTask(taskId);
    if (!task) return null;

    const cp = this.checkpointStore.get(checkpointId);
    if (!cp || cp.taskId !== taskId) {
      return { error: 'Checkpoint not found or does not belong to this task.' };
    }

    this.checkpointStore.decide(checkpointId, 'approved', actor, reason);
    task.approvalState = 'approved';

    this.memoryStore.append({
      timestamp: now(),
      taskId,
      event: 'approval_decision',
      decision: 'approved',
      actor,
      reason,
      checkpointId
    });

    if (task.status === TASK_STATUS.WAITING_APPROVAL) {
      this.transition(task, TASK_STATUS.QUEUED);
      this.queue.push(task.id);
      if (!this.activeTaskId) {
        await this.processNext();
        await this.waitForTaskToSettle(task.id);
      }
    }

    return this.getTask(taskId);
  }

  /**
   * Reject a pending checkpoint — task transitions to BLOCKED with an auditable reason.
   */
  rejectTask(taskId, checkpointId, actor = 'unknown', reason = '') {
    const task = this.getTask(taskId);
    if (!task) return null;

    const cp = this.checkpointStore.get(checkpointId);
    if (!cp || cp.taskId !== taskId) {
      return { error: 'Checkpoint not found or does not belong to this task.' };
    }

    this.checkpointStore.decide(checkpointId, 'rejected', actor, reason);
    task.approvalState = 'rejected';
    task.nextSuggestedAction = `Approval rejected by ${actor}: ${reason}`;

    this.memoryStore.append({
      timestamp: now(),
      taskId,
      event: 'approval_decision',
      decision: 'rejected',
      actor,
      reason,
      checkpointId
    });

    this.transition(task, TASK_STATUS.BLOCKED);
    return task;
  }

  async waitForTaskToSettle(taskId, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = this.getTask(taskId);
      if (!task) return true;
      if (![TASK_STATUS.QUEUED, TASK_STATUS.RUNNING, TASK_STATUS.VERIFYING].includes(task.status)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!this.activeTaskId || this.activeTaskId === taskId) {
        await this.processNext();
      }
    }
    return false;
  }

  _requiresApproval(task, center) {
    if (task.approvalPolicy === APPROVAL_POLICIES.AUTO) return false;
    if (task.approvalPolicy === APPROVAL_POLICIES.REQUIRE_HUMAN) return true;
    return SENSITIVE_CENTERS.has(center);
  }

  async executeTask(task) {
    this.transition(task, TASK_STATUS.RUNNING);

    const centers = task.executionCenters && task.executionCenters.length > 0
      ? task.executionCenters
      : [task.executionCenter];

    if (centers.length > 1) {
      await this._executeMultiBranch(task, centers);
      return;
    }

    await this._executeSingleBranch(task, centers[0]);
  }

  async _executeSingleBranch(task, center) {
    if (this._requiresApproval(task, center) && task.approvalState !== 'approved') {
      const cp = this.checkpointStore.create(task, { center, phase: 'pre_execution' });
      task.checkpointId = cp.id;
      task.approvalState = 'pending';
      task.nextSuggestedAction = `Sensitive execution requires approval. POST /ci/task/${task.id}/approve with checkpointId=${cp.id}`;

      this.memoryStore.append({
        timestamp: now(),
        taskId: task.id,
        event: 'approval_requested',
        checkpointId: cp.id,
        center
      });

      this.transition(task, TASK_STATUS.WAITING_APPROVAL);
      return;
    }

    const result = await this._runHandler(center, task);
    task.result = result;

    this.transition(task, TASK_STATUS.VERIFYING);
    await this._applyVerificationAndComplete(task, result);
  }

  async _executeMultiBranch(task, centers) {
    if (task.branches.length === 0) {
      task.branches = centers.map((center) => ({
        id: nextId(),
        executionCenter: center,
        status: 'pending',
        result: null,
        error: null,
        verification: null,
        checkpointId: null,
        approvalState: null
      }));
    }

    for (const branch of task.branches) {
      if (branch.status !== 'pending') continue;

      if (this._requiresApproval(task, branch.executionCenter) && branch.approvalState !== 'approved') {
        const cp = this.checkpointStore.create(task, {
          branchId: branch.id,
          center: branch.executionCenter,
          phase: 'pre_execution'
        });
        branch.checkpointId = cp.id;
        branch.approvalState = 'pending';
        branch.status = 'waiting_approval';

        this.memoryStore.append({
          timestamp: now(),
          taskId: task.id,
          event: 'approval_requested',
          checkpointId: cp.id,
          branchId: branch.id,
          center: branch.executionCenter
        });
        continue;
      }

      const result = await this._runHandler(branch.executionCenter, task);
      branch.result = result;

      const verif = runVerification(
        { ...task, result },
        result
      );

      branch.verification = {
        passed: verif.canComplete,
        policyResult: verif.policyResult,
        exhausted: verif.exhausted
      };
      branch.status = result.outcome === 'ok' ? 'success' : (result.outcome === 'stub' ? 'blocked' : 'failed');
    }

    const waitingApproval = task.branches.some((b) => b.status === 'waiting_approval');
    if (waitingApproval) {
      const pendingIds = task.branches
        .filter((b) => b.status === 'waiting_approval')
        .map((b) => b.checkpointId);
      task.nextSuggestedAction = `Branches awaiting approval. Approve checkpoints: ${pendingIds.join(', ')}`;
      this.transition(task, TASK_STATUS.WAITING_APPROVAL);
      return;
    }

    this.transition(task, TASK_STATUS.VERIFYING);

    const summary = aggregate(task.branches, task.aggregationPolicy);
    task.aggregationSummary = summary;

    if (summary.outcome === 'success') {
      task.verification = { status: 'verified', method: 'aggregation', policy: task.aggregationPolicy };
      task.result = { outcome: 'ok', aggregation: summary };
      const verif = runVerification(task, task.result);
      if (verif.canComplete) {
        task.nextSuggestedAction = 'Observe next signal for follow-up orchestration.';
        this.transition(task, TASK_STATUS.COMPLETED);
      } else {
        this._handleVerificationFailure(task, verif);
      }
    } else if (summary.outcome === 'pending') {
      task.nextSuggestedAction = 'Some branches are still pending.';
      this.transition(task, TASK_STATUS.WAITING_APPROVAL);
    } else {
      task.verification = { status: 'failed', method: 'aggregation', policy: task.aggregationPolicy };
      task.error = summary.conflict ? summary.conflict.reason : 'Aggregation failed.';
      this.transition(task, TASK_STATUS.FAILED);
    }
  }

  async _runHandler(center, task) {
    const handlers = {
      [EXECUTION_CENTERS.LOCAL]: async () => ({
        outcome: 'ok',
        message: 'Safe local handler executed.',
        echo: task.payload
      }),
      [EXECUTION_CENTERS.MEMORY]: async () => ({
        outcome: 'ok',
        message: 'Memory handler accepted signal.',
        snapshot: {
          signalId: task.signalId,
          source: task.source,
          classification: task.classification
        }
      }),
      [EXECUTION_CENTERS.AI]: async () => ({ outcome: 'stub', message: 'AI execution center is stubbed.' }),
      [EXECUTION_CENTERS.SERVICE]: async () => ({ outcome: 'stub', message: 'External service writes are blocked/stubbed.' }),
      [EXECUTION_CENTERS.REPO]: async () => ({ outcome: 'stub', message: 'Repository write actions are blocked/stubbed.' }),
      [EXECUTION_CENTERS.DEVICE]: async () => ({ outcome: 'stub', message: 'Device/deploy actions are blocked/stubbed.' }),
      [EXECUTION_CENTERS.HUMAN]: async () => ({ outcome: 'stub', message: 'Human action requires manual confirmation.' })
    };

    const handler = handlers[center];
    if (!handler) {
      return { outcome: 'error', message: `No execution handler for center: ${center}` };
    }
    return handler();
  }

  async _applyVerificationAndComplete(task, result) {
    const verif = runVerification(task, result);

    if (verif.canComplete) {
      task.verification = {
        status: 'verified',
        method: 'direct_result'
      };
      task.nextSuggestedAction = 'Observe next signal for follow-up orchestration.';
      this.transition(task, TASK_STATUS.COMPLETED);
      return;
    }

    if (result.outcome === 'stub') {
      task.verification = {
        status: 'blocked',
        method: 'stub'
      };
      task.nextSuggestedAction = 'Manual or delegated execution required for this center.';
      this.transition(task, TASK_STATUS.BLOCKED);
      return;
    }

    this._handleVerificationFailure(task, verif);
  }

  _handleVerificationFailure(task, verif) {
    if (verif.exhausted) {
      task.verification = { status: 'failed', method: 'retry_exhausted' };
      task.error = verif.policyResult.reason;
      this.transition(task, TASK_STATUS.VERIFICATION_FAILED);
    } else {
      task.verification = { status: 'unknown', method: 'none' };
      this.transition(task, TASK_STATUS.UNKNOWN);
    }
  }

  status() {
    const allTasks = Array.from(this.tasks.values());
    const byState = allTasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    return {
      workerActive: Boolean(this.worker),
      queueDepth: this.queue.length,
      activeTaskId: this.activeTaskId,
      knownModules: ciHub.getModules(),
      totalTasks: allTasks.length,
      byState
    };
  }

  recentMemory(limit = 50) {
    return this.memoryStore.recent(limit);
  }

  getCheckpoints() {
    return this.checkpointStore.all();
  }

  getCheckpoint(id) {
    return this.checkpointStore.get(id);
  }
}

module.exports = { CiOrchestrator };
