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

const activeRequests = new Map(); // requestId -> sql.Request
const sessionHistory = [];

function parseStatisticsIo(rawMessages = []) {
  const tableStats = [];
  const ioRegex = /Table '([^']+)'.*?Scan count (\d+), logical reads (\d+), physical reads (\d+)/gi;

  for (const msg of rawMessages) {
    let match;
    while ((match = ioRegex.exec(msg)) !== null) {
      tableStats.push({
        table: match[1],
        scanCount: parseInt(match[2], 10),
        logicalReads: parseInt(match[3], 10),
        physicalReads: parseInt(match[4], 10)
      });
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
  const timeRegex = /CPU time = (\d+) ms,?\s+elapsed time = (\d+) ms/gi;

  for (const msg of rawMessages) {
    let match;
    while ((match = timeRegex.exec(msg)) !== null) {
      cpuMs += parseInt(match[1], 10);
      elapsedMs += parseInt(match[2], 10);
    }
  }

  return { cpuMs, elapsedMs };
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

  request.setTimeout(Math.min(120000, Math.max(1000, Number(timeoutMs) || 30000)));

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

    const primaryRecordset = (result.recordsets && result.recordsets.length > 0)
      ? result.recordsets[0]
      : [];

    const truncatedRows = primaryRecordset.slice(0, maxRows);
    const columns = truncatedRows.length > 0 ? Object.keys(truncatedRows[0]) : [];

    const response = {
      ok: true,
      requestId: reqId,
      database: targetDb,
      columns,
      rows: truncatedRows,
      totalRows: primaryRecordset.length,
      truncated: primaryRecordset.length > maxRows,
      metrics: {
        durationMs,
        cpuMs: timeStats.cpuMs,
        elapsedMs: timeStats.elapsedMs,
        logicalReads: ioStats.totalLogicalReads,
        physicalReads: ioStats.totalPhysicalReads,
        tableStats: ioStats.tableStats
      },
      messages
    };

    sessionHistory.unshift({
      id: reqId,
      time: new Date().toISOString(),
      database: targetDb,
      sql: sql.slice(0, 160),
      durationMs,
      logicalReads: ioStats.totalLogicalReads,
      rowCount: primaryRecordset.length
    });
    if (sessionHistory.length > 50) sessionHistory.pop();

    return response;
  } catch (err) {
    throw db.sanitizeError(err);
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
      return { ok: true, message: `Request ${requestId} iptal edildi.` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: `Request ${requestId} bulunamadı veya tamamlandı.` };
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
  request.setTimeout(Math.min(60000, Math.max(1000, Number(timeoutMs) || 15000)));

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
      await pool.request().batch('SET SHOWPLAN_XML ON;');
      try {
        const estResult = await request.batch(sql);
        if (estResult.recordset && estResult.recordset.length > 0) {
          const row = estResult.recordset[0];
          const key = Object.keys(row)[0];
          rawXml = row[key];
        }
      } finally {
        await pool.request().batch('SET SHOWPLAN_XML OFF;');
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
    throw new Error(`Read-only benchmark blocked: ${validation.reason}`);
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
      warmReq.setTimeout(timeoutMs);
      await warmReq.batch(`SET NOCOUNT ON; ${sql};`);
    } catch (_) {}
  }

  for (let i = 1; i <= totalRuns; i++) {
    const iterReq = pool.request();
    iterReq.setTimeout(timeoutMs);
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

      const msgs = [];
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
        physicalReads: io.totalPhysicalReads
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

  return {
    ok: true,
    benchmarkId: bId,
    database: targetDb,
    runsRequested: totalRuns,
    runsCompleted: validRuns.length,
    warmUpApplied: warmUp,
    metrics: {
      medianDurationMs: medianDuration,
      p95DurationMs: p95Duration,
      minDurationMs: durations[0] || 0,
      maxDurationMs: durations[durations.length - 1] || 0,
      avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      medianLogicalReads: medianReads
    },
    iterations
  };
}

function getHistory() {
  return sessionHistory;
}

module.exports = {
  execute,
  cancelRequest,
  executePlan,
  executeBenchmark,
  getHistory
};
