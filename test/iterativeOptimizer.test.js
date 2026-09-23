/**
 * SQL Server Refactoring & Performance Studio
 * Iterative Optimizer Orchestrator Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runIterativeOptimization } = require('../server/services/aiOptimizer/iterativeOptimizer');
const { OPTIMIZER_FIXTURES } = require('./fixtures/optimizerFixtures');

describe('AI Optimizer Phase 5 — Iterative Orchestrator & Candidate Selection', () => {

  it('immediately returns NEEDS_INDEX_CHANGE for SARGable queries with missing index (zero fake rewrite)', async () => {
    const fix = OPTIMIZER_FIXTURES.missingIndexOnly;
    let aiCalled = false;

    const res = await runIterativeOptimization({
      sql: fix.sql,
      viewName: 'V_MISSING_IDX',
      options: {
        missingIndexes: [{ table: 'STOKLAR', equalityColumns: ['sto_ozelkod1'] }],
        indexCoverage: [{ status: 'NONE' }],
        estimatedPlan: { operators: [{ isScan: true, targetObject: 'STOKLAR' }] }
      },
      aiCaller: async () => {
        aiCalled = true;
        return { ok: true, status: 'CANDIDATE_GENERATED' };
      },
      runBenchmark: false
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.status, 'NEEDS_INDEX_CHANGE');
    assert.strictEqual(res.primaryCause, 'INDEX_ACCESS');
    assert.strictEqual(aiCalled, false, 'AI should not be called to generate a fake SQL rewrite when missing index is the root cause');
    assert.strictEqual(res.bestCandidate, null);
  });

  it('immediately returns NO_SAFE_OPTIMIZATION_FOUND for already optimized queries', async () => {
    const fix = OPTIMIZER_FIXTURES.alreadyOptimizedQuery;
    let aiCalled = false;

    const res = await runIterativeOptimization({
      sql: fix.sql,
      viewName: 'V_OPTIMIZED',
      aiCaller: async () => {
        aiCalled = true;
        return { ok: true, status: 'CANDIDATE_GENERATED' };
      },
      runBenchmark: false
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.status, 'NO_SAFE_OPTIMIZATION_FOUND');
    assert.strictEqual(aiCalled, false, 'AI should not rewrite an already optimized query');
  });

  it('rejects cosmetic rewrite in iteration 1 and selects strong structural improvement in iteration 2', async () => {
    const fix = OPTIMIZER_FIXTURES.nonSargableDate;
    let callCount = 0;
    const receivedFeedbacks = [];

    const mockAiCaller = async ({ iterationFeedback }) => {
      callCount++;
      receivedFeedbacks.push(iterationFeedback);

      if (callCount === 1) {
        // Iteration 1: AI returns cosmetic alias change
        return {
          ok: true,
          status: 'CANDIDATE_GENERATED',
          strategyId: 'COSMETIC_ALIAS_CHANGE',
          candidateSql: fix.cosmeticCandidateSql,
          changes: [{ findingId: 'F01', changeId: 'C01', description: 'Alias s eklendi' }],
          addressedFindings: []
        };
      } else {
        // Iteration 2: AI returns true structural SARGable rewrite
        return {
          ok: true,
          status: 'CANDIDATE_GENERATED',
          strategyId: 'SARGABLE_DATE_RANGE',
          candidateSql: fix.structuralCandidateSql,
          changes: [{ findingId: 'F01', changeId: 'C01', description: 'Tarih aralığına dönüştürüldü' }],
          addressedFindings: ['F01'],
          simulatedValidation: { status: 'PASS', isEquivalent: true },
          simulatedBenchmark: {
            isRowCountEqual: true,
            improvements: { readsPercent: 28, cpuPercent: 12, durationPercent: 20 },
            winner: 'CANDIDATE'
          }
        };
      }
    };

    const res = await runIterativeOptimization({
      sql: fix.sql,
      viewName: 'V_NON_SARGABLE',
      maxIterations: 3,
      aiCaller: mockAiCaller,
      runBenchmark: false // offline unit test mode
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(callCount, 2, 'Should have iterated twice');
    assert.strictEqual(res.iterations[0].status, 'REJECTED_COSMETIC');
    assert.ok(res.iterations[0].rejectionReason.includes('birebir aynı'));

    // Verify feedback was passed to iteration 2
    assert.strictEqual(receivedFeedbacks[1].previousStrategyId, 'COSMETIC_ALIAS_CHANGE');
    assert.ok(receivedFeedbacks[1].planSummary.includes('kozmetik'));

    // Best candidate is iteration 2
    assert.ok(res.bestCandidate);
    assert.strictEqual(res.bestCandidate.iteration, 2);
    assert.strictEqual(res.bestCandidate.strategyId, 'SARGABLE_DATE_RANGE');
  });

});
