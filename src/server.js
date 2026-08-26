const path = require('node:path');
const express = require('express');
const { createKernel } = require('./ci/kernel');

function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const bucket = hits.get(key);

    if (!bucket || now > bucket.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests',
        retryAfterMs: bucket.resetAt - now
      });
      return;
    }

    bucket.count += 1;
    next();
  };
}

function createApp(options = {}) {
  const app = express();
  const kernel = createKernel(options);
  const memoryReadLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  app.post('/ci/signal', async (req, res) => {
    const response = await kernel.handleSignal(req.body, 'signal');
    res.json(response);
  });

  app.post('/ci/command', async (req, res) => {
    const response = await kernel.handleSignal(req.body, 'command');
    res.json(response);
  });

  app.post('/ciopen/webhook', async (req, res) => {
    const response = await kernel.handleSignal(req.body, 'webhook');
    res.json(response);
  });

  app.get('/ci/status', async (req, res) => {
    res.json(await kernel.getStatus());
  });

  app.get('/ci/memory', memoryReadLimiter, async (req, res) => {
    const parsedLimit = Number(req.query.limit);
    const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 200, 1000));
    res.json({ records: await kernel.getMemory(limit) });
  });

  app.get('/ci/widget', (req, res) => {
    res.redirect('/public/ci-widget.html');
  });

  app.get('/', (req, res) => {
    res.send('Ci Contact Kernel running. Visit /ci/widget for UI, /ci/status for state.');
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Ci Contact Kernel listening on http://localhost:${port}`);
  });
}

module.exports = { createApp };
