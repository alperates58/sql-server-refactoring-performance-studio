const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  escapeSqlIdentifier,
  normalizeViewScript,
  generateDeployScript,
  generateRollbackScript,
  generateEvidenceMarkdown,
  createDeploymentPackage
} = require('../server/services/deploymentService');

describe('Safe Deployment Script Pipeline Tests (Sprint 6)', () => {
  describe('Identifier Quoting & Heading Normalization', () => {
    it('safely escapes closing brackets in database and schema names', () => {
      assert.equal(escapeSqlIdentifier('db]name'), 'db]]name');
      assert.equal(escapeSqlIdentifier('normal_db'), 'normal_db');
      assert.equal(escapeSqlIdentifier(''), '');
    });

    it('normalizes a pure SELECT query into CREATE OR ALTER VIEW', () => {
      const pureSelect = 'SELECT Id, Name FROM dbo.Users WHERE IsActive = 1;';
      const normalized = normalizeViewScript(pureSelect, { schema: 'dbo', objectName: 'v_ActiveUsers' }, true);
      assert.ok(normalized.startsWith('CREATE OR ALTER VIEW [dbo].[v_ActiveUsers]\nAS'));
      assert.ok(normalized.includes('SELECT Id, Name FROM dbo.Users'));
    });

    it('replaces an existing CREATE VIEW heading with CREATE OR ALTER VIEW', () => {
      const createViewSql = 'CREATE VIEW dbo.OldView AS SELECT 1 AS Col;';
      const normalized = normalizeViewScript(createViewSql, { schema: 'sales', objectName: 'v_NewView' }, true);
      assert.ok(normalized.startsWith('CREATE OR ALTER VIEW [sales].[v_NewView]\nAS'));
      assert.ok(normalized.includes('SELECT 1 AS Col;'));
    });

    it('replaces an existing ALTER VIEW heading when requested', () => {
      const alterViewSql = 'ALTER VIEW [dbo].[CustomView] AS SELECT 2 AS Col;';
      const normalized = normalizeViewScript(alterViewSql, { schema: 'dbo', objectName: 'CustomView' }, false);
      assert.ok(normalized.startsWith('ALTER VIEW [dbo].[CustomView]\nAS'));
    });
  });

  describe('DEPLOY.sql Script Generation', () => {
    const mockWorkspace = {
      id: 'ws_test_001',
      title: 'Kullanıcı Bakiye Raporu',
      target: { database: 'MikroDB_V16', schema: 'dbo', objectName: 'v_UserBalance' },
      originalSql: 'SELECT * FROM Users;',
      originalDefinitionHash: 'orig_hash_abc',
      createdAt: '2026-09-11T10:00:00.000Z'
    };

    const mockCandidate = {
      id: 'cand_v1',
      versionNumber: 1,
      sql: 'SELECT Id, Balance FROM Users;',
      sqlHash: 'cand_hash_def'
    };

    it('generates deploy script with transaction safety wrapper (XACT_ABORT & THROW)', () => {
      const script = generateDeployScript({
        workspace: mockWorkspace,
        candidate: mockCandidate,
        wrapInTransaction: true
      });

      // Assert safety wrapper
      assert.ok(script.includes('USE [MikroDB_V16];'));
      assert.ok(script.includes('SET XACT_ABORT ON;'));
      assert.ok(script.includes('BEGIN TRANSACTION;'));
      assert.ok(script.includes('COMMIT TRANSACTION;'));
      assert.ok(script.includes('IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;'));
      assert.ok(script.includes('THROW;'));

      // Assert header comments & hashes
      assert.ok(script.includes('-- Workspace ID:    ws_test_001'));
      assert.ok(script.includes('-- Expected Orig.:  SHA256:orig_hash_abc'));
      assert.ok(script.includes('-- Candidate SHA:   SHA256:cand_hash_def'));
      assert.ok(script.includes('-- GENERATED SCRIPT — REVIEW THOROUGHLY'));
    });
  });

  describe('ROLLBACK.sql Script Generation', () => {
    const mockWorkspace = {
      id: 'ws_test_002',
      title: 'Rollback Test View',
      target: { database: 'SalesDB', schema: 'dbo', objectName: 'v_Orders' },
      originalSql: 'SELECT OrderId, CustomerId FROM Orders;',
      originalDefinitionHash: 'orig_rollback_hash',
      createdAt: '2026-09-11T09:00:00.000Z'
    };

    it('generates rollback script restoring original SQL with warning disclaimer', () => {
      const rollback = generateRollbackScript({ workspace: mockWorkspace });

      assert.ok(rollback.includes('USE [SalesDB];'));
      assert.ok(rollback.includes('SELECT OrderId, CustomerId FROM Orders;'));
      assert.ok(rollback.includes('-- WARNING: This rollback script restores the ORIGINAL definition'));
      assert.ok(rollback.includes('ROLLBACK TRANSACTION;'));
      assert.ok(rollback.includes('SHA256:orig_rollback_hash'));
    });
  });

  describe('EVIDENCE.md Generation', () => {
    it('produces structured markdown evidence with metric gains and sign-off section', () => {
      const md = generateEvidenceMarkdown({
        workspace: {
          id: 'ws_ev_01',
          title: 'Evidence Test',
          target: { database: 'TestDB', schema: 'dbo', objectName: 'v_Ev' },
          originalSql: 'SELECT 1;',
          originalDefinitionHash: 'hash_orig'
        },
        candidate: {
          id: 'cand_ev_01',
          versionNumber: 2,
          source: 'AI_REFACTOR',
          model: 'deepseek-r1',
          sql: 'SELECT 1, 2;',
          sqlHash: 'hash_cand',
          status: 'APPROVED'
        },
        validationSnapshot: {
          verdict: 'PASS',
          schemaMatch: true,
          rowSetMatch: true,
          multiplicityMatch: true,
          warnings: []
        },
        benchmarkSnapshot: {
          original: { medianDurationMs: 100, cpuMs: 90, logicalReads: 5000 },
          candidate: { medianDurationMs: 25, cpuMs: 20, logicalReads: 800 },
          comparison: {
            durationImprovementPercent: 75.0,
            cpuImprovementPercent: 77.8,
            logicalReadsImprovementPercent: 84.0
          }
        },
        planSnapshot: {
          warnings: [],
          cardinalityFindings: [],
          missingIndexes: []
        }
      });

      assert.ok(md.includes('# Refactor Evidence & Sign-off Document'));
      assert.ok(md.includes('**PASS**'));
      assert.ok(md.includes('-75%'));
      assert.ok(md.includes('-84%'));
      assert.ok(md.includes('ONAYLANDI (APPROVED)'));
      assert.ok(md.includes('Human Sign-off'));
    });
  });

  describe('createDeploymentPackage & Drift Guard', () => {
    const ws = {
      id: 'ws_pkg_01',
      title: 'Package Test',
      target: { database: 'DB1', schema: 'dbo', objectName: 'v_Pkg' },
      originalSql: 'SELECT 1;',
      createdAt: '2026-09-11'
    };
    const cand = {
      id: 'cand_pkg_01',
      versionNumber: 1,
      sql: 'SELECT 1, 2;'
    };

    it('creates complete deployment package with DEPLOY.sql, ROLLBACK.sql, and EVIDENCE.md', () => {
      const pkg = createDeploymentPackage({
        workspace: ws,
        candidate: cand,
        databaseDrift: false
      });

      assert.ok(pkg.files['DEPLOY.sql']);
      assert.ok(pkg.files['ROLLBACK.sql']);
      assert.ok(pkg.files['EVIDENCE.md']);
      assert.equal(pkg.workspaceId, 'ws_pkg_01');
    });

    it('STRICT GUARDRAIL: Blocks script generation when database drift is detected without override', () => {
      assert.throws(() => {
        createDeploymentPackage({
          workspace: ws,
          candidate: cand,
          databaseDrift: true,
          overrideDrift: false
        });
      }, /SCRIPT_GENERATION_BLOCKED_DATABASE_DRIFT/);
    });

    it('allows script generation when drift is explicitly overridden by user', () => {
      const pkg = createDeploymentPackage({
        workspace: ws,
        candidate: cand,
        databaseDrift: true,
        overrideDrift: true
      });
      assert.ok(pkg.files['DEPLOY.sql']);
    });
  });

  describe('NO DATABASE MUTATION AUDIT', () => {
    it('verifies that deploymentService does not contain any database execution functions', () => {
      const service = require('../server/services/deploymentService');
      assert.equal(service.execute, undefined);
      assert.equal(service.runDdl, undefined);
      assert.equal(service.applyScript, undefined);
      assert.equal(service.deployToDatabase, undefined);
    });
  });
});
