'use strict';

const crypto = require('crypto');

const TERMINAL_STATUSES = new Set(['COMPLETED', 'SKIPPED']);

function cloneStep(step) {
  return {
    ...step,
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.slice() : [],
    requiredResources: Array.isArray(step.requiredResources) ? step.requiredResources.slice() : [],
    preconditions: Array.isArray(step.preconditions) ? step.preconditions.slice() : [],
    postconditions: Array.isArray(step.postconditions) ? step.postconditions.slice() : []
  };
}

function cloneGraph(graph) {
  return {
    ...graph,
    steps: (graph.steps || []).map(cloneStep),
    history: Array.isArray(graph.history) ? graph.history.slice() : []
  };
}

function createSkillGraph(opts = {}) {
  return {
    skillGraphId: opts.skillGraphId || crypto.randomUUID(),
    taskId: opts.taskId || null,
    version: opts.version || 1,
    steps: [],
    status: opts.status || 'PENDING',
    verificationPassed: opts.verificationPassed,
    taskVerificationPassed: opts.taskVerificationPassed,
    history: []
  };
}

function addStep(graph, step) {
  graph.steps.push(cloneStep({
    stepId: step.stepId || crypto.randomUUID(),
    name: step.name || 'unnamed-step',
    dependsOn: step.dependsOn || [],
    requiredResources: step.requiredResources || [],
    preconditions: step.preconditions || [],
    postconditions: step.postconditions || [],
    capabilityRef: step.capabilityRef || null,
    requiresApproval: Boolean(step.requiresApproval),
    requiresVerification: Boolean(step.requiresVerification),
    rollbackRef: step.rollbackRef || null,
    sideEffecting: Boolean(step.sideEffecting),
    idempotent: Boolean(step.idempotent),
    status: step.status || 'PENDING',
    result: step.result,
    execute: step.execute,
    verify: step.verify
  }));
  return graph;
}

function getReadySteps(graph) {
  const completed = new Set((graph.steps || []).filter((step) => step.status === 'COMPLETED').map((step) => step.stepId));
  return (graph.steps || []).filter((step) => step.status === 'PENDING' && step.dependsOn.every((dep) => completed.has(dep)));
}

function updateStepStatus(graph, stepId, status, result) {
  const step = (graph.steps || []).find((entry) => entry.stepId === stepId);
  if (!step) return graph;
  step.status = status;
  if (typeof result !== 'undefined') step.result = result;
  if (isGraphComplete(graph)) graph.status = 'COMPLETED';
  else if (status === 'RUNNING' || status === 'VERIFYING') graph.status = status;
  else if (status === 'FAILED' || status === 'BLOCKED') graph.status = status;
  return graph;
}

function isGraphComplete(graph) {
  const steps = graph.steps || [];
  if (steps.length === 0) return false;
  const allTerminal = steps.every((step) => TERMINAL_STATUSES.has(step.status));
  if (!allTerminal) return false;
  if (graph.verificationPassed === false || graph.taskVerificationPassed === false) return false;
  return steps.every((step) => {
    if (step.status === 'SKIPPED') return true;
    if (step.status !== 'COMPLETED') return false;
    if (step.requiresVerification && step.verificationPassed === false) return false;
    return true;
  });
}

function createReplan(graph, reason, patchSteps) {
  const next = cloneGraph(graph);
  next.version += 1;
  next.status = 'PENDING';
  next.history.push({
    timestamp: new Date().toISOString(),
    priorVersion: graph.version,
    reason
  });

  const existingById = new Map(next.steps.map((step) => [step.stepId, step]));
  for (const patch of patchSteps || []) {
    const existing = existingById.get(patch.stepId);
    if (existing && existing.status === 'COMPLETED' && existing.sideEffecting && !existing.idempotent) {
      continue;
    }
    if (existing) {
      Object.assign(existing, cloneStep({ ...existing, ...patch }));
    } else {
      next.steps.push(cloneStep({ ...patch, status: patch.status || 'PENDING' }));
    }
  }

  return next;
}

module.exports = {
  createSkillGraph,
  addStep,
  getReadySteps,
  updateStepStatus,
  isGraphComplete,
  createReplan
};
