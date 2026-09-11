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

const DEFAULT_WEIGHTS = {
  runtimeWeight: 35,
  regressionWeight: 25,
  repeatedWeight: 15,
  depthWeight: 10,
  sargableWeight: 10,
  blastWeight: 5
};

function normalizeWeights(raw = {}) {
  const getVal = (primary, fallback) => {
    const v = raw[primary] !== undefined ? raw[primary] : raw[fallback];
    if (v === null || v === undefined || v === '') return null;
    const num = Number(v);
    return (Number.isFinite(num) && num >= 0) ? num : null;
  };

  const runtimeWeight = getVal('runtimeWeight', 'weightRuntime') ?? DEFAULT_WEIGHTS.runtimeWeight;
  const regressionWeight = getVal('regressionWeight', 'weightRegression') ?? DEFAULT_WEIGHTS.regressionWeight;
  const repeatedWeight = getVal('repeatedWeight', 'weightRepeated') ?? DEFAULT_WEIGHTS.repeatedWeight;
  const depthWeight = getVal('depthWeight', 'weightDepth') ?? DEFAULT_WEIGHTS.depthWeight;
  const sargableWeight = getVal('sargableWeight', 'weightSargable') ?? DEFAULT_WEIGHTS.sargableWeight;
  const blastWeight = getVal('blastWeight', 'weightBlast') ?? DEFAULT_WEIGHTS.blastWeight;

  const sum = runtimeWeight + regressionWeight + repeatedWeight + depthWeight + sargableWeight + blastWeight;

  if (sum <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }

  // Normalize to 100 if sum deviates from 100
  if (Math.abs(sum - 100) > 0.001) {
    const factor = 100 / sum;
    return {
      runtimeWeight: runtimeWeight * factor,
      regressionWeight: regressionWeight * factor,
      repeatedWeight: repeatedWeight * factor,
      depthWeight: depthWeight * factor,
      sargableWeight: sargableWeight * factor,
      blastWeight: blastWeight * factor
    };
  }

  return {
    runtimeWeight,
    regressionWeight,
    repeatedWeight,
    depthWeight,
    sargableWeight,
    blastWeight
  };
}

function calculateRisk(options = {}, customWeights = null) {
  const health = Number(options.health != null ? options.health : 100) || 100;
  const depth = Number(options.depth || 1) || 1;
  const repeatedCount = Number(options.repeatedCount || 0) || 0;
  const dependentCount = Number(options.dependentCount || 0) || 0;
  const nonSargableCount = Number(options.nonSargableCount || 0) || 0;

  const weights = normalizeWeights(customWeights || options.weights || {});

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
    const readsRatio = Math.min(1, Math.log10(Math.max(1, avgReads || 1)) / 7);
    const readsScore = readsRatio * weights.runtimeWeight;

    // Scale regression weight proportionally with severityScore if available, else binary fallback
    let regFactor = 0;
    if (runtime.regression && typeof runtime.regression.severityScore === 'number') {
      regFactor = Math.min(1, Math.max(0, runtime.regression.severityScore / 100));
    } else if (isRegression) {
      regFactor = 1;
    }
    const regressionScore = regFactor * weights.regressionWeight;

    const repeatedScore = Math.min(weights.repeatedWeight, (repeatedCount / 3) * weights.repeatedWeight);
    const depthScore = Math.min(weights.depthWeight, (Math.max(0, depth - 1) / 5) * weights.depthWeight);
    const sargableScore = Math.min(weights.sargableWeight, (nonSargableCount / 3) * weights.sargableWeight);
    const blastScore = Math.min(weights.blastWeight, (dependentCount / 30) * weights.blastWeight);

    riskScore = clamp(readsScore + regressionScore + repeatedScore + depthScore + sargableScore + blastScore);
  } else {
    evidenceGrade = 'D';
    const staticBase = weights.repeatedWeight + weights.depthWeight + weights.sargableWeight + weights.blastWeight;
    const staticScale = staticBase > 0 ? (100 / staticBase) : 1;

    const healthComponent = ((100 - health) / 100) * 45;
    const repeatedScore = Math.min(25, (repeatedCount / 3) * weights.repeatedWeight * (staticScale * 0.25));
    const depthScore = Math.min(15, (Math.max(0, depth - 1) / 4) * weights.depthWeight * (staticScale * 0.2));
    const sargableScore = Math.min(15, (nonSargableCount / 3) * weights.sargableWeight * (staticScale * 0.2));
    const blastScore = Math.min(20, (dependentCount / 20) * weights.blastWeight * (staticScale * 0.3));

    riskScore = clamp(healthComponent + repeatedScore + depthScore + sargableScore + blastScore);
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

/**
 * Calculates Opportunity Score ("Bugün Müdahale Edilecekler"):
 * Combines structural risk, verified regression severity, normalized reads, and blast radius.
 */
function calculateOpportunityScore({
  riskScore = 0,
  severityScore = 0,
  totalReads = 0,
  blastRadius = 0
} = {}) {
  const normRisk = clamp(Number(riskScore) || 0);
  const normSev = clamp(Number(severityScore) || 0);
  // Log-scale normalization for logical reads: 10M reads = 100
  const normReads = clamp(Math.round((Math.log10(Math.max(1, Number(totalReads) || 0)) / 7) * 100));
  // Blast radius: 20 dependents = 100
  const normBlast = clamp(Math.round(((Number(blastRadius) || 0) / 20) * 100));

  const opportunity = (normRisk * 0.35) + (normSev * 0.35) + (normReads * 0.20) + (normBlast * 0.10);
  return clamp(opportunity);
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

module.exports = {
  calculateHealth,
  calculateRisk,
  calculateOpportunityScore,
  buildRiskBars,
  clamp,
  DEFAULT_WEIGHTS,
  normalizeWeights
};
