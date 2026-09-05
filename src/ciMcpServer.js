'use strict';

const express = require('express');
const {
  DEFAULT_CONTROL_PLANE_URL,
  handleCiMcpMessage,
  validateOrigin,
} = require('./ciMcpCore');

function corsHeaders(req, env) {
  const origin = req.headers.origin || '';
  const allowed = validateOrigin(req.headers, env);
  return {
    'Access-Control-Allow-Origin': origin && allowed.ok ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function createCiMcpApp(options = {}) {
  const app = express();
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const baseUrl = options.baseUrl || env.CI_CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE_URL;

  app.use(express.json({ limit: '64kb' }));

  app.options('/mcp/ci', (req, res) => {
    const allowed = validateOrigin(req.headers, env);
    if (!allowed.ok) return res.status(403).json({ error: 'Origin not allowed.' });
    return res.set(corsHeaders(req, env)).status(204).end();
  });

  app.get('/mcp/ci', (req, res) => res
    .set(corsHeaders(req, env))
    .set('Allow', 'POST, OPTIONS')
    .status(405)
    .json({ error: 'SSE stream is not enabled; use Streamable HTTP POST.' }));

  app.delete('/mcp/ci', (req, res) => res
    .set(corsHeaders(req, env))
    .set('Allow', 'POST, OPTIONS')
    .status(405)
    .json({ error: 'This MCP endpoint is stateless and does not create sessions.' }));

  app.post('/mcp/ci', async (req, res) => {
    const result = await handleCiMcpMessage({
      message: req.body,
      headers: req.headers,
      env,
      fetchImpl,
      baseUrl,
    });
    res.set(corsHeaders(req, env));
    if (result.notification || result.response == null) return res.status(result.httpStatus || 202).end();
    return res.status(result.httpStatus || 200).json(result.response);
  });

  app.use((error, req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      return res.set(corsHeaders(req, env)).status(413).json({ error: 'Request body is too large.' });
    }
    if (error instanceof SyntaxError) {
      return res.set(corsHeaders(req, env)).status(400).json({ error: 'Request body must be valid JSON.' });
    }
    console.error('Ci MCP request failed', error);
    return res.set(corsHeaders(req, env)).status(500).json({ error: 'Internal Ci MCP error.' });
  });

  return app;
}

const app = createCiMcpApp();

module.exports = app;
module.exports.createCiMcpApp = createCiMcpApp;
