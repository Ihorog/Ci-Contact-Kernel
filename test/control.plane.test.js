'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ControlPlaneRegistry, createUnit } = require('../src/ci/registry');
const { ControlPlaneObserver, OBSERVED_STATUS } = require('../src/ci/observer');
const { ControlPlaneReconciler, classifyDrift, DRIFT_STATUS } = require('../src/ci/reconciler');
const { evaluatePolicy, buildApprovalRequest, POLICY_DECISION, APPROVAL_CLASS } = require('../src/ci/policy');
const { ControlPlaneAudit, AUDIT_EVENT_TYPES } = require('../src/ci/audit');
const { ControlPlaneStatus } = require('../src/ci/status');
const { ResponsibilityGraph } = require('../src/ci/responsibilityGraph');

// ── Registry ──────────────────────────────────────────────────────────────────

test('Registry: register creates unit with stable id', () => {
  const reg = new ControlPlaneRegistry();
  const u = reg.register({ name: 'test-service', provider: 'github', type: 'service' });
  assert.ok(u.id, 'unit has id');
  assert.equal(u.provider, 'github');
  assert.equal(u.name, 'test-service');
  assert.equal(u.observed_status, 'unknown');
  assert.equal(u.desired_status, 'active');
});

test('Registry: findByProvider returns correct units', () => {
  const reg = new ControlPlaneRegistry();
  reg.register({ name: 'a', provider: 'github' });
  reg.register({ name: 'b', provider: 'vercel' });
  reg.register({ name: 'c', provider: 'github' });
  const gh = reg.findByProvider('github');
  assert.equal(gh.length, 2);
  assert.ok(gh.every((u) => u.provider === 'github'));
});

test('Registry: updateObserved updates observed_status', () => {
  const reg = new ControlPlaneRegistry();
  const u = reg.register({ name: 'svc', provider: 'github' });
  reg.updateObserved(u.id, { observed_status: 'healthy', last_verified_at: '2024-01-01T00:00:00Z' });
  const updated = reg.get(u.id);
  assert.equal(updated.observed_status, 'healthy');
  assert.equal(updated.last_verified_at, '2024-01-01T00:00:00Z');
});

test('Registry: listDrifted returns only drifted units', () => {
  const reg = new ControlPlaneRegistry();
  const u1 = reg.register({ name: 'a', provider: 'github' });
  const u2 = reg.register({ name: 'b', provider: 'github' });
  reg.updateObserved(u1.id, { drift_status: 'drift' });
  reg.updateObserved(u2.id, { drift_status: 'in_sync' });
  const drifted = reg.listDrifted();
  assert.equal(drifted.length, 1);
  assert.equal(drifted[0].id, u1.id);
});

test('Registry: createUnit never stores secret values', () => {
  const u = createUnit({ name: 'secret-test', credential_ref: 'env:MY_TOKEN' });
  const str = JSON.stringify(u);
  // credential_ref stores a reference, not a secret value
  assert.ok(str.includes('env:MY_TOKEN'), 'reference is stored');
  // Should not contain a raw token pattern (test guard)
  assert.ok(!str.includes('ghp_'), 'no raw GitHub token');
});

// ── Observer ──────────────────────────────────────────────────────────────────

test('Observer: observe with no adapter returns unknown status', async () => {
  const reg = new ControlPlaneRegistry();
  const u = reg.register({ name: 'no-adapter', provider: 'unknown_provider' });
  const obs = new ControlPlaneObserver(reg);
  const result = await obs.observeUnit(u.id);
  assert.equal(result.status, OBSERVED_STATUS.UNKNOWN);
});

test('Observer: observe with adapter updates registry', async () => {
  const reg = new ControlPlaneRegistry();
  const u = reg.register({ name: 'svc', provider: 'mock' });
  const obs = new ControlPlaneObserver(reg);
  obs.registerAdapter('mock', {
    async observe() {
      return { status: 'healthy', evidence: {}, version: '1.0' };
    }
  });
  await obs.observeUnit(u.id);
  const updated = reg.get(u.id);
  assert.equal(updated.observed_status, 'healthy');
});

test('Observer: failed adapter observe marks as degraded', async () => {
  const reg = new ControlPlaneRegistry();
  const u = reg.register({ name: 'failing-svc', provider: 'mock' });
  const obs = new ControlPlaneObserver(reg);
  obs.registerAdapter('mock', {
    async observe() { throw new Error('Connection refused'); }
  });
  const result = await obs.observeUnit(u.id);
  assert.equal(result.status, 'degraded');
  assert.ok(result.evidence.error.includes('Connection refused'));
});

// ── Reconciler ───────────────────────────────────────────────────────────────

test('Reconciler: classifyDrift returns in_sync when desired=active and observed=healthy', () => {
  const drift = classifyDrift({ desired_status: 'active', observed_status: 'healthy' });
  assert.equal(drift, DRIFT_STATUS.IN_SYNC);
});

test('Reconciler: classifyDrift returns drift when desired=active and observed=offline', () => {
  const drift = classifyDrift({ desired_status: 'active', observed_status: 'offline' });
  assert.equal(drift, DRIFT_STATUS.DRIFT);
});

test('Reconciler: classifyDrift returns degraded when observed=degraded', () => {
  const drift = classifyDrift({ desired_status: 'active', observed_status: 'degraded' });
  assert.equal(drift, DRIFT_STATUS.DEGRADED);
});

test('Reconciler: run produces diffs for unhealthy units', () => {
  const reg = new ControlPlaneRegistry();
  const u = reg.register({ name: 'svc', provider: 'github', observed_status: 'offline', desired_status: 'active' });
  const rec = new ControlPlaneReconciler(reg);
  const report = rec.run();
  assert.ok(report.diffs.length > 0, 'has diffs');
  assert.equal(report.diffs[0].unitId, u.id);
});

test('Reconciler: impact propagates from unhealthy dependency to dependent unit', () => {
  const reg = new ControlPlaneRegistry();
  const dep = reg.register({ name: 'dep', provider: 'github', observed_status: 'offline' });
  const downstream = reg.register({ name: 'downstream', provider: 'github', observed_status: 'healthy' });
  const rec = new ControlPlaneReconciler(reg);
  rec.addEdge(downstream.id, dep.id, 'depends_on');
  const report = rec.run();
  const impactedDiff = report.diffs.find((d) => d.unitId === downstream.id && d.drift_status === 'impacted');
  assert.ok(impactedDiff, 'downstream unit shows as impacted');
  assert.ok(impactedDiff.impacted_by.includes(dep.id));
});

test('Reconciler: addEdge rejects unknown relation types', () => {
  const reg = new ControlPlaneRegistry();
  const rec = new ControlPlaneReconciler(reg);
  assert.throws(() => rec.addEdge('a', 'b', 'unknown_relation'), /Unknown relation type/);
});

// ── Policy ────────────────────────────────────────────────────────────────────

test('Policy: observe action is always allowed', () => {
  const unit = createUnit({ name: 'svc', approval_class: 'critical' });
  const result = evaluatePolicy(unit, 'observe');
  assert.equal(result.decision, POLICY_DECISION.ALLOWED);
  assert.equal(result.requiresApproval, false);
});

test('Policy: delete action always requires approval', () => {
  const unit = createUnit({ name: 'svc', approval_class: 'low_risk' });
  const result = evaluatePolicy(unit, 'delete');
  assert.equal(result.decision, POLICY_DECISION.REQUIRES_APPROVAL);
  assert.equal(result.requiresApproval, true);
});

test('Policy: write on critical unit requires approval', () => {
  const unit = createUnit({ name: 'svc', approval_class: APPROVAL_CLASS.CRITICAL });
  const result = evaluatePolicy(unit, 'update_config');
  assert.equal(result.decision, POLICY_DECISION.REQUIRES_APPROVAL);
});

test('Policy: write on read_only unit is blocked', () => {
  const unit = createUnit({ name: 'svc', approval_class: APPROVAL_CLASS.READ_ONLY });
  const result = evaluatePolicy(unit, 'update_config');
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
});

test('Policy: null unit returns blocked', () => {
  const result = evaluatePolicy(null, 'observe');
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
});

test('Policy: buildApprovalRequest includes required fields', () => {
  const unit = createUnit({ name: 'svc', provider: 'github', approval_class: APPROVAL_CLASS.HIGH_RISK });
  const policyResult = { reason: 'test', approvalClass: APPROVAL_CLASS.HIGH_RISK };
  const req = buildApprovalRequest(unit, 'apply_write', policyResult, { requestedBy: 'operator' });
  assert.ok(req.requestId, 'has requestId');
  assert.equal(req.action, 'apply_write');
  assert.equal(req.status, 'pending');
  assert.equal(req.requestedBy, 'operator');
});

// ── Audit ─────────────────────────────────────────────────────────────────────

test('Audit: records are appended and retrievable', () => {
  const audit = new ControlPlaneAudit();
  audit.record(AUDIT_EVENT_TYPES.OBSERVE, 'unit-1', { status: 'healthy' });
  audit.record(AUDIT_EVENT_TYPES.DRIFT_DETECTED, 'unit-1', { drift_status: 'drift' });
  assert.equal(audit.size(), 2);
  const forUnit = audit.forUnit('unit-1');
  assert.equal(forUnit.length, 2);
});

test('Audit: records are never deleted (append-only)', () => {
  const audit = new ControlPlaneAudit();
  for (let i = 0; i < 5; i++) {
    audit.record(AUDIT_EVENT_TYPES.OBSERVE, `unit-${i}`, {});
  }
  const before = audit.size();
  // No delete method should exist
  assert.equal(typeof audit.delete, 'undefined');
  assert.equal(audit.size(), before);
});

// ── Status ────────────────────────────────────────────────────────────────────

test('Status: summary returns correct counts', () => {
  const reg = new ControlPlaneRegistry();
  reg.register({ name: 'a', provider: 'github', observed_status: 'healthy' });
  reg.register({ name: 'b', provider: 'github', observed_status: 'degraded' });
  reg.register({ name: 'c', provider: 'github', observed_status: 'unknown' });
  const rec = new ControlPlaneReconciler(reg);
  const audit = new ControlPlaneAudit();
  const status = new ControlPlaneStatus(reg, rec, audit);
  const s = status.summary();
  assert.equal(s.total_units, 3);
  assert.equal(s.healthy, 1);
  assert.equal(s.degraded, 1);
  assert.equal(s.unknown, 1);
});

// ── ResponsibilityGraph (integration) ────────────────────────────────────────

test('ResponsibilityGraph: registerUnit adds to registry', () => {
  const rg = new ResponsibilityGraph();
  const u = rg.registerUnit({ name: 'svc', provider: 'github' });
  assert.ok(u.id, 'unit registered');
  assert.equal(rg.registry.get(u.id).name, 'svc');
});

test('ResponsibilityGraph: policyGate blocks action on missing unit', () => {
  const rg = new ResponsibilityGraph();
  const result = rg.policyGate('nonexistent-id', 'delete');
  assert.equal(result.decision, POLICY_DECISION.BLOCKED);
});

test('ResponsibilityGraph: policyGate returns approvalRequest for sensitive action', () => {
  const rg = new ResponsibilityGraph();
  const u = rg.registerUnit({ name: 'svc', provider: 'github', approval_class: 'high_risk' });
  const result = rg.policyGate(u.id, 'delete');
  assert.equal(result.decision, POLICY_DECISION.REQUIRES_APPROVAL);
  assert.ok(result.approvalRequest, 'approvalRequest present');
  assert.equal(rg.listPendingApprovals().length, 1);
});

test('ResponsibilityGraph: approve + apply goes through policy', async () => {
  const rg = new ResponsibilityGraph();
  const u = rg.registerUnit({ name: 'svc', provider: 'github', approval_class: 'high_risk' });
  const gateResult = rg.policyGate(u.id, 'apply_write');
  const requestId = gateResult.approvalRequest.requestId;

  rg.approveRequest(requestId, 'operator');

  // Stub adapter that confirms apply
  const mockAdapter = { async apply() { return { applied: true, result: 'ok', version: '1.0' }; } };
  const applyResult = await rg.apply(u.id, 'apply_write', requestId, mockAdapter);
  assert.equal(applyResult.applied, true);
  // Approval should be consumed
  assert.equal(rg.listPendingApprovals().length, 0);
});

test('ResponsibilityGraph: apply blocked without approvalId', async () => {
  const rg = new ResponsibilityGraph();
  const u = rg.registerUnit({ name: 'svc', provider: 'github' });
  const mockAdapter = { async apply() { return { applied: true }; } };
  const result = await rg.apply(u.id, 'apply_write', 'nonexistent-approval', mockAdapter);
  assert.equal(result.applied, false);
  assert.ok(result.error.includes('blocked'));
});

test('ResponsibilityGraph: reject cancels pending approval', () => {
  const rg = new ResponsibilityGraph();
  const u = rg.registerUnit({ name: 'svc', provider: 'github', approval_class: 'high_risk' });
  const gate = rg.policyGate(u.id, 'delete');
  const requestId = gate.approvalRequest.requestId;
  rg.rejectRequest(requestId, 'user', 'Not authorized');
  assert.equal(rg.listPendingApprovals().length, 0);
});

test('ResponsibilityGraph: reconciliation cycle runs without errors', async () => {
  const rg = new ResponsibilityGraph();
  rg.registerUnit({ name: 'svc', provider: 'github' });
  const result = await rg.runReconciliationCycle();
  assert.ok(result.report, 'has report');
  assert.ok(result.status, 'has status');
  assert.ok(Array.isArray(result.observations));
});

test('ResponsibilityGraph: audit records control plane events', () => {
  const rg = new ResponsibilityGraph();
  const u = rg.registerUnit({ name: 'svc', provider: 'github', approval_class: 'high_risk' });
  rg.policyGate(u.id, 'delete');
  const records = rg.audit.forUnit(u.id);
  assert.ok(records.length >= 2, 'registration + policy decision recorded');
});
