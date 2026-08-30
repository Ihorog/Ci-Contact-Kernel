'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MemoryNavigator } = require('../src/memoryNavigator');
const { applyConflictPolicy } = require('../src/memoryPolicy');
const { TEMPORAL_LAYER, TRUTH_STATUS } = require('../src/cigraph/registry');

function makeNavigator(records) {
  return new MemoryNavigator({ buffer: records });
}

test('findByCiId returns matching records', () => {
  const navigator = makeNavigator([{ ci_id: 'ci-1' }, { ci_id: 'ci-2' }, { ci_id: 'ci-1', state: 'ACTIVE' }]);
  assert.equal(navigator.findByCiId('ci-1').length, 2);
});

test('traverseRelations finds connected records up to maxDepth', () => {
  const navigator = makeNavigator([
    { from_ci_id: 'ci-1', to_ci_id: 'ci-2', relation_type: 'CONNECTED_TO' },
    { from_ci_id: 'ci-2', to_ci_id: 'ci-3', relation_type: 'CONNECTED_TO' },
    { from_ci_id: 'ci-3', to_ci_id: 'ci-4', relation_type: 'CONNECTED_TO' }
  ]);
  const traversed = navigator.traverseRelations('ci-1', 'CONNECTED_TO', 2);
  assert.equal(traversed.length, 2);
});

test('Conflicting claims surfaced without overwrite', () => {
  const records = [
    { ci_id: 'ci-1', predicate: 'state', object_value: 'ON', truth_status: TRUTH_STATUS.OBSERVED, temporal_layer: TEMPORAL_LAYER.ACTUAL },
    { ci_id: 'ci-1', predicate: 'state', object_value: 'OFF', truth_status: TRUTH_STATUS.CLAIMED, temporal_layer: TEMPORAL_LAYER.ACTUAL }
  ];
  const result = applyConflictPolicy(records);
  assert.equal(result.records.length, 2);
  assert.equal(result.conflicts.length, 1);
});

test('shouldTriggerTraversal returns true only for explicit reasons', () => {
  const navigator = makeNavigator([]);
  assert.equal(navigator.shouldTriggerTraversal({ unresolvedEntity: true }).trigger, true);
  assert.equal(navigator.shouldTriggerTraversal({ random: true }).trigger, false);
});

test('PREDICTED/TARGET never promoted over ACTUAL', () => {
  const records = [
    { ci_id: 'ci-1', predicate: 'status', object_value: 'planned', temporal_layer: TEMPORAL_LAYER.TARGET, truth_status: TRUTH_STATUS.CANDIDATE },
    { ci_id: 'ci-1', predicate: 'status', object_value: 'live', temporal_layer: TEMPORAL_LAYER.ACTUAL, truth_status: TRUTH_STATUS.OBSERVED },
    { ci_id: 'ci-1', predicate: 'status', object_value: 'forecast', temporal_layer: TEMPORAL_LAYER.PREDICTED, truth_status: TRUTH_STATUS.CANDIDATE }
  ];
  const result = applyConflictPolicy(records);
  assert.equal(result.records[0].temporal_layer, TEMPORAL_LAYER.ACTUAL);
});
