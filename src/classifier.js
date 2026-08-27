const { CLASSIFICATIONS } = require('./constants');

function textFromSignal(signal) {
  if (typeof signal === 'string') return signal.toLowerCase();
  return JSON.stringify(signal || {}).toLowerCase();
}

function classifySignal(signal = {}) {
  const direct = (signal.classification || signal.type || '').toLowerCase();
  const valid = Object.values(CLASSIFICATIONS);
  if (valid.includes(direct)) return direct;

  const text = textFromSignal(signal);
  if (text.includes('memory') || text.includes('remember')) return CLASSIFICATIONS.MEMORY;
  if (text.includes('deploy') || text.includes('release')) return CLASSIFICATIONS.DEPLOY_ACTION;
  if (text.includes('device') || text.includes('hardware')) return CLASSIFICATIONS.DEVICE_ACTION;
  if (text.includes('repo') || text.includes('commit') || text.includes('pull request')) return CLASSIFICATIONS.REPO_ACTION;
  if (text.includes('service') || text.includes('api')) return CLASSIFICATIONS.SERVICE_ACTION;
  if (text.includes('human') || text.includes('approve') || text.includes('review')) return CLASSIFICATIONS.HUMAN_ACTION;
  if (text.includes('task') || text.includes('run')) return CLASSIFICATIONS.TASK;
  if (text.includes('intent') || text.includes('want')) return CLASSIFICATIONS.INTENT;
  if (signal.fact === true || text.includes('fact:') || text.includes('\"fact\"')) return CLASSIFICATIONS.FACT;
  if (text.includes('event') || signal.event) return CLASSIFICATIONS.EVENT;

  return CLASSIFICATIONS.UNKNOWN;
}

module.exports = { classifySignal };
