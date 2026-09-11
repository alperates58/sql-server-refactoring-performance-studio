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
      tables.push({
        referenceType: rawObj.startsWith('#') ? 'TEMP_TABLE' : 'BASE_TABLE',
        database: null,
        schema: 'dbo',
        object: rawObj.replace(/[\[\]]/g, ''),
        alias: m[2] ? m[2].replace(/[\[\]]/g, '') : rawObj.replace(/[\[\]]/g, '')
      });
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

  return createCanonicalAst({
    analysisSource: 'REGEX_FALLBACK',
    status: 'AST_FAILED',
    tables,
    joins: [],
    predicates: [],
    projections: [],
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
