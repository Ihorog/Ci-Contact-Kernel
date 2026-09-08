import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/workerWithCiMcp.mjs';

function makeKv() {
  const values = new Map();
  return {
    async get(key, options = {}) {
      const value = values.get(key);
      if (value === undefined) return null;
      return options.type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      values.set(key, value);
    },
  };
}

function makeEnv() {
  return {
    CI_LINK_TOKEN: 'test-ci-link-token',
    CI_MEMORY_KV: makeKv(),
    ASSETS: {
      async fetch() {
        return new Response('asset', { status: 200 });
      },
    },
  };
}

function authHeaders(extra = {}) {
  return {
    authorization: 'Bearer test-ci-link-token',
    'content-type': 'application/json',
    ...extra,
  };
}

test('Ci Link fails closed when auth is not configured', async () => {
  const response = await worker.fetch(new Request('https://example.test/ci', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'status' }),
  }), { CI_MEMORY_KV: makeKv() });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, 'ci_link_auth_not_configured');
});

test('Ci Link rejects an invalid bearer token', async () => {
  const response = await worker.fetch(new Request('https://example.test/ci', {
    method: 'POST',
    headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'status' }),
  }), makeEnv());
  assert.equal(response.status, 401);
});

test('Ci Link stores a sanitized coordinate snapshot', async () => {
  const env = makeEnv();
  const response = await worker.fetch(new Request('https://example.test/ci', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      mode: 'sync',
      source: 'chatgpt.ci',
      surface: {
        tools: ['web', 'github'],
        connectors: ['GitHub'],
        apiKey: 'must-not-survive',
        nested: { password: 'must-not-survive', status: 'active' },
      },
    }),
  }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.link.coordinate, 'CI.LINK');
  assert.equal(body.link.contract, 'ci-link/v1');
  assert.equal(body.link.durableSnapshot, true);
  assert.deepEqual(body.surface.tools, ['web', 'github']);
  assert.equal(Object.hasOwn(body.surface, 'apiKey'), false);
  assert.equal(Object.hasOwn(body.surface.nested, 'password'), false);
  assert.equal(body.surface.nested.status, 'active');

  const readBack = await worker.fetch(new Request('https://example.test/ci', {
    headers: { authorization: 'Bearer test-ci-link-token' },
  }), env);
  const readBody = await readBack.json();
  assert.equal(readBack.status, 200);
  assert.deepEqual(readBody.surface.tools, ['web', 'github']);
});

test('Ci Link carries intent through the existing Ci control plane', async () => {
  const env = makeEnv();
  const response = await worker.fetch(new Request('https://example.test/ci', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      mode: 'contact',
      source: 'chatgpt.ci',
      intent: 'Перевір актуальний стан Ci',
      context: { project: 'ci+' },
      surface: { actionSurface: 'verified-at-contact' },
    }),
  }), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.link.state, 'VERIFIED_CONTACT');
  assert.equal(body.task.classification, 'fact');
  assert.equal(body.task.status, 'COMPLETED');
  assert.equal(body.evidence.taskId, body.task.id);
  assert.equal(body.evidence.verification.status, 'verified');
});
