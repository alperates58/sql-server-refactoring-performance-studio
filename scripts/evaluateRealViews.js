/**
 * Evaluation of 5 Real Views on Connected Database (MikroDesktop_LIDER26)
 * Phase 8 Audit Script
 */

const db = require('../server/services/sqlServer');
const scanner = require('../server/services/scanner');
const { runIterativeOptimization } = require('../server/services/aiOptimizer/iterativeOptimizer');
const { buildEnrichedContextPack } = require('../server/services/aiOptimizer/contextPackBuilder');
const { classifyRootCause } = require('../server/services/aiOptimizer/rootCauseClassifier');
const validationService = require('../server/services/validationService');
const workbench = require('../server/services/workbenchService');
const planParser = require('../server/services/planParser');
const { compareBenchmarks } = require('../public/assets/js/modules/benchmarkComparison');
const { isMeaningfulChange } = require('../server/services/aiOptimizer/performanceThresholds');

async function runEvaluation() {
  console.log('Connecting to database...');
  await db.autoConnect();
  const dbStatus = db.status();
  console.log(`Connected to: ${dbStatus.primaryDatabase} on ${dbStatus.server}`);

  const latestScan = scanner.getLatestScanData();
  const allViews = latestScan?.views || [];
  console.log(`Total views in catalog: ${allViews.length}`);

  const targetViewNames = [
    { name: 'AA_00ROTA', profile: 'Profile 1: Repeated Base Table Access' },
    { name: 'AA_alper_4rapor', profile: 'Profile 2: Non-SARGable Filter (YEAR() function)' },
    { name: 'AA_00SonAlışFiyatı', profile: 'Profile 3: Missing Index / Large Table Scan' },
    { name: 'AA_alper_calisma', profile: 'Profile 4: Already Optimized / Single Table' },
    { name: 'AA_alper_AAHangiSipariş', profile: 'Profile 5: Multi-table Complex Joins' }
  ];

  const results = [];

  for (const target of targetViewNames) {
    console.log(`\n=======================================================`);
    console.log(`Evaluating: ${target.name} (${target.profile})`);
    console.log(`=======================================================`);

    const viewObj = allViews.find(v => v.name === target.name);
    if (!viewObj) {
      console.log(`View ${target.name} not found!`);
      continue;
    }

    const rawSql = viewObj.definition;
    const cleanSql = validationService.extractExecutableQueryFromView(rawSql);

    // 1. Build Pre-AI Context Pack
    console.log('1. Building Pre-AI Context Pack (Zero Actual Plan Mutation)...');
    const contextPack = await buildEnrichedContextPack({
      sql: cleanSql,
      viewName: target.name,
      database: dbStatus.primaryDatabase
    });

    console.log(`   - AST Analysis: ${contextPack.ast.status} (${contextPack.ast.structuralFindings.length} findings)`);
    console.log(`   - Estimated Plan Subtree Cost: ${contextPack.estimatedPlan.totalSubTreeCost}`);
    console.log(`   - Root Cause Initial: ${contextPack.rootCause.primaryCause} (Confidence: ${contextPack.rootCause.confidence})`);
    console.log(`   - Contributing Causes: ${contextPack.rootCause.contributingCauses.join(', ') || 'none'}`);
    console.log(`   - Suggested Action: ${contextPack.rootCause.suggestedStatus}`);

    // 2. Measure Original Benchmark on Live Database (Salt Read-Only)
    console.log('2. Measuring Original Benchmark on Live Database...');
    let origBench = null;
    try {
      origBench = await workbench.executeBenchmark({
        sql: cleanSql,
        database: dbStatus.primaryDatabase,
        runs: 3,
        warmUp: true
      });
      const origReads = origBench.metrics.medianLogicalReads ?? origBench.metrics.logicalReads ?? 0;
      const origCpu = origBench.metrics.medianCpuMs ?? origBench.metrics.cpuMs ?? 0;
      const origDur = origBench.metrics.medianDurationMs ?? origBench.metrics.durationMs ?? 0;
      console.log(`   - Original: Reads=${origReads}, CPU=${origCpu}ms, Duration=${origDur}ms`);
    } catch (bErr) {
      console.log(`   - Original Benchmark Error: ${bErr.message}`);
      origBench = { metrics: { medianLogicalReads: 0, medianCpuMs: 0, medianDurationMs: 0 } };
    }

    // 3. Run Iterative Optimization
    console.log('3. Running Iterative Optimization Pipeline...');
    const optResult = await runIterativeOptimization({
      sql: cleanSql,
      viewName: target.name,
      database: dbStatus.primaryDatabase,
      maxIterations: 2,
      runBenchmark: true
    });

    console.log(`   - Status: ${optResult.status}`);
    console.log(`   - Iterations count: ${optResult.iterationsCount || optResult.iterations?.length || 0}`);
    console.log(`   - Primary Cause: ${optResult.primaryCause}`);

    let candidateMetrics = null;
    let benchDiff = null;

    if (optResult.bestCandidate && optResult.bestCandidate.candidateSql) {
      console.log('4. Best Candidate Found! Measuring Live Alternating Benchmark...');
      try {
        const altBench = await workbench.executeAlternatingBenchmark({
          originalSql: cleanSql,
          candidateSql: optResult.bestCandidate.candidateSql,
          database: dbStatus.primaryDatabase,
          runs: 3,
          warmUp: true
        });

        candidateMetrics = altBench.candidate.metrics;
        benchDiff = compareBenchmarks(altBench.original.metrics, altBench.candidate.metrics);
        const candReads = candidateMetrics.medianLogicalReads ?? candidateMetrics.logicalReads ?? 0;
        const candCpu = candidateMetrics.medianCpuMs ?? candidateMetrics.cpuMs ?? 0;
        const candDur = candidateMetrics.medianDurationMs ?? candidateMetrics.durationMs ?? 0;
        console.log(`   - Candidate: Reads=${candReads}, CPU=${candCpu}ms, Duration=${candDur}ms`);
        console.log(`   - Reads Delta: ${benchDiff.improvements?.readsPercent ?? 0}%`);
        console.log(`   - Duration Delta: ${benchDiff.improvements?.durationPercent ?? 0}%`);
        console.log(`   - Benchmark Summary: ${benchDiff.summary}`);
      } catch (altErr) {
        console.log(`   - Alternating Benchmark Error: ${altErr.message}`);
      }
    } else {
      console.log(`   - No candidate accepted. Final Status: ${optResult.status}`);
      if (optResult.reasons) console.log(`   - Refusal Reasons: ${optResult.reasons.join('; ')}`);
    }

    results.push({
      viewName: target.name,
      profile: target.profile,
      initialRootCause: contextPack.rootCause.primaryCause,
      contributingCauses: contextPack.rootCause.contributingCauses,
      suggestedStatus: contextPack.rootCause.suggestedStatus,
      finalStatus: optResult.status,
      iterationsCount: optResult.iterationsCount || optResult.iterations?.length || 0,
      iterations: optResult.iterations,
      originalMetrics: origBench.metrics,
      candidateMetrics,
      benchDiff,
      reasons: optResult.reasons || optResult.summary
    });
  }

  console.log('\n=======================================================');
  console.log('FINAL 5 VIEWS EVALUATION SUMMARY TABLE');
  console.log('=======================================================');
  console.table(results.map(r => ({
    View: r.viewName,
    Profile: r.profile.split(':')[0],
    RootCause: r.initialRootCause,
    Status: r.finalStatus,
    OrigReads: r.originalMetrics.medianLogicalReads ?? r.originalMetrics.logicalReads ?? 'N/A',
    CandReads: r.candidateMetrics?.medianLogicalReads ?? r.candidateMetrics?.logicalReads ?? 'N/A',
    ReadsDelta: r.benchDiff?.improvements?.readsPercent != null ? `${r.benchDiff.improvements.readsPercent}%` : '0%',
    OrigDur: `${r.originalMetrics.medianDurationMs ?? r.originalMetrics.durationMs ?? 0}ms`,
    CandDur: r.candidateMetrics ? `${r.candidateMetrics.medianDurationMs ?? r.candidateMetrics.durationMs ?? 0}ms` : 'N/A',
    Winner: r.benchDiff?.winner || 'N/A'
  })));

  // Write full evaluation JSON to scratch directory
  const fs = require('fs');
  fs.writeFileSync('test/realViewsEvaluationResult.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Results written to test/realViewsEvaluationResult.json');
}

runEvaluation().catch(err => {
  console.error('Fatal evaluation error:', err);
  process.exit(1);
});
