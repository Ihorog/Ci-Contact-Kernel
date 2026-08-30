'use strict';

const crypto = require('crypto');
const { createReplan } = require('./skillGraph');

function replan(graph, observation, completedSteps) {
  const completed = new Set((completedSteps || []).map((step) => step.stepId));
  const patchSteps = (graph.steps || []).map((step) => {
    if (completed.has(step.stepId)) return { ...step, status: 'COMPLETED' };
    return { ...step };
  });

  patchSteps.push({
    stepId: `replan-${crypto.randomUUID()}`,
    name: `Address ${observation && observation.type ? observation.type : 'observation'}`,
    dependsOn: Array.from(completed),
    requiredResources: [],
    preconditions: [],
    postconditions: [],
    capabilityRef: null,
    requiresApproval: true,
    requiresVerification: true,
    rollbackRef: null,
    status: 'PENDING'
  });

  const next = createReplan(graph, observation && observation.reason ? observation.reason : 'observation', patchSteps);
  next.audit = {
    reason: observation && observation.reason ? observation.reason : 'observation',
    observation,
    timestamp: new Date().toISOString(),
    priorVersion: graph.version
  };
  return next;
}

module.exports = { replan };
