'use strict';

const crypto = require('crypto');
const { hashManifest } = require('./capabilityIdentity');

class CapabilityRegistry {
  constructor() {
    this.byId = new Map();
    this.byToolId = new Map();
  }

  register(manifest) {
    const canonicalManifest = { ...(manifest || {}) };
    const capabilityId = canonicalManifest.capabilityId || crypto.randomUUID();
    const manifestHash = hashManifest(canonicalManifest);
    const capability = {
      capabilityId,
      toolId: canonicalManifest.toolId || null,
      adapterId: canonicalManifest.adapterId || null,
      name: canonicalManifest.name || 'unnamed-capability',
      version: canonicalManifest.version || '0.0.0',
      schemaVersion: canonicalManifest.schemaVersion || '1',
      manifestHash,
      adapterHash: canonicalManifest.adapterHash || hashManifest({ adapterId: canonicalManifest.adapterId || null }),
      policyVersion: canonicalManifest.policyVersion || '1',
      riskClass: canonicalManifest.riskClass || 'LOW',
      declaredSideEffects: Array.isArray(canonicalManifest.declaredSideEffects) ? canonicalManifest.declaredSideEffects.slice() : [],
      requiredPermissionLevel: canonicalManifest.requiredPermissionLevel || 'L0_READ',
      inputsSchemaHash: canonicalManifest.inputsSchemaHash || hashManifest(canonicalManifest.inputsSchema || {}),
      outputsSchemaHash: canonicalManifest.outputsSchemaHash || hashManifest(canonicalManifest.outputsSchema || {}),
      registeredAt: canonicalManifest.registeredAt || new Date().toISOString(),
      manifest: canonicalManifest,
      execute: canonicalManifest.execute,
      verify: canonicalManifest.verify
    };

    this.byId.set(capabilityId, capability);
    if (capability.toolId) this.byToolId.set(capability.toolId, capability);
    return { capabilityId, manifestHash };
  }

  lookup(capabilityId) {
    return this.byId.get(capabilityId) || null;
  }

  lookupByToolId(toolId) {
    return this.byToolId.get(toolId) || null;
  }

  validateIdentity(capabilityId, manifestHash, adapterHash, policyVersion) {
    const capability = this.lookup(capabilityId);
    if (!capability) return { valid: false, reason: 'CAPABILITY_UNREGISTERED' };
    if (capability.manifestHash !== manifestHash || capability.adapterHash !== adapterHash) {
      return { valid: false, reason: 'CAPABILITY_CHANGED' };
    }
    if (capability.policyVersion !== policyVersion) {
      return { valid: false, reason: 'POLICY_CHANGED' };
    }
    return { valid: true, reason: 'valid' };
  }

  list() {
    return Array.from(this.byId.values());
  }
}

module.exports = { CapabilityRegistry };
