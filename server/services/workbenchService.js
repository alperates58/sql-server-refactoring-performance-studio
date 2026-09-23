/**
 * SQL Server Refactoring & Performance Studio
 * SQL Workbench Execution Engine (Phase 2.5 Multi-Database)
 *
 * Guardrail Enforcement:
 * - NO "USE [db] + restore" on pooled connections.
 * - Queries execute directly against the selected database's dedicated ConnectionPool.
 * - try/finally unconditional session cleanup:
 *    SET STATISTICS IO, TIME, XML OFF; SET SHOWPLAN_XML OFF;
 * - Concurrency: DB_A and DB_B queries run on distinct pools in parallel without mixing.
 * - Active cancellation via request.cancel().
 */

const db = require('./sqlServer');
const { validateReadOnly } = require('./sqlValidator');
const { defaultQueryHistoryService } = require('./queryHistoryService');
const { defaultStorage } = require('./workspaceStorage');

const activeRequests = new Map(); // requestId -> sql.Request
const sessionHistory = [];

function parseStatisticsIo(rawMessages = []) {
  const tableStats = [];
  const patterns = [
    /(?:Table|Tablo)\s+'([^']+)'.*?(?:Scan count|Tarama say[ıi]s[ıi])\s+(\d+).*?(?:logical reads|mant[ıi]ksal okuma)\s+(\d+).*?(?:physical reads|fiziksel okuma)\s+(\d+)/gi,
    /'([^']+)'\s+tablosu.*?(?:Tarama say[ıi]s[ıi])\s+(\d+).*?(?:mant[ıi]ksal okuma)\s+(\d+).*?(?:fiziksel okuma)\s+(\d+)/gi
  ];

  for (const msg of rawMessages) {
    for (const regex of patterns) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(msg)) !== null) {
        tableStats.push({
          table: match[1],
          scanCount: parseInt(match[2], 10),
          logicalReads: parseInt(match[3], 10),
          physicalReads: parseInt(match[4], 10)
        });
      }
    }
  }

  const totalLogicalReads = tableStats.reduce((acc, t) => acc + t.logicalReads, 0);
  const totalPhysicalReads = tableStats.reduce((acc, t) => acc + t.physicalReads, 0);

  return {
    tableStats,
    totalLogicalReads,
    totalPhysicalReads
  };
}

function parseStatisticsTime(rawMessages = []) {
  let cpuMs = 0;
  let elapsedMs = 0;
  const timeRegex = /(?:CPU time|CPU zaman[ıi])\s*=\s*(\d+)\s*ms,?\s*(?:elapsed time|ge[çc]en zaman)\s*=\s*(\d+)\s*ms/gi;

  for (const msg of rawMessages) {
    timeRegex.lastIndex = 0;
    let match;
    while ((match = timeRegex.exec(msg)) !== null) {
      cpuMs += parseInt(match[1], 10);
      elapsedMs += parseInt(match[2], 10);
    }
  }

  return { cpuMs, elapsedMs };
}

function sanitizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    if (typeof val === 'bigint') {
      out[key] = val.toString();
    } else if (val instanceof Date) {
      out[key] = val.toISOString();
    } else if (Buffer.isBuffer(val)) {
      out[key] = '0x' + val.toString('hex');
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Execute query against the selected database's dedicated pool.
 */
async function execute({
  sql,
  database = null,
  timeoutMs = 30000,
  maxRows = 500,
  requestId = null
}) {
  const validation = validateReadOnly(sql);
  if (!validation.valid) {
    throw new Error(`Read-only safety policy blocked this statement: ${validation.reason}`);
  }

  const targetDb = database || db.status().primaryDatabase;
  const pool = db.getPool(targetDb);
  if (!pool) throw new Error(`"${targetDb}" veritabanı bağlantı havuzu bulunamadı.`);

  const messages = [];
  const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const request = pool.request();
  activeRequests.set(reqId, request);
  request.timeout = Math.min(120000, Math.max(1000, Number(timeoutMs) || 30000));

  // Capture T-SQL informational messages (STATISTICS IO, STATISTICS TIME, PRINT)
  request.on('info', info => {
    if (info && info.message) messages.push(info.message);
  });

  const startTime = process.hrtime.bigint();

  try {
    const wrappedBatch = `
      SET NOCOUNT ON;
      SET STATISTICS IO ON;
      SET STATISTICS TIME ON;
      ${sql};
    `;

    const result = await request.batch(wrappedBatch);
    const endTime = process.hrtime.bigint();
    const durationMs = Number((endTime - startTime) / 1000000n);

    if (result.recordsets && result.recordsets.length > 0) {
      for (const rs of result.recordsets) {
        if (rs.messages) {
          for (const m of rs.messages) messages.push(m.message);
        }
      }
    }

    const ioStats = parseStatisticsIo(messages);
    const timeStats = parseStatisticsTime(messages);

    const rawRecordsets = (result.recordsets && result.recordsets.length > 0)
      ? result.recordsets
      : [[]];

    const DEFAULT_MAX_ROWS = 10000;
    const rowLimit = maxRows !== undefined && maxRows !== null && Number(maxRows) > 0
      ? Math.min(50000, Number(maxRows))
      : DEFAULT_MAX_ROWS;

    const resultSets = rawRecordsets.map((rs, idx) => {
      const isTruncated = rowLimit > 0 && rs.length > rowLimit;
      const rawSlice = rowLimit > 0 ? rs.slice(0, rowLimit) : rs;
      const truncated = rawSlice.map(sanitizeRow);
      const cols = truncated.length > 0 ? Object.keys(truncated[0]) : (rs.columns ? Object.keys(rs.columns) : []);
      const columnMeta = rs.columns ? Object.entries(rs.columns).map(([colName, col]) => ({
        name: colName,
        type: col.type?.name || (typeof col.type === 'string' ? col.type : 'UNKNOWN'),
        nullable: col.nullable !== false
      })) : cols.map(c => ({ name: c, type: 'UNKNOWN', nullable: true }));

      return {
        setIndex: idx + 1,
        columns: cols,
        columnMetadata: columnMeta,
        rows: truncated,
        totalRows: rs.length,
        rowsReturned: truncated.length,
        maxRows: rowLimit,
        truncated: isTruncated
      };
    });

    const primaryResultSet = resultSets[0] || {
      setIndex: 1,
      columns: [],
      columnMetadata: [],
      rows: [],
      totalRows: 0,
      rowsReturned: 0,
      maxRows: rowLimit,
      truncated: false
    };

    const response = {
      ok: true,
      requestId: reqId,
      database: targetDb,
      columns: primaryResultSet.columns,
      rows: primaryResultSet.rows,
      totalRows: primaryResultSet.totalRows,
      rowsReturned: primaryResultSet.rowsReturned,
      maxRows: rowLimit,
      truncated: primaryResultSet.truncated,
      resultSets,
      metrics: {
        durationMs,
        cpuMs: timeStats.cpuMs,
        elapsedMs: timeStats.elapsedMs,
        logicalReads: ioStats.totalLogicalReads,
        physicalReads: ioStats.totalPhysicalReads,
        tableStats: ioStats.tableStats,
        rowsReturned: primaryResultSet.rowsReturned
      },
      statistics: {
        tables: ioStats.tableStats,
        totalLogicalReads: ioStats.totalLogicalReads,
        cpuTimeMs: timeStats.cpuMs,
        elapsedTimeMs: timeStats.elapsedMs
      },
      messages
    };

    // In-memory quick session history
    sessionHistory.unshift({
      id: reqId,
      time: new Date().toISOString(),
      timestamp: Date.now(),
      database: targetDb,
      sql: sql.slice(0, 160),
      query: sql.slice(0, 160),
      durationMs,
      logicalReads: ioStats.totalLogicalReads,
      rowCount: primaryResultSet.totalRows,
      rowsCount: primaryResultSet.totalRows
    });
    if (sessionHistory.length > 50) sessionHistory.pop();

    // Persistent query history (Sprint 7)
    try {
      defaultQueryHistoryService.recordExecution({
        sql,
        database: targetDb,
        durationMs,
        cpuMs: timeStats.cpuMs,
        logicalReads: ioStats.totalLogicalReads,
        rowCount: primaryResultSet.totalRows,
        success: true
      });
    } catch (_) {}

    return response;
  } catch (err) {
    const sanitized = db.sanitizeError(err);
    try {
      defaultQueryHistoryService.recordExecution({
        sql,
        database: targetDb,
        durationMs: 0,
        cpuMs: 0,
        logicalReads: 0,
        rowCount: 0,
        success: false,
        errorCode: sanitized.code || 'SQL_ERROR',
        errorMessage: sanitized.message
      });
    } catch (_) {}
    throw sanitized;
  } finally {
    activeRequests.delete(reqId);
    // Unconditional session state cleanup on this database's pool
    try {
      await pool.request().batch('SET STATISTICS IO OFF; SET STATISTICS TIME OFF; SET NOCOUNT OFF;');
    } catch (_) {}
  }
}

/**
 * Cancel an ongoing request by requestId.
 */
function cancelRequest(requestId) {
  const req = activeRequests.get(requestId);
  if (req) {
    try {
      req.cancel();
      activeRequests.delete(requestId);
      return {
        ok: true,
        status: 'QUERY_CANCELLED',
        message: `Request ${requestId} başarıyla iptal edildi.`
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: `Request ${requestId} bulunamadı veya zaten tamamlandı.` };
}

/**
 * Execute ShowPlan XML on the selected database's pool.
 */
async function executePlan({
  sql,
  database = null,
  mode = 'estimated',
  timeoutMs = 15000,
  requestId = null
}) {
  const validation = validateReadOnly(sql);
  if (!validation.valid) {
    throw new Error(`Read-only safety policy: ${validation.reason}`);
  }

  const targetDb = database || db.status().primaryDatabase;
  const pool = db.getPool(targetDb);
  if (!pool) throw new Error(`"${targetDb}" veritabanı bağlantı havuzu bulunamadı.`);

  const reqId = requestId || `plan_${Date.now()}`;
  const request = pool.request();
  activeRequests.set(reqId, request);
  request.timeout = Math.min(60000, Math.max(1000, Number(timeoutMs) || 15000));

  const isActual = mode.toLowerCase() === 'actual';

  try {
    let rawXml = '';
    if (isActual) {
      const actualBatch = `
        SET STATISTICS XML ON;
        ${sql};
      `;
      const result = await request.batch(actualBatch);
      if (result.recordsets) {
        for (const rs of result.recordsets) {
          for (const row of rs) {
            const key = Object.keys(row).find(k => k.toLowerCase().includes('showplan') || k.toLowerCase().includes('xml'));
            if (key && row[key]) {
              rawXml = row[key];
              break;
            }
          }
          if (rawXml) break;
        }
      }
    } else {
      const transaction = pool.transaction();
      await transaction.begin();
      try {
        const estReq = transaction.request();
        estReq.timeout = request.timeout;
        await estReq.batch('SET SHOWPLAN_XML ON;');
        const estResult = await estReq.batch(sql);
        if (estResult.recordset && estResult.recordset.length > 0) {
          const row = estResult.recordset[0];
          const key = Object.keys(row)[0];
          rawXml = row[key];
        }
        await estReq.batch('SET SHOWPLAN_XML OFF;').catch(() => {});
      } finally {
        await transaction.rollback().catch(() => {});
      }
    }

    return {
      ok: true,
      requestId: reqId,
      database: targetDb,
      planType: isActual ? 'ACTUAL' : 'ESTIMATED',
      rawXml: rawXml || ''
    };
  } catch (err) {
    throw db.sanitizeError(err);
  } finally {
    activeRequests.delete(reqId);
    try {
      await pool.request().batch('SET STATISTICS XML OFF; SET SHOWPLAN_XML OFF;');
    } catch (_) {}
  }
}

/**
 * Execute Benchmark on the selected database's pool.
 */
async function executeBenchmark({
  sql,
  database = null,
  runs = 3,
  warmUp = true,
  timeoutMs = 30000,
  benchmarkId = null
}) {
  const validation = validateReadOnly(sql);
  if (!validation.valid) {
    throw new Error(`Salt-okunur kural ihlali nedeniyle benchmark engellendi: ${validation.reason}`);
  }

  const targetDb = database || db.status().primaryDatabase;
  const pool = db.getPool(targetDb);
  if (!pool) throw new Error(`"${targetDb}" veritabanı bağlantı havuzu bulunamadı.`);

  const bId = benchmarkId || `bench_${Date.now()}`;
  const totalRuns = Math.min(10, Math.max(1, Number(runs) || 3));
  const iterations = [];

  if (warmUp) {
    try {
      const warmReq = pool.request();
      warmReq.timeout = timeoutMs;
      await warmReq.batch(`SET NOCOUNT ON; ${sql};`);
    } catch (_) {}
  }

  for (let i = 1; i <= totalRuns; i++) {
    const iterReq = pool.request();
    iterReq.timeout = timeoutMs;
    const msgs = [];
    iterReq.on('info', info => {
      if (info && info.message) msgs.push(info.message);
    });
    const startTime = process.hrtime.bigint();

    try {
      const wrapped = `
        SET NOCOUNT ON;
        SET STATISTICS IO ON;
        SET STATISTICS TIME ON;
        ${sql};
      `;
      const res = await iterReq.batch(wrapped);
      const endTime = process.hrtime.bigint();
      const durMs = Number((endTime - startTime) / 1000000n);

      if (res.recordsets) {
        for (const set of res.recordsets) {
          if (set.messages) for (const m of set.messages) msgs.push(m.message);
        }
      }

      const io = parseStatisticsIo(msgs);
      const time = parseStatisticsTime(msgs);

      iterations.push({
        iteration: i,
        durationMs: durMs,
        cpuMs: time.cpuMs,
        logicalReads: io.totalLogicalReads,
        physicalReads: io.totalPhysicalReads,
        rowCount: (res.recordset || []).length
      });
    } catch (err) {
      iterations.push({
        iteration: i,
        error: err.message
      });
    } finally {
      try {
        await pool.request().batch('SET STATISTICS IO OFF; SET STATISTICS TIME OFF;');
      } catch (_) {}
    }
  }

  const validRuns = iterations.filter(r => !r.error);
  const durations = validRuns.map(r => r.durationMs).sort((a, b) => a - b);
  const reads = validRuns.map(r => r.logicalReads).sort((a, b) => a - b);

  const medianDuration = durations.length > 0
    ? durations[Math.floor(durations.length / 2)]
    : 0;

  const p95Duration = durations.length > 0
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
    : 0;

  const medianReads = reads.length > 0
    ? reads[Math.floor(reads.length / 2)]
    : 0;

  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  return {
    ok: true,
    benchmarkId: bId,
    database: targetDb,
    totalRuns: totalRuns,
    runsRequested: totalRuns,
    runsCompleted: validRuns.length,
    warmUpApplied: warmUp,
    warmUpIncluded: false,
    metrics: {
      medianDurationMs: medianDuration,
      p95DurationMs: p95Duration,
      minDurationMs: durations[0] || 0,
      maxDurationMs: durations[durations.length - 1] || 0,
      avgDurationMs: avgDuration,
      medianLogicalReads: medianReads
    },
    summary: {
      medianMs: medianDuration,
      p95Ms: p95Duration,
      minMs: durations[0] || 0,
      maxMs: durations[durations.length - 1] || 0,
      avgMs: avgDuration,
      logicalReadsMedian: medianReads
    },
    runs: validRuns.map(r => ({
      iteration: r.iteration,
      isWarmUp: false,
      durationMs: r.durationMs,
      cpuMs: r.cpuMs,
      logicalReads: r.logicalReads,
      rows: r.rowCount || 0
    })),
    iterations
  };
}

function getHistory() {
  return sessionHistory;
}

function getWorkbenchSessions() {
  return defaultStorage.getWorkbenchSessions();
}

function saveWorkbenchSessions(tabs) {
  return defaultStorage.saveWorkbenchSessions(tabs);
}

function clearWorkbenchSessions() {
  return defaultStorage.clearWorkbenchSessions();
}

/**
 * Alternating benchmark execution (A/B/B/A/A/B pattern).
 * Completely eliminates warm-cache bias between original and candidate queries.
 * Preserves zero-mutation rule (no DBCC DROPCLEANBUFFERS or FREEPROCCACHE).
 */
async function executeAlternatingBenchmark({
  originalSql,
  candidateSql,
  database = null,
  warmUp = true,
  timeoutMs = 30000
} = {}) {
  const vOrig = validateReadOnly(originalSql);
  if (!vOrig.valid) throw new Error(`Orijinal sorgu kural ihlali: ${vOrig.reason}`);
  const vCand = validateReadOnly(candidateSql);
  if (!vCand.valid) throw new Error(`Aday sorgu kural ihlali: ${vCand.reason}`);

  const targetDb = database || db.status().primaryDatabase;
  const pool = db.getPool(targetDb);
  if (!pool) throw new Error(`"${targetDb}" veritabanı bağlantı havuzu bulunamadı.`);

  // 1. Warmup
  if (warmUp) {
    try {
      const warmReq1 = pool.request();
      warmReq1.timeout = timeoutMs;
      await warmReq1.batch(`SET NOCOUNT ON; ${originalSql};`);
    } catch (_) {}
    try {
      const warmReq2 = pool.request();
      warmReq2.timeout = timeoutMs;
      await warmReq2.batch(`SET NOCOUNT ON; ${candidateSql};`);
    } catch (_) {}
  }

  // 2. Alternating sequence: A (Orig), B (Cand), B (Cand), A (Orig), A (Orig), B (Cand)
  const sequence = [
    { target: 'ORIGINAL', sql: originalSql },
    { target: 'CANDIDATE', sql: candidateSql },
    { target: 'CANDIDATE', sql: candidateSql },
    { target: 'ORIGINAL', sql: originalSql },
    { target: 'ORIGINAL', sql: originalSql },
    { target: 'CANDIDATE', sql: candidateSql }
  ];

  const runs = [];

  for (let idx = 0; idx < sequence.length; idx++) {
    const item = sequence[idx];
    const iterReq = pool.request();
    iterReq.timeout = timeoutMs;
    const msgs = [];
    iterReq.on('info', info => {
      if (info && info.message) msgs.push(info.message);
    });

    const startTime = process.hrtime.bigint();
    try {
      const wrapped = `
        SET NOCOUNT ON;
        SET STATISTICS IO ON;
        SET STATISTICS TIME ON;
        ${item.sql};
      `;
      const res = await iterReq.batch(wrapped);
      const endTime = process.hrtime.bigint();
      const durMs = Number((endTime - startTime) / 1000000n);

      if (res.recordsets) {
        for (const set of res.recordsets) {
          if (set.messages) for (const m of set.messages) msgs.push(m.message);
        }
      }

      const io = parseStatisticsIo(msgs);
      const time = parseStatisticsTime(msgs);

      runs.push({
        runIndex: idx + 1,
        target: item.target,
        durationMs: durMs,
        cpuMs: time.cpuMs,
        logicalReads: io.totalLogicalReads,
        physicalReads: io.totalPhysicalReads,
        rowCount: (res.recordset || []).length
      });
    } catch (err) {
      runs.push({
        runIndex: idx + 1,
        target: item.target,
        error: err.message
      });
    } finally {
      try {
        await pool.request().batch('SET STATISTICS IO OFF; SET STATISTICS TIME OFF;');
      } catch (_) {}
    }
  }

  function compileMetrics(targetRuns = []) {
    const valid = targetRuns.filter(r => !r.error);
    const durs = valid.map(r => r.durationMs).sort((a, b) => a - b);
    const cpus = valid.map(r => r.cpuMs).sort((a, b) => a - b);
    const reads = valid.map(r => r.logicalReads).sort((a, b) => a - b);

    const medianDur = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
    const p95Dur = durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * 0.95))] : 0;
    const minDur = durs.length ? durs[0] : 0;
    const maxDur = durs.length ? durs[durs.length - 1] : 0;
    const medianCpu = cpus.length ? cpus[Math.floor(cpus.length / 2)] : 0;
    const medianReads = reads.length ? reads[Math.floor(reads.length / 2)] : 0;
    const rows = valid.length ? valid[0].rowCount : 0;

    const durVariance = medianDur > 0 ? (maxDur - minDur) / medianDur : 0;

    return {
      runs: valid,
      runsCount: valid.length,
      medianDurationMs: medianDur,
      p95DurationMs: p95Dur,
      minDurationMs: minDur,
      maxDurationMs: maxDur,
      medianCpuMs: medianCpu,
      cpuMs: medianCpu,
      medianLogicalReads: medianReads,
      logicalReads: medianReads,
      rowCount: rows,
      highVariance: durVariance > 0.5
    };
  }

  const origMetrics = compileMetrics(runs.filter(r => r.target === 'ORIGINAL'));
  const candMetrics = compileMetrics(runs.filter(r => r.target === 'CANDIDATE'));

  return {
    ok: true,
    executionPattern: 'A/B/B/A/A/B',
    runs,
    original: {
      metrics: origMetrics,
      runs: origMetrics.runs
    },
    candidate: {
      metrics: candMetrics,
      runs: candMetrics.runs
    }
  };
}

module.exports = {
  execute,
  cancelRequest,
  executePlan,
  executeBenchmark,
  executeAlternatingBenchmark,
  getHistory,
  getWorkbenchSessions,
  saveWorkbenchSessions,
  clearWorkbenchSessions,
  parseStatisticsIo,
  parseStatisticsTime,
  sanitizeRow
};

