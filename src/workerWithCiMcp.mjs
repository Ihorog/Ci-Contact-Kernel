import baseWorker, { VodyanyiState } from './worker.mjs';
import ciMcpCore from './ciMcpCore.js';

const {
  handleCiMcpMessage,
  validateOrigin,
} = ciMcpCore;

export { VodyanyiState };

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = validateOrigin(request.headers, env);
  return {
    'access-control-allow-origin': origin && allowed.ok ? origin : '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name',
    'access-control-expose-headers': 'mcp-session-id',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  };
}

function json(value, status, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(request, env), ...extraHeaders },
  });
}

async function readJson(request, env) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > 65_536) {
    return { errorResponse: json({ error: 'Request body is too large.' }, 413, request, env) };
  }
  const raw = await request.text();
  if (raw.length > 65_536) {
    return { errorResponse: json({ error: 'Request body is too large.' }, 413, request, env) };
  }
  try {
    return { value: raw ? JSON.parse(raw) : {} };
  } catch {
    return { errorResponse: json({ error: 'Request body must be valid JSON.' }, 400, request, env) };
  }
}

async function handleCiMcp(request, env) {
  const allowed = validateOrigin(request.headers, env);
  if (!allowed.ok) return json({ error: 'Origin not allowed.' }, 403, request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method === 'GET') {
    return json(
      { error: 'SSE stream is not enabled; use Streamable HTTP POST.' },
      405,
      request,
      env,
      { allow: 'POST, OPTIONS' },
    );
  }
  if (request.method === 'DELETE') {
    return json(
      { error: 'This MCP endpoint is stateless and does not create sessions.' },
      405,
      request,
      env,
      { allow: 'POST, OPTIONS' },
    );
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, request, env, { allow: 'POST, OPTIONS' });
  }

  const parsed = await readJson(request, env);
  if (parsed.errorResponse) return parsed.errorResponse;

  const originUrl = new URL(request.url);
  const fetchControlPlane = async (input, init = {}) => {
    const requestedUrl = new URL(typeof input === 'string' ? input : input.url);
    const localUrl = new URL(`${requestedUrl.pathname}${requestedUrl.search}`, originUrl.origin);
    const headers = new Headers(init.headers || {});
    const localRequest = new Request(localUrl.toString(), {
      method: init.method || 'GET',
      headers,
      body: init.body,
    });
    return baseWorker.fetch(localRequest, env);
  };

  const result = await handleCiMcpMessage({
    message: parsed.value,
    headers: request.headers,
    env,
    fetchImpl: fetchControlPlane,
    baseUrl: originUrl.origin,
  });

  if (result.notification || result.response == null) {
    return new Response(null, { status: result.httpStatus || 202, headers: corsHeaders(request, env) });
  }
  return json(result.response, result.httpStatus || 200, request, env);
}

export default {
  async fetch(request, env = {}) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/mcp/ci' || pathname === '/mcp/ci/') {
      try {
        return await handleCiMcp(request, env);
      } catch (error) {
        console.error('Ci MCP Worker request failed', error);
        return json({ error: 'Internal Ci MCP error.' }, 500, request, env);
      }
    }
    return baseWorker.fetch(request, env);
  },
};
