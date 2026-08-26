const { PERMISSION_LEVELS } = require('./constants');

function evaluatePermission(task, permissions = {}) {
  const level = task.permissionLevel || PERMISSION_LEVELS.L0_READ;

  if (level === PERMISSION_LEVELS.L0_READ || level === PERMISSION_LEVELS.L1_DRAFT) {
    return { allowed: true, decision: 'ALLOWED', reason: 'Low-risk permission level.' };
  }

  if (level === PERMISSION_LEVELS.L2_LOCAL_WRITE) {
    return permissions.localWrite
      ? { allowed: true, decision: 'ALLOWED', reason: 'Explicit local workspace permission granted.' }
      : { allowed: false, decision: 'BLOCKED', reason: 'Missing explicit local workspace permission.' };
  }

  if (level === PERMISSION_LEVELS.L3_REPO_WRITE) {
    return permissions.repoWrite
      ? { allowed: true, decision: 'ALLOWED', reason: 'Explicit repository delegation granted.' }
      : { allowed: false, decision: 'BLOCKED', reason: 'Missing explicit repository delegation.' };
  }

  if (level === PERMISSION_LEVELS.L4_EXTERNAL_API_WRITE) {
    return permissions.externalApiWrite
      ? { allowed: true, decision: 'ALLOWED', reason: 'Explicit external API permission granted.' }
      : { allowed: false, decision: 'BLOCKED', reason: 'Missing explicit external service/API permission.' };
  }

  if (level === PERMISSION_LEVELS.L5_DEPLOY_OR_DEVICE_ACTION) {
    return permissions.deployOrDeviceConfirm
      ? { allowed: true, decision: 'ALLOWED', reason: 'Explicit deploy/device confirmation granted.' }
      : { allowed: false, decision: 'BLOCKED', reason: 'Missing explicit deploy/device confirmation.' };
  }

  return { allowed: false, decision: 'BLOCKED', reason: 'Unknown permission level.' };
}

module.exports = { evaluatePermission };
