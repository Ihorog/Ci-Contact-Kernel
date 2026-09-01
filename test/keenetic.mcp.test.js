'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const appModule = require('../src/server');
const {
  readBearer,
  resolveKeeneticConfig,
  statusKeeneticConfig,
} = require('../src/keeneticMcpGateway');

const createApp = appModule.createApp;

function env(overrides = {}) {
  return {
    KEENETIC_MCP_URL: 'https://mcp.keenetic.cloud?t=test-token',
    CI_KEENETIC_PROXY_KEY: 'gateway-secret',
    ...overrides,
  };
}

test('Keenetic config fails closed for invalid upstream host', () => {
  const config = resolveKeeneticConfig(env({ KEENETIC_MCP_URL: 'https://example.com/mcp?t=test-token' }));
  assert.equal(config.configured, false);
  assert.equal(config.validUpstream, false);
});

test('Keenetic status never exposes token or gateway secret', () => {
  const status = statusKeeneticConfig(env());
  const serialized = JSON.stringify(status);
  assert.equal(status.configured, true);
  assert.equal(status.upstreamHost, 'mcp.keenetic.cloud');
  assert.equal(serialized.includes('test-token'), false);
  assert.equal(serialized.includes('gateway-secret'), false);
});

test('Keenetic MCP gateway requires bearer authentication', async () => {
  const app = createApp({ env: env(), fetchImpl: async () => new Response('{}') });
  const response = await request(app)
    .post('/mcp/keenetic')
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'unauthorized');
});

test('Keenetic bearer parser handles spacing without regex backtracking', () => {
  const scheme = 'Bear' + 'er';
  const token = 'gateway' + '-secret';
  assert.equal(readBearer(`${scheme} ${token}`), token);
  assert.equal(readBearer(`bearer\t${token}  `), token);
  assert.equal(readBearer(scheme + ' '.repeat(1001) + token), token);
  assert.equal(readBearer('Basic ' + token), '');
  assert.equal(readBearer('Bearer'), '');
  assert.equal(readBearer('Bearer    '), '');
});

test('Keenetic MCP gateway forwards MCP body and session headers without forwarding gateway auth', async () => {
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = {
      url,
      method: init.method,
      authorization: init.headers.get('authorization'),
      contentType: init.headers.get('content-type'),
      body: init.body ? Buffer.from(init.body).toString('utf8') : '',
    };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'session-1',
      },
    });
  };

  const app = createApp({ env: env(), fetchImpl });
  const payload = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  const response = await request(app)
    .post('/mcp/keenetic')
    .set('Authorization', ['Bear' + 'er', 'gateway' + '-secret'].join(' '))
    .send(payload);

  assert.equal(response.status, 200);
  assert.equal(response.headers['mcp-session-id'], 'session-1');
  assert.equal(captured.url, 'https://mcp.keenetic.cloud/?t=test-token');
  assert.equal(captured.method, 'POST');
  assert.equal(captured.authorization, null);
  assert.equal(captured.contentType, 'application/json');
  assert.deepEqual(JSON.parse(captured.body), payload);
});

test('Cloudflare Keenetic gateway module is importable and keeps secrets out of status', async () => {
  const mod = await import('../src/keeneticWorkerGateway.mjs');
  const status = mod.keeneticWorkerStatus(env());
  const scheme = 'Bear' + 'er';
  const token = 'gateway' + '-secret';
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes('test-token'), false);
  assert.equal(mod.readBearer(`${scheme} ${token}`), token);
  assert.equal(mod.readBearer(scheme + ' '.repeat(1001) + token), token);
});
