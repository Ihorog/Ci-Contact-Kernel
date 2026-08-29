/**
 * SupabaseStore — persists Ci memory records to a Supabase table.
 *
 * Implements the same interface as MemoryStore so it can be used as a
 * drop-in replacement in CiOrchestrator when a Supabase client is available.
 *
 * Expected table schema (SQL):
 *   CREATE TABLE ci_memory (
 *     id          BIGSERIAL PRIMARY KEY,
 *     payload     JSONB NOT NULL,
 *     recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *
 * Usage:
 *   const { createClient } = require('@supabase/supabase-js');
 *   const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
 *   const store  = new SupabaseStore(client, { table: 'ci_memory', bufferLimit: 2000 });
 */

class SupabaseStore {
  /**
   * @param {object} client      - Supabase JS client instance.
   * @param {object} [options]
   * @param {string} [options.table='ci_memory']   - Target table name.
   * @param {number} [options.bufferLimit=2000]    - In-process LRU cap.
   */
  constructor(client, options = {}) {
    if (!client || typeof client.from !== 'function') {
      throw new TypeError('SupabaseStore requires a valid Supabase client with a .from() method.');
    }
    this.client = client;
    this.table = options.table || 'ci_memory';
    const rawLimit = options.bufferLimit != null ? Number(options.bufferLimit) : 2000;
    this.bufferLimit = Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 2000);
    this.buffer = [];
    this._appendChain = Promise.resolve();
  }

  /**
   * Append a record to both the in-process buffer and the Supabase table.
   * Errors are logged and the write is removed from the buffer on failure.
   *
   * @param {object} record
   */
  append(record) {
    this.buffer.push(record);
    if (this.buffer.length > this.bufferLimit) {
      this.buffer = this.buffer.slice(-this.bufferLimit);
    }

    this._appendChain = this._appendChain
      .then(() =>
        this.client
          .from(this.table)
          .insert({ payload: record, recorded_at: new Date().toISOString() })
      )
      .then(({ error }) => {
        if (error) {
          const idx = this.buffer.lastIndexOf(record);
          if (idx >= 0) this.buffer.splice(idx, 1);
          console.error('SupabaseStore: insert failed:', error.message);
        }
      })
      .catch((err) => {
        const idx = this.buffer.lastIndexOf(record);
        if (idx >= 0) this.buffer.splice(idx, 1);
        console.error('SupabaseStore: unexpected error:', err.message);
      });
  }

  /**
   * Return the most recent records from the in-process buffer.
   *
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  recent(limit = 50) {
    const n = Math.max(1, Number(limit) || 50);
    return this.buffer.slice(-n).reverse();
  }

  /**
   * Fetch recent records directly from Supabase (bypasses the in-process buffer).
   * Useful for cross-instance queries or when the process has just started.
   *
   * @param {number} [limit=50]
   * @returns {Promise<object[]>}
   */
  async fetchRemote(limit = 50) {
    const n = Math.max(1, Number(limit) || 50);
    const { data, error } = await this.client
      .from(this.table)
      .select('payload, recorded_at')
      .order('id', { ascending: false })
      .limit(n);

    if (error) {
      console.error('SupabaseStore: fetchRemote failed:', error.message);
      return [];
    }
    return (data || []).map((row) => row.payload);
  }
}

module.exports = { SupabaseStore };
