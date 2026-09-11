const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKSPACE_STATUS,
  CANDIDATE_STATUS,
  EVIDENCE_STATE,
  normalizeSqlForHashing,
  computeSqlHash,
  canTransitionWorkspace,
  evaluateEvidenceFreshness,
  shouldInvalidateApprovalOnMutation
} = require('../server/services/workspaceLifecycle');

describe('Workspace Lifecycle & Evidence Freshness Engine Tests (Sprint 6)', () => {
  describe('SQL Normalization & Hash Calculation', () => {
    it('normalizes CRLF and whitespace deterministically', () => {
      const sql1 = '  SELECT * \r\n FROM dbo.T1 \r\n ';
      const sql2 = 'SELECT * \n FROM dbo.T1';
      assert.equal(normalizeSqlForHashing(sql1), normalizeSqlForHashing(sql2));
      assert.equal(computeSqlHash(sql1), computeSqlHash(sql2));
    });

    it('produces distinct hashes for semantically different queries', () => {
      const hashA = computeSqlHash('SELECT col1 FROM dbo.T');
      const hashB = computeSqlHash('SELECT col2 FROM dbo.T');
      assert.notEqual(hashA, hashB);
    });
  });

  describe('Deterministic Workspace Status Transitions', () => {
    it('allows DRAFT -> ANALYZED transition', () => {
      const res = canTransitionWorkspace(WORKSPACE_STATUS.DRAFT, WORKSPACE_STATUS.ANALYZED);
      assert.equal(res.allowed, true);
    });

    it('allows ANALYZED -> CANDIDATE_GENERATED transition', () => {
      const res = canTransitionWorkspace(WORKSPACE_STATUS.ANALYZED, WORKSPACE_STATUS.CANDIDATE_GENERATED);
      assert.equal(res.allowed, true);
    });

    it('allows CANDIDATE_GENERATED -> VALIDATED only when verdict is PASS or PASS_WITH_WARNING', () => {
      const passRes = canTransitionWorkspace(WORKSPACE_STATUS.CANDIDATE_GENERATED, WORKSPACE_STATUS.VALIDATED, {
        validationVerdict: 'PASS'
      });
      assert.equal(passRes.allowed, true);

      const warnRes = canTransitionWorkspace(WORKSPACE_STATUS.CANDIDATE_GENERATED, WORKSPACE_STATUS.VALIDATED, {
        validationVerdict: 'PASS_WITH_WARNING'
      });
      assert.equal(warnRes.allowed, true);

      const failRes = canTransitionWorkspace(WORKSPACE_STATUS.CANDIDATE_GENERATED, WORKSPACE_STATUS.VALIDATED, {
        validationVerdict: 'FAIL'
      });
      assert.equal(failRes.allowed, false);
      assert.ok(failRes.reason.includes('FAIL olan aday'));
    });

    it('allows VALIDATED -> BENCHMARKED only when benchmark evidence exists', () => {
      const hasBmRes = canTransitionWorkspace(WORKSPACE_STATUS.VALIDATED, WORKSPACE_STATUS.BENCHMARKED, {
        hasBenchmark: true
      });
      assert.equal(hasBmRes.allowed, true);

      const noBmRes = canTransitionWorkspace(WORKSPACE_STATUS.VALIDATED, WORKSPACE_STATUS.BENCHMARKED, {
        hasBenchmark: false
      });
      assert.equal(noBmRes.allowed, false);
    });

    it('STRICT GUARDRAIL: AI or automated process CANNOT approve candidate', () => {
      const aiApprove = canTransitionWorkspace(WORKSPACE_STATUS.BENCHMARKED, WORKSPACE_STATUS.APPROVED, {
        isAutomatedOrAi: true,
        validationVerdict: 'PASS'
      });
      assert.equal(aiApprove.allowed, false);
      assert.ok(aiApprove.reason.includes('Yapay zeka (AI) veya otomatik'));
    });

    it('allows human approval for validated/benchmarked candidate', () => {
      const humanApprove = canTransitionWorkspace(WORKSPACE_STATUS.BENCHMARKED, WORKSPACE_STATUS.APPROVED, {
        isAutomatedOrAi: false,
        validationVerdict: 'PASS',
        databaseDrift: false
      });
      assert.equal(humanApprove.allowed, true);
    });

    it('STRICT GUARDRAIL: FAIL validation can NEVER become APPROVED', () => {
      const failApprove = canTransitionWorkspace(WORKSPACE_STATUS.BENCHMARKED, WORKSPACE_STATUS.APPROVED, {
        isAutomatedOrAi: false,
        validationVerdict: 'FAIL'
      });
      assert.equal(failApprove.allowed, false);
      assert.ok(failApprove.reason.includes('FAIL olan aday ONAYLANAMAZ'));
    });

    it('blocks approval when database drift is detected unless explicitly overridden', () => {
      const driftBlocked = canTransitionWorkspace(WORKSPACE_STATUS.BENCHMARKED, WORKSPACE_STATUS.APPROVED, {
        isAutomatedOrAi: false,
        validationVerdict: 'PASS',
        databaseDrift: true,
        overrideDrift: false
      });
      assert.equal(driftBlocked.allowed, false);
      assert.ok(driftBlocked.reason.includes('Database Drift'));

      const driftOverridden = canTransitionWorkspace(WORKSPACE_STATUS.BENCHMARKED, WORKSPACE_STATUS.APPROVED, {
        isAutomatedOrAi: false,
        validationVerdict: 'PASS',
        databaseDrift: true,
        overrideDrift: true
      });
      assert.equal(driftOverridden.allowed, true);
    });

    it('allows APPROVED -> SCRIPT_GENERATED when script is generated', () => {
      const res = canTransitionWorkspace(WORKSPACE_STATUS.APPROVED, WORKSPACE_STATUS.SCRIPT_GENERATED);
      assert.equal(res.allowed, true);
    });

    it('blocks direct script generation from unapproved workspace', () => {
      const res = canTransitionWorkspace(WORKSPACE_STATUS.DRAFT, WORKSPACE_STATUS.SCRIPT_GENERATED, {
        allowDirectScript: false
      });
      assert.equal(res.allowed, false);
      assert.ok(res.reason.includes('ONAYLANMIŞ'));
    });

    it('allows archiving from any state', () => {
      assert.equal(canTransitionWorkspace(WORKSPACE_STATUS.DRAFT, WORKSPACE_STATUS.ARCHIVED).allowed, true);
      assert.equal(canTransitionWorkspace(WORKSPACE_STATUS.APPROVED, WORKSPACE_STATUS.ARCHIVED).allowed, true);
      assert.equal(canTransitionWorkspace(WORKSPACE_STATUS.BENCHMARKED, WORKSPACE_STATUS.ARCHIVED).allowed, true);
    });
  });

  describe('Evidence Freshness & Stale State Evaluation', () => {
    const originalSql = 'SELECT a, b FROM T1';
    const originalHash = computeSqlHash(originalSql);
    const candSql = 'SELECT a, b FROM T1 WHERE x = 1';
    const candHash = computeSqlHash(candSql);

    it('returns VALID when hashes and database match perfectly', () => {
      const res = evaluateEvidenceFreshness({
        originalSql,
        savedOriginalHash: originalHash,
        candidateSql: candSql,
        validationSnapshot: { candidateSqlHash: candHash },
        benchmarkSnapshot: { candidateSqlHash: candHash, originalSqlHash: originalHash },
        dbDriftDetected: false
      });
      assert.equal(res.state, EVIDENCE_STATE.VALID);
      assert.equal(res.candidateSqlChanged, false);
      assert.equal(res.originalSqlChanged, false);
    });

    it('flags STALE_CANDIDATE_CHANGED when candidate SQL is modified after validation', () => {
      const mutatedCandSql = 'SELECT a, b, c FROM T1 WHERE x = 1';
      const res = evaluateEvidenceFreshness({
        originalSql,
        savedOriginalHash: originalHash,
        candidateSql: mutatedCandSql,
        validationSnapshot: { candidateSqlHash: candHash }, // Old hash!
        dbDriftDetected: false
      });
      assert.equal(res.state, EVIDENCE_STATE.STALE_CANDIDATE_CHANGED);
      assert.equal(res.candidateSqlChanged, true);
      assert.ok(res.reasons[0].includes('Aday SQL değiştirildiğinden'));
    });

    it('flags STALE_ORIGINAL_CHANGED when original SQL changes', () => {
      const changedOriginalSql = 'SELECT a, b, c FROM T1';
      const res = evaluateEvidenceFreshness({
        originalSql: changedOriginalSql,
        savedOriginalHash: originalHash, // Old hash!
        candidateSql: candSql,
        dbDriftDetected: false
      });
      assert.equal(res.state, EVIDENCE_STATE.STALE_ORIGINAL_CHANGED);
      assert.equal(res.originalSqlChanged, true);
    });

    it('flags STALE_DATABASE_DRIFT when live DB has drifted', () => {
      const res = evaluateEvidenceFreshness({
        originalSql,
        savedOriginalHash: originalHash,
        candidateSql: candSql,
        dbDriftDetected: true
      });
      assert.equal(res.state, EVIDENCE_STATE.STALE_DATABASE_DRIFT);
      assert.ok(res.reasons.some(r => r.includes('Database Drift')));
    });
  });

  describe('Approval Invalidation on Mutation', () => {
    it('invalidates approval when candidate SQL changes', () => {
      const approvedCand = {
        id: 'c1',
        status: CANDIDATE_STATUS.APPROVED,
        sql: 'SELECT 1;',
        sqlHash: computeSqlHash('SELECT 1;')
      };
      const shouldInvalidate = shouldInvalidateApprovalOnMutation(approvedCand, 'SELECT 1, 2;');
      assert.equal(shouldInvalidate, true);
    });

    it('does NOT invalidate approval if identical SQL is resubmitted', () => {
      const approvedCand = {
        id: 'c1',
        status: CANDIDATE_STATUS.APPROVED,
        sql: 'SELECT 1;',
        sqlHash: computeSqlHash('SELECT 1;')
      };
      const shouldInvalidate = shouldInvalidateApprovalOnMutation(approvedCand, 'SELECT 1;\n');
      assert.equal(shouldInvalidate, false);
    });
  });
});
