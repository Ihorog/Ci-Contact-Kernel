const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { createApp } = require('../src/server');

const tempMemory = path.join(__dirname, 'tmp-contact-memory.jsonl');

test.beforeEach(() => {
  if (fs.existsSync(tempMemory)) fs.unlinkSync(tempMemory);
});

// ── Signal contract: severity field propagates ──
test('signal with severity=critical is queued and returned', async () => {
  const app = createApp({ memoryFilePath: tempMemory });
  const res = await request(app)
    .post('/ci/signal')
    .send({ message: 'critical alert', severity: 'critical', source: 'text' })
    .expect(202);
  assert.ok(res.body.task.id, 'task should have an id');
  assert.ok(res.body.task.status, 'task should have a status');
});

test('signal with severity=normal is queued without error', async () => {
  const app = createApp({ memoryFilePath: tempMemory });
  const res = await request(app)
    .post('/ci/signal')
    .send({ message: 'normal ping', severity: 'normal', source: 'text' })
    .expect(202);
  assert.ok(res.body.task.id);
});

// ── State machine: task progresses through states ──
test('task created via /ci/task has a valid initial state', async () => {
  const app = createApp({ memoryFilePath: tempMemory });
  const res = await request(app)
    .post('/ci/task')
    .send({ message: 'test task', type: 'task' })
    .expect(201);
  const { task } = res.body;
  assert.ok(task.id);
  assert.ok(['CREATED', 'CLASSIFIED', 'ROUTED', 'QUEUED'].includes(task.status), `unexpected status: ${task.status}`);
});

// ── Critical confirmation: approve endpoint exists ──
test('approve endpoint requires checkpointId', async () => {
  const app = createApp({ memoryFilePath: tempMemory });
  // create a task first
  const created = await request(app)
    .post('/ci/task')
    .send({ message: 'approval required', type: 'task' })
    .expect(201);
  const taskId = created.body.task.id;

  // approve without checkpointId should return 400
  const res = await request(app)
    .post(`/ci/task/${taskId}/approve`)
    .send({})
    .expect(400);
  assert.match(res.body.error, /checkpointId/);
});

// ── Static file: index.html is served ──
test('GET / serves index.html with 200', async () => {
  const app = createApp({ memoryFilePath: tempMemory });
  const res = await request(app).get('/').expect(200);
  assert.ok(res.text.includes('Ci+'), 'index.html should contain Ci+');
});

// ── Static file: logo path exists ──
test('GET /assets/ci-logo.png returns a PNG', async () => {
  const app = createApp({ memoryFilePath: tempMemory });
  const res = await request(app).get('/assets/ci-logo.png').expect(200);
  assert.equal(res.headers['content-type'].split(';')[0], 'image/png');
});
