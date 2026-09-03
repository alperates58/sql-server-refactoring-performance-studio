/**
 * Scanner Service
 *
 * Coordinates inventory discovery, dependency analysis, static AST/heuristic signals,
 * runtime evidence collection, scoring, table pressure, and duplicate detection.
 */

const fs = require('fs');
const path = require('path');
const db = require('./sqlServer');
const { analyzeStaticSql } = require('./staticAnalyzer');
const { buildDependencyStats, extractSubGraph } = require('./dependencyEngine');
const { calculateHealth, calculateRisk, buildRiskBars } = require('./scoring');
const { findDuplicates } = require('./duplicateFinder');
const { collectRuntimeEvidence } = require('./runtimeEvidence');

const sqlDir = path.join(__dirname, '..', '..', 'sql');
function loadSql(name) {
  return fs.readFileSync(path.join(sqlDir, name), 'utf8');
}

// In-memory cache for fast lazy loading of definitions and graph queries
let latestScan = null;
const definitionCache = new Map();

function getDefinition(viewName) {
  if (!viewName) return null;
  return definitionCache.get(viewName.toUpperCase()) || null;
}

function getLatestScanData() {
  return latestScan;
}

async function scan(prefix = 'AA_') {
  const sanitizedPrefix = prefix.replace(/'/g, "''");
  const viewsQuery = loadSql('01-views.sql').replaceAll('{{PREFIX}}', sanitizedPrefix);
  const depsQuery = loadSql('02-dependencies.sql').replaceAll('{{PREFIX}}', sanitizedPrefix);

  // 1. Fetch metadata in parallel
  const [viewsResult, depsResult] = await Promise.all([
    db.query(viewsQuery),
    db.query(depsQuery)
  ]);

  const rawViews = viewsResult.recordset || [];
  const edges = depsResult.recordset || [];

  // Clear and populate definition cache
  definitionCache.clear();
  for (const v of rawViews) {
    if (v.view_name && v.definition) {
      definitionCache.set(v.view_name.toUpperCase(), v.definition);
    }
  }

  // 2. Compute dependency topology
  const graphStatsMap = buildDependencyStats(rawViews, edges);

  // 3. Collect runtime evidence (Query Store / Plan Cache)
  const runtimeResult = await collectRuntimeEvidence(rawViews).catch(() => ({
    source: 'NONE',
    evidenceGrade: 'D',
    isVolatile: false,
    viewEvidence: new Map(),
    regressions: []
  }));

  // 4. Analyze each view
  const processedViews = rawViews.map(v => {
    const vNameUpper = v.view_name.toUpperCase();
    const gStats = graphStatsMap.get(v.object_id) || {};
    const staticRes = analyzeStaticSql(v.definition || '');
    const rt = runtimeResult.viewEvidence.get(vNameUpper) || null;

    // Combine signals
    const signals = {
      ...staticRes.signals,
      depth: gStats.depth || 1,
      baseTableCount: gStats.baseTableCount || 0,
      repeatedBaseTableCount: gStats.repeatedBaseTableCount || 0,
      dependentCount: gStats.dependentCount || 0,
      cycleCount: (gStats.cycles || []).length,
      unresolvedCount: (gStats.unresolved || []).length
    };

    // Calculate scores
    const health = calculateHealth(signals);
    const risk = calculateRisk({
      health,
      depth: signals.depth,
      repeatedCount: signals.repeatedBaseTableCount,
      dependentCount: signals.dependentCount,
      runtime: rt
    });

    // Merge static and graph findings
    const allFindings = [
      ...(gStats.graphFindings || []),
      ...(staticRes.findings || [])
    ];

    // Build risk breakdown bars
    const riskBars = buildRiskBars(signals, rt);

    // Format problems list for UI
    const problems = allFindings.map(f => ({
      symbol: f.symbol || '!',
      title: f.title,
      detail: f.explanation,
      severity: f.severity,
      penalty: f.healthPenalty,
      category: f.category,
      evidenceGrade: f.evidenceGrade
    }));

    return {
      object_id: v.object_id,
      schema_name: v.schema_name,
      name: v.view_name,
      view_name: v.view_name,
      create_date: v.create_date,
      modify_date: v.modify_date,
      modified: v.modify_date ? new Date(v.modify_date).toLocaleDateString('tr-TR') : '',
      definitionLength: (v.definition || '').length,
      lineCount: signals.lineCount,
      depth: signals.depth,
      tables: signals.baseTableCount,
      baseTables: gStats.baseTableList || [],
      dependents: signals.dependentCount,
      upstreamViews: gStats.upstreamViews || [],
      repeatedBaseTables: gStats.repeatedBaseTablePaths || [],
      health,
      risk: risk.level.toLowerCase(),
      riskLevel: risk.level,
      riskScore: risk.score,
      evidenceGrade: risk.evidenceGrade,
      reads: rt ? rt.formattedReads : '—',
      median: rt ? rt.formattedDuration : '—',
      riskBars,
      problems,
      // definition is omitted here to keep payload compact; loaded lazily via /api/views/:name/source
    };
  });

  // Sort views by risk score descending
  processedViews.sort((a, b) => b.riskScore - a.riskScore);

  // 5. Compute base table pressure map
  const tableStats = new Map();
  for (const v of processedViews) {
    const isCritical = v.riskLevel === 'CRITICAL';
    for (const tableName of v.baseTables || []) {
      if (!tableStats.has(tableName)) {
        tableStats.set(tableName, {
          name: tableName,
          refs: 0,
          paths: 0,
          critical: 0,
          repeated: 0
        });
      }
      const t = tableStats.get(tableName);
      t.refs++;
      t.paths += Math.max(1, v.depth);
      if (isCritical) t.critical++;
    }

    // Add repeated access count
    for (const r of v.repeatedBaseTables || []) {
      if (tableStats.has(r.tableName)) {
        const t = tableStats.get(r.tableName);
        t.repeated++;
        t.paths += (r.pathCount - 1);
      }
    }
  }

  const pressures = Array.from(tableStats.values()).map(t => {
    // Score table pressure from 0-100
    const rawScore = Math.min(100, Math.round(t.refs * 1.5 + t.paths * 0.4 + t.critical * 3 + t.repeated * 4));
    return {
      ...t,
      score: Math.max(10, Math.min(99, rawScore))
    };
  });
  pressures.sort((a, b) => b.score - a.score);

  // 6. Compute duplicate logic candidates
  const duplicates = findDuplicates(rawViews, 0.75, 8);

  // 7. Compute overview metrics
  const criticalCount = processedViews.filter(v => v.riskLevel === 'CRITICAL' || v.health < 45).length;
  const highCount = processedViews.filter(v => v.riskLevel === 'HIGH').length;
  const totalRepeatedPatterns = processedViews.reduce((sum, v) => sum + (v.repeatedBaseTables?.length || 0), 0);
  const avgHealth = processedViews.length > 0
    ? Math.round(processedViews.reduce((sum, v) => sum + v.health, 0) / processedViews.length)
    : 100;

  const result = {
    scannedAt: new Date().toISOString(),
    prefix,
    metrics: {
      totalViews: processedViews.length,
      criticalViews: criticalCount,
      highViews: highCount,
      totalEdges: edges.length,
      repeatedAccessPatterns: totalRepeatedPatterns,
      averageHealth: avgHealth,
      duplicateCandidates: duplicates.length,
      activeRegressions: runtimeResult.regressions.length,
      runtimeSource: runtimeResult.source,
      evidenceGrade: runtimeResult.evidenceGrade,
      isVolatile: runtimeResult.isVolatile
    },
    views: processedViews,
    pressures: pressures.slice(0, 15),
    duplicates,
    regressions: runtimeResult.regressions,
    dependencies: edges
  };

  latestScan = result;
  return result;
}

function getSubGraphForView(viewName) {
  if (!latestScan) return null;
  return extractSubGraph(viewName, latestScan.views, latestScan.dependencies);
}

module.exports = {
  scan,
  getDefinition,
  getLatestScanData,
  getSubGraphForView
};
