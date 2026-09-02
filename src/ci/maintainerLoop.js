'use strict';

/**
 * Ci Code Autonomous Maintainer Loop
 *
 * Implements canonical control plane loop:
 * DISCOVER → CLASSIFY → DEDUPLICATE → PRIORITIZE → PLAN MINIMAL Δ → AUTHORIZE
 * → EXECUTE → TEST → VERIFY → MERGE → OBSERVE → CONSOLIDATE EXPERIENCE
 */

const crypto = require('node:crypto');
const { EventIntake } = require('./eventIntake');
const { RepoRegistry } = require('./repoRegistry');
const { evaluateCapabilityAccess, CiCompletion } = require('./contracts');
const { evaluatePolicy } = require('./policy');

function now() {
  return new Date().toISOString();
}

class MaintainerLoop {
  constructor(opts = {}) {
    this.repoRegistry = opts.repoRegistry || new RepoRegistry();
    this.eventIntake = opts.eventIntake || new EventIntake({ repoRegistry: this.repoRegistry });
    this.ciCompletion = new CiCompletion();
    /** Execution log by correlation_id */
    this.executionLog = new Map();
    /** Compiled Ci-patterns (consolidated experience) */
    this.compiledPatterns = new Map();
    /** Fast-path decision cache: key -> { result, policy_version, schema_version } */
    this.fastPathCache = new Map();
    this.authorityLedger = new Map();
    /** Current policy/schema version for fast path invalidation */
    this.currentPolicyVersion = opts.policyVersion || 'v1.0.0';
  }

  approve(correlationId, approval = {}) {
    const workUnit = this.eventIntake.getWorkUnit(correlationId);
    if (!workUnit || approval.repository_id !== workUnit.repository_id ||
        !['R2', 'R3'].includes(approval.risk_class)) return null;
    const authority = {
      id: crypto.randomUUID(),
      source: 'server-ledger',
      approved: true,
      repository_id: workUnit.repository_id,
      risk_class: approval.risk_class
    };
    this.authorityLedger.set(authority.id, authority);
    return { ...authority };
  }

  /**
   * Run the full maintainer loop for an incoming event or work unit.
   */
  async run(eventPayload = {}, options = {}) {
    // Step 1: DISCOVER & Step 3: DEDUPLICATE via EventIntake
    const intakeResult = this.eventIntake.intake(eventPayload);
    const correlationId = intakeResult.correlation_id;

    if (intakeResult.duplicate) {
      const prevRecord = this.executionLog.get(correlationId);
      if (prevRecord && ['COMPLETED', 'RUNNING'].includes(prevRecord.status)) {
        return {
          status: 'DUPLICATE_SKIPPED',
          correlation_id: correlationId,
          work_unit: intakeResult.work_unit,
          previous_execution: prevRecord,
          reason: intakeResult.reason,
          actions_executed: 0
        };
      }
    }

    const workUnit = intakeResult.work_unit;

    // Step 2: CLASSIFY
    const repoConfig = this.repoRegistry.get(workUnit.repository_id) || {
      repository_id: workUnit.repository_id,
      risk_class: 'R1',
      maintainer_policy: { auto_merge_r1: true }
    };

    workUnit.status = 'CLASSIFIED';
    workUnit.risk_class = this.effectiveRisk(repoConfig, workUnit, eventPayload);

    // Fast-path cache check: verify policy version & scope
    const cacheKey = `${workUnit.repository_id}:${workUnit.work_type}:${workUnit.title}`;
    const cachedFastPath = this.fastPathCache.get(cacheKey);
    let usedFastPath = false;

    if (cachedFastPath) {
      if (cachedFastPath.policy_version !== this.currentPolicyVersion || cachedFastPath.repo_id !== workUnit.repository_id) {
        // Fast path invalidated due to policy change or cross-repo scope boundary
        this.fastPathCache.delete(cacheKey);
      } else if (!options.forceReevaluation) {
        usedFastPath = true;
      }
    }

    // Step 4: PRIORITIZE
    const priority = this.calculatePriority(workUnit);
    workUnit.priority = priority;

    // Step 5: PLAN MINIMAL Δ
    const plan = this.planMinimalDelta(workUnit, options);
    workUnit.plan = plan;

    // Step 6: AUTHORIZE
    const authorization = this.authorizeWork(workUnit, repoConfig, options);
    workUnit.authorization = authorization;

    if (!authorization.authorized) {
      workUnit.status = 'BLOCKED_AUTHORIZATION';
      const executionRecord = {
        correlation_id: correlationId,
        status: 'BLOCKED',
        reason: authorization.reason,
        authorization,
        completed_at: now()
      };
      this.executionLog.set(correlationId, executionRecord);
      return executionRecord;
    }

    // Step 7: EXECUTE
    this.executionLog.set(correlationId, { correlation_id: correlationId, status: 'RUNNING' });
    let executionResult;
    try {
      executionResult = this.executeDelta(workUnit, plan);
      workUnit.status = 'EXECUTED';
    } catch (err) {
      workUnit.status = 'EXECUTION_FAILED';
      const executionRecord = {
        correlation_id: correlationId,
        status: 'FAILED',
        error: `Kernel failure isolated: ${err.message}`,
        completed_at: now()
      };
      this.executionLog.set(correlationId, executionRecord);
      return executionRecord;
    }

    // Step 8: TEST
    const testResults = this.runTests(workUnit, plan, options);
    workUnit.testResults = testResults;

    // Self-modified instruction regression check
    if (workUnit.plan.isSelfModifiedInstruction && !testResults.passed) {
      workUnit.status = 'ROLLBACK_TRIGGERED';
      const rollbackRecord = {
        correlation_id: correlationId,
        status: 'ROLLED_BACK',
        reason: `Self-modified instruction introduced regression: ${testResults.reason}`,
        rollback: true,
        original_instruction_restored: true,
        completed_at: now()
      };
      this.executionLog.set(correlationId, rollbackRecord);
      return rollbackRecord;
    }

    // Step 9: VERIFY
    const observed = options.observed_execution || options.check_result || workUnit.payload.observed_execution ||
      workUnit.payload.check_result || null;
    const evidence = {
      final_sha: observed?.final_sha || observed?.sha || null,
      evidence_refs: observed?.evidence_refs || [],
      verified: observed?.verified === true,
      observed: !!observed
    };
    if (evidence.final_sha && evidence.final_sha === repoConfig.last_verified_sha) {
      evidence.verified = false;
    }

    const taskContract = this.ciCompletion.createTaskContract({
      id: correlationId,
      isSelfModifiedInstruction: plan.isSelfModifiedInstruction
    });
    const verification = this.ciCompletion.verifyTask(taskContract, { status: testResults.passed ? 'SUCCESS' : 'FAILED' }, evidence);
    workUnit.verification = verification;

    if (!verification.canComplete) {
      workUnit.status = 'VERIFICATION_FAILED';
      const record = {
        correlation_id: correlationId,
        status: 'VERIFICATION_FAILED',
        reason: verification.policyResult.reason,
        completed_at: now()
      };
      this.executionLog.set(correlationId, record);
      return record;
    }

    // Step 10: MERGE (if applicable)
    let mergeResult = { merged: false, reason: 'Not a mergeable PR' };
    if (workUnit.work_type === 'PULL_REQUEST' || workUnit.work_type === 'DEPENDENCY_UPDATE') {
      mergeResult = this.attemptMerge(workUnit, options);
      if (!mergeResult.merged) {
        workUnit.status = 'MERGE_BLOCKED';
        const record = {
          correlation_id: correlationId,
          status: 'MERGE_BLOCKED',
          reason: mergeResult.reason,
          completed_at: now()
        };
        this.executionLog.set(correlationId, record);
        return record;
      }
    }

    // Step 11: OBSERVE
    const finalSha = evidence.final_sha;
    this.repoRegistry.updateVerification(workUnit.repository_id, finalSha);

    // Step 12: CONSOLIDATE EXPERIENCE
    const pattern = this.consolidateExperience(workUnit, evidence);

    // Cache fast path for identical future operations within policy version
    this.fastPathCache.set(cacheKey, {
      policy_version: this.currentPolicyVersion,
      repo_id: workUnit.repository_id,
      result: 'SUCCESS'
    });

    const finalRecord = {
      correlation_id: correlationId,
      repository_id: workUnit.repository_id,
      status: 'COMPLETED',
      final_sha: finalSha,
      evidence,
      pattern_compiled: pattern.id,
      used_fast_path: usedFastPath,
      completed_at: now()
    };

    this.executionLog.set(correlationId, finalRecord);
    return finalRecord;
  }

  calculatePriority(workUnit) {
    if (workUnit.work_type === 'SECURITY_ALERT') return 'CRITICAL';
    if (workUnit.risk_class === 'R3') return 'HIGH';
    if (workUnit.risk_class === 'R2') return 'MEDIUM';
    return 'LOW';
  }

  effectiveRisk(repoConfig, workUnit, payload) {
    const order = { R0: 0, R1: 1, R2: 2, R3: 3 };
    const max = [repoConfig.risk_class, payload.risk_class,
      workUnit.work_type === 'SECURITY_ALERT' ? 'R3' : null,
      payload.observed_side_effects?.risk_class,
      payload.observed_side_effects?.destructive ? 'R3' : null]
      .filter((risk) => risk && order[risk] !== undefined)
      .reduce((highest, risk) => order[risk] > order[highest] ? risk : highest, 'R0');
    return max;
  }

  planMinimalDelta(workUnit, options = {}) {
    const isSelfModifiedInstruction = options.isSelfModifiedInstruction || workUnit.payload.is_self_modified || false;
    return {
      delta_id: `delta-${crypto.randomUUID().slice(0, 8)}`,
      scope: workUnit.repository_id,
      files: options.files || ['src/change.js'],
      isSelfModifiedInstruction,
      description: `Minimal delta for ${workUnit.title}`
    };
  }

  authorizeWork(workUnit, repoConfig, options = {}) {
    const riskClass = workUnit.risk_class;

    // Cross-repo authority restriction: experience/credentials from repo A cannot authorize repo B
    if (options.source_repo_experience && options.source_repo_experience !== workUnit.repository_id) {
      return {
        authorized: false,
        reason: `Cross-repository authority violation: experience from ${options.source_repo_experience} cannot authorize ${workUnit.repository_id}`
      };
    }

    // Stale experience check
    if (options.staleExperience) {
      return {
        authorized: false,
        reason: 'Stale experience invalidated authority fast-path.'
      };
    }

    // R0: Read/Observe -> Autonomous
    if (riskClass === 'R0') {
      return { authorized: true, level: 'R0', reason: 'R0 autonomous read allowed.' };
    }

    // R1: Low Impact -> Autonomous after tests
    if (riskClass === 'R1') {
      return { authorized: true, level: 'R1', reason: 'R1 autonomous low-impact allowed.' };
    }

    // R2: Meaningful write -> Allowed if maintainer policy explicitly allows R2, else gated
    if (riskClass === 'R2') {
      if (repoConfig.maintainer_policy?.auto_merge_r2 && this.hasServerAuthority(options, workUnit, 'R2')) {
        return { authorized: true, level: 'R2', reason: 'R2 allowed by repository maintainer policy.' };
      }
      if (this.hasServerAuthority(options, workUnit, 'R2')) {
        return { authorized: true, level: 'R2', reason: 'R2 explicit user approval granted.' };
      }
      return {
        authorized: false,
        level: 'R2',
        requiresApproval: true,
        reason: `R2 write action requires repository policy or user approval for ${workUnit.repository_id}`
      };
    }

    // R3: Critical / Production / Finance / Credentials / Legal / Permissions -> ALWAYS GATED
    if (riskClass === 'R3') {
      if (this.hasServerAuthority(options, workUnit, 'R3')) {
        return { authorized: true, level: 'R3', reason: 'R3 explicit authorization granted.' };
      }

      return {
        authorized: false,
        level: 'R3',
        requiresApproval: true,
        externalGate: 'EXTERNAL_GATE_CROSS_REPO_PERMISSIONS',
        reason: `R3 critical operation on ${workUnit.repository_id} requires explicit owner authorization.`
      };
    }

    return { authorized: false, reason: 'Unknown risk class.' };
  }

  hasServerAuthority(options, workUnit, level) {
    const authority = options.authority;
    const recorded = authority?.id && this.authorityLedger.get(authority.id);
    return !!(recorded &&
      authority.source === 'server-ledger' &&
      authority.approved === true &&
      recorded.repository_id === workUnit.repository_id &&
      (!recorded.risk_class || ({ R0: 0, R1: 1, R2: 2, R3: 3 }[recorded.risk_class] || 0) >=
        ({ R0: 0, R1: 1, R2: 2, R3: 3 }[level] || 0)));
  }

  executeDelta(workUnit, plan) {
    if (workUnit.payload.simulate_kernel_error) {
      throw new Error('Simulated Kernel execution failure');
    }
    return { status: 'EXECUTED', summary: `Applied delta ${plan.delta_id}` };
  }

  runTests(workUnit, plan, options = {}) {
    if (options.simulateTestFailure || workUnit.payload.simulate_test_failure) {
      return { passed: false, reason: 'Test suite failed with errors.' };
    }
    return { passed: true, reason: 'All unit and verification tests passed.' };
  }

  attemptMerge(workUnit, options = {}) {
    if (options.hasUnresolvedReview || workUnit.payload.has_unresolved_review) {
      return { merged: false, reason: 'Unresolved review comments present.' };
    }
    if (options.hasMergeConflict || workUnit.payload.has_merge_conflict) {
      return { merged: false, reason: 'Merge conflict detected on target branch.' };
    }
    if (options.aiProposalUnverified || workUnit.payload.ai_proposal_unverified) {
      return { merged: false, reason: 'AI proposal has not passed mechanical verification.' };
    }
    return { merged: true, reason: 'PR clean, verified, and merged successfully.' };
  }

  consolidateExperience(workUnit, evidence) {
    const patternId = `pat-${crypto.createHash('sha256').update(`${workUnit.repository_id}:${workUnit.work_type}`).digest('hex').slice(0, 10)}`;
    const pattern = {
      id: patternId,
      repository_id: workUnit.repository_id,
      work_type: workUnit.work_type,
      evidence_sha: evidence.final_sha,
      compiled_at: now()
    };
    this.compiledPatterns.set(patternId, pattern);
    return pattern;
  }
}

module.exports = { MaintainerLoop };
