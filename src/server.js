const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { CiOrchestrator } = require('./ciOrchestrator');
const { proxyKeeneticMcp, statusKeeneticConfig } = require('./keeneticMcpGateway');
const { createMemoryStore, createVodyanyiService } = require('./vodyanyi');

const ciopen = {
  detectContext(signal = {}) {
    const source = signal.source || signal.origin || 'unknown';
    const repoFields = [
      signal.repo,
      signal.repository,
      signal.repositoryName,
      signal.context?.repo,
      signal.context?.repository
    ].filter(Boolean);
    return {
      source,
      detectedNode: repoFields.length > 0 ? 'repo_context' : 'generic_context'
    };
  }
};

function createSimpleRateLimiter({ windowMs = 60_000, maxRequests = 120 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    buckets.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    return next();
  };
}

function taskSummary(task) {
  return {
    id: task.id,
    source: task.source,
    signalId: task.signalId,
    type: task.type,
    priority: task.priority,
    status: task.status,
    classification: task.classification,
    targetNode: task.targetNode,
    executionCenter: task.executionCenter,
    executionCenters: task.executionCenters,
    permissionLevel: task.permissionLevel,
    permissionDecision: task.permissionDecision,
    approvalPolicy: task.approvalPolicy,
    approvalState: task.approvalState,
    checkpointId: task.checkpointId,
    completionPolicy: task.completionPolicy,
    requiredVerifiers: task.requiredVerifiers,
    verificationResults: task.verificationResults,
    verificationAttempt: task.verificationAttempt,
    maxVerificationRetries: task.maxVerificationRetries,
    incidentRecord: task.incidentRecord,
    aggregationPolicy: task.aggregationPolicy,
    aggregationSummary: task.aggregationSummary,
    branches: task.branches,
    verification: task.verification,
    nextSuggestedAction: task.nextSuggestedAction,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function readOperatorId(req) {
  const raw = req.headers['x-ci-operator-id'];
  if (Array.isArray(raw)) return raw[0] || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function sanitizeIngestRecord(record) {
  return {
    ingest_id: record.ingest_id,
    source_repo: record.source_repo,
    source_ref: record.source_ref,
    path: record.path,
    blob_sha: record.blob_sha,
    content_hash: record.content_hash,
    media_type: record.media_type,
    size_bytes: record.size_bytes,
    source_type: record.source_type,
    ingest_status: record.ingest_status,
    received_at: record.received_at,
    updated_at: record.updated_at,
    deleted: record.deleted,
    classification_runs_count: Array.isArray(record.classification_runs) ? record.classification_runs.length : 0,
  };
}

function verifyWebhookSignature(secret, rawBody, signatureHeader) {
  if (!secret || !rawBody || !signatureHeader || typeof signatureHeader !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createApp(options = {}) {
  const app = express();
  const orchestrator = options.orchestrator || new CiOrchestrator(options);
  const ciRateLimiter = createSimpleRateLimiter(options.rateLimit || {});
  const runtimeEnv = options.env || process.env;
  const vodyanyi = options.vodyanyiService || createVodyanyiService({
    env: runtimeEnv,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    store: options.vodyanyiStore || createMemoryStore(),
  });

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/ci', ciRateLimiter);
  app.use('/ciopen', ciRateLimiter);
  app.use('/mcp/keenetic', ciRateLimiter);

  app.post('/ci/signal', (req, res) => {
    const payload = req.body || {};
    const task = orchestrator.createTask({ ...payload, type: payload.type || 'signal' }, 'signal', true);
    res.status(202).json({ task: taskSummary(task) });
  });

  app.post('/ci/task', (req, res) => {
    const payload = req.body || {};
    const task = orchestrator.createTask(payload, 'task', payload.queue !== false);
    res.status(201).json({ task: taskSummary(task) });
  });

  app.get('/ci/task/:id', (req, res) => {
    const task = orchestrator.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    return res.json({ task });
  });

  app.get('/ci/tasks', (req, res) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
    res.json({ tasks: orchestrator.recentTasks(limit) });
  });

  app.post('/ci/task/:id/run', async (req, res) => {
    const task = await orchestrator.runTaskNow(req.params.id, req.body?.permissions || {});
    if (!task) return res.status(404).json({ error: 'Task not found' });
    return res.json({ task });
  });

  app.post('/ci/task/:id/approve', async (req, res) => {
    const { checkpointId, actor, reason } = req.body || {};
    if (!checkpointId) return res.status(400).json({ error: 'checkpointId is required.' });
    const result = await orchestrator.approveTask(req.params.id, checkpointId, actor || 'api', reason || '');
    if (!result) return res.status(404).json({ error: 'Task not found' });
    if (result.error) return res.status(400).json(result);
    return res.json({ task: taskSummary(result) });
  });

  app.post('/ci/task/:id/reject', (req, res) => {
    const { checkpointId, actor, reason } = req.body || {};
    if (!checkpointId) return res.status(400).json({ error: 'checkpointId is required.' });
    const result = orchestrator.rejectTask(req.params.id, checkpointId, actor || 'api', reason || '');
    if (!result) return res.status(404).json({ error: 'Task not found' });
    if (result.error) return res.status(400).json(result);
    return res.json({ task: taskSummary(result) });
  });

  app.get('/ci/checkpoints', (req, res) => {
    res.json({ checkpoints: orchestrator.getCheckpoints() });
  });

  app.get('/ci/checkpoint/:id', (req, res) => {
    const cp = orchestrator.getCheckpoint(req.params.id);
    if (!cp) return res.status(404).json({ error: 'Checkpoint not found' });
    return res.json({ checkpoint: cp });
  });

  app.get('/ci/status', (req, res) => {
    res.json(orchestrator.status());
  });

  app.get('/ci/vodyanyi/status', async (_req, res) => {
    const result = await vodyanyi.status();
    res.json(result);
  });

  app.post('/ci/vodyanyi/signal', async (req, res) => {
    const rawSecret = req.headers['x-ci-vodyanyi-token'];
    const triggerSecret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
    const result = await vodyanyi.handle(req.body || {}, {
      triggerSecret: typeof triggerSecret === 'string' ? triggerSecret : '',
      actor: readOperatorId(req) || 'registered-operator',
      source: req.body?.source || 'ci.vodyanyi.api',
    });
    return res.status(result.httpStatus || (result.ok ? 200 : 400)).json(result);
  });

  app.get('/ci/keenetic/status', (_req, res) => {
    res.json(statusKeeneticConfig(runtimeEnv));
  });

  app.get('/ci/memory', (req, res) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 200);
    res.json({ records: orchestrator.recentMemory(limit) });
  });

  app.post('/ci/command', (req, res) => {
    const task = orchestrator.createTask({
      ...(req.body || {}),
      type: 'command',
      command: req.body?.command || null
    }, 'ci.command', true);
    res.status(202).json({ task: taskSummary(task) });
  });

  app.all('/mcp/keenetic', async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, last-event-id',
        'Cache-Control': 'no-store',
      });
      return res.status(204).end();
    }
    return proxyKeeneticMcp(req, res, {
      env: runtimeEnv,
      fetchImpl: options.fetchImpl || globalThis.fetch,
    });
  });

  app.post('/ciopen/webhook', (req, res) => {
    const context = ciopen.detectContext(req.body || {});
    const task = orchestrator.createTask({ ...(req.body || {}), type: 'webhook', context }, 'ciopen.webhook', true);
    res.status(202).json({ context, task: taskSummary(task) });
  });

  // ── Cigrafin ingestion routes ─────────────────────────────────────────────

  const {
    ingestCigrafinItem,
    runCigrafinScan,
    reprocessIngestItem,
    getIngestRecord,
    listIngestRecords,
    getQuarantine,
  } = require('./cigraph/ingest/pipeline');
  const { buildItemsFromWebhook } = require('./cigraph/ingest/githubCigrafinAdapter');
  app.use('/cigrafin', ciRateLimiter);

  // Read-only intake status
  app.get('/cigrafin/status', ciRateLimiter, (_req, res) => {
    const records = listIngestRecords();
    const quarantine = getQuarantine();
    res.json({
      total_ingest_records: records.length,
      quarantined: quarantine.size,
      status_counts: records.reduce((acc, r) => {
        acc[r.ingest_status] = (acc[r.ingest_status] || 0) + 1;
        return acc;
      }, {}),
    });
  });

  app.get('/cigrafin/ingest/:id', ciRateLimiter, (req, res) => {
    const operatorId = readOperatorId(req);
    if (!operatorId) return res.status(403).json({ error: 'x-ci-operator-id header required' });
    const record = getIngestRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'not_found' });
    return res.json(sanitizeIngestRecord(record));
  });

  app.get('/cigrafin/quarantine', ciRateLimiter, (req, res) => {
    const operatorId = readOperatorId(req);
    if (!operatorId) return res.status(403).json({ error: 'x-ci-operator-id header required' });
    res.json({ items: getQuarantine().list() });
  });

  // Manual reprocess by ingest_id (requires operator intent header)
  app.post('/cigrafin/reprocess/:id', ciRateLimiter, async (req, res) => {
    const operatorId = readOperatorId(req);
    if (!operatorId) return res.status(403).json({ error: 'x-ci-operator-id header required' });
    try {
      const result = await reprocessIngestItem(req.params.id, { operator: operatorId });
      res.json(result);
    } catch (err) {
      const safe = String(err.message).slice(0, 300);
      if (safe.includes('NOT_FOUND')) return res.status(404).json({ error: safe });
      return res.status(500).json({ error: safe });
    }
  });

  // Manual scan trigger (requires operator intent header — not automatic approval)
  app.post('/cigrafin/scan', ciRateLimiter, async (req, res) => {
    const operatorId = readOperatorId(req);
    if (!operatorId) return res.status(403).json({ error: 'x-ci-operator-id header required' });
    try {
      const summary = await runCigrafinScan(process.env, { operator: operatorId });
      res.json(summary);
    } catch (err) {
      return res.status(500).json({ error: String(err.message).slice(0, 300) });
    }
  });

  // Push/webhook event from source repository
  app.post('/cigrafin/webhook', ciRateLimiter, async (req, res) => {
    const payload = req.body || {};
    const webhookSecret = process.env.CIGRAFIN_WEBHOOK_SECRET;
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyWebhookSignature(webhookSecret, req.rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      return res.status(403).json({ error: 'invalid_webhook_signature' });
    }

    const expectedRepo = process.env.CIGRAFIN_SOURCE_REPO ?? 'Ihorog/ci-memory';
    const payloadRepo = payload?.repository?.full_name;
    if (payloadRepo !== expectedRepo) {
      return res.status(403).json({ error: 'repository_mismatch' });
    }

    const expectedRef = `refs/heads/${process.env.CIGRAFIN_SOURCE_REF ?? 'main'}`;
    if (payload.ref && payload.ref !== expectedRef) {
      return res.status(403).json({ error: 'ref_mismatch' });
    }

    try {
      const items = await buildItemsFromWebhook(payload, process.env);
      const results = [];
      for (const item of items) {
        results.push(await ingestCigrafinItem(item, { source: 'webhook' }));
      }
      res.json({ processed: results.length, results });
    } catch (err) {
      return res.status(500).json({ error: String(err.message).slice(0, 300) });
    }
  });

  app.get('/ci/monitor', ciRateLimiter, (req, res) => {
    res.redirect('/ci-monitor.html');
  });

  if (options.startWorker) orchestrator.startWorker(options.workerIntervalMs);
  app.locals.ciOrchestrator = orchestrator;
  app.locals.vodyanyi = vodyanyi;
  return app;
}

const app = createApp({ startWorker: require.main === module });

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Ci Contact Kernel listening on port ${port}`);
  });
}

app.createApp = createApp;
app.taskSummary = taskSummary;
app.createSimpleRateLimiter = createSimpleRateLimiter;

module.exports = app;
