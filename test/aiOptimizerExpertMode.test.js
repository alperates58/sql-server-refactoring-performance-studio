/**
 * SQL Server Refactoring & Performance Studio
 * Expert SQL Rewrite Mode Test Suite (Sprint 10)
 *
 * Verifies:
 * 1. INDEX_ACCESS is no longer a hard stop when query shape findings exist.
 * 2. Cautious NEEDS_INDEX_CHANGE only when query is 100% structurally clean.
 * 3. Track B Query Shape Review detects repeated scans, non-SARGable predicates, late aggregations.
 * 4. Cosmetic rewrite ban & Structural Significance Scoring (0-5).
 * 5. Strategy diversity & duplicate strategy rejection.
 * 6. Combined SQL_REWRITE_VALID_BUT_INDEX_REQUIRED status.
 * 7. MEASURED_IMPROVEMENT status.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { classifyRootCause } = require('../server/services/aiOptimizer/rootCauseClassifier');
const { reviewQueryShape } = require('../server/services/aiOptimizer/queryShapeReview');
const {
  detectNoOpRewrite,
  calculateSignificanceScore,
  generateQueryShapeDiffReport,
  isDuplicateStrategy
} = require('../server/services/aiOptimizer/noOpDetector');
const { runIterativeOptimization } = require('../server/services/aiOptimizer/iterativeOptimizer');
const astParser = require('../server/services/ast/astParser');

describe('Expert SQL Rewrite Mode — Track B & Root Cause Classifier', () => {

  it('1. INDEX_ACCESS does NOT skip Query Shape Review when shape opportunities exist', () => {
    // Query with non-SARGable YEAR() and index deficiency
    const sql = `
      SELECT sth.sth_stok_kod, SUM(sth.sth_miktar) AS Total
      FROM STOK_HAREKETLERI AS sth WITH (NOLOCK)
      WHERE YEAR(sth.sth_tarih) IN (2025, 2026)
      GROUP BY sth.sth_stok_kod
    `;

    const ast = astParser.parseSql(sql);
    const mockEstimatedPlan = {
      totalSubTreeCost: 45.2,
      operators: [{ isScan: true, physicalOp: 'Clustered Index Scan', targetObject: 'STOK_HAREKETLERI' }],
      missingIndexes: [{ table: 'STOK_HAREKETLERI', impact: 85 }]
    };

    const result = classifyRootCause({
      sql,
      ast,
      estimatedPlan: mockEstimatedPlan,
      missingIndexes: mockEstimatedPlan.missingIndexes
    });

    // Must NOT be pure INDEX_ACCESS_ONLY / NEEDS_INDEX_CHANGE
    assert.equal(result.rewriteOpportunity, true, 'rewriteOpportunity must be true when shape issue exists');
    assert.equal(result.indexStillRecommended, true, 'indexStillRecommended must be true when index is missing');
    assert.equal(result.suggestedStatus, 'INDEX_ACCESS_WITH_REWRITE_OPPORTUNITY');
    assert.ok(result.queryShapeOpportunities.length > 0, 'Must have query shape opportunities');
    assert.ok(result.queryShapeOpportunities.some(o => o.type === 'NON_SARGABLE_PREDICATES'));
  });

  it('2. Pure SARGable query with missing index returns NEEDS_INDEX_CHANGE without rewrite', () => {
    const cleanSql = `
      SELECT s.sto_kod, s.sto_isim, s.sto_cins
      FROM STOKLAR AS s WITH (NOLOCK)
      WHERE s.sto_cins = 4 AND s.sto_kod = '123'
    `;

    const ast = astParser.parseSql(cleanSql);
    const mockPlan = {
      operators: [{ isScan: true, physicalOp: 'Table Scan', targetObject: 'STOKLAR' }],
      missingIndexes: [{ table: 'STOKLAR', impact: 70 }]
    };

    const result = classifyRootCause({
      sql: cleanSql,
      ast,
      estimatedPlan: mockPlan,
      missingIndexes: mockPlan.missingIndexes
    });

    assert.equal(result.primaryCause, 'INDEX_ACCESS');
    assert.equal(result.suggestedStatus, 'NEEDS_INDEX_CHANGE');
    assert.equal(result.rewriteOpportunity, false, 'No rewrite opportunity on structurally clean query');
    assert.equal(result.queryShapeOpportunities.length, 0);
  });

  it('3. Track B reviews repeated base table scans (e.g. multi-union or multi-join)', () => {
    const multiAccessSql = `
      SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE sth.sth_tip = 0
      UNION ALL
      SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE sth.sth_tip = 1
      UNION ALL
      SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE sth.sth_tip = 2
    `;

    const review = reviewQueryShape({ sql: multiAccessSql });
    assert.equal(review.hasOpportunities, true);
    const repeated = review.opportunities.find(o => o.type === 'REPEATED_BASE_TABLE_SCAN');
    assert.ok(repeated, 'Should detect repeated base table access');
    assert.equal(repeated.table, 'STOK_HAREKETLERI');
    assert.equal(repeated.count, 3);
  });

  it('4. Track B reviews late aggregations and expression-based joins', () => {
    const complexSql = `
      SELECT i.is_Kod, r.rec_tuketim_kod, SUM(m.ish_planuretim) AS Toplam
      FROM AA_alper_isemirleri AS i WITH (NOLOCK)
      LEFT JOIN ISEMRI_MALZEME_DURUMLARI AS m WITH (NOLOCK) ON i.is_Kod = m.ish_isemri
      LEFT JOIN STOKLAR AS s ON i.is_Kod = s.sto_kod
      LEFT JOIN URUN_ROTALARI AS r ON i.is_Kod = r.URt_OpKod
      LEFT JOIN SIPARISLER AS sp ON i.is_Kod = CONCAT(sp.sip_evrakno_seri, '-', sp.sip_evrakno_sira)
      GROUP BY i.is_Kod, r.rec_tuketim_kod
    `;

    const review = reviewQueryShape({ sql: complexSql });
    assert.equal(review.hasOpportunities, true);
    assert.ok(review.opportunities.some(o => o.type === 'LATE_AGGREGATION_OPPORTUNITY'));
    assert.ok(review.opportunities.some(o => o.type === 'EXPRESSION_BASED_JOIN'));
  });
});

describe('Expert SQL Rewrite Mode — No-Op, Scoring & Strategy Diversity', () => {

  it('5. Rejects pure cosmetic alias/formatting rewrites (Significance Score < 2)', () => {
    const originalSql = `SELECT s.sto_kod, s.sto_isim FROM STOKLAR AS s WHERE s.sto_cins = 4`;
    const cosmeticCandidate = `select x.sto_kod, x.sto_isim from STOKLAR as x where x.sto_cins = 4`;

    const res = detectNoOpRewrite({ originalSql, candidateSql: cosmeticCandidate });
    assert.equal(res.isMeaningful, false);
    assert.equal(res.status, 'NO_MEANINGFUL_REWRITE');
    assert.equal(res.classification, 'COSMETIC_REWRITE');
    assert.ok(res.significanceScore < 2, `Score must be < 2, got ${res.significanceScore}`);
  });

  it('6. Awards Significance Score >= 2 to SARGable date range conversion', () => {
    const originalSql = `SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE YEAR(sth.sth_tarih) = 2026`;
    const sargCandidate = `SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE sth.sth_tarih >= '2026-01-01' AND sth.sth_tarih < '2027-01-01'`;

    const res = detectNoOpRewrite({ originalSql, candidateSql: sargCandidate });
    assert.equal(res.isMeaningful, true);
    assert.equal(res.status, 'MEANINGFUL_REWRITE');
    assert.ok(res.significanceScore >= 2, `SARGable rewrite should have score >= 2, got ${res.significanceScore}`);
    assert.ok(res.diffReport.origNonSargCount > res.diffReport.candNonSargCount);
  });

  it('7. Detects duplicate strategy across iterations', () => {
    const cand1 = `SELECT a.col1, a.col2 FROM TableA AS a LEFT JOIN TableB AS b ON a.id = b.id WHERE a.status = 1`;
    const cand2WithNewAlias = `SELECT x.col1, x.col2 FROM TableA AS x LEFT JOIN TableB AS y ON x.id = y.id WHERE x.status = 1`;

    const ast1 = astParser.parseSql(cand1);
    const ast2 = astParser.parseSql(cand2WithNewAlias);

    const isDup = isDuplicateStrategy(ast1, ast2);
    assert.equal(isDup, true, 'Renaming aliases must be detected as duplicate strategy');
  });

  it('8. Produces Query Shape Difference Report comparing joins and table paths', () => {
    const origSql = `
      SELECT t1.id FROM TableA AS t1
      LEFT JOIN TableB AS t2 ON t1.id = t2.id
      LEFT JOIN TableC AS t3 ON t1.id = t3.id
      WHERE YEAR(t1.created) = 2026
    `;

    const candSql = `
      WITH PreAgg AS (SELECT id FROM TableA WHERE created >= '2026-01-01' AND created < '2027-01-01')
      SELECT p.id FROM PreAgg AS p
      INNER JOIN TableB AS b ON p.id = b.id
    `;

    const origAst = astParser.parseSql(origSql);
    const candAst = astParser.parseSql(candSql);
    const diff = generateQueryShapeDiffReport(origAst, candAst);

    assert.equal(diff.hasStructuralChange, true);
    assert.equal(diff.origJoinsCount, 2);
    assert.equal(diff.candJoinsCount, 1);
    assert.equal(diff.origNonSargCount, 1);
    assert.equal(diff.candNonSargCount, 0);
  });
});

describe('Expert SQL Rewrite Mode — Iterative Optimization Orchestrator', () => {

  it('9. Produces SQL_REWRITE_VALID_BUT_INDEX_REQUIRED when rewrite is valid but physical index is missing', async () => {
    const originalSql = `SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE YEAR(sth.sth_tarih) = 2026`;
    const candidateSql = `SELECT sth.sth_stok_kod FROM STOK_HAREKETLERI AS sth WHERE sth.sth_tarih >= '2026-01-01' AND sth.sth_tarih < '2027-01-01'`;

    // Simulated AI response providing SARGable candidate
    const mockAiCaller = async () => ({
      ok: true,
      status: 'CANDIDATE_GENERATED',
      strategyId: 'SARGABLE_DATE_RANGE',
      hypothesis: { bottlenecks: [{ findingId: 'F01', proposedChange: 'Convert to range' }] },
      whatChanged: 'YEAR() fonksiyonu indekslenebilir tarih aralığına çevrildi.',
      why: 'İndeks Seek kullanımını mümkün kılmak için.',
      candidateSql,
      simulatedValidation: { ok: true, status: 'PASS', rowCountsMatch: true },
      // Simulated benchmark: reads unchanged because table has no index yet
      simulatedBenchmark: {
        winner: 'TIE',
        improvements: { readsPercent: 0, durationPercent: 2, cpuPercent: 0 }
      }
    });

    const result = await runIterativeOptimization({
      sql: originalSql,
      viewName: 'AA_alper_4rapor_test',
      aiCaller: mockAiCaller,
      maxIterations: 1,
      runBenchmark: false,
      options: {
        missingIndexes: [{ table: 'STOK_HAREKETLERI', impact: 80 }],
        estimatedPlan: {
          totalSubTreeCost: 10,
          operators: [{ isScan: true, targetObject: 'STOK_HAREKETLERI' }],
          missingIndexes: [{ table: 'STOK_HAREKETLERI', impact: 80 }]
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'SQL_REWRITE_VALID_BUT_INDEX_REQUIRED', 'Must return combined result status');
    assert.ok(result.bestCandidate, 'Best candidate must be preserved and returned');
    assert.equal(result.bestCandidate.candidateSql, candidateSql);
    assert.equal(result.indexStillRecommended, true);
  });

  it('10. Produces MEASURED_IMPROVEMENT when benchmark confirms resource reduction', async () => {
    const originalSql = `SELECT s.sto_kod FROM STOKLAR AS s WHERE s.sto_kod LIKE 'A%'`;
    const candidateSql = `SELECT s.sto_kod FROM STOKLAR AS s WHERE s.sto_kod >= 'A' AND s.sto_kod < 'B'`;

    const mockAiCaller = async () => ({
      ok: true,
      status: 'CANDIDATE_GENERATED',
      strategyId: 'PREFIX_RANGE_SEEK',
      candidateSql,
      simulatedValidation: { ok: true, status: 'PASS', rowCountsMatch: true },
      simulatedBenchmark: {
        winner: 'CANDIDATE',
        improvements: { readsPercent: 45, durationPercent: 30, cpuPercent: 20 }
      }
    });

    const result = await runIterativeOptimization({
      sql: originalSql,
      aiCaller: mockAiCaller,
      maxIterations: 1,
      runBenchmark: false
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'MEASURED_IMPROVEMENT');
    assert.ok(result.bestCandidate);
    assert.equal(result.bestCandidate.status, 'MEASURED_IMPROVEMENT');
  });

  it('11. Stops immediately on NEEDS_INDEX_CHANGE ONLY if query is 100% clean and has no candidate', async () => {
    const cleanSql = `SELECT sto_kod, sto_isim FROM STOKLAR WHERE sto_cins = 4`;

    const result = await runIterativeOptimization({
      sql: cleanSql,
      options: {
        missingIndexes: [{ table: 'STOKLAR', impact: 90 }],
        estimatedPlan: {
          totalSubTreeCost: 5,
          operators: [{ isScan: true, targetObject: 'STOKLAR' }]
        }
      },
      runBenchmark: false
    });

    assert.equal(result.status, 'NEEDS_INDEX_CHANGE');
    assert.equal(result.bestCandidate, null, 'No fake duplicate SQL candidate must be produced');
  });
});
