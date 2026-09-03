/**
 * SQL Server Refactoring & Performance Studio
 * SQL Workbench Execution & Benchmark Engine
 *
 * Guardrails:
 * - Strict Read-Only Validation on all queries before execution
 * - Clean try/finally cleanup of session states (SET SHOWPLAN_XML, SET STATISTICS IO/TIME/XML)
 * - True query cancellation via active driver request handles
 * - Strict separation of planType: ESTIMATED vs planType: ACTUAL
 * - Benchmark mode with warm-up tracking and statistical metrics (Median, P95, Min, Max)
 * - In-memory session history (passwords/API keys never recorded)
 */

const crypto = require('crypto');
const db = require('./sqlServer');
const { validateReadOnly } = require('./sqlValidator');

// In-memory active requests for cancellation
const activeRequests = new Map();

// In-memory session query history
const sessionHistory = [];

/**
 * Parses raw STATISTICS IO and TIME string messages returned by SQL Server.
 */
function parseStatistics(infoMessages = []) {
  const tableStats = [];
  let cpuTime = 0;
  let elapsedTime = 0;

  for (const msg of infoMessages) {
    const text = msg.message || String(msg);

    // Table 'STOK_HAREKETLERI'. Scan count 4, logical reads 18422, physical reads 0...
    const tableMatch = text.match(/Table\s+'([^']+)'\.\s+Scan\s+count\s+(\d+),\s+logical\s+reads\s+(\d+),\s+physical\s+reads\s+(\d+)/i);
    if (tableMatch) {
      tableStats.push({
        table: tableMatch[1],
        scanCount: Number(tableMatch[2]),
        logicalReads: Number(tableMatch[3]),
        physicalReads: Number(tableMatch[4])
      });
    }

    // SQL Server Execution Times: CPU time = 530 ms, elapsed time = 842 ms.
    const timeMatch = text.match(/CPU\s+time\s*=\s*(\d+)\s*ms,\s*elapsed\s+time\s*=\s*(\d+)\s*ms/i);
    if (timeMatch) {
      cpuTime += Number(timeMatch[1]);
      elapsedTime += Number(timeMatch[2]);
    }
  }

  const totalLogicalReads = tableStats.reduce((acc, t) => acc + t.logicalReads, 0);
  const totalPhysicalReads = tableStats.reduce((acc, t) => acc + t.physicalReads, 0);

  return {
    tables: tableStats,
    totalLogicalReads,
    totalPhysicalReads,
    cpuTimeMs: cpuTime,
    elapsedTimeMs: elapsedTime
  };
}

/**
 * Executes a user SELECT query in read-only mode with statistics and cancellation support.
 */
async function executeQuery({ sql, timeoutMs = 30000, requestId = crypto.randomUUID() }) {
  // 1. Guardrail: Validate Read-Only
  const valRes = validateReadOnly(sql);
  if (!valRes.valid) {
    throw new Error(valRes.reason);
  }

  if (!db.status().connected) {
    throw new Error('Aktif SQL Server bağlantısı yok. Lütfen önce bağlanın.');
  }

  const pool = db.getPool();
  if (!pool) throw new Error('Veritabanı bağlantı havuzu hazır değil.');

  const request = pool.request();
  request.timeout = timeoutMs;
  activeRequests.set(requestId, request);

  const infoMessages = [];
  request.on('info', info => {
    if (info && info.message) infoMessages.push(info);
  });

  const startTime = Date.now();
  let result = null;

  try {
    // Enable Statistics IO and TIME
    await pool.request().batch('SET STATISTICS IO ON; SET STATISTICS TIME ON;');

    result = await request.query(sql);
  } finally {
    activeRequests.delete(requestId);
    // 2. Guardrail: Clean up session state unconditionally
    try {
      await pool.request().batch('SET STATISTICS IO OFF; SET STATISTICS TIME OFF;');
    } catch (_) {
      // Ignore cleanup error on connection close
    }
  }

  const endTime = Date.now();
  const elapsedMs = endTime - startTime;
  const parsedStats = parseStatistics(infoMessages);

  // If SQL Server didn't report elapsed time in message, use wall clock
  if (!parsedStats.elapsedTimeMs) parsedStats.elapsedTimeMs = elapsedMs;

  const rows = result.recordset || [];
  const columns = result.recordset?.columns ? Object.keys(result.recordset.columns) : (rows[0] ? Object.keys(rows[0]) : []);

  const executionRecord = {
    id: requestId,
    query: sql.slice(0, 160),
    durationMs: elapsedMs,
    cpuMs: parsedStats.cpuTimeMs,
    logicalReads: parsedStats.totalLogicalReads,
    rowsCount: rows.length,
    status: 'SUCCESS',
    timestamp: new Date().toISOString(),
    database: db.status().connection?.database || ''
  };

  sessionHistory.unshift(executionRecord);
  if (sessionHistory.length > 50) sessionHistory.pop();

  return {
    ok: true,
    requestId,
    metrics: {
      durationMs: elapsedMs,
      cpuMs: parsedStats.cpuTimeMs,
      logicalReads: parsedStats.totalLogicalReads,
      physicalReads: parsedStats.totalPhysicalReads,
      rowsReturned: rows.length,
      evidence: 'Actual execution'
    },
    columns,
    rows: rows.slice(0, 500), // capped for frontend transfer safety
    totalRows: rows.length,
    statistics: parsedStats,
    messages: infoMessages.map(m => m.message || String(m))
  };
}

/**
 * Cancels a running query.
 */
function cancelQuery(requestId) {
  if (activeRequests.has(requestId)) {
    const req = activeRequests.get(requestId);
    try {
      req.cancel();
      activeRequests.delete(requestId);
      return { ok: true, message: 'Sorgu başarıyla iptal edildi.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, message: 'İptal edilecek aktif sorgu bulunamadı.' };
}

/**
 * Obtains Estimated Plan (SET SHOWPLAN_XML ON - compiles, NEVER executes)
 * OR Actual Plan (SET STATISTICS XML ON - executes and gathers actual runtime XML).
 */
async function getExecutionPlan({ sql, mode = 'estimated', timeoutMs = 30000 }) {
  // 1. Guardrail: Validate Read-Only
  const valRes = validateReadOnly(sql);
  if (!valRes.valid) throw new Error(valRes.reason);

  if (!db.status().connected) {
    throw new Error('Aktif SQL Server bağlantısı yok. Lütfen önce bağlanın.');
  }

  const pool = db.getPool();
  if (!pool) throw new Error('Veritabanı havuzu hazır değil.');

  const planType = mode === 'actual' ? 'ACTUAL' : 'ESTIMATED';
  let planXml = null;

  try {
    if (mode === 'actual') {
      // ACTUAL PLAN: Executes query with STATISTICS XML ON
      await pool.request().batch('SET STATISTICS XML ON;');
      const req = pool.request();
      req.timeout = timeoutMs;
      const res = await req.query(sql);

      // Search for XML Showplan column
      for (const set of [res.recordset, ...(res.recordsets || [])]) {
        if (set && set[0]) {
          const colName = Object.keys(set[0]).find(k => k.toLowerCase().includes('showplan') || k.toLowerCase().includes('xml'));
          if (colName && set[0][colName]) {
            planXml = set[0][colName];
            break;
          }
        }
      }
    } else {
      // ESTIMATED PLAN: Compiles query without executing (SET SHOWPLAN_XML ON)
      await pool.request().batch('SET SHOWPLAN_XML ON;');
      const req = pool.request();
      req.timeout = timeoutMs;
      const res = await req.query(sql);

      if (res.recordset && res.recordset[0]) {
        const col = Object.keys(res.recordset[0])[0];
        planXml = res.recordset[0][col];
      }
    }
  } finally {
    // 2. Guardrail: Clean up session state unconditionally
    try {
      await pool.request().batch('SET SHOWPLAN_XML OFF; SET STATISTICS XML OFF;');
    } catch (_) {
      // Ignore
    }
  }

  if (!planXml) {
    throw new Error(`${planType} plan XML verisi SQL Server tarafından döndürülemedi.`);
  }

  return {
    ok: true,
    planType, // STRICT GUARANTEE: 'ESTIMATED' or 'ACTUAL'
    rawXml: planXml
  };
}

/**
 * Benchmark Mode: Executes query N times (default 3, max 10) with statistics.
 */
async function executeBenchmark({ sql, runs = 3, warmUp = true, timeoutMs = 30000, benchmarkId = crypto.randomUUID() }) {
  const valRes = validateReadOnly(sql);
  if (!valRes.valid) throw new Error(valRes.reason);

  const iterations = Math.min(10, Math.max(1, Number(runs) || 3));
  const runResults = [];

  for (let i = 0; i < iterations; i++) {
    const isWarmUpRun = warmUp && i === 0;
    const reqId = `${benchmarkId}_run_${i}`;

    const res = await executeQuery({ sql, timeoutMs, requestId: reqId });
    runResults.push({
      iteration: i + 1,
      isWarmUp: isWarmUpRun,
      durationMs: res.metrics.durationMs,
      cpuMs: res.metrics.cpuMs,
      logicalReads: res.metrics.logicalReads,
      rows: res.metrics.rowsReturned
    });

    // Brief inter-iteration yield to permit event-loop checks
    await new Promise(r => setTimeout(r, 60));
  }

  // Statistical calculations (optionally exclude warmup if iterations > 1)
  const measured = (warmUp && iterations > 1) ? runResults.slice(1) : runResults;
  const durations = measured.map(r => r.durationMs).sort((a, b) => a - b);
  const reads = measured.map(r => r.logicalReads).sort((a, b) => a - b);
  const cpus = measured.map(r => r.cpuMs).sort((a, b) => a - b);

  const min = durations[0];
  const max = durations[durations.length - 1];
  const median = durations[Math.floor(durations.length / 2)];
  const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
  const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);

  const logicalReadsMedian = reads[Math.floor(reads.length / 2)];
  const cpuMedian = cpus[Math.floor(cpus.length / 2)];

  return {
    ok: true,
    benchmarkId,
    totalRuns: iterations,
    warmUpIncluded: !warmUp || iterations === 1,
    summary: {
      medianMs: median,
      p95Ms: p95,
      minMs: min,
      maxMs: max,
      avgMs: avg,
      logicalReadsMedian,
      cpuMedianMs: cpuMedian
    },
    runs: runResults
  };
}

function getHistory() {
  return sessionHistory;
}

module.exports = {
  executeQuery,
  cancelQuery,
  getExecutionPlan,
  executeBenchmark,
  getHistory,
  parseStatistics
};
