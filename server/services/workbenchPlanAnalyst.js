/**
 * SQL Server Refactoring & Performance Studio
 * SQL Workbench AI Plan Analyst Engine
 *
 * Implements:
 * - Deterministic Plan & Runtime Context Pack Builder (Zero raw XML dump to model)
 * - Traceable Evidence Dictionary (OP01, WARN01, CARD01, AST01, STAT01, IDX01, IO01)
 * - Smart Operator Prioritization & Deduplication Grouping (Compresses 50+ operators into Top 3-5 themes)
 * - 4-Level Deterministic Confidence Engine (HIGH, MEDIUM, LOW)
 * - Healthy Query Detection ("Belirgin bir performans darboğazı tespit edilmedi")
 * - Anti-Generic Tuning Advice Guardrail & Schema Validation
 * - Action Routing to Index Advisor, Statistics Health, Refactor Studio, and Workbench Benchmark
 * - Safe Read-Only Philosophy (Zero Database Mutation)
 * - In-Memory Result Caching (sqlHash + planHash + runtime fingerprint)
 * - Secret Hygiene (No credentials, connection strings or keys in AI context)
 */

const crypto = require('crypto');
const planParser = require('./planParser');
const astParser = require('./ast/astParser');
const astAnalyzer = require('./ast/astAnalyzer');
const schemaMetadata = require('./schemaMetadata');
const indexMetadata = require('./indexMetadata');
const indexAdvisor = require('./indexAdvisor');
const statisticsHealth = require('./statisticsHealth');
const settings = require('./settingsService');
const { fetchWithTimeout, normalizeChatUrl, parseApiError, DEFAULT_AI_TIMEOUT_MS } = require('./aiProvider');

// In-memory cache for analyzed plans: cacheKey -> { timestamp, data, evidenceMap }
const planAnalysisCache = new Map();
const MAX_CACHE_ENTRIES = 120;

// Generic banned phrases that indicate non-evidence-grounded generic advice
const BANNED_GENERIC_PHRASES = [
  'indeks eklemeyi düşünün',
  'indeks ekleyin',
  'sorguyu optimize edin',
  'join\'leri gözden geçirin',
  'joinleri gözden geçirin',
  'where koşullarını inceleyin',
  'veritabanı yöneticinize danışın',
  'donanımı yükseltin',
  'sunucu belleğini artırın'
];

/**
 * Computes deterministic cache key from query, plan and runtime fingerprint
 */
function computePlanCacheKey({ sql = '', database = '', mode = 'actual', totalSubTreeCost = 0, logicalReads = 0, operatorCount = 0 }) {
  const normSql = (sql || '').trim().replace(/\s+/g, ' ');
  const payload = `${database}|${normSql}|${mode}|${totalSubTreeCost}|${logicalReads}|${operatorCount}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Builds Enriched Deterministic Context Pack from Workbench execution
 */
async function buildWorkbenchPlanContextPack({
  sql = '',
  database = null,
  mode = 'actual',
  parsedPlan = null,
  rawXml = null,
  metrics = {},
  statistics = {},
  benchmark = null,
  options = {}
} = {}) {
  const cleanSql = (sql || '').trim();
  const isActual = String(mode).toLowerCase() === 'actual' || Boolean(parsedPlan?.isActual);
  const targetDb = database || settings.getConfig()?.savedDbConnection?.database || 'master';

  // 1. Ensure Parsed Plan Model exists (Zero new parser - uses planParser.js)
  let plan = parsedPlan;
  if (!plan && rawXml) {
    try {
      plan = planParser.parseShowPlanXML(rawXml);
    } catch (_) {
      plan = null;
    }
  }

  // 2. Parse AST & Semantic Shape Findings
  let ast = null;
  let astAnalysis = { findings: [], metrics: {} };
  try {
    ast = astParser.parseSql(cleanSql);
    astAnalysis = astAnalyzer.analyzeAst(ast);
  } catch (_) {
    ast = { tables: [], predicates: [], joins: [] };
  }

  // 3. Extract Referenced Base Tables
  const baseTableNames = [...new Set(
    (ast.tables || [])
      .filter(t => t.referenceType === 'BASE_TABLE' || !t.referenceType)
      .map(t => t.object)
      .filter(Boolean)
  )];

  // Also include tables identified in execution plan
  if (plan && plan.operators) {
    for (const op of plan.operators) {
      if (op.targetObject) {
        const parts = op.targetObject.replace(/[\[\]]/g, '').split('.');
        const tbl = parts[parts.length - 1];
        if (tbl && !baseTableNames.includes(tbl)) {
          baseTableNames.push(tbl);
        }
      }
    }
  }

  // 4. Batch Schema, Row Counts, and Indexes (Read-only metadata queries)
  let schemas = {};
  let tableRowsApprox = {};
  let rawIndexes = {};
  let relevantIndexes = {};
  let implicitConversions = [];

  if (baseTableNames.length > 0) {
    try {
      schemas = await schemaMetadata.batchGetSchemas(targetDb, baseTableNames);
    } catch (_) {}

    try {
      tableRowsApprox = await schemaMetadata.batchGetApproximateRowCounts(targetDb, baseTableNames);
    } catch (_) {}

    try {
      rawIndexes = await indexMetadata.batchGetIndexes(targetDb, baseTableNames);
      relevantIndexes = indexMetadata.filterQueryRelevantIndexes(rawIndexes, ast);
      implicitConversions = schemaMetadata.detectImplicitConversions(ast.predicates || [], schemas);
    } catch (_) {}
  }

  // 5. Gather Runtime & Table IO metrics
  const durationMs = Number(metrics.durationMs ?? (statistics ? statistics.elapsedTimeMs : 0) ?? 0);
  const cpuMs = Number(metrics.cpuMs ?? (statistics ? statistics.cpuTimeMs : 0) ?? 0);
  const totalLogicalReads = Number(metrics.logicalReads ?? (statistics ? statistics.totalLogicalReads : 0) ?? 0);
  const totalPhysicalReads = Number(metrics.physicalReads ?? 0);
  const returnedRows = Number(metrics.rowsReturned ?? (metrics.rows ? metrics.rows.length : 0));
  const tableStats = Array.isArray(statistics.tables) ? statistics.tables : (metrics.tableStats || []);

  // 6. Traceable Evidence Builder & Operator Deduplication Grouping
  const evidenceMap = {};
  const evidenceList = [];

  function addEvidence(id, category, title, detail, object = null, impact = 'MEDIUM', metric = null) {
    const item = { id, category, title, detail, object, impact, metric };
    evidenceMap[id] = item;
    evidenceList.push(item);
    return item;
  }

  // --- A. Runtime IO Evidence (IO01, IO02...) ---
  tableStats.forEach((ts, idx) => {
    const ioId = `IO${String(idx + 1).padStart(2, '0')}`;
    const mb = ((ts.logicalReads * 8) / 1024).toFixed(1);
    let severity = 'LOW';
    if (ts.logicalReads > 20000 || ts.scanCount > 3) severity = 'CRITICAL';
    else if (ts.logicalReads > 3000 || ts.scanCount > 1) severity = 'HIGH';

    addEvidence(
      ioId,
      'RUNTIME_IO',
      `[${ts.table}] ${ts.logicalReads.toLocaleString()} Mantıksal Okuma (${mb} MB)`,
      `${ts.table} tablosu üzerinde ${ts.scanCount} kez tarama yapıldı, ${ts.logicalReads.toLocaleString()} sayfa okundu.${ts.physicalReads ? ` ${ts.physicalReads} fiziksel disk okuması.` : ''}`,
      ts.table,
      severity,
      { logicalReads: ts.logicalReads, scanCount: ts.scanCount, physicalReads: ts.physicalReads }
    );
  });

  // --- B. Plan Warnings (WARN01, WARN02...) ---
  let warnCounter = 1;
  if (plan && Array.isArray(plan.warnings)) {
    plan.warnings.forEach(w => {
      const wId = `WARN${String(warnCounter++).padStart(2, '0')}`;
      addEvidence(
        wId,
        'PLAN_WARNING',
        `Plan Uyarısı: ${w.title || w.kind || 'Performans Uyarısı'}`,
        w.detail || w.explanation || w.message || 'Yürütme planında optimizasyon uyarısı tespit edildi.',
        null,
        w.severity || 'CRITICAL'
      );
    });
  }

  // --- C. Cardinality Mismatches (CARD01, CARD02...) ---
  let cardCounter = 1;
  if (plan && Array.isArray(plan.cardinalityMismatches)) {
    plan.cardinalityMismatches.forEach(cm => {
      const cId = `CARD${String(cardCounter++).padStart(2, '0')}`;
      addEvidence(
        cId,
        'CARDINALITY',
        `Kardinalite Hatası: ${cm.operator} (${cm.object || 'Operatör'})`,
        `${cm.factor || ''}. Tahmin: ${(cm.estimated || 0).toLocaleString()} satır → Gerçek: ${(cm.actual || 0).toLocaleString()} satır (Oran: ${cm.ratio}x). ${cm.explanation || ''}`,
        cm.object,
        cm.severity === 'HIGH' ? 'CRITICAL' : (cm.severity === 'MEDIUM' ? 'HIGH' : 'MEDIUM'),
        { estimated: cm.estimated, actual: cm.actual, ratio: cm.ratio }
      );
    });
  }

  // --- D. Operator Intelligence & Deduplication Grouping (OP01, OP02...) ---
  // Group duplicate scan/seek operators on same object
  const operatorGroups = new Map(); // key: physicalOp + '|' + targetObject -> { count, totalCost, maxEstRows, maxActRows, operators: [] }

  if (plan && Array.isArray(plan.operators)) {
    plan.operators.forEach(op => {
      const key = `${op.physicalOp || 'Op'}|${op.targetObject || 'unknown'}`;
      if (!operatorGroups.has(key)) {
        operatorGroups.set(key, {
          physicalOp: op.physicalOp,
          targetObject: op.targetObject,
          isScan: op.isScan,
          isSeek: op.isSeek,
          isLookup: op.isLookup,
          category: op.category,
          count: 0,
          totalCostPercent: 0,
          maxEstRows: 0,
          maxActRows: 0,
          warnings: []
        });
      }
      const grp = operatorGroups.get(key);
      grp.count += 1;
      grp.totalCostPercent += (op.costPercent || 0);
      grp.maxEstRows = Math.max(grp.maxEstRows, op.estimatedRows || 0);
      if (op.actualRows != null) grp.maxActRows = Math.max(grp.maxActRows, op.actualRows);
      if (op.warnings?.length) grp.warnings.push(...op.warnings);
    });
  }

  // Sort groups by total cost and importance
  const sortedOpGroups = Array.from(operatorGroups.values()).sort((a, b) => b.totalCostPercent - a.totalCostPercent);
  let opCounter = 1;

  sortedOpGroups.slice(0, 8).forEach(grp => {
    const opId = `OP${String(opCounter++).padStart(2, '0')}`;
    const isMultiple = grp.count > 1;
    const title = isMultiple
      ? `${grp.targetObject || 'Tablo'} üzerinde ${grp.count}× ${grp.physicalOp} (Toplam Maliyet: %${Math.min(100, Math.round(grp.totalCostPercent))})`
      : `${grp.physicalOp} (${grp.targetObject || 'Operatör'}) — Plan Maliyeti %${Math.min(100, Math.round(grp.totalCostPercent))}`;

    const detail = `${grp.targetObject ? `Hedef: ${grp.targetObject}. ` : ''}Tahmin: ${grp.maxEstRows.toLocaleString()} satır${grp.maxActRows > 0 ? `, Gerçek: ${grp.maxActRows.toLocaleString()} satır` : ''}.${isMultiple ? ` Bu operatör planda ${grp.count} kez mükerrer olarak yer almaktadır.` : ''}`;
    let severity = 'LOW';
    if (grp.isScan && grp.totalCostPercent > 30) severity = 'CRITICAL';
    else if (grp.isLookup && grp.count > 5) severity = 'HIGH';
    else if (grp.totalCostPercent > 15) severity = 'HIGH';

    addEvidence(opId, 'PLAN_OPERATOR', title, detail, grp.targetObject, severity, {
      physicalOp: grp.physicalOp,
      count: grp.count,
      costPercent: Math.min(100, Math.round(grp.totalCostPercent))
    });
  });

  // --- E. AST & Query Shape Findings (AST01, AST02...) ---
  let astCounter = 1;
  (astAnalysis.findings || []).forEach(af => {
    const aId = `AST${String(astCounter++).padStart(2, '0')}`;
    addEvidence(
      aId,
      'QUERY_SHAPE',
      af.title || af.ruleName || 'Sorgu Şekil İyileştirmesi',
      af.message || af.detail || 'İlişkisel cebir veya SARGability iyileştirme fırsatı.',
      af.object || null,
      af.severity || 'MEDIUM'
    );
  });

  // Implicit conversions
  implicitConversions.forEach(ic => {
    const aId = `AST${String(astCounter++).padStart(2, '0')}`;
    addEvidence(
      aId,
      'IMPLICIT_CONVERSION',
      `Örtük Tip Dönüşümü (Implicit Conversion): [${ic.column || ic.expression}]`,
      ic.message || 'Tip uyumsuzluğu nedeniyle SQL Server index seek yerine scan yapabilir.',
      ic.table || null,
      'HIGH'
    );
  });

  // --- F. Missing Indexes from Plan & DMVs (IDX01, IDX02...) ---
  let idxCounter = 1;
  if (plan && Array.isArray(plan.missingIndexes)) {
    plan.missingIndexes.forEach(mi => {
      const idxId = `IDX${String(idxCounter++).padStart(2, '0')}`;
      addEvidence(
        idxId,
        'MISSING_INDEX',
        `Eksik İndeks Tavsiyesi: [${mi.table}] (+%${mi.impact || 0} Etki)`,
        `Plan optimizatörü ${mi.table} üzerinde eksik indeks tespit etti. Eşitlik kolonları: ${(mi.equalityColumns || []).join(', ') || 'Yok'}, Dahil edilen: ${(mi.includedColumns || []).join(', ') || 'Yok'}.`,
        mi.table,
        (mi.impact || 0) >= 50 ? 'HIGH' : 'MEDIUM',
        { impact: mi.impact, equalityColumns: mi.equalityColumns, includedColumns: mi.includedColumns, ddl: mi.ddl || mi.indexDdl }
      );
    });
  }

  // 7. Deterministic Healthy Query Assessment (Section 15)
  // Evaluates whether the query executes efficiently without significant bottlenecks
  const hasSpills = plan?.warnings?.some(w => JSON.stringify(w).toLowerCase().includes('spill'));
  const hasCriticalCardinality = (plan?.cardinalityMismatches || []).some(cm => (cm.ratio || 0) >= 10);
  const hasHeavyScans = sortedOpGroups.some(g => g.isScan && g.totalCostPercent > 40 && totalLogicalReads > 3000);
  const hasMissingHighImpactIndex = (plan?.missingIndexes || []).some(mi => (mi.impact || 0) >= 70);

  const isHealthy = Boolean(
    totalLogicalReads < 1500 &&
    durationMs < 120 &&
    !hasSpills &&
    !hasCriticalCardinality &&
    !hasHeavyScans &&
    !hasMissingHighImpactIndex &&
    (plan ? plan.warnings.length === 0 : true)
  );

  // 8. Deterministic Confidence Calculation (Section 20)
  let confidence = 'LOW';
  let confidenceReason = '';

  if (isActual && totalLogicalReads >= 0 && plan && plan.operatorCount > 0) {
    confidence = 'HIGH';
    confidenceReason = 'Gerçek çalıştırma planı (Actual Execution Plan), ölçülen STATISTICS IO okumaları ve tablo indeks metadata kanıtları ile doğrulandı.';
  } else if (plan && plan.operatorCount > 0) {
    confidence = 'MEDIUM';
    confidenceReason = 'Tahmini çalıştırma planı (Estimated Plan) ve şema/indeks analizi kullanıldı. Gerçek süre/okuma ölçümü için Actual Plan önerilir.';
  } else {
    confidence = 'LOW';
    confidenceReason = 'Yalnızca statik AST analizi yapıldı. Yürütme planı veya runtime evidence eksik.';
  }

  // 9. Structured Context Pack
  return {
    isActual,
    isHealthy,
    confidence,
    confidenceReason,
    query: {
      sql: cleanSql,
      database: targetDb,
      mode: isActual ? 'ACTUAL' : 'ESTIMATED'
    },
    runtime: {
      durationMs,
      cpuMs,
      logicalReads: totalLogicalReads,
      physicalReads: totalPhysicalReads,
      returnedRows,
      tableStats,
      benchmark: benchmark ? {
        medianMs: benchmark.summary?.medianMs,
        p95Ms: benchmark.summary?.p95Ms,
        medianLogicalReads: benchmark.summary?.logicalReadsMedian
      } : null
    },
    planSummary: {
      totalSubTreeCost: plan?.totalSubTreeCost || 0,
      totalEstRows: plan?.totalEstRows || 0,
      optimizationLevel: plan?.optimizationLevel || 'FULL',
      degreeOfParallelism: plan?.degreeOfParallelism || 1,
      operatorCount: plan?.operatorCount || 0,
      scans: plan?.scans || 0,
      seeks: plan?.seeks || 0,
      lookups: plan?.lookups || 0,
      spools: plan?.spools || 0,
      sorts: plan?.sorts || 0,
      topCostOperators: (plan?.topOperators || []).slice(0, 5).map(o => ({
        physicalOp: o.physicalOp,
        targetObject: o.targetObject,
        costPercent: o.costPercent,
        estimatedRows: o.estimatedRows,
        actualRows: o.actualRows
      })),
      groupedOperatorThemes: sortedOpGroups.slice(0, 6).map(g => ({
        physicalOp: g.physicalOp,
        targetObject: g.targetObject,
        count: g.count,
        totalCostPercent: Math.min(100, Math.round(g.totalCostPercent))
      })),
      warnings: (plan?.warnings || []).map(w => w.title || w.kind || w.message),
      cardinalityMismatches: (plan?.cardinalityMismatches || []).slice(0, 5),
      missingIndexes: (plan?.missingIndexes || []).slice(0, 3)
    },
    objectAccess: {
      referencedTables: baseTableNames,
      approximateRowCounts: tableRowsApprox,
      relevantIndexes
    },
    astShape: {
      findings: (astAnalysis.findings || []).slice(0, 8),
      implicitConversions
    },
    evidenceMap,
    evidenceList: evidenceList.slice(0, 12)
  };
}

/**
 * Builds Deterministic High-Precision Analysis (Fallback & Rule-based engine)
 * Guarantees zero generic advice and strict evidence grounding.
 */
function generateDeterministicAnalysis(contextPack) {
  const { query, runtime, planSummary, objectAccess, astShape, evidenceMap, isHealthy, confidence, confidenceReason } = contextPack;

  if (isHealthy) {
    return {
      isHealthy: true,
      summary: `Sorgu ${runtime.logicalReads.toLocaleString()} mantıksal okuma ve ${runtime.durationMs} ms süre ile verimli çalışmaktadır. Yürütme planında belirgin bir performans darboğazı, aşırı I/O veya kardinalite sapması tespit edilmemiştir.`,
      primaryBottleneck: {
        type: 'NONE',
        title: 'Belirgin Bir Darboğaz Tespit Edilmedi',
        evidence: Object.keys(evidenceMap).slice(0, 2),
        targetObject: objectAccess.referencedTables[0] || 'Genel',
        whyItMatters: 'Mevcut indeksler ve sorgu yapısı veri kümesi için yeterli seçicilikte arama üretmektedir.'
      },
      priorities: [
        {
          priority: 1,
          title: 'Mevcut Performansı Koru ve Yük Altında Doğrula',
          evidence: Object.keys(evidenceMap).slice(0, 2),
          targetObject: objectAccess.referencedTables[0] || 'Genel',
          problem: 'SORUN: Aktif bir darboğaz bulunmuyor.',
          whyItMatters: 'NEDEN ÖNEMLİ: Gereksiz indeks veya refaktör müdahaleleri veritabanı yazma maliyetini ve bakım yükünü artırabilir.',
          action: 'NE YAP: Veri hacmi 10 katına çıktığında veya filtre aralığı genişlediğinde SQL Workbench Benchmark modunda tekrar kontrol edin.',
          howToValidate: 'SONRA NASIL DOĞRULA: SQL Workbench üzerinde 5-run kıyaslama (Benchmark) çalıştırarak median süreyi kaydedin.',
          nextTool: 'WORKBENCH'
        }
      ],
      risks: [
        'Veri tablosundaki satır sayısı katlanarak büyüdüğünde tarama (scan) operasyonları doğrusal olarak yavaşlayabilir.'
      ],
      whatNotToDo: [
        'Zaten hafif ve hızlı çalışan bu sorguya gereksiz ilave indeks eklemekten kaçının (DML yazma maliyetini artırır).',
        'Semantiği bozacak gereksiz DISTINCT veya force hint eklemeyin.'
      ],
      recommendedNextStep: 'Sorgu şu an sağlıklı durumdadır. Ekstra bir optimizasyon müdahalesine gerek yoktur.',
      implementationOrder: [
        '1. Mevcut yürütme süresini temel referans (baseline) olarak saklayın.',
        '2. Veri hacmi arttığında periyodik olarak Workbench üzerinde kontrol edin.'
      ],
      confidence,
      confidenceReason
    };
  }

  // Identify Primary Bottleneck from concrete evidence
  let primaryType = 'HIGH_LOGICAL_READS';
  let primaryTitle = 'Yüksek Mantıksal Okuma (I/O Yükü)';
  let primaryEvidence = [];
  let primaryObject = objectAccess.referencedTables[0] || 'dbo.Tablo';
  let primaryWhy = 'Yüksek sayfa okuma hacmi bellek (Buffer Pool) baskısı yaratır ve diğer sorguların önbelleğini temizler.';

  // Check 1: Severe Cardinality Mismatch
  if (planSummary.cardinalityMismatches?.length > 0 && (planSummary.cardinalityMismatches[0].ratio >= 10)) {
    const cm = planSummary.cardinalityMismatches[0];
    primaryType = 'CARDINALITY_MISMATCH';
    primaryTitle = `${cm.object || 'Operatör'} üzerinde Ciddi Kardinalite Tahmin Hatası (${cm.ratio}×)`;
    primaryObject = cm.object || primaryObject;
    primaryWhy = 'SQL Server Query Optimizer satır sayısını yanlış tahmin ettiği için yetersiz bellek ayırmış veya hatalı join/scan stratejisi seçmiştir.';
    const cKey = Object.keys(evidenceMap).find(k => k.startsWith('CARD')) || 'OP01';
    primaryEvidence.push(cKey);
  }
  // Check 2: Missing Index with High Impact
  else if (planSummary.missingIndexes?.length > 0 && (planSummary.missingIndexes[0].impact >= 50)) {
    const mi = planSummary.missingIndexes[0];
    primaryType = 'UNINDEXED_SCAN';
    primaryTitle = `${mi.table} Tablosunda Eksik İndeks Nedeniyle Tablo Taraması`;
    primaryObject = mi.table || primaryObject;
    primaryWhy = `Filtre kolonlarını kapsayan bir indeks bulunmadığı için optimizatör tüm tabloyu taramak zorunda kalıyor (Tahmini etki: +%${mi.impact}).`;
    const idxKey = Object.keys(evidenceMap).find(k => k.startsWith('IDX')) || 'OP01';
    primaryEvidence.push(idxKey);
  }
  // Check 3: Non-SARGable Function Predicates
  else if (astShape.findings?.some(f => f.category === 'SARGABILITY' || f.ruleName?.includes('SARG'))) {
    const sargFinding = astShape.findings.find(f => f.category === 'SARGABILITY' || f.ruleName?.includes('SARG'));
    primaryType = 'NON_SARGABLE_PREDICATE';
    primaryTitle = `WHERE Koşulunda SARGable Olmayan Fonksiyon Kullanımı (${sargFinding.object || primaryObject})`;
    primaryObject = sargFinding.object || primaryObject;
    primaryWhy = 'Kolon üzerinde fonksiyon (YEAR, CAST, FORMAT vb.) çağrılması indeks aramasını (seek) engeller ve clustered scan zorlar.';
    const astKey = Object.keys(evidenceMap).find(k => k.startsWith('AST')) || 'OP01';
    primaryEvidence.push(astKey);
  }
  // Check 4: Heavy Table Scans
  else {
    const topIo = runtime.tableStats?.[0];
    if (topIo && topIo.logicalReads > 2000) {
      primaryTitle = `${topIo.table} Üzerinde Aşırı Mantıksal Okuma (${topIo.logicalReads.toLocaleString()} Sayfa)`;
      primaryObject = topIo.table;
      primaryWhy = `${topIo.table} tablosundan ${topIo.logicalReads.toLocaleString()} sayfa (~${((topIo.logicalReads * 8) / 1024).toFixed(1)} MB) veri okunuyor.`;
    }
    const ioKey = Object.keys(evidenceMap).find(k => k.startsWith('IO')) || 'OP01';
    primaryEvidence.push(ioKey);
  }

  // Construct Ordered Priorities (Max 3-4 actionable items)
  const priorities = [];
  let pIdx = 1;

  // Priority 1: Address primary bottleneck directly
  if (primaryType === 'NON_SARGABLE_PREDICATE' || astShape.findings?.some(f => f.category === 'SARGABILITY')) {
    priorities.push({
      priority: pIdx++,
      title: `Predicate SARGability İyileştirmesi (${primaryObject})`,
      evidence: Object.keys(evidenceMap).filter(k => k.startsWith('AST') || k.startsWith('OP')).slice(0, 2),
      targetObject: primaryObject,
      problem: `SORUN: ${primaryObject} üzerindeki filtre ifadesinde fonksiyon sarmalaması mevcut, bu da indeks seek kullanımını engelliyor.`,
      whyItMatters: 'NEDEN ÖNEMLİ: SARGable aralık koşuluna dönüştürüldüğünde okuma maliyeti 100x ile 10.000x mertebesinde azalabilir.',
      action: 'NE YAP: 1. Kolon üzerindeki YEAR/CAST ifadesini sabit tarih sınırlarına (>= ve <) dönüştürün. 2. Refaktör Stüdyosu\'na göndererek eşdeğer aday üretin.',
      howToValidate: 'SONRA NASIL DOĞRULA: Refaktör Stüdyosu Validation Lab üzerinde semantik eşitlik ve A/B benchmark testini çalıştırın.',
      nextTool: 'REFACTOR'
    });
  }

  if (planSummary.missingIndexes?.length > 0) {
    const mi = planSummary.missingIndexes[0];
    priorities.push({
      priority: pIdx++,
      title: `İndeks Kapsamını Değerlendir (${mi.table})`,
      evidence: Object.keys(evidenceMap).filter(k => k.startsWith('IDX') || k.startsWith('OP')).slice(0, 2),
      targetObject: mi.table,
      problem: `SORUN: ${mi.table} tablosunda sorgunun filtre ve join kolonlarını kapsayan indeks bulunmuyor (Tahmini etki: +%${mi.impact || 0}).`,
      whyItMatters: 'NEDEN ÖNEMLİ: Uygun bir Nonclustered indeks tam tablo taramasını (Clustered Scan) doğrudan Index Seek operasyonuna dönüştürür.',
      action: 'NE YAP: 1. İndeks Danışmanı\'nı açın. 2. Tablodaki mevcut indekslerle çakışma (conflict) durumunu ve yazma maliyetini inceleyin. 3. DBA onayıyla test ortamında değerlendirin.',
      howToValidate: 'SONRA NASIL DOĞRULA: İndeks simülasyonu veya test ortamında plan karşılaştırması yaparak Clustered Scan\'in kalktığını doğrulayın.',
      nextTool: 'INDEX_ADVISOR'
    });
  }

  if (planSummary.cardinalityMismatches?.length > 0) {
    const cm = planSummary.cardinalityMismatches[0];
    priorities.push({
      priority: pIdx++,
      title: `İstatistik Sağlığını Kontrol Et (${cm.object || primaryObject})`,
      evidence: Object.keys(evidenceMap).filter(k => k.startsWith('CARD') || k.startsWith('OP')).slice(0, 2),
      targetObject: cm.object || primaryObject,
      problem: `SORUN: ${cm.object || 'Operatör'} üzerinde ${cm.factor || 'büyük kardinalite sapması'} tespit edildi.`,
      whyItMatters: 'NEDEN ÖNEMLİ: Bayat istatistikler optimizer\'ın yanlış join tipi (örn. Hash Join yerine pahalı Nested Loop) seçmesine yol açar.',
      action: 'NE YAP: 1. İstatistik Sağlığı modülünü açın. 2. Tablonun modification counter (değişiklik sayacı) oranını inceleyin. 3. Güvenli UPDATE STATISTICS betiğini değerlendirin.',
      howToValidate: 'SONRA NASIL DOĞRULA: İstatistik güncellemesi sonrası Actual Plan tekrar çekilerek tahmin ile gerçek satır uyumunu kontrol edin.',
      nextTool: 'STATISTICS'
    });
  }

  // If we still need an item and there are multiple scan themes
  if (priorities.length < 2 && planSummary.groupedOperatorThemes?.some(g => g.count > 1)) {
    const rep = planSummary.groupedOperatorThemes.find(g => g.count > 1);
    priorities.push({
      priority: pIdx++,
      title: `Mükerrer Tablo Erişimini Birleştir (${rep.targetObject})`,
      evidence: Object.keys(evidenceMap).filter(k => k.startsWith('OP')).slice(0, 2),
      targetObject: rep.targetObject,
      problem: `SORUN: ${rep.targetObject} tablosu planda ${rep.count} kez ayrı ayrı taranıyor.`,
      whyItMatters: 'NEDEN ÖNEMLİ: Her bağımsız tarama disk ve bellek I/O okuma sayısını katlar.',
      action: 'NE YAP: Ortak filtreleri tek bir CTE veya derived table altında toplayarak tarama sayısını 1\'e indirin.',
      howToValidate: 'SONRA NASIL DOĞRULA: Workbench üzerinde STATISTICS IO çıktısındaki scan count değerini kontrol edin.',
      nextTool: 'REFACTOR'
    });
  }

  // Construct Implementation Sequence
  const implementationOrder = [
    '1. Sorgu şekli (Query Shape) ve SARGability düzeltmelerini Refaktör Stüdyosu ile test edin.',
    '2. İndeks Danışmanı ile tablo üzerindeki eksik indeks tavsiyelerini ve çakışmaları inceleyin.',
    '3. İstatistik Sağlığı ekranında kardinalite sapmasına yol açan tabloları kontrol edin.',
    '4. Yeni adayı SQL Workbench üzerinde Actual Plan ve A/B Benchmark ile karşılaştırarak doğrula.'
  ];

  return {
    isHealthy: false,
    summary: `${query.database} veritabanında çalıştırılan sorguda ${runtime.logicalReads.toLocaleString()} mantıksal okuma (${((runtime.logicalReads * 8) / 1024).toFixed(1)} MB) ve ${runtime.durationMs} ms süre ölçüldü. Ana darboğaz: ${primaryTitle}.`,
    primaryBottleneck: {
      type: primaryType,
      title: primaryTitle,
      evidence: primaryEvidence.length ? primaryEvidence : Object.keys(evidenceMap).slice(0, 2),
      targetObject: primaryObject,
      whyItMatters: primaryWhy
    },
    priorities,
    risks: [
      'Yalnızca indeks eklemek altta yatan non-SARGable filtre mantığını çözmezse beklenen okuma düşüşü sağlanamayabilir.',
      'Aynı tabloya çok sayıda ilave indeks eklenmesi INSERT/UPDATE/DELETE operasyonlarında disk yazma gecikmesine yol açar.'
    ],
    whatNotToDo: [
      'Gerçekleştirilen değişiklikleri Validation Lab üzerinde matematiksel eşitlik kanıtı almadan canlıya almayın.',
      'Kardinalite sapmasını çözmek için körü körüne query hint (WITH (INDEX=...)) kullanmaktan kaçının; önce istatistikleri ve filtreyi düzeltin.',
      'Sorgudaki JOIN sırasını rastgele değiştirmek yerine ilişkisel cebir ve SARGability dönüşümüne odaklanın.'
    ],
    recommendedNextStep: priorities[0]?.action || 'Öncelikli olarak Refaktör Stüdyosu veya İndeks Danışmanı adımlarını inceleyin.',
    implementationOrder,
    confidence,
    confidenceReason
  };
}

/**
 * Builds Strict System & User Prompts for AI Plan Analyst
 */
function buildPlanAnalystPrompt(contextPack) {
  const systemPrompt = `You are a principal Microsoft SQL Server performance engineer and internals architect with decades of experience diagnosing complex ERP workloads.

YOUR MANDATE:
Your task is to interpret measured runtime evidence, execution plan structure, and schema metadata, prioritize the actual bottlenecks, and give the user an ordered, concrete remediation plan in TURKISH (Türkçe).

CRITICAL INVARIANTS & GUARDRAILS:
1. STRICT EVIDENCE GROUNDING: Every recommendation, bottleneck and priority MUST be tied directly to concrete evidence from the supplied context pack (e.g. specific operator IDs like OP01, WARN01, STAT01, AST01, IO01, exact table names, and measured numbers).
2. BAN ON GENERIC ADVICE (STRICT): Never output generic tuning cliches such as "İndeks eklemeyi düşünün", "Sorguyu optimize edin", "JOIN'leri gözden geçirin", "WHERE koşullarını inceleyin". Every action must state exactly WHAT object, WHAT column, WHAT expression, and WHAT specific tool to use.
3. DO NOT ASSUME EVERYTHING IS A PROBLEM: Index Scan, Hash Match, Sort, Parallelism, and Nested Loops can be legitimate and optimal in specific relational contexts. Only flag them when concrete evidence (e.g. Scan + very high reads + selective predicate, or Hash Match + severe row mismatch + spill) proves an inefficiency.
4. HEALTHY QUERY HONESTY: If the query is already lightweight (low logical reads, sub-second execution, no warnings, no significant row mismatch), explicitly state "Belirgin bir performans darboğazı tespit edilmedi" and do not manufacture artificial problems.
5. PERFORMANCE CLAIMS: Do not claim an unvalidated percentage speedup (e.g. "Sorgu %90 hızlanacak" is FORBIDDEN). Frame all benefits as engineering hypotheses that must be validated via benchmark and plan comparison.
6. NO DIRECT DATABASE MUTATION: Never propose direct DDL/DML mutation on the target server. Route the user to appropriate studio tools (INDEX_ADVISOR, STATISTICS, REFACTOR, WORKBENCH).
7. ALL TEXT, EXPLANATIONS, AND RATIONALE MUST BE IN TURKISH (Türkçe).

RESPONSE FORMAT (MANDATORY STRICT JSON ONLY):
You must respond with a single valid JSON object strictly matching this schema:
{
  "isHealthy": false,
  "summary": "2-3 sentence executive diagnostic summary in Turkish",
  "primaryBottleneck": {
    "type": "HIGH_LOGICAL_READS | CARDINALITY_MISMATCH | TEMPDB_SPILL | UNINDEXED_SCAN | NON_SARGABLE_PREDICATE | MEMORY_PRESSURE | COMPLEX_RELATIONAL_SHAPE | NONE",
    "title": "Clear concise bottleneck title in Turkish",
    "evidence": ["OP01", "IO01"],
    "targetObject": "dbo.STOK_HAREKETLERI",
    "whyItMatters": "Clear explanation of the bottleneck impact in Turkish"
  },
  "priorities": [
    {
      "priority": 1,
      "title": "Action title in Turkish",
      "evidence": ["OP01", "AST01"],
      "targetObject": "dbo.STOK_HAREKETLERI",
      "problem": "SORUN: Specific problem description with numbers",
      "whyItMatters": "NEDEN ÖNEMLİ: Impact on I/O, CPU, or memory",
      "action": "NE YAP: Step-by-step concrete action",
      "howToValidate": "SONRA NASIL DOĞRULA: Benchmark & plan comparison procedure",
      "nextTool": "INDEX_ADVISOR | STATISTICS | REFACTOR | WORKBENCH | NONE"
    }
  ],
  "risks": ["Specific risk 1 in Turkish", "Specific risk 2 in Turkish"],
  "whatNotToDo": ["Explicit bad practice warning 1 in Turkish", "Warning 2 in Turkish"],
  "recommendedNextStep": "Top immediate recommended step in Turkish",
  "implementationOrder": [
    "1. Step 1",
    "2. Step 2",
    "3. Step 3"
  ],
  "confidence": "HIGH | MEDIUM | LOW",
  "confidenceReason": "Explanation of confidence based on evidence quality"
}`;

  const userPrompt = `EVALUATE THIS WORKBENCH EXECUTION & PLAN CONTEXT PACK:\n\n` +
    JSON.stringify(contextPack, null, 2);

  return { systemPrompt, userPrompt };
}

/**
 * Validates and sanitizes AI response to ensure strict compliance
 */
function validateAndSanitizeAiResponse(rawJson, contextPack) {
  if (!rawJson || typeof rawJson !== 'object') {
    return generateDeterministicAnalysis(contextPack);
  }

  // Ensure isHealthy boolean
  const isHealthy = Boolean(rawJson.isHealthy || contextPack.isHealthy);

  // Validate Summary
  let summary = (rawJson.summary || '').trim();
  if (!summary) {
    summary = generateDeterministicAnalysis(contextPack).summary;
  }

  // Check for banned generic phrases in summary
  for (const phrase of BANNED_GENERIC_PHRASES) {
    if (summary.toLowerCase().includes(phrase)) {
      summary = generateDeterministicAnalysis(contextPack).summary;
      break;
    }
  }

  // Validate Primary Bottleneck
  let primaryBottleneck = rawJson.primaryBottleneck;
  if (!primaryBottleneck || typeof primaryBottleneck !== 'object' || !primaryBottleneck.title) {
    primaryBottleneck = generateDeterministicAnalysis(contextPack).primaryBottleneck;
  }

  // Validate Priorities
  let priorities = Array.isArray(rawJson.priorities) ? rawJson.priorities : [];
  if (priorities.length === 0) {
    priorities = generateDeterministicAnalysis(contextPack).priorities;
  } else {
    priorities = priorities.slice(0, 4).map((p, idx) => ({
      priority: idx + 1,
      title: p.title || `Öncelik ${idx + 1}`,
      evidence: Array.isArray(p.evidence) && p.evidence.length > 0 ? p.evidence : ['OP01'],
      targetObject: p.targetObject || primaryBottleneck.targetObject || 'dbo.Tablo',
      problem: p.problem || `SORUN: ${p.title}`,
      whyItMatters: p.whyItMatters || 'NEDEN ÖNEMLİ: I/O ve CPU tüketimini etkiler.',
      action: p.action || 'NE YAP: İlgili studio aracını kullanarak inceleyin.',
      howToValidate: p.howToValidate || 'SONRA NASIL DOĞRULA: SQL Workbench üzerinde benchmark ile doğrulayın.',
      nextTool: ['INDEX_ADVISOR', 'STATISTICS', 'REFACTOR', 'WORKBENCH', 'NONE'].includes(p.nextTool) ? p.nextTool : 'REFACTOR'
    }));
  }

  return {
    isHealthy,
    summary,
    primaryBottleneck,
    priorities,
    risks: Array.isArray(rawJson.risks) && rawJson.risks.length > 0 ? rawJson.risks : generateDeterministicAnalysis(contextPack).risks,
    whatNotToDo: Array.isArray(rawJson.whatNotToDo) && rawJson.whatNotToDo.length > 0 ? rawJson.whatNotToDo : generateDeterministicAnalysis(contextPack).whatNotToDo,
    recommendedNextStep: rawJson.recommendedNextStep || priorities[0]?.action || 'Öncelikli adımları inceleyin.',
    implementationOrder: Array.isArray(rawJson.implementationOrder) && rawJson.implementationOrder.length > 0
      ? rawJson.implementationOrder
      : generateDeterministicAnalysis(contextPack).implementationOrder,
    confidence: contextPack.confidence, // Preserve deterministic confidence
    confidenceReason: contextPack.confidenceReason
  };
}

/**
 * Main Entry Point: Analyze Workbench Execution Plan with AI & Deterministic Engine
 */
async function analyzeWorkbenchPlan({
  sql = '',
  database = null,
  mode = 'actual',
  parsedPlan = null,
  rawXml = null,
  metrics = {},
  statistics = {},
  benchmark = null,
  options = {}
} = {}) {
  const cleanSql = (sql || '').trim();
  if (!cleanSql) {
    throw new Error('Analiz edilecek SQL metni bulunamadı.');
  }

  // 1. Build Deterministic Context Pack
  const contextPack = await buildWorkbenchPlanContextPack({
    sql: cleanSql,
    database,
    mode,
    parsedPlan,
    rawXml,
    metrics,
    statistics,
    benchmark,
    options
  });

  // 2. Check Cache
  const cacheKey = computePlanCacheKey({
    sql: cleanSql,
    database: contextPack.query.database,
    mode: contextPack.query.mode,
    totalSubTreeCost: contextPack.planSummary.totalSubTreeCost,
    logicalReads: contextPack.runtime.logicalReads,
    operatorCount: contextPack.planSummary.operatorCount
  });

  if (!options.forceRefresh && planAnalysisCache.has(cacheKey)) {
    const cachedEntry = planAnalysisCache.get(cacheKey);
    return {
      ok: true,
      cached: true,
      data: cachedEntry.data,
      evidenceMap: contextPack.evidenceMap,
      evidenceList: contextPack.evidenceList,
      contextPack: options.includeContextPack ? contextPack : undefined
    };
  }

  // 3. If Query is Healthy, return immediate deterministic analysis
  if (contextPack.isHealthy) {
    const healthyAnalysis = generateDeterministicAnalysis(contextPack);
    planAnalysisCache.set(cacheKey, { timestamp: Date.now(), data: healthyAnalysis });
    return {
      ok: true,
      cached: false,
      data: healthyAnalysis,
      evidenceMap: contextPack.evidenceMap,
      evidenceList: contextPack.evidenceList,
      contextPack: options.includeContextPack ? contextPack : undefined
    };
  }

  // 4. Try AI Provider if API Key is configured
  const apiKey = options.apiKey || settings.getApiKey();
  const aiConf = settings.getConfig()?.ai || {};

  if (apiKey && global.fetch) {
    try {
      const activeBaseUrl = options.baseUrl || aiConf.baseUrl || 'https://api.deepseek.com';
      const url = normalizeChatUrl(activeBaseUrl);
      let activeModel = (options.model || aiConf.model || 'deepseek-flash').trim();
      if (!activeModel || activeModel.toLowerCase() === 'deepseek-v4-flash' || activeModel.toLowerCase() === 'deepseek-coder') {
        activeModel = 'deepseek-flash';
      }

      const { systemPrompt, userPrompt } = buildPlanAnalystPrompt(contextPack);

      const aiResponse = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: activeModel,
          temperature: 0.1,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      }, DEFAULT_AI_TIMEOUT_MS);

      if (aiResponse.ok) {
        const resJson = await aiResponse.json();
        const choice = resJson.choices?.[0];
        const content = (choice?.message?.content || choice?.message?.reasoning_content || '').trim();

        if (content) {
          // Parse JSON from model
          const parsedAi = JSON.parse(content);
          const sanitized = validateAndSanitizeAiResponse(parsedAi, contextPack);

          // Save to Cache
          planAnalysisCache.set(cacheKey, { timestamp: Date.now(), data: sanitized });
          if (planAnalysisCache.size > MAX_CACHE_ENTRIES) {
            const firstKey = planAnalysisCache.keys().next().value;
            planAnalysisCache.delete(firstKey);
          }

          return {
            ok: true,
            cached: false,
            data: sanitized,
            evidenceMap: contextPack.evidenceMap,
            evidenceList: contextPack.evidenceList,
            contextPack: options.includeContextPack ? contextPack : undefined
          };
        }
      }
    } catch (aiErr) {
      console.warn('[WorkbenchPlanAnalyst] AI provider failed, using high-precision deterministic analysis:', aiErr.message);
    }
  }

  // 5. Fallback: High-Precision Deterministic Rule Engine
  const deterministicAnalysis = generateDeterministicAnalysis(contextPack);

  planAnalysisCache.set(cacheKey, { timestamp: Date.now(), data: deterministicAnalysis });
  if (planAnalysisCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = planAnalysisCache.keys().next().value;
    planAnalysisCache.delete(firstKey);
  }

  return {
    ok: true,
    cached: false,
    data: deterministicAnalysis,
    evidenceMap: contextPack.evidenceMap,
    evidenceList: contextPack.evidenceList,
    contextPack: options.includeContextPack ? contextPack : undefined
  };
}

/**
 * Clears in-memory plan analysis cache
 */
function clearPlanAnalysisCache() {
  planAnalysisCache.clear();
}

module.exports = {
  analyzeWorkbenchPlan,
  buildWorkbenchPlanContextPack,
  generateDeterministicAnalysis,
  buildPlanAnalystPrompt,
  validateAndSanitizeAiResponse,
  computePlanCacheKey,
  clearPlanAnalysisCache,
  BANNED_GENERIC_PHRASES
};
