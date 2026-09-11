/**
 * SQL Server Refactoring & Performance Studio
 * Plan Comparison Engine Unit Tests (Sprint 3)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const planComparison = require('../public/assets/js/modules/planComparison');
const { comparePlans } = planComparison;

describe('Plan Comparison Engine', () => {

  it('handles empty or undefined plans gracefully', () => {
    const result = comparePlans({}, {});
    assert.strictEqual(result.deltas.costDelta, 0);
    assert.strictEqual(result.deltas.scans, 0);
    assert.strictEqual(result.deltas.seeks, 0);
    assert.ok(result.changes.some(c => c.code === 'PLAN_UNCHANGED'));
  });

  it('calculates cost deltas and percentages accurately', () => {
    const before = { totalSubTreeCost: 10.0, operatorCount: 5 };
    const after = { totalSubTreeCost: 2.5, operatorCount: 3 };
    const result = comparePlans(before, after);

    assert.strictEqual(result.beforeCost, 10.0);
    assert.strictEqual(result.afterCost, 2.5);
    assert.strictEqual(result.deltas.costDelta, -7.5);
    assert.strictEqual(result.deltas.estimatedCostPercent, -75);
    assert.strictEqual(result.deltas.operatorCount, -2);
  });

  it('detects TABLE_SCAN_REMOVED when table scans are eliminated', () => {
    const before = { scans: 2, seeks: 0, operators: [] };
    const after = { scans: 0, seeks: 2, operators: [] };
    const result = comparePlans(before, after);

    assert.ok(result.changes.some(c => c.code === 'TABLE_SCAN_REMOVED' && c.significance === 'POSITIVE'));
    assert.ok(result.changes.some(c => c.code === 'INDEX_SEEK_ADDED' && c.significance === 'POSITIVE'));
  });

  it('detects TABLE_SCAN_ADDED as NEGATIVE regression', () => {
    const before = { scans: 0, seeks: 2, operators: [] };
    const after = { scans: 1, seeks: 1, operators: [] };
    const result = comparePlans(before, after);

    assert.ok(result.changes.some(c => c.code === 'TABLE_SCAN_ADDED' && c.significance === 'NEGATIVE'));
    assert.ok(result.changes.some(c => c.code === 'INDEX_SEEK_REDUCED' && c.significance === 'REVIEW'));
  });

  it('detects KEY_LOOKUP_ADDED as REVIEW risk', () => {
    const before = { lookups: 0, operators: [] };
    const after = { lookups: 1, operators: [] };
    const result = comparePlans(before, after);

    assert.ok(result.changes.some(c => c.code === 'KEY_LOOKUP_ADDED' && c.significance === 'REVIEW'));
  });

  it('detects SORT_REMOVED and SPOOL_REMOVED as POSITIVE optimizations', () => {
    const before = { sorts: 1, spools: 1, operators: [] };
    const after = { sorts: 0, spools: 0, operators: [] };
    const result = comparePlans(before, after);

    assert.ok(result.changes.some(c => c.code === 'SORT_REMOVED' && c.significance === 'POSITIVE'));
    assert.ok(result.changes.some(c => c.code === 'SPOOL_REMOVED' && c.significance === 'POSITIVE'));
  });

  it('detects TEMPDB_SPILL_ADDED as NEGATIVE regression', () => {
    const before = { warnings: [], operators: [] };
    const after = {
      warnings: [{ kind: 'SPILL_TEMPDB', message: 'TempDB spill' }],
      operators: []
    };
    const result = comparePlans(before, after);

    assert.ok(result.changes.some(c => c.code === 'TEMPDB_SPILL_ADDED' && c.significance === 'NEGATIVE'));
  });

  it('detects TEMPDB_SPILL_REMOVED as POSITIVE optimization', () => {
    const before = {
      warnings: [{ kind: 'SPILL_TEMPDB', message: 'TempDB spill' }],
      operators: []
    };
    const after = { warnings: [], operators: [] };
    const result = comparePlans(before, after);

    assert.ok(result.changes.some(c => c.code === 'TEMPDB_SPILL_REMOVED' && c.significance === 'POSITIVE'));
  });

  it('detects IMPLICIT_CONVERSION_ADDED and IMPLICIT_CONVERSION_REMOVED', () => {
    const before = {
      warnings: [{ kind: 'IMPLICIT_CONVERSION', message: 'Convert issue' }],
      operators: []
    };
    const after = { warnings: [], operators: [] };
    const resFix = comparePlans(before, after);
    assert.ok(resFix.changes.some(c => c.code === 'IMPLICIT_CONVERSION_REMOVED' && c.significance === 'POSITIVE'));

    const resAdd = comparePlans(after, before);
    assert.ok(resAdd.changes.some(c => c.code === 'IMPLICIT_CONVERSION_ADDED' && c.significance === 'NEGATIVE'));
  });

  it('detects MISSING_INDEX_RESOLVED when missing index is addressed', () => {
    const before = {
      missingIndexes: [{ table: '[Orders]', impact: 80 }],
      operators: []
    };
    const after = {
      missingIndexes: [],
      operators: []
    };
    const result = comparePlans(before, after);
    assert.ok(result.changes.some(c => c.code === 'MISSING_INDEX_RESOLVED' && c.significance === 'POSITIVE'));
  });

});
