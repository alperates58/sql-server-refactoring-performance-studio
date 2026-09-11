/**
 * SQL Server Refactoring & Performance Studio
 * Benchmark Comparison Engine (Sprint 3)
 *
 * Pure, deterministic comparison between Original and Candidate benchmark runs.
 * Compatible with Node.js and modern browsers.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STUDIO_MODULES = root.STUDIO_MODULES || {};
    root.STUDIO_MODULES.benchmarkComparison = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function getMedian(values = []) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function extractBenchmarkMetrics(bench = {}) {
    const metrics = bench.metrics || bench.summary || {};
    const runs = Array.isArray(bench.runs) ? bench.runs : (Array.isArray(bench.iterations) ? bench.iterations : []);

    const durationMs = metrics.medianDurationMs != null 
      ? metrics.medianDurationMs 
      : (metrics.medianMs != null ? metrics.medianMs : (bench.durationMs != null ? bench.durationMs : getMedian(runs.map(r => r.durationMs || 0))));

    const p95DurationMs = metrics.p95DurationMs != null 
      ? metrics.p95DurationMs 
      : (metrics.p95Ms != null ? metrics.p95Ms : (bench.p95Ms || 0));

    const logicalReads = metrics.medianLogicalReads != null 
      ? metrics.medianLogicalReads 
      : (metrics.logicalReadsMedian != null ? metrics.logicalReadsMedian : (bench.logicalReads != null ? bench.logicalReads : getMedian(runs.map(r => r.logicalReads || 0))));

    const cpuValues = runs.map(r => r.cpuMs).filter(c => c != null);
    const cpuMs = bench.cpuMs != null 
      ? bench.cpuMs 
      : (cpuValues.length ? getMedian(cpuValues) : 0);

    const rows = bench.rowCount != null 
      ? bench.rowCount 
      : (bench.rows != null ? bench.rows : (runs.length ? (runs[0].rows ?? runs[0].rowCount ?? 0) : 0));

    return {
      durationMs: Number(durationMs) || 0,
      p95DurationMs: Number(p95DurationMs) || 0,
      cpuMs: Number(cpuMs) || 0,
      logicalReads: Number(logicalReads) || 0,
      rows: Number(rows) || 0,
      runsCount: runs.length
    };
  }

  function compareBenchmarks(original = {}, candidate = {}) {
    const orig = extractBenchmarkMetrics(original);
    const cand = extractBenchmarkMetrics(candidate);

    // Deltas: Candidate - Original
    const durationDeltaMs = cand.durationMs - orig.durationMs;
    const cpuDeltaMs = cand.cpuMs - orig.cpuMs;
    const readsDelta = cand.logicalReads - orig.logicalReads;
    const p95DeltaMs = cand.p95DurationMs - orig.p95DurationMs;
    const rowCountDelta = cand.rows - orig.rows;
    const isRowCountEqual = orig.rows === cand.rows;

    // Improvement % (Positive means candidate is better/lower)
    // Formula: ((Original - Candidate) / Original) * 100
    const durationImprovementPercent = orig.durationMs > 0 
      ? Math.round(((orig.durationMs - cand.durationMs) / orig.durationMs) * 100) 
      : 0;

    const cpuImprovementPercent = orig.cpuMs > 0 
      ? Math.round(((orig.cpuMs - cand.cpuMs) / orig.cpuMs) * 100) 
      : 0;

    const readsImprovementPercent = orig.logicalReads > 0 
      ? Math.round(((orig.logicalReads - cand.logicalReads) / orig.logicalReads) * 100) 
      : 0;

    const p95ImprovementPercent = orig.p95DurationMs > 0 
      ? Math.round(((orig.p95DurationMs - cand.p95DurationMs) / orig.p95DurationMs) * 100) 
      : 0;

    // Determine performance outcome
    let winner = 'TIE';
    let outcomeText = 'Benzer Performans';
    let outcomeType = 'NEUTRAL'; // 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'CRITICAL'

    if (!isRowCountEqual) {
      winner = 'INVALID_ROW_COUNT';
      outcomeText = 'Satır Sayısı Uyuşmazlığı';
      outcomeType = 'CRITICAL';
    } else if (durationImprovementPercent >= 10 || readsImprovementPercent >= 15) {
      winner = 'CANDIDATE';
      outcomeText = 'Aday Belirgin Şekilde Daha Hızlı';
      outcomeType = 'POSITIVE';
    } else if (durationImprovementPercent <= -10 || readsImprovementPercent <= -15) {
      winner = 'ORIGINAL';
      outcomeText = 'Adayda Performans Regresyonu Var';
      outcomeType = 'NEGATIVE';
    } else if (Math.abs(durationImprovementPercent) < 10) {
      winner = 'TIE';
      outcomeText = 'Performans Değişimi İhmal Edilebilir Düzeyde';
      outcomeType = 'NEUTRAL';
    }

    // Build human-friendly summary in Turkish
    let summary = '';
    if (!isRowCountEqual) {
      summary = `DİKKAT: Orijinal sorgu ${orig.rows} satır, Aday sorgu ${cand.rows} satır döndürdü. Semantik sonuçlar farklı!`;
    } else if (winner === 'CANDIDATE') {
      const parts = [];
      if (durationImprovementPercent !== 0) parts.push(`Süre %${durationImprovementPercent} azaldı (${orig.durationMs}ms → ${cand.durationMs}ms)`);
      if (readsImprovementPercent !== 0) parts.push(`Logical read %${readsImprovementPercent} azaldı (${orig.logicalReads.toLocaleString()} → ${cand.logicalReads.toLocaleString()})`);
      if (cpuImprovementPercent > 0) parts.push(`CPU %${cpuImprovementPercent} iyileşti`);
      summary = `Aday versiyon daha başarılı: ${parts.join(', ')}.`;
    } else if (winner === 'ORIGINAL') {
      const parts = [];
      if (durationImprovementPercent < 0) parts.push(`Süre %${Math.abs(durationImprovementPercent)} arttı (${orig.durationMs}ms → ${cand.durationMs}ms)`);
      if (readsImprovementPercent < 0) parts.push(`Logical read %${Math.abs(readsImprovementPercent)} arttı (${orig.logicalReads.toLocaleString()} → ${cand.logicalReads.toLocaleString()})`);
      summary = `Aday versiyonda regresyon tespit edildi: ${parts.join(', ')}.`;
    } else {
      summary = `Her iki sorgu da benzer kaynak tüketimi sergiledi (${orig.durationMs}ms vs ${cand.durationMs}ms, ${orig.logicalReads.toLocaleString()} vs ${cand.logicalReads.toLocaleString()} reads).`;
    }

    return {
      original: orig,
      candidate: cand,
      deltas: {
        durationMs: durationDeltaMs,
        durationPercent: -durationImprovementPercent,
        cpuMs: cpuDeltaMs,
        cpuPercent: -cpuImprovementPercent,
        logicalReads: readsDelta,
        readsPercent: -readsImprovementPercent,
        p95Ms: p95DeltaMs,
        p95Percent: -p95ImprovementPercent,
        rowCount: rowCountDelta
      },
      improvements: {
        durationPercent: durationImprovementPercent,
        cpuPercent: cpuImprovementPercent,
        readsPercent: readsImprovementPercent,
        p95Percent: p95ImprovementPercent
      },
      isRowCountEqual,
      winner,
      outcomeText,
      outcomeType,
      summary
    };
  }

  return {
    compareBenchmarks,
    extractBenchmarkMetrics
  };
}));
