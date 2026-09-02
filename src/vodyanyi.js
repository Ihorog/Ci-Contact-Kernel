'use strict';

const VODYANYI_SCHEMA_VERSION = 1;
const VODYANYI_COORDINATE = 'HOME.WATER.VODYANYI';
const VODYANYI_NAME = 'Водяний';
const VODYANYI_STATE_KEY = `ci:vodyanyi:${VODYANYI_COORDINATE}`;

const ACTIVE_ORDER_STATES = new Set(['AUTHORIZED', 'QUOTED', 'SUBMITTED', 'CONFIRMED', 'IN_TRANSIT']);
const DELIVERABLE_ORDER_STATES = new Set(['SUBMITTED', 'CONFIRMED', 'IN_TRANSIT']);
const WATER_MARKER_RE = /(?:^|\s)(?:водян(?:ий|ого|ому)|питн(?:а|ої|у)\s+вод(?:а|и|у)|вод(?:а|и|у|ою)|крапл(?:я|і|ю)|water|drop)(?:\s|$)/iu;
const STANDARD_ACTION_RE = /(?:замов(?:ити|ляй|лення)|привез(?:ти|и)|поповн(?:ити|и)|виконай|запусти).{0,28}(?:вод|водян)|(?:водян(?:ий|ого)).{0,28}(?:виконай|замов|поповн)/iu;
const CONDITIONS_ACTION_RE = /(?:інш(?:і|их)|змін(?:ити|и)|умов(?:и|у)|кількіст|інший\s+час|інша\s+вода)/iu;
const DELIVERY_CONFIRMED_RE = /(?:вод(?:у|а).{0,24}(?:привезли|доставили|отримал(?:и|а)?|вже\s+є)|(?:привезли|доставили).{0,24}вод)/iu;

function isoNow(now = () => new Date()) {
  return now().toISOString();
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeClicks(value) {
  const clicks = Number(value);
  if (clicks === 2) return 2;
  if (clicks === 1) return 1;
  return null;
}

function secretsEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function signalText(payload = {}) {
  return [
    payload.message,
    payload.text,
    payload.command,
    payload.marker,
    payload.context?.topic,
    payload.context?.marker,
  ].filter(Boolean).join(' ').trim();
}

function isVodyanyiSignal(payload = {}) {
  const coordinate = String(payload.coordinate || payload.context?.coordinate || '').toUpperCase();
  if (coordinate === VODYANYI_COORDINATE) return true;

  const source = String(payload.source || payload.origin || '').toLowerCase();
  if (source.includes('vodyanyi') || source === 'nfc.water' || source === 'ui.drop') return true;

  const marker = String(payload.marker || payload.context?.marker || '').toLowerCase();
  if (['drop', 'крапля', 'водяний', 'nfc:home.water.vodyanyi'].includes(marker)) return true;

  return WATER_MARKER_RE.test(signalText(payload));
}

function resolveVodyanyiMode(payload = {}) {
  if (!isVodyanyiSignal(payload)) return 'unrecognized';

  const action = String(payload.action || payload.requestedAction || '').toLowerCase();
  const clicks = normalizeClicks(payload.clicks ?? payload.gesture?.clicks);
  const text = signalText(payload);

  if (['confirm_delivery', 'delivered', 'delivery_confirmed'].includes(action) || DELIVERY_CONFIRMED_RE.test(text)) {
    return 'confirm_delivery';
  }

  if (clicks === 2 || ['change_conditions', 'conditions', 'configure'].includes(action) || CONDITIONS_ACTION_RE.test(text)) {
    return 'change_conditions';
  }

  if (
    clicks === 1
    || ['execute_standard', 'order_standard', 'replenish'].includes(action)
    || STANDARD_ACTION_RE.test(text)
    || (String(payload.source || '').toLowerCase().startsWith('nfc') && payload.activate === true)
  ) {
    return 'execute_standard';
  }

  return 'recognize';
}

function minimumSummary(operation) {
  if (!operation) return null;
  return {
    priceUAH: operation.quote?.totalUAH ?? operation.order?.totalUAH ?? null,
    quantity: operation.profile?.quantity ?? null,
    bottleLiters: operation.profile?.bottleLiters ?? null,
    deliveryTime: operation.order?.deliverySlot ?? operation.quote?.deliverySlot ?? null,
    status: operation.status,
  };
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value) {
  const input = typeof value === 'string' ? value : stableSerialize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createId(prefix = 'vodyanyi') {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function parseProfile(env = {}) {
  const raw = env.VODYANYI_STANDARD_PROFILE_JSON;
  if (!raw) return { profile: null, errors: ['VODYANYI_STANDARD_PROFILE_JSON is not configured.'] };

  let profile;
  try {
    profile = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { profile: null, errors: ['VODYANYI_STANDARD_PROFILE_JSON must be valid JSON.'] };
  }

  const errors = [];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { profile: null, errors: ['The standard profile must be a JSON object.'] };
  }
  if (!String(profile.provider || '').trim()) errors.push('profile.provider is required.');
  if (!finitePositive(profile.quantity)) errors.push('profile.quantity must be greater than zero.');
  if (!finitePositive(profile.bottleLiters)) errors.push('profile.bottleLiters must be greater than zero.');
  if (!finitePositive(profile.maxTotalUAH)) errors.push('profile.maxTotalUAH must be greater than zero.');
  if (!String(profile.deliveryRef || '').trim()) errors.push('profile.deliveryRef is required.');
  if (!String(profile.recipientRef || '').trim()) errors.push('profile.recipientRef is required.');
  if (profile.verified !== true) errors.push('profile.verified must be true.');
  if (!String(profile.procedureVersion || '').trim()) errors.push('profile.procedureVersion is required.');

  return { profile, errors };
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    provider: profile.provider,
    quantity: Number(profile.quantity),
    bottleLiters: Number(profile.bottleLiters),
    waterType: profile.waterType || 'standard',
    maxTotalUAH: Number(profile.maxTotalUAH),
    exchangeEmptyBottles: profile.exchangeEmptyBottles !== false,
    procedureVersion: profile.procedureVersion,
    verified: profile.verified === true,
    profileHash: shortHash({
      provider: profile.provider,
      quantity: Number(profile.quantity),
      bottleLiters: Number(profile.bottleLiters),
      waterType: profile.waterType || 'standard',
      maxTotalUAH: Number(profile.maxTotalUAH),
      deliveryRef: profile.deliveryRef,
      recipientRef: profile.recipientRef,
      procedureVersion: profile.procedureVersion,
    }),
  };
}

function initialState(timestamp) {
  return {
    schemaVersion: VODYANYI_SCHEMA_VERSION,
    coordinate: VODYANYI_COORDINATE,
    name: VODYANYI_NAME,
    position: 'drinking_water',
    status: 'REGISTERED',
    stock: {
      fullBottles: null,
      emptyBottles: null,
      confidence: 'unknown',
      updatedAt: null,
    },
    activeOperation: null,
    lastCompletedOperation: null,
    pendingConditions: null,
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function appendEvent(state, event) {
  state.events = [event, ...(Array.isArray(state.events) ? state.events : [])].slice(0, 100);
  state.updatedAt = event.timestamp;
}

function createMemoryStore(seed) {
  const values = new Map();
  if (seed !== undefined) values.set(VODYANYI_STATE_KEY, JSON.stringify(seed));
  return {
    async get(key) {
      const raw = values.get(key);
      return raw ? JSON.parse(raw) : null;
    },
    async put(key, value) {
      values.set(key, JSON.stringify(value));
    },
  };
}

function createHttpExecutor(env = {}, fetchImpl = globalThis.fetch) {
  const endpoint = String(env.VODYANYI_EXECUTOR_URL || '').trim();
  const token = String(env.VODYANYI_EXECUTOR_TOKEN || '').trim();
  if (!endpoint || typeof fetchImpl !== 'function') return null;

  const timeoutMs = Math.min(Math.max(Number(env.VODYANYI_EXECUTOR_TIMEOUT_MS) || 12_000, 1_000), 30_000);

  async function call(action, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-ci-coordinate': VODYANYI_COORDINATE,
          'x-ci-idempotency-key': body.operation.idempotencyKey,
        },
        body: JSON.stringify({ action, ...body }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error(`Vodyanyi executor returned HTTP ${response.status}.`), {
          code: 'EXECUTOR_HTTP_ERROR',
          status: response.status,
          safeDetails: result?.error || null,
        });
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    quote(operation, profile) {
      return call('quote', { operation, profile });
    },
    submit(operation, profile, quote) {
      return call('submit', { operation, profile, quote });
    },
  };
}

function isFreshQuote(verifiedAt, nowMs, maxAgeSeconds) {
  const verifiedMs = Date.parse(verifiedAt);
  if (!Number.isFinite(verifiedMs)) return false;
  const ageMs = nowMs - verifiedMs;
  return ageMs >= -30_000 && ageMs <= maxAgeSeconds * 1000;
}

function safeError(error) {
  return {
    code: error?.code || (error?.name === 'AbortError' ? 'EXECUTOR_TIMEOUT' : 'EXECUTOR_ERROR'),
    message: error?.message || 'Vodyanyi executor failed.',
    details: error?.safeDetails || null,
  };
}

function createVodyanyiService(options = {}) {
  const store = options.store || createMemoryStore();
  const env = options.env || {};
  const now = options.now || (() => new Date());
  const executor = options.executor || createHttpExecutor(env, options.fetchImpl);

  async function readState() {
    const timestamp = isoNow(now);
    return (await store.get(VODYANYI_STATE_KEY)) || initialState(timestamp);
  }

  async function writeState(state) {
    await store.put(VODYANYI_STATE_KEY, state);
    return state;
  }

  async function status() {
    const state = await readState();
    const parsed = parseProfile(env);
    return {
      coordinate: VODYANYI_COORDINATE,
      name: VODYANYI_NAME,
      position: 'drinking_water',
      state,
      readiness: {
        triggerProtected: Boolean(env.VODYANYI_TRIGGER_SECRET),
        profileVerified: parsed.errors.length === 0,
        executorConnected: Boolean(executor),
        readyForOneClick: Boolean(env.VODYANYI_TRIGGER_SECRET) && parsed.errors.length === 0 && Boolean(executor),
        blockers: [
          ...(!env.VODYANYI_TRIGGER_SECRET ? ['trigger_secret_missing'] : []),
          ...parsed.errors.map((error) => `profile:${error}`),
          ...(!executor ? ['executor_not_connected'] : []),
        ],
      },
      profile: publicProfile(parsed.profile),
      summary: minimumSummary(state.activeOperation || state.lastCompletedOperation),
    };
  }

  async function handle(payload = {}, context = {}) {
    const mode = resolveVodyanyiMode(payload);
    if (mode === 'unrecognized') {
      return { ok: false, httpStatus: 400, outcome: 'UNRECOGNIZED', coordinate: null };
    }

    const timestamp = isoNow(now);
    const state = await readState();
    const source = String(payload.source || payload.origin || context.source || 'unknown');

    if (mode === 'confirm_delivery') {
      const configuredSecret = String(env.VODYANYI_TRIGGER_SECRET || '');
      const suppliedSecret = String(context.triggerSecret || payload.triggerSecret || '');
      if (!configuredSecret || !secretsEqual(suppliedSecret, configuredSecret)) {
        return {
          ok: false,
          httpStatus: configuredSecret ? 401 : 503,
          outcome: configuredSecret ? 'UNAUTHORIZED' : 'NOT_PROVISIONED',
          coordinate: VODYANYI_COORDINATE,
          error: 'Trusted delivery confirmation is required.',
        };
      }

      const operation = state.activeOperation;
      if (!operation || !DELIVERABLE_ORDER_STATES.has(operation.status)) {
        return {
          ok: false,
          httpStatus: 409,
          outcome: 'DELIVERY_STATE_CONFLICT',
          coordinate: VODYANYI_COORDINATE,
          error: 'There is no active water order that can be confirmed as delivered.',
        };
      }

      const deliveredAt = timestamp;
      operation.status = 'DELIVERED';
      operation.updatedAt = deliveredAt;
      operation.deliveredAt = deliveredAt;
      operation.deliveryConfirmation = {
        actor: String(payload.actor || context.actor || 'registered-operator'),
        source,
        signalId: payload.signalId || null,
        evidence: 'USER_CONFIRMED_RECEIPT',
        confirmedAt: deliveredAt,
      };
      operation.stages.push({ stage: 'USER_DELIVERY_CONFIRMATION', status: 'VERIFIED', timestamp: deliveredAt });

      const deliveredQuantity = finitePositive(operation.profile?.quantity);
      if (deliveredQuantity) {
        const rawCurrentFull = state.stock?.fullBottles;
        const currentFull = rawCurrentFull === null || rawCurrentFull === undefined
          ? null
          : Number(rawCurrentFull);
        state.stock.fullBottles = Number.isFinite(currentFull) && currentFull >= 0
          ? currentFull + deliveredQuantity
          : deliveredQuantity;
        state.stock.confidence = Number.isFinite(currentFull)
          ? 'confirmed_movement'
          : 'estimated_from_confirmed_delivery';
        state.stock.updatedAt = deliveredAt;
      }

      state.status = 'DELIVERED';
      state.activeOperation = null;
      state.lastCompletedOperation = operation;
      appendEvent(state, {
        id: createId('event'),
        type: 'DELIVERY_CONFIRMED_BY_USER',
        operationId: operation.id,
        providerOrderId: operation.order?.orderId || null,
        quantity: deliveredQuantity,
        source,
        timestamp: deliveredAt,
      });
      await writeState(state);

      return {
        ok: true,
        httpStatus: 200,
        outcome: 'DELIVERED',
        coordinate: VODYANYI_COORDINATE,
        summary: minimumSummary(operation),
        operation,
      };
    }

    if (mode === 'recognize') {
      appendEvent(state, {
        id: createId('event'),
        type: 'COORDINATE_RECOGNIZED',
        source,
        timestamp,
      });
      await writeState(state);
      return {
        ok: true,
        httpStatus: 200,
        outcome: 'RECOGNIZED',
        coordinate: VODYANYI_COORDINATE,
        name: VODYANYI_NAME,
      };
    }

    if (mode === 'change_conditions') {
      const configuredSecret = String(env.VODYANYI_TRIGGER_SECRET || '');
      const suppliedSecret = String(context.triggerSecret || payload.triggerSecret || '');
      if (!configuredSecret || !secretsEqual(suppliedSecret, configuredSecret)) {
        return {
          ok: false,
          httpStatus: configuredSecret ? 401 : 503,
          outcome: configuredSecret ? 'UNAUTHORIZED' : 'NOT_PROVISIONED',
          coordinate: VODYANYI_COORDINATE,
          error: 'Trusted two-click token is required.',
        };
      }

      const pending = {
        id: createId('conditions'),
        source,
        status: 'WAITING_USER_CONDITIONS',
        createdAt: timestamp,
      };
      state.status = 'WAITING_CONDITIONS';
      state.pendingConditions = pending;
      appendEvent(state, {
        id: createId('event'),
        type: 'CONDITION_CHANGE_REQUESTED',
        source,
        timestamp,
      });
      await writeState(state);
      return {
        ok: true,
        httpStatus: 202,
        outcome: 'WAITING_CONDITIONS',
        coordinate: VODYANYI_COORDINATE,
        pendingConditions: pending,
      };
    }

    const configuredSecret = String(env.VODYANYI_TRIGGER_SECRET || '');
    if (!configuredSecret) {
      return {
        ok: false,
        httpStatus: 503,
        outcome: 'NOT_PROVISIONED',
        coordinate: VODYANYI_COORDINATE,
        error: 'One-click execution is not provisioned.',
      };
    }

    const suppliedSecret = String(context.triggerSecret || payload.triggerSecret || '');
    if (!secretsEqual(suppliedSecret, configuredSecret)) {
      return {
        ok: false,
        httpStatus: 401,
        outcome: 'UNAUTHORIZED',
        coordinate: VODYANYI_COORDINATE,
        error: 'Trusted one-click token is required.',
      };
    }

    const { profile, errors } = parseProfile(env);
    if (errors.length > 0 || !executor) {
      return {
        ok: false,
        httpStatus: 503,
        outcome: 'NOT_READY',
        coordinate: VODYANYI_COORDINATE,
        blockers: [...errors, ...(!executor ? ['VODYANYI_EXECUTOR_URL is not configured.'] : [])],
      };
    }

    const cooldownHours = Math.min(Math.max(Number(env.VODYANYI_ORDER_COOLDOWN_HOURS) || 24, 1), 168);
    const active = state.activeOperation;
    if (active && ACTIVE_ORDER_STATES.has(active.status)) {
      return {
        ok: true,
        httpStatus: 200,
        outcome: 'DEDUPLICATED',
        coordinate: VODYANYI_COORDINATE,
        summary: minimumSummary(active),
        operation: active,
      };
    }
    const last = state.lastCompletedOperation;
    if (last?.submittedAt) {
      const elapsed = now().getTime() - Date.parse(last.submittedAt);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < cooldownHours * 60 * 60 * 1000) {
        return {
          ok: true,
          httpStatus: 200,
          outcome: 'DEDUPLICATED',
          coordinate: VODYANYI_COORDINATE,
          summary: minimumSummary(last),
          operation: last,
        };
      }
    }

    const idempotencyKey = String(payload.signalId || payload.idempotencyKey || createId('click'));
    const operation = {
      id: createId('water_order'),
      idempotencyKey,
      coordinate: VODYANYI_COORDINATE,
      name: VODYANYI_NAME,
      type: 'STANDARD_WATER_REPLENISHMENT',
      source,
      status: 'AUTHORIZED',
      authorization: {
        kind: 'ONE_CLICK',
        actor: String(payload.actor || context.actor || 'registered-operator'),
        grantedAt: timestamp,
        signalId: payload.signalId || null,
      },
      profile: publicProfile(profile),
      stages: [{ stage: 'AUTHORIZED', status: 'VERIFIED', timestamp }],
      createdAt: timestamp,
      updatedAt: timestamp,
      quote: null,
      order: null,
      verification: { status: 'PENDING', evidence: [] },
    };

    state.status = 'EXECUTING';
    state.pendingConditions = null;
    state.activeOperation = operation;
    appendEvent(state, {
      id: createId('event'),
      type: 'STANDARD_EXECUTION_AUTHORIZED',
      source,
      operationId: operation.id,
      timestamp,
    });
    await writeState(state);

    try {
      const quote = await executor.quote(operation, profile);
      const maxAgeSeconds = Math.min(Math.max(Number(env.VODYANYI_MAX_QUOTE_AGE_SECONDS) || 300, 30), 900);
      const quoteTotal = finitePositive(quote?.totalUAH);
      const quoteValid = Boolean(
        quote?.quoteId
        && quote?.available === true
        && quote?.currency === 'UAH'
        && quoteTotal
        && quoteTotal <= Number(profile.maxTotalUAH)
        && isFreshQuote(quote.verifiedAt, now().getTime(), maxAgeSeconds)
      );

      if (!quoteValid) {
        operation.status = 'BLOCKED_QUOTE';
        operation.updatedAt = isoNow(now);
        operation.quote = quote ? {
          quoteId: quote.quoteId || null,
          totalUAH: quoteTotal,
          currency: quote.currency || null,
          verifiedAt: quote.verifiedAt || null,
          available: quote.available === true,
        } : null;
        operation.stages.push({
          stage: 'QUOTE_VERIFICATION',
          status: 'BLOCKED',
          timestamp: operation.updatedAt,
          reason: 'Quote is missing, stale, unavailable, in another currency, or above the verified price cap.',
        });
        state.status = 'BLOCKED';
        state.activeOperation = operation;
        appendEvent(state, {
          id: createId('event'),
          type: 'QUOTE_BLOCKED',
          operationId: operation.id,
          source,
          timestamp: operation.updatedAt,
        });
        await writeState(state);
        return {
          ok: false,
          httpStatus: 409,
          outcome: 'QUOTE_BLOCKED',
          coordinate: VODYANYI_COORDINATE,
          operation,
        };
      }

      operation.status = 'QUOTED';
      operation.quote = {
        quoteId: quote.quoteId,
        totalUAH: quoteTotal,
        currency: quote.currency,
        verifiedAt: quote.verifiedAt,
        deliverySlot: quote.deliverySlot || null,
        termsHash: quote.termsHash || null,
      };
      operation.updatedAt = isoNow(now);
      operation.stages.push({ stage: 'QUOTE_VERIFICATION', status: 'VERIFIED', timestamp: operation.updatedAt });
      await writeState(state);

      const submitted = await executor.submit(operation, profile, operation.quote);
      if (!submitted?.accepted || !String(submitted.orderId || '').trim()) {
        throw Object.assign(new Error('Executor did not return a provider order confirmation.'), {
          code: 'ORDER_NOT_ACCEPTED',
          safeDetails: submitted?.error || null,
        });
      }

      const submittedAt = isoNow(now);
      const providerStatus = ['CONFIRMED', 'IN_TRANSIT'].includes(String(submitted.status || '').toUpperCase())
        ? String(submitted.status).toUpperCase()
        : 'SUBMITTED';
      operation.status = providerStatus;
      operation.submittedAt = submittedAt;
      operation.updatedAt = submittedAt;
      operation.order = {
        provider: profile.provider,
        orderId: String(submitted.orderId),
        status: providerStatus,
        totalUAH: quoteTotal,
        deliverySlot: submitted.deliverySlot || quote.deliverySlot || null,
        confirmationRef: submitted.confirmationRef || null,
      };
      operation.verification = {
        status: 'VERIFIED',
        evidence: Array.isArray(submitted.evidence) ? submitted.evidence.slice(0, 20) : [],
      };
      operation.stages.push({ stage: 'PROVIDER_SUBMISSION', status: 'VERIFIED', timestamp: submittedAt });

      state.status = providerStatus;
      state.activeOperation = operation;
      state.lastCompletedOperation = operation;
      appendEvent(state, {
        id: createId('event'),
        type: 'ORDER_SUBMITTED',
        operationId: operation.id,
        providerOrderId: operation.order.orderId,
        source,
        timestamp: submittedAt,
      });
      await writeState(state);

      return {
        ok: true,
        httpStatus: 200,
        outcome: providerStatus,
        coordinate: VODYANYI_COORDINATE,
        summary: minimumSummary(operation),
        operation,
      };
    } catch (error) {
      const failedAt = isoNow(now);
      operation.status = 'FAILED';
      operation.updatedAt = failedAt;
      operation.error = safeError(error);
      operation.stages.push({ stage: 'EXTERNAL_EXECUTION', status: 'FAILED', timestamp: failedAt });
      state.status = 'FAILED';
      state.activeOperation = operation;
      appendEvent(state, {
        id: createId('event'),
        type: 'EXECUTION_FAILED',
        operationId: operation.id,
        source,
        timestamp: failedAt,
        errorCode: operation.error.code,
      });
      await writeState(state);
      return {
        ok: false,
        httpStatus: 502,
        outcome: 'FAILED',
        coordinate: VODYANYI_COORDINATE,
        summary: minimumSummary(operation),
        operation,
      };
    }
  }

  return { status, handle, readState };
}

module.exports = {
  VODYANYI_SCHEMA_VERSION,
  VODYANYI_COORDINATE,
  VODYANYI_NAME,
  VODYANYI_STATE_KEY,
  isVodyanyiSignal,
  resolveVodyanyiMode,
  parseProfile,
  publicProfile,
  createMemoryStore,
  createHttpExecutor,
  createVodyanyiService,
  shortHash,
  minimumSummary,
};
