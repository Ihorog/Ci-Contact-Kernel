const { CLASSIFICATIONS, EXECUTION_CENTERS } = require('./constants');

function routeTask(task) {
  let primary;
  switch (task.classification) {
    case CLASSIFICATIONS.MEMORY:
    case CLASSIFICATIONS.FACT:
      primary = { targetNode: 'ci.memory.node', executionCenter: EXECUTION_CENTERS.MEMORY };
      break;
    case CLASSIFICATIONS.REPO_ACTION:
      primary = { targetNode: 'ci.repo.node', executionCenter: EXECUTION_CENTERS.REPO };
      break;
    case CLASSIFICATIONS.SERVICE_ACTION:
      primary = { targetNode: 'ci.service.node', executionCenter: EXECUTION_CENTERS.SERVICE };
      break;
    case CLASSIFICATIONS.DEVICE_ACTION:
    case CLASSIFICATIONS.DEPLOY_ACTION:
      primary = { targetNode: 'ci.device.node', executionCenter: EXECUTION_CENTERS.DEVICE };
      break;
    case CLASSIFICATIONS.HUMAN_ACTION:
      primary = { targetNode: 'ci.human.node', executionCenter: EXECUTION_CENTERS.HUMAN };
      break;
    case CLASSIFICATIONS.INTENT:
    case CLASSIFICATIONS.TASK:
      primary = { targetNode: 'ci.ai.node', executionCenter: EXECUTION_CENTERS.AI };
      break;
    case CLASSIFICATIONS.EVENT:
      primary = { targetNode: 'ci.local.node', executionCenter: EXECUTION_CENTERS.LOCAL };
      break;
    default:
      primary = { targetNode: 'ci.unknown.node', executionCenter: EXECUTION_CENTERS.LOCAL };
  }

  const requestedCenters = Array.isArray(task.payload && task.payload.executionCenters)
    ? task.payload.executionCenters.filter((c) => Object.values(EXECUTION_CENTERS).includes(c))
    : [];

  const executionCenters = requestedCenters.length > 0
    ? requestedCenters
    : [primary.executionCenter];

  return { ...primary, executionCenters };
}

module.exports = { routeTask };

