const crypto = require('crypto');
const path = require('path');
const ciHub = require('./ciHub');
const { classifySignal } = require('./classifier');
const { routeTask } = require('./router');
const { evaluatePermission } = require('./permissionGate');
const { MemoryStore } = require('./memoryStore');
const {
  TASK_STATUS,
  EXECUTION_CENTERS,
  PERMISSION_LEVELS
} = require('./constants');

function now() {
  return new Date().toISOString();
}

function nextId() {
  return crypto.randomUUID();
}

class CiOrchestrator {
  constructor() {
    this.tasks = new Map();
    this.queue = [];
    this.activeTaskId = null;
    this.memoryStore = new MemoryStore(path.resolve(process.cwd(), 'data/ci-memory.jsonl'));
    this.permissions = {
      localWrite: false,
      repoWrite: false,
      externalApiWrite: false,
      deployOrDeviceConfirm: false
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
      await this.processNext();
    }, intervalMs);
  }

  stopWorker() {
    if (this.worker) {
      clearInterval(this.worker);
      this.worker = null;
    }
  }

  applyPermissionOverrides(overrides = {}) {
    this.permissions = { ...this.permissions, ...overrides };
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
      permissionDecision: task.permissionDecision,
      statusBefore: prev,
      statusAfter: nextStatus,
      result: task.result,
      verification: task.verification,
      error: task.error,
      nextSuggestedAction: task.nextSuggestedAction
    });

    ciHub.emit('task.status.changed', { taskId: task.id, from: prev, to: nextStatus, task });
  }

  createTask(input = {}, source = 'api', shouldQueue = true) {
    const timestamp = now();
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
      requestedAction: input.requestedAction || input.action || null,
      permissionLevel: input.permissionLevel || PERMISSION_LEVELS.L0_READ,
      permissionDecision: 'PENDING',
      payload: input,
      result: null,
      verification: {
        status: 'unknown',
        method: 'none'
      },
      error: null,
      memoryRecordId: null,
      nextSuggestedAction: null
    };

    this.tasks.set(task.id, task);

    task.classification = classifySignal(input);
    this.transition(task, TASK_STATUS.CLASSIFIED);

    const route = routeTask(task);
    this.transition(task, TASK_STATUS.ROUTED, {
      targetNode: route.targetNode,
      executionCenter: route.executionCenter
    });

    this.evaluateAndQueueTask(task, shouldQueue);

    return task;
  }

  evaluateAndQueueTask(task, shouldQueue) {
    this.transition(task, TASK_STATUS.WAITING_PERMISSION);
    const decision = evaluatePermission(task, this.permissions);
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

    this.applyPermissionOverrides(permissionOverrides);

    const decision = evaluatePermission(task, this.permissions);
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

    if (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.RUNNING) {
      this.transition(task, TASK_STATUS.QUEUED);
      this.queue.push(task.id);
    }

    await this.processNext();
    return task;
  }

  async executeTask(task) {
    this.transition(task, TASK_STATUS.RUNNING);

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

    const handler = handlers[task.executionCenter];
    if (!handler) {
      task.error = 'No execution handler found.';
      task.verification = {
        status: 'failed',
        method: 'none'
      };
      this.transition(task, TASK_STATUS.FAILED);
      return;
    }

    const result = await handler();
    task.result = result;

    this.transition(task, TASK_STATUS.VERIFYING);

    if (result.outcome === 'ok') {
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

    task.verification = {
      status: 'unknown',
      method: 'none'
    };
    this.transition(task, TASK_STATUS.UNKNOWN);
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
}

module.exports = { CiOrchestrator };
