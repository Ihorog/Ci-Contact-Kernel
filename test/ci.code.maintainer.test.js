'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { RepoRegistry } = require('../src/ci/repoRegistry');
const {
  buildCoordinate,
  validateCoordinate,
  buildCapability,
  computeCapabilityHash,
  evaluateCapabilityAccess,
  generateCorrelationId,
  buildCiContact,
  CiCompletion
} = require('../src/ci/contracts');
const { EventIntake } = require('../src/ci/eventIntake');
const { MaintainerLoop } = require('../src/ci/maintainerLoop');
const { OperationsDigest, KNOWN_EXTERNAL_GATES } = require('../src/ci/operationsDigest');
const { createKernel } = require('../src/ci/kernel');
const app = require('../src/server');

let shaCounter = 0;
function nextVerifiedEvidence() {
  shaCounter += 1;
  const sha = `abcdef${String(shaCounter).padStart(7, '0')}`;
  return {
    observed_execution: {
      sha,
      verified: true,
      evidence_refs: [{ ref: `check/${shaCounter}`, sha }]
    }
  };
}

function approvedOptions(loop, payload, options = {}) {
  const intake = loop.eventIntake.intake(payload);
  const authority = loop.approve(intake.correlation_id, {
    repository_id: intake.work_unit.repository_id,
    risk_class: intake.work_unit.risk_class
  });
  return { ...nextVerifiedEvidence(), ...options, authority };
}

function createAuthorizedLoop() {
  const repoRegistry = new RepoRegistry();
  repoRegistry.updateVerification = () => null;
  return new MaintainerLoop({ repoRegistry });
}

test('RepoRegistry: inventories all 19 Ihorog repositories with required fields', () => {
  const registry = new RepoRegistry();
  const repos = registry.list();
  assert.equal(repos.length, 19, 'Must inventory exactly 19 repositories');

  const kernelRepo = registry.get('Ihorog/Ci-Contact-Kernel');
  assert.ok(kernelRepo, 'Ci-Contact-Kernel repo must be present');
  assert.equal(kernelRepo.role, 'CONTROL');
  assert.equal(kernelRepo.risk_class, 'R2');
  assert.ok(Array.isArray(kernelRepo.capabilities));
  assert.ok(Array.isArray(kernelRepo.required_checks));
  assert.ok(Array.isArray(kernelRepo.known_external_gates));
  assert.ok(kernelRepo.known_external_gates.includes(KNOWN_EXTERNAL_GATES.NOTIFICATION_SETTINGS));
  assert.ok(kernelRepo.known_external_gates.includes(KNOWN_EXTERNAL_GATES.CROSS_REPO_PERMISSIONS));

  // Check that all 19 repos have valid fields
  for (const repo of repos) {
    assert.ok(repo.repository_id, 'repo.repository_id required');
    assert.ok(repo.role, 'repo.role required');
    assert.ok(repo.default_branch, 'repo.default_branch required');
    assert.ok(repo.risk_class, 'repo.risk_class required');
    assert.ok(repo.maintainer_policy, 'repo.maintainer_policy required');
    assert.ok(repo.notification_policy, 'repo.notification_policy required');
  }
});

test('Contracts: CiCoordinate, CiCapability, CiContact, CiCompletion', () => {
  // CiCoordinate
  const coord = buildCoordinate({ repository_id: 'Ihorog/Ci-Contact-Kernel', domain: 'WORK/SOURCE_CONTROL' });
  assert.equal(validateCoordinate(coord), true);
  assert.equal(coord.repository_id, 'Ihorog/Ci-Contact-Kernel');

  // CiCapability
  const cap = buildCapability({ name: 'deploy_capability', allowed_actions: ['deploy'], risk_class: 'R1' });
  const hash = computeCapabilityHash(cap);
  assert.ok(hash);
  const evalOk = evaluateCapabilityAccess(cap, 'deploy', 'R1');
  assert.equal(evalOk.allowed, true);

  const evalDeniedRisk = evaluateCapabilityAccess(cap, 'deploy', 'R3');
  assert.equal(evalDeniedRisk.allowed, false);

  // CiContact & Correlation ID
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 42 }, title: 'Fix bug' };
  const contact = buildCiContact(payload);
  assert.ok(contact.correlation_id.startsWith('corr-'));

  // CiCompletion
  const completion = new CiCompletion();
  const task = completion.createTaskContract({ id: 'task-1' });
  const sha = 'abc1234';
  const verif = completion.verifyTask(task, { status: 'SUCCESS' }, {
    final_sha: sha,
    observed: true,
    verified: true,
    evidence_refs: [{ ref: 'test', sha }]
  });
  assert.equal(verif.canComplete, true);
});

test('EventIntake: Idempotent intake deduplicates repeated events', () => {
  const intake = new EventIntake();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, issue: { number: 10 }, title: 'Memory leak' };

  const first = intake.intake(payload);
  assert.equal(first.duplicate, false);
  assert.equal(first.work_unit.status, 'INTAKEN');

  const second = intake.intake(payload);
  assert.equal(second.duplicate, true);
  assert.equal(second.correlation_id, first.correlation_id);
});

test('MaintainerLoop: Negative Test 1 & 2 - Duplicate event and retry are idempotent', async () => {
  const loop = createAuthorizedLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 100 }, title: 'Refactor core' };

  const res1 = await loop.run(payload, approvedOptions(loop, payload));
  assert.equal(res1.status, 'COMPLETED');
  assert.ok(res1.final_sha);

  // Duplicate intake run
  const res2 = await loop.run(payload);
  assert.equal(res2.status, 'DUPLICATE_SKIPPED');
  assert.equal(res2.actions_executed, 0);
});

test('MaintainerLoop: Negative Test 3 - Stale experience does not bypass permission', async () => {
  const loop = new MaintainerLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, risk_class: 'R2', title: 'Update system' };

  const res = await loop.run(payload, { staleExperience: true });
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.reason.includes('Stale experience'));
});

test('MaintainerLoop: Negative Test 4 - Policy/schema change invalidates fast path', async () => {
  const loop = createAuthorizedLoop();
  const payload1 = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 101 }, title: 'Fast path test' };

  const run1 = await loop.run(payload1, approvedOptions(loop, payload1));
  assert.equal(run1.status, 'COMPLETED');

  // Change policy version which invalidates fast path cache
  loop.currentPolicyVersion = 'v2.0.0';

  const payload2 = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 102 }, title: 'Fast path test' };
  const run2 = await loop.run(payload2, approvedOptions(loop, payload2));
  assert.equal(run2.status, 'COMPLETED');
  assert.equal(run2.used_fast_path, false);
});

test('MaintainerLoop: Negative Test 5 - Cross-repo experience does not grant authority', async () => {
  const loop = new MaintainerLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, risk_class: 'R2', title: 'Cross repo test' };

  const res = await loop.run(payload, { source_repo_experience: 'Ihorog/ci-moment' });
  assert.equal(res.status, 'BLOCKED');
  assert.ok(res.reason.includes('Cross-repository authority violation'));
});

test('MaintainerLoop: Negative Test 6 - Failing dependency bulkhead does not block separate bulkhead', async () => {
  const loop = createAuthorizedLoop();

  const payloadA = { repository: { full_name: 'Ihorog/ci-moment' }, pull_request: { number: 1 }, title: 'A' };
  const payloadB = { repository: { full_name: 'Ihorog/cimeika-backend' }, pull_request: { number: 2 }, title: 'B' };

  const resA = await loop.run(payloadA, approvedOptions(loop, payloadA, { simulateTestFailure: true }));
  assert.equal(resA.status, 'VERIFICATION_FAILED');

  const resB = await loop.run(payloadB, approvedOptions(loop, payloadB));
  assert.equal(resB.status, 'COMPLETED');
});

test('MaintainerLoop: Negative Test 7 - Unresolved review or merge conflict blocks merge', async () => {
  const loop = createAuthorizedLoop();
  const payload1 = { repository: { full_name: 'Ihorog/ci-moment' }, pull_request: { number: 3 }, title: 'PR review blocked' };

  const res1 = await loop.run(payload1, approvedOptions(loop, payload1, { hasUnresolvedReview: true }));
  assert.equal(res1.status, 'MERGE_BLOCKED');
  assert.ok(res1.reason.includes('Unresolved review'));

  const payload2 = { repository: { full_name: 'Ihorog/ci-moment' }, pull_request: { number: 4 }, title: 'PR conflict blocked' };
  const res2 = await loop.run(payload2, approvedOptions(loop, payload2, { hasMergeConflict: true }));
  assert.equal(res2.status, 'MERGE_BLOCKED');
  assert.ok(res2.reason.includes('Merge conflict'));
});

test('MaintainerLoop: Negative Test 8 - AI proposal does not become code without mechanical verification', async () => {
  const loop = createAuthorizedLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 5 }, title: 'Copilot AI Proposal' };

  const res = await loop.run(payload, approvedOptions(loop, payload, { aiProposalUnverified: true }));
  assert.equal(res.status, 'MERGE_BLOCKED');
  assert.ok(res.reason.includes('AI proposal has not passed mechanical verification'));
});

test('MaintainerLoop: Negative Test 9 - Self-modified instruction with regression automatically rolls back', async () => {
  const loop = createAuthorizedLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, issue: { number: 20 }, is_self_modified: true, title: 'Self-modified instruction update' };

  const res = await loop.run(payload, approvedOptions(loop, payload, { isSelfModifiedInstruction: true, simulateTestFailure: true }));
  assert.equal(res.status, 'ROLLED_BACK');
  assert.equal(res.rollback, true);
  assert.ok(res.reason.includes('Self-modified instruction introduced regression'));
});

test('MaintainerLoop: Negative Test 10 - Kernel failure is isolated without corrupting repository state', async () => {
  const loop = createAuthorizedLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, simulate_kernel_error: true, title: 'Error handling' };

  const res = await loop.run(payload, approvedOptions(loop, payload));
  assert.equal(res.status, 'FAILED');
  assert.ok(res.error.includes('Kernel failure isolated'));
});

test('MaintainerLoop: Negative Test 11 - Repeated maintainer run is idempotent', async () => {
  const loop = createAuthorizedLoop();
  const payload = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 99 }, title: 'Idempotency test' };

  const run1 = await loop.run(payload, approvedOptions(loop, payload));
  assert.equal(run1.status, 'COMPLETED');

  const run2 = await loop.run(payload);
  assert.equal(run2.status, 'DUPLICATE_SKIPPED');
});

test('OperationsDigest: Consolidates notifications into single Digest and filters noise', () => {
  const digest = new OperationsDigest();

  // Process noise event
  const noiseResult = digest.processEvent({ event_type: 'ci_success', repository_id: 'Ihorog/Ci-Contact-Kernel' });
  assert.equal(noiseResult.action, 'RECORDED_IN_DIGEST');
  assert.equal(noiseResult.suppressed, true);

  // Process immediate alert trigger
  const alertResult = digest.processEvent({
    immediate_trigger: 'security_incident',
    repository_id: 'Ihorog/Ci-Contact-Kernel',
    title: 'Secret detected'
  });
  assert.equal(alertResult.action, 'IMMEDIATE_NOTIFICATION_SENT');

  const summary = digest.generateDigestSummary();
  assert.equal(summary.summary.suppressed_noise_notifications, 1);
  assert.equal(summary.summary.immediate_alerts_triggered, 1);
  assert.ok(Array.isArray(summary.external_gates));
  assert.equal(summary.external_gates.length, 2);
});

test('HTTP API: /ci/registry/repos, /ci/maintainer/intake, /ci/maintainer/run, /ci/digest', async () => {
  const token = 'ci-test-token-123';
  const server = app.createApp({ env: { ...process.env, CI_MAINTAINER_TOKEN: token } });

  // GET /ci/registry/repos
  const repoRes = await request(server).get('/ci/registry/repos');
  assert.equal(repoRes.status, 200);
  assert.equal(repoRes.body.repositories.length, 19);

  // POST /ci/maintainer/intake
  const intakeRes = await request(server)
    .post('/ci/maintainer/intake')
    .set('x-ci-maintainer-token', token)
    .send({ repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, issue: { number: 100 }, title: 'API Intake Test' });
  assert.equal(intakeRes.status, 201);
  assert.equal(intakeRes.body.duplicate, false);

  // POST /ci/maintainer/run
  const runRes = await request(server)
    .post('/ci/maintainer/run')
    .set('x-ci-maintainer-token', token)
    .send({ repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, pull_request: { number: 200 }, title: 'API Run Test' });
  assert.equal(runRes.status, 200);
  assert.equal(runRes.body.result.status, 'BLOCKED');

  // GET /ci/digest
  const digestRes = await request(server).get('/ci/digest');
  assert.equal(digestRes.status, 200);
  assert.ok(digestRes.body.summary);
});
