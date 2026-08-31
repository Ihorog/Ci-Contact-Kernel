const UPSTREAM_HOST = "mcp.keenetic.cloud";
const REQUEST_HEADERS = ["accept", "content-type", "mcp-session-id", "last-event-id"];
const RESPONSE_HEADERS = ["content-type", "cache-control", "mcp-session-id", "retry-after", "etag"];

function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function readBearer(value) {
  const match = typeof value === "string" ? value.match(/^Bearer\s+(.+)$/i) : null;
  return match ? match[1].trim() : "";
}

export function resolveKeeneticWorkerConfig(env = {}) {
  const upstreamRaw = String(env.KEENETIC_MCP_URL || "").trim();
  const proxyKey = String(env.CI_KEENETIC_PROXY_KEY || "").trim();
  let upstreamUrl = null;
  let validUpstream = false;

  if (upstreamRaw) {
    try {
      upstreamUrl = new URL(upstreamRaw);
      validUpstream = upstreamUrl.protocol === "https:" && upstreamUrl.hostname === UPSTREAM_HOST;
    } catch {
      upstreamUrl = null;
    }
  }

  return {
    configured: Boolean(validUpstream && proxyKey),
    validUpstream,
    upstreamUrl,
    proxyKey,
  };
}

export function keeneticWorkerStatus(env = {}) {
  const config = resolveKeeneticWorkerConfig(env);
  return {
    service: "keenetic-mcp",
    configured: config.configured,
    upstreamHost: config.validUpstream ? UPSTREAM_HOST : null,
    gatewayAuth: "bearer",
    secretStorage: "runtime-environment-only",
  };
}

function corsHeaders(extra = {}) {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-session-id, last-event-id",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  });
}

function errorResponse(error, status, extra = {}) {
  const headers = corsHeaders({ "content-type": "application/json; charset=utf-8", ...extra });
  return new Response(JSON.stringify({ error }), { status, headers });
}

export async function proxyKeeneticWorker(request, env = {}) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const config = resolveKeeneticWorkerConfig(env);
  if (!config.configured) return errorResponse("keenetic_mcp_not_configured", 503);

  const presented = readBearer(request.headers.get("authorization"));
  if (!safeEqual(presented, config.proxyKey)) {
    return errorResponse("unauthorized", 401, { "www-authenticate": 'Bearer realm="ci-keenetic-mcp"' });
  }

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

  let upstream;
  try {
    upstream = await fetch(config.upstreamUrl.toString(), init);
  } catch {
    return errorResponse("keenetic_mcp_upstream_unreachable", 502);
  }

  const responseHeaders = corsHeaders();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
