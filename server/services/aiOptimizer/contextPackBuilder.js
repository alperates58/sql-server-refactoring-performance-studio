/**
 * SQL Server Refactoring & Performance Studio
 * Enriched Context Pack Builder (Sprint 10 Expert Mode)
 *
 * Assembles safe, multi-layered evidence pre-AI:
 * - Original SQL (Never truncated!)
 * - Track A: Physical Access (Indexes, Clustered/Nonclustered, Approximate Rows, Missing Indexes)
 * - Track B: Query Shape Review (16-point Relational Shape Opportunities, Shape Fingerprint)
 * - 16 Expert Questions Relational Checklist
 * - Top Expensive Plan Operators with elimination directives
 * - Zero Actual Plan pre-AI execution rule respected
 */

const astParser = require('../ast/astParser');
const astAnalyzer = require('../ast/astAnalyzer');
const schemaMetadata = require('../schemaMetadata');
const indexMetadata = require('../indexMetadata');
const planParser = require('../planParser');
const workbench = require('../workbenchService');
const { classifyRootCause } = require('./rootCauseClassifier');

const EXPERT_QUESTIONS_CHECKLIST = [
  '1. Aynı tablo birden fazla kez taranıyor mu?',
  '2. Aynı expression tekrar tekrar hesaplanıyor mu?',
  '3. Join\'lerden biri gereksiz mi veya dış join fiilen iç joine mi dönüşüyor?',
  '4. Predicate daha erken uygulanabilir mi (predicate pushdown)?',
  '5. Aggregation daha erken yapılabilir mi (pre-aggregation before join)?',
  '6. Correlated subquery set-based (APPLY / JOIN) hale getirilebilir mi?',
  '7. Aynı base table erişimi tek CTE veya derived set ile birleştirilebilir mi?',
  '8. Projection gereksiz geniş mi (SELECT * veya kullanılmayan kolonlar)?',
  '9. DISTINCT semantik olarak gereksiz mi (join row explosion maskesi mi)?',
  '10. Join cardinality daha erken azaltılabilir mi?',
  '11. SARGability geliştirilebilir mi (fonksiyon sarmalı kolonlar aralık karşılaştırmasına dönüştürülebilir mi)?',
  '12. CASE / DATEPART / YEAR / MONTH gibi pahalı ifadeler tekrar ediyor mu?',
  '13. Derived table / CTE yapısı optimizer\'a daha iyi relational shape verebilir mi?',
  '14. OR koşulları erişim planını bozuyor mu?',
  '15. Implicit conversion (örtük tip dönüşümü) var mı?',
  '16. GROUP BY / window işlemleri daha verimli şekillendirilebilir mi?'
];

async function buildEnrichedContextPack({
  sql = '',
  viewName = null,
  database = null,
  options = {},
  estimatedPlanXml = null,
  missingIndexes = [],
  queryStoreEvidence = null,
  logicalReads = 0
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

  // 3. Batched Schema & Approximate Row Counts (Zero COUNT(*) execution)
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
      rawXml = null;
    }
  }

  if (rawXml) {
    try {
      parsedPlan = planParser.parseShowPlanXML(rawXml);
    } catch (_) {}
  }

  // Compact plan representation with explicit operator targets and challenges
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
      estRows: o.estRows,
      predicate: o.predicate || o.seekPredicate || null,
      directive: `Bu operatörün (${o.physicalOp} on ${o.targetObject || 'unknown'}) taranmasını/maliyetini ortadan kaldıracak veya azaltacak bir ilişkisel biçim düşünün.`
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

  // 5. Query Store Summary
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

  // 6. Deterministic Dual-Track Root Cause Classification
  const allMissingIndexes = [
    ...(missingIndexes || []),
    ...(options.missingIndexes || []),
    ...(parsedPlan?.missingIndexes || [])
  ];

  const effectiveReads = logicalReads || options.logicalReads || qsSummary?.avgLogicalReads || 0;

  const rootCause = classifyRootCause({
    sql: cleanSql,
    ast,
    astAnalysis: { findings: traceableFindings },
    estimatedPlan: parsedPlan || options.estimatedPlan,
    indexCoverage: indexMetadata.analyzeIndexCoverage(ast, relevantIndexes)?.coverageResults || options.indexCoverage,
    missingIndexes: allMissingIndexes,
    queryStoreSummary: qsSummary,
    tableRowsApprox,
    logicalReads: effectiveReads
  });

  return {
    target: {
      viewName,
      database
    },
    sql: {
      original: cleanSql, // INVARIANT: Never truncated
      lineCount: cleanSql.split('\n').length
    },
    rootCause,
    trackA: rootCause.trackA,
    trackB: rootCause.trackB,
    queryShapeOpportunities: rootCause.queryShapeOpportunities,
    expertQuestionsChecklist: EXPERT_QUESTIONS_CHECKLIST,
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
  buildEnrichedContextPack,
  EXPERT_QUESTIONS_CHECKLIST
};
