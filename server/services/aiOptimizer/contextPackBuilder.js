/**
 * SQL Server Refactoring & Performance Studio
 * Enriched Context Pack Builder (Sprint 9)
 *
 * Assembles safe, multi-layered evidence pre-AI:
 * - Original SQL (Never truncated)
 * - Estimated Execution Plan (Top operators, scans, seeks, spools, missing indexes)
 * - Approximate Table Row Counts (via sys.partitions - ZERO COUNT(*) execution)
 * - Query-Relevant Indexes (Predicate, join, order, clustered keys)
 * - Referenced Table Schemas (Columns, datatypes, nullability)
 * - Compact Query Store Summary (if enabled)
 * - Traceable Finding IDs (F01, F02, etc.)
 * - Deterministic Root Cause Classification
 *
 * CRITICAL RULE: The target query is NEVER executed for Actual Plan pre-AI!
 */

const astParser = require('../ast/astParser');
const astAnalyzer = require('../ast/astAnalyzer');
const schemaMetadata = require('../schemaMetadata');
const indexMetadata = require('../indexMetadata');
const planParser = require('../planParser');
const workbench = require('../workbenchService');
const { classifyRootCause } = require('./rootCauseClassifier');

async function buildEnrichedContextPack({
  sql = '',
  viewName = null,
  database = null,
  options = {},
  estimatedPlanXml = null,
  missingIndexes = [],
  queryStoreEvidence = null
} = {}) {
  const cleanSql = (sql || '').trim();

  // 1. Parse AST
  const ast = astParser.parseSql(cleanSql);
  const astAnalysis = astAnalyzer.analyzeAst(ast);

  // Assign traceable finding IDs (F01, F02, ...)
  const traceableFindings = (astAnalysis.findings || []).map((f, idx) => ({
    findingId: `F${String(idx + 1).padStart(2, '0')}`,
    ...f
  }));

  // 2. Identify referenced base tables
  const baseTableNames = [...new Set(
    (ast.tables || [])
      .filter(t => t.referenceType === 'BASE_TABLE' || !t.referenceType)
      .map(t => t.object)
      .filter(Boolean)
  )];

  // 3. Batched Schema & Approximate Row Counts
  let schemas = {};
  let tableRowsApprox = {};
  let rawIndexes = {};
  let relevantIndexes = {};

  if (baseTableNames.length > 0) {
    try {
      schemas = await schemaMetadata.batchGetSchemas(database, baseTableNames);
    } catch (_) {}

    try {
      tableRowsApprox = await schemaMetadata.batchGetApproximateRowCounts(database, baseTableNames);
    } catch (_) {}

    try {
      rawIndexes = await indexMetadata.batchGetIndexes(database, baseTableNames);
      relevantIndexes = indexMetadata.filterQueryRelevantIndexes(rawIndexes, ast);
    } catch (_) {}
  }

  // 4. Estimated Execution Plan (Zero Actual Execution!)
  let parsedPlan = null;
  let rawXml = estimatedPlanXml;

  if (!rawXml) {
    try {
      const planRes = await workbench.executePlan({
        sql: cleanSql,
        database,
        mode: 'estimated',
        timeoutMs: 15000
      });
      if (planRes && planRes.rawXml) {
        rawXml = planRes.rawXml;
      }
    } catch (planErr) {
      // Plan extraction may fail if offline/mock or invalid syntax
      rawXml = null;
    }
  }

  if (rawXml) {
    try {
      parsedPlan = planParser.parseShowPlanXML(rawXml);
    } catch (_) {}
  }

  // Compact plan representation for prompt
  const compactPlan = parsedPlan ? {
    statementType: parsedPlan.statementType,
    totalSubTreeCost: parsedPlan.totalSubTreeCost,
    totalEstRows: parsedPlan.totalEstRows,
    optimizationLevel: parsedPlan.optimizationLevel,
    scansCount: parsedPlan.scans,
    seeksCount: parsedPlan.seeks,
    lookupsCount: parsedPlan.lookups,
    spoolsCount: parsedPlan.spools,
    sortsCount: parsedPlan.sorts,
    topCostOperators: (parsedPlan.topOperators || []).map(o => ({
      name: o.name,
      physicalOp: o.physicalOp,
      costPercent: o.costPercent,
      targetObject: o.targetObject,
      estRows: o.estRows
    })),
    warnings: (parsedPlan.warnings || []).map(w => w.message || w.name || w.code),
    missingIndexes: (parsedPlan.missingIndexes || []).map(mi => ({
      table: mi.table,
      impact: mi.impact,
      equalityColumns: mi.equalityColumns,
      inequalityColumns: mi.inequalityColumns,
      includedColumns: mi.includedColumns
    }))
  } : null;

  // 5. Query Store Summary (Compact, zero raw history dump)
  let qsSummary = null;
  if (queryStoreEvidence && queryStoreEvidence.available) {
    qsSummary = {
      executionCount: queryStoreEvidence.executionCount || 0,
      avgDurationMs: queryStoreEvidence.avgDurationMs || 0,
      medianDurationMs: queryStoreEvidence.medianDurationMs || 0,
      avgLogicalReads: queryStoreEvidence.avgLogicalReads || 0,
      avgCpuMs: queryStoreEvidence.avgCpuMs || 0,
      planCount: queryStoreEvidence.planCount || 1,
      hasRecentRegression: Boolean(queryStoreEvidence.hasRegression)
    };
  }

  // 6. Deterministic Root Cause Classification
  const allMissingIndexes = [
    ...(missingIndexes || []),
    ...(options.missingIndexes || []),
    ...(parsedPlan?.missingIndexes || [])
  ];

  const rootCause = classifyRootCause({
    sql: cleanSql,
    ast,
    astAnalysis: { findings: traceableFindings },
    estimatedPlan: parsedPlan || options.estimatedPlan,
    indexCoverage: indexMetadata.analyzeIndexCoverage(ast, relevantIndexes)?.coverageResults || options.indexCoverage,
    missingIndexes: allMissingIndexes,
    queryStoreSummary: qsSummary,
    tableRowsApprox
  });

  return {
    target: {
      viewName,
      database
    },
    sql: {
      original: cleanSql,
      lineCount: cleanSql.split('\n').length
    },
    rootCause,
    ast: {
      analysisSource: ast.analysisSource,
      status: ast.status,
      tables: ast.tables,
      joins: ast.joins,
      predicates: ast.predicates,
      ctes: ast.ctes,
      subqueries: ast.subqueries,
      windows: ast.windowFunctions,
      structuralFindings: traceableFindings
    },
    schema: schemas,
    tableRowsApprox,
    relevantIndexes,
    estimatedPlan: compactPlan,
    queryStoreSummary: qsSummary,
    options
  };
}

module.exports = {
  buildEnrichedContextPack
};
