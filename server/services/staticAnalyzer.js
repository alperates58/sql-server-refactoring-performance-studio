/**
 * Static SQL Analyzer (V1 Heuristics)
 *
 * Scans T-SQL view definitions for structural risk patterns.
 * In accordance with AGENTS.md and docs/04-SQL-ANALYSIS.md:
 * Patterns are categorized as HEURISTICS or SIGNALS, not confirmed bugs.
 */

function stripCommentsAndLiterals(sql = '') {
  // Remove block comments /* ... */
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove line comments -- ...
  cleaned = cleaned.replace(/--.*$/gm, ' ');
  return cleaned;
}

function analyzeStaticSql(definition = '') {
  const cleanSql = stripCommentsAndLiterals(definition);
  const upper = cleanSql.toUpperCase();

  const findings = [];
  const signals = {
    hasDistinct: false,
    hasUnionWithoutAll: false,
    hasWindowFunctions: false,
    windowFunctionCount: 0,
    nonSargableCount: 0,
    scalarUdfCount: 0,
    hasWildcardSelect: false,
    hasLeadingWildcardLike: false,
    hasApply: false,
    hasOrInPredicate: false,
    lineCount: definition.split('\n').length
  };

  // 1. SELECT DISTINCT
  // Notice: DISTINCT is often used to mask accidental cartesian products in joins
  const distinctMatch = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?DISTINCT\b/i.test(cleanSql);
  if (distinctMatch) {
    signals.hasDistinct = true;
    findings.push({
      code: 'DISTINCT_USAGE',
      title: 'SELECT DISTINCT pattern detected',
      severity: 'WARNING',
      healthPenalty: 5,
      symbol: '⌘',
      category: 'redundancy',
      evidenceGrade: 'D',
      explanation: 'SELECT DISTINCT heuristiği tespit edildi. Bu pattern sıklıkla JOIN kaynaklı çoklama satırlarını gizlemek için kullanılır; meşru tekilleştirme olup olmadığını kontrol edin.'
    });
  }

  // 2. UNION without ALL
  // Notice: UNION without ALL triggers sort and distinct operations
  const unionWithoutAllMatch = /\bUNION\s+(?!ALL\b)/i.test(cleanSql);
  if (unionWithoutAllMatch) {
    signals.hasUnionWithoutAll = true;
    findings.push({
      code: 'UNION_WITHOUT_ALL',
      title: 'UNION without ALL',
      severity: 'WARNING',
      healthPenalty: 6,
      symbol: '∪',
      category: 'performance',
      evidenceGrade: 'D',
      explanation: 'UNION (ALL olmadan) örtük sıralama ve tekilleştirme maliyeti üretir. Kayıtların kesişmediği biliniyorsa UNION ALL tercih edilmelidir.'
    });
  }

  // 3. Window functions (ROW_NUMBER, RANK, DENSE_RANK)
  // Notice: Context-dependent, NOT inherently bad
  const windowMatches = cleanSql.match(/\b(ROW_NUMBER|RANK|DENSE_RANK)\s*\(\s*\)\s*OVER\s*\(/gi) || [];
  if (windowMatches.length > 0) {
    signals.hasWindowFunctions = true;
    signals.windowFunctionCount = windowMatches.length;
    findings.push({
      code: 'WINDOW_FUNCTIONS',
      title: 'Window function usage',
      severity: 'INFO',
      healthPenalty: 4,
      symbol: '∿',
      category: 'complexity',
      evidenceGrade: 'D',
      explanation: `Tanımda ${windowMatches.length} adet window function (ROW_NUMBER/RANK) tespit edildi. Bu fonksiyonlar tek başına hata değildir; ancak büyük veri setlerinde spool ve sort maliyeti doğurabilir.`
    });
  }

  // 4. Non-SARGable expressions around predicates (WHERE / ON / HAVING)
  // Searching specifically inside WHERE, ON, HAVING clauses for functions around columns
  const predicateRegex = /(?:WHERE|ON|HAVING)\s+([\s\S]*?)(?:GROUP\s+BY|ORDER\s+BY|HAVING|$)/gi;
  let nonSargableCount = 0;
  const nonSargableExamples = [];
  let predMatch;

  while ((predMatch = predicateRegex.exec(cleanSql)) !== null) {
    const clauseText = predMatch[1];
    const funcRegex = /\b(CONVERT|CAST|ISNULL|COALESCE|DATEADD|DATEDIFF|LEFT|RIGHT|SUBSTRING|YEAR|MONTH|DAY)\s*\(\s*[^,)]+/gi;
    const found = clauseText.match(funcRegex) || [];
    nonSargableCount += found.length;
    if (nonSargableExamples.length < 3) {
      nonSargableExamples.push(...found.slice(0, 3 - nonSargableExamples.length));
    }
  }

  if (nonSargableCount > 0) {
    signals.nonSargableCount = nonSargableCount;
    const penalty = Math.min(12, nonSargableCount * 4);
    findings.push({
      code: 'NON_SARGABLE_EXPRESSION',
      title: 'Non-SARGable predicate expressions',
      severity: nonSargableCount >= 3 ? 'HIGH' : 'WARNING',
      healthPenalty: penalty,
      symbol: 'ƒ',
      category: 'indexing',
      evidenceGrade: 'D',
      explanation: `Filtre veya JOIN koşullarında ${nonSargableCount} adet non-SARGable fonksiyon çağrısı (${nonSargableExamples.join(', ')}) tespit edildi. Bu ifadeler indeks seek yerine indeks/tablo scan'e yol açabilir.`
    });
  }

  // 5. Scalar UDF calls (dbo.fn_*)
  const udfMatches = cleanSql.match(/\b(?:dbo|sys|guest)\.[a-zA-Z0-9_]*fn[a-zA-Z0-9_]*\s*\(/gi) ||
                     cleanSql.match(/\b(?:dbo)\.[a-zA-Z0-9_]+\s*\(/gi) || [];
  // Filter out common system keywords that might look like dbo.
  const filteredUdfs = udfMatches.filter(m => !/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(m));
  if (filteredUdfs.length > 0) {
    signals.scalarUdfCount = filteredUdfs.length;
    const penalty = Math.min(10, filteredUdfs.length * 5);
    findings.push({
      code: 'SCALAR_UDF',
      title: 'Scalar UDF call detected',
      severity: 'HIGH',
      healthPenalty: penalty,
      symbol: 'λ',
      category: 'rbar',
      evidenceGrade: 'D',
      explanation: `Tanımda ${filteredUdfs.length} adet skalar kullanıcı tanımlı fonksiyon (UDF) çağrısı bulundu (${filteredUdfs.slice(0, 2).join(', ')}). Skalar UDF'ler satır bazlı (RBAR) çalıştırma döngüsü başlatabilir.`
    });
  }

  // 6. SELECT * (Wildcard)
  const wildcardMatch = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?(?:\w+\.)?\*/i.test(cleanSql);
  if (wildcardMatch) {
    signals.hasWildcardSelect = true;
    findings.push({
      code: 'WILDCARD_SELECT',
      title: 'Wildcard SELECT * detected',
      severity: 'WARNING',
      healthPenalty: 3,
      symbol: '*',
      category: 'design',
      evidenceGrade: 'D',
      explanation: 'View tanımında SELECT * kullanımı tespit edildi. Şema değişikliklerine karşı kırılgandır ve sütun eleme (projection pruning) optimizasyonunu kısıtlar.'
    });
  }

  // 7. Leading Wildcard LIKE '%...'
  const leadingWildcardMatch = /\bLIKE\s+N?'%[^']/i.test(cleanSql);
  if (leadingWildcardMatch) {
    signals.hasLeadingWildcardLike = true;
    findings.push({
      code: 'LEADING_WILDCARD_LIKE',
      title: 'Leading wildcard in LIKE predicate',
      severity: 'WARNING',
      healthPenalty: 4,
      symbol: '%',
      category: 'indexing',
      evidenceGrade: 'D',
      explanation: "LIKE '%değer' araması B-Tree indeks seek işlemini engeller ve tam tablo taramasına neden olur."
    });
  }

  // 8. APPLY operators (CROSS APPLY, OUTER APPLY)
  const applyMatches = cleanSql.match(/\b(CROSS|OUTER)\s+APPLY\b/gi) || [];
  if (applyMatches.length > 0) {
    signals.hasApply = true;
    findings.push({
      code: 'APPLY_OPERATOR',
      title: 'APPLY operator detected',
      severity: 'INFO',
      healthPenalty: 2,
      symbol: '⋈',
      category: 'complexity',
      evidenceGrade: 'D',
      explanation: `${applyMatches.length} adet CROSS/OUTER APPLY tespit edildi. Satır bazlı tablo değerli fonksiyon veya korelasyonlu alt sorgu genişletmesi yapıldığını gösterir.`
    });
  }

  return { signals, findings };
}

module.exports = { analyzeStaticSql, stripCommentsAndLiterals };
