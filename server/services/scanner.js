/**
 * SQL Server Refactoring & Performance Studio
 * Multi-Database Scanner Service (Phase 2.5)
 *
 * Implements:
 * - Iteration over all in-scope databases via dedicated ConnectionPools
 * - Extraction of views, dependencies, synonyms, indexes per database
 * - Resilient scanning: Errors in one DB produce 'PARTIAL ACCESS' or 'FAILED DATABASE' without halting others
 * - Canonical object identification throughout
 * - Multi-database Table Pressure with physical isolation
 * - Per-database and global inventory summaries
 * - Dynamic SQL limitation tracking
 */

const fs = require('fs');
const path = require('path');
const db = require('./sqlServer');
const { createObjectRef, parseCanonicalId } = require('./canonicalObject');
const { analyzeStaticSql } = require('./staticAnalyzer');
const { buildDependencyStats, extractSubGraph } = require('./dependencyEngine');
const { calculateHealth, calculateRisk, buildRiskBars } = require('./scoring');
const { findDuplicates } = require('./duplicateFinder');
const { collectRuntimeEvidence } = require('./runtimeEvidence');

let latestScan = null;
const definitionCache = new Map(); // canonicalId.toLowerCase() -> SQL text

function getDefinition(identifier) {
  if (!identifier) return null;
  const key = identifier.toLowerCase().trim();
  if (definitionCache.has(key)) return definitionCache.get(key);

  // Fallback lookup: if identifier is bare name like 'AA_PLAN', find first matching view
  for (const [k, sql] of definitionCache.entries()) {
    if (k.endsWith(`.${key}`) || k === key) {
      return sql;
    }
  }
  return null;
}

function getLatestScanData() {
  return latestScan;
}

/**
 * Scan all in-scope databases.
 */
async function scan(prefix = 'AA_', explicitScope = null) {
  const connStatus = db.status();
  const selectedDatabases = explicitScope || connStatus.selectedDatabases || (connStatus.primaryDatabase ? [connStatus.primaryDatabase] : []);

  if (selectedDatabases.length === 0) {
    throw new Error('Analiz edilecek veritabanı seçilmedi.');
  }

  const sanitizedPrefix = prefix.replace(/'/g, "''");

  const allRawViews = [];
  const allRawEdges = [];
  const synonymMap = new Map(); // canonicalId.toLowerCase() -> ObjectRef
  const databaseStatusMap = new Map(); // dbName -> { status: 'FULL ACCESS'|'PARTIAL ACCESS'|'FAILED', error: null, viewCount: 0 }

  // 1. Scan each database in scope independently
  for (const dbName of selectedDatabases) {
    let pool;
    try {
      pool = db.getPool(dbName);
    } catch (err) {
      databaseStatusMap.set(dbName, { status: 'FAILED', error: err.message, viewCount: 0 });
      continue;
    }

    let dbStatus = 'FULL ACCESS';
    let dbError = null;

    // 1A. Views Query
    const viewsSql = `
      SELECT
        '${dbName}' AS database_name,
        s.name AS schema_name,
        v.name AS view_name,
        v.object_id,
        v.create_date,
        v.modify_date,
        OBJECT_DEFINITION(v.object_id) AS definition
      FROM sys.views AS v
      JOIN sys.schemas AS s ON s.schema_id = v.schema_id
      WHERE v.is_ms_shipped = 0
        AND v.name LIKE '${sanitizedPrefix}%'
      ORDER BY v.name;
    `;

    // 1B. Dependencies Query (captures cross-db 4-part names)
    const depsSql = `
      SELECT
        '${dbName}' AS source_database,
        OBJECT_SCHEMA_NAME(d.referencing_id) AS source_schema,
        OBJECT_NAME(d.referencing_id) AS source_name,
        d.referencing_id AS source_object_id,
        d.referenced_server_name,
        d.referenced_database_name,
        d.referenced_schema_name,
        d.referenced_entity_name,
        d.referenced_id AS target_object_id,
        CASE
          WHEN d.referenced_id IS NULL AND d.referenced_database_name IS NULL AND d.referenced_server_name IS NULL THEN 'UNRESOLVED'
          ELSE COALESCE(o.type_desc, 'UNKNOWN')
        END AS target_type,
        d.is_ambiguous
      FROM sys.sql_expression_dependencies AS d
      LEFT JOIN sys.objects AS o ON o.object_id = d.referenced_id
      WHERE OBJECT_NAME(d.referencing_id) LIKE '${sanitizedPrefix}%'
      ORDER BY source_name, d.referenced_entity_name;
    `;

    // 1C. Synonyms Query
    const synSql = `
      SELECT
        '${dbName}' AS database_name,
        s.name AS schema_name,
        syn.name AS synonym_name,
        syn.base_object_name
      FROM sys.synonyms syn
      JOIN sys.schemas s ON s.schema_id = syn.schema_id;
    `;

    try {
      const [vRes, dRes, sRes] = await Promise.all([
        pool.request().query(viewsSql).catch(err => {
          dbError = `View definition izni eksik veya kısıtlı: ${err.message}`;
          return { recordset: [] };
        }),
        pool.request().query(depsSql).catch(err => {
          dbError = dbError || `Bağımlılık sorgusu başarısız: ${err.message}`;
          return { recordset: [] };
        }),
        pool.request().query(synSql).catch(() => ({ recordset: [] }))
      ]);

      const dbViews = vRes.recordset || [];
      const dbEdges = dRes.recordset || [];
      const dbSyns = sRes.recordset || [];

      if (dbViews.length === 0 && dbEdges.length === 0 && dbError) {
        dbStatus = 'FAILED DATABASE';
      } else if (dbError) {
        dbStatus = 'PARTIAL ACCESS';
      }

      // Process synonyms
      for (const syn of dbSyns) {
        const synRef = createObjectRef({
          database: dbName,
          schema: syn.schema_name,
          name: syn.synonym_name,
          type: 'SYNONYM'
        });
        const targetRef = parseCanonicalId(syn.base_object_name, dbName, 'TABLE');
        synonymMap.set(synRef.canonicalId.toLowerCase(), targetRef);
      }

      allRawViews.push(...dbViews);
      allRawEdges.push(...dbEdges);
      databaseStatusMap.set(dbName, {
        status: dbStatus,
        error: dbError,
        viewCount: dbViews.length
      });
    } catch (err) {
      databaseStatusMap.set(dbName, {
        status: 'FAILED',
        error: err.message,
        viewCount: 0
      });
    }
  }

  // 2. Clear and populate definition cache
  definitionCache.clear();
  for (const v of allRawViews) {
    const cId = `${v.database_name}.${v.schema_name}.${v.view_name}`;
    v.canonicalId = cId;
    v.database = v.database_name;
    v.name = v.view_name;
    if (v.definition) {
      definitionCache.set(cId.toLowerCase(), v.definition);
      definitionCache.set(v.view_name.toLowerCase(), v.definition);
    }
  }

  // 3. Compute cross-database dependency topology
  const { statsMap, normalizedEdges } = buildDependencyStats(allRawViews, allRawEdges, selectedDatabases, synonymMap);

  // 4. Collect runtime evidence across databases
  const runtimeResult = await collectRuntimeEvidence(allRawViews, selectedDatabases).catch(() => ({
    source: 'NONE',
    evidenceGrade: 'D',
    isVolatile: false,
    viewEvidence: new Map(),
    regressions: []
  }));

  // 5. Analyze each view and calculate health/risk
  const processedViews = allRawViews.map(v => {
    const cKey = v.canonicalId.toLowerCase();
    const gStats = statsMap.get(cKey) || {};
    const staticRes = analyzeStaticSql(v.definition || '');
    const rt = runtimeResult.viewEvidence?.get(cKey) || runtimeResult.viewEvidence?.get(v.view_name.toUpperCase()) || null;

    const signals = {
      ...staticRes.signals,
      depth: gStats.depth || 1,
      baseTableCount: gStats.baseTableCount || 0,
      repeatedBaseTableCount: gStats.repeatedBaseTableCount || 0,
      dependentCount: gStats.dependentCount || 0,
      cycleCount: (gStats.cycles || []).length,
      unresolvedCount: (gStats.unresolved || []).length,
      outOfScopeCount: gStats.outOfScopeCount || 0,
      linkedServerCount: gStats.linkedServerCount || 0
    };

    const health = calculateHealth(signals);
    const risk = calculateRisk({
      health,
      dependentCount: signals.dependentCount,
      reads: rt ? rt.totalReads : 0,
      isRegressed: rt ? rt.isRegressed : false
    });

    const problems = [];
    if (signals.repeatedBaseTableCount > 0) {
      problems.push({
        symbol: '⇄',
        title: 'Repeated base table access',
        detail: `Base table is reached through ${signals.repeatedBaseTableCount + 1} paths across databases.`,
        severity: 'CRITICAL',
        penalty: 18
      });
    }
    if (signals.depth > 3) {
      problems.push({
        symbol: '∞',
        title: 'Cross-DB Dependency depth',
        detail: `${signals.depth} levels deep cross-database tree.`,
        severity: 'HIGH',
        penalty: 10
      });
    }
    if (signals.outOfScopeCount > 0) {
      problems.push({
        symbol: '⊘',
        title: 'Out of analysis scope dependency',
        detail: `${signals.outOfScopeCount} referenced objects belong to unscanned databases.`,
        severity: 'MEDIUM',
        penalty: 6
      });
    }
    if (signals.linkedServerCount > 0) {
      problems.push({
        symbol: '⌁',
        title: 'Linked Server Hop',
        detail: `${signals.linkedServerCount} distributed queries detected (latency/distributed transaction risk).`,
        severity: 'HIGH',
        penalty: 12
      });
    }
    if (signals.unresolvedCount > 0) {
      problems.push({
        symbol: '?',
        title: 'Unresolved entities',
        detail: `${signals.unresolvedCount} objects could not be resolved in catalog.`,
        severity: 'HIGH',
        penalty: 8
      });
    }

    const readsStr = rt
      ? (rt.totalReads > 1e9 ? `${(rt.totalReads / 1e9).toFixed(1)}B` : rt.totalReads > 1e6 ? `${(rt.totalReads / 1e6).toFixed(1)}M` : rt.totalReads.toLocaleString())
      : '—';
    const medianStr = rt ? `${rt.avgDurationMs || 0}ms` : '—';
    const modifiedStr = v.modify_date ? new Date(v.modify_date).toLocaleDateString('tr-TR') : 'Bilinmiyor';

    return {
      canonicalId: v.canonicalId,
      database: v.database_name,
      schema: v.schema_name,
      name: v.view_name,
      view_name: v.view_name,
      object_id: v.object_id,
      createDate: v.create_date,
      modifyDate: v.modify_date,
      modified: modifiedStr,
      definition: v.definition,
      health,
      healthScore: health,
      risk: risk.category,
      riskLevel: risk.category,
      riskCategory: risk.category,
      riskScore: risk.score,
      depth: signals.depth,
      tables: signals.baseTableCount,
      baseTableCount: signals.baseTableCount,
      repeatedBaseTableCount: signals.repeatedBaseTableCount,
      dependentCount: signals.dependentCount,
      dependents: signals.dependentCount,
      dependentList: gStats.dependents || [],
      repeatedBaseTables: gStats.repeatedBaseTables || [],
      baseTables: (gStats.repeatedBaseTables || []).map(r => r.tableName || r.canonicalId),
      problems,
      riskBars: buildRiskBars(signals, risk.score),
      runtime: rt,
      reads: readsStr,
      median: medianStr,
      dynamicSqlLimitation: gStats.dynamicSqlLimitation
    };
  });

  // 6. Compute Table Pressure strictly isolated by canonicalId (database.schema.table)
  const pressureMap = new Map(); // canonicalId -> { canonicalId, database, name, refs, paths, critical, repeated }
  for (const v of processedViews) {
    const isCrit = v.riskCategory === 'critical';
    for (const r of v.repeatedBaseTables || []) {
      const cId = r.canonicalId;
      if (!cId) continue;
      if (!pressureMap.has(cId)) {
        const parts = cId.split('.');
        pressureMap.set(cId, {
          canonicalId: cId,
          database: parts.length > 2 ? parts[0] : v.database,
          name: parts.pop(),
          refs: 0,
          paths: 0,
          critical: 0,
          repeated: 0
        });
      }
      const entry = pressureMap.get(cId);
      entry.refs += 1;
      entry.paths += r.pathCount || 1;
      if (isCrit) entry.critical += 1;
      entry.repeated += 1;
    }
  }

  const pressures = Array.from(pressureMap.values())
    .map(p => ({
      ...p,
      score: Math.min(100, Math.round((p.refs * 2.5) + (p.paths * 1.5) + (p.critical * 8)))
    }))
    .sort((a, b) => b.score - a.score);

  // 7. Compute Global and Per-Database Summaries
  const databaseSummaries = {};
  for (const dbName of selectedDatabases) {
    const dbViews = processedViews.filter(v => v.database === dbName);
    const dbStatus = databaseStatusMap.get(dbName) || { status: 'FULL ACCESS' };
    databaseSummaries[dbName] = {
      database: dbName,
      status: dbStatus.status,
      error: dbStatus.error,
      viewCount: dbViews.length,
      criticalCount: dbViews.filter(v => v.riskCategory === 'critical').length,
      highCount: dbViews.filter(v => v.riskCategory === 'high').length,
      avgHealth: dbViews.length > 0 ? Math.round(dbViews.reduce((a, b) => a + b.healthScore, 0) / dbViews.length) : 0
    };
  }

  // 8. Duplicates
  const duplicates = findDuplicates(processedViews);

  const result = {
    scanTime: new Date().toISOString(),
    primaryDatabase: connStatus.primaryDatabase || selectedDatabases[0],
    selectedDatabases,
    databaseSummaries,
    dynamicSqlLimitation: 'Dynamic SQL dependencies cannot be fully discovered from catalog metadata.',
    summary: {
      totalViews: processedViews.length,
      criticalViews: processedViews.filter(v => v.riskCategory === 'critical').length,
      highViews: processedViews.filter(v => v.riskCategory === 'high').length,
      mediumViews: processedViews.filter(v => v.riskCategory === 'medium').length,
      lowViews: processedViews.filter(v => v.riskCategory === 'low').length,
      avgHealth: processedViews.length > 0 ? Math.round(processedViews.reduce((a, b) => a + b.healthScore, 0) / processedViews.length) : 0,
      totalEdges: normalizedEdges.length,
      crossDbEdges: normalizedEdges.filter(e => e.isCrossDb).length,
      linkedServerEdges: normalizedEdges.filter(e => e.isLinkedServer).length,
      outOfScopeEdges: normalizedEdges.filter(e => e.isOutOfScope).length,
      synonymEdges: normalizedEdges.filter(e => e.isSynonym).length,
      dynamicSqlLimitation: 'Dynamic SQL dependencies cannot be fully discovered from catalog metadata.'
    },
    views: processedViews,
    pressures: pressures.slice(0, 15),
    duplicates,
    regressions: runtimeResult.regressions || [],
    dependencies: normalizedEdges
  };

  latestScan = result;
  return result;
}

function getSubGraphForView(identifier, options = {}) {
  if (!latestScan) return null;
  return extractSubGraph(identifier, latestScan.views, latestScan.dependencies, options);
}

async function getIndexesForView(identifier) {
  if (!latestScan) return [];
  const targetView = latestScan.views.find(v =>
    v.canonicalId.toLowerCase() === String(identifier).toLowerCase() ||
    v.name.toLowerCase() === String(identifier).toLowerCase()
  );
  if (!targetView) return [];
  const dbName = targetView.database;

  if (!db.status().connected) {
    return (targetView.baseTables || []).map(tbl => ({
      schema_name: 'dbo',
      table_name: tbl,
      index_name: `PK_${tbl}`,
      index_id: 1,
      type_desc: 'CLUSTERED',
      is_unique: true,
      is_primary_key: true,
      is_disabled: false,
      key_columns: tbl.includes('HAREKET') ? 'sth_recno' : 'sto_recno',
      included_columns: null
    }));
  }

  const pool = db.getPool(dbName);
  const tables = targetView.baseTables || [];
  if (tables.length === 0) return [];

  const inList = tables.map(t => `'${t.replace(/'/g, "''")}'`).join(', ');
  const sql = `
    SELECT
      s.name AS schema_name,
      t.name AS table_name,
      i.name AS index_name,
      i.index_id,
      i.type_desc,
      i.is_unique,
      i.is_primary_key,
      i.is_disabled,
      STRING_AGG(CASE WHEN ic.is_included_column = 0 THEN c.name END, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS key_columns,
      STRING_AGG(CASE WHEN ic.is_included_column = 1 THEN c.name END, ', ') AS included_columns
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.indexes i ON i.object_id = t.object_id
    LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    LEFT JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE t.name IN (${inList})
    GROUP BY s.name, t.name, i.name, i.index_id, i.type_desc, i.is_unique, i.is_primary_key, i.is_disabled
    ORDER BY t.name, i.index_id;
  `;
  const res = await pool.request().query(sql);
  return res.recordset || [];
}

module.exports = {
  scan,
  getDefinition,
  getLatestScanData,
  getSubGraphForView,
  getIndexesForView
};
