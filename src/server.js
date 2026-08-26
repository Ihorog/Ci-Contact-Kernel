const express = require('express');
const path = require('path');
const { CiOrchestrator } = require('./ciOrchestrator');

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
    permissionLevel: task.permissionLevel,
    permissionDecision: task.permissionDecision,
    verification: task.verification,
    nextSuggestedAction: task.nextSuggestedAction,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function createApp(options = {}) {
  const app = express();
  const orchestrator = options.orchestrator || new CiOrchestrator(options);
  const ciRateLimiter = createSimpleRateLimiter(options.rateLimit || {});

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use('/ci', ciRateLimiter);
  app.use('/ciopen', ciRateLimiter);

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

  app.get('/ci/status', (req, res) => {
    res.json(orchestrator.status());
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

  app.post('/ciopen/webhook', (req, res) => {
    const context = ciopen.detectContext(req.body || {});
    const task = orchestrator.createTask({ ...(req.body || {}), type: 'webhook', context }, 'ciopen.webhook', true);
    res.status(202).json({ context, task: taskSummary(task) });
  });

  app.get('/ci/monitor', ciRateLimiter, (req, res) => {
    res.redirect('/ci-monitor.html');
  });

  if (options.startWorker) orchestrator.startWorker(options.workerIntervalMs);
  app.locals.ciOrchestrator = orchestrator;
  return app;
}

if (require.main === module) {
  const app = createApp({ startWorker: true });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Ci Contact Kernel listening on port ${port}`);
  });
}

module.exports = { createApp, taskSummary, createSimpleRateLimiter };
