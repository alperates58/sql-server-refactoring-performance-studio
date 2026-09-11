const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { WorkspaceStorage } = require('../server/services/workspaceStorage');
const { WorkspaceService } = require('../server/services/workspaceService');

describe('Workspace Orchestration & Service Integration Tests (Sprint 6)', () => {
  let tempDir;
  let storage;
  let service;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlstudio_test_service_'));
    storage = new WorkspaceStorage({
      runtimeDir: tempDir,
      sqliteFile: path.join(tempDir, 'svc_test.db'),
      jsonFile: path.join(tempDir, 'svc_test.json')
    });
    service = new WorkspaceService(storage);
  });

  afterEach(() => {
    if (storage) storage.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Workspace Creation & Duplicate Warning', () => {
    it('creates workspace with automatic definition hash and audit logging', async () => {
      const origSql = 'SELECT Id, Name FROM Users;';
      const result = await service.createWorkspace({
        title: 'Users View Optimization',
        target: {
          database: 'TestDB',
          schema: 'dbo',
          objectName: 'v_Users',
          canonicalId: '[TestDB].[dbo].[v_Users]'
        },
        originalSql: origSql
      });

      assert.ok(result.workspace.id);
      assert.equal(result.workspace.title, 'Users View Optimization');
      assert.ok(result.workspace.originalDefinitionHash);
      assert.equal(result.duplicateWarning, null);

      // Verify audit event was logged
      const events = storage.listAuditEventsByWorkspace(result.workspace.id);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'WORKSPACE_CREATED');
    });

    it('warns when an active workspace already exists for the same canonical object', async () => {
      await service.createWorkspace({
        title: 'First Workspace',
        target: {
          database: 'TestDB',
          schema: 'dbo',
          objectName: 'v_DupTest',
          canonicalId: '[TestDB].[dbo].[v_DupTest]'
        }
      });

      const second = await service.createWorkspace({
        title: 'Second Workspace',
        target: {
          database: 'TestDB',
          schema: 'dbo',
          objectName: 'v_DupTest',
          canonicalId: '[TestDB].[dbo].[v_DupTest]'
        }
      });

      assert.ok(second.workspace.id);
      assert.ok(second.duplicateWarning.includes('Bu nesne için açık bir çalışma zaten mevcut'));
    });
  });

  describe('Candidate Versioning (v1, v2, v3)', () => {
    it('appends candidates sequentially without deleting or overwriting previous versions', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'Versioning Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Vers' },
        originalSql: 'SELECT 1;'
      });

      // Add v1
      const c1 = service.addCandidate(ws.id, {
        sql: 'SELECT 1 AS Col1;',
        source: 'AI_REFACTOR',
        model: 'gpt-4o',
        aiSummary: 'v1 optimization'
      });
      assert.equal(c1.versionNumber, 1);

      // Add v2
      const c2 = service.addCandidate(ws.id, {
        sql: 'SELECT 1 AS Col1, 2 AS Col2;',
        source: 'AI_REFACTOR',
        model: 'deepseek-r1',
        aiSummary: 'v2 optimization'
      });
      assert.equal(c2.versionNumber, 2);

      // Retrieve all candidates
      const list = storage.listCandidatesByWorkspace(ws.id);
      assert.equal(list.length, 2);
      assert.equal(list[0].id, c1.id);
      assert.equal(list[1].id, c2.id);
      assert.equal(list[0].versionNumber, 1);
      assert.equal(list[1].versionNumber, 2);
    });
  });

  describe('Validation & Benchmark Snapshots Recording', () => {
    it('records validation snapshot, updates candidate and advances workspace status', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'Val Snapshot Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Val' }
      });
      const cand = service.addCandidate(ws.id, { sql: 'SELECT 1;' });

      const snap = service.recordValidation(ws.id, cand.id, {
        verdict: 'PASS',
        schemaMatch: true,
        rowSetMatch: true,
        multiplicityMatch: true,
        warnings: []
      });

      assert.equal(snap.verdict, 'PASS');
      assert.equal(snap.schemaMatch, true);

      const updatedWs = storage.getWorkspaceById(ws.id);
      assert.equal(updatedWs.status, 'VALIDATED');
    });

    it('records benchmark snapshot and advances status to BENCHMARKED', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'BM Snapshot Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Bm' },
        originalSql: 'SELECT 1;'
      });
      const cand = service.addCandidate(ws.id, { sql: 'SELECT 1;' });
      service.recordValidation(ws.id, cand.id, { verdict: 'PASS' });

      const bmSnap = service.recordBenchmark(ws.id, cand.id, {
        original: { medianDurationMs: 100 },
        candidate: { medianDurationMs: 30 },
        comparison: { durationImprovementPercent: 70.0 }
      });

      assert.equal(bmSnap.comparison.durationImprovementPercent, 70.0);

      const updatedWs = storage.getWorkspaceById(ws.id);
      assert.equal(updatedWs.status, 'BENCHMARKED');
    });
  });

  describe('Approval Workflow & Rejection', () => {
    it('approves a benchmarked candidate with human sign-off note', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'Approval Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Approve' },
        originalSql: 'SELECT 1;'
      });
      const cand = service.addCandidate(ws.id, { sql: 'SELECT 1;' });
      service.recordValidation(ws.id, cand.id, { verdict: 'PASS' });
      service.recordBenchmark(ws.id, cand.id, {
        original: { medianDurationMs: 50 },
        candidate: { medianDurationMs: 15 },
        comparison: { durationImprovementPercent: 70.0 }
      });

      const approvalResult = await service.approveCandidate(ws.id, cand.id, {
        approverNote: 'Rapor süreleri doğrulandı, onaylandı.',
        isAutomatedOrAi: false
      });

      assert.equal(approvalResult.candidate.status, 'APPROVED');
      assert.equal(approvalResult.workspace.status, 'APPROVED');

      // Verify audit event was logged
      const events = storage.listAuditEventsByWorkspace(ws.id);
      const appEvent = events.find(e => e.type === 'CANDIDATE_APPROVED');
      assert.ok(appEvent);
      assert.equal(appEvent.metadata.approverNote, 'Rapor süreleri doğrulandı, onaylandı.');
    });

    it('rejects candidate and logs rejection reason in audit trail', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'Reject Test',
        target: { database: 'DB1', schema: 'dbo', objectName: 'v_Rej' }
      });
      const cand = service.addCandidate(ws.id, { sql: 'SELECT 1;' });

      const rejResult = service.rejectCandidate(ws.id, cand.id, {
        reason: 'Veri sırası indeks sıralamasıyla uyuşmadı.'
      });

      assert.equal(rejResult.candidate.status, 'REJECTED');

      const events = storage.listAuditEventsByWorkspace(ws.id);
      const rejEvent = events.find(e => e.type === 'CANDIDATE_REJECTED');
      assert.ok(rejEvent);
      assert.equal(rejEvent.metadata.reason, 'Veri sırası indeks sıralamasıyla uyuşmadı.');
    });
  });

  describe('Full Deployment Script Pipeline & JSON Export', () => {
    it('generates deployment package for approved candidate and advances status to SCRIPT_GENERATED', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'Deploy Pipeline Test',
        target: { database: 'MikroDB', schema: 'dbo', objectName: 'v_Pipeline' },
        originalSql: 'SELECT Id FROM Table1;'
      });
      const cand = service.addCandidate(ws.id, { sql: 'SELECT Id, Value FROM Table1;' });
      service.recordValidation(ws.id, cand.id, { verdict: 'PASS' });
      await service.approveCandidate(ws.id, cand.id, { isAutomatedOrAi: false });

      const pkg = await service.generateDeploymentPackage(ws.id, {
        useCreateOrAlter: true
      });

      assert.ok(pkg.files['DEPLOY.sql']);
      assert.ok(pkg.files['ROLLBACK.sql']);
      assert.ok(pkg.files['EVIDENCE.md']);

      const updatedWs = storage.getWorkspaceById(ws.id);
      assert.equal(updatedWs.status, 'SCRIPT_GENERATED');
    });

    it('exports full workspace JSON bundle with all versions and audit events', async () => {
      const { workspace: ws } = await service.createWorkspace({
        title: 'Export Test',
        target: { database: 'ExportDB', schema: 'dbo', objectName: 'v_Exp' },
        originalSql: 'SELECT 1;'
      });
      service.addCandidate(ws.id, { sql: 'SELECT 2;' });

      const bundle = service.exportWorkspace(ws.id);
      assert.equal(bundle.workspace.id, ws.id);
      assert.equal(bundle.candidates.length, 1);
      assert.ok(bundle.auditEvents.length >= 2);
      assert.ok(bundle.exportedAt);
    });
  });
});
