'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CapabilityRegistry } = require('../src/capabilityRegistry');
const {
  bindApprovalToCapability,
  validateApprovalCapability,
  hashManifest,
  buildLedgerEntry,
  validateLedgerChain
} = require('../src/capabilityIdentity');

function makeManifest() {
  return {
    toolId: 'tool.alpha',
    adapterId: 'adapter.alpha',
    name: 'Alpha Tool',
    version: '1.0.0',
    schemaVersion: '1',
    adapterHash: 'adapter-hash-1',
    policyVersion: '2024-01',
    riskClass: 'MEDIUM',
    declaredSideEffects: ['writes-memory'],
    requiredPermissionLevel: 'L2_LOCAL_WRITE',
    inputsSchema: { type: 'object', properties: { value: { type: 'string' } } },
    outputsSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }
  };
}

test('Capability registration and hash computation', () => {
  const registry = new CapabilityRegistry();
  const manifest = makeManifest();
  const registration = registry.register(manifest);
  const capability = registry.lookup(registration.capabilityId);
  assert.equal(registration.manifestHash, hashManifest(manifest));
  assert.equal(capability.toolId, 'tool.alpha');
  assert.equal(registry.lookupByToolId('tool.alpha').capabilityId, capability.capabilityId);
  assert.equal(registry.list().length, 1);
});

test('Approval succeeds when capability hash is unchanged', () => {
  const registry = new CapabilityRegistry();
  const registration = registry.register(makeManifest());
  const capability = registry.lookup(registration.capabilityId);
  const approval = bindApprovalToCapability({ approvalId: 'ap-1' }, capability);
  assert.deepEqual(validateApprovalCapability(approval, capability), { valid: true, reason: 'valid' });
});

test('Approval invalidated when manifest hash changes', () => {
  const registry = new CapabilityRegistry();
  const registration = registry.register(makeManifest());
  const capability = registry.lookup(registration.capabilityId);
  const approval = bindApprovalToCapability({ approvalId: 'ap-1' }, capability);
  capability.manifestHash = 'changed';
  assert.equal(validateApprovalCapability(approval, capability).reason, 'CAPABILITY_CHANGED');
});

test('Approval invalidated when adapter hash changes', () => {
  const registry = new CapabilityRegistry();
  const registration = registry.register(makeManifest());
  const capability = registry.lookup(registration.capabilityId);
  const approval = bindApprovalToCapability({ approvalId: 'ap-1' }, capability);
  capability.adapterHash = 'changed-adapter';
  assert.equal(validateApprovalCapability(approval, capability).reason, 'CAPABILITY_CHANGED');
});

test('Approval invalidated when policy version changes', () => {
  const registry = new CapabilityRegistry();
  const registration = registry.register(makeManifest());
  const capability = registry.lookup(registration.capabilityId);
  const approval = bindApprovalToCapability({ approvalId: 'ap-1' }, capability);
  capability.policyVersion = '2025-01';
  assert.equal(validateApprovalCapability(approval, capability).reason, 'POLICY_CHANGED');
});

test('Unregistered capability is blocked', () => {
  const registry = new CapabilityRegistry();
  assert.equal(registry.validateIdentity('missing', 'm', 'a', 'p').reason, 'CAPABILITY_UNREGISTERED');
  assert.equal(validateApprovalCapability({ approvalId: 'ap-1' }, null).reason, 'CAPABILITY_UNREGISTERED');
});

test('Ledger: valid chain validates correctly', () => {
  const first = buildLedgerEntry('cap-1', 'ap-1', 'in-1', 'out-1', null);
  const second = buildLedgerEntry('cap-1', 'ap-2', 'in-2', 'out-2', first.recordHash);
  assert.equal(validateLedgerChain([first, second]).valid, true);
});

test('Ledger: broken link detected', () => {
  const first = buildLedgerEntry('cap-1', 'ap-1', 'in-1', 'out-1', null);
  const second = buildLedgerEntry('cap-1', 'ap-2', 'in-2', 'out-2', 'wrong-link');
  assert.equal(validateLedgerChain([first, second]).reason, 'BROKEN_PREV_LINK');
});
