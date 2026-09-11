/**
 * SQL Server Refactoring & Performance Studio
 * Workspace Local Persistence Engine (Sprint 6)
 *
 * Persistence Strategy:
 * 1. Node.js built-in `node:sqlite` (DatabaseSync) if available (Node 22.5+, Node 24).
 *    Uses runtime/workspaces.db with WAL mode for concurrency safety.
 * 2. Robust embedded JSON storage fallback (runtime/workspaces.local.json) with atomic temp-file write + rename.
 *
 * Security & Reliability:
 * - Passwords, secrets, and API keys are NEVER written to workspace storage.
 * - Schema versioning and migration management (schemaVersion = 1).
 * - Soft archive support (is_archived).
 * - Resilient error handling (available: false, reason: 'STORAGE_ERROR' on failure).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_DIR = path.join(__dirname, '..', '..', 'runtime');
const SQLITE_FILE = path.join(RUNTIME_DIR, 'workspaces.db');
const JSON_FILE = path.join(RUNTIME_DIR, 'workspaces.local.json');
const SCHEMA_VERSION = 2;

function hasSensitiveKeywords(sql) {
  if (!sql || typeof sql !== 'string') return false;
  return /(?:password\s*=|pwd\s*=|bearer\s+[a-zA-Z0-9_\-\.]|api[_-]?key\s*=|secret\s*=|symmetric\s+key|master\s+key|access_token|alter\s+login)/i.test(sql);
}

function redactSensitiveSql(sql) {
  if (!sql || typeof sql !== 'string') return '';
  return sql.replace(/(password\s*=\s*)(?:'[^']*'|"[^"]*"|\S+)/gi, "$1'***REDACTED***'")
            .replace(/(pwd\s*=\s*)(?:'[^']*'|"[^"]*"|\S+)/gi, "$1'***REDACTED***'")
            .replace(/((?:'pwd'|"pwd"|'password'|"password")\s*,\s*)(?:'[^']*'|"[^"]*"|\S+)/gi, "$1'***REDACTED***'")
            .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1***REDACTED***')
            .replace(/(api[_-]?key\s*=\s*)(?:'[^']*'|"[^"]*"|\S+)/gi, "$1'***REDACTED***'")
            .replace(/(secret\s*=\s*)(?:'[^']*'|"[^"]*"|\S+)/gi, "$1'***REDACTED***'");
}

class WorkspaceStorage {
  constructor(options = {}) {
    this.runtimeDir = options.runtimeDir || RUNTIME_DIR;
    this.sqliteFile = options.sqliteFile || SQLITE_FILE;
    this.jsonFile = options.jsonFile || JSON_FILE;
    this.forceJson = options.forceJson || false;

    this.backendType = 'NONE';
    this.isAvailable = false;
    this.storageError = null;
    this.sqliteDb = null;
    this.jsonData = null;

    this.init();
  }

  ensureRuntimeDir() {
    if (!fs.existsSync(this.runtimeDir)) {
      fs.mkdirSync(this.runtimeDir, { recursive: true });
    }
  }

  init() {
    try {
      this.ensureRuntimeDir();

      if (!this.forceJson) {
        try {
          const { DatabaseSync } = require('node:sqlite');
          if (DatabaseSync) {
            this.sqliteDb = new DatabaseSync(this.sqliteFile);
            this.sqliteDb.exec('PRAGMA journal_mode = WAL;');
            this.sqliteDb.exec('PRAGMA foreign_keys = ON;');
            this.initSqliteSchema();
            this.backendType = 'SQLITE';
            this.isAvailable = true;
            return;
          }
        } catch (sqliteErr) {
          console.warn('[WorkspaceStorage] node:sqlite not available, falling back to embedded JSON:', sqliteErr.message);
        }
      }

      // Fallback: Atomic JSON storage
      this.initJsonStorage();
      this.backendType = 'JSON';
      this.isAvailable = true;
    } catch (err) {
      console.error('[WorkspaceStorage] Storage initialization failed:', err.message);
      this.isAvailable = false;
      this.storageError = err.message;
      this.backendType = 'ERROR';
    }
  }

  // =========================================================================
  // SQLite Backend Implementation
  // =========================================================================

  initSqliteSchema() {
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        database_name TEXT NOT NULL,
        schema_name TEXT NOT NULL,
        object_name TEXT NOT NULL,
        object_type TEXT NOT NULL,
        canonical_id TEXT NOT NULL,
        status TEXT NOT NULL,
        original_sql TEXT NOT NULL,
        original_definition_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_database_fingerprint TEXT,
        selected_candidate_id TEXT,
        notes TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status);
      CREATE INDEX IF NOT EXISTS idx_workspaces_canonical ON workspaces(canonical_id);

      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        sql TEXT NOT NULL,
        sql_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT,
        created_at TEXT NOT NULL,
        ai_summary TEXT,
        findings_json TEXT,
        risks_json TEXT,
        status TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_candidates_workspace ON candidates(workspace_id, version_number);

      CREATE TABLE IF NOT EXISTS validation_snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        candidate_sql_hash TEXT NOT NULL,
        verdict TEXT NOT NULL,
        schema_match INTEGER NOT NULL,
        row_set_match INTEGER NOT NULL,
        multiplicity_match INTEGER NOT NULL,
        warnings_json TEXT,
        evidence_json TEXT,
        executed_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_validations_candidate ON validation_snapshots(candidate_id, executed_at DESC);

      CREATE TABLE IF NOT EXISTS benchmark_snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        candidate_sql_hash TEXT NOT NULL,
        original_sql_hash TEXT NOT NULL,
        original_metrics_json TEXT,
        candidate_metrics_json TEXT,
        comparison_json TEXT,
        settings_json TEXT,
        executed_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_benchmarks_candidate ON benchmark_snapshots(candidate_id, executed_at DESC);

      CREATE TABLE IF NOT EXISTS plan_snapshots (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        plan_hash TEXT,
        source TEXT,
        plan_summary_json TEXT,
        warnings_json TEXT,
        top_operators_json TEXT,
        cardinality_findings_json TEXT,
        missing_indexes_json TEXT,
        comparison_json TEXT,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_plans_candidate ON plan_snapshots(candidate_id, recorded_at DESC);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        candidate_id TEXT,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata_json TEXT,
        FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_events(workspace_id, timestamp ASC);

      CREATE TABLE IF NOT EXISTS saved_queries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sql TEXT NOT NULL,
        database_name TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_saved_queries_updated ON saved_queries(updated_at DESC);
    `);

    // Migration 1: Base Workspaces & Saved Queries
    const mig1 = this.sqliteDb.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(1);
    if (!mig1) {
      this.sqliteDb.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
    }

    // Migration 2: Query History & Workbench Sessions (Sprint 7)
    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS query_history (
        id TEXT PRIMARY KEY,
        sql TEXT NOT NULL,
        sql_hash TEXT NOT NULL,
        database_name TEXT,
        executed_at TEXT NOT NULL,
        duration_ms REAL DEFAULT 0,
        min_duration_ms REAL DEFAULT 0,
        max_duration_ms REAL DEFAULT 0,
        avg_duration_ms REAL DEFAULT 0,
        cpu_ms REAL DEFAULT 0,
        logical_reads INTEGER DEFAULT 0,
        row_count INTEGER DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 1,
        error_code TEXT,
        error_message TEXT,
        execution_count INTEGER NOT NULL DEFAULT 1,
        has_sensitive_keywords INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_query_history_executed ON query_history(executed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_query_history_hash ON query_history(sql_hash, database_name, success);

      CREATE TABLE IF NOT EXISTS workbench_sessions (
        id TEXT PRIMARY KEY,
        tab_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        sql TEXT NOT NULL,
        database_name TEXT,
        cursor_pos_json TEXT,
        is_dirty INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workbench_sessions_order ON workbench_sessions(tab_order ASC);
    `);

    try { this.sqliteDb.exec('ALTER TABLE query_history ADD COLUMN min_duration_ms REAL DEFAULT 0;'); } catch (_) {}
    try { this.sqliteDb.exec('ALTER TABLE query_history ADD COLUMN max_duration_ms REAL DEFAULT 0;'); } catch (_) {}
    try { this.sqliteDb.exec('ALTER TABLE query_history ADD COLUMN avg_duration_ms REAL DEFAULT 0;'); } catch (_) {}
    try { this.sqliteDb.exec('ALTER TABLE query_history ADD COLUMN has_sensitive_keywords INTEGER DEFAULT 0;'); } catch (_) {}
    try { this.sqliteDb.exec('ALTER TABLE workbench_sessions ADD COLUMN is_dirty INTEGER DEFAULT 0;'); } catch (_) {}

    const mig2 = this.sqliteDb.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(2);
    if (!mig2) {
      this.sqliteDb.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
    }
  }

  // =========================================================================
  // Embedded JSON Backend Implementation (Fallback & Portability)
  // =========================================================================

  initJsonStorage() {
    if (fs.existsSync(this.jsonFile)) {
      try {
        const raw = fs.readFileSync(this.jsonFile, 'utf8');
        this.jsonData = JSON.parse(raw);
        // Schema migration to v2
        if ((this.jsonData.schemaVersion || 1) < 2) {
          this.jsonData.queryHistory = this.jsonData.queryHistory || {};
          this.jsonData.workbenchSessions = this.jsonData.workbenchSessions || {};
          this.jsonData.schemaVersion = 2;
          this.saveJsonFile();
        }
      } catch (err) {
        console.warn('[WorkspaceStorage] Existing JSON invalid, initializing fresh storage:', err.message);
        this.jsonData = this.createEmptyJsonState();
      }
    } else {
      this.jsonData = this.createEmptyJsonState();
      this.saveJsonFile();
    }
  }

  createEmptyJsonState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      workspaces: {},
      candidates: {},
      validationSnapshots: {},
      benchmarkSnapshots: {},
      planSnapshots: {},
      auditEvents: {},
      savedQueries: {},
      queryHistory: {},
      workbenchSessions: {}
    };
  }

  saveJsonFile() {
    this.ensureRuntimeDir();
    const tmpFile = `${this.jsonFile}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
    const payload = JSON.stringify(this.jsonData, null, 2);
    fs.writeFileSync(tmpFile, payload, 'utf8');
    fs.renameSync(tmpFile, this.jsonFile);
  }

  // =========================================================================
  // Status Check
  // =========================================================================

  getStatus() {
    return {
      available: this.isAvailable,
      backend: this.backendType,
      error: this.storageError,
      schemaVersion: SCHEMA_VERSION
    };
  }

  // =========================================================================
  // Workspaces CRUD
  // =========================================================================

  saveWorkspace(ws) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const now = new Date().toISOString();
    const doc = {
      id: ws.id || `ws_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      title: ws.title || 'İsimsiz Çalışma',
      database_name: ws.target?.database || ws.database_name || '',
      schema_name: ws.target?.schema || ws.schema_name || 'dbo',
      object_name: ws.target?.objectName || ws.object_name || '',
      object_type: ws.target?.objectType || ws.object_type || 'VIEW',
      canonical_id: ws.target?.canonicalId || ws.canonical_id || `[${ws.target?.database || ''}].[${ws.target?.schema || 'dbo'}].[${ws.target?.objectName || ''}]`,
      status: ws.status || 'DRAFT',
      original_sql: ws.originalSql || ws.original_sql || '',
      original_definition_hash: ws.originalDefinitionHash || ws.original_definition_hash || '',
      created_at: ws.createdAt || ws.created_at || now,
      updated_at: now,
      source_database_fingerprint: ws.sourceDatabaseFingerprint || ws.source_database_fingerprint || null,
      selected_candidate_id: ws.selectedCandidateId || ws.selected_candidate_id || null,
      notes: ws.notes || '',
      is_archived: ws.isArchived ? 1 : (ws.is_archived ? 1 : 0)
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO workspaces (
          id, title, database_name, schema_name, object_name, object_type, canonical_id,
          status, original_sql, original_definition_hash, created_at, updated_at,
          source_database_fingerprint, selected_candidate_id, notes, is_archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          status = excluded.status,
          updated_at = excluded.updated_at,
          selected_candidate_id = excluded.selected_candidate_id,
          notes = excluded.notes,
          is_archived = excluded.is_archived;
      `);
      stmt.run(
        doc.id, doc.title, doc.database_name, doc.schema_name, doc.object_name, doc.object_type, doc.canonical_id,
        doc.status, doc.original_sql, doc.original_definition_hash, doc.created_at, doc.updated_at,
        doc.source_database_fingerprint, doc.selected_candidate_id, doc.notes, doc.is_archived
      );
    } else {
      this.jsonData.workspaces[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.getWorkspaceById(doc.id);
  }

  getWorkspaceById(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    let raw;
    if (this.backendType === 'SQLITE') {
      raw = this.sqliteDb.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    } else {
      raw = this.jsonData.workspaces[id];
    }
    if (!raw) return null;

    return this.mapWorkspaceRow(raw);
  }

  findWorkspaceByCanonicalId(canonicalId, includeArchived = false) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    let raw;
    if (this.backendType === 'SQLITE') {
      const sql = includeArchived
        ? 'SELECT * FROM workspaces WHERE canonical_id = ? ORDER BY updated_at DESC LIMIT 1'
        : 'SELECT * FROM workspaces WHERE canonical_id = ? AND is_archived = 0 ORDER BY updated_at DESC LIMIT 1';
      raw = this.sqliteDb.prepare(sql).get(canonicalId);
    } else {
      const list = Object.values(this.jsonData.workspaces)
        .filter(w => w.canonical_id === canonicalId && (includeArchived || !w.is_archived))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      raw = list[0];
    }
    return raw ? this.mapWorkspaceRow(raw) : null;
  }

  listWorkspaces(options = {}) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const {
      status,
      search,
      isArchived = false,
      page = 1,
      pageSize = 20
    } = options;

    const offset = Math.max(0, (page - 1) * pageSize);
    const limit = Math.max(1, pageSize);

    if (this.backendType === 'SQLITE') {
      let where = 'WHERE 1=1';
      const params = [];

      if (isArchived !== undefined && isArchived !== null) {
        where += ' AND is_archived = ?';
        params.push(isArchived ? 1 : 0);
      }

      if (status && status !== 'ALL') {
        where += ' AND status = ?';
        params.push(status);
      }

      if (search && search.trim()) {
        where += ' AND (title LIKE ? OR object_name LIKE ? OR database_name LIKE ?)';
        const term = `%${search.trim()}%`;
        params.push(term, term, term);
      }

      const countSql = `SELECT COUNT(*) AS total FROM workspaces ${where}`;
      const total = this.sqliteDb.prepare(countSql).get(...params).total;

      const selectSql = `
        SELECT id, title, database_name, schema_name, object_name, object_type, canonical_id,
               status, original_definition_hash, created_at, updated_at, selected_candidate_id, is_archived
        FROM workspaces
        ${where}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?;
      `;
      const rows = this.sqliteDb.prepare(selectSql).all(...params, limit, offset);

      return {
        items: rows.map(r => this.mapWorkspaceRow(r)),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / limit)
      };
    } else {
      let list = Object.values(this.jsonData.workspaces);

      if (isArchived !== undefined && isArchived !== null) {
        list = list.filter(w => Boolean(w.is_archived) === Boolean(isArchived));
      }

      if (status && status !== 'ALL') {
        list = list.filter(w => w.status === status);
      }

      if (search && search.trim()) {
        const term = search.trim().toLowerCase();
        list = list.filter(w =>
          (w.title && w.title.toLowerCase().includes(term)) ||
          (w.object_name && w.object_name.toLowerCase().includes(term)) ||
          (w.database_name && w.database_name.toLowerCase().includes(term))
        );
      }

      const total = list.length;
      list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      const paged = list.slice(offset, offset + limit);

      return {
        items: paged.map(r => this.mapWorkspaceRow(r)),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / limit)
      };
    }
  }

  archiveWorkspace(id, isArchived = true) {
    const ws = this.getWorkspaceById(id);
    if (!ws) return null;
    ws.isArchived = isArchived;
    ws.updatedAt = new Date().toISOString();
    return this.saveWorkspace(ws);
  }

  deleteWorkspace(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      this.sqliteDb.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      this.sqliteDb.prepare('DELETE FROM candidates WHERE workspace_id = ?').run(id);
      this.sqliteDb.prepare('DELETE FROM validation_snapshots WHERE workspace_id = ?').run(id);
      this.sqliteDb.prepare('DELETE FROM benchmark_snapshots WHERE workspace_id = ?').run(id);
      this.sqliteDb.prepare('DELETE FROM plan_snapshots WHERE workspace_id = ?').run(id);
      this.sqliteDb.prepare('DELETE FROM audit_events WHERE workspace_id = ?').run(id);
    } else {
      delete this.jsonData.workspaces[id];
      // Cascading cleanup in JSON
      const filterOut = (dict) => {
        for (const [k, v] of Object.entries(dict)) {
          if (v.workspaceId === id || v.workspace_id === id) delete dict[k];
        }
      };
      filterOut(this.jsonData.candidates);
      filterOut(this.jsonData.validationSnapshots);
      filterOut(this.jsonData.benchmarkSnapshots);
      filterOut(this.jsonData.planSnapshots);
      filterOut(this.jsonData.auditEvents);
      this.saveJsonFile();
    }
    return true;
  }

  mapWorkspaceRow(r) {
    return {
      id: r.id,
      title: r.title,
      target: {
        database: r.database_name,
        schema: r.schema_name,
        objectName: r.object_name,
        objectType: r.object_type,
        canonicalId: r.canonical_id
      },
      status: r.status,
      originalSql: r.original_sql,
      originalDefinitionHash: r.original_definition_hash,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sourceDatabaseFingerprint: r.source_database_fingerprint,
      selectedCandidateId: r.selected_candidate_id,
      notes: r.notes || '',
      isArchived: Boolean(r.is_archived)
    };
  }

  // =========================================================================
  // Candidates CRUD
  // =========================================================================

  saveCandidate(cand) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const id = cand.id || `cand_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const doc = {
      id,
      workspace_id: cand.workspaceId || cand.workspace_id,
      version_number: cand.versionNumber || cand.version_number || 1,
      sql: cand.sql || '',
      sql_hash: cand.sqlHash || cand.sql_hash || '',
      source: cand.source || 'AI_REFACTOR',
      model: cand.model || null,
      created_at: cand.createdAt || cand.created_at || new Date().toISOString(),
      ai_summary: cand.aiSummary || cand.ai_summary || '',
      findings_json: JSON.stringify(cand.findings || []),
      risks_json: JSON.stringify(cand.risks || []),
      status: cand.status || 'DRAFT'
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO candidates (
          id, workspace_id, version_number, sql, sql_hash, source, model,
          created_at, ai_summary, findings_json, risks_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sql = excluded.sql,
          sql_hash = excluded.sql_hash,
          ai_summary = excluded.ai_summary,
          findings_json = excluded.findings_json,
          risks_json = excluded.risks_json,
          status = excluded.status;
      `);
      stmt.run(
        doc.id, doc.workspace_id, doc.version_number, doc.sql, doc.sql_hash, doc.source, doc.model,
        doc.created_at, doc.ai_summary, doc.findings_json, doc.risks_json, doc.status
      );
    } else {
      this.jsonData.candidates[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.getCandidateById(doc.id);
  }

  getCandidateById(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    let raw;
    if (this.backendType === 'SQLITE') {
      raw = this.sqliteDb.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
    } else {
      raw = this.jsonData.candidates[id];
    }
    return raw ? this.mapCandidateRow(raw) : null;
  }

  listCandidatesByWorkspace(workspaceId) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const rows = this.sqliteDb.prepare('SELECT * FROM candidates WHERE workspace_id = ? ORDER BY version_number ASC').all(workspaceId);
      return rows.map(r => this.mapCandidateRow(r));
    } else {
      const list = Object.values(this.jsonData.candidates)
        .filter(c => c.workspace_id === workspaceId || c.workspaceId === workspaceId)
        .sort((a, b) => (a.version_number || a.versionNumber) - (b.version_number || b.versionNumber));
      return list.map(r => this.mapCandidateRow(r));
    }
  }

  mapCandidateRow(r) {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      versionNumber: r.version_number,
      sql: r.sql,
      sqlHash: r.sql_hash,
      source: r.source,
      model: r.model,
      createdAt: r.created_at,
      aiSummary: r.ai_summary,
      findings: safeJsonParse(r.findings_json, []),
      risks: safeJsonParse(r.risks_json, []),
      status: r.status
    };
  }

  // =========================================================================
  // Validation Snapshots
  // =========================================================================

  saveValidationSnapshot(snap) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const id = snap.id || `val_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const doc = {
      id,
      workspace_id: snap.workspaceId || snap.workspace_id,
      candidate_id: snap.candidateId || snap.candidate_id,
      candidate_sql_hash: snap.candidateSqlHash || snap.candidate_sql_hash || '',
      verdict: snap.verdict || 'INCONCLUSIVE',
      schema_match: snap.schemaMatch ? 1 : 0,
      row_set_match: snap.rowSetMatch ? 1 : 0,
      multiplicity_match: snap.multiplicityMatch ? 1 : 0,
      warnings_json: JSON.stringify(snap.warnings || []),
      evidence_json: JSON.stringify(snap.evidence || {}),
      executed_at: snap.executedAt || snap.executed_at || new Date().toISOString()
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO validation_snapshots (
          id, workspace_id, candidate_id, candidate_sql_hash, verdict,
          schema_match, row_set_match, multiplicity_match, warnings_json, evidence_json, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      stmt.run(
        doc.id, doc.workspace_id, doc.candidate_id, doc.candidate_sql_hash, doc.verdict,
        doc.schema_match, doc.row_set_match, doc.multiplicity_match, doc.warnings_json, doc.evidence_json, doc.executed_at
      );
    } else {
      this.jsonData.validationSnapshots[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.mapValidationRow(doc);
  }

  listValidationsByCandidate(candidateId) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const rows = this.sqliteDb.prepare('SELECT * FROM validation_snapshots WHERE candidate_id = ? ORDER BY executed_at DESC').all(candidateId);
      return rows.map(r => this.mapValidationRow(r));
    } else {
      const list = Object.values(this.jsonData.validationSnapshots)
        .filter(v => v.candidate_id === candidateId || v.candidateId === candidateId)
        .sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
      return list.map(r => this.mapValidationRow(r));
    }
  }

  mapValidationRow(r) {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      candidateId: r.candidate_id,
      candidateSqlHash: r.candidate_sql_hash,
      verdict: r.verdict,
      schemaMatch: Boolean(r.schema_match),
      rowSetMatch: Boolean(r.row_set_match),
      multiplicityMatch: Boolean(r.multiplicity_match),
      warnings: safeJsonParse(r.warnings_json, []),
      evidence: safeJsonParse(r.evidence_json, {}),
      executedAt: r.executed_at
    };
  }

  // =========================================================================
  // Benchmark Snapshots
  // =========================================================================

  saveBenchmarkSnapshot(snap) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const id = snap.id || `bm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const doc = {
      id,
      workspace_id: snap.workspaceId || snap.workspace_id,
      candidate_id: snap.candidateId || snap.candidate_id,
      candidate_sql_hash: snap.candidateSqlHash || snap.candidate_sql_hash || '',
      original_sql_hash: snap.originalSqlHash || snap.original_sql_hash || '',
      original_metrics_json: JSON.stringify(snap.original || snap.originalMetrics || {}),
      candidate_metrics_json: JSON.stringify(snap.candidate || snap.candidateMetrics || {}),
      comparison_json: JSON.stringify(snap.comparison || {}),
      settings_json: JSON.stringify(snap.settings || {}),
      executed_at: snap.executedAt || snap.executed_at || new Date().toISOString()
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO benchmark_snapshots (
          id, workspace_id, candidate_id, candidate_sql_hash, original_sql_hash,
          original_metrics_json, candidate_metrics_json, comparison_json, settings_json, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      stmt.run(
        doc.id, doc.workspace_id, doc.candidate_id, doc.candidate_sql_hash, doc.original_sql_hash,
        doc.original_metrics_json, doc.candidate_metrics_json, doc.comparison_json, doc.settings_json, doc.executed_at
      );
    } else {
      this.jsonData.benchmarkSnapshots[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.mapBenchmarkRow(doc);
  }

  listBenchmarksByCandidate(candidateId) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const rows = this.sqliteDb.prepare('SELECT * FROM benchmark_snapshots WHERE candidate_id = ? ORDER BY executed_at DESC').all(candidateId);
      return rows.map(r => this.mapBenchmarkRow(r));
    } else {
      const list = Object.values(this.jsonData.benchmarkSnapshots)
        .filter(b => b.candidate_id === candidateId || b.candidateId === candidateId)
        .sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
      return list.map(r => this.mapBenchmarkRow(r));
    }
  }

  mapBenchmarkRow(r) {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      candidateId: r.candidate_id,
      candidateSqlHash: r.candidate_sql_hash,
      originalSqlHash: r.original_sql_hash,
      original: safeJsonParse(r.original_metrics_json, {}),
      candidate: safeJsonParse(r.candidate_metrics_json, {}),
      comparison: safeJsonParse(r.comparison_json, {}),
      settings: safeJsonParse(r.settings_json, {}),
      executedAt: r.executed_at
    };
  }

  // =========================================================================
  // Plan Snapshots
  // =========================================================================

  savePlanSnapshot(snap) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const id = snap.id || `plan_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const doc = {
      id,
      workspace_id: snap.workspaceId || snap.workspace_id,
      candidate_id: snap.candidateId || snap.candidate_id,
      plan_hash: snap.planHash || snap.plan_hash || null,
      source: snap.source || 'ESTIMATED',
      plan_summary_json: JSON.stringify(snap.parsedPlanSummary || snap.planSummary || {}),
      warnings_json: JSON.stringify(snap.warnings || []),
      top_operators_json: JSON.stringify(snap.topOperators || []),
      cardinality_findings_json: JSON.stringify(snap.cardinalityFindings || []),
      missing_indexes_json: JSON.stringify(snap.missingIndexes || []),
      comparison_json: JSON.stringify(snap.comparison || {}),
      recorded_at: snap.recordedAt || snap.recorded_at || new Date().toISOString()
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO plan_snapshots (
          id, workspace_id, candidate_id, plan_hash, source,
          plan_summary_json, warnings_json, top_operators_json, cardinality_findings_json,
          missing_indexes_json, comparison_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `);
      stmt.run(
        doc.id, doc.workspace_id, doc.candidate_id, doc.plan_hash, doc.source,
        doc.plan_summary_json, doc.warnings_json, doc.top_operators_json, doc.cardinality_findings_json,
        doc.missing_indexes_json, doc.comparison_json, doc.recorded_at
      );
    } else {
      this.jsonData.planSnapshots[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.mapPlanRow(doc);
  }

  listPlansByCandidate(candidateId) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const rows = this.sqliteDb.prepare('SELECT * FROM plan_snapshots WHERE candidate_id = ? ORDER BY recorded_at DESC').all(candidateId);
      return rows.map(r => this.mapPlanRow(r));
    } else {
      const list = Object.values(this.jsonData.planSnapshots)
        .filter(p => p.candidate_id === candidateId || p.candidateId === candidateId)
        .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
      return list.map(r => this.mapPlanRow(r));
    }
  }

  mapPlanRow(r) {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      candidateId: r.candidate_id,
      planHash: r.plan_hash,
      source: r.source,
      parsedPlanSummary: safeJsonParse(r.plan_summary_json, {}),
      warnings: safeJsonParse(r.warnings_json, []),
      topOperators: safeJsonParse(r.top_operators_json, []),
      cardinalityFindings: safeJsonParse(r.cardinality_findings_json, []),
      missingIndexes: safeJsonParse(r.missing_indexes_json, []),
      comparison: safeJsonParse(r.comparison_json, {}),
      recordedAt: r.recorded_at
    };
  }

  // =========================================================================
  // Audit Trail Events
  // =========================================================================

  saveAuditEvent(event) {
    if (!this.isAvailable) return null; // Non-fatal for audit logging

    const id = event.id || `evt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    // Sanitize metadata: NEVER log passwords or raw connection strings
    const sanitizedMeta = sanitizeAuditMetadata(event.metadata || {});

    const doc = {
      id,
      workspace_id: event.workspaceId || event.workspace_id,
      candidate_id: event.candidateId || event.candidate_id || null,
      event_type: event.type || event.event_type || 'WORKSPACE_EVENT',
      timestamp: event.timestamp || new Date().toISOString(),
      metadata_json: JSON.stringify(sanitizedMeta)
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO audit_events (id, workspace_id, candidate_id, event_type, timestamp, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?);
      `);
      stmt.run(doc.id, doc.workspace_id, doc.candidate_id, doc.event_type, doc.timestamp, doc.metadata_json);
    } else {
      this.jsonData.auditEvents[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.mapAuditRow(doc);
  }

  listAuditEventsByWorkspace(workspaceId) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const rows = this.sqliteDb.prepare('SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY timestamp ASC').all(workspaceId);
      return rows.map(r => this.mapAuditRow(r));
    } else {
      const list = Object.values(this.jsonData.auditEvents)
        .filter(e => e.workspace_id === workspaceId || e.workspaceId === workspaceId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      return list.map(r => this.mapAuditRow(r));
    }
  }

  mapAuditRow(r) {
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      candidateId: r.candidate_id,
      type: r.event_type,
      timestamp: r.timestamp,
      metadata: safeJsonParse(r.metadata_json, {})
    };
  }

  // =========================================================================
  // Saved Queries (Workbench Integration)
  // =========================================================================

  saveWorkbenchQuery(query) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const now = new Date().toISOString();
    const id = query.id || `sq_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const doc = {
      id,
      name: query.name || 'İsimsiz Sorgu',
      sql: query.sql || '',
      database_name: query.database || query.database_name || null,
      is_favorite: query.isFavorite ? 1 : 0,
      created_at: query.createdAt || query.created_at || now,
      updated_at: now
    };

    if (this.backendType === 'SQLITE') {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO saved_queries (id, name, sql, database_name, is_favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          sql = excluded.sql,
          database_name = excluded.database_name,
          is_favorite = excluded.is_favorite,
          updated_at = excluded.updated_at;
      `);
      stmt.run(doc.id, doc.name, doc.sql, doc.database_name, doc.is_favorite, doc.created_at, doc.updated_at);
    } else {
      this.jsonData.savedQueries[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    return this.getWorkbenchQueryById(doc.id);
  }

  getWorkbenchQueryById(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    let raw;
    if (this.backendType === 'SQLITE') {
      raw = this.sqliteDb.prepare('SELECT * FROM saved_queries WHERE id = ?').get(id);
    } else {
      raw = this.jsonData.savedQueries[id];
    }
    return raw ? this.mapSavedQueryRow(raw) : null;
  }

  listWorkbenchQueries(options = {}) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const { favoriteOnly = false, database } = options;

    if (this.backendType === 'SQLITE') {
      let where = 'WHERE 1=1';
      const params = [];
      if (favoriteOnly) {
        where += ' AND is_favorite = 1';
      }
      if (database) {
        where += ' AND (database_name = ? OR database_name IS NULL)';
        params.push(database);
      }
      const rows = this.sqliteDb.prepare(`SELECT * FROM saved_queries ${where} ORDER BY is_favorite DESC, updated_at DESC`).all(...params);
      return rows.map(r => this.mapSavedQueryRow(r));
    } else {
      let list = Object.values(this.jsonData.savedQueries);
      if (favoriteOnly) {
        list = list.filter(q => Boolean(q.is_favorite));
      }
      if (database) {
        list = list.filter(q => !q.database_name || q.database_name === database);
      }
      list.sort((a, b) => (b.is_favorite - a.is_favorite) || (new Date(b.updated_at) - new Date(a.updated_at)));
      return list.map(r => this.mapSavedQueryRow(r));
    }
  }

  deleteWorkbenchQuery(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      this.sqliteDb.prepare('DELETE FROM saved_queries WHERE id = ?').run(id);
    } else {
      delete this.jsonData.savedQueries[id];
      this.saveJsonFile();
    }
    return true;
  }

  mapSavedQueryRow(r) {
    return {
      id: r.id,
      name: r.name,
      sql: r.sql,
      database: r.database_name,
      isFavorite: Boolean(r.is_favorite),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  // =========================================================================
  // Query History (Sprint 7 Workbench)
  // =========================================================================

  saveQueryHistory(entry, options = {}) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const now = new Date().toISOString();
    const rawSql = entry.sql || '';
    const normalized = rawSql.trim();
    const sqlHash = entry.sqlHash || crypto.createHash('sha256').update(normalized).digest('hex');
    const dbName = entry.database || entry.database_name || null;
    const deduplicate = options.deduplicate !== false;

    // Duplicate compression / grouping (same query + database + success status within recent history)
    const isSuccess = entry.success !== undefined ? (entry.success ? 1 : 0) : 1;
    const dur = Number(entry.durationMs ?? entry.duration_ms ?? 0);
    const hasSensitive = hasSensitiveKeywords(rawSql) ? 1 : 0;

    if (deduplicate) {
      if (this.backendType === 'SQLITE') {
        const existing = this.sqliteDb.prepare(`
          SELECT * FROM query_history
          WHERE sql_hash = ? AND (database_name = ? OR (database_name IS NULL AND ? IS NULL)) AND success = ?
          ORDER BY executed_at DESC LIMIT 1
        `).get(sqlHash, dbName, dbName, isSuccess);

        if (existing) {
          const newCount = (existing.execution_count || 1) + 1;
          const prevMin = Number(existing.min_duration_ms || existing.duration_ms || dur);
          const prevMax = Number(existing.max_duration_ms || existing.duration_ms || dur);
          const prevAvg = Number(existing.avg_duration_ms || existing.duration_ms || dur);
          const newMin = Math.min(prevMin, dur);
          const newMax = Math.max(prevMax, dur);
          const newAvg = Math.round((prevAvg * (newCount - 1) + dur) / newCount);

          this.sqliteDb.prepare(`
            UPDATE query_history
            SET executed_at = ?,
                duration_ms = ?,
                min_duration_ms = ?,
                max_duration_ms = ?,
                avg_duration_ms = ?,
                cpu_ms = ?,
                logical_reads = ?,
                row_count = ?,
                success = ?,
                error_code = ?,
                error_message = ?,
                execution_count = ?
            WHERE id = ?
          `).run(
            now,
            dur,
            newMin,
            newMax,
            newAvg,
            entry.cpuMs ?? entry.cpu_ms ?? existing.cpu_ms,
            entry.logicalReads ?? entry.logical_reads ?? existing.logical_reads,
            entry.rowCount ?? entry.row_count ?? existing.row_count,
            isSuccess,
            entry.errorCode || entry.error_code || null,
            entry.errorMessage || entry.error_message || null,
            newCount,
            existing.id
          );
          return this.getQueryHistoryById(existing.id);
        }
      } else {
        const list = Object.values(this.jsonData.queryHistory || {});
        const existing = list.find(q =>
          q.sql_hash === sqlHash &&
          (q.database_name === dbName || (!q.database_name && !dbName)) &&
          (q.success !== undefined ? (q.success ? 1 : 0) : 1) === isSuccess
        );
        if (existing) {
          const newCount = (existing.execution_count || 1) + 1;
          const prevMin = Number(existing.min_duration_ms || existing.duration_ms || dur);
          const prevMax = Number(existing.max_duration_ms || existing.duration_ms || dur);
          const prevAvg = Number(existing.avg_duration_ms || existing.duration_ms || dur);
          existing.executed_at = now;
          existing.duration_ms = dur;
          existing.min_duration_ms = Math.min(prevMin, dur);
          existing.max_duration_ms = Math.max(prevMax, dur);
          existing.avg_duration_ms = Math.round((prevAvg * (newCount - 1) + dur) / newCount);
          existing.cpu_ms = entry.cpuMs ?? entry.cpu_ms ?? existing.cpu_ms;
          existing.logical_reads = entry.logicalReads ?? entry.logical_reads ?? existing.logical_reads;
          existing.row_count = entry.rowCount ?? entry.row_count ?? existing.row_count;
          existing.success = isSuccess;
          existing.error_code = entry.errorCode || entry.error_code || null;
          existing.error_message = entry.errorMessage || entry.error_message || null;
          existing.execution_count = newCount;
          this.saveJsonFile();
          return this.mapQueryHistoryRow(existing);
        }
      }
    }

    const id = entry.id || `qh_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const doc = {
      id,
      sql: hasSensitive ? redactSensitiveSql(rawSql) : rawSql,
      sql_hash: sqlHash,
      database_name: dbName,
      executed_at: entry.executedAt || entry.executed_at || now,
      duration_ms: dur,
      min_duration_ms: dur,
      max_duration_ms: dur,
      avg_duration_ms: dur,
      cpu_ms: entry.cpuMs ?? entry.cpu_ms ?? 0,
      logical_reads: entry.logicalReads ?? entry.logical_reads ?? 0,
      row_count: entry.rowCount ?? entry.row_count ?? 0,
      success: isSuccess,
      error_code: entry.errorCode || entry.error_code || null,
      error_message: entry.errorMessage || entry.error_message || null,
      execution_count: 1,
      has_sensitive_keywords: hasSensitive
    };

    if (this.backendType === 'SQLITE') {
      this.sqliteDb.prepare(`
        INSERT INTO query_history (
          id, sql, sql_hash, database_name, executed_at, duration_ms, min_duration_ms, max_duration_ms, avg_duration_ms,
          cpu_ms, logical_reads, row_count, success, error_code, error_message, execution_count, has_sensitive_keywords
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.id, doc.sql, doc.sql_hash, doc.database_name, doc.executed_at,
        doc.duration_ms, doc.min_duration_ms, doc.max_duration_ms, doc.avg_duration_ms,
        doc.cpu_ms, doc.logical_reads, doc.row_count,
        doc.success, doc.error_code, doc.error_message, doc.execution_count, doc.has_sensitive_keywords
      );
    } else {
      this.jsonData.queryHistory = this.jsonData.queryHistory || {};
      this.jsonData.queryHistory[doc.id] = { ...doc };
      this.saveJsonFile();
    }

    // Enforce history retention limit
    this.enforceHistoryRetention(options.maxEntries || 10000);

    return this.getQueryHistoryById(doc.id);
  }

  enforceHistoryRetention(maxEntries = 10000) {
    if (!this.isAvailable) return 0;
    const limit = Math.max(10, parseInt(maxEntries, 10) || 10000);

    try {
      if (this.backendType === 'SQLITE') {
        const info = this.sqliteDb.prepare(`
          DELETE FROM query_history
          WHERE id NOT IN (
            SELECT id FROM query_history ORDER BY executed_at DESC LIMIT ?
          )
        `).run(limit);
        return info?.changes || 0;
      } else {
        const list = Object.values(this.jsonData.queryHistory || {});
        if (list.length > limit) {
          list.sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
          const removed = list.length - limit;
          const kept = list.slice(0, limit);
          const newObj = {};
          kept.forEach(k => { newObj[k.id] = k; });
          this.jsonData.queryHistory = newObj;
          this.saveJsonFile();
          return removed;
        }
        return 0;
      }
    } catch (_) {
      return 0;
    }
  }

  getQueryHistoryById(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    let raw;
    if (this.backendType === 'SQLITE') {
      raw = this.sqliteDb.prepare('SELECT * FROM query_history WHERE id = ?').get(id);
    } else {
      raw = (this.jsonData.queryHistory || {})[id];
    }
    return raw ? this.mapQueryHistoryRow(raw) : null;
  }

  listQueryHistory(options = {}) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const {
      search,
      database,
      successOnly = false,
      limit = 50,
      offset = 0
    } = options;

    const parsedLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    if (this.backendType === 'SQLITE') {
      let where = 'WHERE 1=1';
      const params = [];

      if (search) {
        where += ' AND sql LIKE ?';
        params.push(`%${search}%`);
      }
      if (database) {
        where += ' AND database_name = ?';
        params.push(database);
      }
      if (successOnly) {
        where += ' AND success = 1';
      }

      const countRow = this.sqliteDb.prepare(`SELECT COUNT(*) as total FROM query_history ${where}`).get(...params);
      const total = countRow ? countRow.total : 0;

      const rows = this.sqliteDb.prepare(`
        SELECT * FROM query_history
        ${where}
        ORDER BY executed_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, parsedLimit, parsedOffset);

      return {
        items: rows.map(r => this.mapQueryHistoryRow(r)),
        total,
        limit: parsedLimit,
        offset: parsedOffset
      };
    } else {
      let list = Object.values(this.jsonData.queryHistory || {});

      if (search) {
        const s = search.toLowerCase();
        list = list.filter(q => (q.sql || '').toLowerCase().includes(s));
      }
      if (database) {
        list = list.filter(q => q.database_name === database);
      }
      if (successOnly) {
        list = list.filter(q => Boolean(q.success));
      }

      const total = list.length;
      list.sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at));
      const paged = list.slice(parsedOffset, parsedOffset + parsedLimit);

      return {
        items: paged.map(r => this.mapQueryHistoryRow(r)),
        total,
        limit: parsedLimit,
        offset: parsedOffset
      };
    }
  }

  deleteQueryHistory(id) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const res = this.sqliteDb.prepare('DELETE FROM query_history WHERE id = ?').run(id);
      return res.changes > 0;
    } else {
      if (this.jsonData.queryHistory && this.jsonData.queryHistory[id]) {
        delete this.jsonData.queryHistory[id];
        this.saveJsonFile();
        return true;
      }
      return false;
    }
  }

  clearQueryHistory() {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      this.sqliteDb.prepare('DELETE FROM query_history').run();
    } else {
      this.jsonData.queryHistory = {};
      this.saveJsonFile();
    }
    return true;
  }

  mapQueryHistoryRow(r) {
    const hasSensitive = r.has_sensitive_keywords !== undefined
      ? (r.has_sensitive_keywords ? 1 : 0)
      : (r.hasSensitiveKeywords ? 1 : 0);
    const minDur = Number(r.min_duration_ms || r.duration_ms || r.minDurationMs || 0);
    const maxDur = Number(r.max_duration_ms || r.duration_ms || r.maxDurationMs || 0);
    const avgDur = Number(r.avg_duration_ms || r.duration_ms || r.avgDurationMs || 0);
    const execCount = Number(r.execution_count || r.executionCount || 1);
    const dur = Number(r.duration_ms || r.durationMs || 0);

    return {
      id: r.id,
      sql: r.sql,
      sqlHash: r.sql_hash || r.sqlHash,
      sql_hash: r.sql_hash || r.sqlHash,
      database: r.database_name || r.database,
      database_name: r.database_name || r.database,
      executedAt: r.executed_at || r.executedAt,
      executed_at: r.executed_at || r.executedAt,
      durationMs: dur,
      duration_ms: dur,
      minDurationMs: minDur,
      min_duration_ms: minDur,
      maxDurationMs: maxDur,
      max_duration_ms: maxDur,
      avgDurationMs: avgDur,
      avg_duration_ms: avgDur,
      cpuMs: Number(r.cpu_ms || r.cpuMs || 0),
      cpu_ms: Number(r.cpu_ms || r.cpuMs || 0),
      logicalReads: Number(r.logical_reads || r.logicalReads || 0),
      logical_reads: Number(r.logical_reads || r.logicalReads || 0),
      rowCount: Number(r.row_count || 0),
      row_count: Number(r.row_count || 0),
      success: Boolean(r.success),
      errorCode: r.error_code || null,
      error_code: r.error_code || null,
      errorMessage: r.error_message || null,
      error_message: r.error_message || null,
      executionCount: execCount,
      execution_count: execCount,
      hasSensitiveKeywords: Boolean(hasSensitive),
      has_sensitive_keywords: hasSensitive
    };
  }

  // =========================================================================
  // Workbench Sessions & Tabs Persistence (Sprint 7)
  // =========================================================================

  getWorkbenchSessions() {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      const rows = this.sqliteDb.prepare('SELECT * FROM workbench_sessions ORDER BY tab_order ASC').all();
      return rows.map(r => this.mapWorkbenchSessionRow(r));
    } else {
      const list = Object.values(this.jsonData.workbenchSessions || {});
      list.sort((a, b) => (a.tab_order ?? 0) - (b.tab_order ?? 0));
      return list.map(r => this.mapWorkbenchSessionRow(r));
    }
  }

  saveWorkbenchSessions(tabs = []) {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    const now = new Date().toISOString();

    if (this.backendType === 'SQLITE') {
      this.sqliteDb.exec('BEGIN TRANSACTION;');
      try {
        this.sqliteDb.prepare('DELETE FROM workbench_sessions').run();
        const insertStmt = this.sqliteDb.prepare(`
          INSERT INTO workbench_sessions (id, tab_order, title, sql, database_name, cursor_pos_json, is_dirty, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        tabs.forEach((tab, index) => {
          const tabId = tab.id || `tab_${Date.now()}_${index}`;
          const tabOrder = index;
          const title = tab.title || `Sorgu ${index + 1}`;
          const sql = tab.sql || '';
          const dbName = tab.database || tab.database_name || null;
          const cursorPos = JSON.stringify(tab.cursorPos || tab.cursor_pos || { line: 1, ch: 1 });
          const isDirty = tab.isRunning ? 0 : ((tab.isDirty || tab.is_dirty) ? 1 : 0);
          insertStmt.run(tabId, tabOrder, title, sql, dbName, cursorPos, isDirty, now);
        });

        this.sqliteDb.exec('COMMIT;');
      } catch (err) {
        this.sqliteDb.exec('ROLLBACK;');
        throw err;
      }
    } else {
      this.jsonData.workbenchSessions = {};
      tabs.forEach((tab, index) => {
        const tabId = tab.id || `tab_${Date.now()}_${index}`;
        const isDirty = tab.isRunning ? false : Boolean(tab.isDirty || tab.is_dirty);
        this.jsonData.workbenchSessions[tabId] = {
          id: tabId,
          tab_order: index,
          title: tab.title || `Sorgu ${index + 1}`,
          sql: tab.sql || '',
          database_name: tab.database || tab.database_name || null,
          cursor_pos_json: JSON.stringify(tab.cursorPos || tab.cursor_pos || { line: 1, ch: 1 }),
          is_dirty: isDirty ? 1 : 0,
          isDirty,
          updated_at: now
        };
      });
      this.saveJsonFile();
    }

    return true;
  }

  clearWorkbenchSessions() {
    if (!this.isAvailable) throw new Error(`Workspace storage unavailable: ${this.storageError}`);

    if (this.backendType === 'SQLITE') {
      this.sqliteDb.prepare('DELETE FROM workbench_sessions').run();
    } else {
      this.jsonData.workbenchSessions = {};
      this.saveJsonFile();
    }
    return true;
  }

  mapWorkbenchSessionRow(r) {
    return {
      id: r.id,
      tabOrder: Number(r.tab_order ?? 0),
      title: r.title,
      sql: r.sql,
      database: r.database_name,
      cursorPos: safeJsonParse(r.cursor_pos_json, { line: 1, ch: 1 }),
      updatedAt: r.updated_at,
      isRunning: false,
      isDirty: Boolean(r.is_dirty || r.isDirty)
    };
  }

  // =========================================================================
  // Close / Teardown
  // =========================================================================

  close() {
    if (this.sqliteDb) {
      try {
        this.sqliteDb.close();
      } catch (_) {}
      this.sqliteDb = null;
    }
    this.isAvailable = false;
  }
}

// Helpers
function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

function sanitizeAuditMetadata(meta) {
  const clean = { ...meta };
  // Guard against accidental sensitive data
  const forbidden = ['password', 'pwd', 'apiKey', 'token', 'secret', 'connectionString'];
  for (const k of Object.keys(clean)) {
    if (forbidden.some(f => k.toLowerCase().includes(f.toLowerCase()))) {
      clean[k] = '[REDACTED]';
    }
  }
  return clean;
}

// Export singleton instance + Class
const defaultStorage = new WorkspaceStorage();

module.exports = {
  WorkspaceStorage,
  defaultStorage,
  SCHEMA_VERSION,
  redactSensitiveSql,
  hasSensitiveKeywords
};
