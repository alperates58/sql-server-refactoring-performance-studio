/**
 * SQL Server Refactoring & Performance Studio
 * Canonical AST Model (Sprint 4)
 *
 * Defines the normalized, parser-independent internal representation of a T-SQL query.
 */

function createCanonicalAst(init = {}) {
  return {
    analysisSource: init.analysisSource || 'AST',
    status: init.status || 'AST_AVAILABLE', // 'AST_AVAILABLE' | 'AST_PARTIAL' | 'AST_FAILED'
    dialect: 'TSQL',
    statements: init.statements || [],
    tables: init.tables || [],
    joins: init.joins || [],
    predicates: init.predicates || [],
    projections: init.projections || [],
    groupBy: init.groupBy || [],
    orderBy: init.orderBy || [],
    ctes: init.ctes || [],
    subqueries: init.subqueries || [],
    functions: init.functions || [],
    windowFunctions: init.windowFunctions || [],
    unions: init.unions || [],
    literals: init.literals || [],
    parameters: init.parameters || [],
    hints: init.hints || [],
    hasWildcardSelect: Boolean(init.hasWildcardSelect),
    hasDistinct: Boolean(init.hasDistinct),
    hasTop: Boolean(init.hasTop),
    topCount: init.topCount || null,
    parseErrors: init.parseErrors || []
  };
}

/**
 * Standard finding object for AST & Schema issues
 */
function createAstFinding({
  code,
  title,
  severity = 'MEDIUM', // 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category = 'performance',
  evidenceGrade = 'B', // 'A' | 'B' | 'C' | 'D'
  source = 'AST', // 'AST' | 'SCHEMA' | 'INDEX_METADATA' | 'EXECUTION_PLAN' | 'QUERY_STORE' | 'AI'
  expression = '',
  column = null,
  table = null,
  explanation = '',
  rewriteHint = null,
  evidence = null
}) {
  return {
    code,
    title,
    severity,
    category,
    evidenceGrade,
    source,
    expression,
    column,
    table,
    explanation,
    rewriteHint,
    evidence
  };
}

module.exports = {
  createCanonicalAst,
  createAstFinding
};
