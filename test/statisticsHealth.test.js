const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_STATS_THRESHOLDS,
  calculateModificationRatio,
  formatModificationRatio,
  evaluateStatsStatus,
  generateUpdateStatisticsScript,
  correlatePlanWithStatistics
} = require('../server/services/statisticsHealth');

describe('Statistics Health Engine Tests (Sprint 5)', () => {
  describe('calculateModificationRatio & formatModificationRatio', () => {
    it('calculates accurate ratio for standard modifications and rows', () => {
      const ratio = calculateModificationRatio(2500, 10000);
      assert.equal(ratio, 0.25);
    });

    it('returns 0.0 when row count is 0 and modification counter is 0', () => {
      const ratio = calculateModificationRatio(0, 0);
      assert.equal(ratio, 0.0);
    });

    it('returns 1.0 when row count is 0 but modifications occurred (table emptied or loaded)', () => {
      const ratio = calculateModificationRatio(500, 0);
      assert.equal(ratio, 1.0);
    });

    it('returns exact ratio when modifications exceed initial row count (unclamped 2.5)', () => {
      const ratio = calculateModificationRatio(25000, 10000);
      assert.equal(ratio, 2.5);
    });

    it('formatModificationRatio cleanly formats ratio > 1.0 and caps CSS bar at 100%', () => {
      const fmt = formatModificationRatio(1.48);
      assert.equal(fmt.rawModificationRatio, 1.48);
      assert.equal(fmt.barPercent, 100);
      assert.ok(fmt.displayRatioText.includes('katı'));
      assert.ok(fmt.displayRatioText.includes('1.48') || fmt.displayRatioText.includes('1,48'));
    });

    it('formatModificationRatio formats percentage for ratio < 1.0', () => {
      const fmt = formatModificationRatio(0.35);
      assert.equal(fmt.rawModificationRatio, 0.35);
      assert.equal(fmt.barPercent, 35);
      assert.equal(fmt.displayRatioText, '%35 değişiklik');
    });

    it('exports centrally defined DEFAULT_STATS_THRESHOLDS', () => {
      assert.equal(DEFAULT_STATS_THRESHOLDS.CRITICAL, 0.50);
      assert.equal(DEFAULT_STATS_THRESHOLDS.STALE, 0.20);
      assert.equal(DEFAULT_STATS_THRESHOLDS.WATCH, 0.10);
    });

    it('handles negative, null, or undefined inputs gracefully without throwing', () => {
      assert.equal(calculateModificationRatio(null, 1000), 0.0);
      assert.equal(calculateModificationRatio(500, null), 1.0);
      assert.equal(calculateModificationRatio(-50, 1000), 0.0);
      assert.equal(calculateModificationRatio(undefined, undefined), 0.0);
    });
  });

  describe('evaluateStatsStatus & Categorization', () => {
    it('classifies as CRITICAL when modification ratio is >= 0.50 (50% data changed)', () => {
      const res = evaluateStatsStatus({
        modificationRatio: 0.55,
        modificationCounter: 5500,
        rows: 10000,
        lastUpdated: new Date().toISOString()
      });
      assert.equal(res.status, 'CRITICAL');
      assert.equal(res.severity, 'CRITICAL');
      const modFinding = res.findings.find(f => f.code === 'STATS_HIGH_MODIFICATION');
      assert.ok(modFinding);
      assert.equal(modFinding.severity, 'CRITICAL');
    });

    it('classifies as CRITICAL when statistics have never been updated and modifications exist', () => {
      const res = evaluateStatsStatus({
        modificationRatio: 0.05,
        modificationCounter: 1500,
        rows: 30000,
        lastUpdated: null
      });
      assert.equal(res.status, 'CRITICAL');
      const neverFinding = res.findings.find(f => f.code === 'STATS_NEVER_UPDATED');
      assert.ok(neverFinding);
    });

    it('classifies as STALE when modification ratio is between 0.20 and 0.50', () => {
      const res = evaluateStatsStatus({
        modificationRatio: 0.28,
        modificationCounter: 2800,
        rows: 10000,
        lastUpdated: new Date().toISOString()
      });
      assert.equal(res.status, 'STALE');
      assert.equal(res.severity, 'HIGH');
    });

    it('classifies as STALE when older than 30 days and significant modifications occurred', () => {
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const res = evaluateStatsStatus({
        modificationRatio: 0.08,
        modificationCounter: 800,
        rows: 10000,
        lastUpdated: fortyDaysAgo
      });
      assert.equal(res.status, 'STALE');
      assert.ok(res.daysSinceUpdate >= 39);
    });

    it('classifies as WATCH when modification ratio is between 0.10 and 0.20', () => {
      const res = evaluateStatsStatus({
        modificationRatio: 0.14,
        modificationCounter: 1400,
        rows: 10000,
        lastUpdated: new Date().toISOString()
      });
      assert.equal(res.status, 'WATCH');
      assert.equal(res.severity, 'WARNING');
    });

    it('flags STATS_LOW_SAMPLE on large tables with sample percentage < 15%', () => {
      const res = evaluateStatsStatus({
        modificationRatio: 0.02,
        modificationCounter: 2000,
        rows: 500000,
        samplePercent: 5,
        lastUpdated: new Date().toISOString()
      });
      const lowSample = res.findings.find(f => f.code === 'STATS_LOW_SAMPLE');
      assert.ok(lowSample);
      assert.ok(lowSample.text.includes('%5'));
    });

    it('flags STATS_NORECOMPUTE when auto update is explicitly disabled', () => {
      const res = evaluateStatsStatus({
        modificationRatio: 0.05,
        modificationCounter: 500,
        rows: 10000,
        isNoRecompute: true,
        lastUpdated: new Date().toISOString()
      });
      const noRecompute = res.findings.find(f => f.code === 'STATS_NORECOMPUTE');
      assert.ok(noRecompute);
    });

    it('classifies as HEALTHY when modification ratio is < 0.10 and recent', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const res = evaluateStatsStatus({
        modificationRatio: 0.03,
        modificationCounter: 300,
        rows: 10000,
        samplePercent: 100,
        lastUpdated: twoDaysAgo
      });
      assert.equal(res.status, 'HEALTHY');
      assert.equal(res.severity, 'PASS');
      assert.equal(res.findings.length, 0);
    });
  });

  describe('generateUpdateStatisticsScript', () => {
    it('generates standard safe UPDATE STATISTICS preview script using default sample', () => {
      const res = generateUpdateStatisticsScript({
        schema: 'dbo',
        table: 'STOKLAR',
        statsName: 'PK_STOKLAR'
      });
      assert.equal(res.isReadOnlySafe, true);
      assert.equal(res.autoExecuted, false);
      assert.ok(res.script.includes('UPDATE STATISTICS [dbo].[STOKLAR] [PK_STOKLAR];'));
      assert.ok(!res.script.includes('WITH FULLSCAN'));
      assert.ok(res.script.includes('[GÜVENLİK KURALI]'));
    });

    it('generates UPDATE STATISTICS script WITH FULLSCAN when requested with warning comment', () => {
      const res = generateUpdateStatisticsScript({
        schema: 'sales',
        table: 'Orders',
        statsName: 'IX_Orders_Date',
        withFullScan: true
      });
      assert.ok(res.script.includes('UPDATE STATISTICS [sales].[Orders] [IX_Orders_Date] WITH FULLSCAN;'));
      assert.ok(res.script.includes('[DİKKAT]: FULLSCAN devasa tablolarda yüksek disk I/O'));
    });
  });

  describe('Execution Plan Cardinality Mismatch Correlation', () => {
    it('correlates plan operator cardinality mismatch with stale table statistics', () => {
      const mockParsedPlan = {
        operators: [{ nodeId: 3, physicalOp: 'Index Seek' }],
        cardinalityMismatches: [
          {
            nodeId: 3,
            operator: 'Index Seek',
            object: 'dbo.STOK_HAREKETLERI',
            estimated: 1,
            actual: 45000,
            ratio: 45000,
            factor: '45000× Eksik Tahmin'
          }
        ]
      };

      const mockTableStats = [
        {
          table: 'STOK_HAREKETLERI',
          statsName: 'IX_STOK_HAREKETLERI_TARIH',
          status: 'STALE',
          modificationRatio: 0.38,
          updateScript: 'UPDATE STATISTICS [dbo].[STOK_HAREKETLERI] [IX_STOK_HAREKETLERI_TARIH];'
        }
      ];

      const correlations = correlatePlanWithStatistics(mockParsedPlan, mockTableStats);
      assert.equal(correlations.length, 1);
      assert.equal(correlations[0].code, 'POSSIBLE_STALE_STATISTICS_CAUSE');
      assert.equal(correlations[0].table, 'STOK_HAREKETLERI');
      assert.equal(correlations[0].statsName, 'IX_STOK_HAREKETLERI_TARIH');
      assert.equal(correlations[0].modificationRatio, 0.38);
      assert.ok(correlations[0].explanation.includes('%38'));
      assert.ok(correlations[0].explanation.includes('45000×'));
      assert.ok(correlations[0].recommendedAction.includes('UPDATE STATISTICS'));
    });

    it('does not produce correlation when table statistics are HEALTHY', () => {
      const mockParsedPlan = {
        operators: [{ nodeId: 1 }],
        cardinalityMismatches: [
          {
            nodeId: 1,
            operator: 'Clustered Index Scan',
            object: 'dbo.STOKLAR',
            estimated: 10,
            actual: 200,
            ratio: 20,
            factor: '20× Eksik Tahmin'
          }
        ]
      };

      const mockTableStats = [
        {
          table: 'STOKLAR',
          statsName: 'PK_STOKLAR',
          status: 'HEALTHY',
          modificationRatio: 0.02
        }
      ];

      const correlations = correlatePlanWithStatistics(mockParsedPlan, mockTableStats);
      assert.equal(correlations.length, 0);
    });
  });
});
