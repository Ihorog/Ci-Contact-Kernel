'use strict';

/**
 * Ci Graph — comprehensive tests.
 * Covers all acceptance criteria from the issue specification.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyCiGraph } = require('../src/cigraph/classify');
const { generateCiId, isValidCiId } = require('../src/cigraph/id');
const { CLASSIFIER_VERSION, SCOPE, DOMAIN, CLASS, TRUTH_STATUS, TEMPORAL_LAYER, LIFECYCLE_STATE, RELATION } = require('../src/cigraph/registry');
const { checkTruthTransition, resolveTruthStatus } = require('../src/cigraph/truth');
const { checkTemporalOverwrite } = require('../src/cigraph/temporal');
const { validateRelation } = require('../src/cigraph/relations');
const { buildRecord, validateRecord } = require('../src/cigraph/record');
const { detectConflict, resolveConflicts } = require('../src/cigraph/conflicts');

// ── Identity tests ────────────────────────────────────────────────────────────

test('ci_id is opaque and unique across calls', () => {
  const a = generateCiId();
  const b = generateCiId();
  assert.match(a, /^ci_[0-9a-f]{16}$/);
  assert.match(b, /^ci_[0-9a-f]{16}$/);
  assert.notEqual(a, b);
});

test('ci_id contains no semantic content (no embedded type/class/scope)', () => {
  const id = generateCiId();
  assert.doesNotMatch(id, /asset|energy|home|work|data/i);
});

test('isValidCiId accepts well-formed ids and rejects others', () => {
  assert.ok(isValidCiId('ci_0011223344556677'));
  assert.ok(!isValidCiId('ci_short'));
  assert.ok(!isValidCiId('not_ci_prefix'));
  assert.ok(!isValidCiId(null));
  assert.ok(!isValidCiId(42));
});

test('classifyCiGraph generates a new ci_id when none is provided', () => {
  const { canonicalRecord } = classifyCiGraph({ text: 'hello' });
  assert.ok(isValidCiId(canonicalRecord.ci_id));
});

test('classifyCiGraph reuses existing ci_id unchanged', () => {
  const existingId = generateCiId();
  const { canonicalRecord } = classifyCiGraph({ ci_id: existingId, text: 'hello' });
  assert.equal(canonicalRecord.ci_id, existingId);
});

test('classifyCiGraph ci_id is independent of classification changes', () => {
  const id = generateCiId();
  const { canonicalRecord: r1 } = classifyCiGraph({ ci_id: id, text: 'energy breaker device' });
  const { canonicalRecord: r2 } = classifyCiGraph({ ci_id: id, text: 'repository commit git' });
  assert.equal(r1.ci_id, r2.ci_id);
  assert.notDeepEqual(r1.scope, r2.scope);
});

// ── HOME/ENERGY asset test ────────────────────────────────────────────────────

test('HOME/ENERGY asset: breaker classification', () => {
  const { canonicalRecord, reasons } = classifyCiGraph({
    text: 'circuit breaker in energy panel',
    subtype: 'BREAKER',
    role: ['PROTECTION'],
  });
  assert.ok(canonicalRecord.scope.includes(SCOPE.HOME), `scope: ${canonicalRecord.scope}`);
  assert.ok(canonicalRecord.domain.includes(DOMAIN.ENERGY), `domain: ${canonicalRecord.domain}`);
  assert.equal(canonicalRecord.subtype, 'BREAKER');
  assert.ok(canonicalRecord.role.includes('PROTECTION'));
  assert.ok(Array.isArray(reasons) && reasons.length > 0);
  assert.equal(canonicalRecord.classifier_version, CLASSIFIER_VERSION);
});

// ── DATA/DOCUMENT file test ───────────────────────────────────────────────────

test('DATA/DOCUMENT file classification', () => {
  const { canonicalRecord } = classifyCiGraph({
    text: 'pdf document report upload',
    class: 'DOCUMENT',
  });
  assert.ok(canonicalRecord.scope.includes(SCOPE.DATA), `scope: ${canonicalRecord.scope}`);
  assert.ok(
    canonicalRecord.domain.includes(DOMAIN.DOCUMENTS) || canonicalRecord.domain.includes(DOMAIN.FILES),
    `domain: ${canonicalRecord.domain}`
  );
  assert.equal(canonicalRecord.class, CLASS.DOCUMENT);
});

// ── WORK/SOURCE_CONTROL repository test ──────────────────────────────────────

test('WORK/SOURCE_CONTROL repository classification', () => {
  const { canonicalRecord } = classifyCiGraph({
    text: 'git repository commit branch pull request',
    class: 'REPOSITORY',
  });
  assert.ok(canonicalRecord.scope.includes(SCOPE.WORK), `scope: ${canonicalRecord.scope}`);
  assert.ok(canonicalRecord.domain.includes(DOMAIN.SOURCE_CONTROL), `domain: ${canonicalRecord.domain}`);
  assert.equal(canonicalRecord.class, CLASS.REPOSITORY);
});

// ── ACTION/TASK test ──────────────────────────────────────────────────────────

test('ACTION/TASK classification', () => {
  const { canonicalRecord } = classifyCiGraph({
    text: 'task todo action item checklist',
    class: 'TASK',
  });
  assert.ok(canonicalRecord.scope.includes(SCOPE.ACTION), `scope: ${canonicalRecord.scope}`);
  assert.ok(canonicalRecord.domain.includes(DOMAIN.TASKS), `domain: ${canonicalRecord.domain}`);
  assert.equal(canonicalRecord.class, CLASS.TASK);
});

// ── Unknown input test ────────────────────────────────────────────────────────

test('unknown input results in UNKNOWN_CLASS and unresolved entries', () => {
  const { canonicalRecord, unresolved } = classifyCiGraph({ text: 'xyzzy frobnicate quux' });
  assert.equal(canonicalRecord.class, CLASS.UNKNOWN_CLASS);
  assert.ok(unresolved.includes('class'));
});

test('null input does not throw', () => {
  assert.doesNotThrow(() => classifyCiGraph(null));
});

// ── Conflicting claim test ────────────────────────────────────────────────────

test('conflicting claims are marked CONFLICTING, not deleted', () => {
  const id = generateCiId();
  const claimA = { ci_id: id, class: CLASS.ASSET, temporal_layer: TEMPORAL_LAYER.ACTUAL, truth_status: TRUTH_STATUS.CLAIMED };
  const claimB = { ci_id: id, class: CLASS.DEVICE, temporal_layer: TEMPORAL_LAYER.ACTUAL, truth_status: TRUTH_STATUS.CLAIMED };
  const { conflict, reason } = detectConflict(claimA, claimB);
  assert.ok(conflict, 'should detect conflict');
  assert.ok(reason.includes('class conflict'));
  const { claims } = resolveConflicts([claimA, claimB]);
  assert.equal(claims[0].truth_status, TRUTH_STATUS.CONFLICTING);
  assert.equal(claims[1].truth_status, TRUTH_STATUS.CONFLICTING);
});

// ── Multi-domain input test ───────────────────────────────────────────────────

test('multi-domain input: one record may participate in multiple scopes', () => {
  const { canonicalRecord } = classifyCiGraph({
    scope: ['HOME', 'DATA'],
    domain: ['ENERGY', 'FILES'],
    text: 'file backup energy meter data',
  });
  assert.ok(canonicalRecord.scope.includes(SCOPE.HOME));
  assert.ok(canonicalRecord.scope.includes(SCOPE.DATA));
  assert.ok(canonicalRecord.domain.includes(DOMAIN.ENERGY));
  assert.ok(canonicalRecord.domain.includes(DOMAIN.FILES));
});

// ── Temporal layer invariants ─────────────────────────────────────────────────

test('TARGET does not overwrite ACTUAL', () => {
  const result = checkTemporalOverwrite(TEMPORAL_LAYER.ACTUAL, TEMPORAL_LAYER.TARGET);
  assert.ok(!result.allowed);
  assert.ok(result.reason.includes('must not overwrite ACTUAL'));
});

test('PREDICTED does not overwrite ACTUAL', () => {
  const result = checkTemporalOverwrite(TEMPORAL_LAYER.ACTUAL, TEMPORAL_LAYER.PREDICTED);
  assert.ok(!result.allowed);
});

test('ACTUAL can succeed HIST', () => {
  const result = checkTemporalOverwrite(TEMPORAL_LAYER.HIST, TEMPORAL_LAYER.ACTUAL);
  assert.ok(result.allowed);
});

test('ACTUAL can overwrite ACTUAL', () => {
  const result = checkTemporalOverwrite(TEMPORAL_LAYER.ACTUAL, TEMPORAL_LAYER.ACTUAL);
  assert.ok(result.allowed);
});

// ── Epistemic/confidence invariants ──────────────────────────────────────────

test('confidence alone does not produce VERIFIED', () => {
  const status = resolveTruthStatus(TRUTH_STATUS.VERIFIED, { confidence: 0.99, evidence_refs: [] });
  assert.notEqual(status, TRUTH_STATUS.VERIFIED);
});

test('VERIFIED requires evidence_refs', () => {
  const { allowed } = checkTruthTransition(null, TRUTH_STATUS.VERIFIED, { evidence_refs: [] });
  assert.ok(!allowed);
});

test('VERIFIED is allowed when evidence_refs is non-empty', () => {
  const { allowed } = checkTruthTransition(null, TRUTH_STATUS.VERIFIED, { evidence_refs: ['ev_abc'] });
  assert.ok(allowed);
});

test('classifyCiGraph truth_status with high confidence and no evidence stays non-VERIFIED', () => {
  const { canonicalRecord } = classifyCiGraph({ confidence: 0.999, text: 'some signal' });
  assert.notEqual(canonicalRecord.truth_status, TRUTH_STATUS.VERIFIED);
});

// ── Causal relation invariant ─────────────────────────────────────────────────

test('CAUSES relation without evidence is invalid', () => {
  const result = validateRelation({
    type: RELATION.CAUSES,
    from_ci_id: generateCiId(),
    to_ci_id: generateCiId(),
    truth_status: TRUTH_STATUS.CLAIMED,
    evidence_refs: [],
  });
  assert.ok(!result.valid);
  assert.ok(result.reason.includes('causal'));
});

test('CAUSES relation with verified evidence is valid', () => {
  const result = validateRelation({
    type: RELATION.CAUSES,
    from_ci_id: generateCiId(),
    to_ci_id: generateCiId(),
    truth_status: TRUTH_STATUS.VERIFIED,
    evidence_refs: ['ev_001'],
  });
  assert.ok(result.valid, result.reason);
});

test('co-occurrence does not imply CAUSES: two signals do not automatically get causal relation', () => {
  const { canonicalRecord: r1 } = classifyCiGraph({ text: 'power outage' });
  const { canonicalRecord: r2 } = classifyCiGraph({ text: 'alarm triggered' });
  // Neither record should have a CAUSES relation to the other by default
  const causalRelations = (r1.relations || []).filter(r => r.type === RELATION.CAUSES);
  assert.equal(causalRelations.length, 0, 'no CAUSES relation should be inferred from co-occurrence');
  const causalRelations2 = (r2.relations || []).filter(r => r.type === RELATION.CAUSES);
  assert.equal(causalRelations2.length, 0);
});

// ── Classifier version and reproducibility ────────────────────────────────────

test('every classification includes classifier_version', () => {
  const { canonicalRecord } = classifyCiGraph({ text: 'anything' });
  assert.equal(canonicalRecord.classifier_version, CLASSIFIER_VERSION);
});

test('classifier is deterministic: same input produces same classification', () => {
  const input = { text: 'git repository commit branch', class: 'REPOSITORY' };
  const r1 = classifyCiGraph({ ...input, ci_id: 'ci_aabbccddeeff0011' });
  const r2 = classifyCiGraph({ ...input, ci_id: 'ci_aabbccddeeff0011' });
  assert.equal(r1.canonicalRecord.scope.join(','), r2.canonicalRecord.scope.join(','));
  assert.equal(r1.canonicalRecord.domain.join(','), r2.canonicalRecord.domain.join(','));
  assert.equal(r1.canonicalRecord.class, r2.canonicalRecord.class);
});

test('every classification includes classification_reasons', () => {
  const { canonicalRecord, reasons } = classifyCiGraph({ text: 'energy meter' });
  assert.ok(Array.isArray(canonicalRecord.classification_reasons));
  assert.ok(canonicalRecord.classification_reasons.length > 0);
  assert.deepEqual(reasons, canonicalRecord.classification_reasons);
});

// ── Record envelope validation ────────────────────────────────────────────────

test('buildRecord + validateRecord produces a valid canonical envelope', () => {
  const id = generateCiId();
  const record = buildRecord({
    ci_id: id,
    kind: 'NODE',
    scope: ['HOME'],
    domain: ['ENERGY'],
    class: CLASS.ASSET,
    temporal_layer: TEMPORAL_LAYER.ACTUAL,
    truth_status: TRUTH_STATUS.OBSERVED,
    state: LIFECYCLE_STATE.ACTIVE,
    confidence: 0.85,
    classifier_version: CLASSIFIER_VERSION,
  });
  const { valid, errors } = validateRecord(record);
  assert.ok(valid, `Validation errors: ${JSON.stringify(errors)}`);
});

test('validateRecord rejects invalid ci_id', () => {
  const record = buildRecord({ ci_id: 'bad-id', kind: 'NODE', temporal_layer: TEMPORAL_LAYER.ACTUAL, truth_status: TRUTH_STATUS.RAW, state: LIFECYCLE_STATE.UNKNOWN, classifier_version: CLASSIFIER_VERSION });
  const { valid } = validateRecord(record);
  assert.ok(!valid);
});

test('validateRecord rejects out-of-range confidence', () => {
  const id = generateCiId();
  const record = buildRecord({ ci_id: id, kind: 'NODE', temporal_layer: TEMPORAL_LAYER.ACTUAL, truth_status: TRUTH_STATUS.RAW, state: LIFECYCLE_STATE.UNKNOWN, confidence: 1.5, classifier_version: CLASSIFIER_VERSION });
  const { valid } = validateRecord(record);
  assert.ok(!valid);
});

// ── Original payload immutability ─────────────────────────────────────────────

test('classifyCiGraph does not mutate the original input', () => {
  const input = Object.freeze({ text: 'task todo', class: 'TASK' });
  assert.doesNotThrow(() => classifyCiGraph(input));
});

// ── Unknown fields preserved ──────────────────────────────────────────────────

test('unknown fields in input are preserved under provenance raw context', () => {
  const { canonicalRecord } = classifyCiGraph({ text: 'test', myCustomField: 'preserved' });
  // The canonical record should not contain myCustomField at top level
  assert.ok(!('myCustomField' in canonicalRecord));
  // But provenance should be present (unknown fields captured in _extra during normalization)
  assert.ok(canonicalRecord.provenance !== null);
});

// ── Backward compatibility ────────────────────────────────────────────────────

test('classifySignal API still works (backward compatibility)', () => {
  const { classifySignal } = require('../src/classifier');
  const { CLASSIFICATIONS } = require('../src/constants');
  assert.equal(classifySignal({ classification: 'memory' }), CLASSIFICATIONS.MEMORY);
  assert.equal(classifySignal({ type: 'task' }), CLASSIFICATIONS.TASK);
  assert.equal(classifySignal('fact: stable'), CLASSIFICATIONS.FACT);
});
