/**
 * CloudflareKvStore — persists Ci memory records to a Cloudflare KV namespace.
 *
 * Implements the same interface as MemoryStore so it can be used as a
 * drop-in replacement in CiOrchestrator when a Cloudflare KV binding is
 * available (e.g. inside a Workers or Pages Function handler).
 *
 * Storage layout:
 *   Key   : "ci_memory:<timestamp_ms>:<random_suffix>"
 *   Value : JSON string of the record
 *   Metadata: { recordedAt: ISO string }
 *
 * A separate index key "ci_memory:__index" holds the ordered list of all
 * record keys (newest-first, capped to bufferLimit).
 *
 * Usage (inside a Worker handler):
 *   import { CloudflareKvStore } from './adapters/cloudflareKvStore.js';
 *   const store = new CloudflareKvStore(env.CI_MEMORY_KV, { bufferLimit: 2000 });
 */

const INDEX_KEY = 'ci_memory:__index';

class CloudflareKvStore {
  /**
   * @param {object} kvNamespace   - Cloudflare KV binding (Workers KV Namespace).
   * @param {object} [options]
   * @param {number} [options.bufferLimit=2000]   - Maximum records retained in KV and buffer.
   */
  constructor(kvNamespace, options = {}) {
    if (
      !kvNamespace ||
      typeof kvNamespace.get !== 'function' ||
      typeof kvNamespace.put !== 'function'
    ) {
      throw new TypeError(
        'CloudflareKvStore requires a Cloudflare KV namespace binding with .get() and .put() methods.'
      );
    }
    this.kv = kvNamespace;
    this.bufferLimit = Math.max(1, Number(options.bufferLimit) || 2000);
    this.buffer = [];
    this._writeChain = Promise.resolve();
  }

  /**
   * Append a record to the in-process buffer and persist it to KV.
   * Index updates are serialised through _writeChain to avoid races.
   *
   * @param {object} record
   */
  append(record) {
    this.buffer.push(record);
    if (this.buffer.length > this.bufferLimit) {
      this.buffer = this.buffer.slice(-this.bufferLimit);
    }

    this._writeChain = this._writeChain
      .then(() => {
        const key = `ci_memory:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        const value = JSON.stringify(record);
        const recordedAt = new Date().toISOString();
        return this.kv
          .put(key, value, { metadata: { recordedAt } })
          .then(() => this._updateIndex(key));
      })
      .catch((err) => {
        const idx = this.buffer.lastIndexOf(record);
        if (idx >= 0) this.buffer.splice(idx, 1);
        console.error('CloudflareKvStore: write failed:', err.message);
      });
  }

  /**
   * Return the most recent records from the in-process buffer (fastest path).
   *
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  recent(limit = 50) {
    const n = Math.max(1, Number(limit) || 50);
    return this.buffer.slice(-n).reverse();
  }

  /**
   * Fetch recent records directly from KV (cross-instance or cold-start path).
   *
   * @param {number} [limit=50]
   * @returns {Promise<object[]>}
   */
  async fetchRemote(limit = 50) {
    const n = Math.max(1, Number(limit) || 50);
    let index = [];
    try {
      const raw = await this.kv.get(INDEX_KEY, { type: 'json' });
      index = Array.isArray(raw) ? raw : [];
    } catch (err) {
      console.error('CloudflareKvStore: index read failed:', err.message);
      return [];
    }

    const keys = index.slice(0, n);
    const records = await Promise.all(
      keys.map(async (k) => {
        try {
          const raw = await this.kv.get(k, { type: 'json' });
          return raw;
        } catch {
          return null;
        }
      })
    );
    return records.filter(Boolean);
  }

  async _updateIndex(newKey) {
    let index = [];
    try {
      const raw = await this.kv.get(INDEX_KEY, { type: 'json' });
      index = Array.isArray(raw) ? raw : [];
    } catch {
      index = [];
    }
    index.unshift(newKey);
    if (index.length > this.bufferLimit) index = index.slice(0, this.bufferLimit);
    await this.kv.put(INDEX_KEY, JSON.stringify(index));
  }
}

module.exports = { CloudflareKvStore };
