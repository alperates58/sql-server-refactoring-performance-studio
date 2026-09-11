/**
 * SQL Server Refactoring & Performance Studio
 * Statistics Health Engine (Sprint 5)
 *
 * Implements:
 * - sys.stats + sys.dm_db_stats_properties metadata extraction
 * - Modification ratio calculation with zero-row safety
 * - 4-Tier Health Categorization: HEALTHY, WATCH, STALE, CRITICAL
 * - Findings: STATS_STALE, STATS_LOW_SAMPLE, STATS_NEVER_UPDATED, STATS_NORECOMPUTE, STATS_HIGH_MODIFICATION
 * - Execution Plan Cardinality Mismatch correlation (POSSIBLE_STALE_STATISTICS_CAUSE)
 * - Safe UPDATE STATISTICS script generator (non-mutating preview, default sample, no blind FULLSCAN)
 */

const db = require('./sqlServer');

const DEFAULT_STATS_THRESHOLDS = {
  CRITICAL: 0.50,
  STALE: 0.20,
  WATCH: 0.10
};

/**
 * Normalizes SQL identifier
 */
function normalizeIdentifier(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[\[\]]/g, '').trim();
}

/**
 * Calculates modification ratio with robust zero-row handling (unclamped)
 */
function calculateModificationRatio(modificationCounter, rows) {
  const mods = Math.max(0, Number(modificationCounter) || 0);
  const rowCount = Math.max(0, Number(rows) || 0);

  if (rowCount === 0) {
    return mods > 0 ? 1.0 : 0.0;
  }

  const ratio = mods / rowCount;
  return Math.round(ratio * 1000) / 1000;
}

/**
 * Formats modification ratio for display: avoids broken >100% progress bars and provides human-friendly multiplier text
 */
function formatModificationRatio(ratio) {
  const r = Math.max(0, Number(ratio) || 0);
  const barPercent = Math.min(100, Math.round(r * 100));
  let text = '';
  if (r >= 1.0) {
    const mult = Math.round(r * 100) / 100;
    text = `Satır sayısının ${mult.toLocaleString('tr-TR')} katı kadar değişiklik sayacı birikmiş`;
  } else {
    text = `%${Math.round(r * 100)} değişiklik`;
  }
  return {
    rawModificationRatio: r,
    displayRatioPct: `${Math.round(r * 100)}%`,
    displayRatioText: text,
    barPercent
  };
}

/**
 * Evaluates statistics health status based on modification ratio, age, and sample size
 * Categories: CRITICAL, STALE, WATCH, HEALTHY
 */
function evaluateStatsStatus({
  modificationRatio,
  modificationCounter = 0,
  rows = 0,
  rowsSampled = 0,
  samplePercent = 100,
  lastUpdated = null,
  isNoRecompute = false
}) {
  const mods = Number(modificationCounter) || 0;
  const rowCount = Number(rows) || 0;

  let daysSinceUpdate = null;
  if (lastUpdated) {
    const diffMs = Date.now() - new Date(lastUpdated).getTime();
    daysSinceUpdate = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  const findings = [];

  // Finding: NORECOMPUTE flag
  if (isNoRecompute) {
    findings.push({
      code: 'STATS_NORECOMPUTE',
      severity: 'WARNING',
      text: 'Bu istatistikte otomatik yeniden hesaplama (NORECOMPUTE) kapatılmış. Veri değiştikçe otomatik güncellenmez.'
    });
  }

  // Finding: Never updated
  if (!lastUpdated && mods > 0) {
    findings.push({
      code: 'STATS_NEVER_UPDATED',
      severity: 'HIGH',
      text: `İstatistik tablonun oluşturulmasından bu yana hiç güncellenmemiş (${mods.toLocaleString()} değişiklik mevcut).`
    });
  }

  // Finding: Low sample percentage on large table
  if (samplePercent < 15 && rowCount > 100000) {
    findings.push({
      code: 'STATS_LOW_SAMPLE',
      severity: 'WARNING',
      text: `${rowCount.toLocaleString()} satırlı tabloda örnekleme oranı yalnızca %${samplePercent}. Dağılım adımları (histogram) gerçeği yansıtmayabilir.`
    });
  }

  // Finding: High modification count
  if (modificationRatio >= DEFAULT_STATS_THRESHOLDS.STALE) {
    findings.push({
      code: 'STATS_HIGH_MODIFICATION',
      severity: modificationRatio >= DEFAULT_STATS_THRESHOLDS.CRITICAL ? 'CRITICAL' : 'HIGH',
      text: `Son güncellemeden beri tablonun %${Math.round(modificationRatio * 100)}'i değiştirildi (${mods.toLocaleString()} satır değişikliği).`
    });
  }

  // Categorize Status
  let status = 'HEALTHY';
  let severity = 'PASS';

  if (modificationRatio >= DEFAULT_STATS_THRESHOLDS.CRITICAL || (!lastUpdated && mods > 1000)) {
    status = 'CRITICAL';
    severity = 'CRITICAL';
  } else if (modificationRatio >= DEFAULT_STATS_THRESHOLDS.STALE || (daysSinceUpdate !== null && daysSinceUpdate > 30 && mods > 500)) {
    status = 'STALE';
    severity = 'HIGH';
  } else if (modificationRatio >= DEFAULT_STATS_THRESHOLDS.WATCH || (samplePercent < 20 && rowCount > 50000)) {
    status = 'WATCH';
    severity = 'WARNING';
  }

  return {
    status,
    severity,
    daysSinceUpdate,
    findings
  };
}

/**
 * Generates safe, non-mutating UPDATE STATISTICS script preview
 */
function generateUpdateStatisticsScript({
  schema = 'dbo',
  table,
  statsName,
  withFullScan = false
}) {
  const cleanSchema = normalizeIdentifier(schema) || 'dbo';
  const cleanTable = normalizeIdentifier(table);
  const cleanStats = normalizeIdentifier(statsName);

  if (!cleanTable || !cleanStats) {
    return {
      script: '-- Geçersiz parametre: Tablo veya istatistik adı eksik.',
      isReadOnlySafe: true
    };
  }

  let script = `-- SQL Server Refactoring & Performance Studio — Statistics Health\n`;
  script += `-- [GÜVENLİK KURALI]: Canlı veritabanına otomatik DDL/DML uygulanmaz.\n`;
  script += `-- Aşağıdaki komut manuel olarak DBA kontrolünde çalıştırılmalıdır.\n`;

  if (withFullScan) {
    script += `-- [DİKKAT]: FULLSCAN devasa tablolarda yüksek disk I/O ve CPU tüketebilir.\n`;
    script += `UPDATE STATISTICS [${cleanSchema}].[${cleanTable}] [${cleanStats}] WITH FULLSCAN;\n`;
  } else {
    script += `-- Varsayılan örnekleme (Default Sample) kullanılır.\n`;
    script += `UPDATE STATISTICS [${cleanSchema}].[${cleanTable}] [${cleanStats}];\n`;
  }

  return {
    script,
    isReadOnlySafe: true,
    autoExecuted: false
  };
}

/**
 * Queries sys.stats and sys.dm_db_stats_properties for target database
 */
async function getStatisticsHealth(database = null, options = {}) {
  const status = db.status();
  const targetDb = database || status.primaryDatabase;
  const pool = db.getPool(targetDb);

  const { schemaName = null, tableName = null, topN = 100 } = options;

  if (!pool) {
    return {
      ok: false,
      database: targetDb,
      error: 'SQL Server bağlantısı aktif değil.',
      statistics: [],
      summary: { totalStats: 0, criticalCount: 0, staleCount: 0, watchCount: 0, healthyCount: 0, healthScore: 0 }
    };
  }

  try {
    const query = `
      SELECT TOP (@topLimit)
        s.stats_id,
        s.name AS stats_name,
        OBJECT_SCHEMA_NAME(s.object_id) AS schema_name,
        OBJECT_NAME(s.object_id) AS table_name,
        s.auto_created AS is_auto_created,
        s.user_created AS is_user_created,
        s.no_recompute AS is_no_recompute,
        s.has_filter,
        s.filter_definition,
        sp.last_updated,
        sp.rows,
        sp.rows_sampled,
        sp.steps,
        sp.unfiltered_rows,
        sp.modification_counter,
        STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY sc.stats_column_id) AS columns_list
      FROM sys.stats s
      JOIN sys.tables t ON s.object_id = t.object_id
      CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
      LEFT JOIN sys.stats_columns sc ON s.object_id = sc.object_id AND s.stats_id = sc.stats_id
      LEFT JOIN sys.columns c ON sc.object_id = c.object_id AND sc.column_id = c.column_id
      WHERE (@filterTable IS NULL OR t.name = @filterTable)
        AND (@filterSchema IS NULL OR OBJECT_SCHEMA_NAME(t.object_id) = @filterSchema)
        AND t.is_ms_shipped = 0
      GROUP BY 
        s.stats_id, s.name, s.object_id, s.auto_created, s.user_created,
        s.no_recompute, s.has_filter, s.filter_definition, sp.last_updated,
        sp.rows, sp.rows_sampled, sp.steps, sp.unfiltered_rows, sp.modification_counter
      ORDER BY sp.modification_counter DESC, sp.last_updated ASC;
    `;

    const request = pool.request();
    request.input('topLimit', Number(topN) || 100);
    request.input('filterTable', tableName ? normalizeIdentifier(tableName) : null);
    request.input('filterSchema', schemaName ? normalizeIdentifier(schemaName) : null);

    const res = await request.query(query);
    const rows = res.recordset || [];

    const statsList = [];
    let criticalCount = 0;
    let staleCount = 0;
    let watchCount = 0;
    let healthyCount = 0;

    for (const r of rows) {
      const rowCount = Number(r.rows) || 0;
      const sampled = Number(r.rows_sampled) || 0;
      const modCounter = Number(r.modification_counter) || 0;

      const samplePercent = rowCount > 0 ? Math.round((sampled / rowCount) * 1000) / 10 : 100;
      const modRatio = calculateModificationRatio(modCounter, rowCount);
      const ratioFmt = formatModificationRatio(modRatio);

      const evaluation = evaluateStatsStatus({
        modificationRatio: modRatio,
        modificationCounter: modCounter,
        rows: rowCount,
        rowsSampled: sampled,
        samplePercent,
        lastUpdated: r.last_updated,
        isNoRecompute: Boolean(r.is_no_recompute)
      });

      if (evaluation.status === 'CRITICAL') criticalCount++;
      else if (evaluation.status === 'STALE') staleCount++;
      else if (evaluation.status === 'WATCH') watchCount++;
      else healthyCount++;

      const scriptData = generateUpdateStatisticsScript({
        schema: r.schema_name,
        table: r.table_name,
        statsName: r.stats_name,
        withFullScan: false
      });

      statsList.push({
        id: `${r.schema_name}.${r.table_name}.${r.stats_name}`,
        statsId: r.stats_id,
        statsName: r.stats_name,
        schema: r.schema_name,
        table: r.table_name,
        columns: r.columns_list || '',
        rows: rowCount,
        rowsSampled: sampled,
        samplePercent,
        modificationCounter: modCounter,
        modificationRatio: modRatio,
        rawModificationRatio: modRatio,
        displayRatioPct: ratioFmt.displayRatioPct,
        displayRatioText: ratioFmt.displayRatioText,
        barPercent: ratioFmt.barPercent,
        lastUpdated: r.last_updated,
        daysSinceUpdate: evaluation.daysSinceUpdate,
        status: evaluation.status,
        severity: evaluation.severity,
        isAutoCreated: Boolean(r.is_auto_created),
        isUserCreated: Boolean(r.is_user_created),
        isNoRecompute: Boolean(r.is_no_recompute),
        hasFilter: Boolean(r.has_filter),
        findings: evaluation.findings,
        updateScript: scriptData.script
      });
    }

    // Calculate Health Score (100 - penalties)
    const totalStats = statsList.length;
    let healthScore = 100;
    if (totalStats > 0) {
      const penalty = (criticalCount * 25 + staleCount * 12 + watchCount * 4) / totalStats;
      healthScore = Math.max(0, Math.round(100 - penalty));
    }

    return {
      ok: true,
      database: targetDb,
      count: statsList.length,
      statistics: statsList,
      summary: {
        totalStats,
        criticalCount,
        staleCount,
        watchCount,
        healthyCount,
        healthScore
      }
    };
  } catch (err) {
    return {
      ok: false,
      database: targetDb,
      error: db.sanitizeError(err).message,
      statistics: [],
      summary: { totalStats: 0, criticalCount: 0, staleCount: 0, watchCount: 0, healthyCount: 0, healthScore: 0 }
    };
  }
}

/**
 * Correlates Execution Plan Cardinality Mismatch with Stale Statistics
 * If an operator exhibits high mismatch and references a table with STALE or CRITICAL stats,
 * emits a POSSIBLE_STALE_STATISTICS_CAUSE finding.
 */
function correlatePlanWithStatistics(parsedPlan, tableStatsList = []) {
  if (!parsedPlan || !parsedPlan.operators || !tableStatsList || tableStatsList.length === 0) {
    return [];
  }

  const correlations = [];
  const mismatches = parsedPlan.cardinalityMismatches || [];

  for (const mm of mismatches) {
    if (!mm.object || mm.object === '—') continue;

    // Target object could be dbo.TableName or just TableName
    const objParts = mm.object.split('.');
    const tblName = (objParts.length > 1 ? objParts[1] : objParts[0]).toLowerCase();

    const matchedStats = tableStatsList.filter(
      s => s.table && s.table.toLowerCase() === tblName && (s.status === 'STALE' || s.status === 'CRITICAL')
    );

    if (matchedStats.length > 0) {
      const worstStat = matchedStats[0];
      correlations.push({
        code: 'POSSIBLE_STALE_STATISTICS_CAUSE',
        severity: 'HIGH',
        evidenceGrade: 'A',
        title: `Kardinalite Hatası Olası İstatistik Kaynaklı: ${worstStat.table}`,
        operatorNodeId: mm.nodeId,
        operator: mm.operator,
        table: worstStat.table,
        statsName: worstStat.statsName,
        modificationRatio: worstStat.modificationRatio,
        cardinalityFactor: mm.factor,
        estimatedRows: mm.estimated,
        actualRows: mm.actual,
        ratio: mm.ratio,
        explanation: `Execution plan operatöründe (${mm.operator}) beklenen satır (${mm.estimated.toLocaleString()}) ile gerçekleşen satır (${mm.actual.toLocaleString()}) arasında ${mm.ratio}× fark tespit edildi. Bu tablonun "${worstStat.statsName}" istatistiği %${Math.round(worstStat.modificationRatio * 100)} oranında bayatlamıştır (${worstStat.status}). Optimizatörün kardinalite tahmin sapmasının kuvvetle muhtemel nedeni güncelliğini yitirmiş bu istatistiktir.`,
        recommendedAction: `Tablo istatistiğini güncelleyiniz:\n${worstStat.updateScript}`
      });
    }
  }

  return correlations;
}

module.exports = {
  DEFAULT_STATS_THRESHOLDS,
  calculateModificationRatio,
  formatModificationRatio,
  evaluateStatsStatus,
  generateUpdateStatisticsScript,
  getStatisticsHealth,
  correlatePlanWithStatistics
};
