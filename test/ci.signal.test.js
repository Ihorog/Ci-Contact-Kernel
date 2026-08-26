const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { createApp } = require('../src/server');

const tempMemory = path.join(__dirname, 'tmp-memory.jsonl');

test.beforeEach(() => {
  if (fs.existsSync(tempMemory)) fs.unlinkSync(tempMemory);
});

test('POST /ci/signal creates a normalized queued task', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ci/signal')
    .send({ text: 'fact: system status is stable' })
    .expect(202);

  assert.equal(response.body.task.classification, 'fact');
  assert.equal(response.body.task.targetNode, 'current_fact');
  assert.equal(response.body.task.executionCenter, 'local');
  assert.equal(response.body.task.status, 'QUEUED');
});

test('POST /ci/task/:id/run completes safe local task with verification', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/signal')
    .send({ text: 'fact: system status is stable' })
    .expect(202);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  assert.equal(runResponse.body.task.status, 'COMPLETED');
  assert.equal(runResponse.body.task.verification.status, 'verified');
  assert.equal(runResponse.body.task.verification.method, 'direct_result');
});

test('unsafe external actions are blocked by default', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ci/signal')
    .send({ text: 'deploy service now' })
    .expect(202);

  assert.equal(response.body.task.classification, 'service_action');
  assert.equal(response.body.task.status, 'BLOCKED');
  assert.equal(response.body.task.verification.status, 'blocked');
  assert.match(response.body.task.permissionDecision, /BLOCKED/);
});

test('POST /ciopen/webhook normalizes as webhook event input', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ciopen/webhook')
    .send({ event: 'push', payload: { type: 'event' } })
    .expect(202);

  assert.equal(response.body.task.source, 'ciopen.webhook');
  assert.equal(response.body.task.classification, 'event');
  assert.equal(response.body.task.targetNode, 'event');
});

test('webhook payload with privileged action keywords is permission-gated', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const response = await request(app)
    .post('/ciopen/webhook')
    .send({ payload: { action: 'deploy' } })
    .expect(202);

  assert.equal(response.body.task.classification, 'service_action');
  assert.equal(response.body.task.status, 'BLOCKED');
  assert.match(response.body.task.permissionDecision, /deploy/);
});
