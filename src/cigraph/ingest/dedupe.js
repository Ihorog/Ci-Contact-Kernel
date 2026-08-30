'use strict';

/**
 * dedupe — hash and source-identity deduplication for Cigrafin ingestion.
 *
 * Deduplication keys (all must match to consider an item "already seen"):
 *   source_repo + source_ref + path + blob_sha + content_hash
 *
 * When a blob_sha or content_hash changes, a new ingest record is created
 * for reclassification while preserving original ingest provenance.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Compute a SHA-256 hex digest of the given Buffer or string.
 * Returns null for null/undefined input.
 *
 * @param {Buffer|string|null} content
 * @returns {string|null}
 */
function computeContentHash(content) {
  if (content == null) return null;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Build a deterministic dedup key string from ingest identity fields.
 * The key is suitable for Map lookups / storage comparisons.
 *
 * @param {object} identity
 * @param {string} identity.source_repo
 * @param {string} identity.source_ref
 * @param {string} identity.path
 * @param {string|null} identity.blob_sha
 * @param {string|null} identity.content_hash
 * @returns {string}
 */
function buildDedupKey(identity) {
  const { source_repo, source_ref, path, blob_sha, content_hash } = identity;
  return [source_repo, source_ref, path, blob_sha ?? '', content_hash ?? ''].join('\0');
}

/**
 * In-memory dedup store.  Production usage should back this with a persistent
 * store (e.g. Supabase ci_graph_ingest table with a unique index on the key).
 *
 * The store maps dedup key → ingest_id of the first (canonical) ingest record.
 */
class DedupStore {
  constructor(options = {}) {
    /** @type {Map<string, string>} */
    this._seen = new Map();
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
      if (Array.isArray(parsed?.entries)) {
        this._seen = new Map(parsed.entries.filter((e) => Array.isArray(e) && e.length === 2));
      }
    } catch {
      // Ignore load errors and keep empty store.
    }
  }

  _persist() {
    if (!this._filePath) return;
    const dir = path.dirname(this._filePath);
    fs.mkdirSync(dir, { recursive: true });
    const snapshot = JSON.stringify({ entries: Array.from(this._seen.entries()) });
    const tempPath = `${this._filePath}.tmp`;
    this._writeChain = this._writeChain
      .then(() => fs.promises.writeFile(tempPath, snapshot, 'utf8'))
      .then(() => fs.promises.rename(tempPath, this._filePath))
      .catch(() => {});
  }

  /**
   * Check whether an identity has been seen.
   *
   * @param {object} identity
   * @returns {{ duplicate: boolean, existingIngestId: string|null }}
   */
  check(identity) {
    const key = buildDedupKey(identity);
    const existing = this._seen.get(key) ?? null;
    return { duplicate: existing !== null, existingIngestId: existing };
  }

  /**
   * Record that an identity has been processed.
   *
   * @param {object} identity
   * @param {string} ingest_id
   */
  record(identity, ingest_id) {
    const key = buildDedupKey(identity);
    this._seen.set(key, ingest_id);
    this._persist();
  }

  /**
   * Remove a dedup entry (e.g. after quarantine eviction or forced reprocess).
   *
   * @param {object} identity
   */
  forget(identity) {
    this._seen.delete(buildDedupKey(identity));
    this._persist();
  }

  /** @returns {number} */
  get size() {
    return this._seen.size;
  }
}

module.exports = { computeContentHash, buildDedupKey, DedupStore };
