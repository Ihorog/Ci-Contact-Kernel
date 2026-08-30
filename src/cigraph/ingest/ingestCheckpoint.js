'use strict';

/**
 * ingestCheckpoint — persists the last successfully processed source revision.
 *
 * The checkpoint is written ONLY after durable processing state has been
 * recorded for an item.  This guarantees that a restart after failure will
 * re-process unfinished items rather than silently skipping them.
 *
 * Keys:
 *   source_repo + source_ref  → { commit_sha, processed_at, items_seen }
 */

const fs = require('fs');
const path = require('path');

class IngestCheckpointStore {
  constructor(options = {}) {
    /** @type {Map<string, object>} */
    this._checkpoints = new Map();
    this._filePath = options.filePath || null;
    this._writeChain = Promise.resolve();
    this._load();
  }

  _load() {
    if (!this._filePath) return;
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.checkpoints)) {
        this._checkpoints = new Map(parsed.checkpoints
          .filter((cp) => cp && cp.source_repo && cp.source_ref)
          .map((cp) => [this._key(cp.source_repo, cp.source_ref), cp]));
      }
    } catch {
      // Ignore load failures and keep empty store.
    }
  }

  _persist() {
    if (!this._filePath) return;
    const dir = path.dirname(this._filePath);
    fs.mkdirSync(dir, { recursive: true });
    const snapshot = JSON.stringify({ checkpoints: Array.from(this._checkpoints.values()) });
    const tempPath = `${this._filePath}.tmp`;
    this._writeChain = this._writeChain
      .then(() => fs.promises.writeFile(tempPath, snapshot, 'utf8'))
      .then(() => fs.promises.rename(tempPath, this._filePath))
      .catch(() => {});
  }

  _key(source_repo, source_ref) {
    return `${source_repo}\0${source_ref}`;
  }

  /**
   * Persist (or update) a checkpoint for a source ref.
   *
   * @param {string} source_repo
   * @param {string} source_ref
   * @param {string} commit_sha     latest commit SHA that was fully processed
   * @param {number} items_seen     total blobs observed in this scan
   * @returns {object}
   */
  save(source_repo, source_ref, commit_sha, items_seen = 0, inventory = {}) {
    const key = this._key(source_repo, source_ref);
    const checkpoint = {
      source_repo,
      source_ref,
      commit_sha,
      items_seen,
      inventory,
      processed_at: new Date().toISOString(),
    };
    this._checkpoints.set(key, checkpoint);
    this._persist();
    return checkpoint;
  }

  /**
   * Retrieve the latest checkpoint for a source ref.
   *
   * @param {string} source_repo
   * @param {string} source_ref
   * @returns {object|null}
   */
  get(source_repo, source_ref) {
    return this._checkpoints.get(this._key(source_repo, source_ref)) ?? null;
  }

  /**
   * Check whether a given commit_sha has already been fully processed.
   *
   * @param {string} source_repo
   * @param {string} source_ref
   * @param {string} commit_sha
   * @returns {boolean}
   */
  isSeen(source_repo, source_ref, commit_sha) {
    const cp = this.get(source_repo, source_ref);
    return cp !== null && cp.commit_sha === commit_sha;
  }

  all() {
    return Array.from(this._checkpoints.values());
  }
}

module.exports = { IngestCheckpointStore };
