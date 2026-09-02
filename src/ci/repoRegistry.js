'use strict';

/**
 * Repository Registry for Ci Code Control Plane
 * Provides machine-readable repository inventory for all Ihorog repositories.
 */

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.resolve(__dirname, '../../docs/ci/CI_REPO_REGISTRY.json');

class RepoRegistry {
  constructor(customPath) {
    this.filePath = customPath || REGISTRY_PATH;
    this.repositories = new Map();
    this.load();
  }

  load() {
    this.repositories.clear();
    if (fs.existsSync(this.filePath)) {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(data.repositories)) {
        for (const repo of data.repositories) {
          this.repositories.set(repo.repository_id, repo);
        }
      }
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
    if (!repo) return null;
    repo.last_verified_sha = sha;
    repo.last_verified_at = timestamp;
    return repo;
  }
}

module.exports = { RepoRegistry, REGISTRY_PATH };
