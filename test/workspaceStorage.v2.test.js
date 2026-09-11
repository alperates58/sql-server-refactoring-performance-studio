const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { WorkspaceStorage, SCHEMA_VERSION } = require('../server/services/workspaceStorage');

describe('Workspace Storage Schema V2 & Workbench Persistence Tests (Sprint 7)', () => {
  let tempDir;
  let sqlitePath;
  let jsonPath;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlstudio_test_wb_'));
    sqlitePath = path.join(tempDir, 'test_workspaces_v2.db');
    jsonPath = path.join(tempDir, 'test_workspaces_v2.local.json');
    storage = new WorkspaceStorage({
      runtimeDir: tempDir,
      sqliteFile: sqlitePath,
      jsonFile: jsonPath
    });
  });

  afterEach(() => {
    if (storage) {
      storage.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Schema V2 Initialization & Verification', () => {
    it('initializes with SCHEMA_VERSION = 2', () => {
      const status = storage.getStatus();
      assert.equal(status.available, true);
      assert.equal(status.schemaVersion, 2);
    });

    it('creates query_history and workbench_sessions tables in SQLite mode', () => {
      const status = storage.getStatus();
      if (status.backend === 'SQLITE' && storage.sqliteDb) {
        const historyTable = storage.sqliteDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='query_history'"
        ).get();
        assert.ok(historyTable, 'query_history table must exist');

        const sessionTable = storage.sqliteDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workbench_sessions'"
        ).get();
        assert.ok(sessionTable, 'workbench_sessions table must exist');
      }
    });
  });

  describe('Query History CRUD & Duplicate Compression', () => {
    it('saves a new query history entry and retrieves it by id', () => {
      const entry = {
        database: 'MikroDesktop_LIDER26',
        sql: 'SELECT TOP 10 * FROM dbo.STOKLAR',
        durationMs: 120,
        rowCount: 10,
        success: true
      };

      const result = storage.saveQueryHistory(entry);
      assert.ok(result.id, 'Must return an id');

      const retrieved = storage.getQueryHistoryById(result.id);
      assert.ok(retrieved);
      assert.equal(retrieved.database, 'MikroDesktop_LIDER26');
      assert.equal(retrieved.sql, 'SELECT TOP 10 * FROM dbo.STOKLAR');
      assert.equal(retrieved.durationMs, 120);
      assert.equal(retrieved.rowCount, 10);
      assert.equal(retrieved.success, true);
      assert.equal(retrieved.executionCount, 1);
    });

    it('compresses duplicates executed within duplicate window (30s)', () => {
      const entry1 = {
        database: 'MikroDesktop_LIDER26',
        sql: 'SELECT COUNT(*) FROM dbo.CARI_HESAPLAR',
        durationMs: 45,
        rowCount: 1,
        success: true
      };
      const res1 = storage.saveQueryHistory(entry1);
      assert.ok(res1.id);

      const entry2 = {
        database: 'MikroDesktop_LIDER26',
        sql: 'SELECT COUNT(*) FROM dbo.CARI_HESAPLAR',
        durationMs: 50,
        rowCount: 1,
        success: true
      };
      const res2 = storage.saveQueryHistory(entry2);
      assert.equal(res2.id, res1.id);

      const updated = storage.getQueryHistoryById(res1.id);
      assert.equal(updated.executionCount, 2);
      assert.equal(updated.durationMs, 50);
    });

    it('records query failure with error message', () => {
      const entry = {
        database: 'MikroDesktop_LIDER26',
        sql: 'SELECT * FROM dbo.NON_EXISTENT_TABLE_XYZ',
        durationMs: 15,
        rowCount: 0,
        success: false,
        errorMessage: 'Invalid object name dbo.NON_EXISTENT_TABLE_XYZ'
      };
      const res = storage.saveQueryHistory(entry);
      const retrieved = storage.getQueryHistoryById(res.id);
      assert.equal(retrieved.success, false);
      assert.equal(retrieved.errorMessage, 'Invalid object name dbo.NON_EXISTENT_TABLE_XYZ');
    });

    it('lists query history with pagination (limit and offset)', () => {
      for (let i = 1; i <= 5; i++) {
        storage.saveQueryHistory({
          database: 'DB_' + i,
          sql: `SELECT ${i} FROM dbo.Table_${i}`,
          durationMs: i * 10,
          rowCount: i,
          success: true
        }, { duplicateWindowSeconds: 0 });
      }

      const page1 = storage.listQueryHistory({ limit: 2, offset: 0 });
      assert.equal(page1.items.length, 2);
      assert.equal(page1.total, 5);

      const page2 = storage.listQueryHistory({ limit: 2, offset: 2 });
      assert.equal(page2.items.length, 2);

      const page3 = storage.listQueryHistory({ limit: 2, offset: 4 });
      assert.equal(page3.items.length, 1);
    });

    it('filters query history by search keyword', () => {
      storage.saveQueryHistory({
        database: 'SalesDB',
        sql: 'SELECT customer_id, balance FROM dbo.Customers',
        durationMs: 80,
        success: true
      }, { duplicateWindowSeconds: 0 });

      storage.saveQueryHistory({
        database: 'SalesDB',
        sql: 'SELECT order_id, total FROM dbo.Orders',
        durationMs: 110,
        success: true
      }, { duplicateWindowSeconds: 0 });

      const searchRes = storage.listQueryHistory({ search: 'Customers' });
      assert.equal(searchRes.items.length, 1);
      assert.ok(searchRes.items[0].sql.includes('Customers'));
    });

    it('filters query history by database name and successOnly', () => {
      storage.saveQueryHistory({
        database: 'DB_A',
        sql: 'SELECT 1',
        success: true
      }, { duplicateWindowSeconds: 0 });

      storage.saveQueryHistory({
        database: 'DB_B',
        sql: 'SELECT 2',
        success: true
      }, { duplicateWindowSeconds: 0 });

      storage.saveQueryHistory({
        database: 'DB_A',
        sql: 'SELECT 3_ERROR',
        success: false
      }, { duplicateWindowSeconds: 0 });

      const resDbA = storage.listQueryHistory({ database: 'DB_A' });
      assert.equal(resDbA.items.length, 2);

      const resDbASuccess = storage.listQueryHistory({ database: 'DB_A', successOnly: true });
      assert.equal(resDbASuccess.items.length, 1);
      assert.equal(resDbASuccess.items[0].success, true);
    });

    it('deletes a single query history item by id', () => {
      const res = storage.saveQueryHistory({
        database: 'TestDB',
        sql: 'SELECT 123',
        success: true
      });
      assert.ok(storage.getQueryHistoryById(res.id));

      const deleted = storage.deleteQueryHistory(res.id);
      assert.equal(deleted, true);
      assert.equal(storage.getQueryHistoryById(res.id), null);
    });

    it('clears all query history', () => {
      storage.saveQueryHistory({ database: 'DB1', sql: 'Q1', success: true }, { duplicateWindowSeconds: 0 });
      storage.saveQueryHistory({ database: 'DB2', sql: 'Q2', success: true }, { duplicateWindowSeconds: 0 });
      assert.equal(storage.listQueryHistory().total, 2);

      storage.clearQueryHistory();
      assert.equal(storage.listQueryHistory().total, 0);
    });
  });

  describe('Workbench Sessions Persistence', () => {
    it('saves and restores workbench tab sessions', () => {
      const mockTabs = [
        {
          id: 'tab-1',
          title: 'Sorgu 1',
          sql: 'SELECT TOP 10 * FROM dbo.STOKLAR',
          database: 'MikroDesktop_LIDER26',
          isDirty: false
        },
        {
          id: 'tab-2',
          title: 'Müşteri Bakiyeleri',
          sql: 'SELECT cari_kod, bakiye FROM dbo.CARI_HESAPLAR',
          database: 'MikroDesktop_LIDER26',
          isDirty: true
        }
      ];

      const saved = storage.saveWorkbenchSessions(mockTabs);
      assert.equal(saved, true);

      const restored = storage.getWorkbenchSessions();
      assert.equal(restored.length, 2);
      assert.equal(restored[0].id, 'tab-1');
      assert.equal(restored[0].title, 'Sorgu 1');
      assert.equal(restored[1].id, 'tab-2');
      assert.equal(restored[1].title, 'Müşteri Bakiyeleri');
      assert.equal(restored[1].isDirty, true);
    });

    it('clears workbench tab sessions', () => {
      storage.saveWorkbenchSessions([{ id: 'tab-1', title: 'Test', sql: 'SELECT 1' }]);
      assert.equal(storage.getWorkbenchSessions().length, 1);

      storage.clearWorkbenchSessions();
      assert.equal(storage.getWorkbenchSessions().length, 0);
    });
  });

  describe('JSON Fallback Mode for Schema V2', () => {
    it('supports full query history and session persistence in forced JSON mode', () => {
      const jsonStorage = new WorkspaceStorage({
        runtimeDir: tempDir,
        sqliteFile: path.join(tempDir, 'dummy.db'),
        jsonFile: path.join(tempDir, 'forced_v2.json'),
        forceJson: true
      });

      try {
        const st = jsonStorage.getStatus();
        assert.equal(st.backend, 'JSON');
        assert.equal(st.schemaVersion, 2);

        // History in JSON
        const hRes = jsonStorage.saveQueryHistory({
          database: 'JsonDB',
          sql: 'SELECT 456',
          durationMs: 22,
          success: true
        });
        assert.ok(hRes.id);

        const list = jsonStorage.listQueryHistory();
        assert.equal(list.total, 1);
        assert.equal(list.items[0].database, 'JsonDB');

        // Sessions in JSON
        jsonStorage.saveWorkbenchSessions([{ id: 'tab-json', title: 'JSON Tab', sql: 'SELECT 99' }]);
        const sessions = jsonStorage.getWorkbenchSessions();
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].title, 'JSON Tab');
      } finally {
        jsonStorage.close();
      }
    });
  });
});
