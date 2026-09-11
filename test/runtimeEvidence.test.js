/**
 * SQL Server Refactoring & Performance Studio
 * Runtime Evidence Service Unit Tests (Sprint 2 - Query Store Regression Engine)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  WINDOW_MAP,
  REGRESSION_THRESHOLDS,
  resolveWindowConfig,
  calculateDelta,
  calculateSeverityScore,
  calculateConfidence,
  detectRegression,
  matchViewToQuery,
  buildQueryStoreMetricsQuery,
  buildQueryStoreTimeseriesQuery,
  buildPlanCacheFallbackQuery
} = require('../server/services/runtimeEvidence');

describe('Runtime Evidence - Window Mapping & Safety', () => {

  it('contains valid whitelisted windows (1h, 24h, 7d, 30d)', () => {
    assert.ok(WINDOW_MAP['1h'], '1h must exist in WINDOW_MAP');
    assert.ok(WINDOW_MAP['24h'], '24h must exist in WINDOW_MAP');
    assert.ok(WINDOW_MAP['7d'], '7d must exist in WINDOW_MAP');
    assert.ok(WINDOW_MAP['30d'], '30d must exist in WINDOW_MAP');
  });

  it('only uses whitelisted datepart keywords (hour or day)', () => {
    const allowedDateparts = ['hour', 'day'];
    for (const [key, cfg] of Object.entries(WINDOW_MAP)) {
      assert.ok(
        allowedDateparts.includes(cfg.datepart),
        `Window ${key} has invalid datepart "${cfg.datepart}". Must be in: ${allowedDateparts.join(', ')}`
      );
      assert.ok(Number.isInteger(cfg.currentOffset) && cfg.currentOffset > 0, `Window ${key} offset must be positive integer`);
      assert.ok(Number.isInteger(cfg.bucketMinutes) && cfg.bucketMinutes > 0, `Window ${key} bucketMinutes must be positive integer`);
    }
  });

  it('maps valid windows accurately via resolveWindowConfig', () => {
    const w1h = resolveWindowConfig('1h');
    assert.strictEqual(w1h.key, '1h');
    assert.strictEqual(w1h.datepart, 'hour');
    assert.strictEqual(w1h.currentOffset, 1);
    assert.strictEqual(w1h.baselineOffset, 2);

    const w7d = resolveWindowConfig('7d');
    assert.strictEqual(w7d.key, '7d');
    assert.strictEqual(w7d.datepart, 'day');
    assert.strictEqual(w7d.currentOffset, 7);
    assert.strictEqual(w7d.baselineOffset, 14);
  });

  it('falls back safely to 24h default for invalid or unknown window keys', () => {
    const fallbackEmpty = resolveWindowConfig('');
    assert.strictEqual(fallbackEmpty.key, '24h');
    assert.strictEqual(fallbackEmpty.currentOffset, 24);

    const fallbackUnknown = resolveWindowConfig('999y');
    assert.strictEqual(fallbackUnknown.key, '24h');

    const fallbackNull = resolveWindowConfig(null);
    assert.strictEqual(fallbackNull.key, '24h');
  });

  it('prevents SQL injection through malicious window strings', () => {
    const malicious = "24h); DROP TABLE STOKLAR; --";
    const resolved = resolveWindowConfig(malicious);
    assert.strictEqual(resolved.key, '24h');
    assert.strictEqual(resolved.datepart, 'hour');
    assert.strictEqual(resolved.currentOffset, 24);
  });

});

describe('Runtime Evidence - Pure Metric Calculations', () => {

  describe('calculateDelta', () => {
    it('calculates standard positive delta correctly', () => {
      const delta = calculateDelta(150, 100);
      assert.strictEqual(delta.deltaValue, 50);
      assert.strictEqual(delta.deltaPercent, 50);
    });

    it('calculates negative delta when performance improves', () => {
      const delta = calculateDelta(70, 100);
      assert.strictEqual(delta.deltaValue, -30);
      assert.strictEqual(delta.deltaPercent, -30);
    });

    it('handles zero baseline gracefully without throwing division by zero', () => {
      const deltaZero = calculateDelta(100, 0);
      assert.strictEqual(deltaZero.deltaValue, 100);
      assert.strictEqual(deltaZero.deltaPercent, 100);

      const deltaBothZero = calculateDelta(0, 0);
      assert.strictEqual(deltaBothZero.deltaValue, 0);
      assert.strictEqual(deltaBothZero.deltaPercent, 0);
    });

    it('handles null or undefined inputs safely', () => {
      const deltaNull = calculateDelta(null, 50);
      assert.strictEqual(deltaNull.deltaValue, -50);
      assert.strictEqual(deltaNull.deltaPercent, -100);
    });
  });

  describe('calculateSeverityScore', () => {
    it('assigns INFO category for low degradation without plan change', () => {
      const res = calculateSeverityScore({ durationDeltaPct: 15, cpuDeltaPct: 10, readsDeltaPct: 10, planChanged: false });
      assert.ok(res.severityScore < 30);
      assert.strictEqual(res.severityCategory, 'INFO');
    });

    it('assigns MODERATE category for 30-50% degradation', () => {
      const res = calculateSeverityScore({ durationDeltaPct: 35, cpuDeltaPct: 20, readsDeltaPct: 30, planChanged: false });
      assert.ok(res.severityScore >= 30 && res.severityScore < 60);
      assert.strictEqual(res.severityCategory, 'MODERATE');
    });

    it('assigns HIGH category for substantial degradation', () => {
      const res = calculateSeverityScore({ durationDeltaPct: 75, cpuDeltaPct: 60, readsDeltaPct: 70, planChanged: false });
      assert.ok(res.severityScore >= 60 && res.severityScore < 80);
      assert.strictEqual(res.severityCategory, 'HIGH');
    });

    it('assigns CRITICAL category for severe degradation with plan change', () => {
      const res = calculateSeverityScore({ durationDeltaPct: 250, cpuDeltaPct: 150, readsDeltaPct: 200, planChanged: true });
      assert.ok(res.severityScore >= 80);
      assert.strictEqual(res.severityCategory, 'CRITICAL');
    });

    it('caps maximum severity score at 100', () => {
      const res = calculateSeverityScore({ durationDeltaPct: 10000, cpuDeltaPct: 5000, readsDeltaPct: 5000, planChanged: true });
      assert.strictEqual(res.severityScore, 100);
    });
  });

  describe('calculateConfidence', () => {
    it('returns HIGH confidence for exact object match with sufficient executions', () => {
      const conf = calculateConfidence({ executionCount: 25, attributionMethod: 'OBJECT_CORRELATED', planCount: 1 });
      assert.strictEqual(conf, 'HIGH');
    });

    it('returns MEDIUM confidence for text matching with moderate executions', () => {
      const conf = calculateConfidence({ executionCount: 12, attributionMethod: 'TEXT_SEARCH', planCount: 1 });
      assert.strictEqual(conf, 'MEDIUM');
    });

    it('returns LOW confidence when execution count is low or attribution is weak', () => {
      const confLow = calculateConfidence({ executionCount: 3, attributionMethod: 'NONE', planCount: 0 });
      assert.strictEqual(confLow, 'LOW');
    });
  });

});

describe('Runtime Evidence - Regression Decision Engine', () => {

  it('rejects regression if current execution count is below minimum threshold (< 3)', () => {
    const current = { avgDurationMs: 1500, avgCpuMs: 500, totalLogicalReads: 50000, executionCount: 2, planIds: [2] };
    const baseline = { avgDurationMs: 100, avgCpuMs: 50, totalLogicalReads: 1000, executionCount: 100, planIds: [1] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, false);
    assert.strictEqual(decision.reasons.length, 0);
  });

  it('reports no regression if baseline has 0 executions (new activity, not degradation)', () => {
    const current = { avgDurationMs: 800, avgCpuMs: 200, totalLogicalReads: 5000, executionCount: 10, planIds: [1] };
    const baseline = { avgDurationMs: 0, avgCpuMs: 0, totalLogicalReads: 0, executionCount: 0, planIds: [] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, false);
  });

  it('detects duration regression when degradation is >= 30% and >= 100ms delta', () => {
    const baseline = { avgDurationMs: 200, avgCpuMs: 100, totalLogicalReads: 5000, executionCount: 20, planIds: [1] };
    const current = { avgDurationMs: 400, avgCpuMs: 110, totalLogicalReads: 5200, executionCount: 20, planIds: [1] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, true);
    assert.strictEqual(decision.durationDeltaMs, 200);
    assert.strictEqual(decision.durationDeltaPercent, 100);
    assert.ok(decision.reasons.some(r => r.includes('Süre Regresyonu')));
  });

  it('does NOT trigger duration regression if percent is >= 30% but absolute ms is trivial (< 100ms)', () => {
    // 5ms -> 8ms (+60%, but only +3ms absolute delta)
    const baseline = { avgDurationMs: 5, avgCpuMs: 2, totalLogicalReads: 100, executionCount: 50, planIds: [1] };
    const current = { avgDurationMs: 8, avgCpuMs: 3, totalLogicalReads: 120, executionCount: 50, planIds: [1] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, false);
  });

  it('detects CPU regression when CPU degradation is >= 30%', () => {
    const baseline = { avgDurationMs: 200, avgCpuMs: 50, totalLogicalReads: 5000, executionCount: 20, planIds: [1] };
    const current = { avgDurationMs: 220, avgCpuMs: 120, totalLogicalReads: 5000, executionCount: 20, planIds: [1] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, true);
    assert.strictEqual(decision.cpuDeltaPercent, 140);
    assert.ok(decision.reasons.some(r => r.includes('CPU Tüketim Sıçraması')));
  });

  it('detects logical reads regression when reads degradation is >= 30%', () => {
    const baseline = { avgDurationMs: 200, avgCpuMs: 50, totalLogicalReads: 10000, executionCount: 20, planIds: [1] };
    const current = { avgDurationMs: 220, avgCpuMs: 60, totalLogicalReads: 30000, executionCount: 20, planIds: [1] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, true);
    assert.strictEqual(decision.readsDeltaPercent, 200);
    assert.ok(decision.reasons.some(r => r.includes('Mantıksal Okuma Artışı')));
  });

  it('detects plan flip when active plan ID changes between windows', () => {
    const baseline = { avgDurationMs: 200, avgCpuMs: 50, totalLogicalReads: 5000, executionCount: 20, planIds: [101] };
    const current = { avgDurationMs: 350, avgCpuMs: 90, totalLogicalReads: 8000, executionCount: 20, planIds: [205] };
    const decision = detectRegression(current, baseline);

    assert.strictEqual(decision.isRegressed, true);
    assert.strictEqual(decision.planChanged, true);
    assert.strictEqual(decision.baselinePlanId, 101);
    assert.strictEqual(decision.currentPlanId, 205);
    assert.ok(decision.reasons.some(r => r.includes('Plan Değişimi')));
  });

});

describe('Runtime Evidence - View to Query Matching', () => {

  const sampleView = {
    name: 'AA_SIPARIS_OZET',
    schema_name: 'dbo',
    object_id: 884422,
    canonicalId: 'MikroDB_V16.dbo.AA_SIPARIS_OZET'
  };

  it('matches by exact object_id with MATCH_EXACT_OBJECT', () => {
    const queryRow = {
      object_id: 884422,
      query_sql_text: 'SELECT * FROM SomeCorrelatedQuery'
    };
    const res = matchViewToQuery(sampleView, queryRow);
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.confidence, 'MATCH_EXACT_OBJECT');
  });

  it('matches by schema-qualified name in SQL text with MATCH_TEXT', () => {
    const queryRow = {
      object_id: null,
      query_sql_text: 'SELECT s.Id, s.Tutar FROM dbo.AA_SIPARIS_OZET s WHERE s.Tarih > GETDATE()'
    };
    const res = matchViewToQuery(sampleView, queryRow);
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.confidence, 'MATCH_TEXT');
  });

  it('matches by bracket-escaped name in SQL text with MATCH_TEXT', () => {
    const queryRow = {
      object_id: null,
      query_sql_text: 'SELECT * FROM [dbo].[AA_SIPARIS_OZET]'
    };
    const res = matchViewToQuery(sampleView, queryRow);
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.confidence, 'MATCH_TEXT');
  });

  it('returns matched=false for unrelated SQL text', () => {
    const queryRow = {
      object_id: null,
      query_sql_text: 'SELECT * FROM dbo.STOKLAR WHERE aktif = 1'
    };
    const res = matchViewToQuery(sampleView, queryRow);
    assert.strictEqual(res.matched, false);
    assert.strictEqual(res.confidence, 'MATCH_UNKNOWN');
  });

});

describe('Runtime Evidence - SQL Query Builders', () => {

  it('buildQueryStoreMetricsQuery generates valid Query Store SQL with microseconds to ms conversion', () => {
    const winSpec = resolveWindowConfig('24h');
    const sql = buildQueryStoreMetricsQuery(winSpec);

    assert.ok(sql.includes('sys.query_store_runtime_stats'), 'Must query query_store_runtime_stats');
    assert.ok(sql.includes('sys.query_store_plan'), 'Must join query_store_plan');
    assert.ok(sql.includes('sys.query_store_query'), 'Must join query_store_query');
    assert.ok(sql.includes('/ 1000.0'), 'Must convert microsecond duration to ms');
    assert.ok(sql.includes("DATEADD(hour, -24, GETUTCDATE())"), 'Must calculate current window offset');
    assert.ok(sql.includes("DATEADD(hour, -48, GETUTCDATE())"), 'Must calculate baseline window offset');
  });

  it('buildQueryStoreTimeseriesQuery groups by bucket intervals', () => {
    const winSpec = resolveWindowConfig('7d');
    const sql = buildQueryStoreTimeseriesQuery(winSpec);

    assert.ok(sql.includes('bucket_start'), 'Must include bucket_start');
    assert.ok(sql.includes('avg_duration_ms'), 'Must calculate avg_duration_ms');
    assert.ok(sql.includes('ORDER BY bucket_start ASC'), 'Must order timeseries chronologically');
  });

  it('buildPlanCacheFallbackQuery queries sys.dm_exec_query_stats with safe conversion', () => {
    const sql = buildPlanCacheFallbackQuery();

    assert.ok(sql.includes('sys.dm_exec_query_stats'), 'Must query sys.dm_exec_query_stats');
    assert.ok(sql.includes('sys.dm_exec_sql_text'), 'Must join sys.dm_exec_sql_text');
    assert.ok(sql.includes('/ 1000.0'), 'Must convert microseconds to ms');
  });

});
