/**
 * SQL Server Refactoring & Performance Studio
 * AST Synthetic Benchmark Script (Sprint 4)
 *
 * Measures cold vs cached AST parse throughput across 100, 500, and 1000 simulated view queries.
 */

const { parseSql, clearAstCache, getCacheStats } = require('../server/services/ast/astParser');
const { performance } = require('perf_hooks');

function generateSyntheticViews(count) {
  const views = [];
  for (let i = 1; i <= count; i++) {
    const viewName = `V_SYNTHETIC_VIEW_${i}`;
    const sql = `
      WITH RankedData_${i} AS (
        SELECT 
          d.id, 
          d.dept_id, 
          d.amount, 
          ROW_NUMBER() OVER (PARTITION BY d.dept_id ORDER BY d.created_at DESC) AS rn
        FROM dbo.DepartmentSales_${i % 10} d WITH (NOLOCK)
        WHERE d.status_code = ${i % 5}
          AND d.created_at >= '2026-01-01'
          AND d.created_at < '2027-01-01'
      )
      SELECT 
        r.id, 
        r.dept_id, 
        r.amount, 
        m.manager_name,
        CASE WHEN r.amount > 1000 THEN 'HIGH' ELSE 'NORMAL' END AS amount_category
      FROM RankedData_${i} r
      INNER JOIN dbo.Departments m ON r.dept_id = m.id
      LEFT JOIN dbo.AuditLog a ON r.id = a.source_id
      WHERE r.rn = 1
        AND r.amount > ${(i * 10) % 500}
      GROUP BY r.id, r.dept_id, r.amount, m.manager_name;
    `;
    views.push({ name: viewName, sql });
  }
  return views;
}

function runBenchmark() {
  const batchSizes = [100, 500, 1000];
  const results = [];

  console.log('========================================================================');
  console.log('T-SQL AST ENGINE SYNTHETIC PARSING BENCHMARK (SPRINT 4)');
  console.log('========================================================================');

  for (const size of batchSizes) {
    const views = generateSyntheticViews(size);

    // 1. Cold Parse Run (cache cleared before run)
    clearAstCache();
    const coldStart = performance.now();
    for (const v of views) {
      parseSql(v.sql);
    }
    const coldEnd = performance.now();
    const coldTotalMs = coldEnd - coldStart;
    const coldAvgMs = coldTotalMs / size;

    // 2. Cached Parse Run (same queries parsed with warm cache)
    const cachedStart = performance.now();
    for (const v of views) {
      parseSql(v.sql);
    }
    const cachedEnd = performance.now();
    const cachedTotalMs = cachedEnd - cachedStart;
    const cachedAvgMs = cachedTotalMs / size;

    const speedup = (coldTotalMs / (cachedTotalMs || 0.001)).toFixed(1);

    results.push({
      viewCount: size,
      coldTotalMs: Number(coldTotalMs.toFixed(2)),
      coldAvgMs: Number(coldAvgMs.toFixed(3)),
      cachedTotalMs: Number(cachedTotalMs.toFixed(2)),
      cachedAvgMs: Number(cachedAvgMs.toFixed(3)),
      speedupFactor: `${speedup}x`,
      cacheStats: getCacheStats()
    });

    console.log(`[Batch: ${size} Views]`);
    console.log(`  - Cold Parse  : ${coldTotalMs.toFixed(2)} ms total (${coldAvgMs.toFixed(3)} ms/view)`);
    console.log(`  - Cached Parse: ${cachedTotalMs.toFixed(2)} ms total (${cachedAvgMs.toFixed(3)} ms/view)`);
    console.log(`  - Speedup     : ${speedup}x`);
    console.log(`  - Cache Size  : ${getCacheStats().cachedEntries} entries`);
    console.log('------------------------------------------------------------------------');
  }

  return results;
}

if (require.main === module) {
  runBenchmark();
}

module.exports = {
  generateSyntheticViews,
  runBenchmark
};
