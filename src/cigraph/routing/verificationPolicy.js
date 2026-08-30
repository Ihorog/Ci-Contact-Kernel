'use strict';

const { DATA_ROLES } = require('../storage/dataRoles');

function dedupe(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function resolveRequiredVerifiers(ownershipResult = {}, dataRole, sensitivityClass) {
  const verifiers = dedupe(ownershipResult.required_verifiers || []);

  if (dataRole === DATA_ROLES.EXECUTION_CONTROL) verifiers.push('executor_ready');
  if (dataRole === DATA_ROLES.PREDICTED_STATE) verifiers.push('model_risk_review');
  if (sensitivityClass === 'HIGH' || sensitivityClass === 'CRITICAL') verifiers.push('human_review');
  if (ownershipResult.canonical_owner_domain === 'PAYMENTS') verifiers.push('ledger_reconciliation');

  return dedupe(verifiers);
}

module.exports = { resolveRequiredVerifiers };
