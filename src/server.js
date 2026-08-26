const path = require('node:path');
const express = require('express');
const { createKernel } = require('./ci/kernel');

function createApp(options = {}) {
  const app = express();
  const kernel = createKernel(options);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  app.post('/ci/signal', (req, res) => {
    const response = kernel.handleSignal(req.body, 'signal');
    res.json(response);
  });

  app.post('/ci/command', (req, res) => {
    const response = kernel.handleSignal(req.body, 'command');
    res.json(response);
  });

  app.post('/ciopen/webhook', (req, res) => {
    const response = kernel.handleSignal(req.body, 'webhook');
    res.json(response);
  });

  app.get('/ci/status', (req, res) => {
    res.json(kernel.getStatus());
  });

  app.get('/ci/memory', (req, res) => {
    const limit = Number(req.query.limit) || 200;
    res.json({ records: kernel.getMemory(limit) });
  });

  app.get('/ci/widget', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'ci-widget.html'));
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
