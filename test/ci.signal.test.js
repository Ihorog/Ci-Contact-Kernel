const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { createApp } = require('../src/server');

const tempMemory = path.join(__dirname, 'tmp-memory.jsonl');

test.beforeEach(() => {
  if (fs.existsSync(tempMemory)) {
    fs.unlinkSync(tempMemory);
  }
});

test('POST /ci/signal returns orchestration details and verification', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ci/signal')
    .send({ text: 'fact: system status is stable' })
    .expect(200);

  assert.equal(response.body.classification, 'fact');
  assert.equal(response.body.node, 'current_fact');
  assert.equal(response.body.permission.state, 'READY');
  assert.equal(response.body.executionCenter, 'local');
  assert.equal(response.body.verification.status, 'verified');
  assert.equal(response.body.memoryRecord.classification, 'fact');
});

test('unsafe external actions are blocked by default', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ci/signal')
    .send({ text: 'deploy service now' })
    .expect(200);

  assert.equal(response.body.classification, 'service_action');
  assert.equal(response.body.permission.state, 'BLOCKED');
  assert.equal(response.body.executionResult.status, 'BLOCKED');
  assert.equal(response.body.verification.status, 'blocked');
  assert.ok(response.body.permission.missing.includes('deploy'));
  assert.ok(response.body.permission.missing.includes('external_api_write'));
});

test('POST /ciopen/webhook normalizes as webhook event input', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ciopen/webhook')
    .send({ event: 'push', payload: { type: 'event' } })
    .expect(200);

  assert.equal(response.body.signal.source, 'webhook');
  assert.equal(response.body.classification, 'event');
  assert.equal(response.body.node, 'event');
});

test('webhook payload with privileged action keywords is permission-gated', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ciopen/webhook')
    .send({ payload: { action: 'deploy' } })
    .expect(200);

  assert.equal(response.body.classification, 'service_action');
  assert.equal(response.body.permission.state, 'BLOCKED');
  assert.ok(response.body.permission.missing.includes('deploy'));
  assert.ok(response.body.permission.missing.includes('external_api_write'));
});
