'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createCiMcpApp } = require('../src/ciMcpServer');

function rpc(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createHarness(env = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    calls.push({ url: target.toString(), path: `${target.pathname}${target.search}`, method: init.method || 'GET', body: init.body || '' });
    if (target.pathname === '/ci/status') return responseJson({ status: 'ok', runtime: 'test' });
    if (target.pathname === '/ci/tasks') return responseJson({ tasks: [{ id: 't1', status: 'BLOCKED' }] });
    if (target.pathname === '/ci/task/t1' && (init.method || 'GET') === 'GET') {
      return responseJson({
        task: {
          id: 't1',
          status: 'BLOCKED',
          permissionDecision: 'BLOCKED: confirmation required',
          verification: { status: 'blocked', method: 'safe_stub' },
          nextSuggestedAction: 'Confirm externally.',
          updatedAt: '2026-09-05T00:00:00.000Z',
        },
      });
    }
    if (target.pathname === '/ci/signal') return responseJson({ task: { id: 't2', status: 'BLOCKED' } }, 202);
    if (target.pathname === '/ci/task/t1/run') return responseJson({ task: { id: 't1', status: 'BLOCKED' } });
    return responseJson({ error: 'not found' }, 404);
  };
  const app = createCiMcpApp({
    env,
    fetchImpl,
    baseUrl: 'https://ciplus.cimeika.com.ua',
  });
  return { app, calls };
}

test('Ci MCP initialize negotiates the stable protocol and advertises tools', async () => {
  const { app } = createHarness();
  const response = await request(app)
    .post('/mcp/ci')
    .send(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));

  assert.equal(response.status, 200);
  assert.equal(response.body.result.protocolVersion, '2025-06-18');
  assert.equal(response.body.result.serverInfo.name, 'ci-plus-mcp');
  assert.equal(response.body.result.capabilities.tools.listChanged, false);
});

test('Ci MCP is read-only by default', async () => {
  const { app } = createHarness();
  const response = await request(app).post('/mcp/ci').send(rpc(2, 'tools/list'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result.tools.map((tool) => tool.name), ['ci_status', 'ci_state', 'ci_verify']);
  for (const tool of response.body.result.tools) assert.equal(tool.annotations.readOnlyHint, true);
});

test('Ci MCP advertises write tools only with both server enablement and bearer authorization', async () => {
  const { app } = createHarness({ CI_MCP_WRITE_ENABLED: 'true', CI_MCP_TOKEN: 'secret' });
  const response = await request(app)
    .post('/mcp/ci')
    .set('Authorization', 'Bearer secret')
    .send(rpc(3, 'tools/list'));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.result.tools.map((tool) => tool.name), ['ci_status', 'ci_state', 'ci_verify', 'ci_resolve', 'ci_execute']);
  const executeTool = response.body.result.tools.find((tool) => tool.name === 'ci_execute');
  assert.equal(executeTool.annotations.readOnlyHint, false);
  assert.equal(executeTool.annotations.destructiveHint, true);
  assert.equal(executeTool.annotations.openWorldHint, true);
});

test('ci_status reads only the Ci+ control-plane status endpoint', async () => {
  const { app, calls } = createHarness();
  const response = await request(app)
    .post('/mcp/ci')
    .send(rpc(4, 'tools/call', { name: 'ci_status', arguments: {} }));

  assert.equal(response.status, 200);
  assert.equal(response.body.result.isError, false);
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [['GET', '/ci/status']]);
});

test('direct write calls fail closed when MCP write capability is disabled', async () => {
  const { app, calls } = createHarness();
  const response = await request(app)
    .post('/mcp/ci')
    .send(rpc(5, 'tools/call', { name: 'ci_resolve', arguments: { signal: { message: 'run' } } }));

  assert.equal(response.status, 200);
  assert.equal(response.body.result.isError, true);
  assert.equal(calls.length, 0);
});

test('ci_execute never forwards client-supplied permission overrides', async () => {
  const { app, calls } = createHarness({ CI_MCP_WRITE_ENABLED: 'true', CI_MCP_TOKEN: 'secret' });
  const response = await request(app)
    .post('/mcp/ci')
    .set('Authorization', 'Bearer secret')
    .send(rpc(6, 'tools/call', {
      name: 'ci_execute',
      arguments: {
        task_id: 't1',
        permissions: { repoWrite: true, externalApiWrite: true, deployOrDeviceConfirm: true },
      },
    }));

  assert.equal(response.status, 200);
  assert.equal(response.body.result.isError, false);
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [['POST', '/ci/task/t1/run', '{}']]);
});

test('ci_verify returns verification evidence without changing task state', async () => {
  const { app, calls } = createHarness();
  const response = await request(app)
    .post('/mcp/ci')
    .send(rpc(7, 'tools/call', { name: 'ci_verify', arguments: { task_id: 't1' } }));

  assert.equal(response.status, 200);
  assert.equal(response.body.result.isError, false);
  assert.equal(response.body.result.structuredContent.task_id, 't1');
  assert.deepEqual(response.body.result.structuredContent.verification, { status: 'blocked', method: 'safe_stub' });
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [['GET', '/ci/task/t1']]);
});

test('Ci MCP rejects unexpected browser origins', async () => {
  const { app } = createHarness();
  const response = await request(app)
    .post('/mcp/ci')
    .set('Origin', 'https://example.com')
    .send(rpc(8, 'tools/list'));

  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'Origin not allowed.');
});
