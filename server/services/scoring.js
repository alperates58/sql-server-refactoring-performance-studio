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

function calculateHealth(signalsOrProblems = {}) {
  // 1. Array of problem rule tokens: ['SELECT_STAR', 'SCALAR_UDF', 'CYCLIC_DEPENDENCY', ...]
  if (Array.isArray(signalsOrProblems)) {
    let penalty = 0;
    for (const prob of signalsOrProblems) {
      const p = String(prob).toUpperCase();
      if (p === 'SELECT_STAR' || p === 'SELECT_STAR_RISK') penalty += 15;
      else if (p === 'SCALAR_UDF') penalty += 20;
      else if (p === 'CYCLIC_DEPENDENCY' || p === 'CYCLE') penalty += 25;
      else if (p === 'NON_SARGABLE' || p.startsWith('NON_SARGABLE_')) penalty += 12;
      else if (p === 'NO_JOIN_PREDICATE') penalty += 20;
      else if (p === 'UNION_DISTINCT') penalty += 10;
      else penalty += 10;
    }
    const score = clamp(100 - penalty);
    const band = score >= 90 ? 'A' : (score >= 75 ? 'B' : (score >= 60 ? 'C' : (score >= 40 ? 'D' : 'F')));
    return {
      score,
      band,
      valueOf() { return this.score; },
      toString() { return String(this.score); }
    };
  }

  // 2. Signals object from scanner or catalog analyzer
  const signals = signalsOrProblems || {};
  let penalty = 0;

  // 2.1 Dependency depth > 3: up to -12
  const depth = signals.depth || 1;
  if (depth > 3) {
    penalty += Math.min(12, (depth - 3) * 3);
  }

  // 2.2 Repeated base table access paths: up to -18
  const repeated = signals.repeatedBaseTableCount || signals.repeatedCount || 0;
  if (repeated > 0) {
    penalty += Math.min(18, repeated * 6);
  }

  // 2.3 SELECT DISTINCT heuristic: -5
  if (signals.hasDistinct) {
    penalty += 5;
  }

  // 2.4 UNION without ALL heuristic: -6
  if (signals.hasUnionWithoutAll) {
    penalty += 6;
  }

  // 2.5 Window functions: -4
  if (signals.hasWindowFunctions) {
    penalty += 4;
  }

  // 2.6 Non-SARGable functions in predicate: up to -12
  const nonSargable = signals.nonSargableCount || 0;
  if (nonSargable > 0) {
    penalty += Math.min(12, nonSargable * 4);
  }

  // 2.7 Scalar UDF: up to -10
  const scalarUdf = signals.scalarUdfCount || 0;
  if (scalarUdf > 0) {
    penalty += Math.min(10, scalarUdf * 5);
  }

  // 2.8 Wildcard SELECT *: -3
  if (signals.hasWildcardSelect) {
    penalty += 3;
  }

  // 2.9 Leading wildcard LIKE: -4
  if (signals.hasLeadingWildcardLike) {
    penalty += 4;
  }

  // 2.10 Circular dependency: -20
  if (signals.cycleCount > 0) {
    penalty += 20;
  }

  // 2.11 Blast radius >= 10: up to -8
  const dependents = signals.dependentCount || signals.blastRadius || 0;
  if (dependents >= 10) {
    penalty += Math.min(8, Math.floor(dependents / 10) * 2);
  }

  const score = clamp(100 - penalty);
  const band = score >= 90 ? 'A' : (score >= 75 ? 'B' : (score >= 60 ? 'C' : (score >= 40 ? 'D' : 'F')));
  return {
    score,
    band,
    valueOf() { return this.score; },
    toString() { return String(this.score); }
  };
}

const DEFAULT_WEIGHTS = {
  runtimeWeight: 30,
  regressionWeight: 20,
  repeatedTableWeight: 20,
  repeatedWeight: 20,
  depthWeight: 15,
  blastRadiusWeight: 15,
  blastWeight: 15
};

function normalizeWeights(raw = {}) {
  const getVal = (keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') {
        const num = Number(raw[k]);
        if (Number.isFinite(num) && num >= 0) return num;
      }
    }
    return null;
  };

  const runtimeVal = getVal(['runtimeWeight', 'weightRuntime']);
  const regressionVal = getVal(['regressionWeight', 'weightRegression']);
  const repeatedVal = getVal(['repeatedTableWeight', 'repeatedWeight', 'weightRepeated']);
  const depthVal = getVal(['depthWeight', 'weightDepth']);
  const blastVal = getVal(['blastRadiusWeight', 'blastWeight', 'weightBlast']);
  const sargableVal = getVal(['sargableWeight', 'weightSargable']);

  const providedSum = (runtimeVal || 0) + (regressionVal || 0) + (repeatedVal || 0) + (depthVal || 0) + (blastVal || 0) + (sargableVal || 0);

  if (providedSum <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }

  const factor = 100 / providedSum;
  const rw = (runtimeVal != null ? runtimeVal : (sargableVal != null ? 0 : DEFAULT_WEIGHTS.runtimeWeight)) * factor;
  const regw = (regressionVal != null ? regressionVal : (sargableVal != null ? 0 : DEFAULT_WEIGHTS.regressionWeight)) * factor;
  const repw = (repeatedVal != null ? repeatedVal : (sargableVal != null ? 0 : DEFAULT_WEIGHTS.repeatedWeight)) * factor;
  const dw = (depthVal != null ? depthVal : (sargableVal != null ? 0 : DEFAULT_WEIGHTS.depthWeight)) * factor;
  const bw = (blastVal != null ? blastVal : (sargableVal != null ? 0 : DEFAULT_WEIGHTS.blastWeight)) * factor;
  const sw = sargableVal != null ? sargableVal * factor : 0;

  const res = {
    runtimeWeight: rw,
    weightRuntime: rw,
    regressionWeight: regw,
    weightRegression: regw,
    repeatedTableWeight: repw,
    repeatedWeight: repw,
    weightRepeated: repw,
    depthWeight: dw,
    weightDepth: dw,
    blastRadiusWeight: bw,
    blastWeight: bw,
    weightBlast: bw
  };
  if (sw > 0 || sargableVal != null) {
    res.sargableWeight = sw;
    res.weightSargable = sw;
  }
  return res;
}

function calculateRisk(options = {}, customWeights = null) {
  const depth = Number(options.depth != null ? options.depth : (options.maxDepth || 1)) || 1;
  const repeatedCount = Number(options.repeatedCount != null ? options.repeatedCount : (options.repeatedTableCount || options.repeatedBaseTableCount || 0)) || 0;
  const dependentCount = Number(options.dependentCount != null ? options.dependentCount : (options.blastRadius || 0)) || 0;
  const nonSargableCount = Number(options.nonSargableCount || 0) || 0;

  const weights = normalizeWeights(customWeights || options.weights || {});

  const totalReads = Number(
    options.totalReads != null
      ? options.totalReads
      : (options.reads != null
          ? options.reads
          : (options.runtime?.totalReads != null
              ? options.runtime.totalReads
              : (options.runtime?.avgLogicalReads != null
                  ? options.runtime.avgLogicalReads
                  : 0)))
  ) || 0;

  const isRegressed = Boolean(
    options.isRegressed != null
      ? options.isRegressed
      : (options.isRegression != null
          ? options.isRegression
          : (options.runtime?.isRegression != null
              ? options.runtime.isRegression
              : (options.runtime?.isRegressed != null
                  ? options.runtime.isRegressed
                  : (options.regression?.isRegressed != null
                      ? options.regression.isRegressed
                      : false))))
  );

  const regressionObj = options.regression || options.runtime?.regression || null;

  // 1. Runtime / Reads score
  const runtimeWeight = weights.runtimeWeight;
  let readsScore = 0;
  if (totalReads > 0) {
    const readsRatio = Math.min(1, Math.log10(Math.max(1, totalReads)) / 7);
    readsScore = readsRatio * runtimeWeight;
  }

  // 2. Regression score (proportional to severityScore if provided, else full weight)
  const regressionWeight = weights.regressionWeight;
  let regFactor = 0;
  if (regressionObj && typeof regressionObj.severityScore === 'number') {
    regFactor = Math.min(1, Math.max(0, regressionObj.severityScore / 100));
  } else if (isRegressed) {
    regFactor = 1;
  }
  const regressionScore = regFactor * regressionWeight;

  // 3. Repeated tables score
  const repeatedWeight = weights.repeatedTableWeight || weights.repeatedWeight;
  const repeatedScore = Math.min(repeatedWeight, (repeatedCount / 3) * repeatedWeight);

  // 4. Depth score
  const depthWeight = weights.depthWeight;
  const depthScore = Math.min(depthWeight, (Math.max(0, depth - 1) / 4) * depthWeight);

  // 5. Blast radius score
  const blastWeight = weights.blastRadiusWeight || weights.blastWeight;
  const blastScore = Math.min(blastWeight, (dependentCount / 20) * blastWeight);

  // 6. Non-SARGable score
  const sargableScore = Math.min(15, nonSargableCount * 2);

  const riskScore = clamp(readsScore + regressionScore + repeatedScore + depthScore + blastScore + sargableScore);

  let evidenceGrade = 'D';
  if (options.runtime?.evidenceGrade) {
    evidenceGrade = options.runtime.evidenceGrade;
  } else if (options.totalReads != null || options.reads != null || options.runtime != null) {
    evidenceGrade = 'B';
  }

  let level = 'LOW';
  let levelTr = 'DÜŞÜK';
  let category = 'low';
  let band = 'A';
  if (riskScore >= 75) {
    level = 'CRITICAL';
    levelTr = 'KRİTİK';
    category = 'critical';
    band = 'D';
  } else if (riskScore >= 55) {
    level = 'HIGH';
    levelTr = 'YÜKSEK';
    category = 'high';
    band = 'C';
  } else if (riskScore >= 35) {
    level = 'MEDIUM';
    levelTr = 'ORTA';
    category = 'medium';
    band = 'B';
  }

  return {
    score: isNaN(riskScore) ? 10 : riskScore,
    breakdown: {
      runtime: Math.round(readsScore * 100) / 100,
      regression: Math.round(regressionScore * 100) / 100,
      repeatedTables: Math.round(repeatedScore * 100) / 100,
      depth: Math.round(depthScore * 100) / 100,
      blastRadius: Math.round(blastScore * 100) / 100,
      sargable: Math.round(sargableScore * 100) / 100
    },
    level,
    levelTr,
    category,
    band,
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
} = {}, customWeights = null) {
  const normRisk = clamp(Number(riskScore) || 0);
  const normSev = clamp(Number(severityScore) || 0);
  const normReads = clamp(Math.round((Math.log10(Math.max(1, Number(totalReads) || 0)) / 7) * 100));
  const normBlast = clamp(Math.round(((Number(blastRadius) || 0) / 20) * 100));

  const riskW = customWeights?.riskWeight !== undefined ? customWeights.riskWeight : 0.35;
  const sevW = customWeights?.severityWeight !== undefined ? customWeights.severityWeight : 0.35;
  const readsW = customWeights?.readsWeight !== undefined ? customWeights.readsWeight : 0.20;
  const blastW = customWeights?.blastRadiusWeight !== undefined ? customWeights.blastRadiusWeight : 0.10;

  const opportunity = (normRisk * riskW) + (normSev * sevW) + (normReads * readsW) + (normBlast * blastW);
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
