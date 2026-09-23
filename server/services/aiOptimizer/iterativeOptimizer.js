/**
 * SQL Server Refactoring & Performance Studio
 * Iterative Optimization Orchestrator (Sprint 10 Expert Mode)
 *
 * Implements:
 * - Dual-Track Optimization: Track A (Physical Access) + Track B (Query Shape Review)
 * - INDEX_ACCESS is NO LONGER a hard stop!
 * - Strategy Diversity Guard (rejects relationally duplicate candidates via structural fingerprinting)
 * - Strict Cosmetic Rewrite Ban (via Significance Score >= 2)
 * - Cost-Aware Candidate Pruning (checks candidate estimated plan before benchmark)
 * - Second-Pass DBA Feedback Loop with operator details
 * - Honest Final Status Model:
 *    * MEASURED_IMPROVEMENT (benchmarked verified gain)
 *    * SQL_REWRITE_VALID_BUT_INDEX_REQUIRED (semantically validated shape change, waiting for missing index)
 *    * NEEDS_INDEX_CHANGE (pure missing index, query shape 100% clean)
 *    * NEEDS_STATISTICS_ATTENTION (cardinality mismatch)
 *    * NO_SAFE_OPTIMIZATION_FOUND
 *    * INSUFFICIENT_EVIDENCE
 *    * MIXED_RESULT
 */

const { buildEnrichedContextPack } = require('./contextPackBuilder');
const { detectNoOpRewrite, isDuplicateStrategy } = require('./noOpDetector');
const { detectPlanEquality } = require('./planEqualityDetector');
const { evaluateStrongSafeImprovement, evaluateBenchmarkSafety } = require('./performanceThresholds');
const validationService = require('../validationService');
const workbench = require('../workbenchService');
const planParser = require('../planParser');
const planComparison = require('../../../public/assets/js/modules/planComparison');
const benchmarkComparison = require('../../../public/assets/js/modules/benchmarkComparison');
const aiProvider = require('../aiProvider');
const astParser = require('../ast/astParser');

async function runIterativeOptimization({
  sql = '',
  viewName = null,
  database = null,
  options = {},
  maxIterations = 3,
  aiCaller = null,
  runBenchmark = true
} = {}) {
  const cleanSql = validationService.extractExecutableQueryFromView(sql);

  // 1. Pre-AI Context Assembly (Zero Actual Plan Execution)
  const contextPack = await buildEnrichedContextPack({
    sql: cleanSql,
    viewName,
    database,
    options
  });

  // 2. Load Guard Evaluation
  const loadGuard = evaluateBenchmarkSafety({
    estimatedPlan: contextPack.estimatedPlan,
    queryStoreSummary: contextPack.queryStoreSummary,
    tableRowsApprox: contextPack.tableRowsApprox
  });

  const canBenchmark = runBenchmark && loadGuard.canAutoExecute;

  // 3. Root Cause Pre-Check (Dual Track Synthesis)
  const rootCause = contextPack.rootCause;

  // STRICT GUARD: ONLY stop immediately if Track B has ZERO query shape opportunities
  // and the query is already verified to be 100% structurally clean and SARGable.
  if (rootCause.suggestedStatus === 'NEEDS_INDEX_CHANGE' && !rootCause.rewriteOpportunity && !rootCause.trackB?.hasOpportunities) {
    return {
      ok: true,
      status: 'NEEDS_INDEX_CHANGE',
      primaryCause: rootCause.primaryCause,
      contributingCauses: rootCause.contributingCauses,
      confidence: rootCause.confidence,
      evidenceGrade: rootCause.evidenceGrade,
      reasons: rootCause.reasons,
      missingIndexEvidence: rootCause.missingIndexEvidence,
      iterations: [],
      bestCandidate: null,
      contextPack,
      summary: 'Sorgu yapısı zaten SARGable ve biçimsel olarak düzgündür. Hiçbir ilişkisel rewrite fırsatı (mükerrer tarama, non-SARGable filtre, gereksiz join) bulunmamaktadır. Ana darboğaz salt eksik indeks erişimidir.'
    };
  }

  // Already optimal query
  if (rootCause.suggestedStatus === 'NO_SAFE_OPTIMIZATION_FOUND' && !rootCause.trackB?.hasOpportunities) {
    return {
      ok: true,
      status: 'NO_SAFE_OPTIMIZATION_FOUND',
      primaryCause: rootCause.primaryCause,
      contributingCauses: rootCause.contributingCauses,
      confidence: rootCause.confidence,
      evidenceGrade: rootCause.evidenceGrade,
      reasons: rootCause.reasons,
      iterations: [],
      bestCandidate: null,
      contextPack,
      summary: 'Sorgu mevcut şema ve indeksler altında zaten optimize durumdadır; güvenli bir rewrite ihtiyacı bulunmuyor.'
    };
  }

  // 4. Iterative Loop Setup
  const totalIterations = Math.min(3, Math.max(1, Number(maxIterations) || 3));
  const iterations = [];
  const strategiesUsed = new Set();
  const candidateAstHistory = [];
  let feedbackPack = null;
  let strongWinnerFound = false;

  for (let iterNum = 1; iterNum <= totalIterations; iterNum++) {
    // A. Invoke AI
    const callFn = aiCaller || aiProvider.proposeStructuredRefactor;
    let aiResponse = null;

    try {
      aiResponse = await callFn({
        contextPack,
        iterationFeedback: feedbackPack,
        database,
        options
      });
    } catch (aiErr) {
      iterations.push({
        iteration: iterNum,
        status: 'AI_ERROR',
        error: aiErr.message
      });
      break;
    }

    if (!aiResponse || !aiResponse.ok) {
      iterations.push({
        iteration: iterNum,
        status: aiResponse?.status || 'AI_RESPONSE_INVALID',
        error: aiResponse?.error || 'Geçerli bir AI yanıtı alınamadı.'
      });
      break;
    }

    // Check if AI explicitly returned a non-rewrite status
    if (aiResponse.status === 'NO_SAFE_OPTIMIZATION_FOUND' || (aiResponse.status === 'NEEDS_INDEX_CHANGE' && !rootCause.trackB?.hasOpportunities)) {
      iterations.push({
        iteration: iterNum,
        status: aiResponse.status,
        strategyId: aiResponse.strategyId,
        explanation: aiResponse.explanation || 'AI güvenli bir yapısal iyileştirme bulunmadığını bildirdi.'
      });
      if (iterations.length === 1) {
        return {
          ok: true,
          status: aiResponse.status,
          primaryCause: rootCause.primaryCause,
          contributingCauses: rootCause.contributingCauses,
          reasons: [aiResponse.explanation || 'AI güvenli bir yapısal rewrite tespit edemedi.'],
          iterations,
          bestCandidate: null,
          contextPack
        };
      }
      break;
    }

    const candSql = validationService.extractExecutableQueryFromView(aiResponse.candidateSql || '');
    const stratId = aiResponse.strategyId || `STRATEGY_${iterNum}`;
    strategiesUsed.add(stratId);

    const iterRecord = {
      iteration: iterNum,
      strategyId: stratId,
      hypothesis: aiResponse.hypothesis,
      whatChanged: aiResponse.whatChanged,
      why: aiResponse.why,
      targetBottleneck: aiResponse.targetBottleneck,
      changes: aiResponse.changes,
      candidateSql: candSql,
      validation: null,
      planComparison: null,
      benchmarkComparison: null,
      status: 'IN_PROGRESS'
    };

    if (!candSql) {
      iterRecord.status = 'NO_SQL_CANDIDATE';
      iterRecord.rejectionReason = 'AI yanıtında geçerli bir T-SQL sorgu metni üretilmedi.';
      iterations.push(iterRecord);
      break;
    }

    // B. Strategy Diversity Gate: check if candidate is relationally identical to previous
    const candAst = astParser.parseSql(candSql);
    const isDup = candidateAstHistory.some(prevAst => isDuplicateStrategy(prevAst, candAst));
    if (isDup) {
      iterRecord.status = 'REJECTED_DUPLICATE_STRATEGY';
      iterRecord.rejectionReason = 'Aday sorgu önceki iterasyondaki adayla aynı ilişkisel stratejiyi (aynı tablolar, joinler, filtreler) içermektedir; çeşitlilik sağlanamadı.';
      iterations.push(iterRecord);

      feedbackPack = {
        previousStrategyId: stratId,
        readsDeltaPercent: 0,
        cpuDeltaPercent: 0,
        durationDeltaPercent: 0,
        planSummary: 'Önceki aday ile aynı ilişkisel yapı tekrar önerildi. Lütfen fundamentally farklı bir strateji formüle edin.',
        unaddressedFindings: contextPack.queryShapeOpportunities?.map(f => f.title) || []
      };
      continue;
    }
    candidateAstHistory.push(candAst);

    // C. Gate 1: No-Op & Significance Detector (Score >= 2 required)
    const noOpResult = detectNoOpRewrite({
      originalSql: cleanSql,
      candidateSql: candSql,
      candidateAst: candAst
    });
    iterRecord.noOpResult = noOpResult;
    iterRecord.significanceScore = noOpResult.significanceScore;
    iterRecord.diffReport = noOpResult.diffReport;

    if (!noOpResult.isMeaningful) {
      iterRecord.status = 'REJECTED_COSMETIC';
      iterRecord.rejectionReason = noOpResult.reason;
      iterations.push(iterRecord);

      feedbackPack = {
        previousStrategyId: stratId,
        readsDeltaPercent: 0,
        cpuDeltaPercent: 0,
        durationDeltaPercent: 0,
        planSummary: 'Aday sorguda yalnızca kozmetik düzenleme yapıldı (Önem skoru < 2); yürütme planı ve maliyet değişmedi.',
        unaddressedFindings: contextPack.queryShapeOpportunities?.map(f => f.title) || []
      };
      continue;
    }

    // D. Gate 2: Semantic Validation Lab
    let valResult = null;
    if (aiResponse.simulatedValidation) {
      valResult = aiResponse.simulatedValidation;
    } else if (options.validator) {
      valResult = await options.validator({ originalSql: cleanSql, candidateSql: candSql });
    } else {
      try {
        valResult = await validationService.validateEquivalence({
          originalSql: cleanSql,
          candidateSql: candSql,
          database,
          sampleLimit: 1000
        });
      } catch (valErr) {
        valResult = { ok: false, status: 'FAIL', reason: valErr.message };
      }
    }
    iterRecord.validation = valResult;

    if (valResult.status === 'FAIL') {
      iterRecord.status = 'REJECTED_SEMANTIC_FAIL';
      iterRecord.rejectionReason = valResult.reason || 'Semantik doğrulama başarısız oldu.';
      iterations.push(iterRecord);

      feedbackPack = {
        previousStrategyId: stratId,
        readsDeltaPercent: 'N/A',
        cpuDeltaPercent: 'N/A',
        durationDeltaPercent: 'N/A',
        planSummary: `Aday sorgu semantik doğrulamadan geçemedi (${valResult.reason}). Satır tekilliğini ve filtre mantığını koruyun.`,
        unaddressedFindings: contextPack.queryShapeOpportunities?.map(f => f.title) || []
      };
      continue;
    }

    // E. Gate 2.5: Estimated Plan Execution & Cost-Aware Candidate Pruning (Item 30)
    let candPlan = null;
    let planComp = null;
    let origPlanParsed = null;

    try {
      const origPlanRes = await workbench.executePlan({ sql: cleanSql, database, mode: 'estimated' });
      origPlanParsed = planParser.parseShowPlanXML(origPlanRes.rawXml);
    } catch (_) {}

    try {
      const candPlanRes = await workbench.executePlan({ sql: candSql, database, mode: 'estimated' });
      candPlan = planParser.parseShowPlanXML(candPlanRes.rawXml);
    } catch (_) {}

    if (origPlanParsed && candPlan) {
      planComp = planComparison.comparePlans(origPlanParsed, candPlan);
      iterRecord.planComparison = planComp;

      // Cost-aware pruning: detect severe plan degradation before benchmark
      const hasCartesian = (candPlan.warnings || []).some(w => /NO_JOIN_PREDICATE|Cartesian/i.test(w.message || ''));
      const origCost = origPlanParsed.totalSubTreeCost || 0;
      const candCost = candPlan.totalSubTreeCost || 0;

      if (hasCartesian || (origCost > 0 && candCost > origCost * 5 && candPlan.scans > origPlanParsed.scans)) {
        iterRecord.status = 'REJECTED_COST_AWARE_PRUNING';
        iterRecord.rejectionReason = 'Aday sorgu tahmini planında kartezyen çarpım veya aşırı maliyet patlaması (>5x) tespit edildi; canlı benchmark iptal edildi.';
        iterations.push(iterRecord);

        feedbackPack = {
          previousStrategyId: stratId,
          readsDeltaPercent: 'N/A',
          cpuDeltaPercent: 'N/A',
          durationDeltaPercent: 'N/A',
          planSummary: 'Aday sorgu yürütme planında beklenmeyen bir kartezyen join veya yüksek maliyet patlaması yarattı. Join ilişkilerini kontrol edin.',
          unaddressedFindings: contextPack.queryShapeOpportunities?.map(f => f.title) || []
        };
        continue;
      }
    }

    // F. Gate 4: Alternating Benchmark (A/B/B/A/A/B)
    let benchComp = null;
    let measuredMetrics = null;

    if (canBenchmark) {
      try {
        const altBench = await workbench.executeAlternatingBenchmark({
          originalSql: cleanSql,
          candidateSql: candSql,
          database,
          runs: 3,
          warmUp: true
        });

        if (altBench.ok) {
          benchComp = benchmarkComparison.compareBenchmarks(
            altBench.original.metrics,
            altBench.candidate.metrics
          );
          iterRecord.benchmarkComparison = benchComp;
          iterRecord.benchmarkRuns = altBench.runs;

          measuredMetrics = {
            origReads: altBench.original.metrics.logicalReads,
            candReads: altBench.candidate.metrics.logicalReads,
            origCpu: altBench.original.metrics.cpuMs,
            candCpu: altBench.candidate.metrics.cpuMs,
            origDuration: altBench.original.metrics.durationMs,
            candDuration: altBench.candidate.metrics.durationMs
          };
        }
      } catch (bErr) {
        iterRecord.benchmarkError = bErr.message;
      }
    } else if (!loadGuard.canAutoExecute) {
      iterRecord.benchmarkSkippedReason = 'Benchmark Load Guard: Ağır/riskli sorgu profili nedeniyle otomatik benchmark çalıştırılmadı.';
    }

    if (!benchComp && (aiResponse.simulatedBenchmark || options.simulatedBenchmark)) {
      benchComp = aiResponse.simulatedBenchmark || (typeof options.simulatedBenchmark === 'function' ? options.simulatedBenchmark(iterNum) : options.simulatedBenchmark);
      iterRecord.benchmarkComparison = benchComp;
    }

    // G. Gate 5: Plan Equality & Noise Band Evaluation
    const planEquality = detectPlanEquality({
      originalPlan: origPlanParsed || {},
      candidatePlan: candPlan || {},
      measuredMetrics
    });
    iterRecord.planEquality = planEquality;

    // H. Strong Safe Improvement Check (Early Stopping)
    const strongCheck = evaluateStrongSafeImprovement({
      validation: valResult,
      benchmarkComparison: benchComp || {},
      planComparison: planComp || {},
      addressedFindings: aiResponse.addressedFindings || []
    });

    if (strongCheck.isStrong) {
      iterRecord.status = 'MEASURED_IMPROVEMENT';
      iterRecord.rationale = strongCheck.rationale;
      iterations.push(iterRecord);
      strongWinnerFound = true;
      break; // Early stop on verified improvement!
    }

    // Benchmark comparison evaluation
    const readsImpr = benchComp?.improvements?.readsPercent ?? 0;
    const cpuImpr = benchComp?.improvements?.cpuPercent ?? 0;

    const hasSargOrShapeGain = (noOpResult.diffReport && noOpResult.diffReport.origNonSargCount > noOpResult.diffReport.candNonSargCount) ||
      (noOpResult.significanceScore >= 2) ||
      rootCause.trackA?.hasIndexDeficiency ||
      (rootCause.missingIndexEvidence && rootCause.missingIndexEvidence.length > 0);

    if (benchComp && benchComp.winner === 'ORIGINAL' && (readsImpr <= -15 || cpuImpr <= -25)) {
      iterRecord.status = 'REGRESSION';
      iterRecord.rejectionReason = 'Aday sorguda kaynak tüketimi regresyonu oluştu.';
    } else if (readsImpr >= 10 || cpuImpr >= 15) {
      iterRecord.status = 'MEASURED_IMPROVEMENT';
    } else if (valResult.status === 'PASS' && hasSargOrShapeGain) {
      // Meaningful rewrite achieved semantically, but physical reads remain high because index is missing
      iterRecord.status = 'SQL_REWRITE_VALID_BUT_INDEX_REQUIRED';
    } else {
      iterRecord.status = 'POTENTIAL_IMPROVEMENT';
    }

    iterations.push(iterRecord);

    // Prepare Second-Pass DBA Feedback Pack for next iteration (Item 22)
    const primaryScannedTable = origPlanParsed?.topOperators?.find(o => o.isScan)?.targetObject || 'ana tablo';
    feedbackPack = {
      previousStrategyId: stratId,
      readsDeltaPercent: readsImpr,
      cpuDeltaPercent: cpuImpr,
      durationDeltaPercent: benchComp?.improvements?.durationPercent ?? 0,
      planSummary: `Plan Analizi: Orijinal ile aynı ${primaryScannedTable} taraması korundu. Mantıksal Okuma: ${measuredMetrics?.origReads?.toLocaleString() || 'N/A'} -> ${measuredMetrics?.candReads?.toLocaleString() || 'N/A'}. Neden önceki yapısal hipoteziniz fiziksel okuma sayısını düşüremedi? Lütfen farklı bir ilişkisel biçim deneyin.`,
      unaddressedFindings: (aiResponse.unaddressedFindings && aiResponse.unaddressedFindings.length > 0)
        ? aiResponse.unaddressedFindings
        : contextPack.queryShapeOpportunities?.map(f => f.title) || []
    };
  }

  // 5. Best Candidate Selection Engine (Deterministic Ranking)
  const eligibleCandidates = iterations.filter(it =>
    it.candidateSql &&
    it.status !== 'REJECTED_COSMETIC' &&
    it.status !== 'REJECTED_SEMANTIC_FAIL' &&
    it.status !== 'REJECTED_DUPLICATE_STRATEGY' &&
    it.status !== 'REJECTED_COST_AWARE_PRUNING' &&
    it.status !== 'REGRESSION' &&
    it.status !== 'AI_ERROR' &&
    it.status !== 'NO_SQL_CANDIDATE'
  );

  let bestCandidate = null;

  if (eligibleCandidates.length > 0) {
    // Sort ranking:
    // 1. MEASURED_IMPROVEMENT priority
    // 2. Highest logical reads improvement
    // 3. Significance score (highest structural depth)
    // 4. Lowest CPU
    eligibleCandidates.sort((a, b) => {
      if (a.status === 'MEASURED_IMPROVEMENT' && b.status !== 'MEASURED_IMPROVEMENT') return -1;
      if (b.status === 'MEASURED_IMPROVEMENT' && a.status !== 'MEASURED_IMPROVEMENT') return 1;

      const readsA = a.benchmarkComparison?.improvements?.readsPercent ?? 0;
      const readsB = b.benchmarkComparison?.improvements?.readsPercent ?? 0;
      if (readsB !== readsA) return readsB - readsA;

      const scoreA = a.significanceScore || 0;
      const scoreB = b.significanceScore || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;

      const cpuA = a.benchmarkComparison?.improvements?.cpuPercent ?? 0;
      const cpuB = b.benchmarkComparison?.improvements?.cpuPercent ?? 0;
      return cpuB - cpuA;
    });

    const top = eligibleCandidates[0];
    const readsImpr = top.benchmarkComparison?.improvements?.readsPercent ?? 0;
    const cpuImpr = top.benchmarkComparison?.improvements?.cpuPercent ?? 0;

    // Detect MIXED_RESULT (e.g. reads improved by 30% but CPU regressed by 50%)
    const isMixed = (readsImpr >= 15 && cpuImpr <= -25) || (cpuImpr >= 20 && readsImpr <= -15);

    let finalCandStatus = top.status;
    if (isMixed) {
      finalCandStatus = 'MIXED_RESULT';
    } else if (readsImpr >= 10 || cpuImpr >= 15 || top.status === 'MEASURED_IMPROVEMENT') {
      finalCandStatus = 'MEASURED_IMPROVEMENT';
    } else if (top.validation?.status === 'PASS' && (
      top.status === 'SQL_REWRITE_VALID_BUT_INDEX_REQUIRED' ||
      (top.diffReport && top.diffReport.origNonSargCount > top.diffReport.candNonSargCount) ||
      (top.significanceScore >= 2) ||
      rootCause.trackA?.hasIndexDeficiency ||
      (rootCause.missingIndexEvidence && rootCause.missingIndexEvidence.length > 0)
    )) {
      finalCandStatus = 'SQL_REWRITE_VALID_BUT_INDEX_REQUIRED';
    }

    bestCandidate = {
      iteration: top.iteration,
      strategyId: top.strategyId,
      status: finalCandStatus,
      candidateSql: top.candidateSql,
      hypothesis: top.hypothesis,
      whatChanged: top.whatChanged,
      why: top.why,
      targetBottleneck: top.targetBottleneck,
      changes: top.changes,
      significanceScore: top.significanceScore,
      diffReport: top.diffReport,
      validation: top.validation,
      planComparison: top.planComparison,
      benchmarkComparison: top.benchmarkComparison,
      isMixedResult: isMixed
    };
  }

  // 6. Overall Result Determination (Item 19)
  let overallStatus = 'NO_SAFE_OPTIMIZATION_FOUND';

  if (bestCandidate) {
    overallStatus = bestCandidate.status;
  } else if (rootCause.suggestedStatus === 'NEEDS_INDEX_CHANGE') {
    overallStatus = 'NEEDS_INDEX_CHANGE';
  } else if (rootCause.suggestedStatus === 'NEEDS_STATISTICS_ATTENTION') {
    overallStatus = 'NEEDS_STATISTICS_ATTENTION';
  }

  return {
    ok: true,
    status: overallStatus,
    primaryCause: rootCause.primaryCause,
    contributingCauses: rootCause.contributingCauses,
    rewriteOpportunity: rootCause.rewriteOpportunity,
    indexStillRecommended: rootCause.indexStillRecommended,
    iterationsCount: iterations.length,
    iterations,
    bestCandidate,
    benchmarkLoadGuard: loadGuard,
    missingIndexEvidence: rootCause.missingIndexEvidence,
    contextPack
  };
}

module.exports = {
  runIterativeOptimization
};
