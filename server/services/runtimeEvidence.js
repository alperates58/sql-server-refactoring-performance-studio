/**
 * SQL Server Refactoring & Performance Studio
 * Per-Database Runtime Evidence Service (Phase 2.5)
 *
 * Implements:
 * - Query Store evaluated independently per database (READ_WRITE, READ_ONLY, OFF)
 * - Evidence tagged with databaseName and canonicalId
 * - Honest runtime attribution with evidence grade (A for QS, B for DMV, D for static)
 */

const db = require('./sqlServer');

function formatDuration(microseconds) {
  if (!microseconds || microseconds <= 0) return '0ms';
  const ms = microseconds / 1000;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  return `${sec.toFixed(2)}s`;
}

function formatReads(reads) {
  if (!reads || reads <= 0) return '0';
  if (reads >= 1000000000) return `${(reads / 1000000000).toFixed(1)}B`;
  if (reads >= 1000000) return `${(reads / 1000000).toFixed(1)}M`;
  if (reads >= 1000) return `${(reads / 1000).toFixed(1)}K`;
  return String(Math.round(reads));
}

async function collectRuntimeEvidence(views = [], selectedDatabases = []) {
  const viewEvidence = new Map(); // canonicalId.toLowerCase() -> runtime summary
  const regressions = [];
  const perDbStatus = {};

  for (const dbName of selectedDatabases) {
    let pool;
    try {
      pool = db.getPool(dbName);
    } catch (_) {
      perDbStatus[dbName] = { queryStoreState: 'OFF', source: 'NONE', evidenceGrade: 'D' };
      continue;
    }

    // 1. Check Query Store on this specific database
    let qsState = 'OFF';
    try {
      const qsRes = await pool.request().query(`
        SELECT actual_state_desc, desired_state_desc 
        FROM sys.database_query_store_options;
      `);
      qsState = (qsRes.recordset[0]?.actual_state_desc || 'OFF').toUpperCase();
    } catch (_) {
      qsState = 'OFF';
    }

    const qsActive = qsState === 'READ_WRITE' || qsState === 'READ_ONLY';
    perDbStatus[dbName] = {
      queryStoreState: qsState,
      source: qsActive ? 'QUERY_STORE' : 'PLAN_CACHE',
      evidenceGrade: qsActive ? 'A' : 'B'
    };

    const dbViews = views.filter(v => (v.database || v.database_name) === dbName);
    if (dbViews.length === 0) continue;

    if (qsActive) {
      // Query Store path on this DB
      try {
        const qsQuery = `
          SELECT TOP 200
            q.query_id,
            qt.query_sql_text,
            p.plan_id,
            rs.count_executions,
            rs.avg_duration,
            rs.avg_logical_io_reads,
            rs.avg_cpu_time,
            rs.last_execution_time
          FROM sys.query_store_query AS q
          JOIN sys.query_store_query_text AS qt ON q.query_text_id = qt.query_text_id
          JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
          JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
          WHERE rs.last_execution_time >= DATEADD(day, -7, GETUTCDATE())
          ORDER BY rs.avg_logical_io_reads DESC;
        `;
        const qsRes = await pool.request().query(qsQuery);
        const rows = qsRes.recordset || [];

        for (const v of dbViews) {
          const vName = v.name || v.view_name;
          const matching = rows.filter(r => r.query_sql_text?.includes(vName));
          if (matching.length > 0) {
            const totalReads = matching.reduce((sum, r) => sum + (Number(r.avg_logical_io_reads || 0) * Number(r.count_executions || 1)), 0);
            const avgDurUs = matching.reduce((sum, r) => sum + Number(r.avg_duration || 0), 0) / matching.length;
            const avgCpuUs = matching.reduce((sum, r) => sum + Number(r.avg_cpu_time || 0), 0) / matching.length;
            const cId = v.canonicalId || `${dbName}.${v.schema_name || 'dbo'}.${vName}`;

            const summary = {
              databaseName: dbName,
              canonicalId: cId,
              viewName: vName,
              totalReads,
              formattedReads: formatReads(totalReads),
              avgDurationUs: avgDurUs,
              formattedDuration: formatDuration(avgDurUs),
              avgCpuUs,
              executionCount: matching.reduce((s, r) => s + Number(r.count_executions || 0), 0),
              planCount: matching.length,
              evidenceGrade: 'A',
              attributionMethod: 'Query Store query text correlation',
              isRegressed: false,
              callingQueries: matching.slice(0, 3).map(m => ({
                queryId: m.query_id,
                sql: m.query_sql_text.slice(0, 150),
                executions: m.count_executions,
                avgReads: formatReads(m.avg_logical_io_reads)
              }))
            };

            viewEvidence.set(cId.toLowerCase(), summary);
            viewEvidence.set(vName.toUpperCase(), summary);
          }
        }
      } catch (_) {
        // Query store query error fallback
      }
    } else {
      // Plan Cache (DMV) fallback on this DB
      try {
        const dmvSql = `
          SELECT TOP 100
            st.text,
            qs.execution_count,
            qs.total_logical_reads,
            qs.total_elapsed_time,
            qs.total_worker_time
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
          WHERE st.text NOT LIKE '%sys.dm_%'
          ORDER BY qs.total_logical_reads DESC;
        `;
        const dmvRes = await pool.request().query(dmvSql);
        const rows = dmvRes.recordset || [];

        for (const v of dbViews) {
          const vName = v.name || v.view_name;
          const matching = rows.filter(r => r.text?.includes(vName));
          if (matching.length > 0) {
            const totalReads = matching.reduce((sum, r) => sum + Number(r.total_logical_reads || 0), 0);
            const totalDurUs = matching.reduce((sum, r) => sum + Number(r.total_elapsed_time || 0), 0);
            const cId = v.canonicalId || `${dbName}.${v.schema_name || 'dbo'}.${vName}`;

            const summary = {
              databaseName: dbName,
              canonicalId: cId,
              viewName: vName,
              totalReads,
              formattedReads: formatReads(totalReads),
              avgDurationUs: matching.length > 0 ? totalDurUs / matching.length : 0,
              formattedDuration: formatDuration(matching.length > 0 ? totalDurUs / matching.length : 0),
              evidenceGrade: 'B',
              attributionMethod: 'Plan Cache (DMV) volatile text correlation',
              isRegressed: false,
              callingQueries: matching.slice(0, 3).map(m => ({
                sql: m.text.slice(0, 150),
                executions: m.execution_count,
                avgReads: formatReads(m.total_logical_reads / (m.execution_count || 1))
              }))
            };

            viewEvidence.set(cId.toLowerCase(), summary);
            viewEvidence.set(vName.toUpperCase(), summary);
          }
        }
      } catch (_) {}
    }
  }

  return {
    perDbStatus,
    viewEvidence,
    regressions
  };
}

module.exports = {
  collectRuntimeEvidence
};
