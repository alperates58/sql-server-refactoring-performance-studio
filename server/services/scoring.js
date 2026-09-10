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

function calculateRisk(options = {}) {
  const health = Number(options.health != null ? options.health : 100) || 100;
  const depth = Number(options.depth || 1) || 1;
  const repeatedCount = Number(options.repeatedCount || 0) || 0;
  const dependentCount = Number(options.dependentCount || 0) || 0;

  // Support both options.runtime and flat options.reads/options.isRegressed
  let runtime = options.runtime || null;
  if (!runtime && (options.reads != null || options.isRegressed != null)) {
    runtime = {
      avgLogicalReads: Number(options.reads) || 0,
      totalReads: Number(options.reads) || 0,
      executions: 1,
      isRegression: Boolean(options.isRegressed),
      evidenceGrade: 'B'
    };
  }

  let riskScore = 0;
  let evidenceGrade = 'D';

  const avgReads = runtime ? (runtime.avgLogicalReads != null ? runtime.avgLogicalReads : (runtime.totalReads != null ? runtime.totalReads / (runtime.executions || runtime.executionCount || 1) : null)) : null;
  const executions = runtime ? (runtime.executions != null ? runtime.executions : runtime.executionCount) : null;
  const isRegression = runtime ? (runtime.isRegression != null ? runtime.isRegression : Boolean(runtime.isRegressed)) : false;

  if (runtime && (avgReads != null || executions != null)) {
    evidenceGrade = runtime.evidenceGrade || 'B';
    const readsScore = Math.min(40, (Math.log10(Math.max(1, avgReads || 1)) / 7) * 40);
    const regressionScore = isRegression ? 20 : 0;
    const healthComponent = ((100 - health) / 100) * 15;
    const blastComponent = Math.min(15, (dependentCount / 30) * 15);
    const execComponent = Math.min(10, (Math.log10(Math.max(1, executions || 1)) / 6) * 10);
    riskScore = clamp(readsScore + regressionScore + healthComponent + blastComponent + execComponent);
  } else {
    evidenceGrade = 'D';
    const healthComponent = (100 - health) * 0.55;
    const blastComponent = Math.min(25, dependentCount * 1.1);
    const complexityComponent = Math.min(20, (repeatedCount * 5) + Math.max(0, depth - 3) * 3);
    riskScore = clamp(healthComponent + blastComponent + complexityComponent);
  }

  let level = 'LOW';
  let levelTr = 'DÜŞÜK';
  let category = 'low';
  if (riskScore >= 75) {
    level = 'CRITICAL';
    levelTr = 'KRİTİK';
    category = 'critical';
  } else if (riskScore >= 55) {
    level = 'HIGH';
    levelTr = 'YÜKSEK';
    category = 'high';
  } else if (riskScore >= 35) {
    level = 'MEDIUM';
    levelTr = 'ORTA';
    category = 'medium';
  }

  return {
    score: isNaN(riskScore) ? 10 : riskScore,
    level,
    levelTr,
    category, // Alias for backward compatibility
    evidenceGrade
  };
}

function buildRiskBars(signals = {}, runtime = null) {
  const depth = signals.depth || 1;
  const repeated = signals.repeatedBaseTableCount || 0;
  const nonSargable = signals.nonSargableCount || 0;
  const dependents = signals.dependentCount || 0;

  const isRegressed = typeof runtime === 'object' && runtime ? (runtime.isRegression || runtime.isRegressed) : false;
  const reads = typeof runtime === 'object' && runtime ? (runtime.avgLogicalReads != null ? runtime.avgLogicalReads : (runtime.totalReads || 0)) : 0;

  const runtimeVal = isRegressed ? 90 : (reads > 100000 ? 75 : 15);
  const runtimePenalty = isRegressed ? 16 : (reads > 100000 ? 10 : 0);

  const repeatedVal = clamp(repeated * 28);
  const repeatedPenalty = Math.min(18, repeated * 6);

  const depthVal = clamp(Math.max(0, depth - 1) * 18);
  const depthPenalty = depth > 3 ? Math.min(12, (depth - 3) * 3) : 0;

  const sargVal = clamp(nonSargable * 25);
  const sargPenalty = Math.min(12, nonSargable * 4);

  const blastVal = clamp(dependents * 3.5);
  const blastPenalty = dependents >= 10 ? Math.min(8, Math.floor(dependents / 10) * 2) : 0;

  return [
    { label: 'Çalışma Zamanı & Regresyon', value: runtimeVal, penalty: runtimePenalty },
    { label: 'Mükerrer Tablo Erişimi', value: repeatedVal, penalty: repeatedPenalty },
    { label: 'Bağımlılık Derinliği', value: depthVal, penalty: depthPenalty },
    { label: 'SARGable İndeks Uyumu', value: sargVal, penalty: sargPenalty },
    { label: 'Etki Alanı (Blast Radius)', value: blastVal, penalty: blastPenalty }
  ];
}

module.exports = { calculateHealth, calculateRisk, buildRiskBars, clamp };
