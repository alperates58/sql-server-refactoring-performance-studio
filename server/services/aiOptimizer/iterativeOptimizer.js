/**
 * SQL Server Refactoring & Performance Studio
 * Iterative Optimization Orchestrator (Sprint 9)
 *
 * Implements:
 * - Multi-turn optimization loop (Max 3 iterations)
 * - Benchmark Load Guard (prevents heavy benchmark execution on risky queries)
 * - Candidate Quality Gates:
 *    Gate 1: No-Op Detector (rejects cosmetic alias/whitespace/CTE rewrites)
 *    Gate 2: Validation Lab (rejects semantic failures and row count mismatches)
 *    Gate 3: Plan Equality & Noise Band Evaluation
 *    Gate 4: Alternating Benchmark (A/B/B/A/A/B pattern)
 * - Strategy diversity & feedback pack injection
 * - Early stopping via STRONG_SAFE_IMPROVEMENT
 * - Best candidate deterministic ranking without blind "Seek > Scan" bias
 * - First-class refusal statuses: NO_SAFE_OPTIMIZATION_FOUND, NEEDS_INDEX_CHANGE
 */

const { buildEnrichedContextPack } = require('./contextPackBuilder');
const { detectNoOpRewrite } = require('./noOpDetector');
const { detectPlanEquality } = require('./planEqualityDetector');
const { evaluateStrongSafeImprovement, evaluateBenchmarkSafety } = require('./performanceThresholds');
const validationService = require('../validationService');
const workbench = require('../workbenchService');
const planParser = require('../planParser');
const planComparison = require('../../../public/assets/js/modules/planComparison');
const benchmarkComparison = require('../../../public/assets/js/modules/benchmarkComparison');
const aiProvider = require('../aiProvider');

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

  // 3. Root Cause Pre-Check (Cautious Index / Already Optimized Check)
  const rootCause = contextPack.rootCause;

  // Pure SARGable query with missing index bottleneck
  if (rootCause.suggestedStatus === 'NEEDS_INDEX_CHANGE') {
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
      summary: 'Sorgu yapısı zaten SARGable ve biçimsel olarak düzgündür. Ana darboğaz eksik indeks erişimidir.'
    };
  }

  // Already optimal query
  if (rootCause.suggestedStatus === 'NO_SAFE_OPTIMIZATION_FOUND') {
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
    if (aiResponse.status === 'NO_SAFE_OPTIMIZATION_FOUND' || aiResponse.status === 'NEEDS_INDEX_CHANGE') {
      iterations.push({
        iteration: iterNum,
        status: aiResponse.status,
        strategyId: aiResponse.strategyId,
        explanation: aiResponse.explanation || 'AI güvenli bir yapısal iyileştirme bulunmadığını bildirdi.'
      });
      if (iterations.length === 1) {
        // Honor first-round refusal immediately
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
      changes: aiResponse.changes,
      candidateSql: candSql,
      validation: null,
      planComparison: null,
      benchmarkComparison: null,
      status: 'IN_PROGRESS'
    };

    // B. Gate 1: No-Op Candidate Detector
    const noOpResult = detectNoOpRewrite({
      originalSql: cleanSql,
      candidateSql: candSql
    });
    iterRecord.noOpResult = noOpResult;

    if (!noOpResult.isMeaningful) {
      iterRecord.status = 'REJECTED_COSMETIC';
      iterRecord.rejectionReason = noOpResult.reason;
      iterations.push(iterRecord);

      feedbackPack = {
        previousStrategyId: stratId,
        readsDeltaPercent: 0,
        cpuDeltaPercent: 0,
        durationDeltaPercent: 0,
        planSummary: 'Aday sorguda yalnızca kozmetik değişiklik yapıldı (alias/whitespace/format); yürütme planı ve maliyet değişmedi.',
        unaddressedFindings: contextPack.ast.structuralFindings.map(f => f.title)
      };
      continue;
    }

    // C. Gate 2: Semantic Validation Lab
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
        planSummary: `Aday sorgu semantik doğrulamadan geçemedi (${valResult.reason}).`,
        unaddressedFindings: contextPack.ast.structuralFindings.map(f => f.title)
      };
      continue;
    }

    // D. Gate 3: Estimated Plan Execution & Plan Equality Check
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
    }

    // E. Gate 4: Alternating Benchmark (A/B/B/A/A/B)
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

    // F. Gate 5: Plan Equality & Noise Band Evaluation
    const planEquality = detectPlanEquality({
      originalPlan: origPlanParsed || {},
      candidatePlan: candPlan || {},
      measuredMetrics
    });
    iterRecord.planEquality = planEquality;

    // G. Strong Safe Improvement Check (Early Stopping)
    const strongCheck = evaluateStrongSafeImprovement({
      validation: valResult,
      benchmarkComparison: benchComp || {},
      planComparison: planComp || {},
      addressedFindings: aiResponse.addressedFindings || []
    });

    if (strongCheck.isStrong) {
      iterRecord.status = 'STRONG_SAFE_IMPROVEMENT';
      iterRecord.rationale = strongCheck.rationale;
      iterations.push(iterRecord);
      strongWinnerFound = true;
      break; // Early stop!
    }

    // Normal evaluation
    if (planEquality.status === 'NO_MEANINGFUL_PLAN_CHANGE') {
      iterRecord.status = 'NO_MEANINGFUL_CHANGE';
      iterRecord.rejectionReason = 'Plan yapısı ve kaynak tüketimi orijinal ile aynı kaldı.';
    } else if (benchComp && benchComp.winner === 'ORIGINAL') {
      iterRecord.status = 'REGRESSION';
      iterRecord.rejectionReason = 'Aday sorguda kaynak tüketimi regresyonu oluştu.';
    } else {
      iterRecord.status = 'POTENTIAL_IMPROVEMENT';
    }

    iterations.push(iterRecord);

    // Prepare Feedback Pack for next iteration
    feedbackPack = {
      previousStrategyId: stratId,
      readsDeltaPercent: benchComp?.improvements?.readsPercent ?? 0,
      cpuDeltaPercent: benchComp?.improvements?.cpuPercent ?? 0,
      durationDeltaPercent: benchComp?.improvements?.durationPercent ?? 0,
      planSummary: planEquality.summary,
      unaddressedFindings: (aiResponse.unaddressedFindings && aiResponse.unaddressedFindings.length > 0)
        ? aiResponse.unaddressedFindings
        : contextPack.ast.structuralFindings.map(f => f.title)
    };
  }

  // 5. Best Candidate Selection Engine (Deterministic Ranking)
  // Hard gates: validation PASS, not cosmetic, no severe regression
  const eligibleCandidates = iterations.filter(it =>
    it.candidateSql &&
    it.status !== 'REJECTED_COSMETIC' &&
    it.status !== 'REJECTED_SEMANTIC_FAIL' &&
    it.status !== 'REGRESSION' &&
    it.status !== 'AI_ERROR'
  );

  let bestCandidate = null;

  if (eligibleCandidates.length > 0) {
    // Sort ranking:
    // 1. STRONG_SAFE_IMPROVEMENT priority
    // 2. Highest logical reads improvement
    // 3. Lowest CPU
    // 4. Lowest Duration
    // Note: User Guardrail 3 respected - no blind "Seek > Scan" bias
    eligibleCandidates.sort((a, b) => {
      if (a.status === 'STRONG_SAFE_IMPROVEMENT' && b.status !== 'STRONG_SAFE_IMPROVEMENT') return -1;
      if (b.status === 'STRONG_SAFE_IMPROVEMENT' && a.status !== 'STRONG_SAFE_IMPROVEMENT') return 1;

      const readsA = a.benchmarkComparison?.improvements?.readsPercent ?? 0;
      const readsB = b.benchmarkComparison?.improvements?.readsPercent ?? 0;
      if (readsB !== readsA) return readsB - readsA;

      const cpuA = a.benchmarkComparison?.improvements?.cpuPercent ?? 0;
      const cpuB = b.benchmarkComparison?.improvements?.cpuPercent ?? 0;
      if (cpuB !== cpuA) return cpuB - cpuA;

      const durA = a.benchmarkComparison?.improvements?.durationPercent ?? 0;
      const durB = b.benchmarkComparison?.improvements?.durationPercent ?? 0;
      return durB - durA;
    });

    const top = eligibleCandidates[0];
    const readsImpr = top.benchmarkComparison?.improvements?.readsPercent ?? 0;
    const cpuImpr = top.benchmarkComparison?.improvements?.cpuPercent ?? 0;

    // Detect MIXED_RESULT (e.g. reads improved by 30% but CPU regressed by 50%)
    const isMixed = (readsImpr >= 15 && cpuImpr <= -25) || (cpuImpr >= 20 && readsImpr <= -15);

    bestCandidate = {
      iteration: top.iteration,
      strategyId: top.strategyId,
      status: isMixed ? 'MIXED_RESULT' : top.status,
      candidateSql: top.candidateSql,
      hypothesis: top.hypothesis,
      changes: top.changes,
      validation: top.validation,
      planComparison: top.planComparison,
      benchmarkComparison: top.benchmarkComparison,
      isMixedResult: isMixed
    };
  }

  // 6. Overall Result Determination
  let overallStatus = 'NO_SAFE_OPTIMIZATION_FOUND';
  if (bestCandidate) {
    overallStatus = bestCandidate.status === 'STRONG_SAFE_IMPROVEMENT'
      ? 'OPTIMIZED'
      : (bestCandidate.isMixedResult ? 'MIXED_RESULT' : 'POTENTIAL_IMPROVEMENT');
  }

  return {
    ok: true,
    status: overallStatus,
    primaryCause: rootCause.primaryCause,
    contributingCauses: rootCause.contributingCauses,
    iterationsCount: iterations.length,
    iterations,
    bestCandidate,
    benchmarkLoadGuard: loadGuard,
    contextPack
  };
}

module.exports = {
  runIterativeOptimization
};
