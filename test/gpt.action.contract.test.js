'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const schemaPath = path.join(__dirname, '..', 'public', 'ci-plus-openapi.yaml');
const schema = fs.readFileSync(schemaPath, 'utf8');

test('Ci+ GPT Action facade targets canonical production host', () => {
  assert.match(schema, /https:\/\/ciplus\.cimeika\.com\.ua/);
});

test('Ci+ GPT Action facade exposes the four canonical operations', () => {
  for (const operationId of [
    'getCiStatus',
    'resolveCiContext',
    'executeCiOperation',
    'verifyCiResult',
  ]) {
    assert.match(schema, new RegExp(`operationId: ${operationId}\\b`));
  }
});

test('Ci+ GPT Action facade maps to existing fail-closed kernel routes', () => {
  for (const route of ['/ci/status:', '/ci/signal:', '/ci/task:', '/ci/task/{taskId}:']) {
    assert.ok(schema.includes(route), `missing route ${route}`);
  }
  assert.match(schema, /fail-closed/i);
});
