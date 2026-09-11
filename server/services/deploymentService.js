/**
 * SQL Server Refactoring & Performance Studio
 * Safe Deployment Script Pipeline (Sprint 6)
 *
 * GUARANTEES & CONSTRAINTS:
 * - This service NEVER executes DDL/DML on SQL Server! (AUTOMATIC DATABASE MUTATION PATH: NO)
 * - Pure script and documentation package generation only.
 * - Safe bracket escaping for identifiers ([database], [schema], [object]).
 * - Safe heading normalization (CREATE VIEW / ALTER VIEW / CREATE OR ALTER VIEW / pure SELECT).
 * - Generates DEPLOY.sql, ROLLBACK.sql, and EVIDENCE.md package.
 * - Database drift guard blocks script generation unless explicitly overridden.
 */

const { computeSqlHash } = require('./workspaceLifecycle');

/**
 * Safely escapes an identifier for SQL Server bracket quoting [identifier]
 */
function escapeSqlIdentifier(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/\]/g, ']]');
}

/**
 * Normalizes SQL script heading for a view:
 * Handles:
 * - Pure SELECT / WITH CTE: adds CREATE OR ALTER VIEW [schema].[view] AS
 * - Existing CREATE VIEW: transforms to CREATE OR ALTER VIEW (or ALTER VIEW)
 * - Existing ALTER VIEW: preserves or transforms
 */
function normalizeViewScript(rawSql, target = {}, useCreateOrAlter = true) {
  if (!rawSql || typeof rawSql !== 'string') return '';

  const schema = escapeSqlIdentifier(target.schema || 'dbo');
  const viewName = escapeSqlIdentifier(target.objectName || 'TargetView');
  const actionKeyword = useCreateOrAlter ? 'CREATE OR ALTER VIEW' : 'ALTER VIEW';

  const trimmed = rawSql.trim();

  // Pattern matching: CREATE [OR ALTER] VIEW ... AS
  const viewHeaderRegex = /^\s*(?:CREATE\s+OR\s+ALTER\s+VIEW|CREATE\s+VIEW|ALTER\s+VIEW)\s+(?:\[?[a-zA-Z0-9_@#$]+\]?\.)?\[?[a-zA-Z0-9_@#$]+\]?\s*(?:\([^\)]*\))?\s+AS\s+/i;

  if (viewHeaderRegex.test(trimmed)) {
    // Replace the header with normalized target header
    const body = trimmed.replace(viewHeaderRegex, '').trim();
    return `${actionKeyword} [${schema}].[${viewName}]\nAS\n${body}`;
  }

  // If candidate is a pure SELECT or WITH ... SELECT
  return `${actionKeyword} [${schema}].[${viewName}]\nAS\n${trimmed}`;
}

/**
 * Generates the DEPLOY.sql script text
 */
function generateDeployScript({
  workspace,
  candidate,
  useCreateOrAlter = true,
  wrapInTransaction = true
}) {
  const dbName = escapeSqlIdentifier(workspace.target?.database || 'master');
  const schemaName = escapeSqlIdentifier(workspace.target?.schema || 'dbo');
  const objName = escapeSqlIdentifier(workspace.target?.objectName || 'TargetView');

  const origHash = workspace.originalDefinitionHash || computeSqlHash(workspace.originalSql);
  const candHash = candidate.sqlHash || computeSqlHash(candidate.sql);
  const now = new Date().toISOString();

  const normalizedDdl = normalizeViewScript(candidate.sql, workspace.target, useCreateOrAlter);

  const header = [
    `-- ============================================================================`,
    `-- SQL Server Refactoring & Performance Studio — Safe Deployment Script`,
    `-- GENERATED SCRIPT — REVIEW THOROUGHLY BEFORE EXECUTING ON ANY DATABASE`,
    `-- ============================================================================`,
    `-- Workspace ID:    ${workspace.id}`,
    `-- Workspace Title: ${workspace.title || 'Untitled Workspace'}`,
    `-- Target Database: [${dbName}]`,
    `-- Target Object:   [${schemaName}].[${objName}]`,
    `-- Candidate Vers.: v${candidate.versionNumber || 1} (ID: ${candidate.id})`,
    `-- Generated At:    ${now}`,
    `-- Expected Orig.:  SHA256:${origHash}`,
    `-- Candidate SHA:   SHA256:${candHash}`,
    `-- Guardrail Note:  This script was generated for human review. Verify production schema.`,
    `-- ============================================================================`,
    ``
  ].join('\n');

  if (wrapInTransaction) {
    // SQL Server requires CREATE/ALTER VIEW inside dynamic EXEC when part of a multi-statement transaction batch
    const escapedDdlLiteral = normalizedDdl.replace(/'/g, "''");

    const body = [
      `USE [${dbName}];`,
      `GO`,
      `SET ANSI_NULLS ON;`,
      `SET QUOTED_IDENTIFIER ON;`,
      `SET XACT_ABORT ON;`,
      `GO`,
      ``,
      `PRINT 'Starting safe view deployment for [${schemaName}].[${objName}]...';`,
      ``,
      `BEGIN TRY`,
      `    BEGIN TRANSACTION;`,
      ``,
      `    -- Dynamic batch execution ensures DDL executes cleanly inside the transaction boundary`,
      `    EXEC(N'${escapedDdlLiteral}');`,
      ``,
      `    COMMIT TRANSACTION;`,
      `    PRINT 'SUCCESS: [${schemaName}].[${objName}] view refactoring deployed successfully.';`,
      `END TRY`,
      `BEGIN CATCH`,
      `    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;`,
      `    PRINT 'ERROR: Deployment failed. Transaction rolled back without changes.';`,
      `    THROW;`,
      `END CATCH;`,
      `GO`
    ].join('\n');

    return `${header}${body}\n`;
  }

  // Direct batch script without EXEC wrapper
  const body = [
    `USE [${dbName}];`,
    `GO`,
    `SET ANSI_NULLS ON;`,
    `SET QUOTED_IDENTIFIER ON;`,
    `GO`,
    ``,
    normalizedDdl,
    ``,
    `GO`
  ].join('\n');

  return `${header}${body}\n`;
}

/**
 * Generates the ROLLBACK.sql script text
 */
function generateRollbackScript({
  workspace,
  useCreateOrAlter = true
}) {
  const dbName = escapeSqlIdentifier(workspace.target?.database || 'master');
  const schemaName = escapeSqlIdentifier(workspace.target?.schema || 'dbo');
  const objName = escapeSqlIdentifier(workspace.target?.objectName || 'TargetView');

  const origHash = workspace.originalDefinitionHash || computeSqlHash(workspace.originalSql);
  const now = new Date().toISOString();

  const normalizedDdl = normalizeViewScript(workspace.originalSql, workspace.target, useCreateOrAlter);
  const escapedDdlLiteral = normalizedDdl.replace(/'/g, "''");

  return [
    `-- ============================================================================`,
    `-- SQL Server Refactoring & Performance Studio — Safe Rollback Script`,
    `-- WARNING: This rollback script restores the ORIGINAL definition captured at`,
    `-- workspace creation time (${workspace.createdAt}).`,
    `-- Verify that no later external production modifications are accidentally overwritten!`,
    `-- ============================================================================`,
    `-- Workspace ID:    ${workspace.id}`,
    `-- Target Database: [${dbName}]`,
    `-- Target Object:   [${schemaName}].[${objName}]`,
    `-- Generated At:    ${now}`,
    `-- Restoring SHA:   SHA256:${origHash}`,
    `-- ============================================================================`,
    ``,
    `USE [${dbName}];`,
    `GO`,
    `SET ANSI_NULLS ON;`,
    `SET QUOTED_IDENTIFIER ON;`,
    `SET XACT_ABORT ON;`,
    `GO`,
    ``,
    `PRINT 'Starting rollback of [${schemaName}].[${objName}] to original definition...';`,
    ``,
    `BEGIN TRY`,
    `    BEGIN TRANSACTION;`,
    ``,
    `    EXEC(N'${escapedDdlLiteral}');`,
    ``,
    `    COMMIT TRANSACTION;`,
    `    PRINT 'SUCCESS: [${schemaName}].[${objName}] rolled back to original definition successfully.';`,
    `END TRY`,
    `BEGIN CATCH`,
    `    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;`,
    `    PRINT 'ERROR: Rollback failed. Transaction rolled back.';`,
    `    THROW;`,
    `END CATCH;`,
    `GO`,
    ``
  ].join('\n');
}

/**
 * Generates EVIDENCE.md document
 */
function generateEvidenceMarkdown({
  workspace,
  candidate,
  validationSnapshot,
  benchmarkSnapshot,
  planSnapshot
}) {
  const now = new Date().toISOString();
  const dbName = workspace.target?.database || 'UnknownDB';
  const schemaName = workspace.target?.schema || 'dbo';
  const objName = workspace.target?.objectName || 'UnknownObject';

  const origHash = workspace.originalDefinitionHash || computeSqlHash(workspace.originalSql);
  const candHash = candidate.sqlHash || computeSqlHash(candidate.sql);

  const valVerdict = validationSnapshot?.verdict || 'UNVALIDATED';
  const valRows = validationSnapshot?.rowSetMatch ? 'MATCH (Tam Eşleşme)' : 'FARKLI';
  const valSchema = validationSnapshot?.schemaMatch ? 'MATCH (Tam Eşleşme)' : 'FARKLI';

  const bmComp = benchmarkSnapshot?.comparison || {};
  const durationGain = bmComp.durationImprovementPercent !== undefined ? `${bmComp.durationImprovementPercent > 0 ? '-' : '+'}${Math.abs(bmComp.durationImprovementPercent)}%` : 'Ölçülmedi';
  const cpuGain = bmComp.cpuImprovementPercent !== undefined ? `${bmComp.cpuImprovementPercent > 0 ? '-' : '+'}${Math.abs(bmComp.cpuImprovementPercent)}%` : 'Ölçülmedi';
  const readsGain = bmComp.logicalReadsImprovementPercent !== undefined ? `${bmComp.logicalReadsImprovementPercent > 0 ? '-' : '+'}${Math.abs(bmComp.logicalReadsImprovementPercent)}%` : 'Ölçülmedi';

  const planWarnings = planSnapshot?.warnings?.length || 0;

  return [
    `# Refactor Evidence & Sign-off Document`,
    ``,
    `## 1. Çalışma ve Hedef Bilgileri`,
    `- **Workspace ID:** \`${workspace.id}\``,
    `- **Başlık:** ${workspace.title || 'İsimsiz Çalışma'}`,
    `- **Hedef Nesne:** \`[${dbName}].[${schemaName}].[${objName}]\``,
    `- **Seçilen Aday Versiyon:** v${candidate.versionNumber || 1} (\`${candidate.id}\`)`,
    `- **Aday Kaynağı / Model:** ${candidate.source} / ${candidate.model || 'manual'}`,
    `- **Rapor Oluşturma Zamanı:** ${now}`,
    ``,
    `## 2. Kriptografik Tanım Özeti (SHA-256)`,
    `- **Orijinal SQL Hash:** \`${origHash}\``,
    `- **Aday SQL Hash:** \`${candHash}\``,
    ``,
    `## 3. Semantik Doğrulama (Semantic Validation)`,
    `- **Genel Sonuç (Verdict):** **${valVerdict}**`,
    `- **Şema Uyumu (Schema Match):** ${valSchema}`,
    `- **Satır Seti Uyumu (RowSet Match):** ${valRows}`,
    `- **Çokluk Uyumu (Multiplicity):** ${validationSnapshot?.multiplicityMatch ? 'PASS' : 'WARN/FAIL'}`,
    `- **Uyarı Sayısı:** ${validationSnapshot?.warnings?.length || 0}`,
    ``,
    `## 4. Performans Benchmark İyileşme Oranları`,
    `| Metrik | Orijinal | Aday v${candidate.versionNumber || 1} | İyileşme Oranı |`,
    `| :--- | :--- | :--- | :--- |`,
    `| **Medyan Süre (Duration)** | ${benchmarkSnapshot?.original?.medianDurationMs ?? '—'} ms | ${benchmarkSnapshot?.candidate?.medianDurationMs ?? '—'} ms | **${durationGain}** |`,
    `| **CPU Süresi (CPU Time)** | ${benchmarkSnapshot?.original?.cpuMs ?? '—'} ms | ${benchmarkSnapshot?.candidate?.cpuMs ?? '—'} ms | **${cpuGain}** |`,
    `| **Mantıksal Okuma (Logical Reads)** | ${benchmarkSnapshot?.original?.logicalReads?.toLocaleString() ?? '—'} | ${benchmarkSnapshot?.candidate?.logicalReads?.toLocaleString() ?? '—'} | **${readsGain}** |`,
    ``,
    `## 5. Yürütme Planı (Execution Plan) Özeti`,
    `- **Kaynak:** ${planSnapshot?.source || 'ESTIMATED'}`,
    `- **Yeni Plan Uyarıları:** ${planWarnings} adet`,
    `- **Kardinalite Bulguları:** ${planSnapshot?.cardinalityFindings?.length || 0} adet`,
    `- **Eksik İndeks Önerileri:** ${planSnapshot?.missingIndexes?.length || 0} adet`,
    ``,
    `## 6. Güvenlik ve Onay İmzası (Human Sign-off)`,
    `- **Onay Durumu:** ${candidate.status === 'APPROVED' ? 'ONAYLANDI (APPROVED)' : 'ONAY BEKLİYOR'}`,
    `- **Onaylayan Kullanıcı:** __________________________`,
    `- **Onay Tarihi:** __________________________`,
    `- **DBA / Yetkili İmzası:** __________________________`,
    ``,
    `> **Önemli Hatırlatma:** Bu paket SQL Server Refactoring & Performance Studio tarafından oluşturulmuştur. Canlı veritabanına otomatik DDL/DML uygulanmaz. Üretilen \`DEPLOY.sql\` ve \`ROLLBACK.sql\` betiklerini canlıya almadan önce yetkili DBA kontrolünden geçiriniz.`
  ].join('\n');
}

/**
 * Creates full deployment package
 */
function createDeploymentPackage({
  workspace,
  candidate,
  validationSnapshot,
  benchmarkSnapshot,
  planSnapshot,
  databaseDrift = false,
  overrideDrift = false,
  useCreateOrAlter = true
}) {
  if (databaseDrift && !overrideDrift) {
    throw new Error('SCRIPT_GENERATION_BLOCKED_DATABASE_DRIFT: Canlı veritabanındaki view tanımı çalışma oluşturulduktan sonra değişmiş. Betik üretimi engellendi.');
  }

  const deploySql = generateDeployScript({ workspace, candidate, useCreateOrAlter });
  const rollbackSql = generateRollbackScript({ workspace, useCreateOrAlter });
  const evidenceMd = generateEvidenceMarkdown({ workspace, candidate, validationSnapshot, benchmarkSnapshot, planSnapshot });

  return {
    workspaceId: workspace.id,
    candidateId: candidate.id,
    generatedAt: new Date().toISOString(),
    files: {
      'DEPLOY.sql': deploySql,
      'ROLLBACK.sql': rollbackSql,
      'EVIDENCE.md': evidenceMd
    },
    scripts: {
      deploySql,
      rollbackSql,
      evidenceMd
    }
  };
}

module.exports = {
  escapeSqlIdentifier,
  normalizeViewScript,
  generateDeployScript,
  generateRollbackScript,
  generateEvidenceMarkdown,
  createDeploymentPackage
};
