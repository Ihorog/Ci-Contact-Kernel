'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyCiGraph } = require('../src/cigraph/classify');
const { routeRecord } = require('../src/cigraph/routing/route');
const { DATA_ROLES } = require('../src/cigraph/storage/dataRoles');
const { SCOPE, DOMAIN, CLASS, TRUTH_STATUS, TEMPORAL_LAYER } = require('../src/cigraph/registry');

function classify(input) {
  return classifyCiGraph(input).canonicalRecord;
}

test('GitHub file describing electrical breaker routes to HOME/ENERGY with DATA and ACTION consumers', () => {
  const record = classify({
    text: 'GitHub markdown file describing the household electrical breaker panel.',
    scope: SCOPE.HOME,
    domain: DOMAIN.ENERGY,
    class: CLASS.DOCUMENT
  });
  const routed = routeRecord(record, DATA_ROLES.ASSERTION, { sourceName: 'github' });
  assert.equal(routed.canonical_owner_scope, SCOPE.HOME);
  assert.equal(routed.canonical_owner_domain, DOMAIN.ENERGY);
  assert.ok(routed.consumer_scopes.includes(SCOPE.DATA));
  assert.ok(routed.consumer_scopes.includes(SCOPE.ACTION));
});

test('Repository source code routes to WORK/SOURCE_CONTROL', () => {
  const record = classify({
    text: 'git repository branch commit source code',
    scope: SCOPE.WORK,
    domain: DOMAIN.SOURCE_CONTROL,
    class: CLASS.REPOSITORY
  });
  const routed = routeRecord(record, DATA_ROLES.SEMANTIC_MASTER, { sourceName: 'github' });
  assert.equal(routed.canonical_owner_scope, SCOPE.WORK);
  assert.equal(routed.canonical_owner_domain, DOMAIN.SOURCE_CONTROL);
});

test('PayPal payment event routes to FIN/PAYMENTS and feeds ACTION consumers', () => {
  const record = classify({
    text: 'PayPal payment event for subscription renewal',
    scope: SCOPE.FIN,
    domain: DOMAIN.PAYMENTS,
    class: CLASS.EVENT
  });
  const routed = routeRecord(record, DATA_ROLES.RESULT_RECORD, { sourceName: 'analytics' });
  assert.equal(routed.canonical_owner_scope, SCOPE.FIN);
  assert.equal(routed.canonical_owner_domain, DOMAIN.PAYMENTS);
  assert.ok(routed.consumer_scopes.includes(SCOPE.ACTION));
});

test('Supabase row about a home device routes to HOME/ASSET_REGISTRY', () => {
  const record = classify({
    text: 'supabase row for home device serial and room assignment',
    scope: SCOPE.HOME,
    domain: DOMAIN.ASSET_REGISTRY,
    class: CLASS.DEVICE
  });
  const routed = routeRecord(record, DATA_ROLES.IDENTITY_MASTER, { sourceName: 'supabase' });
  assert.equal(routed.canonical_owner_scope, SCOPE.HOME);
  assert.equal(routed.canonical_owner_domain, DOMAIN.ASSET_REGISTRY);
});

test('Cloudflare tunnel endpoint routes to network/operations ownership rule', () => {
  const record = classify({
    text: 'cloudflare tunnel endpoint for home lab ingress',
    scope: SCOPE.HOME,
    domain: DOMAIN.NETWORK_COMPUTE,
    class: CLASS.SERVICE
  });
  const routed = routeRecord(record, DATA_ROLES.CURRENT_STATE, { sourceName: 'cloudflare' });
  assert.ok([DOMAIN.NETWORK_COMPUTE, DOMAIN.OPERATIONS].includes(routed.canonical_owner_domain));
});

test('AI-extracted relation is treated as CANDIDATE, not VERIFIED', () => {
  const record = classify({
    text: 'derived relation between breaker and panel',
    scope: SCOPE.DATA,
    domain: DOMAIN.KNOWLEDGE,
    class: CLASS.CLAIM,
    truth_status: TRUTH_STATUS.VERIFIED
  });
  const routed = routeRecord(record, DATA_ROLES.RELATION_MASTER, { sourceName: 'openai' });
  assert.equal(routed.resolved_truth_status, TRUTH_STATUS.CANDIDATE);
});

test('Analytics risk score becomes PREDICTED_STATE', () => {
  const record = classify({
    text: 'analytics risk score for service health',
    scope: SCOPE.CORE,
    domain: DOMAIN.VERIFICATION,
    class: CLASS.METRIC,
    temporal_layer: TEMPORAL_LAYER.PREDICTED
  });
  const routed = routeRecord(record, DATA_ROLES.CURRENT_STATE, { sourceName: 'analytics' });
  assert.equal(routed.effective_data_role, DATA_ROLES.PREDICTED_STATE);
});

test('Physical device command with no executor is blocked', () => {
  const record = classify({
    text: 'run device command on breaker actuator',
    scope: SCOPE.ACTION,
    domain: DOMAIN.TASKS,
    class: CLASS.ACTION,
    execution_class: 'COMMAND'
  });
  const routed = routeRecord(record, DATA_ROLES.EXECUTION_CONTROL, { sourceName: 'local_node' });
  assert.equal(routed.blocked, true);
  assert.equal(routed.execution_centers.length, 0);
});

test('Ambiguous ownership record is quarantined', () => {
  const routed = routeRecord({
    scope: [SCOPE.HOME, SCOPE.WORK],
    domain: [DOMAIN.NETWORK_COMPUTE, DOMAIN.OPERATIONS],
    class: CLASS.SERVICE
  }, DATA_ROLES.CURRENT_STATE, { sourceName: 'cloudflare' });
  assert.equal(routed.ambiguous, true);
  assert.equal(routed.needs_quarantine, true);
});

test('routing_reasons is always non-empty', () => {
  const record = classify({ text: 'identity access policy', scope: SCOPE.CORE, domain: DOMAIN.IDENTITY_ACCESS, class: CLASS.POLICY });
  const routed = routeRecord(record, DATA_ROLES.SEMANTIC_MASTER, { sourceName: 'supabase' });
  assert.ok(Array.isArray(routed.routing_reasons));
  assert.ok(routed.routing_reasons.length > 0);
});
