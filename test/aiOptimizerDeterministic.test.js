/**
 * SQL Server Refactoring & Performance Studio
 * AI Optimizer Deterministic Engine Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  PERFORMANCE_THRESHOLDS,
  isMeaningfulChange,
  evaluateStrongSafeImprovement,
  evaluateBenchmarkSafety
} = require('../server/services/aiOptimizer/performanceThresholds');

const { detectNoOpRewrite } = require('../server/services/aiOptimizer/noOpDetector');
const { detectPlanEquality } = require('../server/services/aiOptimizer/planEqualityDetector');
const { classifyRootCause } = require('../server/services/aiOptimizer/rootCauseClassifier');
const { OPTIMIZER_FIXTURES } = require('./fixtures/optimizerFixtures');
const astParser = require('../server/services/ast/astParser');
const astAnalyzer = require('../server/services/ast/astAnalyzer');

describe('AI Optimizer Phase 1 — Deterministic Engines Test Suite', () => {

  // =========================================================================
  // 1. Performance Thresholds & Load Guard
  // =========================================================================
  describe('Performance Thresholds & Noise Bands', () => {
    it('isMeaningfulChange respects metric-specific noise bands and absolute floors', () => {
      // Logical reads: 5% relative, 50 pages absolute floor
      assert.strictEqual(isMeaningfulChange('logicalReads', 1000, 1020), false, '2% delta is noise');
      assert.strictEqual(isMeaningfulChange('logicalReads', 1000, 1080), true, '8% delta is meaningful');
      assert.strictEqual(isMeaningfulChange('logicalReads', 10, 30), false, '20 pages is below 50 absolute floor');
      assert.strictEqual(isMeaningfulChange('logicalReads', 100, 200), true, '100 pages is above floor');

      // CPU ms: 10% relative, 15ms absolute floor
      assert.strictEqual(isMeaningfulChange('cpuMs', 100, 105), false, '5ms is below 15ms floor');
      assert.strictEqual(isMeaningfulChange('cpuMs', 100, 125), true, '25ms / 25% is meaningful');

      // Duration ms: 10% relative, 25ms absolute floor
      assert.strictEqual(isMeaningfulChange('durationMs', 200, 215), false, '15ms is below 25ms floor');
      assert.strictEqual(isMeaningfulChange('durationMs', 200, 260), true, '60ms / 30% is meaningful');
    });

    it('evaluateStrongSafeImprovement evaluates multi-metric combinations', () => {
      // 1. High Read Reduction (>= 20%)
      const res1 = evaluateStrongSafeImprovement({
        validation: { status: 'PASS' },
        benchmarkComparison: {
          isRowCountEqual: true,
          improvements: { readsPercent: 25, cpuPercent: 5, durationPercent: 10 }
        },
        planComparison: { changes: [{ code: 'INDEX_SEEK_ADDED', significance: 'POSITIVE' }] },
        addressedFindings: ['F01']
      });
      assert.strictEqual(res1.isStrong, true);

      // 2. Balanced (Reads >= 15% AND CPU >= 15%)
      const res2 = evaluateStrongSafeImprovement({
        validation: { status: 'PASS' },
        benchmarkComparison: {
          isRowCountEqual: true,
          improvements: { readsPercent: 16, cpuPercent: 18, durationPercent: 5 }
        },
        planComparison: { changes: [{ code: 'TABLE_SCAN_REDUCED', significance: 'POSITIVE' }] },
        addressedFindings: ['F01']
      });
      assert.strictEqual(res2.isStrong, true);

      // 3. Rejects when TempDB Spill is added
      const res3 = evaluateStrongSafeImprovement({
        validation: { status: 'PASS' },
        benchmarkComparison: {
          isRowCountEqual: true,
          improvements: { readsPercent: 30, cpuPercent: 20, durationPercent: 20 }
        },
        planComparison: { changes: [{ code: 'TEMPDB_SPILL_ADDED', significance: 'NEGATIVE' }] },
        addressedFindings: ['F01']
      });
      assert.strictEqual(res3.isStrong, false);
      assert.ok(res3.reason.includes('TempDB Spill'));

      // 4. Rejects when reads regress
      const res4 = evaluateStrongSafeImprovement({
        validation: { status: 'PASS' },
        benchmarkComparison: {
          isRowCountEqual: true,
          improvements: { readsPercent: -15, cpuPercent: 10, durationPercent: 25 }
        },
        planComparison: { changes: [] },
        addressedFindings: ['F01']
      });
      assert.strictEqual(res4.isStrong, false);
      assert.ok(res4.reason.includes('regresyonu'));
    });

    it('evaluateBenchmarkSafety identifies heavy vs safe queries (Iterative Load Guard)', () => {
      // Safe query
      const safe = evaluateBenchmarkSafety({
        estimatedPlan: { totalSubTreeCost: 2.5 },
        queryStoreSummary: { avgDurationMs: 150 },
        tableRowsApprox: { STOKLAR: 50000 }
      });
      assert.strictEqual(safe.safetyLevel, 'SAFE');
      assert.strictEqual(safe.canAutoExecute, true);
      assert.strictEqual(safe.allowedRunsPerIteration, 6);

      // Heavy query requiring confirmation
      const heavy = evaluateBenchmarkSafety({
        estimatedPlan: { totalSubTreeCost: 120.0 },
        queryStoreSummary: { avgDurationMs: 15000 },
        tableRowsApprox: { STOK_HAREKETLERI: 12000000 }
      });
      assert.strictEqual(heavy.safetyLevel, 'REQUIRES_USER_CONFIRMATION');
      assert.strictEqual(heavy.canAutoExecute, false);
      assert.strictEqual(heavy.allowedRunsPerIteration, 0);
    });
  });

  // =========================================================================
  // 2. Conservative No-Op Candidate Detector
  // =========================================================================
  describe('No-Op Candidate Detector', () => {
    it('detects literal and whitespace-only rewrites as NO_MEANINGFUL_REWRITE', () => {
      const fix = OPTIMIZER_FIXTURES.nonSargableDate;
      const res1 = detectNoOpRewrite({
        originalSql: fix.sql,
        candidateSql: fix.sql
      });
      assert.strictEqual(res1.status, 'NO_MEANINGFUL_REWRITE');
      assert.strictEqual(res1.isMeaningful, false);
      assert.strictEqual(res1.classification, 'COSMETIC_REWRITE');

      const res2 = detectNoOpRewrite({
        originalSql: fix.sql,
        candidateSql: fix.sql.replace(/\s+/g, ' ') + '  -- harmless comment\n'
      });
      assert.strictEqual(res2.status, 'NO_MEANINGFUL_REWRITE');
      assert.strictEqual(res2.isMeaningful, false);
      assert.strictEqual(res2.classification, 'COSMETIC_REWRITE');
    });

    it('detects alias-only cosmetic rename on Fixture 1 as NO_MEANINGFUL_REWRITE', () => {
      const fix = OPTIMIZER_FIXTURES.nonSargableDate;
      const res = detectNoOpRewrite({
        originalSql: fix.sql,
        candidateSql: fix.cosmeticCandidateSql
      });
      assert.strictEqual(res.status, 'NO_MEANINGFUL_REWRITE');
      assert.strictEqual(res.isMeaningful, false);
      assert.strictEqual(res.classification, 'COSMETIC_REWRITE');
    });

    it('detects SARGable range transformation as MEANINGFUL_REWRITE / ACCESS_PATH_IMPROVEMENT', () => {
      const fix = OPTIMIZER_FIXTURES.nonSargableDate;
      const res = detectNoOpRewrite({
        originalSql: fix.sql,
        candidateSql: fix.structuralCandidateSql
      });
      assert.strictEqual(res.status, 'MEANINGFUL_REWRITE');
      assert.strictEqual(res.isMeaningful, true);
      assert.strictEqual(res.classification, 'ACCESS_PATH_IMPROVEMENT');
    });

    it('detects correlated subquery pre-aggregation as MEANINGFUL_REWRITE / STRUCTURAL_REWRITE', () => {
      const fix = OPTIMIZER_FIXTURES.correlatedScalarSubquery;
      const res = detectNoOpRewrite({
        originalSql: fix.sql,
        candidateSql: fix.structuralCandidateSql
      });
      assert.strictEqual(res.status, 'MEANINGFUL_REWRITE');
      assert.strictEqual(res.isMeaningful, true);
      assert.strictEqual(res.classification, 'STRUCTURAL_REWRITE');
    });
  });

  // =========================================================================
  // 3. Plan Equality Detector
  // =========================================================================
  describe('Plan Equality Detector', () => {
    it('detects identical plan structure and noise band metrics as NO_MEANINGFUL_PLAN_CHANGE', () => {
      const origPlan = {
        totalSubTreeCost: 1.45,
        operators: [
          { isScan: true, targetObject: 'STOKLAR' },
          { isSeek: false, category: 'JOIN', physicalOp: 'Nested Loops' }
        ],
        warnings: []
      };
      const candPlan = {
        totalSubTreeCost: 1.42, // Minor estimated cost delta (cost drops 2%)
        operators: [
          { isScan: true, targetObject: 'STOKLAR' },
          { isSeek: false, category: 'JOIN', physicalOp: 'Nested Loops' }
        ],
        warnings: []
      };

      const res = detectPlanEquality({
        originalPlan: origPlan,
        candidatePlan: candPlan,
        measuredMetrics: {
          origReads: 1000,
          candReads: 1010, // 1% difference, within noise band
          origCpu: 50,
          candCpu: 52,
          origDuration: 120,
          candDuration: 118
        }
      });

      assert.strictEqual(res.status, 'NO_MEANINGFUL_PLAN_CHANGE');
      assert.strictEqual(res.isMeaningfulChange, false);
      assert.strictEqual(res.isStructurallyIdentical, true);
      assert.ok(res.costNote.includes('Tahmini maliyet ölçülmüş performans kanıtı yerine geçmez'));
    });

    it('detects operator change (Scan -> Seek) as MEANINGFUL_PLAN_CHANGE', () => {
      const origPlan = {
        totalSubTreeCost: 2.5,
        operators: [{ isScan: true, targetObject: 'STOKLAR' }],
        warnings: []
      };
      const candPlan = {
        totalSubTreeCost: 0.8,
        operators: [{ isSeek: true, targetObject: 'STOKLAR' }],
        warnings: []
      };

      const res = detectPlanEquality({
        originalPlan: origPlan,
        candidatePlan: candPlan
      });

      assert.strictEqual(res.status, 'MEANINGFUL_PLAN_CHANGE');
      assert.strictEqual(res.isMeaningfulChange, true);
      assert.strictEqual(res.isStructurallyIdentical, false);
    });
  });

  // =========================================================================
  // 4. Deterministic Root Cause Classifier
  // =========================================================================
  describe('Deterministic Root Cause Classifier (Multi-Cause Architecture)', () => {
    it('classifies nonSargableDate as QUERY_SHAPE with contributing INDEX_ACCESS', () => {
      const fix = OPTIMIZER_FIXTURES.nonSargableDate;
      const ast = astParser.parseSql(fix.sql);
      const analysis = astAnalyzer.analyzeAst(ast);

      const res = classifyRootCause({
        sql: fix.sql,
        ast,
        astAnalysis: analysis,
        estimatedPlan: {
          operators: [{ isScan: true, targetObject: 'STOK_HAREKETLERI' }]
        },
        indexCoverage: [{ status: 'NONE' }],
        missingIndexes: [{ table: 'STOK_HAREKETLERI', columns: ['sth_tarih'] }]
      });

      assert.strictEqual(res.primaryCause, 'QUERY_SHAPE');
      assert.ok(res.contributingCauses.includes('INDEX_ACCESS'));
      assert.strictEqual(res.suggestedStatus, 'CANDIDATE_GENERATED');
    });

    it('classifies missingIndexOnly as INDEX_ACCESS -> NEEDS_INDEX_CHANGE (Cautious rule)', () => {
      const fix = OPTIMIZER_FIXTURES.missingIndexOnly;
      const ast = astParser.parseSql(fix.sql);
      const analysis = astAnalyzer.analyzeAst(ast);

      const res = classifyRootCause({
        sql: fix.sql,
        ast,
        astAnalysis: analysis, // Zero structural SARG findings
        estimatedPlan: {
          operators: [{ isScan: true, targetObject: 'STOKLAR' }],
          missingIndexes: [{ table: 'STOKLAR', equalityColumns: ['sto_ozelkod1'] }]
        },
        indexCoverage: [{ status: 'NONE' }]
      });

      assert.strictEqual(res.primaryCause, 'INDEX_ACCESS');
      assert.strictEqual(res.suggestedStatus, 'NEEDS_INDEX_CHANGE');
      assert.ok(res.reasons.some(r => r.includes('Sorgu yapısı zaten SARGable')));
    });

    it('classifies functionOnJoin with collation caution as INSUFFICIENT_EVIDENCE when collation unknown', () => {
      const fix = OPTIMIZER_FIXTURES.functionOnJoin;
      const ast = astParser.parseSql(fix.sql);
      const analysis = astAnalyzer.analyzeAst(ast);

      const res = classifyRootCause({
        sql: fix.sql,
        ast,
        astAnalysis: analysis,
        hasCollationEvidence: false
      });

      assert.ok(res.reasons.some(r => r.includes('collation kanıtı olmadan')));
    });

    it('classifies statisticsDriven with 100x mismatch as STATISTICS -> NEEDS_STATISTICS_ATTENTION', () => {
      const fix = OPTIMIZER_FIXTURES.statisticsDriven;
      const ast = astParser.parseSql(fix.sql);
      const analysis = astAnalyzer.analyzeAst(ast);

      const res = classifyRootCause({
        sql: fix.sql,
        ast,
        astAnalysis: analysis,
        estimatedPlan: {
          operators: [{ isScan: false }],
          cardinalityMismatches: [{ mismatchFactor: 120 }]
        }
      });

      assert.strictEqual(res.primaryCause, 'STATISTICS');
      assert.strictEqual(res.suggestedStatus, 'NEEDS_STATISTICS_ATTENTION');
    });

    it('classifies alreadyOptimizedQuery as NO_SAFE_OPTIMIZATION_FOUND', () => {
      const fix = OPTIMIZER_FIXTURES.alreadyOptimizedQuery;
      const ast = astParser.parseSql(fix.sql);
      const analysis = astAnalyzer.analyzeAst(ast);

      const res = classifyRootCause({
        sql: fix.sql,
        ast,
        astAnalysis: analysis,
        estimatedPlan: {
          operators: [{ isScan: false, isSeek: true, targetObject: 'STOKLAR' }]
        }
      });

      assert.strictEqual(res.suggestedStatus, 'NO_SAFE_OPTIMIZATION_FOUND');
    });
  });

});
