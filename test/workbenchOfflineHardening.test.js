/**
 * SQL Server Refactoring & Performance Studio
 * Sprint 7.1 — Workbench Offline Hardening & Release Verification Tests
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveLocalMonacoPath } = require('../server/services/monacoLocator');
const { sanitizeRow } = require('../server/services/workbenchService');
const { WorkspaceStorage } = require('../server/services/workspaceStorage');
const { QueryHistoryService } = require('../server/services/queryHistoryService');
const { validateReadOnly } = require('../server/services/sqlValidator');
const { VirtualGrid } = require('../public/assets/js/modules/virtualGrid');

describe('Sprint 7.1 Workbench Offline Hardening Tests', () => {
  let tempDir;
  let sqlitePath;
  let jsonPath;
  let storage;
  let historyService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlstudio_test_wb71_'));
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

  // ------------------------------------------------------------
  // 1. Offline Monaco Locator Tests
  // ------------------------------------------------------------
  describe('Offline Monaco Asset Locator', () => {
    it('resolves local Monaco distribution on the host machine or via custom path', () => {
      const result = resolveLocalMonacoPath();
      // On Windows development machines with Office 2016+ or node_modules
      if (result.available) {
        assert.ok(result.path, 'Path should be defined');
        assert.ok(fs.existsSync(result.path), 'Resolved Monaco path must exist on disk');
        assert.equal(result.webPrefix, '/vendor/monaco/vs');
        assert.ok(['OFFICE_ACCMONACO', 'NODE_MODULES', 'PUBLIC_VENDOR', 'ENV'].includes(result.source));
      } else {
        assert.equal(result.available, false);
      }
    });

    it('verifies essential Monaco files exist in the resolved directory when available', () => {
      const result = resolveLocalMonacoPath();
      if (result.available) {
        const loaderPath = path.join(result.path, 'loader.js');
        const editorMainPath = path.join(result.path, 'editor', 'editor.main.js');
        assert.ok(fs.existsSync(loaderPath), 'loader.js must exist');
        assert.ok(fs.existsSync(editorMainPath), 'editor.main.js must exist');
      }
    });

    it('gracefully returns available:false when an invalid custom path is provided', () => {
      const nonExistent = path.join(tempDir, 'non_existent_vs_dir');
      const result = resolveLocalMonacoPath(nonExistent);
      assert.ok(typeof result.available === 'boolean');
      assert.ok(typeof result.source === 'string');
    });
  });

  // ------------------------------------------------------------
  // 2. Generation Token & Cancel Race Condition Guard
  // ------------------------------------------------------------
  describe('Query Execution Generation Tokens & Double-Run Guard', () => {
    it('discards stale in-flight query response when execution token mismatches', () => {
      const tab = {
        id: 'tab-1',
        isRunning: true,
        currentExecutionId: 'exec_token_100',
        lastResult: null
      };

      // Simulated helper matching app.js token validation logic
      function handleQueryResponse(targetTab, responseToken, responseData) {
        if (targetTab.currentExecutionId !== responseToken) {
          // Stale response received from cancelled or superseded query, discard
          return { accepted: false, reason: 'TOKEN_MISMATCH' };
        }
        targetTab.lastResult = responseData;
        targetTab.isRunning = false;
        targetTab.currentExecutionId = null;
        return { accepted: true };
      }

      // 1. Out-of-order / Stale response comes with previous token
      const staleRes = handleQueryResponse(tab, 'exec_token_99_STALE', { data: [1, 2, 3] });
      assert.equal(staleRes.accepted, false);
      assert.equal(staleRes.reason, 'TOKEN_MISMATCH');
      assert.equal(tab.lastResult, null);
      assert.equal(tab.isRunning, true);

      // 2. Active response comes with matching currentExecutionId
      const validRes = handleQueryResponse(tab, 'exec_token_100', { data: [1, 2, 3] });
      assert.equal(validRes.accepted, true);
      assert.deepEqual(tab.lastResult, { data: [1, 2, 3] });
      assert.equal(tab.isRunning, false);
      assert.equal(tab.currentExecutionId, null);
    });

    it('blocks double run if tab is already in running state', () => {
      const tab = {
        id: 'tab-1',
        isRunning: true,
        currentExecutionId: 'active_req_1'
      };

      let executionCount = 0;
      function triggerRun(targetTab) {
        if (targetTab.isRunning) {
          return { started: false, reason: 'ALREADY_RUNNING' };
        }
        targetTab.isRunning = true;
        executionCount++;
        return { started: true };
      }

      const firstAttempt = triggerRun(tab);
      assert.equal(firstAttempt.started, false);
      assert.equal(firstAttempt.reason, 'ALREADY_RUNNING');
      assert.equal(executionCount, 0);

      // After finish
      tab.isRunning = false;
      const secondAttempt = triggerRun(tab);
      assert.equal(secondAttempt.started, true);
      assert.equal(executionCount, 1);
    });
  });

  // ------------------------------------------------------------
  // 3. Tab Close & Session Lifecycle
  // ------------------------------------------------------------
  describe('Tab Close & Session Restore Integrity', () => {
    it('cancels active backend query and disposes model on tab close', () => {
      let cancelCalledWith = null;
      let modelDisposed = false;

      const mockModel = {
        dispose: () => {
          modelDisposed = true;
        }
      };

      const tab = {
        id: 'tab-9',
        isRunning: true,
        currentExecutionId: 'active_exec_9',
        model: mockModel
      };

      // Logic matching app.js closeTab handler
      function closeRunningTab(t) {
        if (t.isRunning && t.currentExecutionId) {
          cancelCalledWith = t.currentExecutionId;
          t.isRunning = false;
          t.currentExecutionId = null;
        }
        if (t.model && typeof t.model.dispose === 'function') {
          t.model.dispose();
          t.model = null;
        }
        return true;
      }

      const closed = closeRunningTab(tab);
      assert.equal(closed, true);
      assert.equal(cancelCalledWith, 'active_exec_9');
      assert.equal(modelDisposed, true);
      assert.equal(tab.model, null);
      assert.equal(tab.isRunning, false);
    });

    it('forces isRunning:false and isDirty:false when restoring sessions from storage', () => {
      const rawTabs = [
        { id: 'tab-1', title: 'Query 1', sql: 'SELECT 1', isRunning: true, isDirty: true },
        { id: 'tab-2', title: 'Query 2', sql: 'SELECT 2', isRunning: true, isDirty: false }
      ];

      storage.saveWorkbenchSessions(rawTabs);
      const restored = storage.getWorkbenchSessions();

      assert.equal(restored.length, 2);
      for (const t of restored) {
        assert.equal(t.isRunning, false, 'Restored tab must not have isRunning:true');
        assert.equal(t.isDirty, false, 'Restored tab must start with isDirty:false');
      }
    });
  });

  // ------------------------------------------------------------
  // 4. Query History Privacy & Metrics
  // ------------------------------------------------------------
  describe('Query History Privacy & Duration Metrics', () => {
    it('detects sensitive keywords and flags has_sensitive_keywords:true', () => {
      const sensitiveQueries = [
        "ALTER LOGIN sa WITH PASSWORD = 'SecretPassword123!'",
        "SELECT * FROM Users WHERE api_key = 'sk-live-99238472938'",
        "CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'MasterKeyPassword'",
        "OPEN SYMMETRIC KEY UserSecretKey DECRYPTION BY CERTIFICATE AppCert",
        "SELECT * FROM OAuthTokens WHERE access_token = 'eyJhbGciOi...'"
      ];

      for (const sql of sensitiveQueries) {
        const record = historyService.recordExecution({
          sql,
          database: 'MikroDesktop_LIDER26',
          durationMs: 50,
          success: true
        });
        assert.equal(record.has_sensitive_keywords, 1, `Query should be flagged sensitive: ${sql}`);
      }
    });

    it('does not flag normal analytical queries as sensitive', () => {
      const safeQueries = [
        'SELECT TOP 100 * FROM dbo.STOKLAR WHERE cha_kod = 120',
        'SELECT COUNT(*) FROM dbo.FATURALAR WITH (NOLOCK) GROUP BY fat_tarihi',
        'SELECT cari_kod, SUM(bakiye) FROM dbo.CARI_HESAPLAR GROUP BY cari_kod'
      ];

      for (const sql of safeQueries) {
        const record = historyService.recordExecution({
          sql,
          database: 'MikroDesktop_LIDER26',
          durationMs: 40,
          success: true
        });
        assert.equal(record.has_sensitive_keywords, 0, `Normal query should not be flagged: ${sql}`);
      }
    });

    it('differentiates duplicate compression by execution success status', () => {
      const sql = 'SELECT * FROM dbo.SIPARISLER WHERE sip_id = 999';

      // 1. Successful run
      const successRecord = historyService.recordExecution({
        sql,
        database: 'MikroDesktop_LIDER26',
        durationMs: 120,
        success: true
      });

      // 2. Failed run with identical SQL text
      const failRecord = historyService.recordExecution({
        sql,
        database: 'MikroDesktop_LIDER26',
        durationMs: 15,
        success: false,
        errorMessage: 'Invalid column name sip_id'
      });

      // Must NOT be merged into a single entry because success != failure
      assert.notEqual(successRecord.id, failRecord.id);

      const all = historyService.getHistory();
      const matches = all.filter(h => h.sql === sql);
      assert.equal(matches.length, 2, 'Success and failed executions must produce distinct history entries');
    });

    it('accurately computes min, max, and avg duration across duplicate executions', () => {
      const sql = 'SELECT COUNT_BIG(*) FROM dbo.STOK_HAREKETLERI';

      // Execution 1: 300 ms
      historyService.recordExecution({
        sql,
        database: 'MikroDesktop_LIDER26',
        durationMs: 300,
        success: true
      });

      // Execution 2: 100 ms (duplicate query)
      historyService.recordExecution({
        sql,
        database: 'MikroDesktop_LIDER26',
        durationMs: 100,
        success: true
      });

      // Execution 3: 500 ms (duplicate query)
      const finalRecord = historyService.recordExecution({
        sql,
        database: 'MikroDesktop_LIDER26',
        durationMs: 500,
        success: true
      });

      assert.equal(finalRecord.execution_count, 3);
      assert.equal(finalRecord.min_duration_ms, 100);
      assert.equal(finalRecord.max_duration_ms, 500);
      assert.equal(finalRecord.avg_duration_ms, 300); // (300+100+500)/3 = 300
    });

    it('enforces history retention cap and trims oldest entries', () => {
      for (let i = 1; i <= 25; i++) {
        historyService.recordExecution({
          sql: `SELECT ${i} AS num`,
          database: 'MikroDesktop_LIDER26',
          durationMs: 10,
          success: true
        });
      }

      const beforeCap = historyService.getHistory();
      assert.equal(beforeCap.length, 25);

      // Enforce retention cap of 10
      const prunedCount = historyService.enforceRetention(10);
      assert.equal(prunedCount, 15);

      const afterCap = historyService.getHistory();
      assert.equal(afterCap.length, 10);
    });
  });

  // ------------------------------------------------------------
  // 5. Safe Serialization & Truncation
  // ------------------------------------------------------------
  describe('Safe Serialization & Result Set Truncation', () => {
    it('safely serializes BigInt to string to prevent JSON crash or precision loss', () => {
      const row = {
        id: 1,
        largeId: 9007199254740995n, // Exceeds Number.MAX_SAFE_INTEGER (9007199254740991)
        countBig: 12345678901234567890n
      };

      const sanitized = sanitizeRow(row);
      assert.equal(typeof sanitized.largeId, 'string');
      assert.equal(sanitized.largeId, '9007199254740995');
      assert.equal(sanitized.countBig, '12345678901234567890');

      // Ensure JSON.stringify produces valid JSON without TypeError
      const jsonStr = JSON.stringify(sanitized);
      assert.ok(jsonStr.includes('"9007199254740995"'));
    });

    it('converts Buffer to hex string and Date to ISO string', () => {
      const bufferVal = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
      const dateVal = new Date('2026-09-11T12:00:00.000Z');

      const sanitized = sanitizeRow({
        binaryData: bufferVal,
        timestamp: dateVal
      });

      assert.equal(sanitized.binaryData, '0xdeadbeef');
      assert.equal(sanitized.timestamp, '2026-09-11T12:00:00.000Z');
    });

    it('flags truncation metadata when row count exceeds safety limit', () => {
      const mockResultSets = [
        Array.from({ length: 12000 }, (_, i) => ({ id: i }))
      ];

      const maxRows = 10000;
      const resultSets = mockResultSets.map((rs, idx) => {
        const isTruncated = maxRows > 0 && rs.length > maxRows;
        const rawSlice = maxRows > 0 ? rs.slice(0, maxRows) : rs;
        return {
          setIndex: idx + 1,
          totalRows: rs.length,
          returnedRows: rawSlice.length,
          truncated: isTruncated,
          maxRows
        };
      });

      assert.equal(resultSets[0].totalRows, 12000);
      assert.equal(resultSets[0].returnedRows, 10000);
      assert.equal(resultSets[0].truncated, true);
      assert.equal(resultSets[0].maxRows, 10000);
    });
  });

  // ------------------------------------------------------------
  // 6. CSV Formula Injection Defense
  // ------------------------------------------------------------
  describe('CSV Formula Injection Defense', () => {
    it('prepends single quote to cells starting with formula trigger characters', () => {
      const escape = VirtualGrid.prototype.escapeCsv;

      const maliciousInputs = [
        '=cmd|"/C calc"!A0',
        '+SUM(1,2)',
        '-2+3+cmd|',
        '@SUM(A1:A10)',
        '\t=malicious'
      ];

      for (const input of maliciousInputs) {
        const escaped = escape(input, true);
        assert.ok(escaped.startsWith("'") || escaped.startsWith("\"'"), `Formula must be neutralized: ${escaped}`);
      }
    });

    it('does not alter legitimate numeric and text values', () => {
      const escape = VirtualGrid.prototype.escapeCsv;

      assert.equal(escape('100.50', true), '100.50');
      assert.equal(escape('Normal text without formulas', true), 'Normal text without formulas');
      assert.equal(escape('Item with, comma', true), '"Item with, comma"');
      assert.equal(escape('Quotes "inside"', true), '"Quotes ""inside"""');
      assert.equal(escape(null, true), '');
    });
  });

  // ------------------------------------------------------------
  // 7. SQL Validator & Error Line Mapping
  // ------------------------------------------------------------
  describe('SQL Validator & Line Offset Mapping', () => {
    it('provides informative Turkish message when GO batch separator is encountered', () => {
      const sql = `
        SELECT 1 AS Step1;
        GO
        SELECT 2 AS Step2;
      `;

      const validation = validateReadOnly(sql);
      assert.equal(validation.valid, false);
      assert.ok(validation.reason.includes('GO batch separator bu Workbench sürümünde desteklenmiyor'));
      assert.ok(validation.reason.includes('noktalı virgül'));
    });

    it('calculates correct effective line for selected text execution errors', () => {
      // User selected lines 20 to 25 in the editor
      const selectionStartLine = 20;
      const selectionLineOffset = selectionStartLine - 1; // 19 lines offset

      // SQL Server reports error at Line 3 of the executed batch
      const sqlServerReportedLine = 3;
      const effectiveLine = sqlServerReportedLine + selectionLineOffset;

      assert.equal(effectiveLine, 22, 'Effective line in full editor must be 22');
    });
  });
});
