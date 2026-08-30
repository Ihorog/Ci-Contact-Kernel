'use strict';

const fs = require('fs');
const { applyConflictPolicy } = require('./memoryPolicy');

class MemoryNavigator {
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
  }

  _readRecords() {
    if (!this.memoryStore) return [];
    if (typeof this.memoryStore.readAll === 'function') return this.memoryStore.readAll();
    if (Array.isArray(this.memoryStore.buffer)) return this.memoryStore.buffer.slice();
    if (typeof this.memoryStore.recent === 'function') return this.memoryStore.recent(2000).slice().reverse();
    if (this.memoryStore.filePath && fs.existsSync(this.memoryStore.filePath)) {
      const raw = fs.readFileSync(this.memoryStore.filePath, 'utf8').trim();
      if (!raw) return [];
      return raw.split('\n').filter(Boolean).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    }
    return [];
  }

  findByCiId(ciId) {
    return this._readRecords().filter((record) => record && record.ci_id === ciId);
  }

  traverseRelations(ciId, relationType, maxDepth = 2) {
    const records = this._readRecords();
    const visited = new Set([ciId]);
    const output = [];
    let frontier = [ciId];

    for (let depth = 0; depth < maxDepth; depth += 1) {
      const nextFrontier = [];
      for (const current of frontier) {
        for (const record of records) {
          if (!record) continue;

          if (Array.isArray(record.relations) && record.ci_id === current) {
            for (const relation of record.relations) {
              if (relationType && relation.type !== relationType) continue;
              const target = relation.to_ci_id || relation.target_ci_id || relation.object_ci_id;
              if (!target || visited.has(target)) continue;
              visited.add(target);
              nextFrontier.push(target);
              output.push({ ...record, traversed_relation: relation });
            }
          }

          const directMatch = (record.from_ci_id === current || record.subject_ci_id === current || record.ci_id === current)
            && (!relationType || record.relation_type === relationType || record.type === relationType);
          if (!directMatch) continue;
          const target = record.to_ci_id || record.object_ci_id || record.target_ci_id;
          if (!target || visited.has(target)) continue;
          visited.add(target);
          nextFrontier.push(target);
          output.push(record);
        }
      }
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return output;
  }

  findByTemporalWindow(from, to, temporalLayer) {
    const fromTs = from ? new Date(from).getTime() : Number.NEGATIVE_INFINITY;
    const toTs = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
    return this._readRecords().filter((record) => {
      if (!record) return false;
      if (temporalLayer && record.temporal_layer !== temporalLayer) return false;
      const stamp = record.observed_at || record.recorded_at || record.occurred_at || record.valid_from;
      if (!stamp) return false;
      const ts = new Date(stamp).getTime();
      return ts >= fromTs && ts <= toTs;
    });
  }

  findByTruthStatus(truthStatus) {
    return this._readRecords().filter((record) => record && record.truth_status === truthStatus);
  }

  findByScope(scope, domain) {
    return this._readRecords().filter((record) => {
      if (!record) return false;
      const scopes = Array.isArray(record.scope) ? record.scope : [record.scope].filter(Boolean);
      const domains = Array.isArray(record.domain) ? record.domain : [record.domain].filter(Boolean);
      if (scope && !scopes.includes(scope)) return false;
      if (domain && !domains.includes(domain)) return false;
      return true;
    });
  }

  getConflicts(ciId) {
    const related = this._readRecords().filter((record) => {
      if (!record) return false;
      return record.ci_id === ciId || record.subject_ci_id === ciId || record.from_ci_id === ciId;
    });
    return applyConflictPolicy(related).conflicts;
  }

  shouldTriggerTraversal(context = {}) {
    if (context.unresolvedEntity) return { trigger: true, reason: 'unresolvedEntity' };
    if (context.conflictingClaim) return { trigger: true, reason: 'conflictingClaim' };
    if (context.needsHistoricalEvidence) return { trigger: true, reason: 'needsHistoricalEvidence' };
    if (context.retryFromCheckpoint) return { trigger: true, reason: 'retryFromCheckpoint' };
    return { trigger: false, reason: 'no-explicit-trigger' };
  }
}

module.exports = { MemoryNavigator };
