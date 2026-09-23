/**
 * SQL Server Refactoring & Performance Studio
 * Deterministic Root Cause Classifier (Multi-Cause Architecture — Sprint 10 Expert Mode)
 *
 * Implements:
 * - Dual Optimization Tracks:
 *   Track A: Physical Access (missing index, index coverage, scans, lookups, statistics, cardinality)
 *   Track B: Query Shape Review (repeated access, non-SARGable functions, redundant joins, late aggregation, expressions)
 * - INDEX_ACCESS is NO LONGER a hard stop for Query Shape Review!
 * - Four explicit architectural outcomes:
 *   A) INDEX_ACCESS_ONLY (Strictly when query shape is 100% clean and SARGable)
 *   B) INDEX_ACCESS_WITH_REWRITE_OPPORTUNITY (Index deficiency + Query Shape rewrite opportunity)
 *   C) QUERY_SHAPE_PRIMARY_WITH_INDEX_SUPPORT (Query shape is primary bottleneck, index also recommended)
 *   D) NO_SAFE_REWRITE (Already optimal query)
 */

const { reviewQueryShape } = require('./queryShapeReview');

function classifyRootCause({
  sql = '',
  ast = null,
  astAnalysis = null,
  estimatedPlan = null,
  indexCoverage = null,
  missingIndexes = [],
  queryStoreSummary = null,
  tableRowsApprox = {},
  hasCollationEvidence = false,
  logicalReads = 0
} = {}) {
  const contributingCauses = new Set();
  const evidence = [];
  const reasons = [];

  const findings = astAnalysis?.findings || [];
  const planWarnings = estimatedPlan?.warnings || [];
  const cardinalityMismatches = estimatedPlan?.cardinalityMismatches || [];
  const planOps = estimatedPlan?.operators || [];

  // =============================================================
  // TRACK A: PHYSICAL ACCESS EVALUATION
  // =============================================================
  const planScans = planOps.filter(o => o.isScan);
  const hasPlanScans = planScans.length > 0;
  const planMissingIndexes = estimatedPlan?.missingIndexes || [];
  const allMissingIndexes = [...missingIndexes, ...planMissingIndexes];

  const hasIndexDeficiency = (indexCoverage && indexCoverage.some(c => c.status === 'NONE' || c.status === 'PARTIAL')) || allMissingIndexes.length > 0;

  if (hasIndexDeficiency && hasPlanScans) {
    contributingCauses.add('INDEX_ACCESS');
    evidence.push({
      type: 'INDEX_COVERAGE_DEFICIENCY',
      missingIndexCount: allMissingIndexes.length,
      scansInPlan: planScans.length,
      detail: `Fiziksel planda ${planScans.length} adet Scan operatörü ve ${allMissingIndexes.length} adet eksik indeks sinyali saptandı.`
    });
    reasons.push('Fiziksel planda tablo/küme taranıyor (Scan) ve uygun covering indeks bulunmuyor.');
  }

  // Cardinality & Statistics Evidence
  const severeCardMismatches = cardinalityMismatches.filter(c => c.mismatchFactor >= 10 || c.ratio >= 10);
  if (severeCardMismatches.length > 0) {
    contributingCauses.add('STATISTICS');
    evidence.push({
      type: 'CARDINALITY_MISMATCH',
      count: severeCardMismatches.length,
      maxFactor: Math.max(...severeCardMismatches.map(c => c.mismatchFactor || c.ratio || 0))
    });
    reasons.push('Planda tahmini satır sayısı ile gerçek/istatistiki satır sayısı arasında 10x üzerinde kardinalite uyumsuzluğu saptandı.');
  }

  // Large Data Volume
  let totalApproxRows = 0;
  for (const count of Object.values(tableRowsApprox || {})) {
    totalApproxRows += Number(count) || 0;
  }
  if (totalApproxRows >= 5000000) {
    contributingCauses.add('CARDINALITY');
    evidence.push({
      type: 'HIGH_DATA_VOLUME',
      approxRows: totalApproxRows
    });
    reasons.push(`Sorgulanan tablolarda yaklaşık ${totalApproxRows.toLocaleString()} satır bulunuyor.`);
  }

  const trackA = {
    hasIndexDeficiency,
    hasPlanScans,
    scansCount: planScans.length,
    missingIndexesCount: allMissingIndexes.length,
    severeCardMismatchesCount: severeCardMismatches.length,
    totalApproxRows
  };

  // =============================================================
  // TRACK B: QUERY SHAPE REVIEW (DETERMINISTIC 16-POINT ENGINE)
  // =============================================================
  const shapeReview = reviewQueryShape({
    sql,
    ast,
    logicalReads: logicalReads || queryStoreSummary?.avgLogicalReads || 0,
    estimatedCost: estimatedPlan?.totalSubTreeCost || 0,
    tableRowsApprox
  });

  const queryShapeOpportunities = shapeReview.opportunities;
  const hasShapeOpportunities = shapeReview.hasOpportunities;

  // Integrate AST structural findings
  const sargFindings = findings.filter(f => f.category === 'indexing' && f.severity === 'HIGH');
  const subqueryFindings = findings.filter(f => f.code === 'CORRELATED_SCALAR_SUBQUERY');
  const cartesianFindings = findings.filter(f => f.code === 'NO_JOIN_PREDICATE');
  const repeatedScanFindings = findings.filter(f => f.code === 'REPEATED_CTE_REFERENCE');
  const funcOnJoinFindings = findings.filter(f => f.code === 'FUNCTION_ON_JOIN_COLUMN');

  const hasHighShapeFindings = hasShapeOpportunities || sargFindings.length > 0 || subqueryFindings.length > 0 || cartesianFindings.length > 0 || repeatedScanFindings.length > 0;

  if (hasHighShapeFindings) {
    contributingCauses.add('QUERY_SHAPE');
    queryShapeOpportunities.forEach(opp => {
      evidence.push({
        type: opp.type,
        detail: opp.detail
      });
      reasons.push(opp.detail);
    });
  }

  // Guardrail: Function on join collation caution
  if (funcOnJoinFindings.length > 0) {
    if (!hasCollationEvidence) {
      evidence.push({
        type: 'FUNCTION_ON_JOIN_UNCERTAIN_COLLATION',
        detail: 'JOIN kolonunda fonksiyon mevcut, ancak kolon ve veritabanı collation duyarlılığı doğrulanmadı.'
      });
      reasons.push('JOIN koşulundaki fonksiyon (UPPER/LOWER) collation kanıtı olmadan körlemesine kaldırılamaz (semantik sapma riski).');
    } else {
      contributingCauses.add('QUERY_SHAPE');
      reasons.push('JOIN koşulunda indeks seek kullanımını bozan fonksiyon çağrısı mevcut.');
    }
  }

  const trackB = {
    hasOpportunities: hasHighShapeFindings,
    opportunities: queryShapeOpportunities,
    opportunitiesCount: queryShapeOpportunities.length,
    originalShape: shapeReview.originalShape,
    highReadsClass: shapeReview.highReadsClass,
    warnings: shapeReview.warnings
  };

  // =============================================================
  // DUAL-TRACK ARCHITECTURAL SYNTHESIS (NO HARD STOP!)
  // =============================================================
  let primaryCause = 'UNKNOWN';
  let suggestedStatus = 'CANDIDATE_GENERATED';
  let confidence = 'MEDIUM';
  let rewriteOpportunity = false;
  let indexStillRecommended = false;

  const hasIndexDefect = contributingCauses.has('INDEX_ACCESS');
  const hasShapeDefect = contributingCauses.has('QUERY_SHAPE');
  const hasStatsDefect = contributingCauses.has('STATISTICS');

  if (hasIndexDefect) {
    indexStillRecommended = true;
  }

  // OUTCOME B: INDEX_ACCESS WITH REWRITE OPPORTUNITY
  if (hasIndexDefect && hasShapeDefect) {
    // Both tracks flagged bottlenecks!
    primaryCause = 'INDEX_ACCESS';
    contributingCauses.add('QUERY_SHAPE');
    suggestedStatus = 'INDEX_ACCESS_WITH_REWRITE_OPPORTUNITY';
    confidence = 'HIGH';
    rewriteOpportunity = true;
    indexStillRecommended = true;
    reasons.unshift('Darboğaz İkili Teşhisi: Fiziksel tabloda indeks eksikliği mevcut, ANCAK sorgu yapısında (Query Shape) bağımsız yapısal iyileştirme fırsatları tespit edildi.');
  }
  // OUTCOME C: QUERY_SHAPE PRIMARY WITH INDEX SUPPORT
  else if (hasShapeDefect && !hasIndexDefect) {
    primaryCause = 'QUERY_SHAPE';
    suggestedStatus = 'CANDIDATE_GENERATED';
    confidence = 'HIGH';
    rewriteOpportunity = true;
    indexStillRecommended = false;
    reasons.unshift('Ana Darboğaz: Sorgunun ilişkisel yapısı (Query Shape, SARGability, mükerrer taramalar) iyileştirilmelidir.');
  }
  // OUTCOME A: INDEX_ACCESS_ONLY (Strictly only when query is clean and has NO shape opportunities!)
  else if (hasIndexDefect && !hasShapeDefect) {
    primaryCause = 'INDEX_ACCESS';
    suggestedStatus = 'NEEDS_INDEX_CHANGE';
    confidence = 'HIGH';
    rewriteOpportunity = false;
    indexStillRecommended = true;
    reasons.push('Sorgu yapısı zaten SARGable ve biçimsel olarak düzgündür. Hiçbir ilişkisel rewrite fırsatı (mükerrer tarama, non-SARGable filtre, gereksiz join) bulunmamaktadır. Ana darboğaz salt eksik indeks erişimidir.');
  }
  // OUTCOME D: Stale Statistics dominate
  else if (hasStatsDefect && !hasShapeDefect) {
    primaryCause = 'STATISTICS';
    suggestedStatus = 'NEEDS_STATISTICS_ATTENTION';
    confidence = 'HIGH';
    rewriteOpportunity = false;
    reasons.push('Kardinalite sapması nedeniyle optimizatör yanlış plan seçmektedir; istatistik güncellemesi (UPDATE STATISTICS) önerilir.');
  }
  // OUTCOME E: Already optimal query
  else if (findings.length === 0 && !hasPlanScans && !hasShapeDefect) {
    primaryCause = 'QUERY_SHAPE';
    suggestedStatus = 'NO_SAFE_OPTIMIZATION_FOUND';
    confidence = 'HIGH';
    rewriteOpportunity = false;
    reasons.push('Sorgu mevcut şema ve indeksler altında zaten optimize durumdadır; güvenli bir rewrite ihtiyacı bulunmuyor.');
  } else {
    primaryCause = contributingCauses.values().next().value || 'UNKNOWN';
    suggestedStatus = hasShapeDefect ? 'CANDIDATE_GENERATED' : 'INSUFFICIENT_EVIDENCE';
    confidence = 'LOW';
    rewriteOpportunity = hasShapeDefect;
  }

  // Clean contributing causes so primary is not duplicated
  contributingCauses.delete(primaryCause);

  return {
    primaryCause,
    contributingCauses: [...contributingCauses],
    confidence,
    evidenceGrade: confidence === 'HIGH' ? 'A' : (confidence === 'MEDIUM' ? 'B' : 'C'),
    suggestedStatus,
    rewriteOpportunity,
    indexStillRecommended,
    reasons,
    evidence,
    missingIndexEvidence: allMissingIndexes.slice(0, 3),
    trackA,
    trackB,
    queryShapeOpportunities
  };
}

module.exports = {
  classifyRootCause
};
