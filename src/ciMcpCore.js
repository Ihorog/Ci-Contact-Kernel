'use strict';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_CONTROL_PLANE_URL = 'https://ciplus.cimeika.com.ua';
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
]);

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : '';
  if (Array.isArray(value)) return value[0] || '';
  return value == null ? '' : String(value);
}

function normalizeBoolean(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function parseAllowedOrigins(env = {}) {
  const configured = String(env.CI_MCP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length > 0 ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
}

function validateOrigin(headers, env = {}) {
  const origin = headerValue(headers, 'origin').trim();
  if (!origin) return { ok: true, origin: '' };
  const allowed = parseAllowedOrigins(env);
  return { ok: allowed.has(origin), origin };
}

function validateProtocolHeader(headers) {
  const version = headerValue(headers, 'mcp-protocol-version').trim();
  if (!version) return { ok: true, version: '' };
  return { ok: SUPPORTED_PROTOCOL_VERSIONS.includes(version), version };
}

function readBearerToken(headers) {
  const authorization = headerValue(headers, 'authorization').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function secureEqual(left, right) {
  if (!left || !right) return false;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return left === right;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    subtle.digest('SHA-256', encoder.encode(left)),
    subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i % a.length] ^ b[i % b.length]);
  return diff === 0;
}

async function canWrite(headers, env = {}) {
  if (!normalizeBoolean(env.CI_MCP_WRITE_ENABLED)) return false;
  const expected = String(env.CI_MCP_TOKEN || '').trim();
  if (!expected) return false;
  return secureEqual(readBearerToken(headers), expected);
}

function readTool(name, title, description, inputSchema) {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

function writeTool(name, title, description, inputSchema, { idempotent = false, destructive = false, openWorld = false } = {}) {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: destructive,
      idempotentHint: idempotent,
      openWorldHint: openWorld,
    },
  };
}

const READ_TOOLS = [
  readTool(
    'ci_status',
    'Ci+ status',
    'Read the current Ci+ control-plane runtime status. This does not change state.',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
  readTool(
    'ci_state',
    'Ci+ state',
    'Read one Ci+ task by task_id, or list recent task state when task_id is omitted.',
    {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1, description: 'Existing Ci+ task identifier.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
      },
      additionalProperties: false,
    },
  ),
  readTool(
    'ci_verify',
    'Ci+ verification',
    'Read verification evidence and outcome fields for an existing Ci+ task. This never approves or executes the task.',
    {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1, description: 'Existing Ci+ task identifier.' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  ),
];

const WRITE_TOOLS = [
  writeTool(
    'ci_resolve',
    'Ci+ resolve',
    'Submit a signal to the Ci+ control plane for classification and routing. This creates task state but never grants permissions or approvals.',
    {
      type: 'object',
      properties: {
        signal: { type: 'object', description: 'Signal/context payload to classify and route.', additionalProperties: true },
      },
      required: ['signal'],
      additionalProperties: false,
    },
  ),
  writeTool(
    'ci_execute',
    'Ci+ execute',
    'Request execution of an existing Ci+ task. Client-supplied permission overrides are never accepted; Ci+ policy/risk gates remain authoritative.',
    {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1, description: 'Existing Ci+ task identifier.' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    { destructive: true, openWorld: true },
  ),
];

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function toolResult(value, isError = false) {
  const safeValue = value && typeof value === 'object' ? value : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(safeValue) }],
    structuredContent: safeValue,
    isError,
  };
}

function safeTaskVerification(task) {
  if (!task || typeof task !== 'object') return { task: null };
  return {
    task_id: task.id || null,
    status: task.status || null,
    permissionDecision: task.permissionDecision || null,
    approvalPolicy: task.approvalPolicy || null,
    approvalState: task.approvalState || null,
    checkpointId: task.checkpointId || null,
    completionPolicy: task.completionPolicy || null,
    requiredVerifiers: task.requiredVerifiers || null,
    verificationResults: task.verificationResults || null,
    verificationAttempt: task.verificationAttempt || null,
    maxVerificationRetries: task.maxVerificationRetries || null,
    verification: task.verification || null,
    incidentRecord: task.incidentRecord || null,
    nextSuggestedAction: task.nextSuggestedAction || null,
    updatedAt: task.updatedAt || null,
  };
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 8_192) };
  }
}

async function controlPlaneRequest({ fetchImpl, baseUrl, path, method = 'GET', body }) {
  const target = new URL(path, baseUrl || DEFAULT_CONTROL_PLANE_URL).toString();
  const headers = { accept: 'application/json' };
  const init = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetchImpl(target, init);
  const data = await readResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data || { error: `Ci+ control plane returned HTTP ${response.status}` },
    };
  }
  return { ok: true, status: response.status, data };
}

async function executeTool({ name, args, writeAuthorized, fetchImpl, baseUrl }) {
  if (name === 'ci_status') {
    const result = await controlPlaneRequest({ fetchImpl, baseUrl, path: '/ci/status' });
    return result.ok ? toolResult(result.data) : toolResult(result.error, true);
  }

  if (name === 'ci_state') {
    const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
    const limit = Math.min(Math.max(1, Number(args.limit) || 20), 200);
    const path = taskId ? `/ci/task/${encodeURIComponent(taskId)}` : `/ci/tasks?limit=${limit}`;
    const result = await controlPlaneRequest({ fetchImpl, baseUrl, path });
    return result.ok ? toolResult(result.data) : toolResult(result.error, true);
  }

  if (name === 'ci_verify') {
    const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
    if (!taskId) return toolResult({ error: 'task_id is required' }, true);
    const result = await controlPlaneRequest({
      fetchImpl,
      baseUrl,
      path: `/ci/task/${encodeURIComponent(taskId)}`,
    });
    if (!result.ok) return toolResult(result.error, true);
    const task = result.data?.task || result.data;
    return toolResult(safeTaskVerification(task));
  }

  if (name === 'ci_resolve') {
    if (!writeAuthorized) return toolResult({ error: 'MCP write capability is disabled or unauthorized.' }, true);
    if (!args.signal || typeof args.signal !== 'object' || Array.isArray(args.signal)) {
      return toolResult({ error: 'signal must be an object' }, true);
    }
    const signal = { ...args.signal, source: args.signal.source || 'gpt.mcp' };
    const result = await controlPlaneRequest({
      fetchImpl,
      baseUrl,
      path: '/ci/signal',
      method: 'POST',
      body: signal,
    });
    return result.ok ? toolResult(result.data) : toolResult(result.error, true);
  }

  if (name === 'ci_execute') {
    if (!writeAuthorized) return toolResult({ error: 'MCP write capability is disabled or unauthorized.' }, true);
    const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
    if (!taskId) return toolResult({ error: 'task_id is required' }, true);
    const result = await controlPlaneRequest({
      fetchImpl,
      baseUrl,
      path: `/ci/task/${encodeURIComponent(taskId)}/run`,
      method: 'POST',
      body: {},
    });
    return result.ok ? toolResult(result.data) : toolResult(result.error, true);
  }

  return null;
}

async function handleCiMcpMessage({ message, headers, env = {}, fetchImpl = globalThis.fetch, baseUrl }) {
  const origin = validateOrigin(headers, env);
  if (!origin.ok) {
    return { httpStatus: 403, response: { error: 'Origin not allowed.' } };
  }

  const protocol = validateProtocolHeader(headers);
  if (!protocol.ok) {
    return {
      httpStatus: 400,
      response: { error: `Unsupported MCP-Protocol-Version: ${protocol.version}` },
    };
  }

  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return { httpStatus: 200, response: jsonRpcError(null, -32600, 'Invalid Request') };
  }

  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined;
  const method = typeof message.method === 'string' ? message.method : '';

  if (id === undefined && method === 'notifications/initialized') {
    return { httpStatus: 202, notification: true, response: null };
  }

  if (method === 'initialize') {
    const requestedVersion = String(message.params?.protocolVersion || '');
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
      ? requestedVersion
      : DEFAULT_PROTOCOL_VERSION;
    return {
      httpStatus: 200,
      response: jsonRpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'ci-plus-mcp',
          title: 'Ci+ Connector',
          version: '0.1.0',
        },
        instructions: 'Ci+ is the control authority. MCP is only an adapter. Permission, approval, risk, execution and verification gates remain server-side and fail closed.',
      }),
    };
  }

  if (method === 'ping') {
    return { httpStatus: 200, response: jsonRpcResult(id, {}) };
  }

  const writeAuthorized = await canWrite(headers, env);

  if (method === 'tools/list') {
    return {
      httpStatus: 200,
      response: jsonRpcResult(id, {
        tools: writeAuthorized ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS,
      }),
    };
  }

  if (method === 'tools/call') {
    const name = typeof message.params?.name === 'string' ? message.params.name : '';
    const args = message.params?.arguments && typeof message.params.arguments === 'object'
      ? message.params.arguments
      : {};
    const known = [...READ_TOOLS, ...WRITE_TOOLS].some((tool) => tool.name === name);
    if (!known) {
      return { httpStatus: 200, response: jsonRpcError(id, -32602, `Unknown tool: ${name || '(empty)'}`) };
    }
    try {
      const result = await executeTool({ name, args, writeAuthorized, fetchImpl, baseUrl });
      return { httpStatus: 200, response: jsonRpcResult(id, result) };
    } catch (error) {
      return {
        httpStatus: 200,
        response: jsonRpcResult(id, toolResult({ error: 'Ci+ MCP tool call failed.', detail: String(error?.message || error).slice(0, 500) }, true)),
      };
    }
  }

  if (id === undefined) {
    return { httpStatus: 202, notification: true, response: null };
  }

  return { httpStatus: 200, response: jsonRpcError(id, -32601, `Method not found: ${method || '(empty)'}`) };
}

module.exports = {
  DEFAULT_CONTROL_PLANE_URL,
  DEFAULT_PROTOCOL_VERSION,
  READ_TOOLS,
  SUPPORTED_PROTOCOL_VERSIONS,
  WRITE_TOOLS,
  canWrite,
  handleCiMcpMessage,
  validateOrigin,
  validateProtocolHeader,
};
