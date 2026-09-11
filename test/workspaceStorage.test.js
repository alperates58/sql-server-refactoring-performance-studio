const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { WorkspaceStorage, SCHEMA_VERSION } = require('../server/services/workspaceStorage');

describe('Workspace Local Persistence Engine Tests (Sprint 6)', () => {
  let tempDir;
  let sqlitePath;
  let jsonPath;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlstudio_test_ws_'));
    sqlitePath = path.join(tempDir, 'test_workspaces.db');
    jsonPath = path.join(tempDir, 'test_workspaces.local.json');
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

  describe('Storage Initialization & Schema Versioning', () => {
    it('initializes successfully with a valid backend and schema version', () => {
      const status = storage.getStatus();
      assert.equal(status.available, true);
      assert.ok(['SQLITE', 'JSON'].includes(status.backend));
      assert.equal(status.schemaVersion, SCHEMA_VERSION);
    });

    it('creates database file or json file on disk', () => {
      const status = storage.getStatus();
      if (status.backend === 'SQLITE') {
        assert.ok(fs.existsSync(sqlitePath));
      } else {
        assert.ok(fs.existsSync(jsonPath));
      }
    });

    it('operates reliably with forced JSON fallback mode', () => {
      const jsonStorage = new WorkspaceStorage({
        runtimeDir: tempDir,
        sqliteFile: path.join(tempDir, 'dummy.db'),
        jsonFile: path.join(tempDir, 'forced.json'),
        forceJson: true
      });
      const st = jsonStorage.getStatus();
      assert.equal(st.available, true);
      assert.equal(st.backend, 'JSON');
      jsonStorage.close();
    });
  });

  describe('Restart Persistence (Programmatic Verification)', () => {
    it('persists workspace, candidates, and snapshots across storage close and reopen', () => {
      // 1. Create workspace
      const ws = storage.saveWorkspace({
        title: 'Satış Raporu View Optimizasyonu',
        target: {
          database: 'MikroDB_V16_LIDER25',
          schema: 'dbo',
          objectName: 'v_SatisRaporu',
          objectType: 'VIEW',
          canonicalId: '[MikroDB_V16_LIDER25].[dbo].[v_SatisRaporu]'
        },
        originalSql: 'SELECT * FROM dbo.Satislar WITH (NOLOCK)',
        originalDefinitionHash: 'orig_hash_123',
        notes: 'Önemli muhasebe raporu'
      });
      assert.ok(ws.id);

      // 2. Add candidate v1
      const cand = storage.saveCandidate({
        workspaceId: ws.id,
        versionNumber: 1,
        sql: 'SELECT Id, Tarih, Tutar FROM dbo.Satislar',
        sqlHash: 'cand_hash_456',
        source: 'AI_REFACTOR',
        model: 'gpt-4o',
        aiSummary: 'NOLOCK kaldırıldı ve kolonlar projeksiyonlandı.'
      });
      assert.ok(cand.id);

      // 3. Add validation snapshot
      const val = storage.saveValidationSnapshot({
        workspaceId: ws.id,
        candidateId: cand.id,
        candidateSqlHash: 'cand_hash_456',
        verdict: 'PASS',
        schemaMatch: true,
        rowSetMatch: true,
        multiplicityMatch: true,
        warnings: ['Non-sargable predicate converted'],
        evidence: { rowsChecked: 500 }
      });
      assert.ok(val.id);

      // 4. Add benchmark snapshot
      const bm = storage.saveBenchmarkSnapshot({
        workspaceId: ws.id,
        candidateId: cand.id,
        candidateSqlHash: 'cand_hash_456',
        originalSqlHash: 'orig_hash_123',
        original: { medianDurationMs: 120, logicalReads: 4500 },
        candidate: { medianDurationMs: 40, logicalReads: 900 },
        comparison: { durationImprovementPercent: 66.7, logicalReadsImprovementPercent: 80.0 }
      });
      assert.ok(bm.id);

      // 5. Close storage (simulating application restart / server shutdown)
      storage.close();

      // 6. Reopen storage with same directory and files
      const restartedStorage = new WorkspaceStorage({
        runtimeDir: tempDir,
        sqliteFile: sqlitePath,
        jsonFile: jsonPath
      });

      // 7. Verify all entities exist and match exactly
      const loadedWs = restartedStorage.getWorkspaceById(ws.id);
      assert.ok(loadedWs, 'Workspace should exist after persistence restart');
      assert.equal(loadedWs.title, 'Satış Raporu View Optimizasyonu');
      assert.equal(loadedWs.target.objectName, 'v_SatisRaporu');
      assert.equal(loadedWs.notes, 'Önemli muhasebe raporu');

      const loadedCandidates = restartedStorage.listCandidatesByWorkspace(ws.id);
      assert.equal(loadedCandidates.length, 1);
      assert.equal(loadedCandidates[0].versionNumber, 1);
      assert.equal(loadedCandidates[0].model, 'gpt-4o');

      const loadedVal = restartedStorage.listValidationsByCandidate(cand.id);
      assert.equal(loadedVal.length, 1);
      assert.equal(loadedVal[0].verdict, 'PASS');
      assert.equal(loadedVal[0].schemaMatch, true);

      const loadedBm = restartedStorage.listBenchmarksByCandidate(cand.id);
      assert.equal(loadedBm.length, 1);
      assert.equal(loadedBm[0].comparison.durationImprovementPercent, 66.7);

      restartedStorage.close();
    });
  });

  describe('CRUD, Search, Pagination & Archive', () => {
    it('creates, retrieves, updates, and deletes workspaces', () => {
      const created = storage.saveWorkspace({
        title: 'Initial Title',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Test', objectType: 'VIEW', canonicalId: '[DB1].[dbo].[v_Test]' },
        originalSql: 'SELECT 1'
      });
      assert.equal(created.title, 'Initial Title');

      // Update
      created.title = 'Updated Title';
      created.notes = 'New notes';
      const updated = storage.saveWorkspace(created);
      assert.equal(updated.title, 'Updated Title');
      assert.equal(updated.notes, 'New notes');

      // Delete
      const delRes = storage.deleteWorkspace(created.id);
      assert.equal(delRes, true);
      const afterDel = storage.getWorkspaceById(created.id);
      assert.equal(afterDel, null);
    });

    it('supports soft archive and unarchive', () => {
      const ws = storage.saveWorkspace({
        title: 'Archive Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Arch', objectType: 'VIEW', canonicalId: '[DB1].[dbo].[v_Arch]' }
      });
      assert.equal(ws.isArchived, false);

      const archived = storage.archiveWorkspace(ws.id, true);
      assert.equal(archived.isArchived, true);

      // Verify list filtering by default excludes archived
      const listActive = storage.listWorkspaces({ isArchived: false });
      assert.equal(listActive.items.some(x => x.id === ws.id), false);

      const listArchived = storage.listWorkspaces({ isArchived: true });
      assert.equal(listArchived.items.some(x => x.id === ws.id), true);

      // Unarchive
      const unarchived = storage.archiveWorkspace(ws.id, false);
      assert.equal(unarchived.isArchived, false);
    });

    it('paginates large workspace datasets correctly', () => {
      for (let i = 1; i <= 25; i++) {
        storage.saveWorkspace({
          title: `Workspace Number ${i}`,
          target: { database: 'DB_PAG', schema: 'dbo', objectName: `v_Page_${i}`, objectType: 'VIEW', canonicalId: `[DB_PAG].[dbo].[v_Page_${i}]` }
        });
      }

      const p1 = storage.listWorkspaces({ page: 1, pageSize: 10 });
      assert.equal(p1.total, 25);
      assert.equal(p1.items.length, 10);
      assert.equal(p1.page, 1);
      assert.equal(p1.totalPages, 3);

      const p2 = storage.listWorkspaces({ page: 2, pageSize: 10 });
      assert.equal(p2.items.length, 10);

      const p3 = storage.listWorkspaces({ page: 3, pageSize: 10 });
      assert.equal(p3.items.length, 5);
    });

    it('searches workspaces across title, object name, and database name', () => {
      storage.saveWorkspace({
        title: 'Müşteri Cari Bakiye',
        target: { database: 'MikroDB', schema: 'dbo', objectName: 'v_CariBakiye', objectType: 'VIEW', canonicalId: '[MikroDB].[dbo].[v_CariBakiye]' }
      });
      storage.saveWorkspace({
        title: 'Stok Envanter Dökümü',
        target: { database: 'StokDB', schema: 'dbo', objectName: 'v_StokListesi', objectType: 'VIEW', canonicalId: '[StokDB].[dbo].[v_StokListesi]' }
      });

      const res1 = storage.listWorkspaces({ search: 'Cari' });
      assert.equal(res1.items.length, 1);
      assert.equal(res1.items[0].target.objectName, 'v_CariBakiye');

      const res2 = storage.listWorkspaces({ search: 'StokDB' });
      assert.equal(res2.items.length, 1);
      assert.equal(res2.items[0].target.objectName, 'v_StokListesi');
    });
  });

  describe('Audit Trail & Security', () => {
    it('records and retrieves sanitized audit events', () => {
      const ws = storage.saveWorkspace({
        title: 'Audit Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Audit', objectType: 'VIEW', canonicalId: '[DB1].[dbo].[v_Audit]' }
      });

      storage.saveAuditEvent({
        workspaceId: ws.id,
        type: 'WORKSPACE_CREATED',
        metadata: {
          initiator: 'user1',
          password: 'super_secret_password', // Should be redacted!
          apiKey: 'ai-secret-key-12345',      // Should be redacted!
          safeField: 'audit_ok'
        }
      });

      const events = storage.listAuditEventsByWorkspace(ws.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'WORKSPACE_CREATED');
      assert.equal(events[0].metadata.safeField, 'audit_ok');
      assert.equal(events[0].metadata.password, '[REDACTED]');
      assert.equal(events[0].metadata.apiKey, '[REDACTED]');
    });
  });

  describe('Workbench Saved Queries', () => {
    it('creates, lists, favorites, and deletes saved workbench queries', () => {
      const q = storage.saveWorkbenchQuery({
        name: 'Aktif Siparişler',
        sql: 'SELECT * FROM Siparisler WHERE Durum = 1;',
        database: 'MikroDB',
        isFavorite: false
      });
      assert.ok(q.id);
      assert.equal(q.name, 'Aktif Siparişler');
      assert.equal(q.isFavorite, false);

      // Toggle favorite
      q.isFavorite = true;
      storage.saveWorkbenchQuery(q);

      const favList = storage.listWorkbenchQueries({ favoriteOnly: true });
      assert.ok(favList.some(x => x.id === q.id));

      // Delete
      storage.deleteWorkbenchQuery(q.id);
      const afterDel = storage.getWorkbenchQueryById(q.id);
      assert.equal(afterDel, null);
    });
  });
});
