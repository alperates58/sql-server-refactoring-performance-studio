/**
 * SQL Server Refactoring & Performance Studio
 * Master AST Parser Service (Sprint 4)
 *
 * Orchestrates parser adapters with caching and fault isolation.
 */

const crypto = require('crypto');
const tsqlAdapter = require('./adapters/tsqlParserAdapter');
const regexAdapter = require('./adapters/regexFallbackAdapter');

const astCache = new Map();
const MAX_CACHE_SIZE = 2000;

function computeHash(str = '') {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Parses T-SQL into canonical AST with caching and automatic fallback
 */
function parseSql(sql = '', options = {}) {
  const { forceRefresh = false, fallbackToRegex = true } = options;

  if (!sql || typeof sql !== 'string') {
    return regexAdapter.parseWithRegexFallback('', new Error('Boş SQL metni'));
  }

  const hash = computeHash(sql.trim());
  if (!forceRefresh && astCache.has(hash)) {
    return astCache.get(hash);
  }

  let result;
  try {
    result = tsqlAdapter.parseTsql(sql);
    if (result.status === 'AST_FAILED' && fallbackToRegex) {
      result = regexAdapter.parseWithRegexFallback(sql, new Error(result.parseErrors?.[0] || 'AST parse hatası'));
    }
  } catch (err) {
    if (fallbackToRegex) {
      result = regexAdapter.parseWithRegexFallback(sql, err);
    } else {
      throw err;
    }
  }

  // Prevent memory leaks with LRU prune if cache grows large
  if (astCache.size >= MAX_CACHE_SIZE) {
    const firstKey = astCache.keys().next().value;
    astCache.delete(firstKey);
  }

  astCache.set(hash, result);
  return result;
}

function clearAstCache() {
  astCache.clear();
}

function getCacheStats() {
  return {
    cachedEntries: astCache.size,
    maxSize: MAX_CACHE_SIZE
  };
}

module.exports = {
  parseSql,
  clearAstCache,
  getCacheStats,
  computeHash
};
