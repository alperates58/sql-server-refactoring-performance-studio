/**
 * SQL Server Refactoring & Performance Studio
 * Deterministic Root Cause Classifier (Multi-Cause Architecture)
 *
 * Implements:
 * - Deterministic bottleneck classification across AST, Plan, Indexes, and Metrics
 * - Multi-cause model: primaryCause + contributingCauses[] + evidence[]
 * - Cautious NEEDS_INDEX_CHANGE rule:
 *    * SARGable query + weak index coverage + plan scan => NEEDS_INDEX_CHANGE
 *    * Non-SARGable query + missing index => primaryCause QUERY_SHAPE, contributing INDEX_ACCESS (rewrite first!)
 * - Function-on-join collation sensitivity guardrail
 * - Statistics & Cardinality recognition
 */

function classifyRootCause({
  sql = '',
  ast = null,
  astAnalysis = null,
  estimatedPlan = null,
  indexCoverage = null,
  missingIndexes = [],
  queryStoreSummary = null,
  tableRowsApprox = {},
  hasCollationEvidence = false
} = {}) {
  const contributingCauses = new Set();
  const evidence = [];
  const reasons = [];

  const findings = astAnalysis?.findings || [];
  const planWarnings = estimatedPlan?.warnings || [];
  const cardinalityMismatches = estimatedPlan?.cardinalityMismatches || [];
  const planOps = estimatedPlan?.operators || [];

  // 1. Structural / Query Shape Evidence
  const sargFindings = findings.filter(f => f.category === 'indexing' && f.severity === 'HIGH');
  const subqueryFindings = findings.filter(f => f.code === 'CORRELATED_SCALAR_SUBQUERY');
  const cartesianFindings = findings.filter(f => f.code === 'NO_JOIN_PREDICATE');
  const repeatedScanFindings = findings.filter(f => f.code === 'REPEATED_CTE_REFERENCE');
  const funcOnJoinFindings = findings.filter(f => f.code === 'FUNCTION_ON_JOIN_COLUMN');

  const hasHighShapeFindings = sargFindings.length > 0 || subqueryFindings.length > 0 || cartesianFindings.length > 0 || repeatedScanFindings.length > 0;

  if (sargFindings.length > 0) {
    contributingCauses.add('QUERY_SHAPE');
    evidence.push({
      type: 'NON_SARGABLE_PREDICATES',
      count: sargFindings.length,
      detail: sargFindings.map(f => f.title).join('; ')
    });
    reasons.push(`Sorguda indeks aramasına engel olan ${sargFindings.length} adet non-SARGable filtre fonksiyonu tespit edildi.`);
  }

  if (subqueryFindings.length > 0) {
    contributingCauses.add('QUERY_SHAPE');
    evidence.push({
      type: 'CORRELATED_SUBQUERY',
      count: subqueryFindings.length,
      detail: subqueryFindings[0].expression
    });
    reasons.push('Her dış satır için tekrar eden ilişkili (correlated) skalar alt sorgu I/O baskısı yaratıyor.');
  }

  // Guardrail 4: Function on join collation caution
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

  // 2. Cardinality & Statistics Evidence
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

  // 3. Index Access Evidence
  const hasPlanScans = planOps.some(o => o.isScan);
  const planMissingIndexes = estimatedPlan?.missingIndexes || [];
  const allMissingIndexes = [...missingIndexes, ...planMissingIndexes];

  const hasIndexDeficiency = (indexCoverage && indexCoverage.some(c => c.status === 'NONE' || c.status === 'PARTIAL')) || allMissingIndexes.length > 0;

  if (hasIndexDeficiency && hasPlanScans) {
    contributingCauses.add('INDEX_ACCESS');
    evidence.push({
      type: 'INDEX_COVERAGE_DEFICIENCY',
      missingIndexCount: allMissingIndexes.length,
      scansInPlan: planOps.filter(o => o.isScan).length
    });
    reasons.push('Fiziksel planda tablo/küme taranıyor (Scan) ve uygun covering indeks bulunmuyor.');
  }

  // 4. Large Cardinality / Data Volume
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

  // -------------------------------------------------------------
  // PRIMARY CAUSE SELECTION & SUGGESTED STATUS
  // -------------------------------------------------------------
  let primaryCause = 'UNKNOWN';
  let suggestedStatus = 'CANDIDATE_GENERATED';
  let confidence = 'MEDIUM';

  // CASE 1: Query Shape is problematic (even if index is also missing)
  if (hasHighShapeFindings) {
    primaryCause = 'QUERY_SHAPE';
    suggestedStatus = 'CANDIDATE_GENERATED';
    confidence = 'HIGH';
    if (contributingCauses.has('INDEX_ACCESS')) {
      reasons.push('Öncelik: Non-SARGable / yapısal filtreler SQL seviyesinde düzeltilmeli; ardından eksik indeksler değerlendirilmelidir.');
    }
  }
  // CASE 2: Query is already clean/SARGable, but has severe index deficiency
  else if (contributingCauses.has('INDEX_ACCESS') && !hasHighShapeFindings) {
    primaryCause = 'INDEX_ACCESS';
    confidence = 'HIGH';
    // Strict Cautious NEEDS_INDEX_CHANGE check
    suggestedStatus = 'NEEDS_INDEX_CHANGE';
    reasons.push('Sorgu yapısı zaten SARGable ve biçimsel olarak düzgündür. Ana performans darboğazı eksik indeks erişimidir (SQL rewrite ile anlamlı kazanç beklenmez).');
  }
  // CASE 3: Stale Statistics dominate
  else if (contributingCauses.has('STATISTICS') && !hasHighShapeFindings) {
    primaryCause = 'STATISTICS';
    suggestedStatus = 'NEEDS_STATISTICS_ATTENTION';
    confidence = 'HIGH';
    reasons.push('Kardinalite sapması nedeniyle optimizatör yanlış plan seçmektedir; istatistik güncellemesi (UPDATE STATISTICS) önerilir.');
  }
  // CASE 4: Volume / Heavy Aggregation
  else if (contributingCauses.has('CARDINALITY')) {
    primaryCause = 'CARDINALITY';
    suggestedStatus = 'CANDIDATE_GENERATED';
    confidence = 'MEDIUM';
  }
  // CASE 5: Already optimal query
  else if (findings.length === 0 && !hasPlanScans) {
    primaryCause = 'QUERY_SHAPE';
    suggestedStatus = 'NO_SAFE_OPTIMIZATION_FOUND';
    confidence = 'HIGH';
    reasons.push('Sorgu zaten optimize edilmiş durumda; güvenli bir yapısal rewrite ihtiyacı bulunmuyor.');
  } else {
    primaryCause = contributingCauses.values().next().value || 'UNKNOWN';
    suggestedStatus = 'INSUFFICIENT_EVIDENCE';
    confidence = 'LOW';
  }

  // Clean contributing causes so primary is not duplicated
  contributingCauses.delete(primaryCause);

  return {
    primaryCause,
    contributingCauses: [...contributingCauses],
    confidence,
    evidenceGrade: confidence === 'HIGH' ? 'A' : (confidence === 'MEDIUM' ? 'B' : 'C'),
    suggestedStatus,
    reasons,
    evidence,
    missingIndexEvidence: allMissingIndexes.slice(0, 3)
  };
}

module.exports = {
  classifyRootCause
};
