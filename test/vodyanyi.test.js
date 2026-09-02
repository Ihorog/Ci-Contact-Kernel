'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { createApp } = require('../src/server');
const {
  VODYANYI_COORDINATE,
  createMemoryStore,
  createVodyanyiService,
  isVodyanyiSignal,
  resolveVodyanyiMode,
} = require('../src/vodyanyi');

function verifiedEnv(overrides = {}) {
  return {
    VODYANYI_TRIGGER_SECRET: 'test-one-click-secret',
    VODYANYI_STANDARD_PROFILE_JSON: JSON.stringify({
      provider: 'verified-provider',
      quantity: 2,
      bottleLiters: 18.9,
      waterType: 'standard',
      maxTotalUAH: 250,
      exchangeEmptyBottles: true,
      recipientRef: 'vault://home/water/recipient',
      deliveryRef: 'vault://home/water/address',
      procedureVersion: '1',
      verified: true,
    }),
    ...overrides,
  };
}

function verifiedExecutor(clock, counters = { quote: 0, submit: 0 }) {
  return {
    async quote() {
      counters.quote += 1;
      return {
        quoteId: 'quote-1',
        available: true,
        currency: 'UAH',
        totalUAH: 190,
        verifiedAt: clock().toISOString(),
        deliverySlot: '10:00–12:00',
        termsHash: 'terms-1',
      };
    },
    async submit() {
      counters.submit += 1;
      return {
        accepted: true,
        orderId: 'provider-order-1',
        status: 'CONFIRMED',
        confirmationRef: 'provider-confirmation-1',
        evidence: [{ type: 'provider_confirmation', ref: 'provider-confirmation-1' }],
      };
    },
  };
}

test('all water markers resolve to the single Vodyanyi coordinate', () => {
  const signals = [
    { coordinate: VODYANYI_COORDINATE },
    { marker: 'крапля', source: 'ui.drop' },
    { marker: 'nfc:home.water.vodyanyi', source: 'nfc' },
    { message: 'Водяний, замов воду', source: 'conversation' },
    { message: 'Потрібна питна вода', source: 'voice' },
  ];

  for (const signal of signals) assert.equal(isVodyanyiSignal(signal), true);
  assert.equal(resolveVodyanyiMode({ marker: 'крапля', clicks: 1 }), 'execute_standard');
  assert.equal(resolveVodyanyiMode({ marker: 'крапля', clicks: 2 }), 'change_conditions');
  assert.equal(resolveVodyanyiMode({ message: 'Воду привезли' }), 'confirm_delivery');
  assert.equal(resolveVodyanyiMode({ message: 'Ми говоримо про воду' }), 'recognize');
});

test('the visible drop contains beacon, summary and one-click delivery controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /id="vodyanyi-drop"/);
  assert.match(html, /@keyframes vodyanyi-beacon/);
  assert.match(html, /id="vodyanyi-summary"/);
  assert.match(html, /id="vodyanyi-confirm"/);
  assert.match(html, /Воду привезли/);
});

test('one click quotes, validates and submits exactly one real provider order', async () => {
  let current = new Date('2026-09-02T10:00:00.000Z');
  const clock = () => new Date(current);
  const counters = { quote: 0, submit: 0 };
  const service = createVodyanyiService({
    env: verifiedEnv(),
    store: createMemoryStore(),
    now: clock,
    executor: verifiedExecutor(clock, counters),
  });

  const first = await service.handle({
    coordinate: VODYANYI_COORDINATE,
    marker: 'drop',
    clicks: 1,
    action: 'execute_standard',
    source: 'ui.drop',
    signalId: 'signal-1',
  }, { triggerSecret: 'test-one-click-secret', actor: 'kazkar' });

  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'CONFIRMED');
  assert.equal(first.operation.authorization.kind, 'ONE_CLICK');
  assert.equal(first.operation.order.orderId, 'provider-order-1');
  assert.deepEqual(first.summary, {
    priceUAH: 190,
    quantity: 2,
    bottleLiters: 18.9,
    deliveryTime: '10:00–12:00',
    status: 'CONFIRMED',
  });
  assert.deepEqual(counters, { quote: 1, submit: 1 });

  current = new Date('2026-09-02T10:01:00.000Z');
  const duplicate = await service.handle({
    coordinate: VODYANYI_COORDINATE,
    clicks: 1,
    action: 'execute_standard',
    source: 'nfc.url',
    signalId: 'signal-2',
  }, { triggerSecret: 'test-one-click-secret' });

  assert.equal(duplicate.outcome, 'DEDUPLICATED');
  assert.deepEqual(counters, { quote: 1, submit: 1 });
});

test('two clicks request other conditions and never call the provider', async () => {
  const counters = { quote: 0, submit: 0 };
  const clock = () => new Date('2026-09-02T10:00:00.000Z');
  const service = createVodyanyiService({
    env: verifiedEnv(),
    store: createMemoryStore(),
    now: clock,
    executor: verifiedExecutor(clock, counters),
  });

  const result = await service.handle({
    marker: 'drop',
    clicks: 2,
    source: 'ui.drop',
  }, { triggerSecret: 'test-one-click-secret' });

  assert.equal(result.outcome, 'WAITING_CONDITIONS');
  assert.deepEqual(counters, { quote: 0, submit: 0 });
});

test('user confirmation closes delivery and records bottle movement', async () => {
  const clock = () => new Date('2026-09-02T10:00:00.000Z');
  const service = createVodyanyiService({
    env: verifiedEnv(),
    store: createMemoryStore(),
    now: clock,
    executor: verifiedExecutor(clock),
  });

  await service.handle({
    marker: 'Водяний',
    clicks: 1,
    action: 'execute_standard',
    source: 'conversation',
  }, { triggerSecret: 'test-one-click-secret' });

  const delivered = await service.handle({
    message: 'Воду привезли',
    source: 'conversation',
    actor: 'kazkar',
  }, { triggerSecret: 'test-one-click-secret' });

  assert.equal(delivered.outcome, 'DELIVERED');
  assert.equal(delivered.operation.deliveryConfirmation.evidence, 'USER_CONFIRMED_RECEIPT');
  const state = await service.readState();
  assert.equal(state.activeOperation, null);
  assert.equal(state.lastCompletedOperation.status, 'DELIVERED');
  assert.equal(state.stock.fullBottles, 2);
  assert.equal(state.stock.confidence, 'estimated_from_confirmed_delivery');
});

test('one-click execution is blocked without the trusted token', async () => {
  const clock = () => new Date('2026-09-02T10:00:00.000Z');
  const counters = { quote: 0, submit: 0 };
  const service = createVodyanyiService({
    env: verifiedEnv(),
    store: createMemoryStore(),
    now: clock,
    executor: verifiedExecutor(clock, counters),
  });

  const result = await service.handle({ marker: 'drop', clicks: 1, source: 'ui.drop' });
  assert.equal(result.outcome, 'UNAUTHORIZED');
  assert.deepEqual(counters, { quote: 0, submit: 0 });
});

test('a stale or over-cap quote is blocked before provider submission', async () => {
  const clock = () => new Date('2026-09-02T10:00:00.000Z');
  let submits = 0;
  const service = createVodyanyiService({
    env: verifiedEnv(),
    store: createMemoryStore(),
    now: clock,
    executor: {
      async quote() {
        return {
          quoteId: 'too-expensive',
          available: true,
          currency: 'UAH',
          totalUAH: 251,
          verifiedAt: clock().toISOString(),
        };
      },
      async submit() {
        submits += 1;
        return { accepted: true, orderId: 'must-not-happen' };
      },
    },
  });

  const result = await service.handle({ marker: 'drop', clicks: 1 }, {
    triggerSecret: 'test-one-click-secret',
  });

  assert.equal(result.outcome, 'QUOTE_BLOCKED');
  assert.equal(submits, 0);
});

test('Express exposes the Vodyanyi status and one-click signal routes', async () => {
  const clock = () => new Date('2026-09-02T10:00:00.000Z');
  const service = createVodyanyiService({
    env: verifiedEnv(),
    store: createMemoryStore(),
    now: clock,
    executor: verifiedExecutor(clock),
  });
  const app = createApp({ vodyanyiService: service });

  const status = await request(app).get('/ci/vodyanyi/status').expect(200);
  assert.equal(status.body.coordinate, VODYANYI_COORDINATE);
  assert.equal(status.body.readiness.readyForOneClick, true);

  const order = await request(app)
    .post('/ci/vodyanyi/signal')
    .set('x-ci-vodyanyi-token', 'test-one-click-secret')
    .set('x-ci-operator-id', 'kazkar')
    .send({ marker: 'drop', clicks: 1, source: 'ui.drop' })
    .expect(200);

  assert.equal(order.body.outcome, 'CONFIRMED');
});
