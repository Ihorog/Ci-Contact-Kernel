'use strict';

/**
 * Full test suite for CloudflareKvStore adapter.
 *
 * All KV operations are intercepted by an in-memory mock namespace so the
 * tests run without any real Cloudflare account or Wrangler process.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CloudflareKvStore } = require('../src/adapters/cloudflareKvStore');

// ── Mock Cloudflare KV Namespace factory ──────────────────────────────────────

function makeKv({ putError = null, getError = null } = {}) {
  const store = new Map();
  return {
    _store: store,
    async put(key, value) {
      if (putError) throw new Error(putError);
      store.set(key, value);
    },
    async get(key, opts = {}) {
      if (getError) throw new Error(getError);
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts && opts.type === 'json') {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    },
  };
}

// ── Construction ──────────────────────────────────────────────────────────────

test('CloudflareKvStore: constructor rejects missing namespace', () => {
  assert.throws(() => new CloudflareKvStore(null), TypeError);
  assert.throws(() => new CloudflareKvStore({}), TypeError);
  assert.throws(() => new CloudflareKvStore({ get: () => {} }), TypeError);
});

test('CloudflareKvStore: constructor accepts a valid KV binding', () => {
  assert.doesNotThrow(() => new CloudflareKvStore(makeKv()));
});

test('CloudflareKvStore: default bufferLimit is 2000', () => {
  const store = new CloudflareKvStore(makeKv());
  assert.equal(store.bufferLimit, 2000);
});

test('CloudflareKvStore: custom bufferLimit is respected', () => {
  const store = new CloudflareKvStore(makeKv(), { bufferLimit: 100 });
  assert.equal(store.bufferLimit, 100);
});

test('CloudflareKvStore: bufferLimit is clamped to minimum 1', () => {
  const store = new CloudflareKvStore(makeKv(), { bufferLimit: -5 });
  assert.equal(store.bufferLimit, 1);
});

// ── append + recent (buffer) ──────────────────────────────────────────────────

test('CloudflareKvStore: append adds records to the buffer', () => {
  const store = new CloudflareKvStore(makeKv());
  store.append({ event: 'a' });
  store.append({ event: 'b' });
  assert.equal(store.buffer.length, 2);
});

test('CloudflareKvStore: recent returns records newest-first', () => {
  const store = new CloudflareKvStore(makeKv());
  store.append({ event: 'first' });
  store.append({ event: 'second' });
  store.append({ event: 'third' });
  const result = store.recent(3);
  assert.equal(result[0].event, 'third');
  assert.equal(result[1].event, 'second');
  assert.equal(result[2].event, 'first');
});

test('CloudflareKvStore: recent limit is respected', () => {
  const store = new CloudflareKvStore(makeKv());
  for (let i = 0; i < 10; i++) store.append({ n: i });
  assert.equal(store.recent(4).length, 4);
});

test('CloudflareKvStore: recent never returns more than buffer size', () => {
  const store = new CloudflareKvStore(makeKv());
  for (let i = 0; i < 3; i++) store.append({ n: i });
  assert.equal(store.recent(100).length, 3);
});

test('CloudflareKvStore: buffer is capped to bufferLimit', () => {
  const store = new CloudflareKvStore(makeKv(), { bufferLimit: 3 });
  for (let i = 0; i < 8; i++) store.append({ n: i });
  assert.equal(store.buffer.length, 3);
  assert.equal(store.buffer[0].n, 5);
  assert.equal(store.buffer[2].n, 7);
});

// ── KV persistence ────────────────────────────────────────────────────────────

test('CloudflareKvStore: append writes record to KV', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv);
  store.append({ event: 'kv_write' });
  await store._writeChain;
  // At least one non-index key should hold the serialised record
  const keys = [...kv._store.keys()].filter((k) => k !== 'ci_memory:__index');
  assert.equal(keys.length, 1);
  const stored = JSON.parse(kv._store.get(keys[0]));
  assert.equal(stored.event, 'kv_write');
});

test('CloudflareKvStore: append updates the index in KV', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv);
  store.append({ event: 'idx' });
  await store._writeChain;
  const index = JSON.parse(kv._store.get('ci_memory:__index'));
  assert.ok(Array.isArray(index));
  assert.equal(index.length, 1);
});

test('CloudflareKvStore: index is prepended (newest key first)', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv);
  store.append({ n: 1 });
  await store._writeChain;
  store.append({ n: 2 });
  await store._writeChain;
  const index = JSON.parse(kv._store.get('ci_memory:__index'));
  // The second key should be first in the index
  const v0 = JSON.parse(kv._store.get(index[0]));
  assert.equal(v0.n, 2);
});

test('CloudflareKvStore: index is capped to bufferLimit', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv, { bufferLimit: 3 });
  for (let i = 0; i < 5; i++) {
    store.append({ n: i });
    await store._writeChain;
  }
  const index = JSON.parse(kv._store.get('ci_memory:__index'));
  assert.equal(index.length, 3);
});

// ── KV error handling ─────────────────────────────────────────────────────────

test('CloudflareKvStore: KV put error removes record from buffer', async () => {
  const kv = makeKv({ putError: 'KV unavailable' });
  const store = new CloudflareKvStore(kv);
  store.append({ event: 'fail' });
  assert.equal(store.buffer.length, 1);
  await store._writeChain;
  assert.equal(store.buffer.length, 0);
});

// ── fetchRemote ───────────────────────────────────────────────────────────────

test('CloudflareKvStore: fetchRemote returns stored records', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv);
  store.append({ event: 'remote_r1' });
  store.append({ event: 'remote_r2' });
  await store._writeChain;
  const result = await store.fetchRemote(10);
  assert.equal(result.length, 2);
  const events = result.map((r) => r.event);
  assert.ok(events.includes('remote_r1'));
  assert.ok(events.includes('remote_r2'));
});

test('CloudflareKvStore: fetchRemote limit caps results', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv);
  for (let i = 0; i < 5; i++) {
    store.append({ n: i });
    await store._writeChain;
  }
  const result = await store.fetchRemote(3);
  assert.equal(result.length, 3);
});

test('CloudflareKvStore: fetchRemote returns [] when index is absent', async () => {
  const kv = makeKv({ getError: 'not found' });
  const store = new CloudflareKvStore(kv);
  const result = await store.fetchRemote();
  assert.deepEqual(result, []);
});

test('CloudflareKvStore: fetchRemote default limit is 50', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv, { bufferLimit: 100 });
  for (let i = 0; i < 60; i++) {
    store.append({ n: i });
    await store._writeChain;
  }
  const result = await store.fetchRemote();
  assert.equal(result.length, 50);
});

// ── Interface parity with MemoryStore ─────────────────────────────────────────

test('CloudflareKvStore: exposes append() and recent() like MemoryStore', () => {
  const store = new CloudflareKvStore(makeKv());
  assert.equal(typeof store.append, 'function');
  assert.equal(typeof store.recent, 'function');
});

test('CloudflareKvStore: exposes fetchRemote() for cross-instance queries', () => {
  const store = new CloudflareKvStore(makeKv());
  assert.equal(typeof store.fetchRemote, 'function');
});

test('CloudflareKvStore: recent() with non-numeric limit falls back to 50', () => {
  const store = new CloudflareKvStore(makeKv());
  for (let i = 0; i < 60; i++) store.append({ n: i });
  assert.equal(store.recent('bad').length, 50);
});

// ── Concurrent appends ────────────────────────────────────────────────────────

test('CloudflareKvStore: multiple appends are serialised in _writeChain', async () => {
  const kv = makeKv();
  const store = new CloudflareKvStore(kv);
  store.append({ i: 0 });
  store.append({ i: 1 });
  store.append({ i: 2 });
  await store._writeChain;
  const keys = [...kv._store.keys()].filter((k) => k !== 'ci_memory:__index');
  assert.equal(keys.length, 3);
});

// ── Integration with CiOrchestrator (duck-typing) ─────────────────────────────

test('CloudflareKvStore: can be used as CiOrchestrator memoryStore (duck-type)', async () => {
  const { CiOrchestrator } = require('../src/ciOrchestrator');
  const kv = makeKv();
  const kvStore = new CloudflareKvStore(kv);

  // Replace the memoryStore after construction to avoid fs writes
  const orch = new CiOrchestrator({ memoryFilePath: '/tmp/ci-kv-test.jsonl' });
  orch.memoryStore = kvStore;

  const task = orch.createTask({ fact: true }, 'test', false);
  orch.queue.push(task.id);
  orch.transition(task, 'QUEUED');
  await orch.runTaskNow(task.id);

  await kvStore._writeChain;
  assert.ok(kvStore.buffer.length > 0, 'memory records should have been appended');
  assert.equal(task.status, 'COMPLETED');
});

// ── Integration with CiOrchestrator + SupabaseStore (duck-typing) ─────────────

test('SupabaseStore: can be used as CiOrchestrator memoryStore (duck-type)', async () => {
  const { SupabaseStore } = require('../src/adapters/supabaseStore');
  const { CiOrchestrator } = require('../src/ciOrchestrator');

  function makeSupabaseClient() {
    const calls = [];
    function makeBuilder(table) {
      return {
        insert(payload) {
          calls.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
        select() { return this; },
        order() { return this; },
        limit(n) { return Promise.resolve({ data: [], error: null }); },
      };
    }
    return { _calls: calls, from(table) { return makeBuilder(table); } };
  }

  const client = makeSupabaseClient();
  const sbStore = new SupabaseStore(client);

  const orch = new CiOrchestrator({ memoryFilePath: '/tmp/ci-sb-test.jsonl' });
  orch.memoryStore = sbStore;

  const task = orch.createTask({ fact: true }, 'test', false);
  orch.queue.push(task.id);
  orch.transition(task, 'QUEUED');
  await orch.runTaskNow(task.id);

  await sbStore._appendChain;
  assert.ok(sbStore.buffer.length > 0, 'memory records should have been appended');
  assert.ok(client._calls.length > 0, 'Supabase inserts should have been called');
  assert.equal(task.status, 'COMPLETED');
});
