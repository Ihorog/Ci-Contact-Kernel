'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contract = require('../src/ciUnifiedStructureContract');

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../config/ci-gpts-app.contract.json'), 'utf8'),
);

test('Ci unified structure exposes only canonical neutral functional nodes', () => {
  assert.deepEqual(
    contract.CANONICAL_COMPONENTS.map((item) => item.key),
    ['activity', 'context', 'care', 'calendar', 'gallery', 'narrative'],
  );
  for (const component of contract.CANONICAL_COMPONENTS) {
    assert.equal(contract.isCiId(component.id), true, component.id);
  }
});

test('GPTs Ci manifest matches the source contract', () => {
  assert.equal(manifest.name, 'Ci');
  assert.equal(manifest.structure_schema_version, contract.SCHEMA_VERSION);
  assert.deepEqual(manifest.canonical_components, contract.CANONICAL_COMPONENTS.map((item) => item.key));
  assert.deepEqual(manifest.read_tools, [...contract.CORE_READ_TOOLS]);
  assert.deepEqual(manifest.write_tools, [...contract.CORE_WRITE_TOOLS]);
});

test('raw executor primitives are forbidden from the public Ci tool surface', () => {
  const publicTools = new Set([...manifest.read_tools, ...manifest.write_tools]);
  for (const tool of contract.FORBIDDEN_PUBLIC_EXECUTOR_TOOLS) {
    assert.equal(publicTools.has(tool), false, `${tool} must stay behind the policy/executor boundary`);
  }
});

test('ACTUAL is the highest-precedence state and completion requires verification', () => {
  assert.deepEqual(contract.STATE_PRECEDENCE, ['ACTUAL', 'PREDICTED', 'TARGET']);
  assert.match(manifest.completion_rule, /verification/i);
  assert.deepEqual(contract.POLICY_DECISIONS, ['ALLOW', 'CONFIRM', 'DENY', 'DEFER']);
  assert.deepEqual(contract.VERIFICATION_OUTCOMES, ['SUCCESS', 'DEVIATION', 'UNCERTAIN', 'NOT_EXECUTED']);
});

test('structure envelope has a single versioned logical projection', () => {
  const envelope = contract.createStructureEnvelope({
    structureVersion: 'test-1',
    actualAt: '2026-09-05T00:00:00.000Z',
    components: contract.CANONICAL_COMPONENTS,
  });
  assert.equal(envelope.schema_version, contract.SCHEMA_VERSION);
  assert.equal(envelope.structure_version, 'test-1');
  assert.equal(envelope.components.length, 6);
  assert.ok(Array.isArray(envelope.relations));
  assert.ok(Array.isArray(envelope.bindings));
  assert.ok(Array.isArray(envelope.capabilities));
  assert.ok(Array.isArray(envelope.facts));
});
