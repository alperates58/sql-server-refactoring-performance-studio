/**
 * SQL Server Refactoring & Performance Studio
 * Conservative No-Op Candidate Detector
 *
 * Implements:
 * - Structural AST comparison between Original and Candidate SQL
 * - Boundary handling for AST_AVAILABLE, AST_PARTIAL, and AST_FAILED
 * - Token-level and object-level normalization fallback
 * - Candidate Classification:
 *    A) COSMETIC_REWRITE (alias renames, formatting, CTE renaming, harmless reordering) -> NO_MEANINGFUL_REWRITE
 *    B) STRUCTURAL_REWRITE (subquery flattening, pre-aggregation, distinct removal)
 *    C) ACCESS_PATH_IMPROVEMENT (SARGable range rewrite, function unwrapping)
 *    D) PLAN_AFFECTING_REWRITE (join order, spool elimination)
 */

const astParser = require('../ast/astParser');

function normalizeExpression(expr = '') {
  if (!expr || typeof expr !== 'string') return '';
  return expr
    .replace(/\s+/g, ' ')
    .replace(/[\[\]]/g, '')
    .replace(/\b[a-zA-Z0-9_#]+\.([a-zA-Z0-9_#]+)\b/g, '$1') // Strip alias prefixes (e.g. s.col -> col)
    .trim()
    .toLowerCase();
}

/**
 * Strips comments, whitespace, and normalizes identifiers to detect pure formatting changes.
 */
function tokenizeAndNormalize(sql = '') {
  if (!sql) return [];
  // Strip block and line comments
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
 * Checks for SARGable transformations (e.g. YEAR(col) = 2026 -> col >= '20260101' AND col < '20270101')
 */
function detectAccessPathImprovement(origAst, candAst) {
  const origPreds = (origAst.predicates || []).map(p => (p.expression || '').toUpperCase());
  const candPreds = (candAst.predicates || []).map(p => (p.expression || '').toUpperCase());

  // Check if non-SARGable date/convert function was present in original but replaced by range in candidate
  const origHasDateFunc = origPreds.some(p => /\b(YEAR|MONTH|DAY|DATEPART|CONVERT|CAST)\s*\(/.test(p));
  const candHasRange = candPreds.some(p => />=|<=|>|</.test(p));

  if (origHasDateFunc && candHasRange) {
    return true;
  }
  return false;
}

/**
 * Detects structural changes (e.g. correlated subquery converted to JOIN / APPLY or CTE)
 */
function detectStructuralRewrite(origAst, candAst) {
  const origSubs = origAst.subqueries || [];
  const candSubs = candAst.subqueries || [];
  const origCtes = origAst.ctes || [];
  const candCtes = candAst.ctes || [];
  const origJoins = origAst.joins || [];
  const candJoins = candAst.joins || [];

  // Correlated subquery eliminated or flattened
  const origCorrelated = origSubs.filter(s => s.isCorrelated).length;
  const candCorrelated = candSubs.filter(s => s.isCorrelated).length;
  if (origCorrelated > candCorrelated) {
    return { isStructural: true, reason: `${origCorrelated - candCorrelated} adet ilişkili (correlated) alt sorgu düzleştirildi.` };
  }

  // Pre-aggregated CTE introduced
  if (candCtes.length > origCtes.length && candJoins.length !== origJoins.length) {
    return { isStructural: true, reason: 'Küme bazlı ön toplama (pre-aggregation) CTE ve join yapısı oluşturuldu.' };
  }

  // DISTINCT safely removed
  if (origAst.hasDistinct && !candAst.hasDistinct) {
    return { isStructural: true, reason: 'Gereksiz DISTINCT kaldırıldı.' };
  }

  // UNION converted to UNION ALL
  const origUnions = (origAst.unions || []).filter(u => u.type === 'UNION').length;
  const candUnions = (candAst.unions || []).filter(u => u.type === 'UNION').length;
  if (origUnions > candUnions) {
    return { isStructural: true, reason: 'UNION operatörü UNION ALL haline getirildi.' };
  }

  return { isStructural: false };
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
      status: 'NO_MEANINGFUL_REWRITE',
      classification: 'COSMETIC_REWRITE',
      reason: 'Aday sorgu orijinal SQL ile karakteri karakterine aynıdır.',
      differences: []
    };
  }

  // 2. Token Stream Equality Check (ignoring whitespace, case, comments)
  const origTokens = tokenizeAndNormalize(origTrimmed);
  const candTokens = tokenizeAndNormalize(candTrimmed);
  if (origTokens.join(' ') === candTokens.join(' ')) {
    return {
      isMeaningful: false,
      status: 'NO_MEANINGFUL_REWRITE',
      classification: 'COSMETIC_REWRITE',
      reason: 'Yalnızca boşluk, yorum satırları veya harf büyüklüğü değiştirildi (kozmetik düzenleme).',
      differences: ['WHITESPACE_OR_COMMENT_ONLY']
    };
  }

  // 3. Obtain ASTs
  const origAst = originalAst || astParser.parseSql(origTrimmed);
  const candAst = candidateAst || astParser.parseSql(candTrimmed);

  // 4. Handle AST_FAILED / AST_PARTIAL Gracefully
  const isAstComplete = origAst.status === 'AST_AVAILABLE' && candAst.status === 'AST_AVAILABLE';

  if (!isAstComplete) {
    // Conservative fallback when parser fails or is partial:
    // Compare referenced tables and basic token set
    const origTables = new Set((origAst.tables || []).map(t => t.object.toLowerCase()));
    const candTables = new Set((candAst.tables || []).map(t => t.object.toLowerCase()));
    const tablesIdentical = origTables.size === candTables.size && [...origTables].every(t => candTables.has(t));

    // If tables are identical and token length differs by less than 5%, check if tokens are just alias renames
    const tokenLenDelta = Math.abs(origTokens.length - candTokens.length);
    if (tablesIdentical && tokenLenDelta <= 2) {
      // High likelihood of cosmetic rewrite
      const origKeywords = origTokens.filter(t => ['SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'ORDER'].includes(t));
      const candKeywords = candTokens.filter(t => ['SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'ORDER'].includes(t));
      if (origKeywords.join(' ') === candKeywords.join(' ')) {
        return {
          isMeaningful: false,
          status: 'NO_MEANINGFUL_REWRITE',
          classification: 'COSMETIC_REWRITE',
          reason: 'AST ayrıştırması kısmi olmasına rağmen sorgu iskeleti ve erişilen tabloların birebir aynı olduğu tespit edildi.',
          differences: ['ALIAS_OR_FORMATTING_CHANGE']
        };
      }
    }

    // When in doubt with partial AST, give benefit of doubt to avoid false rejection
    return {
      isMeaningful: true,
      status: 'MEANINGFUL_REWRITE',
      classification: 'STRUCTURAL_REWRITE',
      reason: 'Kısmi AST durumunda konservatif doğrulama uygulandı; aday benchmark aşamasına aktarılıyor.',
      differences: ['UNPARSED_DIFFERENCE']
    };
  }

  // 5. Complete AST Structural Analysis
  const differences = [];

  // A. Access Path Improvement (SARGability)
  const isAccessPathImproved = detectAccessPathImprovement(origAst, candAst);
  if (isAccessPathImproved) {
    differences.push('SARGABLE_PREDICATE_TRANSFORMATION');
    return {
      isMeaningful: true,
      status: 'MEANINGFUL_REWRITE',
      classification: 'ACCESS_PATH_IMPROVEMENT',
      reason: 'Non-SARGable fonksiyon veya filtre indekse uygun aralık (SARGable) haline getirildi.',
      differences
    };
  }

  // B. Structural Rewrite (Subqueries, Aggregations, Joins)
  const structuralCheck = detectStructuralRewrite(origAst, candAst);
  if (structuralCheck.isStructural) {
    differences.push('STRUCTURAL_QUERY_TRANSFORMATION');
    return {
      isMeaningful: true,
      status: 'MEANINGFUL_REWRITE',
      classification: 'STRUCTURAL_REWRITE',
      reason: structuralCheck.reason,
      differences
    };
  }

  // C. Predicate & Table Comparison
  const origPreds = extractNormalizedPredicates(origAst);
  const candPreds = extractNormalizedPredicates(candAst);
  const predsIdentical = origPreds.length === candPreds.length && origPreds.every((p, idx) => p === candPreds[idx]);

  const origTables = (origAst.tables || []).map(t => `${t.referenceType}:${t.object}`.toLowerCase()).sort();
  const candTables = (candAst.tables || []).map(t => `${t.referenceType}:${t.object}`.toLowerCase()).sort();
  const tablesIdentical = origTables.length === candTables.length && origTables.every((t, idx) => t === candTables[idx]);

  const origJoins = (origAst.joins || []).map(j => `${j.type}:${j.table?.object}`.toLowerCase()).sort();
  const candJoins = (candAst.joins || []).map(j => `${j.type}:${j.table?.object}`.toLowerCase()).sort();
  const joinsIdentical = origJoins.length === candJoins.length && origJoins.every((j, idx) => j === candJoins[idx]);

  if (predsIdentical && tablesIdentical && joinsIdentical && origAst.hasDistinct === candAst.hasDistinct) {
    return {
      isMeaningful: false,
      status: 'NO_MEANINGFUL_REWRITE',
      classification: 'COSMETIC_REWRITE',
      reason: 'Aday sorguda tablolar, join bağlantıları ve filtre koşulları yapısal olarak birebir aynıdır; yalnızca alias veya format değişikliği yapılmıştır.',
      differences: ['COSMETIC_ALIAS_OR_LAYOUT']
    };
  }

  // Default: Meaningful change detected
  differences.push('GENERAL_STRUCTURAL_CHANGE');
  return {
    isMeaningful: true,
    status: 'MEANINGFUL_REWRITE',
    classification: 'PLAN_AFFECTING_REWRITE',
    reason: 'Sorgu yapısında veya filtre topolojisinde anlamlı değişiklik tespit edildi.',
    differences
  };
}

module.exports = {
  detectNoOpRewrite,
  tokenizeAndNormalize,
  extractNormalizedPredicates
};
