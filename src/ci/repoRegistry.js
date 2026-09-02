'use strict';

/**
 * Repository Registry for Ci Code Control Plane
 * Provides machine-readable repository inventory for all Ihorog repositories.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REGISTRY_PATH = path.resolve(__dirname, '../../docs/ci/CI_REPO_REGISTRY.json');

class RepoRegistry {
  constructor(customPath) {
    this.filePath = customPath || REGISTRY_PATH;
    this.repositories = new Map();
    this.status = 'HEALTHY';
    this.diagnostic = null;
    this.load();
  }

  load() {
    this.repositories.clear();
    try {
      if (!fs.existsSync(this.filePath)) throw new Error('Registry file is missing.');
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(data.repositories)) throw new Error('Registry repositories must be an array.');
      for (const repo of data.repositories) {
        if (!repo || typeof repo.repository_id !== 'string') {
          throw new Error('Registry contains an invalid repository entry.');
        }
        this.repositories.set(repo.repository_id, repo);
      }
      this.status = 'HEALTHY';
      this.diagnostic = null;
    } catch (err) {
      this.status = 'DEGRADED';
      this.diagnostic = `Registry unavailable: ${err.message}`;
    }
  }

  get(repoId) {
    return this.repositories.get(repoId) || null;
  }

  list() {
    return Array.from(this.repositories.values());
  }

  findByRole(role) {
    return this.list().filter((r) => r.role === role);
  }

  findByRiskClass(riskClass) {
    return this.list().filter((r) => r.risk_class === riskClass);
  }

  updateVerification(repoId, sha, timestamp = new Date().toISOString()) {
    const repo = this.repositories.get(repoId);
    if (!repo || this.status !== 'HEALTHY' || !/^[0-9a-f]{7,64}$/i.test(String(sha || ''))) return null;
    repo.last_verified_sha = sha;
    repo.last_verified_at = timestamp;
    this.persist();
    return repo;
  }

  persist() {
    const dir = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const repositories = this.list();
    const provenance = {
      algorithm: 'sha256',
      hash: crypto.createHash('sha256').update(JSON.stringify(repositories)).digest('hex'),
      source: 'RepoRegistry.updateVerification',
      updated_at: new Date().toISOString()
    };
    const body = JSON.stringify({ _schema: 'ci-repo-registry-v1', _integrity: provenance, repositories }, null, 2) + '\n';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, body, { flag: 'wx', mode: 0o600 });
    try {
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }
}

module.exports = { RepoRegistry, REGISTRY_PATH };
