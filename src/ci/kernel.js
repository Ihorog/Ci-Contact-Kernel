const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  CLASSIFICATIONS,
  EXECUTION_CENTERS
} = require('./constants');

const CLASSIFICATION_TO_NODE = {
  fact: 'current_fact',
  intent: 'intent',
  task: 'project',
  event: 'event',
  memory: 'memory',
  service_action: 'service',
  device_action: 'device',
  repo_action: 'repo',
  unknown: 'unknown'
};

const NODE_TO_CENTER = {
  current_fact: 'local',
  intent: 'ai',
  project: 'local',
  memory: 'memory',
  action: 'local',
  event: 'local',
  service: 'service',
  device: 'device',
  repo: 'repo',
  unknown: 'human'
};

function normalizeSignal(input = {}, source = 'signal') {
  const now = new Date().toISOString();
  const text = typeof input === 'string' ? input : input.text || input.command || input.message || '';
  return {
    id: input.id || randomUUID(),
    timestamp: input.timestamp || now,
    source,
    text,
    payload: typeof input === 'object' ? input.payload || input : { value: input },
    permissions: typeof input === 'object' ? input.permissions || {} : {}
  };
}

function classifySignal(signal) {
  const requestedType = signal.payload?.type;
  if (CLASSIFICATIONS.includes(requestedType)) {
    return requestedType;
  }

  const haystack = `${signal.text} ${JSON.stringify(signal.payload || {})}`.toLowerCase();

  if (/(repo|repository|branch|commit|merge|pull request|git push|push to repo|delete file)/.test(haystack)) return 'repo_action';
  if (/(device|sensor|hardware|camera)/.test(haystack)) return 'device_action';
  if (/(deploy|external api|service action|call api|webhook post)/.test(haystack)) return 'service_action';
  if (/(remember|memory|recall)/.test(haystack)) return 'memory';
  if (/(fact|status|state)/.test(haystack)) return 'fact';
  if (/(intent|want|need|goal|plan)/.test(haystack)) return 'intent';
  if (/(task|todo|implement|build)/.test(haystack)) return 'task';
  if (signal.source === 'webhook') return 'event';
  if (/(webhook|event|trigger)/.test(haystack)) return 'event';

  return 'unknown';
}

function routeNode(classification) {
  return CLASSIFICATION_TO_NODE[classification] || 'unknown';
}

function evaluatePermission(signal, classification) {
  const permissions = signal.permissions || {};
  const haystack = `${signal.text || ''} ${JSON.stringify(signal.payload || {})}`.toLowerCase();
  const required = [];

  if (classification === 'repo_action') required.push('repo_write');
  if (classification === 'device_action') required.push('device_action');
  if (classification === 'service_action') required.push('external_api_write');
  if (/(repo|repository|branch|commit|merge|pull request|git push|push to repo|delete file)/.test(haystack)) required.push('repo_write');
  if (/(device|sensor|hardware|camera)/.test(haystack)) required.push('device_action');
  if (/(api write|external api|service action|service write|call api|webhook post|deploy)/.test(haystack)) required.push('external_api_write');
  if (/deploy/.test(haystack)) required.push('deploy');
  if (/(delete|destroy|drop|remove|truncate)/.test(haystack)) required.push('destructive_action');

  const dedupedRequired = [...new Set(required)];

  if (classification === 'unknown') {
    return {
      state: 'UNKNOWN',
      required: dedupedRequired,
      missing: dedupedRequired,
      reason: 'Signal classification is unknown.'
    };
  }

  if (dedupedRequired.length === 0) {
    return {
      state: 'READY',
      required: dedupedRequired,
      missing: [],
      reason: 'No explicit elevated permissions required.'
    };
  }

  const missing = dedupedRequired.filter((key) => permissions[key] !== true);
  if (missing.length > 0) {
    return {
      state: 'BLOCKED',
      required: dedupedRequired,
      missing,
      reason: `Missing required permissions: ${missing.join(', ')}`
    };
  }

  return {
    state: 'EXECUTABLE',
    required: dedupedRequired,
    missing: [],
    reason: 'All required permissions were explicitly granted.'
  };
}

function createExecutionCenters() {
  return {
    local: {
      name: 'local',
      execute: ({ signal, node }) => ({
        status: 'SUCCESS',
        summary: `Local stub handled node '${node}'.`,
        output: { text: signal.text }
      })
    },
    ai: {
      name: 'ai',
      execute: ({ node }) => ({
        status: 'STUB',
        summary: `AI center stub for '${node}'.`,
        output: null
      })
    },
    memory: {
      name: 'memory',
      execute: ({ signal }) => ({
        status: 'SUCCESS',
        summary: 'Memory center stub stored signal context locally.',
        output: { reference: signal.id }
      })
    },
    service: {
      name: 'service',
      execute: () => ({
        status: 'STUB',
        summary: 'Service write is stubbed; no external writes performed.',
        output: null
      })
    },
    repo: {
      name: 'repo',
      execute: () => ({
        status: 'STUB',
        summary: 'Repo write is stubbed; no repository writes performed.',
        output: null
      })
    },
    device: {
      name: 'device',
      execute: () => ({
        status: 'STUB',
        summary: 'Device action is stubbed; no physical actions performed.',
        output: null
      })
    },
    human: {
      name: 'human',
      execute: () => ({
        status: 'STUB',
        summary: 'Human review required.',
        output: null
      })
    }
  };
}

function verifyResult(permission, executionResult) {
  if (permission.state === 'BLOCKED') {
    return {
      status: 'blocked',
      details: permission.reason
    };
  }

  if (executionResult.status === 'SUCCESS') {
    return {
      status: 'verified',
      details: 'Execution completed with local verification.'
    };
  }

  if (executionResult.status === 'STUB') {
    return {
      status: 'unknown',
      details: 'Execution is a safe stub and needs further confirmation.'
    };
  }

  return {
    status: 'failed',
    details: 'Execution failed verification.'
  };
}

class MemoryStore {
  constructor(memoryFilePath) {
    this.memoryFilePath = memoryFilePath;
    fs.mkdirSync(path.dirname(memoryFilePath), { recursive: true });
    if (!fs.existsSync(memoryFilePath)) {
      fs.writeFileSync(memoryFilePath, '');
    }
    this.writeQueue = Promise.resolve();
  }

  async append(record) {
    const writePromise = this.writeQueue.then(() =>
      fsp.appendFile(this.memoryFilePath, `${JSON.stringify(record)}\n`)
    );
    this.writeQueue = writePromise.catch(() => Promise.resolve());
    await writePromise;
    return record;
  }

  async readAll(limit = 200) {
    let content = '';
    try {
      content = (await fsp.readFile(this.memoryFilePath, 'utf8')).trim();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (!content) return [];

    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-limit);
  }
}

function createKernel(options = {}) {
  const centers = createExecutionCenters();
  const memoryStore = new MemoryStore(
    options.memoryFilePath || path.join(process.cwd(), 'data', 'ci-memory.jsonl')
  );

  async function handleSignal(input, source = 'signal') {
    const signal = normalizeSignal(input, source);
    const classification = classifySignal(signal);
    const node = routeNode(classification);
    const permission = evaluatePermission(signal, classification);
    const executionCenter = NODE_TO_CENTER[node] || 'human';

    let executionResult;
    let error = null;

    if (permission.state === 'BLOCKED') {
      executionResult = {
        status: 'BLOCKED',
        summary: 'Execution prevented by permission gate.',
        output: null
      };
    } else {
      try {
        executionResult = centers[executionCenter].execute({ signal, classification, node, permission });
      } catch (err) {
        error = err.message;
        executionResult = {
          status: 'FAILED',
          summary: 'Execution center failed.',
          output: null
        };
      }
    }

    const verification = verifyResult(permission, executionResult);
    const nextSuggestedAction =
      permission.state === 'BLOCKED'
        ? `Provide explicit permissions: ${permission.missing.join(', ') || 'none'}.`
        : verification.status === 'verified'
          ? 'Send next signal.'
          : 'Request human validation or expanded implementation.';

    const memoryRecord = {
      timestamp: new Date().toISOString(),
      signal,
      classification,
      node,
      permissionDecision: permission,
      executionResult,
      verification,
      error,
      nextSuggestedAction
    };

    try {
      await memoryStore.append(memoryRecord);
    } catch (appendError) {
      memoryRecord.error = memoryRecord.error || appendError.message;
    }

    return {
      signal,
      classification,
      node,
      permission,
      executionCenter,
      executionResult,
      verification,
      memoryRecord
    };
  }

  return {
    handleSignal,
    async getStatus() {
      return {
        status: 'ok',
        executionCenters: EXECUTION_CENTERS,
        memoryRecords: (await memoryStore.readAll()).length
      };
    },
    async getMemory(limit) {
      return memoryStore.readAll(limit);
    }
  };
}

module.exports = {
  createKernel,
  normalizeSignal,
  classifySignal,
  routeNode,
  evaluatePermission,
  verifyResult
};
