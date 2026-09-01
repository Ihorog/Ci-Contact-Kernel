'use strict';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');

const UPSTREAM_HOST = 'mcp.keenetic.cloud';
const REQUEST_HEADERS = ['accept', 'content-type', 'mcp-session-id', 'last-event-id'];
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'mcp-session-id', 'retry-after', 'etag'];

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function readBearer(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function resolveKeeneticConfig(env = process.env) {
  const upstreamRaw = String(env.KEENETIC_MCP_URL || '').trim();
  const proxyKey = String(env.CI_KEENETIC_PROXY_KEY || '').trim();
  let upstreamUrl = null;
  let validUpstream = false;

  if (upstreamRaw) {
    try {
      upstreamUrl = new URL(upstreamRaw);
      validUpstream = upstreamUrl.protocol === 'https:' && upstreamUrl.hostname === UPSTREAM_HOST;
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

function statusKeeneticConfig(env = process.env) {
  const config = resolveKeeneticConfig(env);
  return {
    service: 'keenetic-mcp',
    configured: config.configured,
    upstreamHost: config.validUpstream ? UPSTREAM_HOST : null,
    gatewayAuth: 'bearer',
    secretStorage: 'runtime-environment-only',
  };
}

function copyHeaders(source, names) {
  const headers = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxyKeeneticMcp(req, res, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const config = resolveKeeneticConfig(env);

  if (!config.configured) {
    return res.status(503).json({ error: 'keenetic_mcp_not_configured' });
  }

  const presented = readBearer(req.headers.authorization);
  if (!constantTimeEqual(presented, config.proxyKey)) {
    res.set('WWW-Authenticate', 'Bearer realm="ci-keenetic-mcp"');
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (typeof fetchImpl !== 'function') {
    return res.status(503).json({ error: 'upstream_fetch_unavailable' });
  }

  const headers = copyHeaders(new Headers(req.headers), REQUEST_HEADERS);
  const init = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.rawBody?.length) {
    init.body = req.rawBody;
  }

  let upstream;
  try {
    upstream = await fetchImpl(config.upstreamUrl.toString(), init);
  } catch {
    return res.status(502).json({ error: 'keenetic_mcp_upstream_unreachable' });
  }

  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.set(name, value);
  }
  res.status(upstream.status);

  if (!upstream.body) return res.end();
  try {
    Readable.fromWeb(upstream.body).pipe(res);
    return undefined;
  } catch {
    const body = Buffer.from(await upstream.arrayBuffer());
    return res.end(body);
  }
}

module.exports = {
  UPSTREAM_HOST,
  constantTimeEqual,
  readBearer,
  resolveKeeneticConfig,
  statusKeeneticConfig,
  proxyKeeneticMcp,
};
