/**
 * SQL Server Refactoring & Performance Studio
 * Scoring Engine Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calculateRisk, calculateHealth, calculateOpportunityScore, normalizeWeights, DEFAULT_WEIGHTS } = require('../server/services/scoring');

describe('Scoring Engine - Risk & Health Calculations', () => {

  it('normalizes arbitrary weights so their sum equals 100', () => {
    const raw = {
      runtimeWeight: 50,
      regressionWeight: 50,
      repeatedTableWeight: 50,
      depthWeight: 50,
      blastRadiusWeight: 50
    };
    const norm = normalizeWeights(raw);
    const sum = norm.runtimeWeight + norm.regressionWeight + norm.repeatedTableWeight + norm.depthWeight + norm.blastRadiusWeight;
    assert.strictEqual(Math.round(sum), 100);
    assert.strictEqual(norm.runtimeWeight, 20);
    assert.strictEqual(norm.regressionWeight, 20);
  });

  it('handles zero or negative weights by falling back to DEFAULT_WEIGHTS', () => {
    const norm = normalizeWeights({ runtimeWeight: 0, regressionWeight: 0, repeatedTableWeight: 0, depthWeight: 0, blastRadiusWeight: 0 });
    assert.strictEqual(norm.runtimeWeight, DEFAULT_WEIGHTS.runtimeWeight);
    assert.strictEqual(norm.regressionWeight, DEFAULT_WEIGHTS.regressionWeight);
  });

  it('accepts both weightRuntime and runtimeWeight naming formats', () => {
    const norm = normalizeWeights({ weightRuntime: 40, weightRegression: 20 });
    assert.ok(norm.runtimeWeight > 0);
    assert.ok(norm.regressionWeight > 0);
  });

  it('calculates higher risk for views with high logical reads', () => {
    const lowReads = calculateRisk({ totalReads: 1000, isRegressed: false, repeatedTableCount: 0, maxDepth: 1, blastRadius: 1 });
    const highReads = calculateRisk({ totalReads: 5000000, isRegressed: false, repeatedTableCount: 0, maxDepth: 1, blastRadius: 1 });
    assert.ok(highReads.score > lowReads.score, `Expected highReads (${highReads.score}) > lowReads (${lowReads.score})`);
  });

  it('applies regression penalty when isRegressed is true', () => {
    const baseline = calculateRisk({ totalReads: 5000, isRegressed: false });
    const regressed = calculateRisk({ totalReads: 5000, isRegressed: true });
    assert.ok(regressed.score > baseline.score, 'Regressed view must have higher risk score');
    assert.ok(regressed.breakdown.regression > 0);
  });

  it('scales risk based on repeatedTableCount', () => {
    const noRepeats = calculateRisk({ totalReads: 0, repeatedTableCount: 0 });
    const multiRepeats = calculateRisk({ totalReads: 0, repeatedTableCount: 4 });
    assert.ok(multiRepeats.score > noRepeats.score);
    assert.ok(multiRepeats.breakdown.repeatedTables > noRepeats.breakdown.repeatedTables);
  });

  it('incorporates nonSargableCount into risk calculation', () => {
    const sargable = calculateRisk({ totalReads: 0, nonSargableCount: 0 });
    const nonSargable = calculateRisk({ totalReads: 0, nonSargableCount: 5 });
    assert.ok(nonSargable.score > sargable.score, 'Non-SARGable expressions must increase risk');
  });

  it('scales risk score proportionally when custom weights are provided', () => {
    const heavyRuntimeWeights = {
      runtimeWeight: 80,
      regressionWeight: 5,
      repeatedTableWeight: 5,
      depthWeight: 5,
      blastRadiusWeight: 5
    };
    const defaultRes = calculateRisk({ totalReads: 2000000 }, DEFAULT_WEIGHTS);
    const customRes = calculateRisk({ totalReads: 2000000 }, heavyRuntimeWeights);
    // With 80% weight on runtime, high reads should produce a higher score than with 30% default
    assert.ok(customRes.score > defaultRes.score, `Custom ${customRes.score} should exceed default ${defaultRes.score}`);
  });

  it('calculates health score with appropriate deductions for static problems', () => {
    const cleanHealth = calculateHealth([]);
    assert.strictEqual(cleanHealth.score, 100);
    assert.strictEqual(cleanHealth.band, 'A');

    const problematic = calculateHealth(['SELECT_STAR', 'SCALAR_UDF', 'CYCLIC_DEPENDENCY']);
    assert.ok(problematic.score < 50, 'Severe problems should drive health score below 50');
    assert.ok(['D', 'F'].includes(problematic.band));
  });

  it('scales regression penalty proportionally based on severityScore (0-100)', () => {
    const lowSev = calculateRisk({ totalReads: 1000, regression: { isRegressed: true, severityScore: 25 } });
    const highSev = calculateRisk({ totalReads: 1000, regression: { isRegressed: true, severityScore: 100 } });

    assert.ok(highSev.score > lowSev.score, 'Higher severityScore must produce higher overall risk');
    assert.strictEqual(highSev.breakdown.regression, 20); // 100% of 20pt default weight
    assert.strictEqual(lowSev.breakdown.regression, 5);   // 25% of 20pt default weight
  });

});

describe('Scoring Engine - Opportunity Score ("Bugün Müdahale Edilecekler")', () => {

  it('calculates opportunity score within valid 0-100 range', () => {
    const opp = calculateOpportunityScore({
      riskScore: 65,
      severityScore: 80,
      totalReads: 2500000,
      blastRadius: 12
    });
    assert.ok(opp >= 0 && opp <= 100, `Opportunity score (${opp}) must be between 0 and 100`);
    assert.ok(opp > 50, 'High risk and high regression severity should produce high opportunity score');
  });

  it('returns near-zero opportunity score for zero risk, no regression, and trivial reads', () => {
    const opp = calculateOpportunityScore({
      riskScore: 0,
      severityScore: 0,
      totalReads: 0,
      blastRadius: 0
    });
    assert.strictEqual(opp, 0);
  });

  it('incorporates blast radius proportionally into opportunity score', () => {
    const isolated = calculateOpportunityScore({ riskScore: 50, severityScore: 50, totalReads: 10000, blastRadius: 1 });
    const widelyUsed = calculateOpportunityScore({ riskScore: 50, severityScore: 50, totalReads: 10000, blastRadius: 30 });

    assert.ok(widelyUsed > isolated, 'Higher blast radius must produce higher opportunity score');
  });

  it('handles custom weighting configurations for opportunity score', () => {
    const customWeights = { riskWeight: 0.50, severityWeight: 0.50, readsWeight: 0, blastRadiusWeight: 0 };
    const score = calculateOpportunityScore({ riskScore: 80, severityScore: 40 }, customWeights);
    // (80 * 0.5) + (40 * 0.5) = 40 + 20 = 60
    assert.strictEqual(score, 60);
  });

  it('caps max opportunity score at 100 under extreme values', () => {
    const extreme = calculateOpportunityScore({
      riskScore: 100,
      severityScore: 100,
      totalReads: 1000000000,
      blastRadius: 500
    });
    assert.strictEqual(extreme, 100);
  });

});

