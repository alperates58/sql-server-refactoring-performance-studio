/**
 * Health & Risk Scoring Service
 *
 * Implements the scoring rules from docs/03-SCORING.md:
 * - Health Score: 0-100 technical/structural quality (100 is pristine, subtract explainable penalties).
 * - Risk Score: 0-100 operational urgency (high means critical attention needed).
 * - Evidence Grades:
 *    A: Query Store verified runtime metrics
 *    B: Plan Cache / DMV correlation
 *    C: Dependency / SQL-text heuristic
 *    D: Static analysis only
 */

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function calculateHealth(signals = {}) {
  let penalty = 0;

  // 1. Dependency depth > 3: up to -12
  const depth = signals.depth || 1;
  if (depth > 3) {
    penalty += Math.min(12, (depth - 3) * 3);
  }

  // 2. Repeated base table access paths: up to -18
  const repeated = signals.repeatedBaseTableCount || 0;
  if (repeated > 0) {
    penalty += Math.min(18, repeated * 6);
  }

  // 3. SELECT DISTINCT heuristic: -5
  if (signals.hasDistinct) {
    penalty += 5;
  }

  // 4. UNION without ALL heuristic: -6
  if (signals.hasUnionWithoutAll) {
    penalty += 6;
  }

  // 5. Window functions: -4
  if (signals.hasWindowFunctions) {
    penalty += 4;
  }

  // 6. Non-SARGable functions in predicate: up to -12
  const nonSargable = signals.nonSargableCount || 0;
  if (nonSargable > 0) {
    penalty += Math.min(12, nonSargable * 4);
  }

  // 7. Scalar UDF: up to -10
  const scalarUdf = signals.scalarUdfCount || 0;
  if (scalarUdf > 0) {
    penalty += Math.min(10, scalarUdf * 5);
  }

  // 8. Wildcard SELECT *: -3
  if (signals.hasWildcardSelect) {
    penalty += 3;
  }

  // 9. Leading wildcard LIKE: -4
  if (signals.hasLeadingWildcardLike) {
    penalty += 4;
  }

  // 10. Circular dependency: -20
  if (signals.cycleCount > 0) {
    penalty += 20;
  }

  // 11. Blast radius >= 10: up to -8
  const dependents = signals.dependentCount || 0;
  if (dependents >= 10) {
    penalty += Math.min(8, Math.floor(dependents / 10) * 2);
  }

  return clamp(100 - penalty);
}

function calculateRisk({
  health = 100,
  depth = 1,
  repeatedCount = 0,
  dependentCount = 0,
  runtime = null // { executions, avgLogicalReads, avgDurationMs, isRegression, evidenceGrade }
}) {
  let riskScore = 0;
  let evidenceGrade = 'D';

  if (runtime && (runtime.avgLogicalReads != null || runtime.executions != null)) {
    // Runtime data available (Grade A or B)
    evidenceGrade = runtime.evidenceGrade || 'B';

    // 40% runtime cost percentile
    const readsScore = Math.min(40, (Math.log10(Math.max(1, runtime.avgLogicalReads || 1)) / 7) * 40);

    // 20% active regression severity
    const regressionScore = runtime.isRegression ? 20 : 0;

    // 15% structural unhealthiness
    const healthComponent = ((100 - health) / 100) * 15;

    // 15% blast radius / centrality
    const blastComponent = Math.min(15, (dependentCount / 30) * 15);

    // 10% execution frequency
    const execComponent = Math.min(10, (Math.log10(Math.max(1, runtime.executions || 1)) / 6) * 10);

    riskScore = clamp(readsScore + regressionScore + healthComponent + blastComponent + execComponent);
  } else {
    // Static scan only - Renormalized weights with lower confidence (Grade D)
    evidenceGrade = 'D';

    // 55% structural health penalty
    const healthComponent = (100 - health) * 0.55;

    // 25% blast radius
    const blastComponent = Math.min(25, dependentCount * 1.1);

    // 20% complexity & repeated base tables
    const complexityComponent = Math.min(20, (repeatedCount * 5) + Math.max(0, depth - 3) * 3);

    riskScore = clamp(healthComponent + blastComponent + complexityComponent);
  }

  let level = 'LOW';
  if (riskScore >= 75) level = 'CRITICAL';
  else if (riskScore >= 55) level = 'HIGH';
  else if (riskScore >= 35) level = 'MEDIUM';

  return {
    score: riskScore,
    level,
    evidenceGrade
  };
}

function buildRiskBars(signals = {}, runtime = null) {
  const depth = signals.depth || 1;
  const repeated = signals.repeatedBaseTableCount || 0;
  const nonSargable = signals.nonSargableCount || 0;
  const dependents = signals.dependentCount || 0;

  const runtimeVal = runtime?.isRegression ? 90 : (runtime?.avgLogicalReads > 100000 ? 75 : 15);
  const runtimePenalty = runtime?.isRegression ? 16 : (runtime?.avgLogicalReads > 100000 ? 10 : 0);

  const repeatedVal = clamp(repeated * 28);
  const repeatedPenalty = Math.min(18, repeated * 6);

  const depthVal = clamp(Math.max(0, depth - 1) * 18);
  const depthPenalty = depth > 3 ? Math.min(12, (depth - 3) * 3) : 0;

  const sargVal = clamp(nonSargable * 25);
  const sargPenalty = Math.min(12, nonSargable * 4);

  const blastVal = clamp(dependents * 3.5);
  const blastPenalty = dependents >= 10 ? Math.min(8, Math.floor(dependents / 10) * 2) : 0;

  return [
    { label: 'Runtime / Regression', value: runtimeVal, penalty: runtimePenalty },
    { label: 'Repeated Access', value: repeatedVal, penalty: repeatedPenalty },
    { label: 'Dependency Depth', value: depthVal, penalty: depthPenalty },
    { label: 'SARGability', value: sargVal, penalty: sargPenalty },
    { label: 'Blast Radius', value: blastVal, penalty: blastPenalty }
  ];
}

module.exports = { calculateHealth, calculateRisk, buildRiskBars, clamp };
