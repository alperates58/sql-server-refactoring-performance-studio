/**
 * SQL Server Refactoring & Performance Studio
 * Workspace Orchestrator & Business Logic Service (Sprint 6)
 *
 * Implements:
 * - Refactor Workspace CRUD with local persistence (SQLite / JSON)
 * - Candidate versioning (v1, v2, v3...)
 * - Immutable validation, benchmark, and execution plan snapshots
 * - Real-time Database Drift Detection
 * - Strict human-only approval pipeline
 * - Safe deployment package generation
 * - Sanitized audit logging
 */

const { defaultStorage } = require('./workspaceStorage');
const {
  WORKSPACE_STATUS,
  CANDIDATE_STATUS,
  canTransitionWorkspace,
  evaluateEvidenceFreshness,
  computeSqlHash,
  shouldInvalidateApprovalOnMutation
} = require('./workspaceLifecycle');
const deploymentService = require('./deploymentService');
const db = require('./sqlServer');

class WorkspaceService {
  constructor(storage = defaultStorage) {
    this.storage = storage;
  }

  // =========================================================================
  // Database Drift Detection
  // =========================================================================

  async checkDatabaseDrift(workspace) {
    if (!workspace || !workspace.target) return { detected: false, checked: false };

    try {
      const connStatus = db.status();
      if (!connStatus.connected) {
        return { detected: false, checked: false, reason: 'NOT_CONNECTED' };
      }

      const { database, schema, objectName } = workspace.target;
      if (!database || !objectName) {
        return { detected: false, checked: false, reason: 'INCOMPLETE_TARGET' };
      }

      const pool = await db.getPoolForDatabase(database);
      const req = pool.request();
      req.input('objName', `${schema || 'dbo'}.${objectName}`);

      const result = await req.query(`
        SELECT OBJECT_DEFINITION(OBJECT_ID(@objName)) AS definition;
      `);

      const liveDefinition = result.recordset[0]?.definition;
      if (!liveDefinition) {
        return {
          detected: true,
          checked: true,
          reason: 'OBJECT_NOT_FOUND_IN_DB',
          message: 'Hedef view canlı veritabanında bulunamadı (silinmiş veya taşınmış olabilir).'
        };
      }

      const currentLiveHash = computeSqlHash(liveDefinition);
      const savedHash = workspace.originalDefinitionHash || computeSqlHash(workspace.originalSql);

      const detected = currentLiveHash !== savedHash;
      return {
        detected,
        checked: true,
        currentLiveHash,
        savedHash,
        message: detected
          ? 'Bu workspace oluşturulduktan sonra canlı veritabanındaki view tanımı değişmiş (Database Drift).'
          : 'Canlı veritabanındaki tanım ile workspace tanımı eşleşiyor.'
      };
    } catch (err) {
      console.warn('[WorkspaceService] Database drift check skipped:', err.message);
      return { detected: false, checked: false, error: err.message };
    }
  }

  // =========================================================================
  // Workspaces CRUD
  // =========================================================================

  async createWorkspace(payload) {
    const { target, title, originalSql, notes, sourceDatabaseFingerprint } = payload;

    if (!target || !target.objectName) {
      throw new Error('Hedef nesne (target) bilgisi zorunludur.');
    }

    const canonicalId = target.canonicalId || `[${target.database || ''}].[${target.schema || 'dbo'}].[${target.objectName}]`;
    const origSql = originalSql || '';
    const origHash = computeSqlHash(origSql);

    // Check for existing active workspace for this canonical object
    const existing = this.storage.findWorkspaceByCanonicalId(canonicalId, false);

    const ws = this.storage.saveWorkspace({
      title: title || `${target.schema || 'dbo'}.${target.objectName} İyileştirme`,
      target,
      status: WORKSPACE_STATUS.DRAFT,
      originalSql: origSql,
      originalDefinitionHash: origHash,
      notes: notes || '',
      sourceDatabaseFingerprint: sourceDatabaseFingerprint || (target.database ? `DB:${target.database}` : null)
    });

    this.storage.saveAuditEvent({
      workspaceId: ws.id,
      type: 'WORKSPACE_CREATED',
      metadata: {
        canonicalId,
        database: target.database,
        hasExistingWorkspace: Boolean(existing),
        existingWorkspaceId: existing?.id || null
      }
    });

    return {
      workspace: ws,
      duplicateWarning: existing ? `Bu nesne için açık bir çalışma zaten mevcut (${existing.title}).` : null
    };
  }

  async getWorkspace(id, options = { checkDrift: true }) {
    const ws = this.storage.getWorkspaceById(id);
    if (!ws) return null;

    const candidates = this.storage.listCandidatesByWorkspace(id);
    const selectedCandidate = candidates.find(c => c.id === ws.selectedCandidateId) || candidates[candidates.length - 1] || null;

    let validations = [];
    let benchmarks = [];
    let plans = [];

    if (selectedCandidate) {
      validations = this.storage.listValidationsByCandidate(selectedCandidate.id);
      benchmarks = this.storage.listBenchmarksByCandidate(selectedCandidate.id);
      plans = this.storage.listPlansByCandidate(selectedCandidate.id);
    }

    const auditEvents = this.storage.listAuditEventsByWorkspace(id);

    let driftInfo = { detected: false, checked: false };
    if (options.checkDrift) {
      driftInfo = await this.checkDatabaseDrift(ws);
    }

    const freshness = evaluateEvidenceFreshness({
      originalSql: ws.originalSql,
      savedOriginalHash: ws.originalDefinitionHash,
      candidateSql: selectedCandidate?.sql || '',
      validationSnapshot: validations[0] || null,
      benchmarkSnapshot: benchmarks[0] || null,
      dbDriftDetected: driftInfo.detected
    });

    return {
      ...ws,
      candidates,
      selectedCandidate,
      validations,
      benchmarks,
      plans,
      auditEvents,
      databaseDrift: driftInfo,
      evidenceFreshness: freshness
    };
  }

  listWorkspaces(options = {}) {
    return this.storage.listWorkspaces(options);
  }

  updateWorkspace(id, patch) {
    const ws = this.storage.getWorkspaceById(id);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    if (patch.title !== undefined) ws.title = patch.title;
    if (patch.notes !== undefined) ws.notes = patch.notes;
    if (patch.selectedCandidateId !== undefined) ws.selectedCandidateId = patch.selectedCandidateId;

    if (patch.status && patch.status !== ws.status) {
      const transCheck = canTransitionWorkspace(ws.status, patch.status, patch.context || {});
      if (!transCheck.allowed) {
        throw new Error(`Durum değişikliği engellendi: ${transCheck.reason}`);
      }
      ws.status = patch.status;
    }

    ws.updatedAt = new Date().toISOString();
    return this.storage.saveWorkspace(ws);
  }

  archiveWorkspace(id, isArchived = true) {
    const ws = this.storage.getWorkspaceById(id);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const updated = this.storage.archiveWorkspace(id, isArchived);
    this.storage.saveAuditEvent({
      workspaceId: id,
      type: isArchived ? 'WORKSPACE_ARCHIVED' : 'WORKSPACE_UNARCHIVED',
      metadata: { previousStatus: ws.status }
    });
    return updated;
  }

  deleteWorkspace(id) {
    const ws = this.storage.getWorkspaceById(id);
    if (!ws) throw new Error('Çalışma bulunamadı.');
    return this.storage.deleteWorkspace(id);
  }

  // =========================================================================
  // Candidates Management
  // =========================================================================

  addCandidate(workspaceId, candidateData) {
    const ws = this.storage.getWorkspaceById(workspaceId);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const existingCandidates = this.storage.listCandidatesByWorkspace(workspaceId);
    const nextVersion = existingCandidates.length + 1;

    const sql = candidateData.sql || '';
    const sqlHash = computeSqlHash(sql);

    const cand = this.storage.saveCandidate({
      workspaceId,
      versionNumber: nextVersion,
      sql,
      sqlHash,
      source: candidateData.source || 'AI_REFACTOR',
      model: candidateData.model || null,
      aiSummary: candidateData.aiSummary || '',
      findings: candidateData.findings || [],
      risks: candidateData.risks || [],
      status: CANDIDATE_STATUS.DRAFT
    });

    // Auto-select newest candidate and advance status to CANDIDATE_GENERATED
    ws.selectedCandidateId = cand.id;
    if ([WORKSPACE_STATUS.DRAFT, WORKSPACE_STATUS.ANALYZED].includes(ws.status)) {
      ws.status = WORKSPACE_STATUS.CANDIDATE_GENERATED;
    }
    ws.updatedAt = new Date().toISOString();
    this.storage.saveWorkspace(ws);

    this.storage.saveAuditEvent({
      workspaceId,
      candidateId: cand.id,
      type: 'CANDIDATE_CREATED',
      metadata: {
        versionNumber: nextVersion,
        source: cand.source,
        model: cand.model,
        sqlHash
      }
    });

    return cand;
  }

  // =========================================================================
  // Validation, Benchmark, and Plan Snapshots
  // =========================================================================

  recordValidation(workspaceId, candidateId, validationResult) {
    const ws = this.storage.getWorkspaceById(workspaceId);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const cand = this.storage.getCandidateById(candidateId);
    if (!cand) throw new Error('Aday bulunamadı.');

    const candidateSqlHash = cand.sqlHash || computeSqlHash(cand.sql);
    const verdict = validationResult.verdict || (validationResult.passed ? 'PASS' : 'FAIL');

    const snap = this.storage.saveValidationSnapshot({
      workspaceId,
      candidateId,
      candidateSqlHash,
      verdict,
      schemaMatch: Boolean(validationResult.schemaMatch),
      rowSetMatch: Boolean(validationResult.rowSetMatch),
      multiplicityMatch: Boolean(validationResult.multiplicityMatch),
      warnings: validationResult.warnings || [],
      evidence: validationResult.evidence || {}
    });

    // Update candidate status
    cand.status = verdict === 'FAIL' ? CANDIDATE_STATUS.FAILED_VALIDATION : CANDIDATE_STATUS.VALIDATED;
    this.storage.saveCandidate(cand);

    // Update workspace status if appropriate
    if (['PASS', 'PASS_WITH_WARNING'].includes(verdict)) {
      if ([WORKSPACE_STATUS.DRAFT, WORKSPACE_STATUS.CANDIDATE_GENERATED].includes(ws.status)) {
        ws.status = WORKSPACE_STATUS.VALIDATED;
        ws.updatedAt = new Date().toISOString();
        this.storage.saveWorkspace(ws);
      }
    }

    this.storage.saveAuditEvent({
      workspaceId,
      candidateId,
      type: 'VALIDATION_RUN',
      metadata: {
        verdict,
        schemaMatch: snap.schemaMatch,
        rowSetMatch: snap.rowSetMatch,
        warningsCount: snap.warnings.length
      }
    });

    return snap;
  }

  recordBenchmark(workspaceId, candidateId, benchmarkResult) {
    const ws = this.storage.getWorkspaceById(workspaceId);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const cand = this.storage.getCandidateById(candidateId);
    if (!cand) throw new Error('Aday bulunamadı.');

    const candidateSqlHash = cand.sqlHash || computeSqlHash(cand.sql);
    const originalSqlHash = ws.originalDefinitionHash || computeSqlHash(ws.originalSql);

    const snap = this.storage.saveBenchmarkSnapshot({
      workspaceId,
      candidateId,
      candidateSqlHash,
      originalSqlHash,
      original: benchmarkResult.original || {},
      candidate: benchmarkResult.candidate || {},
      comparison: benchmarkResult.comparison || {},
      settings: benchmarkResult.settings || {}
    });

    cand.status = CANDIDATE_STATUS.BENCHMARKED;
    this.storage.saveCandidate(cand);

    // Update workspace status to BENCHMARKED
    if ([WORKSPACE_STATUS.VALIDATED, WORKSPACE_STATUS.CANDIDATE_GENERATED].includes(ws.status)) {
      ws.status = WORKSPACE_STATUS.BENCHMARKED;
      ws.updatedAt = new Date().toISOString();
      this.storage.saveWorkspace(ws);
    }

    this.storage.saveAuditEvent({
      workspaceId,
      candidateId,
      type: 'BENCHMARK_RUN',
      metadata: {
        durationImprovement: snap.comparison?.durationImprovementPercent ?? null,
        cpuImprovement: snap.comparison?.cpuImprovementPercent ?? null,
        readsImprovement: snap.comparison?.logicalReadsImprovementPercent ?? null
      }
    });

    return snap;
  }

  recordPlan(workspaceId, candidateId, planResult) {
    const snap = this.storage.savePlanSnapshot({
      workspaceId,
      candidateId,
      planHash: planResult.planHash || null,
      source: planResult.source || 'ESTIMATED',
      parsedPlanSummary: planResult.parsedPlanSummary || planResult.planSummary || {},
      warnings: planResult.warnings || [],
      topOperators: planResult.topOperators || [],
      cardinalityFindings: planResult.cardinalityFindings || [],
      missingIndexes: planResult.missingIndexes || [],
      comparison: planResult.comparison || {}
    });
    return snap;
  }

  // =========================================================================
  // Human Approval Workflow
  // =========================================================================

  async approveCandidate(workspaceId, candidateId, options = {}) {
    const ws = this.storage.getWorkspaceById(workspaceId);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const cand = this.storage.getCandidateById(candidateId);
    if (!cand) throw new Error('Aday bulunamadı.');

    // Enforce human-only approval
    if (options.isAutomatedOrAi) {
      throw new Error('Yapay Zeka (AI) veya otomatik süreçler adayı onaylayamaz. Onay mutlaka bir kullanıcı tarafından verilmelidir.');
    }

    // Check latest validation
    const validations = this.storage.listValidationsByCandidate(candidateId);
    const latestVal = validations[0];
    if (!latestVal || latestVal.verdict === 'FAIL') {
      throw new Error('Semantik doğrulamadan geçmemiş (FAIL veya doğrulanmamış) aday ONAYLANAMAZ.');
    }

    // Check drift
    const drift = await this.checkDatabaseDrift(ws);
    if (drift.detected && !options.overrideDrift) {
      throw new Error('Canlı veritabanındaki view tanımı değişmiş (Database Drift). Onay vermeden önce drift incelenmeli veya açıkça göz ardı edilmelidir.');
    }

    // Transition checks
    const transCheck = canTransitionWorkspace(ws.status, WORKSPACE_STATUS.APPROVED, {
      validationVerdict: latestVal.verdict,
      databaseDrift: drift.detected,
      overrideDrift: Boolean(options.overrideDrift),
      isAutomatedOrAi: false
    });
    if (!transCheck.allowed) {
      throw new Error(`Onay engellendi: ${transCheck.reason}`);
    }

    cand.status = CANDIDATE_STATUS.APPROVED;
    this.storage.saveCandidate(cand);

    ws.status = WORKSPACE_STATUS.APPROVED;
    ws.selectedCandidateId = candidateId;
    ws.updatedAt = new Date().toISOString();
    this.storage.saveWorkspace(ws);

    this.storage.saveAuditEvent({
      workspaceId,
      candidateId,
      type: 'CANDIDATE_APPROVED',
      metadata: {
        approverNote: options.approverNote || null,
        validationVerdict: latestVal.verdict,
        driftOverridden: Boolean(options.overrideDrift)
      }
    });

    return {
      workspace: ws,
      candidate: cand,
      message: `Aday v${cand.versionNumber} başarıyla onaylandı.`
    };
  }

  rejectCandidate(workspaceId, candidateId, options = {}) {
    const ws = this.storage.getWorkspaceById(workspaceId);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const cand = this.storage.getCandidateById(candidateId);
    if (!cand) throw new Error('Aday bulunamadı.');

    cand.status = CANDIDATE_STATUS.REJECTED;
    this.storage.saveCandidate(cand);

    // If this was the approved candidate, revert workspace status to BENCHMARKED or VALIDATED
    if (ws.status === WORKSPACE_STATUS.APPROVED && ws.selectedCandidateId === candidateId) {
      ws.status = WORKSPACE_STATUS.BENCHMARKED;
      ws.updatedAt = new Date().toISOString();
      this.storage.saveWorkspace(ws);
    }

    this.storage.saveAuditEvent({
      workspaceId,
      candidateId,
      type: 'CANDIDATE_REJECTED',
      metadata: {
        reason: options.reason || 'Kullanıcı tarafından reddedildi'
      }
    });

    return {
      workspace: ws,
      candidate: cand,
      message: `Aday v${cand.versionNumber} reddedildi.`
    };
  }

  // =========================================================================
  // Safe Deployment Script Pipeline
  // =========================================================================

  async generateDeploymentPackage(workspaceId, options = {}) {
    const ws = this.storage.getWorkspaceById(workspaceId);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const candidateId = options.candidateId || ws.selectedCandidateId;
    if (!candidateId) throw new Error('Dağıtım için aday seçilmedi.');

    const cand = this.storage.getCandidateById(candidateId);
    if (!cand) throw new Error('Aday bulunamadı.');

    if (cand.status !== CANDIDATE_STATUS.APPROVED && !options.allowUnapproved) {
      throw new Error('Dağıtım betiği üretilmeden önce aday kullanıcı tarafından ONAYLANMALIDIR (APPROVED).');
    }

    const drift = await this.checkDatabaseDrift(ws);
    if (drift.detected && !options.overrideDrift) {
      const err = new Error('SCRIPT_GENERATION_BLOCKED_DATABASE_DRIFT: Canlı veritabanındaki view tanımı çalışma oluşturulduktan sonra değişmiş. Betik üretimi engellendi.');
      err.code = 'SCRIPT_GENERATION_BLOCKED_DATABASE_DRIFT';
      throw err;
    }

    const validations = this.storage.listValidationsByCandidate(candidateId);
    const benchmarks = this.storage.listBenchmarksByCandidate(candidateId);
    const plans = this.storage.listPlansByCandidate(candidateId);

    const pkg = deploymentService.createDeploymentPackage({
      workspace: ws,
      candidate: cand,
      validationSnapshot: validations[0] || null,
      benchmarkSnapshot: benchmarks[0] || null,
      planSnapshot: plans[0] || null,
      databaseDrift: drift.detected,
      overrideDrift: Boolean(options.overrideDrift),
      useCreateOrAlter: options.useCreateOrAlter !== false
    });

    // Advance workspace status
    ws.status = WORKSPACE_STATUS.SCRIPT_GENERATED;
    ws.updatedAt = new Date().toISOString();
    this.storage.saveWorkspace(ws);

    this.storage.saveAuditEvent({
      workspaceId,
      candidateId,
      type: 'SCRIPT_GENERATED',
      metadata: {
        useCreateOrAlter: options.useCreateOrAlter !== false,
        driftOverridden: Boolean(options.overrideDrift)
      }
    });

    return pkg;
  }

  // =========================================================================
  // Export Workspace Package (JSON)
  // =========================================================================

  exportWorkspace(id) {
    const ws = this.storage.getWorkspaceById(id);
    if (!ws) throw new Error('Çalışma bulunamadı.');

    const candidates = this.storage.listCandidatesByWorkspace(id);
    const auditEvents = this.storage.listAuditEventsByWorkspace(id);

    const allValidations = {};
    const allBenchmarks = {};
    const allPlans = {};

    for (const c of candidates) {
      allValidations[c.id] = this.storage.listValidationsByCandidate(c.id);
      allBenchmarks[c.id] = this.storage.listBenchmarksByCandidate(c.id);
      allPlans[c.id] = this.storage.listPlansByCandidate(c.id);
    }

    return {
      exportedAt: new Date().toISOString(),
      app: 'SQL Server Refactoring & Performance Studio',
      workspace: ws,
      candidates,
      validations: allValidations,
      benchmarks: allBenchmarks,
      plans: allPlans,
      auditEvents
    };
  }
}

const defaultWorkspaceService = new WorkspaceService(defaultStorage);

module.exports = {
  WorkspaceService,
  defaultWorkspaceService
};
