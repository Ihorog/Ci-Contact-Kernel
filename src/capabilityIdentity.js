'use strict';

const crypto = require('crypto');

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashManifest(manifest) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sortValue(manifest || {})))
    .digest('hex');
}

function bindApprovalToCapability(approval, capability) {
  return {
    ...(approval || {}),
    capabilityId: capability ? capability.capabilityId : null,
    manifestHash: capability ? capability.manifestHash : null,
    adapterHash: capability ? capability.adapterHash : null,
    policyVersion: capability ? capability.policyVersion : null
  };
}

function validateApprovalCapability(approval, currentCapability) {
  if (!currentCapability) return { valid: false, reason: 'CAPABILITY_UNREGISTERED' };
  if (
    !approval
    || approval.capabilityId !== currentCapability.capabilityId
    || approval.manifestHash !== currentCapability.manifestHash
    || approval.adapterHash !== currentCapability.adapterHash
  ) {
    return { valid: false, reason: 'CAPABILITY_CHANGED' };
  }
  if (approval.policyVersion !== currentCapability.policyVersion) {
    return { valid: false, reason: 'POLICY_CHANGED' };
  }
  return { valid: true, reason: 'valid' };
}

function buildLedgerEntry(capabilityId, approvalId, inputHash, resultHash, prevHash) {
  const base = {
    entryId: crypto.randomUUID(),
    capabilityId,
    approvalId,
    inputHash,
    resultHash,
    prevHash: prevHash || null,
    timestamp: new Date().toISOString()
  };
  const recordHash = hashManifest(base);
  return { ...base, recordHash };
}

function validateLedgerChain(entries) {
  for (let index = 0; index < (entries || []).length; index += 1) {
    const entry = entries[index];
    const expectedHash = hashManifest({
      entryId: entry.entryId,
      capabilityId: entry.capabilityId,
      approvalId: entry.approvalId,
      inputHash: entry.inputHash,
      resultHash: entry.resultHash,
      prevHash: entry.prevHash || null,
      timestamp: entry.timestamp
    });
    if (entry.recordHash !== expectedHash) {
      return { valid: false, reason: 'BROKEN_RECORD_HASH', invalidIndex: index };
    }
    if (index === 0) {
      if (entry.prevHash != null) return { valid: false, reason: 'BROKEN_PREV_LINK', invalidIndex: index };
      continue;
    }
    if (entry.prevHash !== entries[index - 1].recordHash) {
      return { valid: false, reason: 'BROKEN_PREV_LINK', invalidIndex: index };
    }
  }
  return { valid: true, reason: 'valid' };
}

module.exports = {
  bindApprovalToCapability,
  validateApprovalCapability,
  hashManifest,
  buildLedgerEntry,
  validateLedgerChain
};
