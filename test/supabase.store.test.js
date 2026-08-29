'use strict';

/**
 * Full test suite for SupabaseStore adapter.
 *
 * All Supabase network calls are intercepted by a hand-rolled mock client so
 * the tests run offline without any real Supabase project or API key.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { SupabaseStore } = require('../src/adapters/supabaseStore');

// ── Mock Supabase client factory ──────────────────────────────────────────────

function makeClient({ insertError = null, selectError = null, rows = [] } = {}) {
  const calls = { insert: [], select: [] };

  function builder(overrides = {}) {
    const chain = {
      _table: '',
      _select: null,
      _order: null,
      _limit: null,
      insert(payload) {
        calls.insert.push({ table: chain._table, payload });
        return Promise.resolve({ data: null, error: insertError });
      },
      select(columns) {
        chain._select = columns;
        return chain;
      },
      order(col, opts) {
        chain._order = { col, opts };
        return chain;
      },
      limit(n) {
        chain._limit = n;
        return Promise.resolve({
          data: selectError ? null : rows.slice(0, n),
          error: selectError
        });
      },
    };
    return chain;
  }

  const client = {
    _calls: calls,
    from(table) {
      const b = builder();
      b._table = table;
      return b;
    },
  };
  return client;
}

// ── Construction ──────────────────────────────────────────────────────────────

test('SupabaseStore: constructor rejects a missing client', () => {
  assert.throws(() => new SupabaseStore(null), TypeError);
  assert.throws(() => new SupabaseStore({}), TypeError);
  assert.throws(() => new SupabaseStore(undefined), TypeError);
});

test('SupabaseStore: constructor accepts a valid client', () => {
  const client = makeClient();
  assert.doesNotThrow(() => new SupabaseStore(client));
});

test('SupabaseStore: default table name is ci_memory', () => {
  const store = new SupabaseStore(makeClient());
  assert.equal(store.table, 'ci_memory');
});

test('SupabaseStore: custom table name is respected', () => {
  const store = new SupabaseStore(makeClient(), { table: 'my_table' });
  assert.equal(store.table, 'my_table');
});

test('SupabaseStore: bufferLimit defaults to 2000', () => {
  const store = new SupabaseStore(makeClient());
  assert.equal(store.bufferLimit, 2000);
});

test('SupabaseStore: custom bufferLimit is clamped to minimum 1', () => {
  const store = new SupabaseStore(makeClient(), { bufferLimit: 0 });
  assert.equal(store.bufferLimit, 1);
});

// ── append + recent (buffer) ──────────────────────────────────────────────────

test('SupabaseStore: append adds records to the buffer', async () => {
  const store = new SupabaseStore(makeClient());
  store.append({ event: 'a' });
  store.append({ event: 'b' });
  assert.equal(store.buffer.length, 2);
});

test('SupabaseStore: recent returns records newest-first', async () => {
  const store = new SupabaseStore(makeClient());
  store.append({ event: 'first' });
  store.append({ event: 'second' });
  store.append({ event: 'third' });
  const result = store.recent(3);
  assert.equal(result[0].event, 'third');
  assert.equal(result[1].event, 'second');
  assert.equal(result[2].event, 'first');
});

test('SupabaseStore: recent limit is respected', () => {
  const store = new SupabaseStore(makeClient());
  for (let i = 0; i < 10; i++) store.append({ n: i });
  assert.equal(store.recent(3).length, 3);
});

test('SupabaseStore: recent returns at most buffer size records', () => {
  const store = new SupabaseStore(makeClient());
  for (let i = 0; i < 5; i++) store.append({ n: i });
  assert.equal(store.recent(100).length, 5);
});

test('SupabaseStore: buffer is capped to bufferLimit', () => {
  const store = new SupabaseStore(makeClient(), { bufferLimit: 3 });
  for (let i = 0; i < 10; i++) store.append({ n: i });
  assert.equal(store.buffer.length, 3);
  assert.equal(store.buffer[0].n, 7);
  assert.equal(store.buffer[2].n, 9);
});

test('SupabaseStore: append enqueues an insert to Supabase', async () => {
  const client = makeClient();
  const store = new SupabaseStore(client);
  store.append({ event: 'test_insert' });
  await store._appendChain;
  assert.equal(client._calls.insert.length, 1);
  assert.equal(client._calls.insert[0].table, 'ci_memory');
  assert.ok(client._calls.insert[0].payload.payload.event === 'test_insert');
});

test('SupabaseStore: insert payload includes recorded_at ISO string', async () => {
  const client = makeClient();
  const store = new SupabaseStore(client);
  store.append({ event: 'ts_check' });
  await store._appendChain;
  const { recorded_at } = client._calls.insert[0].payload;
  assert.ok(typeof recorded_at === 'string');
  assert.ok(!isNaN(Date.parse(recorded_at)));
});

// ── append error handling ─────────────────────────────────────────────────────

test('SupabaseStore: Supabase insert error removes record from buffer', async () => {
  const client = makeClient({ insertError: { message: 'connection refused' } });
  const store = new SupabaseStore(client);
  store.append({ event: 'fail' });
  assert.equal(store.buffer.length, 1);
  await store._appendChain;
  assert.equal(store.buffer.length, 0);
});

test('SupabaseStore: multiple sequential appends each trigger an insert', async () => {
  const client = makeClient();
  const store = new SupabaseStore(client);
  store.append({ n: 1 });
  store.append({ n: 2 });
  store.append({ n: 3 });
  await store._appendChain;
  assert.equal(client._calls.insert.length, 3);
});

// ── fetchRemote ───────────────────────────────────────────────────────────────

test('SupabaseStore: fetchRemote returns mapped payload objects', async () => {
  const rows = [
    { payload: { event: 'r1' }, recorded_at: new Date().toISOString() },
    { payload: { event: 'r2' }, recorded_at: new Date().toISOString() },
  ];
  const store = new SupabaseStore(makeClient({ rows }));
  const result = await store.fetchRemote(2);
  assert.equal(result.length, 2);
  assert.equal(result[0].event, 'r1');
  assert.equal(result[1].event, 'r2');
});

test('SupabaseStore: fetchRemote limit is passed to Supabase', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ payload: { n: i }, recorded_at: '' }));
  const store = new SupabaseStore(makeClient({ rows }));
  const result = await store.fetchRemote(5);
  assert.equal(result.length, 5);
});

test('SupabaseStore: fetchRemote returns [] on Supabase error', async () => {
  const store = new SupabaseStore(makeClient({ selectError: { message: 'timeout' } }));
  const result = await store.fetchRemote();
  assert.deepEqual(result, []);
});

test('SupabaseStore: fetchRemote default limit is 50', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ payload: { n: i }, recorded_at: '' }));
  const store = new SupabaseStore(makeClient({ rows }));
  const result = await store.fetchRemote();
  assert.equal(result.length, 50);
});

// ── Interface parity with MemoryStore ─────────────────────────────────────────

test('SupabaseStore: exposes append() and recent() like MemoryStore', () => {
  const store = new SupabaseStore(makeClient());
  assert.equal(typeof store.append, 'function');
  assert.equal(typeof store.recent, 'function');
});

test('SupabaseStore: exposes fetchRemote() for cross-instance queries', () => {
  const store = new SupabaseStore(makeClient());
  assert.equal(typeof store.fetchRemote, 'function');
});

test('SupabaseStore: recent() with non-numeric limit falls back to 50', () => {
  const store = new SupabaseStore(makeClient());
  for (let i = 0; i < 60; i++) store.append({ n: i });
  assert.equal(store.recent('bad').length, 50);
});

// ── Concurrent appends ────────────────────────────────────────────────────────

test('SupabaseStore: concurrent appends are serialised and all inserts succeed', async () => {
  const client = makeClient();
  const store = new SupabaseStore(client);
  for (let i = 0; i < 5; i++) store.append({ i });
  await store._appendChain;
  assert.equal(client._calls.insert.length, 5);
  assert.equal(store.buffer.length, 5);
});
