'use strict';

const { updateStepStatus } = require('./skillGraph');

function resolvePermission(permissionGate, step, context) {
  if (!permissionGate) return { allowed: true, reason: 'no-permission-gate' };
  if (typeof permissionGate === 'function') return permissionGate(step, context);
  if (typeof permissionGate.evaluatePermission === 'function') return permissionGate.evaluatePermission(step, context && context.permissions);
  return { allowed: true, reason: 'unsupported-permission-gate' };
}

function evaluatePreconditions(step, context, graph) {
  for (const precondition of step.preconditions || []) {
    if (typeof precondition === 'function') {
      const result = precondition(context, graph, step);
      if (!result) return false;
    }
  }
  return true;
}

async function runWithVerification(executeFn, verifyFn, step, context) {
  const maxRetries = Number(context.completionContract && context.completionContract.maxVerificationRetries);
  const attempts = Number.isFinite(maxRetries) ? maxRetries + 1 : 1;
  let result = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await executeFn(context, step);
    const verification = await verifyFn(result, step, context, attempt);
    if (verification === true || (verification && verification.passed)) {
      return { status: 'COMPLETED', result, observation: null };
    }
  }

  return { status: 'FAILED', result, observation: 'verification_failed' };
}

async function executeStep(graph, step, context = {}) {
  const resourceLock = context.resourceLock;
  const acquiredResources = [];

  try {
    for (const resourceId of step.requiredResources || []) {
      const acquired = resourceLock ? resourceLock.acquire(resourceId, step.stepId) : { acquired: true };
      if (!acquired.acquired) {
        return { status: 'BLOCKED', result: null, replanNeeded: false, observation: 'resource_unavailable' };
      }
      acquiredResources.push(resourceId);
    }

    if (!evaluatePreconditions(step, context, graph)) {
      updateStepStatus(graph, step.stepId, 'BLOCKED');
      return { status: 'BLOCKED', result: null, replanNeeded: false, observation: 'precondition_failed' };
    }

    const permission = resolvePermission(context.permissionGate, step, context);
    if (permission && permission.allowed === false) {
      updateStepStatus(graph, step.stepId, 'BLOCKED');
      return { status: 'BLOCKED', result: null, replanNeeded: false, observation: 'precondition_failed' };
    }

    if (step.requiresApproval) {
      const checkpoint = context.checkpointStore && typeof context.checkpointStore.create === 'function'
        ? context.checkpointStore.create({ id: graph.taskId || graph.skillGraphId, status: graph.status }, { stepId: step.stepId })
        : null;
      updateStepStatus(graph, step.stepId, 'WAITING_APPROVAL', checkpoint);
      return { status: 'WAITING_APPROVAL', result: checkpoint, replanNeeded: false, observation: null };
    }

    let capability = null;
    if (step.capabilityRef) {
      const registry = context.capabilityRegistry;
      capability = registry && typeof registry.lookup === 'function'
        ? registry.lookup(step.capabilityRef.capabilityId || step.capabilityRef)
        : null;
      if (!capability) {
        updateStepStatus(graph, step.stepId, 'BLOCKED');
        return { status: 'BLOCKED', result: null, replanNeeded: true, observation: 'capability_unavailable' };
      }
    }

    const executeFn = typeof step.execute === 'function'
      ? step.execute
      : (capability && typeof capability.execute === 'function'
          ? capability.execute
          : async () => ({ outcome: 'ok', stepId: step.stepId }));

    const verifyFn = typeof step.verify === 'function'
      ? step.verify
      : (capability && typeof capability.verify === 'function'
          ? capability.verify
          : async (result) => !step.requiresVerification || (result && result.outcome === 'ok'));

    updateStepStatus(graph, step.stepId, step.requiresVerification ? 'VERIFYING' : 'RUNNING');
    const execution = step.requiresVerification
      ? await runWithVerification(executeFn, verifyFn, step, context)
      : { status: 'COMPLETED', result: await executeFn(context, step), observation: null };

    updateStepStatus(graph, step.stepId, execution.status, execution.result);
    const currentStep = graph.steps.find((entry) => entry.stepId === step.stepId);
    if (currentStep) currentStep.verificationPassed = execution.observation !== 'verification_failed';

    return {
      status: execution.status,
      result: execution.result,
      replanNeeded: execution.observation === 'verification_failed' || execution.observation === 'capability_unavailable',
      observation: execution.observation
    };
  } finally {
    if (resourceLock && typeof resourceLock.releaseAll === 'function') {
      resourceLock.releaseAll(step.stepId);
    } else if (resourceLock && typeof resourceLock.release === 'function') {
      for (const resourceId of acquiredResources) resourceLock.release(resourceId, step.stepId);
    }
  }
}

module.exports = { executeStep };
