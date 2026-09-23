/**
 * SQL Server Refactoring & Performance Studio
 * Performance Thresholds & Benchmark Load Guard
 *
 * Implements:
 * - Metric-specific noise bands (reads, CPU, duration with absolute floors)
 * - Centralized STRONG_SAFE_IMPROVEMENT evaluation policy
 * - Iterative Benchmark Load Guard (protects production from heavy multi-run execution)
 */

const PERFORMANCE_THRESHOLDS = {
  logicalReads: {
    relativeThresholdPercent: 5.0,  // ±5%
    absoluteFloorPages: 50          // Under 50 pages is cache/system noise
  },
  cpuMs: {
    relativeThresholdPercent: 10.0, // ±10%
    absoluteFloorMs: 15             // Under 15ms is scheduling jitter
  },
  durationMs: {
    relativeThresholdPercent: 10.0, // ±10%
    absoluteFloorMs: 25             // Under 25ms is timer resolution noise
  },
  // Minimum improvement required for regular candidate acceptance
  meaningfulImprovement: {
    minReadsPercent: 10.0,
    minCpuPercent: 10.0,
    minDurationPercent: 15.0
  },
  // Strong improvement policy: qualifies for early stopping
  strongSafeImprovement: {
    primaryReadsPercent: 20.0,
    balancedReadsPercent: 15.0,
    balancedCpuPercent: 15.0,
    hybridReadsPercent: 10.0,
    hybridDurationPercent: 25.0
  },
  // Benchmark Load Guard limits
  loadGuard: {
    maxSubtreeCostSafe: 10.0,
    maxSubtreeCostCaution: 50.0,
    maxTableRowsSafe: 1000000,
    maxTableRowsCaution: 5000000,
    maxDurationMsSafe: 3000,
    maxDurationMsCaution: 10000
  }
};

/**
 * Checks if a metric delta is outside the noise band and statistically meaningful.
 */
function isMeaningfulChange(metricKey, originalVal, candidateVal) {
  const orig = Number(originalVal) || 0;
  const cand = Number(candidateVal) || 0;
  const cfg = PERFORMANCE_THRESHOLDS[metricKey] || PERFORMANCE_THRESHOLDS.durationMs;

  const delta = Math.abs(cand - orig);
  if (delta < cfg.absoluteFloorPages || delta < cfg.absoluteFloorMs) {
    return false;
  }

  if (orig <= 0) {
    return cand > (cfg.absoluteFloorPages || cfg.absoluteFloorMs);
  }

  const pct = (delta / orig) * 100;
  return pct >= cfg.relativeThresholdPercent;
}

/**
 * Evaluates whether a candidate qualifies for early stopping (STRONG_SAFE_IMPROVEMENT).
 * Evaluates multi-metric combinations instead of a single hardcoded percentage.
 */
function evaluateStrongSafeImprovement({
  validation = {},
  benchmarkComparison = {},
  planComparison = {},
  addressedFindings = [],
  majorBottlenecksCount = 1
} = {}) {
  const valStatus = (validation.status || '').toUpperCase();
  const isValPass = valStatus === 'PASS' || (valStatus === 'WARNING' && validation.rowCountsMatch !== false);
  if (!isValPass) {
    return { isStrong: false, reason: 'Doğrulama tam başarılı değil.' };
  }

  if (benchmarkComparison.isRowCountEqual === false) {
    return { isStrong: false, reason: 'Satır sayısı uyuşmuyor.' };
  }

  const improvements = benchmarkComparison.improvements || {};
  const readsImpr = Number(improvements.readsPercent) || 0;
  const cpuImpr = Number(improvements.cpuPercent) || 0;
  const durImpr = Number(improvements.durationPercent) || 0;

  // Plan safety: no new spills or unindexed joins added
  const planChanges = planComparison.changes || [];
  const hasSpillAdded = planChanges.some(c => c.code === 'TEMPDB_SPILL_ADDED');
  const hasScanAdded = planChanges.some(c => c.code === 'TABLE_SCAN_ADDED');
  if (hasSpillAdded) {
    return { isStrong: false, reason: 'Aday planda TempDB Spill uyarısı eklendi.' };
  }

  // Regression check on reads
  if (readsImpr < -PERFORMANCE_THRESHOLDS.logicalReads.relativeThresholdPercent) {
    return { isStrong: false, reason: 'Logical reads regresyonu tespit edildi.' };
  }

  const cfg = PERFORMANCE_THRESHOLDS.strongSafeImprovement;
  let metricSatisfied = false;
  let rationale = '';

  // Condition A: High read reduction (>= 20%)
  if (readsImpr >= cfg.primaryReadsPercent) {
    metricSatisfied = true;
    rationale = `Logical reads %${readsImpr} oranında belirgin biçimde azaldı.`;
  }
  // Condition B: Balanced reduction (Reads >= 15% AND CPU >= 15%)
  else if (readsImpr >= cfg.balancedReadsPercent && cpuImpr >= cfg.balancedCpuPercent) {
    metricSatisfied = true;
    rationale = `Dengeli kaynak iyileşmesi (Reads: %${readsImpr}, CPU: %${cpuImpr}).`;
  }
  // Condition C: Hybrid reduction (Reads >= 10% AND Duration >= 25%)
  else if (readsImpr >= cfg.hybridReadsPercent && durImpr >= cfg.hybridDurationPercent) {
    metricSatisfied = true;
    rationale = `Hibrit I/O ve süre iyileşmesi (Reads: %${readsImpr}, Süre: %${durImpr}).`;
  }

  if (!metricSatisfied) {
    return {
      isStrong: false,
      reason: `Ölçülen iyileşme güçlü erken durdurma eşiklerini karşılamıyor (Reads: %${readsImpr}, CPU: %${cpuImpr}, Süre: %${durImpr}).`
    };
  }

  // Bottleneck addressed check: at least one finding addressed or major plan improvement
  const hasPlanPositive = planChanges.some(c => c.significance === 'POSITIVE');
  const hasAddressedFinding = (addressedFindings || []).length > 0;
  if (!hasPlanPositive && !hasAddressedFinding) {
    return {
      isStrong: false,
      reason: 'Planda veya tespit edilen darboğazlarda yapısal çözüm kanıtı yetersiz.'
    };
  }

  return {
    isStrong: true,
    rationale,
    metrics: { readsImpr, cpuImpr, durImpr },
    addressedFindingsCount: (addressedFindings || []).length
  };
}

/**
 * Iterative Benchmark Load Guard.
 * Protects production databases from running heavy multi-iteration benchmarks.
 */
function evaluateBenchmarkSafety({
  estimatedPlan = null,
  queryStoreSummary = null,
  tableRowsApprox = {}
} = {}) {
  const reasons = [];
  let isHeavy = false;
  let isMedium = false;

  // 1. Estimated Subtree Cost
  const cost = estimatedPlan?.totalSubTreeCost || estimatedPlan?.planMetadata?.totalSubTreeCost || 0;
  if (cost >= PERFORMANCE_THRESHOLDS.loadGuard.maxSubtreeCostCaution) {
    isHeavy = true;
    reasons.push(`Tahmini plan maliyeti çok yüksek (${cost.toFixed(1)} >= ${PERFORMANCE_THRESHOLDS.loadGuard.maxSubtreeCostCaution}).`);
  } else if (cost >= PERFORMANCE_THRESHOLDS.loadGuard.maxSubtreeCostSafe) {
    isMedium = true;
    reasons.push(`Tahmini plan maliyeti orta-yüksek (${cost.toFixed(1)}).`);
  }

  // 2. Table Row Counts (Approximate from partition stats)
  let maxTableRows = 0;
  for (const [tbl, count] of Object.entries(tableRowsApprox || {})) {
    const num = Number(count) || 0;
    if (num > maxTableRows) maxTableRows = num;
  }
  if (maxTableRows >= PERFORMANCE_THRESHOLDS.loadGuard.maxTableRowsCaution) {
    isHeavy = true;
    reasons.push(`Hedef tablolarda dev veri hacmi mevcut (~${maxTableRows.toLocaleString()} satır).`);
  } else if (maxTableRows >= PERFORMANCE_THRESHOLDS.loadGuard.maxTableRowsSafe) {
    isMedium = true;
    reasons.push(`Hedef tablolarda yüksek satır sayısı mevcut (~${maxTableRows.toLocaleString()} satır).`);
  }

  // 3. Query Store Historical Duration
  const qsDuration = queryStoreSummary?.avgDurationMs || queryStoreSummary?.medianDurationMs || 0;
  if (qsDuration >= PERFORMANCE_THRESHOLDS.loadGuard.maxDurationMsCaution) {
    isHeavy = true;
    reasons.push(`Query Store geçmişinde ortalama çalışma süresi çok uzun (${Math.round(qsDuration)}ms).`);
  } else if (qsDuration >= PERFORMANCE_THRESHOLDS.loadGuard.maxDurationMsSafe) {
    isMedium = true;
    reasons.push(`Query Store geçmişinde ortalama süre ${Math.round(qsDuration)}ms.`);
  }

  let safetyLevel = 'SAFE';
  let allowedRunsPerIteration = 6; // Standard A/B/B/A/A/B (3 each)
  let canAutoExecute = true;

  if (isHeavy) {
    safetyLevel = 'REQUIRES_USER_CONFIRMATION';
    allowedRunsPerIteration = 0;
    canAutoExecute = false;
  } else if (isMedium) {
    safetyLevel = 'CAUTION';
    allowedRunsPerIteration = 2; // Single A/B run to limit pressure
    canAutoExecute = true;
  }

  return {
    safetyLevel, // 'SAFE' | 'CAUTION' | 'REQUIRES_USER_CONFIRMATION'
    canAutoExecute,
    allowedRunsPerIteration,
    estimatedCost: cost,
    maxTableRows,
    qsDurationMs: qsDuration,
    reasons: reasons.length ? reasons : ['Sorgu kaynak profili güvenli aralıkta.']
  };
}

module.exports = {
  PERFORMANCE_THRESHOLDS,
  isMeaningfulChange,
  evaluateStrongSafeImprovement,
  evaluateBenchmarkSafety
};
