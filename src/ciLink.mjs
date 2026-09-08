const LINK_KEY_PREFIX = 'ci_link:';
const LINK_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_BODY_BYTES = 65_536;
const MAX_SURFACE_BYTES = 32_768;
const CONTRACT = 'ci-link/v1';
const COORDINATE = 'CI.LINK';
const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|api[-_]?key|private[-_]?key|credential)/i;

function responseHeaders(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-ci-principal',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders(extraHeaders),
  });
}

function readBearerToken(headers) {
  const auth = (headers?.get?.('authorization') || '').trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function secureEqual(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(aHash);
  const b = new Uint8Array(bHash);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= a[i % a.length] ^ b[i % b.length];
  return diff === 0;
}

async function authorize(request, env = {}) {
  const expected = String(env.CI_LINK_TOKEN || env.CI_MCP_TOKEN || '').trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: 'ci_link_auth_not_configured',
      message: 'Configure CI_LINK_TOKEN or reuse CI_MCP_TOKEN before enabling Ci Link.',
    };
  }
  const supplied = readBearerToken(request.headers);
  if (!(await secureEqual(supplied, expected))) {
    return {
      ok: false,
      status: 401,
      error: 'unauthorized',
      message: 'Valid Ci Link bearer token required.',
    };
  }
  return { ok: true };
}

function normalizePrincipal(value) {
  const text = String(value || 'owner').trim();
  return /^[A-Za-z0-9._:@-]{1,120}$/.test(text) ? text : 'owner';
}

function sanitize(value, depth = 0) {
  if (depth > 6) return '[depth-limit]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 4_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 4_000);

  const out = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (SENSITIVE_KEY.test(key)) continue;
    out[key] = sanitize(item, depth + 1);
  }
  return out;
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object-required');
    return parsed;
  } catch {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
}

function kvBinding(env = {}) {
  const kv = env.CI_MEMORY_KV;
  return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null;
}

async function saveLinkState(principal, state, env) {
  const kv = kvBinding(env);
  if (!kv) return false;
  await kv.put(`${LINK_KEY_PREFIX}${principal}`, JSON.stringify(state), {
    expirationTtl: LINK_TTL_SECONDS,
  });
  return true;
}

async function loadLinkState(principal, env) {
  const kv = kvBinding(env);
  if (!kv) return null;
  try {
    return await kv.get(`${LINK_KEY_PREFIX}${principal}`, { type: 'json' });
  } catch {
    return null;
  }
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

function localRequest(request, path, init = {}) {
  const target = new URL(path, request.url);
  return new Request(target.toString(), init);
}

function nextSyncAt(now) {
  return new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export async function handleCiLink(request, env = {}, baseFetch) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST, OPTIONS' });
  }

  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json(
      { error: auth.error, message: auth.message },
      auth.status,
      auth.status === 401 ? { 'www-authenticate': 'Bearer realm="Ci Link"' } : {},
    );
  }

  const now = new Date().toISOString();
  let payload = {};
  if (request.method === 'POST') {
    try {
      payload = await readJson(request);
    } catch (error) {
      return json({ error: error.message }, error.status || 400);
    }
  }

  const principal = normalizePrincipal(payload.principal || request.headers.get('x-ci-principal'));
  const previous = await loadLinkState(principal, env);
  const requestedMode = String(payload.mode || 'contact');
  const mode = request.method === 'GET'
    ? 'status'
    : ['contact', 'sync', 'status'].includes(requestedMode) ? requestedMode : 'contact';

  const rawSurface = payload.surface ?? payload.snapshot ?? payload.coordinateMap;
  let surface = previous?.surface || null;
  let acceptedSurface = false;
  if (rawSurface && typeof rawSurface === 'object' && !Array.isArray(rawSurface)) {
    const sanitized = sanitize(rawSurface);
    const bytes = new TextEncoder().encode(JSON.stringify(sanitized)).length;
    if (bytes > MAX_SURFACE_BYTES) return json({ error: 'Coordinate surface is too large.' }, 413);
    surface = sanitized;
    acceptedSurface = true;
  }

  const source = String(payload.source || previous?.source || 'ci.client').slice(0, 160);
  const state = {
    contract: CONTRACT,
    coordinate: COORDINATE,
    principal,
    source,
    lastSeenAt: now,
    lastSnapshotAt: acceptedSurface ? now : previous?.lastSnapshotAt || null,
    surface,
  };
  const durable = await saveLinkState(principal, state, env);

  const statusResponse = await baseFetch(localRequest(request, '/ci/status'));
  const ciStatus = await readResponse(statusResponse);

  let task = null;
  const intent = typeof payload.intent === 'string' ? payload.intent.trim() : '';
  if (request.method === 'POST' && mode === 'contact' && intent) {
    const signal = {
      message: intent.slice(0, 12_000),
      source: `ci.link:${source}`,
      context: sanitize(payload.context || {}),
    };
    const taskResponse = await baseFetch(localRequest(request, '/ci/signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signal),
    }));
    const taskEnvelope = await readResponse(taskResponse);
    if (!taskResponse.ok) {
      return json({ error: 'ci_signal_failed', upstream: taskEnvelope }, 502);
    }
    task = taskEnvelope?.task || null;
  }

  return json({
    ok: true,
    link: {
      contract: CONTRACT,
      coordinate: COORDINATE,
      principal,
      mode,
      state: 'VERIFIED_CONTACT',
      receivedAt: now,
      durableSnapshot: durable,
      snapshotAccepted: acceptedSurface,
      lastSnapshotAt: state.lastSnapshotAt,
      nextSyncSuggestedAt: nextSyncAt(now),
    },
    ci: ciStatus,
    surface: state.surface,
    task,
    evidence: {
      auth: 'bearer',
      requestAccepted: true,
      durableSnapshot: durable,
      taskId: task?.id || null,
      taskStatus: task?.status || null,
      verification: task?.verification || null,
    },
  });
}
