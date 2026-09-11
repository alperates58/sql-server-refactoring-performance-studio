/**
 * SQL Server Refactoring & Performance Studio
 * Query Store Regression & Runtime Evidence Engine (Sprint 2)
 *
 * Implements:
 * - Query Store capability detection per database (READ_WRITE, READ_ONLY, OFF, UNKNOWN)
 * - Baseline vs Current time-window split
 * - Pure regression, severity, and confidence algorithms
 * - Plan change / plan flip detection
 * - Robust View-to-Query matching (MATCH_EXACT_OBJECT, MATCH_TEXT)
 * - Controlled Plan Cache fallback (no fabricated baseline)
 * - Real Query Store time-series aggregation
 * - Parameterized SQL query builders (defense against SQL injection)
 */

const sql = require('mssql');
const db = require('./sqlServer');

const WINDOW_MAP = {
  '1h': { key: '1h', datepart: 'hour', offset: -1, currentOffset: -1, baselineOffset: -2, bucketMinutes: 5 },
  '24h': { key: '24h', datepart: 'hour', offset: -24, currentOffset: -24, baselineOffset: -48, bucketMinutes: 60 },
  '7d': { key: '7d', datepart: 'day', offset: -7, currentOffset: -7, baselineOffset: -14, bucketMinutes: 360 },
  '30d': { key: '30d', datepart: 'day', offset: -30, currentOffset: -30, baselineOffset: -60, bucketMinutes: 1440 }
};

const REGRESSION_THRESHOLDS = {
  MIN_EXECUTIONS: 3,
  MIN_DURATION_DELTA_MS: 100, // at least 100ms absolute degradation
  MIN_DURATION_PERCENT: 30,   // +30% duration
  MIN_CPU_PERCENT: 30,        // +30% CPU
  MIN_READS_PERCENT: 30       // +30% logical reads
};

function getWindowSpec(windowKey) {
  const key = String(windowKey || '').toLowerCase().trim();
  return WINDOW_MAP[key] || WINDOW_MAP['24h'];
}

function resolveWindowConfig(windowKey) {
  const spec = getWindowSpec(windowKey);
  return {
    key: spec.key,
    datepart: spec.datepart,
    offset: Math.abs(spec.offset),
    currentOffset: spec.currentOffset,
    baselineOffset: spec.baselineOffset,
    bucketMinutes: spec.bucketMinutes
  };
}

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

/**
 * Calculates delta and percentage change safely without division by zero.
 */
function calculateDelta(current, baseline) {
  const c = Number.isFinite(Number(current)) ? Number(current) : 0;
  const b = Number.isFinite(Number(baseline)) ? Number(baseline) : 0;

  if (b <= 0) {
    if (c > 0) {
      return { percent: 0, delta: Math.round(c * 10) / 10, status: 'NEW_ACTIVITY' };
    }
    return { percent: 0, delta: 0, status: 'NO_BASELINE' };
  }

  const percent = ((c - b) / b) * 100;
  const delta = c - b;
  return {
    percent: Math.round(percent * 10) / 10,
    delta: Math.round(delta * 10) / 10,
    status: 'OK'
  };
}

/**
 * Calculates deterministic regression severity score (0-100).
 */
function calculateSeverityScore({
  durationDeltaPercent = 0,
  durationDeltaMs = 0,
  cpuDeltaPercent = 0,
  readsDeltaPercent = 0,
  planChanged = false,
  currentExecutions = 0
}) {
  let score = 0;

  // 1. Duration degradation (up to 40 pts)
  if (durationDeltaPercent > 0) {
    const pctFactor = Math.min(1, durationDeltaPercent / 200); // 200%+ maxes percentage
    const msFactor = Math.min(1, Math.max(0, durationDeltaMs) / 3000); // 3s+ maxes absolute
    score += (pctFactor * 25) + (msFactor * 15);
  }

  // 2. CPU degradation (up to 20 pts)
  if (cpuDeltaPercent > 0) {
    score += Math.min(20, (cpuDeltaPercent / 200) * 20);
  }

  // 3. Logical reads degradation (up to 20 pts)
  if (readsDeltaPercent > 0) {
    score += Math.min(20, (readsDeltaPercent / 250) * 20);
  }

  // 4. Plan flip penalty (up to 10 pts)
  if (planChanged) {
    score += 10;
  }

  // 5. Execution frequency scale (up to 10 pts)
  if (currentExecutions >= 100) score += 10;
  else if (currentExecutions >= 20) score += 7;
  else if (currentExecutions >= 5) score += 4;
  else if (currentExecutions >= 1) score += 2;

  const finalScore = Math.min(100, Math.max(0, Math.round(score)));

  let severity = 'INFO';
  if (finalScore >= 75) severity = 'CRITICAL';
  else if (finalScore >= 50) severity = 'HIGH';
  else if (finalScore >= 25) severity = 'MODERATE';

  return { severityScore: finalScore, severity };
}

/**
 * Evaluates statistical noise and sample sufficiency.
 */
function calculateConfidence(currentExecutions = 0, baselineExecutions = 0) {
  const curr = Number(currentExecutions) || 0;
  const base = Number(baselineExecutions) || 0;

  if (curr < 3 || base < 1) return 'LOW';
  if (curr < 10 || base < 3) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Pure regression decision engine using threshold constants.
 */
function detectRegression({ current, baseline, planChanged = false, currentPlanId = null, baselinePlanId = null }) {
  if (!current || current.executionCount === 0) {
    return {
      isRegressed: false,
      status: 'NO_ACTIVITY',
      severity: 'INFO',
      severityScore: 0,
      confidence: 'LOW',
      reasons: []
    };
  }

  if (!baseline || baseline.executionCount === 0) {
    return {
      isRegressed: false,
      status: 'NO_BASELINE',
      severity: 'INFO',
      severityScore: 0,
      confidence: calculateConfidence(current.executionCount, 0),
      reasons: [{ code: 'NEW_ACTIVITY', note: 'Önceki referans döneminde (baseline) çalışma kaydı bulunmuyor.' }]
    };
  }

  const durDelta = calculateDelta(current.avgDurationMs, baseline.avgDurationMs);
  const cpuDelta = calculateDelta(current.avgCpuMs, baseline.avgCpuMs);
  const readsDelta = calculateDelta(current.avgLogicalReads, baseline.avgLogicalReads);

  const confidence = calculateConfidence(current.executionCount, baseline.executionCount);

  const reasons = [];
  let isRegressed = false;

  // Criterion A: Minimum execution count
  const hasMinExecs = current.executionCount >= REGRESSION_THRESHOLDS.MIN_EXECUTIONS;

  // Criterion B & C: Duration degradation
  if (durDelta.percent >= REGRESSION_THRESHOLDS.MIN_DURATION_PERCENT && durDelta.delta >= REGRESSION_THRESHOLDS.MIN_DURATION_DELTA_MS) {
    reasons.push({
      code: 'DURATION_INCREASE',
      title: 'Çalışma Süresi Artışı',
      baseline: baseline.avgDurationMs,
      current: current.avgDurationMs,
      deltaPercent: durDelta.percent,
      deltaMs: durDelta.delta
    });
    if (hasMinExecs) isRegressed = true;
  }

  // CPU degradation
  if (cpuDelta.percent >= REGRESSION_THRESHOLDS.MIN_CPU_PERCENT && cpuDelta.delta >= 30) {
    reasons.push({
      code: 'CPU_INCREASE',
      title: 'İşlemci (CPU) Tüketim Artışı',
      baseline: baseline.avgCpuMs,
      current: current.avgCpuMs,
      deltaPercent: cpuDelta.percent,
      deltaMs: cpuDelta.delta
    });
    if (hasMinExecs) isRegressed = true;
  }

  // Reads degradation
  if (readsDelta.percent >= REGRESSION_THRESHOLDS.MIN_READS_PERCENT && readsDelta.delta >= 500) {
    reasons.push({
      code: 'LOGICAL_READS_INCREASE',
      title: 'Mantıksal Okuma (I/O) Artışı',
      baseline: baseline.avgLogicalReads,
      current: current.avgLogicalReads,
      deltaPercent: readsDelta.percent,
      deltaReads: readsDelta.delta
    });
    if (hasMinExecs) isRegressed = true;
  }

  // Plan flip detection
  if (planChanged) {
    reasons.push({
      code: 'PLAN_CHANGED',
      title: 'Yürütme Planı Değişimi (Plan Flip)',
      baselinePlanId,
      currentPlanId
    });
    if (hasMinExecs && durDelta.percent >= 15) {
      isRegressed = true;
    }
  }

  const { severityScore, severity } = calculateSeverityScore({
    durationDeltaPercent: durDelta.percent,
    durationDeltaMs: durDelta.delta,
    cpuDeltaPercent: cpuDelta.percent,
    readsDeltaPercent: readsDelta.percent,
    planChanged,
    currentExecutions: current.executionCount
  });

  return {
    isRegressed,
    status: isRegressed ? 'REGRESSED' : 'STABLE',
    severity: isRegressed ? severity : 'INFO',
    severityScore: isRegressed ? severityScore : 0,
    confidence,
    durationDeltaPercent: durDelta.percent,
    durationDeltaMs: durDelta.delta,
    cpuDeltaPercent: cpuDelta.percent,
    readsDeltaPercent: readsDelta.percent,
    planChanged,
    baselinePlanId,
    currentPlanId,
    reasons
  };
}

/**
 * Matches a database View object to a Query Store query record.
 * Prioritizes exact object_id match, falls back to token boundary text matching.
 */
function matchViewToQuery(view, queryRow) {
  if (!view || !queryRow) return { matched: false, confidence: 'MATCH_UNKNOWN' };

  const viewObjId = Number(view.object_id) || 0;
  const queryObjId = Number(queryRow.object_id) || 0;

  // 1. Exact object_id match
  if (viewObjId > 0 && queryObjId > 0 && viewObjId === queryObjId) {
    return { matched: true, confidence: 'MATCH_EXACT_OBJECT' };
  }

  // 2. Token-boundary string match on query text
  const sqlText = queryRow.query_sql_text || queryRow.text || '';
  if (!sqlText) return { matched: false, confidence: 'MATCH_UNKNOWN' };

  const viewName = view.name || view.view_name || '';
  if (!viewName) return { matched: false, confidence: 'MATCH_UNKNOWN' };

  const escapedName = viewName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const schema = (view.schema_name || 'dbo').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match [schema].[viewName], schema.viewName, [viewName], or viewName with boundaries
  const regex = new RegExp(`(?:\\b${schema}\\s*\\.\\s*|\\[${schema}\\]\\s*\\.\\s*)?(?:\\[${escapedName}\\]|\\b${escapedName}\\b)`, 'i');

  if (regex.test(sqlText)) {
    return { matched: true, confidence: 'MATCH_TEXT' };
  }

  return { matched: false, confidence: 'MATCH_UNKNOWN' };
}

/**
 * SQL Query Builder for Query Store runtime metrics (Baseline + Current).
 */
function buildQueryStoreMetricsQuery(winSpec) {
  return `
    SELECT
      q.query_id,
      q.object_id,
      qt.query_sql_text,
      p.plan_id,
      CASE 
        WHEN rs.last_execution_time >= DATEADD(${winSpec.datepart}, @currOffset, GETUTCDATE()) THEN 'CURRENT'
        WHEN rs.last_execution_time >= DATEADD(${winSpec.datepart}, @baseOffset, GETUTCDATE()) THEN 'BASELINE'
        ELSE 'OLD'
      END AS window_bucket,
      rs.count_executions,
      rs.avg_duration,
      rs.avg_cpu_time,
      rs.avg_logical_io_reads,
      rs.avg_physical_io_reads,
      rs.first_execution_time,
      rs.last_execution_time
    FROM sys.query_store_query AS q
    JOIN sys.query_store_query_text AS qt ON q.query_text_id = qt.query_text_id
    JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
    JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
    WHERE rs.last_execution_time >= DATEADD(${winSpec.datepart}, @baseOffset, GETUTCDATE())
    ORDER BY rs.avg_logical_io_reads DESC;
  `;
}

/**
 * SQL Query Builder for Query Store time series intervals.
 */
function buildQueryStoreTimeseriesQuery(winSpec) {
  return `
    SELECT 
      rsi.start_time,
      rsi.end_time,
      SUM(rs.count_executions) AS executions,
      AVG(rs.avg_duration) / 1000.0 AS avg_duration_ms,
      AVG(rs.avg_cpu_time) / 1000.0 AS avg_cpu_ms,
      SUM(rs.avg_logical_io_reads * rs.count_executions) AS total_logical_reads
    FROM sys.query_store_runtime_stats_interval rsi
    JOIN sys.query_store_runtime_stats rs ON rs.runtime_stats_interval_id = rsi.runtime_stats_interval_id
    WHERE rsi.start_time >= DATEADD(${winSpec.datepart}, @currOffset, GETUTCDATE())
    GROUP BY rsi.start_time, rsi.end_time
    ORDER BY rsi.start_time ASC;
  `;
}

/**
 * SQL Query Builder for Plan Cache (DMV) volatile fallback.
 */
function buildPlanCacheFallbackQuery() {
  return `
    SELECT TOP 150
      qs.sql_handle,
      qs.plan_handle,
      qs.execution_count,
      qs.total_logical_reads,
      qs.total_elapsed_time,
      qs.total_worker_time,
      qs.last_execution_time,
      st.text
    FROM sys.dm_exec_query_stats qs
    CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
    WHERE st.text NOT LIKE '%sys.dm_%'
      AND st.text NOT LIKE '%sys.query_store_%'
    ORDER BY qs.total_logical_reads DESC;
  `;
}

/**
 * Main Runtime Evidence Collector
 */
async function collectRuntimeEvidence(views = [], selectedDatabases = [], historyWindow = '24h') {
  const viewEvidence = new Map();
  const regressions = [];
  const perDbStatus = {};
  const win = getWindowSpec(historyWindow);
  let globalTimeseries = { source: 'NONE', window: win.key, points: [] };

  for (const dbName of selectedDatabases) {
    let pool;
    try {
      pool = db.getPool(dbName);
    } catch (_) {
      perDbStatus[dbName] = {
        type: 'NONE',
        available: false,
        state: 'UNKNOWN',
        fallbackReason: 'CONNECTION_UNAVAILABLE',
        evidenceGrade: 'D'
      };
      continue;
    }

    // 1. Detect Query Store state with permission safety
    let qsState = 'OFF';
    let qsErrorReason = null;

    try {
      const qsReq = pool.request();
      qsReq.timeout = 10000;
      const qsRes = await qsReq.query(`
        SELECT actual_state_desc, desired_state_desc 
        FROM sys.database_query_store_options;
      `);
      qsState = (qsRes.recordset[0]?.actual_state_desc || 'OFF').toUpperCase();
    } catch (err) {
      if (/permission|denied|securable/i.test(err.message)) {
        qsState = 'UNKNOWN';
        qsErrorReason = 'INSUFFICIENT_PERMISSION';
      } else {
        qsState = 'OFF';
        qsErrorReason = 'QUERY_STORE_ERROR';
      }
    }

    const qsActive = qsState === 'READ_WRITE' || qsState === 'READ_ONLY';

    perDbStatus[dbName] = {
      type: qsActive ? 'QUERY_STORE' : 'PLAN_CACHE',
      available: true,
      state: qsState,
      fallbackReason: qsActive ? null : (qsErrorReason || 'QUERY_STORE_DISABLED'),
      evidenceGrade: qsActive ? 'A' : 'B'
    };

    const dbViews = views.filter(v => (v.database || v.database_name) === dbName);
    if (dbViews.length === 0) continue;

    if (qsActive) {
      // ----------------------------------------------------
      // Query Store Execution Path
      // ----------------------------------------------------
      try {
        const req = pool.request();
        req.timeout = 15000;
        req.input('currOffset', sql.Int, win.currentOffset);
        req.input('baseOffset', sql.Int, win.baselineOffset);

        const qsRes = await req.query(buildQueryStoreMetricsQuery(win));
        const allRows = qsRes.recordset || [];

        // Collect time-series points if not already populated
        if (globalTimeseries.points.length === 0) {
          try {
            const tsReq = pool.request();
            tsReq.timeout = 10000;
            tsReq.input('currOffset', sql.Int, win.currentOffset);
            const tsRes = await tsReq.query(buildQueryStoreTimeseriesQuery(win));
            const tsRows = tsRes.recordset || [];
            if (tsRows.length > 0) {
              globalTimeseries = {
                source: 'QUERY_STORE',
                window: win.key,
                database: dbName,
                points: tsRows.map(r => ({
                  startTime: r.start_time,
                  endTime: r.end_time,
                  timestamp: r.start_time,
                  executions: Number(r.executions || 0),
                  avgDurationMs: Math.round(Number(r.avg_duration_ms || 0) * 10) / 10,
                  avgCpuMs: Math.round(Number(r.avg_cpu_ms || 0) * 10) / 10,
                  logicalReads: Number(r.total_logical_reads || 0)
                }))
              };
            }
          } catch (_) {}
        }

        // Process each view in database
        for (const v of dbViews) {
          const vName = v.name || v.view_name;
          const cId = v.canonicalId || `${dbName}.${v.schema_name || 'dbo'}.${vName}`;

          // Match queries to this view
          const matched = [];
          let bestConfidence = 'MATCH_UNKNOWN';

          for (const row of allRows) {
            const m = matchViewToQuery(v, row);
            if (m.matched) {
              matched.push(row);
              if (m.confidence === 'MATCH_EXACT_OBJECT') {
                bestConfidence = 'MATCH_EXACT_OBJECT';
              } else if (bestConfidence !== 'MATCH_EXACT_OBJECT') {
                bestConfidence = 'MATCH_TEXT';
              }
            }
          }

          if (matched.length === 0) continue;

          // Split into Current and Baseline buckets
          const currentRows = matched.filter(r => r.window_bucket === 'CURRENT');
          const baselineRows = matched.filter(r => r.window_bucket === 'BASELINE');

          // Helper to aggregate rows
          const aggregateRows = (rows) => {
            const totalExecs = rows.reduce((s, r) => s + Number(r.count_executions || 0), 0);
            if (totalExecs === 0) {
              return {
                executionCount: 0,
                avgDurationMs: 0,
                totalDurationMs: 0,
                avgCpuMs: 0,
                totalCpuMs: 0,
                avgLogicalReads: 0,
                totalLogicalReads: 0,
                avgPhysicalReads: 0,
                dominantPlanId: null,
                planIds: []
              };
            }

            const totalDurUs = rows.reduce((s, r) => s + (Number(r.avg_duration || 0) * Number(r.count_executions || 1)), 0);
            const totalCpuUs = rows.reduce((s, r) => s + (Number(r.avg_cpu_time || 0) * Number(r.count_executions || 1)), 0);
            const totalReads = rows.reduce((s, r) => s + (Number(r.avg_logical_io_reads || 0) * Number(r.count_executions || 1)), 0);
            const totalPhysical = rows.reduce((s, r) => s + (Number(r.avg_physical_io_reads || 0) * Number(r.count_executions || 1)), 0);

            // Plan frequency map
            const planExecs = {};
            const planIds = new Set();
            for (const r of rows) {
              const pid = r.plan_id;
              if (pid != null) {
                planIds.add(pid);
                planExecs[pid] = (planExecs[pid] || 0) + Number(r.count_executions || 1);
              }
            }
            let dominantPlanId = null;
            let maxPlanExec = -1;
            for (const [pid, cnt] of Object.entries(planExecs)) {
              if (cnt > maxPlanExec) {
                maxPlanExec = cnt;
                dominantPlanId = Number(pid);
              }
            }

            return {
              executionCount: totalExecs,
              avgDurationMs: Math.round((totalDurUs / totalExecs / 1000) * 10) / 10,
              totalDurationMs: Math.round(totalDurUs / 1000),
              avgCpuMs: Math.round((totalCpuUs / totalExecs / 1000) * 10) / 10,
              totalCpuMs: Math.round(totalCpuUs / 1000),
              avgLogicalReads: Math.round(totalReads / totalExecs),
              totalLogicalReads: totalReads,
              avgPhysicalReads: Math.round(totalPhysical / totalExecs),
              dominantPlanId,
              planIds: Array.from(planIds)
            };
          };

          const currStats = aggregateRows(currentRows);
          const baseStats = aggregateRows(baselineRows);

          // Plan change detection
          const planChanged = Boolean(
            baseStats.dominantPlanId &&
            currStats.dominantPlanId &&
            baseStats.dominantPlanId !== currStats.dominantPlanId
          );

          const allUniquePlans = new Set([...currStats.planIds, ...baseStats.planIds]);

          // Regression decision
          const regDecision = detectRegression({
            current: currStats,
            baseline: baseStats,
            planChanged,
            currentPlanId: currStats.dominantPlanId,
            baselinePlanId: baseStats.dominantPlanId
          });

          // Formatted calling queries for UI inspection
          const callingQueries = matched.slice(0, 4).map(m => ({
            queryId: m.query_id,
            planId: m.plan_id,
            bucket: m.window_bucket,
            executions: m.count_executions,
            avgDurationMs: Math.round((Number(m.avg_duration || 0) / 1000) * 10) / 10,
            avgReads: formatReads(m.avg_logical_io_reads),
            sql: (m.query_sql_text || '').slice(0, 150)
          }));

          const lastExecTime = currentRows.reduce((latest, r) => {
            if (!r.last_execution_time) return latest;
            const t = new Date(r.last_execution_time).toISOString();
            return (!latest || t > latest) ? t : latest;
          }, null);

          const totalReads = currStats.totalLogicalReads || (currStats.executionCount * currStats.avgLogicalReads);
          const avgDurUs = currStats.avgDurationMs * 1000;

          const summary = {
            databaseName: dbName,
            canonicalId: cId,
            viewName: vName,
            source: 'QUERY_STORE',
            evidenceGrade: 'A',
            matchConfidence: bestConfidence,
            attributionMethod: bestConfidence === 'MATCH_EXACT_OBJECT'
              ? 'Query Store doğrudan object_id eşleşmesi'
              : 'Query Store sorgu metni token korelasyonu',

            // Current window metrics
            current: {
              ...currStats,
              lastExecutionTime: lastExecTime,
              planCount: currStats.planIds.length,
              formattedDuration: formatDuration(avgDurUs),
              formattedReads: formatReads(totalReads)
            },

            // Baseline window metrics
            baseline: baseStats.executionCount > 0 ? {
              ...baseStats,
              planCount: baseStats.planIds.length,
              formattedDuration: formatDuration(baseStats.avgDurationMs * 1000),
              formattedReads: formatReads(baseStats.totalLogicalReads)
            } : null,

            // Regression analysis
            regression: regDecision,
            isRegressed: regDecision.isRegressed,

            // Backward-compatible flat aliases
            totalReads,
            formattedReads: formatReads(totalReads),
            avgDurationUs: avgDurUs,
            formattedDuration: formatDuration(avgDurUs),
            avgCpuUs: currStats.avgCpuMs * 1000,
            executionCount: currStats.executionCount,
            planCount: allUniquePlans.size,
            callingQueries
          };

          viewEvidence.set(cId.toLowerCase(), summary);
          viewEvidence.set(vName.toUpperCase(), summary);

          // Add to regressions list if verified
          if (regDecision.isRegressed) {
            regressions.push({
              name: vName,
              canonicalId: cId,
              database: dbName,
              severity: regDecision.severity,
              severityScore: regDecision.severityScore,
              confidence: regDecision.confidence,
              before: baseStats.executionCount > 0 ? `${baseStats.avgDurationMs}ms` : '—',
              now: `${currStats.avgDurationMs}ms`,
              delta: `+${regDecision.durationDeltaPercent}%`,
              durationDeltaMs: regDecision.durationDeltaMs,
              reads: formatReads(totalReads),
              readsDeltaPercent: regDecision.readsDeltaPercent,
              cpuDeltaPercent: regDecision.cpuDeltaPercent,
              executions: currStats.executionCount,
              planChanged: regDecision.planChanged,
              currentPlanId: regDecision.currentPlanId,
              baselinePlanId: regDecision.baselinePlanId,
              evidence: 'Grade A',
              reasons: regDecision.reasons,
              note: bestConfidence === 'MATCH_EXACT_OBJECT' ? 'Query Store object_id doğrulaması' : 'Query Store metin korelasyonu'
            });
          }
        }
      } catch (qsErr) {
        perDbStatus[dbName].fallbackReason = `QUERY_STORE_ERROR: ${qsErr.message}`;
      }
    } else {
      // ----------------------------------------------------
      // Plan Cache (DMV) Controlled Fallback Path
      // ----------------------------------------------------
      try {
        const dmvReq = pool.request();
        dmvReq.timeout = 10000;
        const dmvRes = await dmvReq.query(buildPlanCacheFallbackQuery());
        const rows = dmvRes.recordset || [];

        for (const v of dbViews) {
          const vName = v.name || v.view_name;
          const cId = v.canonicalId || `${dbName}.${v.schema_name || 'dbo'}.${vName}`;

          const matched = rows.filter(r => matchViewToQuery(v, r).matched);
          if (matched.length === 0) continue;

          const totalExecs = matched.reduce((s, r) => s + Number(r.execution_count || 0), 0);
          const totalReads = matched.reduce((s, r) => s + Number(r.total_logical_reads || 0), 0);
          const totalDurUs = matched.reduce((s, r) => s + Number(r.total_elapsed_time || 0), 0);
          const totalCpuUs = matched.reduce((s, r) => s + Number(r.total_worker_time || 0), 0);

          const avgDurUs = totalExecs > 0 ? totalDurUs / totalExecs : 0;
          const avgCpuUs = totalExecs > 0 ? totalCpuUs / totalExecs : 0;
          const avgReads = totalExecs > 0 ? Math.round(totalReads / totalExecs) : totalReads;

          const summary = {
            databaseName: dbName,
            canonicalId: cId,
            viewName: vName,
            source: 'PLAN_CACHE',
            evidenceGrade: 'B',
            matchConfidence: 'MATCH_TEXT',
            attributionMethod: 'Plan Cache (DMV) anlık metin korelasyonu',

            current: {
              executionCount: totalExecs,
              avgDurationMs: Math.round((avgDurUs / 1000) * 10) / 10,
              totalDurationMs: Math.round(totalDurUs / 1000),
              avgCpuMs: Math.round((avgCpuUs / 1000) * 10) / 10,
              totalCpuMs: Math.round(totalCpuUs / 1000),
              avgLogicalReads: avgReads,
              totalLogicalReads: totalReads,
              formattedDuration: formatDuration(avgDurUs),
              formattedReads: formatReads(totalReads),
              lastExecutionTime: matched[0]?.last_execution_time || null,
              planCount: matched.length
            },

            // Honest fallback: Baseline is NOT fabricated
            baseline: null,
            regression: {
              isRegressed: false,
              status: 'BASELINE_UNAVAILABLE',
              severity: 'INFO',
              severityScore: 0,
              confidence: 'LOW',
              durationDeltaPercent: 0,
              planChanged: false,
              reasons: [],
              note: 'Query Store kapalı olduğu için geçmiş regresyon karşılaştırması yapılamıyor.'
            },
            isRegressed: false,

            totalReads,
            formattedReads: formatReads(totalReads),
            avgDurationUs: avgDurUs,
            formattedDuration: formatDuration(avgDurUs),
            avgCpuUs,
            executionCount: totalExecs,
            callingQueries: matched.slice(0, 3).map(m => ({
              sql: (m.text || '').slice(0, 150),
              executions: m.execution_count,
              avgReads: formatReads(m.total_logical_reads / (m.execution_count || 1))
            }))
          };

          viewEvidence.set(cId.toLowerCase(), summary);
          viewEvidence.set(vName.toUpperCase(), summary);
        }
      } catch (_) {}
    }
  }

  // Sort regressions: severityScore DESC, then totalReads DESC
  regressions.sort((a, b) => {
    if ((b.severityScore || 0) !== (a.severityScore || 0)) {
      return (b.severityScore || 0) - (a.severityScore || 0);
    }
    const readsA = parseInt(String(a.reads || '0').replace(/[^0-9]/g, ''), 10) || 0;
    const readsB = parseInt(String(b.reads || '0').replace(/[^0-9]/g, ''), 10) || 0;
    return readsB - readsA;
  });

  return {
    source: Object.values(perDbStatus).some(s => s.type === 'QUERY_STORE') ? 'QUERY_STORE' : 'PLAN_CACHE',
    perDbStatus,
    viewEvidence,
    regressions,
    timeseries: globalTimeseries
  };
}

module.exports = {
  collectRuntimeEvidence,
  WINDOW_MAP,
  getWindowSpec,
  resolveWindowConfig,
  formatDuration,
  formatReads,
  calculateDelta,
  calculateSeverityScore,
  calculateConfidence,
  detectRegression,
  matchViewToQuery,
  buildQueryStoreMetricsQuery,
  buildQueryStoreTimeseriesQuery,
  buildPlanCacheFallbackQuery,
  REGRESSION_THRESHOLDS
};
