/**
 * SQL Fingerprinting & Duplicate Detection
 *
 * Normalizes SQL definitions to uncover structurally identical or similar views
 * that duplicate business logic across the schema.
 */

function normalizeSqlForFingerprint(sql = '') {
  if (!sql) return '';
  let s = sql;

  // 1. Remove comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/--.*$/gm, ' ');

  // 2. Strip brackets and quotes around identifiers
  s = s.replace(/\[([a-zA-Z0-9_]+)\]/g, '$1');
  s = s.replace(/"([a-zA-Z0-9_]+)"/g, '$1');

  // 3. Normalize string literals and numbers to placeholders
  s = s.replace(/'(?:''|[^'])*'/g, "'?'");
  s = s.replace(/\b\d+\b/g, '0');

  // 4. Lowercase everything
  s = s.toLowerCase();

  // 5. Remove common boilerplate like CREATE/ALTER VIEW ... AS
  s = s.replace(/^.*?\bcreate\s+(?:or\s+alter\s+)?view\s+[a-z0-9_.]+\s+as\s+/i, '');

  // 6. Normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

function tokenize(normalizedSql = '') {
  // Extract word tokens and operator tokens
  return normalizedSql.match(/[a-z0-9_]+|[=<>!+*/(),]/g) || [];
}

function jaccardSimilarity(tokensA = [], tokensB = []) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? (intersection / union) : 0;
}

function findDuplicates(views = [], threshold = 0.75, maxPairs = 10) {
  const tokenizedViews = views
    .filter(v => v.definition && v.definition.length > 30)
    .map(v => {
      const norm = normalizeSqlForFingerprint(v.definition);
      return {
        viewName: v.view_name,
        tokens: tokenize(norm),
        baseTables: v.baseTables || []
      };
    });

  const pairs = [];

  for (let i = 0; i < tokenizedViews.length; i++) {
    for (let j = i + 1; j < tokenizedViews.length; j++) {
      const a = tokenizedViews[i];
      const b = tokenizedViews[j];

      // Quick filter: token length difference should not be massive
      const lenRatio = Math.min(a.tokens.length, b.tokens.length) / Math.max(a.tokens.length, b.tokens.length);
      if (lenRatio < 0.5) continue;

      const sim = jaccardSimilarity(a.tokens, b.tokens);
      if (sim >= threshold) {
        const commonTables = (a.baseTables || []).filter(t => (b.baseTables || []).includes(t));
        pairs.push({
          similarity: Math.round(sim * 100),
          a: a.viewName,
          b: b.viewName,
          common: commonTables.length > 0 ? commonTables : ['SQL structure match'],
          diff: sim > 0.9 ? 'Minor filter / projection variation' : 'Structural variation with common base'
        });
      }
    }
  }

  pairs.sort((x, y) => y.similarity - x.similarity);
  return pairs.slice(0, maxPairs);
}

module.exports = { normalizeSqlForFingerprint, findDuplicates, tokenize, jaccardSimilarity };
