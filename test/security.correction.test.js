'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { MaintainerLoop } = require('../src/ci/maintainerLoop');
const { CiCompletion } = require('../src/ci/contracts');
const { RepoRegistry } = require('../src/ci/repoRegistry');
const { createApp } = require('../src/server');

test('caller approval claims cannot authorize critical work', async () => {
  const loop = new MaintainerLoop();
  const result = await loop.run({
    repository: { full_name: 'Ihorog/Ci-Contact-Kernel' },
    alert: { number: 1 },
    user_approval: true,
    risk_class: 'R1'
  }, { user_approval: true, explicit_r2_policy: true });
  assert.equal(result.status, 'BLOCKED');
});

test('server-ledger approval permits one verified execution', async () => {
  const loop = new MaintainerLoop();
  const event = { repository: { full_name: 'Ihorog/Ci-Contact-Kernel' }, issue: { number: 2 } };
  const intake = loop.eventIntake.intake(event);
  const authority = loop.approve(intake.correlation_id, {
    repository_id: 'Ihorog/Ci-Contact-Kernel', risk_class: 'R2'
  });
  const sha = 'abcdef1234567';
  const result = await loop.run(event, {
    authority,
    observed_execution: {
      sha, verified: true, evidence_refs: [{ ref: 'check/2', sha }]
    }
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal((await loop.run(event, { authority })).status, 'DUPLICATE_SKIPPED');
});

test('completion rejects missing or unverified evidence', () => {
  const completion = new CiCompletion();
  const task = completion.createTaskContract({ id: 'security-test' });
  assert.equal(completion.verifyTask(task, { status: 'SUCCESS' }, {}).canComplete, false);
});

test('maintainer writes require constant-time shared-token authentication', async () => {
  const token = 'ci-test-token-123';
  const app = createApp({ env: { NODE_ENV: 'production', CI_MAINTAINER_TOKEN: token } });
  assert.equal((await request(app).post('/ci/maintainer/intake').send({})).status, 401);
  assert.equal((await request(app).post('/ci/maintainer/intake')
    .set('x-ci-maintainer-token', ['ci', 'test', 'token', '123'].join('-'))
    .send({ title: 'authorized' })).status, 201);
});

test('corrupt registry is explicitly degraded', () => {
  const file = path.join(os.tmpdir(), `ci-registry-${process.pid}.json`);
  fs.writeFileSync(file, '{');
  try {
    const registry = new RepoRegistry(file);
    assert.equal(registry.status, 'DEGRADED');
    assert.match(registry.diagnostic, /Registry unavailable/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});
