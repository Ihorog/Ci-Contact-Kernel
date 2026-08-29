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

class IngestCheckpointStore {
  constructor() {
    /** @type {Map<string, object>} */
    this._checkpoints = new Map();
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
  save(source_repo, source_ref, commit_sha, items_seen = 0) {
    const key = this._key(source_repo, source_ref);
    const checkpoint = {
      source_repo,
      source_ref,
      commit_sha,
      items_seen,
      processed_at: new Date().toISOString(),
    };
    this._checkpoints.set(key, checkpoint);
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
