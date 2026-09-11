/**
 * SQL Server Refactoring & Performance Studio
 * Benchmark Comparison Engine Unit Tests (Sprint 3)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const benchmarkComparison = require('../public/assets/js/modules/benchmarkComparison');
const { compareBenchmarks, extractBenchmarkMetrics } = benchmarkComparison;

describe('Benchmark Comparison Engine', () => {

  it('extracts benchmark metrics from standard benchmark result structure', () => {
    const raw = {
      metrics: {
        medianDurationMs: 120,
        p95DurationMs: 150,
        medianLogicalReads: 25000
      },
      runs: [
        { iteration: 1, durationMs: 110, cpuMs: 95, logicalReads: 25000, rows: 50 },
        { iteration: 2, durationMs: 120, cpuMs: 100, logicalReads: 25000, rows: 50 },
        { iteration: 3, durationMs: 130, cpuMs: 105, logicalReads: 25000, rows: 50 }
      ]
    };
    const extracted = extractBenchmarkMetrics(raw);
    assert.strictEqual(extracted.durationMs, 120);
    assert.strictEqual(extracted.p95DurationMs, 150);
    assert.strictEqual(extracted.logicalReads, 25000);
    assert.strictEqual(extracted.cpuMs, 100);
    assert.strictEqual(extracted.rows, 50);
    assert.strictEqual(extracted.runsCount, 3);
  });

  it('handles empty or zeroed benchmark inputs safely', () => {
    const result = compareBenchmarks({}, {});
    assert.strictEqual(result.deltas.durationMs, 0);
    assert.strictEqual(result.improvements.durationPercent, 0);
    assert.strictEqual(result.isRowCountEqual, true);
    assert.strictEqual(result.winner, 'TIE');
  });

  it('declares CANDIDATE as winner when duration and reads improve significantly', () => {
    const orig = {
      durationMs: 200,
      logicalReads: 10000,
      cpuMs: 180,
      rows: 100
    };
    const cand = {
      durationMs: 50,
      logicalReads: 2000,
      cpuMs: 40,
      rows: 100
    };
    const result = compareBenchmarks(orig, cand);

    assert.strictEqual(result.improvements.durationPercent, 75); // 75% faster
    assert.strictEqual(result.improvements.readsPercent, 80);    // 80% fewer reads
    assert.strictEqual(result.deltas.durationMs, -150);
    assert.strictEqual(result.isRowCountEqual, true);
    assert.strictEqual(result.winner, 'CANDIDATE');
    assert.strictEqual(result.outcomeType, 'POSITIVE');
    assert.ok(result.summary.includes('Aday versiyon daha başarılı'));
  });

  it('declares ORIGINAL as winner when candidate regresses significantly', () => {
    const orig = {
      durationMs: 100,
      logicalReads: 1000,
      cpuMs: 90,
      rows: 50
    };
    const cand = {
      durationMs: 250,
      logicalReads: 3000,
      cpuMs: 220,
      rows: 50
    };
    const result = compareBenchmarks(orig, cand);

    assert.ok(result.improvements.durationPercent <= -100);
    assert.strictEqual(result.winner, 'ORIGINAL');
    assert.strictEqual(result.outcomeType, 'NEGATIVE');
    assert.ok(result.summary.includes('regresyon'));
  });

  it('declares TIE when performance differences are within noise threshold (<10%)', () => {
    const orig = { durationMs: 100, logicalReads: 1000, rows: 25 };
    const cand = { durationMs: 98, logicalReads: 1000, rows: 25 };
    const result = compareBenchmarks(orig, cand);

    assert.strictEqual(result.winner, 'TIE');
    assert.strictEqual(result.outcomeType, 'NEUTRAL');
  });

  it('flags INVALID_ROW_COUNT with CRITICAL outcome if row counts differ', () => {
    const orig = { durationMs: 100, logicalReads: 1000, rows: 100 };
    const cand = { durationMs: 10, logicalReads: 100, rows: 95 }; // 5 rows missing!
    const result = compareBenchmarks(orig, cand);

    assert.strictEqual(result.isRowCountEqual, false);
    assert.strictEqual(result.deltas.rowCount, -5);
    assert.strictEqual(result.winner, 'INVALID_ROW_COUNT');
    assert.strictEqual(result.outcomeType, 'CRITICAL');
    assert.ok(result.summary.includes('DİKKAT: Orijinal sorgu 100 satır, Aday sorgu 95 satır döndürdü'));
  });

});
