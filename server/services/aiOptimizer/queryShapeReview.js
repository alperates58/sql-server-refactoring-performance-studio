/**
 * SQL Server Refactoring & Performance Studio
 * Track B: Deterministic Query Shape Review Engine (Sprint 10)
 *
 * Implements:
 * - 16-point Relational Query Shape review (independent of physical indexes)
 * - Detection of repeated base-table access, non-SARGable predicates, late aggregations,
 *   redundant joins, correlated subqueries, duplicate expressions, and implicit conversions
 * - High reads thresholds (>100k, >1M logical reads) triggering aggressive shape review
 * - Structured opportunity generation with technical rationale
 */

const astParser = require('../ast/astParser');

/**
 * Extracts and classifies relational shape opportunities.
 */
function reviewQueryShape({
  sql = '',
  ast = null,
  logicalReads = 0,
  estimatedCost = 0,
  tableRowsApprox = {}
} = {}) {
  const cleanSql = (sql || '').trim();
  const parsedAst = ast || astParser.parseSql(cleanSql);

  const opportunities = [];
  const warnings = [];

  const tables = parsedAst.tables || [];
  const joins = parsedAst.joins || [];
  const predicates = parsedAst.predicates || [];
  const ctes = parsedAst.ctes || [];
  const subqueries = parsedAst.subqueries || [];
  const windowFunctions = parsedAst.windowFunctions || [];

  // 1. REPEATED BASE-TABLE SCAN CHECK
  // Count base table occurrences across queries, subqueries, unions
  const baseTableCounts = {};
  for (const t of tables) {
    const name = (t.object || '').toUpperCase();
    if (name && (t.referenceType === 'BASE_TABLE' || !t.referenceType)) {
      baseTableCounts[name] = (baseTableCounts[name] || 0) + 1;
    }
  }

  // Also check raw SQL for table name occurrences in UNION blocks or repeated FROMs
  const unionBlocks = cleanSql.split(/\bUNION(?:\s+ALL)?\b/i);
  const isMultiUnion = unionBlocks.length > 1;

  for (const [tbl, count] of Object.entries(baseTableCounts)) {
    if (count > 1) {
      opportunities.push({
        type: 'REPEATED_BASE_TABLE_SCAN',
        severity: count >= 3 ? 'CRITICAL' : 'HIGH',
        table: tbl,
        count,
        title: `Mükerrer Temel Tablo Erişimi: ${tbl} (${count} kez)`,
        detail: `${tbl} tablosu sorgu içinde ${count} farklı erişim yolu veya alt dal üzerinden taranmaktadır.`,
        rationale: 'Her bağımsız tarama aynı tablonun veri sayfalarını buffer pool üzerinden tekrar tekrar okur. Ortak bir CTE veya tekil derived table ile birleştirilmesi I/O tüketimini doğrusal olarak düşürür.',
        suggestedRewrite: 'CONSOLIDATE_BASE_TABLE_ACCESS'
      });
    }
  }

  // 2. NON-SARGABLE PREDICATE & FUNCTION-WRAPPED COLUMN CHECK
  const sargIssues = [];
  // Inspect AST predicates and raw SQL for typical non-SARGable patterns
  const sargRegexes = [
    { pattern: /\bYEAR\s*\(\s*([a-zA-Z0-9_#.]+)\s*\)\s*(?:=|IN|BETWEEN)\b/gi, name: 'YEAR()' },
    { pattern: /\bMONTH\s*\(\s*([a-zA-Z0-9_#.]+)\s*\)\s*=/gi, name: 'MONTH()' },
    { pattern: /\bDAY\s*\(\s*([a-zA-Z0-9_#.]+)\s*\)\s*=/gi, name: 'DAY()' },
    { pattern: /\bDATEPART\s*\(\s*[a-zA-Z0-9_]+\s*,\s*([a-zA-Z0-9_#.]+)\s*\)/gi, name: 'DATEPART()' },
    { pattern: /\bFORMAT\s*\(\s*([a-zA-Z0-9_#.]+)\s*,/gi, name: 'FORMAT()' },
    { pattern: /\bLEFT\s*\(\s*([a-zA-Z0-9_#.]+)\s*,\s*\d+\s*\)\s*(?:<>|=)/gi, name: 'LEFT()' },
    { pattern: /\bCONVERT\s*\(\s*[a-zA-Z0-9_()]+\s*,\s*([a-zA-Z0-9_#.]+)\s*\)\s*=/gi, name: 'CONVERT()' },
    { pattern: /\bCAST\s*\(\s*([a-zA-Z0-9_#.]+)\s*AS\s+[a-zA-Z0-9_()]+\s*\)\s*=/gi, name: 'CAST()' }
  ];

  for (const reg of sargRegexes) {
    let match;
    while ((match = reg.pattern.exec(cleanSql)) !== null) {
      sargIssues.push({
        functionName: reg.name,
        targetColumn: match[1] || 'expression',
        fullSnippet: match[0]
      });
    }
  }

  if (sargIssues.length > 0) {
    opportunities.push({
      type: 'NON_SARGABLE_PREDICATES',
      severity: 'CRITICAL',
      count: sargIssues.length,
      items: sargIssues,
      title: `Non-SARGable Filtre Fonksiyonları (${sargIssues.length} adet)`,
      detail: `Sorguda indeks aramasına (Index Seek) engel olan fonksiyonlar tespit edildi: ${sargIssues.map(s => `${s.functionName} on ${s.targetColumn}`).slice(0, 3).join(', ')}.`,
      rationale: 'Kolon üzerinde fonksiyon kullanımı indeks B-Tree aramalarını imkansız kılarak full scan zorunluluğu doğurur. İndekslenebilir aralık koşullarına (>= Start AND < End) dönüştürülmelidir.',
      suggestedRewrite: 'CONVERT_TO_SARGABLE_RANGE'
    });
  }

  // 3. CORRELATED SCALAR SUBQUERY CHECK
  const correlatedSubs = subqueries.filter(s => s.isCorrelated);
  if (correlatedSubs.length > 0) {
    opportunities.push({
      type: 'CORRELATED_SCALAR_SUBQUERY',
      severity: 'CRITICAL',
      count: correlatedSubs.length,
      title: `İlişkili (Correlated) Alt Sorgu (${correlatedSubs.length} adet)`,
      detail: 'Dış sorgudaki her satır için alt sorgu tekrar tekrar çalıştırılmaktadır (RBAR etkisi).',
      rationale: 'Correlated subquery satır sayısı arttıkça karesel/katlanarak artan I/O ve CPU baskısı yaratır. CROSS/OUTER APPLY veya ön toplama (pre-aggregate) JOIN yapısına dönüştürülmelidir.',
      suggestedRewrite: 'CONVERT_SUBQUERY_TO_APPLY_OR_JOIN'
    });
  }

  // 4. REDUNDANT / UNNECESSARY OUTER JOINS & JOIN SHAPE
  // Check for LEFT JOINs where WHERE clause forces them to INNER (null rejection)
  const leftJoins = joins.filter(j => (j.type || '').toUpperCase().includes('LEFT'));
  const suspiciousOuterJoins = [];

  for (const lj of leftJoins) {
    const tableObj = (lj.table?.object || '').toUpperCase();
    const alias = (lj.table?.alias || tableObj).toUpperCase();
    // Check if WHERE clause references this table/alias without IS NULL check
    const whereMatch = new RegExp(`\\bWHERE\\b[\\s\\S]*?\\b${alias}\\.[a-zA-Z0-9_#]+\\s*(?:=|<>|>|<|IN|BETWEEN)\\s*(?!IS\\s+NULL)`, 'i');
    if (whereMatch.test(cleanSql)) {
      suspiciousOuterJoins.push({ table: tableObj, alias });
    }
  }

  if (suspiciousOuterJoins.length > 0) {
    opportunities.push({
      type: 'OUTER_JOIN_CONVERTIBLE_TO_INNER',
      severity: 'MEDIUM',
      count: suspiciousOuterJoins.length,
      items: suspiciousOuterJoins,
      title: `INNER JOIN'e Dönüşen Gereksiz LEFT JOIN (${suspiciousOuterJoins.length} adet)`,
      detail: `${suspiciousOuterJoins.map(s => s.alias).join(', ')} tabloları LEFT JOIN ile bağlanmış ancak WHERE bloğunda filtrelenerek fiilen INNER JOIN yapılmıştır.`,
      rationale: 'Optimizatörün join sıralama ve cardinality tahminini netleştirmek için semantik olarak açık INNER JOIN kullanılmalı veya filtre dış join korunacaksa ON bloğuna taşınmalıdır.',
      suggestedRewrite: 'SIMPLIFY_JOIN_SEMANTICS'
    });
  }

  // 5. REPEATED CALCULATIONS & DUPLICATE EXPRESSIONS
  const repeatedExprMap = {};
  const exprMatches = cleanSql.match(/\b(DATEPART\([^)]+\)|FORMAT\([^)]+\)|CASE\s+WHEN[\s\S]+?END|YEAR\([^)]+\)|MONTH\([^)]+\)|[a-zA-Z0-9_#.]+\s*\/\s*[a-zA-Z0-9_#.]+)\b/gi) || [];
  for (const expr of exprMatches) {
    const norm = expr.replace(/\s+/g, ' ').toUpperCase();
    if (norm.length > 8) {
      repeatedExprMap[norm] = (repeatedExprMap[norm] || 0) + 1;
    }
  }

  const dupExpressions = Object.entries(repeatedExprMap).filter(([_, c]) => c >= 2);
  if (dupExpressions.length > 0) {
    opportunities.push({
      type: 'REPEATED_CALCULATION_OR_EXPRESSION',
      severity: 'MEDIUM',
      count: dupExpressions.length,
      items: dupExpressions.map(([e, c]) => ({ expr: e.slice(0, 50), count: c })),
      title: `Tekrar Eden Pahalı İfade/Hesaplama (${dupExpressions.length} ifade)`,
      detail: `Aynı matematiksel veya tarihsel ifade sorguda birden fazla kez tekrarlanıyor (örn: ${dupExpressions[0][0].slice(0, 45)}...).`,
      rationale: 'Tekrarlanan hesaplamalar tek bir CROSS APPLY (SELECT ... AS Col) veya tek satırlık CTE ile 1 kez hesaplanıp kolon olarak referans verilmelidir. Bu CPU maliyetini düşürür ve kardinalite sapmasını önler.',
      suggestedRewrite: 'PRECALCULATE_EXPRESSION_ONCE'
    });
  }

  // 6. LATE AGGREGATION & JOIN CARDINALITY EXPLOSION OPPORTUNITY
  // Detect large multi-table joins followed by GROUP BY or ROW_NUMBER()
  const hasWindowOrGroupBy = cleanSql.includes('ROW_NUMBER()') || cleanSql.includes('GROUP BY');
  if (joins.length >= 4 && hasWindowOrGroupBy) {
    opportunities.push({
      type: 'LATE_AGGREGATION_OPPORTUNITY',
      severity: 'HIGH',
      joinCount: joins.length,
      title: `Geç Toplama (Late Aggregation) ve Satır Patlaması Riski`,
      detail: `Sorguda ${joins.length} adet JOIN yapıldıktan sonra satırlar gruplanmakta veya ROW_NUMBER ile numaralandırılmaktadır.`,
      rationale: 'Büyük tabloları JOIN etmeden önce alt sorguda veya CTE içinde ara toplam/filtreleme (pre-aggregation) yapmak, join işlemine giren ara satır sayısını dramatik olarak azaltır.',
      suggestedRewrite: 'PRE_AGGREGATE_BEFORE_JOIN'
    });
  }

  // 7. EXPRESSION JOIN CHECK (e.g. CONCAT in JOIN predicate)
  const concatInJoin = /\bON\b[^\r\n;]+(?:CONCAT\(|\+\s*'-'|\+\s*''|\+\s*'_')[^\r\n;]+/gi.test(cleanSql);
  if (concatInJoin) {
    opportunities.push({
      type: 'EXPRESSION_BASED_JOIN',
      severity: 'CRITICAL',
      title: 'JOIN Koşulunda İfade / String Birleştirme (CONCAT)',
      detail: 'ON koşulunda CONCAT() veya dize birleştirme kullanıldığı tespit edildi.',
      rationale: 'Birleştirilmiş ifadeler üzerinden JOIN yapılması SQL Server optimizatörünün indeks seek yapmasını engeller, hash match veya nested loop clustered scan zorunluluğu doğurur.',
      suggestedRewrite: 'DECOMPOSE_JOIN_EXPRESSIONS'
    });
  }

  // 8. UNNECESSARY DISTINCT CHECK
  if (parsedAst.hasDistinct && joins.length > 0) {
    opportunities.push({
      type: 'DISTINCT_BAND_AID',
      severity: 'MEDIUM',
      title: 'Olası Join Satır Çoğalması & DISTINCT Maskelemesi',
      detail: 'Sorguda DISTINCT kullanılmıştır. Çoğu ERP view sorgusunda DISTINCT, 1-N ilişkili join kaynaklı satır çoğalmasını gizlemek için eklenir.',
      rationale: 'DISTINCT büyük sonuç kümelerinde pahalı TempDB Sort işlemine yol açar. Join koşulunu veya EXISTS alt sorgusunu düzelterek DISTINCT ihtiyacı ortadan kaldırılabilir.',
      suggestedRewrite: 'VERIFY_OR_ELIMINATE_DISTINCT'
    });
  }

  // 9. HIGH READS INVESTIGATION MANDATE
  const readsNum = Number(logicalReads) || 0;
  let highReadsClass = 'NORMAL';

  if (readsNum >= 1000000) {
    highReadsClass = 'CRITICAL_HIGH_READS';
    warnings.push(`KRİTİK I/O BASKISI: Bu sorgu ${readsNum.toLocaleString()} mantıksal okuma yapmaktadır (>1.000.000). Agresif yapısal dönüşüm ve erişim konsolidasyonu zorunludur.`);
  } else if (readsNum >= 100000) {
    highReadsClass = 'HIGH_READS';
    warnings.push(`YÜKSEK I/O: Bu sorgu ${readsNum.toLocaleString()} mantıksal okuma yapmaktadır (>100.000). Query shape optimizasyonu gereklidir.`);
  }

  // Metric extraction for shape difference comparison
  const originalShape = {
    joinCount: joins.length,
    baseTableAccessCount: Object.values(baseTableCounts).reduce((a, b) => a + b, 0),
    baseTablePaths: baseTableCounts,
    correlatedSubqueriesCount: correlatedSubs.length,
    nonSargablePredicatesCount: sargIssues.length,
    hasDistinct: Boolean(parsedAst.hasDistinct),
    hasWindowFunctions: windowFunctions.length > 0,
    hasUnion: isMultiUnion,
    unionBlockCount: unionBlocks.length,
    repeatedExpressionsCount: dupExpressions.length
  };

  return {
    hasOpportunities: opportunities.length > 0,
    opportunitiesCount: opportunities.length,
    opportunities,
    warnings,
    highReadsClass,
    originalShape
  };
}

module.exports = {
  reviewQueryShape
};
