'use strict';

class ResourceLock {
  constructor() {
    this.locks = new Map();
  }

  acquire(resourceId, stepId) {
    const holder = this.locks.get(resourceId) || null;
    if (holder && holder !== stepId) return { acquired: false, holder };
    this.locks.set(resourceId, stepId);
    return { acquired: true, holder: stepId };
  }

  release(resourceId, stepId) {
    if (this.locks.get(resourceId) !== stepId) return { released: false };
    this.locks.delete(resourceId);
    return { released: true };
  }

  isLocked(resourceId) {
    return this.locks.has(resourceId);
  }

  getLocks() {
    return Array.from(this.locks.entries()).map(([resourceId, holder]) => ({ resourceId, holder }));
  }

  releaseAll(stepId) {
    for (const [resourceId, holder] of this.locks.entries()) {
      if (holder === stepId) this.locks.delete(resourceId);
    }
  }
}

module.exports = { ResourceLock };
