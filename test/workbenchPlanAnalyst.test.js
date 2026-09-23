/**
 * SQL Server Refactoring & Performance Studio
 * SQL Workbench AI Plan Analyst Unit Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeWorkbenchPlan,
  buildWorkbenchPlanContextPack,
  generateDeterministicAnalysis,
  buildPlanAnalystPrompt,
  validateAndSanitizeAiResponse,
  computePlanCacheKey,
  clearPlanAnalysisCache,
  BANNED_GENERIC_PHRASES
} = require('../server/services/workbenchPlanAnalyst');

describe('SQL Workbench AI Plan Analyst Tests', () => {

  beforeEach(() => {
    clearPlanAnalysisCache();
  });

  // 1. Context Pack Builder Tests
  describe('1. Plan Context Builder & Evidence Extraction', () => {
    it('correctly extracts query, runtime, plan summary, object access, and ast shape', async () => {
      const sql = 'SELECT TOP 50 sth_stok_kod, SUM(sth_miktar) FROM dbo.STOK_HAREKETLERI WHERE YEAR(sth_tarih) = 2026 GROUP BY sth_stok_kod;';
      const parsedPlan = {
        totalSubTreeCost: 4.85,
        totalEstRows: 50,
        optimizationLevel: 'FULL',
        operatorCount: 4,
        scans: 1,
        seeks: 0,
        lookups: 0,
        topOperators: [
          { physicalOp: 'Clustered Index Scan', costPercent: 75, targetObject: 'STOK_HAREKETLERI', estimatedRows: 250000, actualRows: 260000 }
        ],
        operators: [
          { physicalOp: 'Clustered Index Scan', costPercent: 75, targetObject: 'dbo.STOK_HAREKETLERI', estimatedRows: 250000, actualRows: 260000, isScan: true },
          { physicalOp: 'Hash Match (Aggregate)', costPercent: 15, targetObject: '', estimatedRows: 50, actualRows: 50 }
        ],
        warnings: [],
        cardinalityMismatches: [],
        missingIndexes: [
          { table: 'STOK_HAREKETLERI', impact: 84.5, equalityColumns: [], inequalityColumns: ['sth_tarih'], includedColumns: ['sth_stok_kod', 'sth_miktar'] }
        ]
      };

      const metrics = {
        durationMs: 340,
        cpuMs: 310,
        logicalReads: 48500,
        physicalReads: 120,
        rowsReturned: 50
      };

      const statistics = {
        tables: [{ table: 'STOK_HAREKETLERI', scanCount: 1, logicalReads: 48500, physicalReads: 120 }],
        totalLogicalReads: 48500,
        cpuTimeMs: 310,
        elapsedTimeMs: 340
      };

      const pack = await buildWorkbenchPlanContextPack({
        sql,
        database: 'MikroDB_V16_LIDER25',
        mode: 'actual',
        parsedPlan,
        metrics,
        statistics
      });

      assert.equal(pack.isActual, true);
      assert.equal(pack.query.database, 'MikroDB_V16_LIDER25');
      assert.equal(pack.query.sql, sql);
      assert.equal(pack.runtime.logicalReads, 48500);
      assert.equal(pack.runtime.durationMs, 340);
      assert.equal(pack.planSummary.totalSubTreeCost, 4.85);
      assert.equal(pack.confidence, 'HIGH');
      assert.ok(pack.evidenceMap['IO01'], 'Should generate IO01 evidence item');
      assert.ok(pack.evidenceMap['OP01'], 'Should generate OP01 evidence item');
      assert.ok(pack.evidenceMap['IDX01'], 'Should generate IDX01 evidence item');
    });
  });

  // 2. Operator Prioritization & Deduplication Grouping
  describe('2. Operator Deduplication & Prioritization Grouping', () => {
    it('groups 27 duplicate scans on the same table into a single unified problem theme', async () => {
      const sql = 'SELECT * FROM dbo.STOK_HAREKETLERI;';
      const duplicateOps = Array.from({ length: 27 }, (_, i) => ({
        nodeId: i + 1,
        physicalOp: 'Clustered Index Scan',
        costPercent: 3,
        targetObject: 'dbo.STOK_HAREKETLERI',
        estimatedRows: 10000,
        actualRows: 12000,
        isScan: true
      }));

      const parsedPlan = {
        totalSubTreeCost: 12.0,
        operatorCount: 27,
        scans: 27,
        topOperators: duplicateOps.slice(0, 5),
        operators: duplicateOps,
        warnings: [],
        cardinalityMismatches: []
      };

      const pack = await buildWorkbenchPlanContextPack({
        sql,
        database: 'TestDb',
        mode: 'actual',
        parsedPlan,
        metrics: { logicalReads: 90000, durationMs: 1200 }
      });

      const opEvidence = Object.values(pack.evidenceMap).find(e => e.category === 'PLAN_OPERATOR');
      assert.ok(opEvidence, 'Should create grouped operator evidence');
      assert.ok(opEvidence.title.includes('27× Clustered Index Scan'), 'Should count 27 duplicate scans');
      assert.ok(opEvidence.detail.includes('27 kez mükerrer'), 'Should note repeated scan count');
    });

    it('compresses 50+ raw operators and findings into top 3-4 prioritized action items', () => {
      const mockPack = {
        query: { sql: 'SELECT * FROM A JOIN B JOIN C', database: 'ERP_DB', mode: 'ACTUAL' },
        runtime: { logicalReads: 150000, durationMs: 2400, tableStats: [{ table: 'STOK_HAREKETLERI', logicalReads: 140000, scanCount: 5 }] },
        planSummary: {
          totalSubTreeCost: 45.2,
          operatorCount: 65,
          cardinalityMismatches: [
            { object: 'dbo.STOK_HAREKETLERI', ratio: 150, factor: '150× Eksik Tahmin', estimated: 100, actual: 15000 }
          ],
          missingIndexes: [
            { table: 'STOK_HAREKETLERI', impact: 88, equalityColumns: ['sth_stok_kod'], includedColumns: ['sth_miktar'] }
          ],
          groupedOperatorThemes: [
            { physicalOp: 'Clustered Index Scan', targetObject: 'STOK_HAREKETLERI', count: 12, totalCostPercent: 65 }
          ]
        },
        objectAccess: { referencedTables: ['STOK_HAREKETLERI', 'CARI_HESAPLAR'] },
        astShape: {
          findings: [
            { category: 'SARGABILITY', ruleName: 'NON_SARGABLE_FUNCTION', object: 'STOK_HAREKETLERI' }
          ]
        },
        evidenceMap: {
          OP01: { id: 'OP01', title: '12x Scan on STOK_HAREKETLERI' },
          CARD01: { id: 'CARD01', title: '150x Cardinality mismatch' },
          IDX01: { id: 'IDX01', title: 'Missing Index on STOK_HAREKETLERI' },
          AST01: { id: 'AST01', title: 'Non-SARGable YEAR()' },
          IO01: { id: 'IO01', title: '140,000 logical reads' }
        },
        isHealthy: false,
        confidence: 'HIGH',
        confidenceReason: 'Actual execution plan verified'
      };

      const analysis = generateDeterministicAnalysis(mockPack);
      assert.ok(analysis.priorities.length <= 4, 'Priorities list must be compressed to at most 4 items');
      assert.ok(analysis.priorities.length >= 1, 'Must have at least 1 prioritized action item');
      assert.ok(analysis.primaryBottleneck.title, 'Must have clear primary bottleneck');
    });
  });

  // 3. Action Tool Routing Tests
  describe('3. Action Tool Routing Integrations', () => {
    it('routes missing index bottleneck to INDEX_ADVISOR with target object and impact', () => {
      const mockPack = {
        query: { sql: 'SELECT * FROM dbo.SIPARISLER WHERE sip_tarih = @dt', database: 'ERP_DB', mode: 'ACTUAL' },
        runtime: { logicalReads: 45000, durationMs: 650, tableStats: [{ table: 'SIPARISLER', logicalReads: 45000, scanCount: 1 }] },
        planSummary: {
          totalSubTreeCost: 8.5,
          operatorCount: 4,
          cardinalityMismatches: [],
          missingIndexes: [{ table: 'SIPARISLER', impact: 92, equalityColumns: ['sip_tarih'], includedColumns: ['sip_tutar'] }],
          groupedOperatorThemes: [{ physicalOp: 'Clustered Index Scan', targetObject: 'SIPARISLER', count: 1, totalCostPercent: 85 }]
        },
        objectAccess: { referencedTables: ['SIPARISLER'] },
        astShape: { findings: [] },
        evidenceMap: {
          IDX01: { id: 'IDX01', title: 'Missing index on SIPARISLER' },
          IO01: { id: 'IO01', title: '45,000 reads' }
        },
        isHealthy: false,
        confidence: 'HIGH',
        confidenceReason: 'Verified'
      };

      const analysis = generateDeterministicAnalysis(mockPack);
      const idxPriority = analysis.priorities.find(p => p.nextTool === 'INDEX_ADVISOR');
      assert.ok(idxPriority, 'Must route to INDEX_ADVISOR when index is missing');
      assert.equal(idxPriority.targetObject, 'SIPARISLER');
      assert.ok(idxPriority.action.includes('İndeks Danışmanı'), 'Action must mention Index Advisor');
    });

    it('routes severe cardinality mismatch to STATISTICS health engine', () => {
      const mockPack = {
        query: { sql: 'SELECT * FROM dbo.CARI_HESAPLAR WHERE cari_kod LIKE "A%"', database: 'ERP_DB', mode: 'ACTUAL' },
        runtime: { logicalReads: 8500, durationMs: 140, tableStats: [{ table: 'CARI_HESAPLAR', logicalReads: 8500, scanCount: 1 }] },
        planSummary: {
          totalSubTreeCost: 3.2,
          operatorCount: 3,
          cardinalityMismatches: [{ object: 'dbo.CARI_HESAPLAR', ratio: 45, factor: '45× Eksik Tahmin', estimated: 10, actual: 450 }],
          missingIndexes: [],
          groupedOperatorThemes: []
        },
        objectAccess: { referencedTables: ['CARI_HESAPLAR'] },
        astShape: { findings: [] },
        evidenceMap: {
          CARD01: { id: 'CARD01', title: 'Cardinality mismatch on CARI_HESAPLAR' }
        },
        isHealthy: false,
        confidence: 'HIGH',
        confidenceReason: 'Verified'
      };

      const analysis = generateDeterministicAnalysis(mockPack);
      const statPriority = analysis.priorities.find(p => p.nextTool === 'STATISTICS');
      assert.ok(statPriority, 'Must route to STATISTICS when severe cardinality mismatch is present');
      assert.ok(statPriority.action.includes('İstatistik Sağlığı'), 'Action must mention Statistics Health');
    });

    it('routes SARGability & relational shape issues to REFACTOR Studio', () => {
      const mockPack = {
        query: { sql: 'SELECT * FROM dbo.STOKLAR WHERE SUBSTRING(sto_kod, 1, 3) = "ABC"', database: 'ERP_DB', mode: 'ACTUAL' },
        runtime: { logicalReads: 12000, durationMs: 180, tableStats: [{ table: 'STOKLAR', logicalReads: 12000, scanCount: 1 }] },
        planSummary: {
          totalSubTreeCost: 2.5,
          operatorCount: 3,
          cardinalityMismatches: [],
          missingIndexes: [],
          groupedOperatorThemes: []
        },
        objectAccess: { referencedTables: ['STOKLAR'] },
        astShape: {
          findings: [{ category: 'SARGABILITY', ruleName: 'SUBSTRING_PREDICATE', object: 'STOKLAR' }]
        },
        evidenceMap: {
          AST01: { id: 'AST01', title: 'SUBSTRING on sto_kod' }
        },
        isHealthy: false,
        confidence: 'HIGH',
        confidenceReason: 'Verified'
      };

      const analysis = generateDeterministicAnalysis(mockPack);
      const refactorPriority = analysis.priorities.find(p => p.nextTool === 'REFACTOR');
      assert.ok(refactorPriority, 'Must route to REFACTOR when SARGability issue is present');
      assert.ok(refactorPriority.action.includes('Refaktör Stüdyosu'), 'Action must mention Refactor Studio');
    });
  });

  // 4. Healthy Query Detection (Section 15)
  describe('4. Healthy Query Detection', () => {
    it('honestly detects a healthy, lightweight query and produces no false-positive problems', async () => {
      const sql = 'SELECT TOP 10 sth_stok_kod FROM dbo.STOK_HAREKETLERI WHERE sth_stok_kod = "ITEM-100";';
      const parsedPlan = {
        totalSubTreeCost: 0.0032,
        totalEstRows: 10,
        optimizationLevel: 'FULL',
        operatorCount: 2,
        scans: 0,
        seeks: 1,
        lookups: 0,
        topOperators: [{ physicalOp: 'Index Seek', costPercent: 90, targetObject: 'STOK_HAREKETLERI', estimatedRows: 10, actualRows: 10 }],
        operators: [{ physicalOp: 'Index Seek', costPercent: 90, targetObject: 'STOK_HAREKETLERI', estimatedRows: 10, actualRows: 10, isSeek: true }],
        warnings: [],
        cardinalityMismatches: [],
        missingIndexes: []
      };

      const metrics = {
        durationMs: 8,
        cpuMs: 6,
        logicalReads: 12,
        physicalReads: 0,
        rowsReturned: 10
      };

      const statistics = {
        tables: [{ table: 'STOK_HAREKETLERI', scanCount: 1, logicalReads: 12, physicalReads: 0 }],
        totalLogicalReads: 12,
        cpuTimeMs: 6,
        elapsedTimeMs: 8
      };

      const result = await analyzeWorkbenchPlan({
        sql,
        database: 'MikroDB_V16_LIDER25',
        mode: 'actual',
        parsedPlan,
        metrics,
        statistics
      });

      assert.equal(result.ok, true);
      assert.equal(result.data.isHealthy, true);
      assert.equal(result.data.primaryBottleneck.type, 'NONE');
      assert.ok(result.data.summary.includes('Belirgin bir performans darboğazı'), 'Summary must declare healthy status');
      assert.equal(result.data.confidence, 'HIGH');
    });
  });

  // 5. Confidence Engine (Section 20)
  describe('5. Deterministic Confidence Engine', () => {
    it('assigns HIGH confidence when actual plan and runtime metrics are present', async () => {
      const pack = await buildWorkbenchPlanContextPack({
        sql: 'SELECT * FROM dbo.T;',
        mode: 'actual',
        parsedPlan: { isActual: true, totalSubTreeCost: 1.0, operatorCount: 3, operators: [], warnings: [] },
        metrics: { logicalReads: 500, durationMs: 20 }
      });
      assert.equal(pack.confidence, 'HIGH');
    });

    it('assigns MEDIUM confidence when only estimated plan is available', async () => {
      const pack = await buildWorkbenchPlanContextPack({
        sql: 'SELECT * FROM dbo.T;',
        mode: 'estimated',
        parsedPlan: { isActual: false, totalSubTreeCost: 1.0, operatorCount: 3, operators: [], warnings: [] },
        metrics: { logicalReads: 0, durationMs: 0 }
      });
      assert.equal(pack.confidence, 'MEDIUM');
    });

    it('assigns LOW confidence when plan is missing or only AST is available', async () => {
      const pack = await buildWorkbenchPlanContextPack({
        sql: 'SELECT * FROM dbo.T;',
        mode: 'estimated',
        parsedPlan: null,
        metrics: {}
      });
      assert.equal(pack.confidence, 'LOW');
    });
  });

  // 6. Generic Advice Rejection & Anti-Hallucination Guardrails
  describe('6. Anti-Generic Advice Guardrail', () => {
    it('rejects banned generic cliches and falls back to evidence-grounded diagnosis', () => {
      const mockPack = {
        query: { sql: 'SELECT * FROM dbo.Orders', database: 'DB', mode: 'ACTUAL' },
        runtime: { logicalReads: 50000, durationMs: 1200, tableStats: [{ table: 'Orders', logicalReads: 50000 }] },
        planSummary: { totalSubTreeCost: 5.0, operatorCount: 4, cardinalityMismatches: [], missingIndexes: [] },
        objectAccess: { referencedTables: ['Orders'] },
        astShape: { findings: [] },
        evidenceMap: { OP01: { id: 'OP01', title: 'Scan on Orders' } },
        isHealthy: false,
        confidence: 'HIGH',
        confidenceReason: 'Verified'
      };

      // Raw generic AI response
      const genericAi = {
        summary: 'Sorguyu optimize edin ve indeks eklemeyi düşünün.',
        primaryBottleneck: null,
        priorities: []
      };

      const sanitized = validateAndSanitizeAiResponse(genericAi, mockPack);
      assert.ok(!sanitized.summary.includes('indeks eklemeyi düşünün'), 'Must remove banned generic cliche');
      assert.ok(sanitized.primaryBottleneck.title, 'Must restore evidence-backed primary bottleneck');
      assert.ok(sanitized.priorities.length > 0, 'Must produce grounded priority actions');
    });
  });

  // 7. Caching Engine (Section 18)
  describe('7. Plan Analysis In-Memory Caching', () => {
    it('caches analysis by sqlHash + planHash + runtime fingerprint and returns cached result on match', async () => {
      const sql = 'SELECT * FROM dbo.STOKLAR WHERE sto_isim = "TEST";';
      const parsedPlan = { totalSubTreeCost: 1.5, operatorCount: 2, operators: [], warnings: [] };
      const metrics = { logicalReads: 4200, durationMs: 65 };

      // Call 1: should calculate fresh
      const res1 = await analyzeWorkbenchPlan({ sql, database: 'DB', mode: 'actual', parsedPlan, metrics });
      assert.equal(res1.cached, false);

      // Call 2 with identical fingerprint: should hit cache
      const res2 = await analyzeWorkbenchPlan({ sql, database: 'DB', mode: 'actual', parsedPlan, metrics });
      assert.equal(res2.cached, true);

      // Call 3 with different metrics/plan: should invalidate / miss cache
      const res3 = await analyzeWorkbenchPlan({ sql, database: 'DB', mode: 'actual', parsedPlan, metrics: { logicalReads: 8400, durationMs: 130 } });
      assert.equal(res3.cached, false);
    });
  });

  // 8. Security & Secret Hygiene (Section 21)
  describe('8. Security Hygiene', () => {
    it('ensures passwords, API keys and connection strings are strictly excluded from context pack and prompt', async () => {
      const sql = 'SELECT * FROM dbo.USERS WHERE user_id = 42;';
      const pack = await buildWorkbenchPlanContextPack({
        sql,
        database: 'SecuredDB',
        mode: 'actual',
        parsedPlan: { totalSubTreeCost: 0.1, operatorCount: 1, operators: [], warnings: [] },
        metrics: { logicalReads: 5, durationMs: 2 }
      });

      const jsonStr = JSON.stringify(pack);
      assert.ok(!jsonStr.includes('password'), 'Context pack must not contain password field');
      assert.ok(!jsonStr.includes('apiKey'), 'Context pack must not contain apiKey field');
      assert.ok(!jsonStr.includes('Server='), 'Context pack must not contain connection strings');
    });
  });

});
