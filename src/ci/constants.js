const CLASSIFICATIONS = [
  'fact',
  'intent',
  'task',
  'event',
  'memory',
  'service_action',
  'device_action',
  'repo_action',
  'unknown'
];

const NODES = [
  'current_fact',
  'intent',
  'memory',
  'action',
  'event',
  'project',
  'service',
  'device',
  'repo',
  'unknown'
];

const PERMISSION_STATES = ['BLOCKED', 'READY', 'UNKNOWN', 'EXECUTABLE'];
const VERIFICATION_STATES = ['verified', 'failed', 'unknown', 'blocked'];
const EXECUTION_CENTERS = ['local', 'ai', 'memory', 'service', 'repo', 'device', 'human'];

module.exports = {
  CLASSIFICATIONS,
  NODES,
  PERMISSION_STATES,
  VERIFICATION_STATES,
  EXECUTION_CENTERS
};
