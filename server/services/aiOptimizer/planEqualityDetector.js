/**
 * SQL Server Refactoring & Performance Studio
 * Plan Equality & Ineffective Change Detector
 *
 * Implements:
 * - Structural operator topology comparison (scans, seeks, joins, sorts, spools, lookups)
 * - Separation of Structural Plan Equality from Measured Performance
 * - Estimated subtree cost is strictly treated as supporting metadata (no speedup inference)
 * - Guardrail: "Seek > Scan" assumption is forbidden; access path appropriateness is evaluated with logical work
 * - Centralized noise band evaluation for measured metrics
 */

const { isMeaningfulChange } = require('./performanceThresholds');

/**
 * Extracts a structural fingerprint of an execution plan.
 */
function extractPlanFingerprint(plan = {}) {
  const ops = plan.operators || [];
  
  const scanTargets = ops.filter(o => o.isScan).map(o => o.targetObject || o.name).sort();
  const seekTargets = ops.filter(o => o.isSeek).map(o => o.targetObject || o.name).sort();
  const lookupTargets = ops.filter(o => o.isLookup).map(o => o.targetObject || o.name).sort();
  const joinTypes = ops.filter(o => o.category === 'JOIN').map(o => o.physicalOp || o.name).sort();
  const spoolsCount = ops.filter(o => o.category === 'SPOOL').length;
  const sortsCount = ops.filter(o => o.category === 'SORT').length;
  const warningsCount = (plan.warnings || []).length;

  return {
    scansCount: scanTargets.length,
    seeksCount: seekTargets.length,
    lookupsCount: lookupTargets.length,
    scanTargets,
    seekTargets,
    lookupTargets,
    joinTypes,
    spoolsCount,
    sortsCount,
    warningsCount,
    totalSubTreeCost: Number(plan.totalSubTreeCost || plan.planMetadata?.totalSubTreeCost || 0)
  };
}

/**
 * Compares two execution plans and optional measured benchmark metrics.
 */
function detectPlanEquality({
  originalPlan = {},
  candidatePlan = {},
  measuredMetrics = null
} = {}) {
  const fpOrig = extractPlanFingerprint(originalPlan);
  const fpCand = extractPlanFingerprint(candidatePlan);
  const reasons = [];

  // 1. Structural Comparison
  const sameScans = fpOrig.scansCount === fpCand.scansCount &&
    JSON.stringify(fpOrig.scanTargets) === JSON.stringify(fpCand.scanTargets);
  const sameSeeks = fpOrig.seeksCount === fpCand.seeksCount &&
    JSON.stringify(fpOrig.seekTargets) === JSON.stringify(fpCand.seekTargets);
  const sameLookups = fpOrig.lookupsCount === fpCand.lookupsCount &&
    JSON.stringify(fpOrig.lookupTargets) === JSON.stringify(fpCand.lookupTargets);
  const sameJoins = fpOrig.joinTypes.length === fpCand.joinTypes.length &&
    JSON.stringify(fpOrig.joinTypes) === JSON.stringify(fpCand.joinTypes);
  const sameSpools = fpOrig.spoolsCount === fpCand.spoolsCount;
  const sameSorts = fpOrig.sortsCount === fpCand.sortsCount;
  const sameWarnings = fpOrig.warningsCount === fpCand.warningsCount;

  const isStructurallyIdentical = sameScans && sameSeeks && sameLookups && sameJoins && sameSpools && sameSorts && sameWarnings;

  if (isStructurallyIdentical) {
    reasons.push('Plan operatör ağacı, erişim metotları (Scan/Seek/Lookup) ve join tipleri birebir aynıdır.');
  } else {
    if (!sameScans) reasons.push(`Tarama (Scan) operatörlerinde değişim: ${fpOrig.scansCount} -> ${fpCand.scansCount}`);
    if (!sameSeeks) reasons.push(`Seek operatörlerinde değişim: ${fpOrig.seeksCount} -> ${fpCand.seeksCount}`);
    if (!sameLookups) reasons.push(`Lookup operatörlerinde değişim: ${fpOrig.lookupsCount} -> ${fpCand.lookupsCount}`);
    if (!sameJoins) reasons.push('Join algoritmalarında (Hash/Merge/Nested Loops) yapısal değişim saptandı.');
    if (!sameSpools) reasons.push(`Spool operatörlerinde değişim: ${fpOrig.spoolsCount} -> ${fpCand.spoolsCount}`);
    if (!sameSorts) reasons.push(`Sort operatörlerinde değişim: ${fpOrig.sortsCount} -> ${fpCand.sortsCount}`);
  }

  // 2. Measured Metrics Comparison (if provided)
  let isMeasuredDifferent = false;
  let readsMeaningful = false;
  let cpuMeaningful = false;
  let durMeaningful = false;

  if (measuredMetrics) {
    const { origReads = 0, candReads = 0, origCpu = 0, candCpu = 0, origDuration = 0, candDuration = 0 } = measuredMetrics;

    readsMeaningful = isMeaningfulChange('logicalReads', origReads, candReads);
    cpuMeaningful = isMeaningfulChange('cpuMs', origCpu, candCpu);
    durMeaningful = isMeaningfulChange('durationMs', origDuration, candDuration);

    isMeasuredDifferent = readsMeaningful || cpuMeaningful || durMeaningful;

    if (!isMeasuredDifferent) {
      reasons.push('Ölçülen Logical Reads, CPU ve Süre metrikleri gürültü bandı (noise band) içindedir; belirgin bir fark yoktur.');
    } else {
      if (readsMeaningful) {
        const readsDeltaPct = origReads > 0 ? Math.round(((candReads - origReads) / origReads) * 100) : 0;
        reasons.push(`Logical Reads gürültü bandı dışında anlamlı değişim sergiledi (%${readsDeltaPct}).`);
      }
      if (cpuMeaningful) {
        reasons.push('CPU tüketimi gürültü bandı dışında anlamlı değişim sergiledi.');
      }
    }
  }

  // 3. Estimated Cost Note (Pure supporting metadata)
  const costDelta = fpCand.totalSubTreeCost - fpOrig.totalSubTreeCost;
  const costDeltaPct = fpOrig.totalSubTreeCost > 0 ? Math.round((costDelta / fpOrig.totalSubTreeCost) * 100) : 0;
  const costNote = `Tahmini SubTree Cost: ${fpOrig.totalSubTreeCost.toFixed(3)} -> ${fpCand.totalSubTreeCost.toFixed(3)} (%${costDeltaPct}). (Not: Tahmini maliyet ölçülmüş performans kanıtı yerine geçmez).`;

  // 4. Final Determination
  // If plan is structurally identical AND measured metrics are either not given or inside noise band:
  const isNoMeaningfulPlanChange = isStructurallyIdentical && (!measuredMetrics || !isMeasuredDifferent);

  return {
    status: isNoMeaningfulPlanChange ? 'NO_MEANINGFUL_PLAN_CHANGE' : 'MEANINGFUL_PLAN_CHANGE',
    isMeaningfulChange: !isNoMeaningfulPlanChange,
    isStructurallyIdentical,
    isMeasuredDifferent,
    metricsDeltas: {
      readsMeaningful,
      cpuMeaningful,
      durMeaningful
    },
    fingerprintOriginal: fpOrig,
    fingerprintCandidate: fpCand,
    costNote,
    reasons,
    summary: isNoMeaningfulPlanChange
      ? 'Aday sorgu orijinali ile aynı yürütme planını ve kaynak tüketimini üretmektedir (Optimizer etkisi yok).'
      : 'Aday sorgu ile orijinal arasında yürütme planı veya kaynak tüketimi düzeyinde anlamlı fark tespit edildi.'
  };
}

module.exports = {
  detectPlanEquality,
  extractPlanFingerprint
};
