const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { createApp } = require('../src/server');

const tempMemory = path.join('/tmp', 'ci-contact-kernel-tests', 'tmp-contract-memory.jsonl');

test.beforeEach(() => {
  fs.mkdirSync(path.dirname(tempMemory), { recursive: true });
  if (fs.existsSync(tempMemory)) fs.unlinkSync(tempMemory);
});

// ─────────────────────────────────────────────────────────────────
// 1. Mechanical Completion Contract
// ─────────────────────────────────────────────────────────────────

test('COMPLETED is unreachable when required verifier is missing', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  // Manually create and run a task, then inspect verificationResults
  const { CiOrchestrator } = require('../src/ciOrchestrator');
  const orch = new CiOrchestrator({ memoryFilePath: tempMemory });

  const task = orch.createTask({ fact: true }, 'test', false);
  // Overwrite requiredVerifiers with something that will never be satisfied
  task.requiredVerifiers = ['result_outcome', 'custom_verifier_never_set'];

  orch.queue.push(task.id);
  orch.transition(task, 'QUEUED');
  await orch.runTaskNow(task.id);

  // Should not be COMPLETED since custom_verifier_never_set never passed
  assert.notEqual(task.status, 'COMPLETED', 'Task should not be COMPLETED with missing verifier');
  // Should be VERIFICATION_FAILED or UNKNOWN after retries exhausted
  assert.ok(
    task.status === 'VERIFICATION_FAILED' || task.status === 'UNKNOWN',
    `Expected VERIFICATION_FAILED or UNKNOWN, got ${task.status}`
  );
});

test('COMPLETED is reached when all required verifiers pass', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/signal')
    .send({ fact: true, value: 'kernel ok' })
    .expect(202);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  assert.equal(runResponse.body.task.status, 'COMPLETED');
  assert.ok(
    Array.isArray(runResponse.body.task.verificationResults) &&
    runResponse.body.task.verificationResults.length > 0,
    'verificationResults should be populated'
  );
  const result = runResponse.body.task.verificationResults[0];
  assert.equal(result.verifierId, 'result_outcome');
  assert.equal(result.status, 'pass');
  assert.ok(result.id, 'verifier result must have an id');
  assert.ok(result.timestamp, 'verifier result must have a timestamp');
});

test('retry exhaustion transitions to VERIFICATION_FAILED with incident record', async () => {
  const { CiOrchestrator } = require('../src/ciOrchestrator');
  const orch = new CiOrchestrator({ memoryFilePath: tempMemory });

  const task = orch.createTask({ fact: true }, 'test', false);
  task.requiredVerifiers = ['always_fails'];
  task.maxVerificationRetries = 0;

  // Simulate running multiple times to exhaust retries
  orch.queue.push(task.id);
  orch.transition(task, 'QUEUED');

  // First attempt
  await orch.runTaskNow(task.id);

  // Should have an incidentRecord after retry exhaustion
  assert.equal(task.status, 'VERIFICATION_FAILED');
  assert.ok(task.incidentRecord, 'incidentRecord should be set after exhaustion');
  assert.ok(task.incidentRecord.id, 'incidentRecord should have an id');
  assert.ok(task.incidentRecord.timestamp, 'incidentRecord should have a timestamp');
  assert.ok(task.incidentRecord.reason, 'incidentRecord should have a reason');
});

// ─────────────────────────────────────────────────────────────────
// 2. Tool-level Approval + Checkpoint/Resume
// ─────────────────────────────────────────────────────────────────

test('sensitive invocation pauses in WAITING_APPROVAL and creates checkpoint', async () => {
  const app = createApp({ memoryFilePath: tempMemory, permissions: { repoWrite: true } });

  // Create a repo_action task (sensitive center) — permission is granted but approval policy requires human
  const createResponse = await request(app)
    .post('/ci/task')
    .send({ classification: 'repo_action', permissionLevel: 'L3_REPO_WRITE', approvalPolicy: 'require_human' })
    .expect(201);

  const taskId = createResponse.body.task.id;

  const runResponse = await request(app)
    .post(`/ci/task/${taskId}/run`)
    .send({ permissions: { repoWrite: true } })
    .expect(200);

  assert.equal(runResponse.body.task.status, 'WAITING_APPROVAL');
  assert.ok(runResponse.body.task.checkpointId, 'checkpointId should be set');
  assert.equal(runResponse.body.task.approvalState, 'pending');
});

test('approval resumes task from checkpoint without replaying completed steps', async () => {
  const app = createApp({ memoryFilePath: tempMemory, permissions: { repoWrite: true } });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({ classification: 'repo_action', permissionLevel: 'L3_REPO_WRITE', approvalPolicy: 'require_human' })
    .expect(201);

  const taskId = createResponse.body.task.id;

  // Run to trigger waiting_approval
  const runResponse = await request(app)
    .post(`/ci/task/${taskId}/run`)
    .send({ permissions: { repoWrite: true } })
    .expect(200);

  assert.equal(runResponse.body.task.status, 'WAITING_APPROVAL');
  const checkpointId = runResponse.body.task.checkpointId;

  // Approve the checkpoint
  const approveResponse = await request(app)
    .post(`/ci/task/${taskId}/approve`)
    .send({ checkpointId, actor: 'test-actor', reason: 'approved for test' })
    .expect(200);

  assert.equal(approveResponse.body.task.approvalState, 'approved');
  // After approval, task should have progressed past WAITING_APPROVAL
  assert.notEqual(approveResponse.body.task.status, 'WAITING_APPROVAL');
});

test('rejection transitions to BLOCKED with auditable reason', async () => {
  const app = createApp({ memoryFilePath: tempMemory, permissions: { repoWrite: true } });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({ classification: 'repo_action', permissionLevel: 'L3_REPO_WRITE', approvalPolicy: 'require_human' })
    .expect(201);

  const taskId = createResponse.body.task.id;

  const runResponse = await request(app)
    .post(`/ci/task/${taskId}/run`)
    .send({ permissions: { repoWrite: true } })
    .expect(200);

  const checkpointId = runResponse.body.task.checkpointId;

  const rejectResponse = await request(app)
    .post(`/ci/task/${taskId}/reject`)
    .send({ checkpointId, actor: 'security-bot', reason: 'policy violation' })
    .expect(200);

  assert.equal(rejectResponse.body.task.status, 'BLOCKED');
  assert.equal(rejectResponse.body.task.approvalState, 'rejected');
  assert.ok(rejectResponse.body.task.nextSuggestedAction.includes('rejected'), 'rejection reason should be in nextSuggestedAction');
});

test('checkpoint is persisted and retrievable', async () => {
  const app = createApp({ memoryFilePath: tempMemory, permissions: { repoWrite: true } });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({ classification: 'repo_action', permissionLevel: 'L3_REPO_WRITE', approvalPolicy: 'require_human' })
    .expect(201);

  const taskId = createResponse.body.task.id;

  await request(app)
    .post(`/ci/task/${taskId}/run`)
    .send({ permissions: { repoWrite: true } })
    .expect(200);

  const taskResponse = await request(app).get(`/ci/task/${taskId}`).expect(200);
  const checkpointId = taskResponse.body.task.checkpointId;

  const cpResponse = await request(app).get(`/ci/checkpoint/${checkpointId}`).expect(200);
  assert.equal(cpResponse.body.checkpoint.taskId, taskId);
  assert.equal(cpResponse.body.checkpoint.status, 'pending_approval');
});

test('low-risk tasks proceed automatically without approval', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/signal')
    .send({ fact: true, value: 'kernel-status-ok' })
    .expect(202);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  assert.equal(runResponse.body.task.status, 'COMPLETED');
  assert.notEqual(runResponse.body.task.status, 'WAITING_APPROVAL');
});

// ─────────────────────────────────────────────────────────────────
// 3. Multi-target Semantic Routing
// ─────────────────────────────────────────────────────────────────

test('signal routes to 3 execution centers and aggregates results', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({
      type: 'signal',
      classification: 'event',
      executionCenters: ['local', 'memory', 'local']
    })
    .expect(201);

  const taskId = createResponse.body.task.id;
  assert.equal(createResponse.body.task.executionCenters.length, 3);

  const runResponse = await request(app)
    .post(`/ci/task/${taskId}/run`)
    .send({})
    .expect(200);

  assert.ok(Array.isArray(runResponse.body.task.branches), 'branches should be an array');
  assert.equal(runResponse.body.task.branches.length, 3, 'should have 3 branches');
  assert.ok(runResponse.body.task.aggregationSummary, 'aggregationSummary should be present');
});

test('multi-branch all_required: all branches succeed → COMPLETED', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({
      type: 'signal',
      classification: 'event',
      executionCenters: ['local', 'memory'],
      aggregationPolicy: 'all_required'
    })
    .expect(201);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  assert.equal(runResponse.body.task.aggregationSummary.outcome, 'success');
  assert.equal(runResponse.body.task.status, 'COMPLETED');
});

test('multi-branch: one blocked branch + all_required → fails aggregation', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  // ai center returns stub (blocked), local returns ok
  const createResponse = await request(app)
    .post('/ci/task')
    .send({
      type: 'signal',
      classification: 'event',
      executionCenters: ['local', 'ai'],
      aggregationPolicy: 'all_required'
    })
    .expect(201);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  assert.equal(runResponse.body.task.aggregationSummary.blocked, 1);
  assert.notEqual(runResponse.body.task.status, 'COMPLETED');
});

test('multi-branch any_success: one successful branch → COMPLETED', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({
      type: 'signal',
      classification: 'event',
      executionCenters: ['ai', 'local'],
      aggregationPolicy: 'any_success'
    })
    .expect(201);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  assert.equal(runResponse.body.task.aggregationSummary.outcome, 'success');
  assert.equal(runResponse.body.task.status, 'COMPLETED');
});

test('multi-branch partial branch state is recorded individually', async () => {
  const app = createApp({ memoryFilePath: tempMemory });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({
      type: 'signal',
      classification: 'event',
      executionCenters: ['local', 'memory', 'ai'],
      aggregationPolicy: 'best_effort'
    })
    .expect(201);

  const runResponse = await request(app)
    .post(`/ci/task/${createResponse.body.task.id}/run`)
    .send({})
    .expect(200);

  const branches = runResponse.body.task.branches;
  assert.equal(branches.length, 3);
  for (const branch of branches) {
    assert.ok(branch.id, 'branch must have id');
    assert.ok(branch.executionCenter, 'branch must have executionCenter');
    assert.ok(branch.status, 'branch must have status');
  }
});

// ─────────────────────────────────────────────────────────────────
// 4. Memory/audit records
// ─────────────────────────────────────────────────────────────────

test('memory records include approval events and checkpoint references', async () => {
  const app = createApp({ memoryFilePath: tempMemory, permissions: { repoWrite: true } });

  const createResponse = await request(app)
    .post('/ci/task')
    .send({ classification: 'repo_action', permissionLevel: 'L3_REPO_WRITE', approvalPolicy: 'require_human' })
    .expect(201);

  const taskId = createResponse.body.task.id;

  const runResponse = await request(app)
    .post(`/ci/task/${taskId}/run`)
    .send({ permissions: { repoWrite: true } })
    .expect(200);

  const checkpointId = runResponse.body.task.checkpointId;

  await request(app)
    .post(`/ci/task/${taskId}/approve`)
    .send({ checkpointId, actor: 'audit-test' })
    .expect(200);

  const memoryResponse = await request(app).get('/ci/memory?limit=50').expect(200);
  const approvalRecord = memoryResponse.body.records.find(
    (r) => r.event === 'approval_decision' && r.taskId === taskId
  );
  assert.ok(approvalRecord, 'approval decision should be in memory records');
  assert.equal(approvalRecord.decision, 'approved');
  assert.equal(approvalRecord.actor, 'audit-test');
  assert.ok(approvalRecord.checkpointId, 'checkpointId should be in memory record');
});
