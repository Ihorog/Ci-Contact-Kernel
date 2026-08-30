'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSkillGraph, addStep, getReadySteps, isGraphComplete } = require('../src/skillGraph');
const { executeStep } = require('../src/skillExecutor');
const { ResourceLock } = require('../src/resourceLock');
const { CapabilityRegistry } = require('../src/capabilityRegistry');
const { CheckpointStore } = require('../src/checkpointStore');
const { replan } = require('../src/replanner');

function buildContext(overrides = {}) {
  return {
    capabilityRegistry: new CapabilityRegistry(),
    permissionGate: { evaluatePermission: () => ({ allowed: true }) },
    completionContract: { maxVerificationRetries: 1 },
    resourceLock: new ResourceLock(),
    checkpointStore: new CheckpointStore(),
    ...overrides
  };
}

test('Steps execute in dependency order (3+ step graph)', async () => {
  const graph = createSkillGraph({ taskId: 'task-1' });
  addStep(graph, { stepId: 's1', name: 'one', execute: async () => ({ outcome: 'ok', order: 1 }) });
  addStep(graph, { stepId: 's2', name: 'two', dependsOn: ['s1'], execute: async () => ({ outcome: 'ok', order: 2 }) });
  addStep(graph, { stepId: 's3', name: 'three', dependsOn: ['s2'], execute: async () => ({ outcome: 'ok', order: 3 }) });
  const context = buildContext();

  assert.deepEqual(getReadySteps(graph).map((step) => step.stepId), ['s1']);
  await executeStep(graph, graph.steps[0], context);
  assert.deepEqual(getReadySteps(graph).map((step) => step.stepId), ['s2']);
  await executeStep(graph, graph.steps[1], context);
  assert.deepEqual(getReadySteps(graph).map((step) => step.stepId), ['s3']);
  await executeStep(graph, graph.steps[2], context);
  assert.equal(isGraphComplete(graph), true);
});

test('Resource conflict blocks incompatible step', async () => {
  const graph = createSkillGraph({ taskId: 'task-2' });
  addStep(graph, { stepId: 's1', name: 'one', requiredResources: ['db'], execute: async () => ({ outcome: 'ok' }) });
  const step = graph.steps[0];
  const resourceLock = new ResourceLock();
  resourceLock.acquire('db', 'other-step');
  const result = await executeStep(graph, step, buildContext({ resourceLock }));
  assert.equal(result.observation, 'resource_unavailable');
  assert.equal(result.status, 'BLOCKED');
});

test('Precondition failure produces observation', async () => {
  const graph = createSkillGraph({ taskId: 'task-3' });
  addStep(graph, { stepId: 's1', name: 'one', preconditions: [() => false], execute: async () => ({ outcome: 'ok' }) });
  const result = await executeStep(graph, graph.steps[0], buildContext());
  assert.equal(result.observation, 'precondition_failed');
});

test('Replan preserves completed steps, never replays side-effecting steps', () => {
  const graph = createSkillGraph({ taskId: 'task-4' });
  addStep(graph, { stepId: 's1', name: 'done', sideEffecting: true, status: 'COMPLETED' });
  addStep(graph, { stepId: 's2', name: 'pending' });
  const next = replan(graph, { type: 'state_changed', reason: 'state changed' }, [graph.steps[0]]);
  const preserved = next.steps.find((step) => step.stepId === 's1');
  assert.equal(preserved.status, 'COMPLETED');
});

test('Newly replanned sensitive step has requiresApproval: true', () => {
  const graph = createSkillGraph({ taskId: 'task-5' });
  addStep(graph, { stepId: 's1', name: 'done', status: 'COMPLETED' });
  const next = replan(graph, { type: 'verification_failed', reason: 'verify failed' }, [graph.steps[0]]);
  const added = next.steps.find((step) => step.stepId.startsWith('replan-'));
  assert.equal(added.requiresApproval, true);
});

test('Task cannot reach COMPLETED unless all step and task verification contracts pass', async () => {
  const graph = createSkillGraph({ taskId: 'task-6', taskVerificationPassed: false });
  addStep(graph, {
    stepId: 's1',
    name: 'verify',
    requiresVerification: true,
    execute: async () => ({ outcome: 'ok' }),
    verify: async () => false
  });
  const result = await executeStep(graph, graph.steps[0], buildContext({ completionContract: { maxVerificationRetries: 0 } }));
  assert.equal(result.observation, 'verification_failed');
  assert.equal(isGraphComplete(graph), false);
});
