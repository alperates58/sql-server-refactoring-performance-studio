/**
 * SQL Server Refactoring & Performance Studio
 * Regex Fallback AST Adapter (Sprint 4)
 *
 * Provides a resilient, heuristic fallback when AST parsing cannot complete.
 * Guarantees zero crash policy while transparently tagging analysisSource: 'REGEX_FALLBACK'.
 */

const { createCanonicalAst } = require('../canonicalModel');

function parseWithRegexFallback(sql = '', originalError = null) {
  const clean = (sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
  const upper = clean.toUpperCase();

  const tables = [];
  const fromMatches = clean.matchAll(/(?:FROM|JOIN)\s+([a-zA-Z0-9_#\[\].]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_#\[\]]+))?/gi);
  for (const m of fromMatches) {
    const rawObj = m[1].trim();
    if (!['SELECT', 'WHERE', 'ON', 'GROUP', 'ORDER'].includes(rawObj.toUpperCase())) {
      const parts = rawObj.replace(/[\[\]]/g, '').split('.');
      const objName = parts[parts.length - 1];
      const schemaName = parts.length > 1 ? parts[parts.length - 2] : 'dbo';
      const dbName = parts.length > 2 ? parts[0] : null;
      tables.push({
        referenceType: objName.startsWith('#') ? 'TEMP_TABLE' : 'BASE_TABLE',
        database: dbName,
        schema: schemaName,
        object: objName,
        alias: m[2] ? m[2].replace(/[\[\]]/g, '') : objName
      });
    }
  }

  const predicates = [];
  const whereMatch = clean.match(/\bWHERE\s+([\s\S]+?)(?:\b(?:GROUP\s+BY|ORDER\s+BY|HAVING|UNION)\b|$)/i);
  if (whereMatch) {
    const rawPred = whereMatch[1].trim();
    predicates.push({
      clause: 'WHERE',
      expression: rawPred,
      leftExpression: rawPred.split(/=|<|>|LIKE|IN/i)[0].trim(),
      operator: '=',
      rightExpression: '',
      columns: [],
      functions: []
    });
  }

  const projections = [];
  const selMatch = clean.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  if (selMatch) {
    const cols = selMatch[1].split(',');
    for (const c of cols) {
      const trimmed = c.trim();
      if (trimmed) {
        projections.push({
          expression: trimmed,
          alias: trimmed.split(/\s+AS\s+/i)[1] || trimmed,
          isWildcard: trimmed === '*'
        });
      }
    }
  }

  const hasDistinct = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?DISTINCT\b/i.test(clean);
  const hasWildcardSelect = /\bSELECT\s+[^;]*?\*/i.test(clean) && !/\bCOUNT\s*\(\s*\*\s*\)/i.test(clean);
  const hasTop = /\bSELECT\s+(?:DISTINCT\s+)?TOP\s+\(?\d+\)?/i.test(clean);

  const unions = [];
  if (/\bUNION\s+ALL\b/i.test(clean)) {
    unions.push({ type: 'UNION ALL', isDistinct: false });
  } else if (/\bUNION\b/i.test(clean)) {
    unions.push({ type: 'UNION', isDistinct: true });
  }

  const status = tables.length > 0 || projections.length > 0 ? 'AST_PARTIAL' : 'AST_FAILED';

  return createCanonicalAst({
    analysisSource: 'REGEX_FALLBACK',
    status,
    tables,
    joins: [],
    predicates,
    projections,
    ctes: [],
    subqueries: [],
    windowFunctions: [],
    unions,
    hasWildcardSelect,
    hasDistinct,
    hasTop,
    parseErrors: originalError ? [originalError.message || String(originalError)] : ['AST parser fallback']
  });
}

module.exports = {
  parseWithRegexFallback
};
