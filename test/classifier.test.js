const test = require('node:test');
const assert = require('node:assert/strict');

const { classifySignal } = require('../src/classifier');
const { CLASSIFICATIONS } = require('../src/constants');

test('classifySignal normalizes uppercase direct classifications', () => {
  assert.equal(
    classifySignal({ classification: 'MEMORY' }),
    CLASSIFICATIONS.MEMORY
  );
  assert.equal(
    classifySignal({ type: 'FACT' }),
    CLASSIFICATIONS.FACT
  );
});

test('classifySignal normalizes uppercase string signals', () => {
  assert.equal(classifySignal('Fact: system stable'), CLASSIFICATIONS.FACT);
  assert.equal(classifySignal('MEMORY reminder'), CLASSIFICATIONS.MEMORY);
});
