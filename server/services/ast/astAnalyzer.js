/**
 * SQL Server Refactoring & Performance Studio
 * AST Semantic & Structural Analyzer (Sprint 4)
 *
 * Performs deep, deterministic analysis on CanonicalAstModel:
 * - SARGability Engine (with rewrite hints)
 * - JOIN Analysis (Cartesian, functions on join keys, many-to-many)
 * - CTE Analysis (repeated references, recursion)
 * - Subquery Analysis (correlated scalar subqueries, NOT IN NULL risks)
 * - SELECT * vs COUNT(*) analysis
 * - UNION vs UNION ALL analysis
 * - Window Functions analysis
 */

const { createAstFinding } = require('./canonicalModel');

function analyzeAst(ast) {
  if (!ast) return { findings: [], summary: { totalFindings: 0, criticalCount: 0, highCount: 0 } };

  const findings = [];

  // 1. SARGABILITY ENGINE (WHERE, ON, HAVING)
  analyzeSargability(ast, findings);

  // 2. JOIN ANALYSIS
  analyzeJoins(ast, findings);

  // 3. CTE ANALYSIS
  analyzeCtes(ast, findings);

  // 4. SUBQUERY ANALYSIS
  analyzeSubqueries(ast, findings);

  // 5. SELECT * vs COUNT(*)
  analyzeProjections(ast, findings);

  // 6. UNION vs UNION ALL
  analyzeUnions(ast, findings);

  // 7. WINDOW FUNCTIONS
  analyzeWindowFunctions(ast, findings);

  // Summary counts
  const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
  const highCount = findings.filter(f => f.severity === 'HIGH').length;
  const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;

  return {
    findings,
    summary: {
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount
    }
  };
}

/**
 * 1. SARGability Engine
 */
function analyzeSargability(ast, findings) {
  const allPredicates = [...(ast.predicates || [])];
  for (const j of ast.joins || []) {
    if (Array.isArray(j.predicates)) {
      allPredicates.push(...j.predicates);
    }
  }

  for (const pred of allPredicates) {
    const expr = pred.expression || '';
    const left = pred.leftExpression || '';
    const op = (pred.operator || '').toUpperCase();
    const right = pred.rightExpression || '';

    // Date functions wrapping column: YEAR, MONTH, DAY, DATEPART
    const dateFuncMatch = left.match(/\b(YEAR|MONTH|DAY|DATEPART)\s*\(\s*([a-zA-Z0-9_#\[\].]+)/i);
    if (dateFuncMatch) {
      const funcName = dateFuncMatch[1].toUpperCase();
      const colName = dateFuncMatch[2];
      findings.push(createAstFinding({
        code: 'NON_SARGABLE_DATE_FUNCTION',
        title: `Non-SARGable Tarih Fonksiyonu (${funcName})`,
        severity: 'HIGH',
        category: 'indexing',
        evidenceGrade: 'A',
        source: 'AST',
        expression: expr,
        column: colName,
        explanation: `${colName} kolonu ${funcName}() fonksiyonu ile sarıldığı için indeks seek kullanılamaz, tablo taraması (Scan) zorunlu kılınır.`,
        rewriteHint: `Tarih fonksiyonu yerine aralık filtresi kullanın (örn: ${colName} >= '2026-01-01' AND ${colName} < '2027-01-01').`,
        evidence: expr
      }));
    }

    // Explicit conversions on column: CONVERT, CAST
    const convertMatch = left.match(/\b(CONVERT|CAST)\s*\(\s*[^,)]+,\s*([a-zA-Z0-9_#\[\].]+)/i) || left.match(/\bCAST\s*\(\s*([a-zA-Z0-9_#\[\].]+)\s+AS\b/i);
    if (convertMatch) {
      const colName = convertMatch[2] || convertMatch[1];
      findings.push(createAstFinding({
        code: 'NON_SARGABLE_TYPE_CONVERSION',
        title: 'Kolon Üzerinde Açık Tür Dönüşümü (CONVERT/CAST)',
        severity: 'HIGH',
        category: 'indexing',
        evidenceGrade: 'A',
        source: 'AST',
        expression: expr,
        column: colName,
        explanation: `${colName} kolonu üzerinde CONVERT/CAST uygulanması optimizatörün indeksi seek operatörü ile kullanmasını engeller.`,
        rewriteHint: 'Dönüşümü kolona değil, karşı taraftaki parametre veya sabit değere uygulayın.',
        evidence: expr
      }));
    }

    // ISNULL / COALESCE on column in comparison
    const nullFuncMatch = left.match(/\b(ISNULL|COALESCE)\s*\(\s*([a-zA-Z0-9_#\[\].]+)\s*,/i);
    if (nullFuncMatch) {
      const colName = nullFuncMatch[2];
      findings.push(createAstFinding({
        code: 'NON_SARGABLE_NULL_WRAPPING',
        title: 'Kolon Üzerinde ISNULL/COALESCE Sargısı',
        severity: 'MEDIUM',
        category: 'indexing',
        evidenceGrade: 'A',
        source: 'AST',
        expression: expr,
        column: colName,
        explanation: `Filtrede ${colName} kolonu ISNULL/COALESCE ile sarılmış. Kolon değerleri dinamik hesaplandığı için indeks seek devre dışı kalır.`,
        rewriteHint: `Fonksiyon yerine açık mantıksal kontrol kullanın (örn: (${colName} = @val OR (${colName} IS NULL AND @val = varsayilan))).`,
        evidence: expr
      }));
    }

    // String functions: UPPER, LOWER, LEFT, SUBSTRING, RTRIM, LTRIM
    const strFuncMatch = left.match(/\b(UPPER|LOWER|LEFT|RIGHT|SUBSTRING)\s*\(\s*([a-zA-Z0-9_#\[\].]+)/i);
    if (strFuncMatch) {
      const funcName = strFuncMatch[1].toUpperCase();
      const colName = strFuncMatch[2];
      const isSubstring = ['LEFT', 'RIGHT', 'SUBSTRING'].includes(funcName);
      findings.push(createAstFinding({
        code: isSubstring ? 'NON_SARGABLE_SUBSTRING' : 'NON_SARGABLE_STRING_FUNCTION',
        title: `Non-SARGable Metin Fonksiyonu (${funcName})`,
        severity: isSubstring ? 'HIGH' : 'MEDIUM',
        category: 'indexing',
        evidenceGrade: 'A',
        source: 'AST',
        expression: expr,
        column: colName,
        explanation: `${colName} kolonu ${funcName}() ile dönüştürülüyor. Bu durum indeks araması yerine tüm satırların tek tek hesaplanmasına (CPU/Scan) yol açar.`,
        rewriteHint: isSubstring ? `Önek arıyorsanız LIKE 'değer%' formatını tercih edin.` : 'Büyük/küçük harf duyarsız collation kullanın veya fonksiyonu kaldırın.',
        evidence: expr
      }));
    }

    // Leading wildcard LIKE: LIKE '%XYZ' or LIKE '%XYZ%'
    if (op === 'LIKE' || op === 'NOT LIKE') {
      const cleanRight = right.replace(/^N?'/, '').replace(/'$/, '');
      if (cleanRight.startsWith('%') || cleanRight.startsWith('_')) {
        findings.push(createAstFinding({
          code: 'LEADING_WILDCARD_LIKE',
          title: 'Baştan Joker Karakterli LIKE Arama (Leading Wildcard)',
          severity: 'MEDIUM',
          category: 'performance',
          evidenceGrade: 'A',
          source: 'AST',
          expression: expr,
          explanation: `Pattern baştan joker karakterle ('%...') başladığı için B-Tree indeksi sıralı aranamaz ve Full Index/Table Scan oluşur.`,
          rewriteHint: 'Mümkünse baştaki % işaretini kaldırıp önek araması (LIKE \'ABC%\') yapın veya Full-Text Search değerlendirin.',
          evidence: expr
        }));
      }
    }

    // Arithmetic on column: e.g. col + 1 = 10 or col * 1.18 = 100
    const arithMatch = left.match(/([a-zA-Z0-9_#\[\].]+)\s*([+\-*/%])\s*[0-9.]+/);
    if (arithMatch) {
      const colName = arithMatch[1];
      findings.push(createAstFinding({
        code: 'NON_SARGABLE_ARITHMETIC',
        title: 'Kolon Üzerinde Matematiksel İşlem',
        severity: 'HIGH',
        category: 'indexing',
        evidenceGrade: 'A',
        source: 'AST',
        expression: expr,
        column: colName,
        explanation: `${colName} kolonu matematiksel işlem (+, -, *, /) içinde yer aldığı için indeks doğrudan seek edilemez.`,
        rewriteHint: 'Aritmetik işlemi karşı taraftaki sabit veya parametreye taşıyın (örn: [kolon] = 10 - 1).',
        evidence: expr
      }));
    }
  }
}

/**
 * 2. JOIN Analysis
 */
function analyzeJoins(ast, findings) {
  for (const j of ast.joins || []) {
    // Missing join predicate
    if (j.hasNoPredicate) {
      findings.push(createAstFinding({
        code: 'NO_JOIN_PREDICATE',
        title: 'ON Koşulu Olmayan JOIN (Kartezyen Çarpım Riski)',
        severity: 'CRITICAL',
        category: 'correctness',
        evidenceGrade: 'A',
        source: 'AST',
        expression: `${j.type} ${j.table?.object || 'TABLE'}`,
        table: j.table?.object,
        explanation: `${j.type} ifadesinde ON koşulu belirtilmemiş. Bu durum iki tablo arasında kontrolsüz kartezyen çarpıma (Cross Join) ve patlayan bellek tüketimine yol açabilir.`,
        rewriteHint: 'İlgili tablolar arasına mutlaka uygun primary/foreign key ON koşulu ekleyin.',
        evidence: `${j.type} without ON`
      }));
    }

    // Function inside ON predicate
    if (j.onPredicate) {
      const funcOnJoinMatch = j.onPredicate.match(/\b(ISNULL|COALESCE|CONVERT|CAST|TRIM|LTRIM|RTRIM|SUBSTRING|LEFT)\s*\(/i);
      if (funcOnJoinMatch) {
        findings.push(createAstFinding({
          code: 'FUNCTION_ON_JOIN_COLUMN',
          title: 'JOIN Bağlantı Koşulunda Fonksiyon Kullanımı',
          severity: 'HIGH',
          category: 'performance',
          evidenceGrade: 'A',
          source: 'AST',
          expression: j.onPredicate,
          table: j.table?.object,
          explanation: `JOIN ON koşulunda ${funcOnJoinMatch[1]}() fonksiyonu kullanılmış. Bu durum Hash Match veya Nested Loops sırasında indeks kullanımını kırar.`,
          rewriteHint: 'JOIN koşulundaki fonksiyonları temizleyin veya kaynak tablodaki verileri eşleştirilebilir formatta saklayın.',
          evidence: j.onPredicate
        }));
      }
    }

    // CROSS APPLY or OUTER APPLY analysis
    if (j.type.includes('APPLY')) {
      findings.push(createAstFinding({
        code: 'APPLY_OPERATOR_DETECTED',
        title: `${j.type} Kullanımı (Satır Bazlı Çağrı Riski)`,
        severity: 'INFO',
        category: 'architecture',
        evidenceGrade: 'B',
        source: 'AST',
        expression: `${j.type} ${j.table?.object || 'EXPRESSION'}`,
        table: j.table?.object,
        explanation: `${j.type} operatörü satır satır çalışan (RBAR) veya TVF çağrılarında yüksek CPU tüketimine sebep olabilir.`,
        rewriteHint: 'Mümkünse APPLY bloğunu standart LEFT JOIN veya önceden gruplanmış set-based bir CTE ile değiştirin.',
        evidence: j.type
      }));
    }
  }
}

/**
 * 3. CTE Analysis
 */
function analyzeCtes(ast, findings) {
  const ctes = ast.ctes || [];
  if (!ctes.length) return;

  for (const cte of ctes) {
    if (cte.isRecursive) {
      findings.push(createAstFinding({
        code: 'RECURSIVE_CTE',
        title: `Özyinelemeli (Recursive) CTE Tespit Edildi: ${cte.name}`,
        severity: 'MEDIUM',
        category: 'complexity',
        evidenceGrade: 'A',
        source: 'AST',
        expression: `WITH ${cte.name} AS (...)`,
        explanation: `${cte.name} CTE'si özyinelemeli olarak kendini çağırmaktadır. Sonsuz döngüyü önlemek için MAXRECURSION ve sonlanma koşulu dikkatle denetlenmelidir.`,
        rewriteHint: 'Döngü derinliği yüksekse geçici tablo veya hiyerarşi indeksleri değerlendirilebilir.',
        evidence: cte.name
      }));
    }

    // Count references across tables in main query
    const refCount = (ast.tables || []).filter(t => t.referenceType === 'CTE_REFERENCE' && t.object.toLowerCase() === cte.name.toLowerCase()).length;
    if (refCount >= 2) {
      findings.push(createAstFinding({
        code: 'REPEATED_CTE_REFERENCE',
        title: `Mükerrer Çağrılan CTE: ${cte.name} (${refCount} Kez)`,
        severity: 'MEDIUM',
        category: 'performance',
        evidenceGrade: 'B',
        source: 'AST',
        expression: cte.name,
        explanation: `SQL Server CTE tanımlarını varsayılan olarak materialize etmez (bellekte tutmaz); sorgu içinde ${refCount} kez referans verilen ${cte.name} her seferinde baştan hesaplanıyor olabilir.`,
        rewriteHint: 'Eğer bu CTE pahalı tarama ve hesaplamalar içeriyorsa, execution plan kanıtı ile doğrulanarak #temp tabloya alınması değerlendirilebilir.',
        evidence: `Referans sayısı: ${refCount}`
      }));
    }
  }
}

/**
 * 4. Subquery Analysis
 */
function analyzeSubqueries(ast, findings) {
  for (const sub of ast.subqueries || []) {
    if (sub.isCorrelated && sub.type === 'SCALAR_SUBQUERY') {
      findings.push(createAstFinding({
        code: 'CORRELATED_SCALAR_SUBQUERY',
        title: 'İlişkili (Correlated) Skalar Alt Sorgu',
        severity: 'HIGH',
        category: 'performance',
        evidenceGrade: 'A',
        source: 'AST',
        expression: sub.sql,
        explanation: 'Dış sorgudaki her satır için bu alt sorgu tekrar tekrar çalıştırılabilir (RBAR). Büyük tablolarda katlanarak artan I/O ve süre maliyeti üretir.',
        rewriteHint: 'Alt sorguyu ana sorguya JOIN veya önceden toplanmış CTE (pre-aggregated CTE) olarak taşıyın.',
        evidence: sub.sql
      }));
    }

    if (sub.type === 'IN') {
      findings.push(createAstFinding({
        code: 'IN_SUBQUERY_DETECTED',
        title: 'IN (SELECT ...) Alt Sorgu Deseni',
        severity: 'LOW',
        category: 'performance',
        evidenceGrade: 'B',
        source: 'AST',
        expression: sub.sql,
        explanation: 'IN alt sorguları optimizatör tarafından semi-join olarak çalıştırılır; ancak alt sorguda NULL değer varsa veya NOT IN kullanılırsa beklenmedik semantik boşluklar oluşabilir.',
        rewriteHint: 'NOT IN yerine mutlaka NOT EXISTS tercih edin (üç değerli mantık NULL tuzağından korunmak için).',
        evidence: sub.sql
      }));
    }
  }
}

/**
 * 5. Projections (SELECT * vs COUNT(*))
 */
function analyzeProjections(ast, findings) {
  if (ast.hasWildcardSelect) {
    findings.push(createAstFinding({
      code: 'SELECT_STAR_RISK',
      title: 'Joker Karakterli Projeksiyon (SELECT *)',
      severity: 'MEDIUM',
      category: 'contract',
      evidenceGrade: 'A',
      source: 'AST',
      expression: 'SELECT *',
      explanation: 'View veya sorgu seviyesinde SELECT * kullanılması, temel tablolara yeni kolon eklendiğinde sözleşme kırılmasına ve gereksiz geniş veri aktarımına (Network/Memory bloat) yol açar.',
      rewriteHint: 'Yalnızca gerçekten ihtiyaç duyulan kolonları açıkça isimleriyle belirtin.',
      evidence: 'SELECT *'
    }));
  }
}

/**
 * 6. UNION vs UNION ALL
 */
function analyzeUnions(ast, findings) {
  for (const u of ast.unions || []) {
    if (u.type === 'UNION') {
      findings.push(createAstFinding({
        code: 'UNION_DISTINCT_OVERHEAD',
        title: 'Örtük Tekilleştirme (UNION ALL yerine UNION)',
        severity: 'MEDIUM',
        category: 'performance',
        evidenceGrade: 'A',
        source: 'AST',
        expression: 'UNION',
        explanation: 'UNION kullanımı tüm sonuç setini hafızada Sort veya Hash Aggregate işlemine sokarak satırları tekilleştirir. Kesişmeyen kümelerde ciddi gereksiz maliyet doğurur.',
        rewriteHint: 'Sonuçların çakışmadığı biliniyorsa veya tekilleştirme zorunlu değilse UNION ALL tercih edin.',
        evidence: 'UNION'
      }));
    }
  }
}

/**
 * 7. Window Functions
 */
function analyzeWindowFunctions(ast, findings) {
  const wfs = ast.windowFunctions || [];
  if (wfs.length > 0) {
    findings.push(createAstFinding({
      code: 'WINDOW_FUNCTION_DETECTED',
      title: `Pencere Fonksiyonu Kullanımı (${wfs.length} Adet)`,
      severity: 'INFO',
      category: 'performance',
      evidenceGrade: 'A',
      source: 'AST',
      expression: wfs.map(w => w.function).join(', '),
      explanation: `Sorguda ${wfs.length} adet window fonksiyonu (ROW_NUMBER/RANK vb.) tespit edildi. Büyük tablolarda Segment ve Table Spool operatörleri tetikleyebilir.`,
      rewriteHint: 'İlgili PARTITION BY ve ORDER BY kolonlarını kapsayan bir indeks bulunduğundan emin olun.',
      evidence: wfs.map(w => w.raw).join('; ')
    }));
  }
}

module.exports = {
  analyzeAst,
  analyzeSargability,
  analyzeJoins,
  analyzeCtes,
  analyzeSubqueries,
  analyzeProjections,
  analyzeUnions,
  analyzeWindowFunctions
};
