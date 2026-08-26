const { CLASSIFICATIONS, EXECUTION_CENTERS } = require('./constants');

function routeTask(task) {
  switch (task.classification) {
    case CLASSIFICATIONS.MEMORY:
    case CLASSIFICATIONS.FACT:
      return { targetNode: 'ci.memory.node', executionCenter: EXECUTION_CENTERS.MEMORY };
    case CLASSIFICATIONS.REPO_ACTION:
      return { targetNode: 'ci.repo.node', executionCenter: EXECUTION_CENTERS.REPO };
    case CLASSIFICATIONS.SERVICE_ACTION:
      return { targetNode: 'ci.service.node', executionCenter: EXECUTION_CENTERS.SERVICE };
    case CLASSIFICATIONS.DEVICE_ACTION:
    case CLASSIFICATIONS.DEPLOY_ACTION:
      return { targetNode: 'ci.device.node', executionCenter: EXECUTION_CENTERS.DEVICE };
    case CLASSIFICATIONS.HUMAN_ACTION:
      return { targetNode: 'ci.human.node', executionCenter: EXECUTION_CENTERS.HUMAN };
    case CLASSIFICATIONS.INTENT:
    case CLASSIFICATIONS.TASK:
      return { targetNode: 'ci.ai.node', executionCenter: EXECUTION_CENTERS.AI };
    case CLASSIFICATIONS.EVENT:
      return { targetNode: 'ci.local.node', executionCenter: EXECUTION_CENTERS.LOCAL };
    default:
      return { targetNode: 'ci.unknown.node', executionCenter: EXECUTION_CENTERS.LOCAL };
  }
}

module.exports = { routeTask };
