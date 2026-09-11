/**
 * SQL Server Refactoring & Performance Studio
 * Refactor Decision Engine Unit Tests (Sprint 3)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const refactorDecision = require('../public/assets/js/modules/refactorDecision');
const { evaluateRefactorDecision, calculateRefactorConfidence, DECISIONS } = refactorDecision;

describe('Refactor Decision & Confidence Engine', () => {

  describe('evaluateRefactorDecision - Decision Matrix', () => {

    it('returns UNSAFE if semantic validation fails, regardless of performance speedup', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'FAIL', reason: 'Sütun sayısı uyuşmuyor' },
        benchmark: { improvements: { durationPercent: 90, readsPercent: 95 } },
        planComparison: {}
      });
      assert.strictEqual(result.decision, DECISIONS.UNSAFE.code);
      assert.strictEqual(result.isDeployable, false);
      assert.ok(result.reasons.some(r => r.includes('Semantik doğrulama başarısız')));
    });

    it('returns UNSAFE if row counts do not match in benchmark', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'PASS' },
        benchmark: { isRowCountEqual: false, improvements: { durationPercent: 80 } },
        planComparison: {}
      });
      assert.strictEqual(result.decision, DECISIONS.UNSAFE.code);
      assert.strictEqual(result.isDeployable, false);
      assert.ok(result.reasons.some(r => r.includes('satır sayıları uyuşmuyor')));
    });

    it('returns REGRESSION if candidate benchmark is slower or winner is ORIGINAL', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'PASS' },
        benchmark: { winner: 'ORIGINAL', improvements: { durationPercent: -30, readsPercent: -40 } },
        planComparison: {}
      });
      assert.strictEqual(result.decision, DECISIONS.REGRESSION.code);
      assert.strictEqual(result.isDeployable, false);
    });

    it('returns REGRESSION if plan introduces TempDB Spill', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'PASS' },
        benchmark: { improvements: { durationPercent: 5 } },
        planComparison: {
          changes: [{ code: 'TEMPDB_SPILL_ADDED', significance: 'NEGATIVE' }]
        }
      });
      assert.strictEqual(result.decision, DECISIONS.REGRESSION.code);
      assert.strictEqual(result.isDeployable, false);
      assert.ok(result.reasons.some(r => r.includes('TempDB Spill')));
    });

    it('returns SAFE_IMPROVEMENT when validation passes, benchmark improves significantly and plan is clean', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'PASS' },
        benchmark: { isRowCountEqual: true, improvements: { durationPercent: 40, readsPercent: 50 } },
        planComparison: {
          changes: [{ code: 'TABLE_SCAN_REMOVED', significance: 'POSITIVE' }]
        }
      });
      assert.strictEqual(result.decision, DECISIONS.SAFE_IMPROVEMENT.code);
      assert.strictEqual(result.isDeployable, true);
    });

    it('returns POTENTIAL_IMPROVEMENT if validation has WARNING but plan improves', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'WARNING', warnings: ['Nullability farkı olabilir'] },
        benchmark: { isRowCountEqual: true, improvements: { durationPercent: 15 } },
        planComparison: {
          changes: [{ code: 'INDEX_SEEK_ADDED', significance: 'POSITIVE' }]
        }
      });
      assert.strictEqual(result.decision, DECISIONS.POTENTIAL_IMPROVEMENT.code);
      assert.strictEqual(result.isDeployable, false); // requires manual review
    });

    it('returns NO_MEANINGFUL_CHANGE when validation passes but delta is within noise threshold', () => {
      const result = evaluateRefactorDecision({
        validation: { status: 'PASS' },
        benchmark: { isRowCountEqual: true, improvements: { durationPercent: 2, readsPercent: 0 } },
        planComparison: { changes: [] }
      });
      assert.strictEqual(result.decision, DECISIONS.NO_MEANINGFUL_CHANGE.code);
      assert.strictEqual(result.isDeployable, false);
    });

  });

  describe('calculateRefactorConfidence - Confidence Scoring', () => {

    it('awards HIGH confidence (>=80) when validation passes, benchmark has >=3 runs and before/after plans exist', () => {
      const conf = calculateRefactorConfidence({
        validation: { status: 'PASS', rowCountsMatch: true },
        benchmark: { runsCount: 3 },
        plan: { beforePlan: { totalSubTreeCost: 1 }, afterPlan: { totalSubTreeCost: 0.5 } }
      });

      assert.strictEqual(conf.score, 100); // 40 + 35 + 25
      assert.strictEqual(conf.level, 'HIGH');
      assert.strictEqual(conf.factors.length, 3);
    });

    it('awards MEDIUM confidence (50-79) with partial evidence', () => {
      const conf = calculateRefactorConfidence({
        validation: { status: 'PASS' },
        benchmark: { runsCount: 1 },
        plan: { beforePlan: null, afterPlan: null }
      });

      // 40 (val) + 20 (bench) + 0 (plan) = 60
      assert.strictEqual(conf.score, 60);
      assert.strictEqual(conf.level, 'MEDIUM');
    });

    it('awards LOW confidence (<50) when key evidence is missing or validation failed', () => {
      const conf = calculateRefactorConfidence({
        validation: { status: 'FAIL' },
        benchmark: { runsCount: 0 },
        plan: {}
      });

      assert.strictEqual(conf.score, 0);
      assert.strictEqual(conf.level, 'LOW');
    });

  });

});
