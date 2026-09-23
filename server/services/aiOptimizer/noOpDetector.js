/**
 * SQL Server Refactoring & Performance Studio
 * Expert No-Op Detector & Structural Significance Engine (Sprint 10)
 *
 * Implements:
 * - Strict Cosmetic Rewrite Ban (alias rename, formatting, capitalization, CTE rename,
 *   column reorder, comments, whitespace, harmless derived table wrapping)
 * - Internal Structural Significance Score (0 to 5):
 *   0: text only
 *   1: expression cleanup
 *   2: predicate structural change (SARGable range rewrite)
 *   3: join / subquery restructuring
 *   4: base-table access consolidation
 *   5: relational shape redesign
 * - Query Shape Difference Report (Original vs Candidate)
 * - Strategy Diversity Fingerprinting (prevents duplicate candidates under different aliases)
 */

const astParser = require('../ast/astParser');

function normalizeExpression(expr = '') {
  if (!expr || typeof expr !== 'string') return '';
  return expr
    .replace(/\s+/g, ' ')
    .replace(/[\[\]]/g, '')
    .replace(/\b[a-zA-Z0-9_#]+\.([a-zA-Z0-9_#]+)\b/g, '$1') // Strip alias prefixes
    .trim()
    .toLowerCase();
}

/**
 * Strips comments, whitespace, and normalizes identifiers to detect pure formatting changes.
 */
function tokenizeAndNormalize(sql = '') {
  if (!sql) return [];
  const clean = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[\[\]]/g, '');

  const tokens = clean.match(/[a-zA-Z0-9_#.]+|[^\s\w]/g) || [];
  return tokens.map(t => t.toUpperCase());
}

/**
 * Normalizes predicate expressions for comparison
 */
function extractNormalizedPredicates(ast) {
  const predicates = [];
  for (const p of ast?.predicates || []) {
    const norm = normalizeExpression(p.expression || `${p.leftExpression} ${p.operator} ${p.rightExpression}`);
    if (norm) predicates.push(norm);
  }
  for (const j of ast?.joins || []) {
    for (const jp of j.predicates || []) {
      const norm = normalizeExpression(jp.expression || `${jp.leftExpression} ${jp.operator} ${jp.rightExpression}`);
      if (norm) predicates.push(norm);
    }
  }
  return predicates.sort();
}

/**
 * Generates an architectural difference report between Original and Candidate query shapes.
 */
function generateQueryShapeDiffReport(origAst, candAst) {
  const origJoins = origAst?.joins || [];
  const candJoins = candAst?.joins || [];
  const origSubs = origAst?.subqueries || [];
  const candSubs = candAst?.subqueries || [];
  const origCtes = origAst?.ctes || [];
  const candCtes = candAst?.ctes || [];

  // Base table access paths
  const origTablePaths = {};
  for (const t of origAst?.tables || []) {
    const name = (t.object || '').toUpperCase();
    if (name) origTablePaths[name] = (origTablePaths[name] || 0) + 1;
  }

  const candTablePaths = {};
  for (const t of candAst?.tables || []) {
    const name = (t.object || '').toUpperCase();
    if (name) candTablePaths[name] = (candTablePaths[name] || 0) + 1;
  }

  // Correlated subqueries
  const origCorrelated = origSubs.filter(s => s.isCorrelated).length;
  const candCorrelated = candSubs.filter(s => s.isCorrelated).length;

  // Non-SARGable date functions
  const origPredStr = (origAst?.predicates || []).map(p => p.expression || '').join(' ');
  const candPredStr = (candAst?.predicates || []).map(p => p.expression || '').join(' ');
  const sargRegex = /\b(YEAR|MONTH|DAY|DATEPART|FORMAT|LEFT|CONVERT)\s*\(/gi;
  const origNonSargCount = (origPredStr.match(sargRegex) || []).length;
  const candNonSargCount = (candPredStr.match(sargRegex) || []).length;

  // Distinct
  const origDistinct = Boolean(origAst?.hasDistinct);
  const candDistinct = Boolean(candAst?.hasDistinct);

  // Consolidated table access count
  let consolidatedTablesCount = 0;
  for (const [tbl, origCount] of Object.entries(origTablePaths)) {
    const candCount = candTablePaths[tbl] || 0;
    if (origCount > 1 && candCount < origCount) {
      consolidatedTablesCount += (origCount - candCount);
    }
  }

  const hasStructuralChange = (
    origJoins.length !== candJoins.length ||
    origCorrelated !== candCorrelated ||
    origNonSargCount !== candNonSargCount ||
    consolidatedTablesCount > 0 ||
    origDistinct !== candDistinct ||
    (origCtes.length !== candCtes.length && candJoins.length !== origJoins.length)
  );

  const originalSummary = [
    `${origJoins.length} joins`,
    `${Object.keys(origTablePaths).length} unique base tables (${Object.values(origTablePaths).reduce((a, b) => a + b, 0)} access paths)`,
    `${origCorrelated} correlated subqueries`,
    `${origNonSargCount} function-wrapped predicates`
  ];

  const candidateSummary = [
    `${candJoins.length} joins`,
    `${Object.keys(candTablePaths).length} unique base tables (${Object.values(candTablePaths).reduce((a, b) => a + b, 0)} access paths)`,
    `${candCorrelated} correlated subqueries`,
    `${candNonSargCount} function-wrapped predicates`
  ];

  return {
    hasStructuralChange,
    consolidatedTablesCount,
    origJoinsCount: origJoins.length,
    candJoinsCount: candJoins.length,
    origCorrelatedCount: origCorrelated,
    candCorrelatedCount: candCorrelated,
    origNonSargCount,
    candNonSargCount,
    origDistinct,
    candDistinct,
    origTablePaths,
    candTablePaths,
    originalSummary: originalSummary.join(', '),
    candidateSummary: candidateSummary.join(', ')
  };
}

/**
 * Calculates internal Rewrite Significance Score (0 to 5)
 */
function calculateSignificanceScore({
  origAst,
  candAst,
  diffReport,
  isLiteralMatch,
  isTokenMatch
}) {
  if (isLiteralMatch) return 0;
  if (isTokenMatch) return 0;

  if (!diffReport.hasStructuralChange) {
    // If no structural change, check if predicates changed at all
    const origPreds = extractNormalizedPredicates(origAst);
    const candPreds = extractNormalizedPredicates(candAst);
    if (origPreds.join(' ') === candPreds.join(' ')) {
      return 1; // Pure alias or cosmetic change
    }
  }

  // Score 4 or 5: Base-table access consolidation or full relational redesign
  if (diffReport.consolidatedTablesCount >= 2 || (diffReport.origJoinsCount >= 6 && diffReport.candJoinsCount <= diffReport.origJoinsCount - 2)) {
    return 5; // Full relational redesign
  }
  if (diffReport.consolidatedTablesCount >= 1) {
    return 4; // Base-table access consolidation
  }

  // Score 3: Join or subquery restructuring
  if (diffReport.origCorrelatedCount > diffReport.candCorrelatedCount || Math.abs(diffReport.origJoinsCount - diffReport.candJoinsCount) >= 1) {
    return 3;
  }

  // Score 2: Predicate structural change (SARGability)
  if (diffReport.origNonSargCount > diffReport.candNonSargCount) {
    return 2;
  }

  // Fallback for general structural difference
  return diffReport.hasStructuralChange ? 2 : 1;
}

/**
 * Structural Fingerprint Generator for Strategy Diversity Comparison
 */
function generateStructuralFingerprint(ast) {
  if (!ast) return '';
  const tables = (ast.tables || []).map(t => `${t.referenceType || 'BASE'}:${t.object}`.toUpperCase()).sort().join('|');
  const joins = (ast.joins || []).map(j => `${j.type}:${j.table?.object}`.toUpperCase()).sort().join('|');
  const predicates = extractNormalizedPredicates(ast).join('|');
  const cteCount = (ast.ctes || []).length;
  const subCount = (ast.subqueries || []).length;
  return `T:${tables}#J:${joins}#P:${predicates}#C:${cteCount}#S:${subCount}`;
}

/**
 * Checks whether two candidates represent the duplicate strategy (alias renaming).
 */
function isDuplicateStrategy(candAst1, candAst2) {
  const fp1 = generateStructuralFingerprint(candAst1);
  const fp2 = generateStructuralFingerprint(candAst2);
  return Boolean(fp1 && fp2 && fp1 === fp2);
}

/**
 * Main detection function.
 */
function detectNoOpRewrite({
  originalSql = '',
  candidateSql = '',
  originalAst = null,
  candidateAst = null
} = {}) {
  const origTrimmed = (originalSql || '').trim();
  const candTrimmed = (candidateSql || '').trim();

  // 1. Literal Equality Check
  if (origTrimmed === candTrimmed) {
    return {
      isMeaningful: false,
      significanceScore: 0,
      status: 'NO_MEANINGFUL_REWRITE',
      classification: 'COSMETIC_REWRITE',
      reason: 'Aday sorgu orijinal SQL ile karakteri karakterine aynıdır.',
      differences: [],
      diffReport: null
    };
  }

  // 2. Token Stream Equality Check (ignoring whitespace, case, comments)
  const origTokens = tokenizeAndNormalize(origTrimmed);
  const candTokens = tokenizeAndNormalize(candTrimmed);
  if (origTokens.join(' ') === candTokens.join(' ')) {
    return {
      isMeaningful: false,
      significanceScore: 0,
      status: 'NO_MEANINGFUL_REWRITE',
      classification: 'COSMETIC_REWRITE',
      reason: 'Yalnızca boşluk, yorum satırları veya harf büyüklüğü değiştirildi (kozmetik düzenleme).',
      differences: ['WHITESPACE_OR_COMMENT_ONLY'],
      diffReport: null
    };
  }

  // 3. Obtain ASTs
  const origAst = originalAst || astParser.parseSql(origTrimmed);
  const candAst = candidateAst || astParser.parseSql(candTrimmed);

  // 4. Generate Query Shape Difference Report
  const diffReport = generateQueryShapeDiffReport(origAst, candAst);

  // 5. Calculate Significance Score
  const score = calculateSignificanceScore({
    origAst,
    candAst,
    diffReport,
    isLiteralMatch: false,
    isTokenMatch: false
  });

  // Stricter Cosmetic Rejection: Score < 2 is rejected as COSMETIC_REWRITE
  if (score < 2) {
    return {
      isMeaningful: false,
      significanceScore: score,
      status: 'NO_MEANINGFUL_REWRITE',
      classification: 'COSMETIC_REWRITE',
      reason: 'Aday sorguda yalnızca alias, formatlama veya yüzeysel isim değişiklikleri yapılmıştır; ilişkisel sorgu yapısında anlamlı bir optimizasyon bulunmamaktadır.',
      differences: ['COSMETIC_ALIAS_OR_LAYOUT'],
      diffReport
    };
  }

  // Classification based on score
  let classification = 'STRUCTURAL_REWRITE';
  if (score === 2) classification = 'ACCESS_PATH_IMPROVEMENT';
  else if (score >= 4) classification = 'RELATIONAL_SHAPE_REDESIGN';

  return {
    isMeaningful: true,
    significanceScore: score,
    status: 'MEANINGFUL_REWRITE',
    classification,
    reason: `Anlamlı yapısal değişiklik saptandı (Önem skoru: ${score}/5). Orijinal: [${diffReport.originalSummary}] → Aday: [${diffReport.candidateSummary}].`,
    differences: ['STRUCTURAL_QUERY_TRANSFORMATION'],
    diffReport
  };
}

module.exports = {
  detectNoOpRewrite,
  tokenizeAndNormalize,
  extractNormalizedPredicates,
  generateQueryShapeDiffReport,
  calculateSignificanceScore,
  generateStructuralFingerprint,
  isDuplicateStrategy
};
