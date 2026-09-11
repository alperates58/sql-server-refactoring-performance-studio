const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { WorkspaceStorage } = require('../server/services/workspaceStorage');
const { QueryHistoryService } = require('../server/services/queryHistoryService');

describe('Query History Service Tests (Sprint 7)', () => {
  let tempDir;
  let sqlitePath;
  let jsonPath;
  let storage;
  let historyService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlstudio_test_qhs_'));
    sqlitePath = path.join(tempDir, 'test_history.db');
    jsonPath = path.join(tempDir, 'test_history.json');
    storage = new WorkspaceStorage({
      runtimeDir: tempDir,
      sqliteFile: sqlitePath,
      jsonFile: jsonPath
    });
    historyService = new QueryHistoryService(storage);
  });

  afterEach(() => {
    if (storage) {
      storage.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Recording & Retrieving Query History', () => {
    it('records successful query execution', () => {
      const record = historyService.recordExecution({
        sql: 'SELECT TOP 100 * FROM dbo.FATURALAR',
        database: 'MikroDesktop_LIDER26',
        durationMs: 150,
        cpuMs: 25,
        logicalReads: 420,
        rowCount: 100,
        success: true
      });

      assert.ok(record.id);
      assert.equal(record.sql, 'SELECT TOP 100 * FROM dbo.FATURALAR');
      assert.equal(record.success, true);
      assert.equal(record.logicalReads, 420);
    });

    it('records failed query execution with error message', () => {
      const record = historyService.recordExecution({
        sql: 'SELECT * FROM dbo.MISSING_TABLE',
        database: 'MikroDesktop_LIDER26',
        durationMs: 10,
        success: false,
        errorCode: 'INVALID_OBJECT',
        errorMessage: 'Invalid object name dbo.MISSING_TABLE'
      });

      assert.ok(record.id);
      assert.equal(record.success, false);
      assert.equal(record.errorCode, 'INVALID_OBJECT');
      assert.equal(record.errorMessage, 'Invalid object name dbo.MISSING_TABLE');
    });

    it('fetches query history by id', () => {
      const created = historyService.recordExecution({
        sql: 'SELECT 1 AS ID',
        database: 'TestDB',
        durationMs: 5,
        success: true
      });

      const fetched = historyService.getHistoryById(created.id);
      assert.ok(fetched);
      assert.equal(fetched.id, created.id);
      assert.equal(fetched.sql, 'SELECT 1 AS ID');
    });

    it('deletes specific history item', () => {
      const created = historyService.recordExecution({
        sql: 'SELECT 999',
        database: 'TestDB',
        durationMs: 5,
        success: true
      });

      const deleted = historyService.deleteHistory(created.id);
      assert.equal(deleted, true);

      const fetched = historyService.getHistoryById(created.id);
      assert.equal(fetched, null);
    });

    it('clears all history', () => {
      historyService.recordExecution({ sql: 'SELECT 1', database: 'DB1', success: true }, { duplicateWindowSeconds: 0 });
      historyService.recordExecution({ sql: 'SELECT 2', database: 'DB2', success: true }, { duplicateWindowSeconds: 0 });

      const before = historyService.getHistory();
      assert.equal(before.total, 2);

      historyService.clearHistory();
      const after = historyService.getHistory();
      assert.equal(after.total, 0);
      assert.equal(after.items.length, 0);
    });
  });

  describe('Query History Statistics Calculation', () => {
    it('returns default zero metrics on empty history', () => {
      const stats = historyService.getHistoryStats();
      assert.equal(stats.uniqueQueries, 0);
      assert.equal(stats.totalExecutions, 0);
      assert.equal(stats.successRate, 100);
      assert.equal(stats.avgDurationMs, 0);
      assert.equal(stats.totalLogicalReads, 0);
    });

    it('calculates correct aggregate statistics across multiple queries', () => {
      // Query 1: success, 100ms, 500 reads
      historyService.recordExecution({
        sql: 'SELECT 1',
        database: 'DB1',
        durationMs: 100,
        logicalReads: 500,
        success: true
      }, { duplicateWindowSeconds: 0 });

      // Query 2: success, 200ms, 300 reads
      historyService.recordExecution({
        sql: 'SELECT 2',
        database: 'DB1',
        durationMs: 200,
        logicalReads: 300,
        success: true
      }, { duplicateWindowSeconds: 0 });

      // Query 3: failed, 50ms, 0 reads
      historyService.recordExecution({
        sql: 'SELECT 3_FAIL',
        database: 'DB1',
        durationMs: 50,
        logicalReads: 0,
        success: false
      }, { duplicateWindowSeconds: 0 });

      const stats = historyService.getHistoryStats();
      assert.equal(stats.uniqueQueries, 3);
      assert.equal(stats.totalExecutions, 3);
      // 2 successes out of 3 = 67%
      assert.equal(stats.successRate, 67);
      // avg duration = (100 + 200 + 50) / 3 = 117ms
      assert.equal(stats.avgDurationMs, 117);
      // total reads = 500 + 300 = 800
      assert.equal(stats.totalLogicalReads, 800);
    });

    it('aggregates repeated executions correctly in stats', () => {
      const q = {
        sql: 'SELECT TOP 10 * FROM dbo.STOKLAR',
        database: 'MikroDesktop_LIDER26',
        durationMs: 80,
        logicalReads: 200,
        success: true
      };

      // Run 3 times (will compress into duplicate with execution_count = 3)
      historyService.recordExecution(q);
      historyService.recordExecution(q);
      historyService.recordExecution(q);

      const stats = historyService.getHistoryStats();
      assert.equal(stats.uniqueQueries, 1);
      assert.equal(stats.totalExecutions, 3);
      assert.equal(stats.successRate, 100);
    });
  });
});
