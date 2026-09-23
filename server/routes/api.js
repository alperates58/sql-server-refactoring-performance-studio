const express = require('express');
const db = require('../services/sqlServer');
const scanner = require('../services/scanner');
const ai = require('../services/aiProvider');
const capabilities = require('../services/capabilities');
const settings = require('../services/settingsService');
const metadataCatalog = require('../services/metadataCatalog');
const workbench = require('../services/workbenchService');
const planParser = require('../services/planParser');
const validation = require('../services/validationService');
const runtimeEvidence = require('../services/runtimeEvidence');
const planComparison = require('../../public/assets/js/modules/planComparison');
const benchmarkComparison = require('../../public/assets/js/modules/benchmarkComparison');
const refactorDecision = require('../../public/assets/js/modules/refactorDecision');
const astParser = require('../services/ast/astParser');
const astAnalyzer = require('../services/ast/astAnalyzer');
const schemaMetadata = require('../services/schemaMetadata');
const indexMetadata = require('../services/indexMetadata');
const indexAdvisor = require('../services/indexAdvisor');
const statisticsHealth = require('../services/statisticsHealth');
const activityMonitor = require('../services/activityMonitor');
const { defaultWorkspaceService } = require('../services/workspaceService');
const { defaultSavedQueriesService } = require('../services/savedQueriesService');
const { defaultStorage } = require('../services/workspaceStorage');
const { defaultQueryHistoryService } = require('../services/queryHistoryService');
const iterativeOptimizer = require('../services/aiOptimizer/iterativeOptimizer');
const sqlFormatter = require('../services/sqlFormatter');
const workbenchPlanAnalyst = require('../services/workbenchPlanAnalyst');
const sql = require('mssql');
const pkg = require('../../package.json');

const router = express.Router();

// Safe error handler helper: guarantees no passwords/tokens leak in API responses
function handleSafeError(res, error, defaultMessage = 'Bir hata oluştu.') {
  const sanitized = db.sanitizeError(error);
  console.error('[API Error]:', sanitized.message);
  res.status(400).json({
    ok: false,
    error: sanitized.message || defaultMessage
  });
}

// 1. Health check & version (single source of truth: package.json)
router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'SQL Server Refactoring & Performance Studio',
    version: pkg.version
  });
});

router.get('/version', (_req, res) => {
  res.json({
    ok: true,
    version: pkg.version
  });
});

// 2. Connection status
router.get('/connection', (_req, res) => {
  res.json(db.status());
});

// 2b. Saved connection settings (safe copy without password)
router.get('/connection/saved', (_req, res) => {
  const saved = settings.getConfig().savedDbConnection;
  res.json({
    ok: true,
    data: saved || null
  });
});

// 2b. Step 1: Test Server Connection & Discover Databases
router.post('/connection/test-server', async (req, res) => {
  try {
    const data = await db.testServerConnection(req.body);
    res.json(data);
  } catch (error) {
    handleSafeError(res, error, 'Sunucu bağlantısı kurulamadı.');
  }
});

// 2c. Step 2: Set Database Scope & Primary DB
router.post('/connection/set-scope', async (req, res) => {
  try {
    const result = await db.setDatabaseScope({
      primaryDatabase: req.body.primaryDatabase,
      selectedDatabases: req.body.selectedDatabases
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Veritabanı kapsamı ayarlanamadı.');
  }
});

// 3. Test & connect (legacy single-db support)
router.post('/connection/test', async (req, res) => {
  try {
    const info = await db.connect(req.body);
    const result = await db.query(
      'SELECT @@VERSION AS version, DB_NAME() AS databaseName, SYSUTCDATETIME() AS utcNow;'
    );
    res.json({
      ok: true,
      connection: info,
      server: result.recordset[0]
    });
  } catch (error) {
    handleSafeError(res, error, 'Veritabanına bağlanılamadı.');
  }
});

// 4. Disconnect
router.delete('/connection', async (req, res) => {
  try {
    const clearSaved = Boolean(req.query.clearSaved === 'true' || req.body?.clearSaved);
    await db.disconnect({ clearSaved });
    res.json({ ok: true, message: 'Bağlantı kapatıldı.' });
  } catch (error) {
    handleSafeError(res, error);
  }
});

// 5. Capabilities & permissions
router.get('/capabilities', async (_req, res) => {
  try {
    const data = await capabilities.detect();
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'SQL Server yetenekleri tespit edilemedi.');
  }
});

// 6. Scan inventory & dependencies
router.post('/scan', async (req, res) => {
  try {
    const prefix = req.body.prefix || 'AA_';
    const scope = req.body.scope || null;
    const data = await scanner.scan(prefix, scope);
    metadataCatalog.loadFromScan(data).catch(() => {});
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Metadata taraması başarısız oldu.');
  }
});

// 7. Get latest scan if already performed
router.get('/scan/latest', (_req, res) => {
  const data = scanner.getLatestScanData();
  if (!data) {
    return res.status(404).json({ ok: false, error: 'Henüz tarama yapılmadı.' });
  }
  res.json({ ok: true, data });
});

// 7b. Query Store Runtime Timeseries
router.get('/runtime/timeseries', async (req, res) => {
  try {
    const windowKey = req.query.window || '24h';
    const database = req.query.database || null;
    const latest = scanner.getLatestScanData();

    if (latest?.timeseries?.points?.length > 0 && (!database || latest.timeseries.database === database) && latest.timeseries.window === windowKey) {
      return res.json({ ok: true, data: latest.timeseries });
    }

    const status = db.status();
    const targetDb = database || status.primaryDatabase || (status.selectedDatabases && status.selectedDatabases[0]);

    if (targetDb) {
      try {
        const pool = db.getPool(targetDb);
        const winSpec = runtimeEvidence.getWindowSpec(windowKey);
        const tsReq = pool.request();
        tsReq.timeout = 10000;
        tsReq.input('currOffset', sql.Int, winSpec.currentOffset);

        const tsRes = await tsReq.query(runtimeEvidence.buildQueryStoreTimeseriesQuery(winSpec));
        const tsRows = tsRes.recordset || [];

        return res.json({
          ok: true,
          data: {
            source: 'QUERY_STORE',
            window: winSpec.key,
            database: targetDb,
            points: tsRows.map(r => ({
              startTime: r.start_time,
              endTime: r.end_time,
              timestamp: r.start_time,
              executions: Number(r.executions || 0),
              avgDurationMs: Math.round(Number(r.avg_duration_ms || 0) * 10) / 10,
              avgCpuMs: Math.round(Number(r.avg_cpu_ms || 0) * 10) / 10,
              logicalReads: Number(r.total_logical_reads || 0)
            }))
          }
        });
      } catch (_) {}
    }

    res.json({
      ok: true,
      data: latest?.timeseries || {
        source: 'PLAN_CACHE',
        window: windowKey,
        points: []
      }
    });
  } catch (error) {
    handleSafeError(res, error, 'Zaman serisi verisi alınamadı.');
  }
});

// 8. Definition for a specific view (supports canonicalId and /source alias)
const handleViewDefinition = (req, res) => {
  const viewName = req.params.name;
  const sql = scanner.getDefinition(viewName);
  if (!sql) {
    return res.status(404).json({
      ok: false,
      error: `"${viewName}" için kaynak tanımı bulunamadı.`
    });
  }
  res.json({ ok: true, name: viewName, sql });
};

router.get('/views/:name/definition', handleViewDefinition);
router.get('/views/:name/source', handleViewDefinition);

// 9. Subgraph for a specific view with depth and direction filtering
router.get('/views/:name/graph', (req, res) => {
  const viewName = req.params.name;
  const options = {
    depth: req.query.depth || 2,
    direction: req.query.direction || 'both'
  };
  const graph = scanner.getSubGraphForView(viewName, options);
  if (!graph) {
    return res.status(404).json({
      ok: false,
      error: `"${viewName}" için bağımlılık grafiği bulunamadı.`
    });
  }
  res.json({ ok: true, name: viewName, graph });
});

// 9b. Indexes for a specific view's base tables
router.get('/views/:name/indexes', async (req, res) => {
  try {
    const viewName = req.params.name;
    const indexes = await scanner.getIndexesForView(viewName);
    res.json({ ok: true, name: viewName, indexes });
  } catch (error) {
    handleSafeError(res, error, 'İndeksler sorgulanamadı.');
  }
});

// 10. AI Iterative Refactor candidate proposal with Deterministic Quality Gates (Sprint 9)
router.post('/ai/refactor', async (req, res) => {
  try {
    const { viewName, sql, problems = [], baseTables = [], options = {}, database = null } = req.body;
    if (!viewName || !sql) {
      return res.status(400).json({ ok: false, error: 'viewName ve sql alanları zorunludur.' });
    }

    const targetDb = database || db.status().primaryDatabase;

    // Run Iterative Optimization Loop with Deterministic Quality Gates
    const iterResult = await iterativeOptimizer.runIterativeOptimization({
      viewName,
      sql,
      database: targetDb,
      options,
      maxIterations: options.maxIterations || 3,
      runBenchmark: options.runBenchmark !== false
    });

    const candidateSql = iterResult.bestCandidate?.candidateSql || null;
    const notes = iterResult.bestCandidate?.hypothesis || iterResult.reasons?.[0] || 'İteratif optimizasyon tamamlandı.';
    const bulletPoints = iterResult.bestCandidate?.changes?.map(c => c.description) || (iterResult.reasons?.length ? iterResult.reasons : [notes]);
    const risks = iterResult.bestCandidate?.risks || [];

    const dataPayload = {
      candidateSql,
      notes,
      bulletPoints,
      risks,
      status: iterResult.status,
      primaryCause: iterResult.primaryCause,
      contributingCauses: iterResult.contributingCauses,
      rewriteOpportunity: iterResult.rewriteOpportunity,
      indexStillRecommended: iterResult.indexStillRecommended,
      confidence: iterResult.bestCandidate?.confidence || iterResult.confidence,
      evidenceGrade: iterResult.bestCandidate?.evidenceGrade || iterResult.evidenceGrade,
      iterations: iterResult.iterations,
      bestCandidate: iterResult.bestCandidate,
      benchmarkLoadGuard: iterResult.benchmarkLoadGuard,
      missingIndexEvidence: iterResult.missingIndexEvidence || null
    };

    res.json({
      ok: true,
      status: iterResult.status,
      primaryCause: iterResult.primaryCause,
      contributingCauses: iterResult.contributingCauses,
      rewriteOpportunity: iterResult.rewriteOpportunity,
      indexStillRecommended: iterResult.indexStillRecommended,
      candidateSql,
      notes,
      bulletPoints,
      risks,
      iterations: iterResult.iterations,
      bestCandidate: iterResult.bestCandidate,
      benchmarkLoadGuard: iterResult.benchmarkLoadGuard,
      missingIndexEvidence: iterResult.missingIndexEvidence || null,
      data: dataPayload,
      ast: iterResult.contextPack?.ast || null,
      astAnalysis: iterResult.contextPack?.ast?.structuralFindings || null,
      indexCoverage: iterResult.contextPack?.indexes || []
    });
  } catch (error) {
    handleSafeError(res, error, 'AI candidate üretilemedi.');
  }
});

// 10-ast. T-SQL AST Parser & Semantic Analyzer Endpoint (Sprint 4)
router.post('/ast/parse', async (req, res) => {
  try {
    const { sql, database = null } = req.body;
    if (!sql) {
      return res.status(400).json({ ok: false, error: 'sql alanı zorunludur.' });
    }

    const targetDb = database || db.status().primaryDatabase;
    const ast = astParser.parseSql(sql);
    const analysis = astAnalyzer.analyzeAst(ast);

    const baseTableNames = (ast.tables || [])
      .filter(t => t.referenceType === 'BASE_TABLE')
      .map(t => t.object);

    const schemas = await schemaMetadata.batchGetSchemas(targetDb, baseTableNames);
    const indexes = await indexMetadata.batchGetIndexes(targetDb, baseTableNames);
    const coverage = indexMetadata.analyzeIndexCoverage(ast, indexes);
    const implicitConversions = schemaMetadata.detectImplicitConversions(ast.predicates, schemas);
    const overlappingIndexes = indexMetadata.analyzeOverlappingIndexes(indexes);

    res.json({
      ok: true,
      analysisSource: ast.analysisSource,
      status: ast.status,
      ast,
      analysis,
      schemas,
      indexes,
      coverage: coverage.coverageResults,
      findings: [
        ...analysis.findings,
        ...coverage.findings,
        ...implicitConversions,
        ...overlappingIndexes
      ]
    });
  } catch (error) {
    handleSafeError(res, error, 'AST analizi yapılamadı.');
  }
});

// 10-alt. AI Query Performance Diagnosis
router.post('/ai/analyze', async (req, res) => {
  try {
    const { viewName, sql, problems = [], baseTables = [], options = {} } = req.body;
    if (!viewName || !sql) {
      return res.status(400).json({ ok: false, error: 'viewName ve sql alanları zorunludur.' });
    }
    const result = await ai.analyzeQuery({ viewName, sql, problems, baseTables, options });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Sorgu analizi yapılamadı.');
  }
});

// 10-alt2. AI Multi-Level Deep Dive Query Analysis
router.post('/ai/deep-analyze', async (req, res) => {
  try {
    const { viewName, sql, problems = [], baseTables = [], options = {} } = req.body;
    if (!viewName || !sql) {
      return res.status(400).json({ ok: false, error: 'viewName ve sql alanları zorunludur.' });
    }
    const result = await ai.deepAnalyzeQuery({ viewName, sql, problems, baseTables, options });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Derinlemesine sorgu analizi yapılamadı.');
  }
});

// 10b. AI Connection Test
router.post('/ai/test', async (req, res) => {
  try {
    const { provider, model, apiKey, baseUrl } = req.body;
    const result = await ai.testConnection({ provider, model, apiKey, baseUrl });
    // Update in-memory settings on verified test so subsequent refactor operations can use them
    if (apiKey) {
      settings.updateConfig({
        ai: {
          provider: provider || 'deepseek',
          baseUrl: baseUrl || undefined,
          model: model || undefined,
          apiKey
        }
      });
    }
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'AI bağlantı testi başarısız.');
  }
});

// 11. Configuration Settings

router.get('/settings/config', (_req, res) => {
  res.json({ ok: true, data: settings.getConfig() });
});

router.post('/settings/config', (req, res) => {
  try {
    const updated = settings.updateConfig(req.body);
    res.json({ ok: true, data: updated });
  } catch (error) {
    handleSafeError(res, error, 'Ayarlar güncellenemedi.');
  }
});

router.post('/settings/reset-scoring', (_req, res) => {
  const reset = settings.resetScoringDefaults ? settings.resetScoringDefaults() : settings.getConfig().scoring;
  res.json({ ok: true, data: reset });
});

// Diagnostics & System Info Export (Sprint 8)
router.get('/diagnostics/export', async (_req, res) => {
  try {
    const caps = await capabilities.detect().catch(() => null);
    const monaco = resolveLocalMonacoPath();
    const data = settings.exportDiagnostics({
      capabilities: caps,
      monaco: {
        available: monaco.available,
        source: monaco.source
      },
      storageEngine: 'sqlite'
    });
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Tanılama raporu üretilemedi.');
  }
});

// ==========================================
// 13. SQL Workbench & Plan Execution Engine
// ==========================================

// Run Query
router.post('/workbench/run', async (req, res) => {
  try {
    const result = await workbench.execute({
      sql: req.body.sql,
      database: req.body.database,
      timeoutMs: req.body.timeoutMs,
      maxRows: req.body.maxRows,
      requestId: req.body.requestId
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Sorgu çalıştırılamadı.');
  }
});

// Cancel Active Query
router.post('/workbench/cancel', (req, res) => {
  const result = workbench.cancelRequest(req.body.requestId);
  res.json(result);
});

// Execution Plan (Estimated / Actual)
router.post('/workbench/plan', async (req, res) => {
  try {
    const planResult = await workbench.executePlan({
      sql: req.body.sql,
      database: req.body.database,
      mode: req.body.mode || 'estimated',
      timeoutMs: req.body.timeoutMs
    });
    const parsed = planParser.parseShowPlanXML(planResult.rawXml);
    res.json({
      ok: true,
      planType: planResult.planType,
      database: planResult.database,
      parsed,
      rawXml: planResult.rawXml
    });
  } catch (error) {
    handleSafeError(res, error, 'Execution plan alınamadı.');
  }
});

// AI Execution Plan Analyst (Feature - SQL Workbench AI Plan Analyst)
router.post('/workbench/analyze-plan', async (req, res) => {
  try {
    const {
      sql,
      database,
      mode = 'actual',
      parsedPlan,
      rawXml,
      metrics = {},
      statistics = {},
      benchmark = null,
      options = {}
    } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ ok: false, error: 'sql parametresi zorunludur.' });
    }

    const result = await workbenchPlanAnalyst.analyzeWorkbenchPlan({
      sql,
      database: database || db.status().primaryDatabase,
      mode,
      parsedPlan,
      rawXml,
      metrics,
      statistics,
      benchmark,
      options
    });

    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'AI Plan analizi yapılamadı.');
  }
});

// Query Benchmark
router.post('/workbench/benchmark', async (req, res) => {
  try {
    const result = await workbench.executeBenchmark({
      sql: req.body.sql,
      database: req.body.database,
      runs: req.body.runs || 3,
      warmUp: req.body.warmUp !== false,
      timeoutMs: req.body.timeoutMs,
      benchmarkId: req.body.benchmarkId
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Benchmark çalıştırılamadı.');
  }
});

// Query History (Sprint 7: Persistent SQLite/JSON with Search & Pagination)
router.get('/workbench/history', (req, res) => {
  try {
    const { search, database, successOnly, limit, offset } = req.query;
    if (search || database || successOnly !== undefined || limit || offset) {
      const result = defaultQueryHistoryService.getHistory({
        search,
        database,
        successOnly: successOnly === 'true' ? true : (successOnly === 'false' ? false : null),
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0
      });
      return res.json({ ok: true, data: result.items, pagination: result });
    }
    // Backward compatible default: list recent persistent history, fallback to in-memory if empty
    const result = defaultQueryHistoryService.getHistory({ limit: 50 });
    const data = (result.items && result.items.length > 0) ? result.items : workbench.getHistory();
    res.json({ ok: true, data, pagination: result });
  } catch (error) {
    handleSafeError(res, error, 'Geçmiş verileri getirilemedi.');
  }
});

router.delete('/workbench/history', (req, res) => {
  try {
    const { id } = req.query;
    if (id) {
      defaultQueryHistoryService.deleteHistory(id);
      res.json({ ok: true, message: 'Geçmiş kaydı silindi.' });
    } else {
      defaultQueryHistoryService.clearHistory();
      res.json({ ok: true, message: 'Tüm sorgu geçmişi temizlendi.' });
    }
  } catch (error) {
    handleSafeError(res, error, 'Geçmiş temizlenemedi.');
  }
});

router.get('/workbench/history/stats', (_req, res) => {
  try {
    const stats = defaultQueryHistoryService.getHistoryStats();
    res.json({ ok: true, data: stats });
  } catch (error) {
    handleSafeError(res, error, 'Geçmiş istatistikleri alınamadı.');
  }
});

// Workbench Sessions & Tabs Persistence (Sprint 7)
router.get('/workbench/sessions', (_req, res) => {
  try {
    const sessions = workbench.getWorkbenchSessions();
    res.json({ ok: true, data: sessions });
  } catch (error) {
    handleSafeError(res, error, 'Oturum sekmeleri yüklenemedi.');
  }
});

router.post('/workbench/sessions', (req, res) => {
  try {
    const tabs = req.body.tabs || [];
    const saved = workbench.saveWorkbenchSessions(tabs);
    res.json({ ok: true, data: saved });
  } catch (error) {
    handleSafeError(res, error, 'Oturum sekmeleri kaydedilemedi.');
  }
});

router.delete('/workbench/sessions', (_req, res) => {
  try {
    workbench.clearWorkbenchSessions();
    res.json({ ok: true, message: 'Oturum sekmeleri sıfırlandı.' });
  } catch (error) {
    handleSafeError(res, error, 'Oturum sekmeleri temizlenemedi.');
  }
});

// T-SQL Safe Formatter (Sprint 7)
router.post('/workbench/format', (req, res) => {
  try {
    const { sql } = req.body;
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ ok: false, error: 'Formatlanacak SQL metni belirtilmedi.' });
    }
    const formatted = sqlFormatter.formatSql(sql);
    res.json({ ok: true, formattedSql: formatted });
  } catch (error) {
    handleSafeError(res, error, 'SQL formatlama başarısız oldu.');
  }
});

// Monaco Offline Availability Info (Sprint 7.1)
const { resolveLocalMonacoPath } = require('../services/monacoLocator');
router.get('/workbench/monaco-info', (_req, res) => {
  const monaco = resolveLocalMonacoPath();
  res.json({
    ok: true,
    available: monaco.available,
    source: monaco.source,
    webPrefix: monaco.webPrefix
  });
});

// Metadata Catalog for Schema-Aware Autocomplete / IntelliSense

router.get('/workbench/metadata', (req, res) => {
  const catalog = metadataCatalog.getCatalog(req.query.database);
  res.json({ ok: true, data: catalog });
});

router.post('/workbench/metadata/refresh', async (req, res) => {
  try {
    const latest = scanner.getLatestScanData();
    if (latest) {
      await metadataCatalog.loadFromScan(latest);
    }
    const catalog = metadataCatalog.getCatalog(req.body.database);
    res.json({ ok: true, data: catalog });
  } catch (error) {
    handleSafeError(res, error, 'Metadata yenilenemedi.');
  }
});

// ==========================================
// 14. Validation Lab Equivalence Proof Engine
// ==========================================

router.post('/validation/verify', async (req, res) => {
  try {
    const result = await validation.validateEquivalence({
      originalSql: req.body.originalSql,
      candidateSql: req.body.candidateSql,
      database: req.body.database,
      sampleLimit: req.body.sampleLimit || 1000
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Validation testi tamamlanamadı.');
  }
});

// ==========================================
// 15. Unified Refactor Comparison Engine (Sprint 3)
// ==========================================

router.post('/refactor/compare', async (req, res) => {
  try {
    const {
      originalSql,
      candidateSql,
      database = null,
      viewName = null,
      runValidation = true,
      runBenchmark = true,
      runPlan = true,
      benchmarkRuns = 3,
      sampleLimit = 1000
    } = req.body;

    if (!originalSql || !candidateSql) {
      return res.status(400).json({
        ok: false,
        error: 'originalSql ve candidateSql alanları zorunludur.'
      });
    }

    const cleanOrig = validation.extractExecutableQueryFromView(originalSql);
    const cleanCand = validation.extractExecutableQueryFromView(candidateSql);

    let validationResult = null;
    let originalPlan = null;
    let candidatePlan = null;
    let planComp = null;
    let originalBench = null;
    let candidateBench = null;
    let benchComp = null;

    // 1. Semantic Validation
    if (runValidation) {
      try {
        validationResult = await validation.validateEquivalence({
          originalSql: cleanOrig,
          candidateSql: cleanCand,
          database,
          sampleLimit
        });
      } catch (valErr) {
        validationResult = {
          ok: false,
          status: 'FAIL',
          reason: `Doğrulama hatası: ${valErr.message}`
        };
      }
    }

    // 2. Execution Plans (Estimated)
    if (runPlan) {
      try {
        const origPlanRes = await workbench.executePlan({ sql: cleanOrig, database, mode: 'estimated' });
        originalPlan = planParser.parseShowPlanXML(origPlanRes.rawXml);
      } catch (pErr1) {
        originalPlan = { error: pErr1.message, totalSubTreeCost: 0, operators: [], warnings: [] };
      }

      try {
        const candPlanRes = await workbench.executePlan({ sql: cleanCand, database, mode: 'estimated' });
        candidatePlan = planParser.parseShowPlanXML(candPlanRes.rawXml);
      } catch (pErr2) {
        candidatePlan = { error: pErr2.message, totalSubTreeCost: 0, operators: [], warnings: [] };
      }

      if (originalPlan && candidatePlan) {
        planComp = planComparison.comparePlans(originalPlan, candidatePlan);
      }
    }

    // 3. Performance Benchmark (STATISTICS IO / TIME via Alternating A/B/B/A/A/B)
    if (runBenchmark) {
      try {
        const altResult = await workbench.executeAlternatingBenchmark({
          originalSql: cleanOrig,
          candidateSql: cleanCand,
          database,
          runs: benchmarkRuns,
          warmUp: true
        });

        if (altResult.ok) {
          originalBench = altResult.original;
          candidateBench = altResult.candidate;
          benchComp = benchmarkComparison.compareBenchmarks(originalBench, candidateBench);
          benchComp.executionPattern = altResult.executionPattern;
          benchComp.alternatingRuns = altResult.runs;
        }
      } catch (bErr) {
        originalBench = { error: bErr.message, metrics: { medianDurationMs: 0, medianLogicalReads: 0 } };
        candidateBench = { error: bErr.message, metrics: { medianDurationMs: 0, medianLogicalReads: 0 } };
      }
    }

    // 4. Deterministic Decision & Confidence
    const decision = refactorDecision.evaluateRefactorDecision({
      validation: validationResult || {},
      benchmark: benchComp || {},
      planComparison: planComp || {}
    });

    const confidence = refactorDecision.calculateRefactorConfidence({
      validation: validationResult || {},
      benchmark: benchComp || {},
      plan: { beforePlan: originalPlan, afterPlan: candidatePlan }
    });

    res.json({
      ok: true,
      viewName,
      validation: validationResult,
      plans: {
        original: originalPlan,
        candidate: candidatePlan,
        comparison: planComp
      },
      benchmarks: {
        original: originalBench,
        candidate: candidateBench,
        comparison: benchComp
      },
      decision,
      confidence
    });
  } catch (error) {
    handleSafeError(res, error, 'Karşılaştırma analizi yapılamadı.');
  }
});

// ==========================================
// 16. Index Advisor Endpoints (Sprint 5)
// ==========================================

// Get missing index recommendations from DMVs and active plans
router.get('/index-advisor', async (req, res) => {
  try {
    const { database, table } = req.query;
    const data = await indexAdvisor.getMissingIndexesFromDMV(database, table);
    res.json(data);
  } catch (error) {
    handleSafeError(res, error, 'İndeks tavsiyeleri alınamadı.');
  }
});

// Generate safe CREATE NONCLUSTERED INDEX preview script
router.post('/index-advisor/script', (req, res) => {
  try {
    const { schema, table, keyColumns, includedColumns, filterDefinition } = req.body;
    const scriptData = indexAdvisor.generateCreateIndexScript({
      schema,
      table,
      keyColumns,
      includedColumns,
      filterDefinition
    });
    res.json({ ok: true, data: scriptData });
  } catch (error) {
    handleSafeError(res, error, 'İndeks oluşturma betiği üretilemedi.');
  }
});

// ==========================================
// 17. Statistics Health Endpoints (Sprint 5)
// ==========================================

// Get statistics health metrics for database or table
router.get('/statistics-health', async (req, res) => {
  try {
    const { database, schema, table, topN } = req.query;
    const data = await statisticsHealth.getStatisticsHealth(database, {
      schemaName: schema,
      tableName: table,
      topN: topN ? parseInt(topN, 10) : 100
    });
    res.json(data);
  } catch (error) {
    handleSafeError(res, error, 'İstatistik sağlık verileri alınamadı.');
  }
});

// Correlate execution plan cardinality mismatch with table statistics
router.post('/statistics-health/correlate', async (req, res) => {
  try {
    const { planXml, parsedPlan, database } = req.body;
    let plan = parsedPlan;
    if (!plan && planXml) {
      plan = planParser.parseShowPlanXML(planXml);
    }
    if (!plan) {
      return res.status(400).json({ ok: false, error: 'planXml veya parsedPlan zorunludur.' });
    }

    const statsData = await statisticsHealth.getStatisticsHealth(database, { topN: 200 });
    const correlations = statisticsHealth.correlatePlanWithStatistics(plan, statsData.statistics || []);
    res.json({ ok: true, correlations });
  } catch (error) {
    handleSafeError(res, error, 'İstatistik korelasyon analizi yapılamadı.');
  }
});

// Generate safe UPDATE STATISTICS preview script
router.post('/statistics-health/script', (req, res) => {
  try {
    const { schema, table, statsName, withFullScan } = req.body;
    const scriptData = statisticsHealth.generateUpdateStatisticsScript({
      schema,
      table,
      statsName,
      withFullScan: Boolean(withFullScan)
    });
    res.json({ ok: true, data: scriptData });
  } catch (error) {
    handleSafeError(res, error, 'İstatistik güncelleme betiği üretilemedi.');
  }
});

// ==========================================
// 18. Live Activity & Blocking Monitor (Sprint 5)
// ==========================================

// Active running queries and sessions
router.get('/activity/requests', async (req, res) => {
  try {
    const { database } = req.query;
    const data = await activityMonitor.getActiveRequests(database);
    res.json(data);
  } catch (error) {
    handleSafeError(res, error, 'Aktif sorgular sorgulanamadı.');
  }
});

// Hierarchical blocking tree (head blockers and blocked sessions)
router.get('/activity/blocking', async (req, res) => {
  try {
    const { database } = req.query;
    const data = await activityMonitor.getBlockingTree(database);
    res.json(data);
  } catch (error) {
    handleSafeError(res, error, 'Kilit (blocking) ağacı sorgulanamadı.');
  }
});

// Cumulative wait statistics (sys.dm_os_wait_stats)
router.get('/activity/waits', async (req, res) => {
  try {
    const { topN } = req.query;
    const data = await activityMonitor.getCumulativeWaits(topN ? parseInt(topN, 10) : 25);
    res.json(data);
  } catch (error) {
    handleSafeError(res, error, 'Wait istatistikleri sorgulanamadı.');
  }
});

// ==========================================
// 19. Refactor Workspace & Lifecycle Pipeline (Sprint 6)
// ==========================================

// List workspaces with filters and pagination
router.get('/workspaces', (req, res) => {
  try {
    const { status, search, isArchived, page, pageSize } = req.query;
    const result = defaultWorkspaceService.listWorkspaces({
      status,
      search,
      isArchived: isArchived === 'true' ? true : (isArchived === 'false' ? false : null),
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20
    });
    res.json({ ok: true, data: result });
  } catch (error) {
    handleSafeError(res, error, 'Çalışmalar listelenemedi.');
  }
});

// Create new workspace
router.post('/workspaces', async (req, res) => {
  try {
    const result = await defaultWorkspaceService.createWorkspace(req.body);
    res.status(201).json({ ok: true, data: result.workspace, duplicateWarning: result.duplicateWarning });
  } catch (error) {
    handleSafeError(res, error, 'Çalışma oluşturulamadı.');
  }
});

// Get workspace details with drift detection and evidence history
router.get('/workspaces/:id', async (req, res) => {
  try {
    const checkDrift = req.query.checkDrift !== 'false';
    const data = await defaultWorkspaceService.getWorkspace(req.params.id, { checkDrift });
    if (!data) {
      return res.status(404).json({ ok: false, error: 'Çalışma bulunamadı.' });
    }
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Çalışma ayrıntıları getirilemedi.');
  }
});

// Update workspace metadata
router.patch('/workspaces/:id', (req, res) => {
  try {
    const data = defaultWorkspaceService.updateWorkspace(req.params.id, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Çalışma güncellenemedi.');
  }
});

// Soft archive / restore workspace
router.post('/workspaces/:id/archive', (req, res) => {
  try {
    const isArchived = req.body.isArchived !== false;
    const data = defaultWorkspaceService.archiveWorkspace(req.params.id, isArchived);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Çalışma arşiv durumu güncellenemedi.');
  }
});

// Delete workspace
router.delete('/workspaces/:id', (req, res) => {
  try {
    defaultWorkspaceService.deleteWorkspace(req.params.id);
    res.json({ ok: true, message: 'Çalışma silindi.' });
  } catch (error) {
    handleSafeError(res, error, 'Çalışma silinemedi.');
  }
});

// Add candidate to workspace (v1, v2, v3...)
router.post('/workspaces/:id/candidates', (req, res) => {
  try {
    const data = defaultWorkspaceService.addCandidate(req.params.id, req.body);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Aday versiyon eklenemedi.');
  }
});

// Record immutable validation snapshot
router.post('/workspaces/:id/candidates/:candidateId/validate', (req, res) => {
  try {
    const data = defaultWorkspaceService.recordValidation(req.params.id, req.params.candidateId, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Doğrulama kaydı oluşturulamadı.');
  }
});

// Record immutable benchmark snapshot
router.post('/workspaces/:id/candidates/:candidateId/benchmark', (req, res) => {
  try {
    const data = defaultWorkspaceService.recordBenchmark(req.params.id, req.params.candidateId, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Benchmark kaydı oluşturulamadı.');
  }
});

// Record execution plan comparison snapshot
router.post('/workspaces/:id/candidates/:candidateId/plan', (req, res) => {
  try {
    const data = defaultWorkspaceService.recordPlan(req.params.id, req.params.candidateId, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Plan karşılaştırma kaydı oluşturulamadı.');
  }
});

// Human approval for candidate
router.post('/workspaces/:id/candidates/:candidateId/approve', async (req, res) => {
  try {
    const data = await defaultWorkspaceService.approveCandidate(req.params.id, req.params.candidateId, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Aday onaylanamadı.');
  }
});

// Reject candidate
router.post('/workspaces/:id/candidates/:candidateId/reject', (req, res) => {
  try {
    const data = defaultWorkspaceService.rejectCandidate(req.params.id, req.params.candidateId, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Aday reddedilemedi.');
  }
});

// Generate safe deployment package (NO EXECUTION!)
router.post('/workspaces/:id/generate-script', async (req, res) => {
  try {
    const data = await defaultWorkspaceService.generateDeploymentPackage(req.params.id, req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Dağıtım betiği üretilemedi.');
  }
});

// Export workspace JSON package
router.get('/workspaces/:id/export', (req, res) => {
  try {
    const data = defaultWorkspaceService.exportWorkspace(req.params.id);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Çalışma dışa aktarılamadı.');
  }
});

// Get audit events timeline
router.get('/workspaces/:id/events', (req, res) => {
  try {
    const data = defaultStorage.listAuditEventsByWorkspace(req.params.id);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Olay günlüğü getirilemedi.');
  }
});

// ==========================================
// 20. Workbench Saved Queries
// ==========================================

router.get('/saved-queries', (req, res) => {
  try {
    const { favoriteOnly, database } = req.query;
    const data = defaultSavedQueriesService.listQueries({
      favoriteOnly: favoriteOnly === 'true',
      database
    });
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Kayıtlı sorgular getirilemedi.');
  }
});

router.post('/saved-queries', (req, res) => {
  try {
    const data = defaultSavedQueriesService.saveQuery(req.body);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Sorgu kaydedilemedi.');
  }
});

router.post('/saved-queries/:id/favorite', (req, res) => {
  try {
    const data = defaultSavedQueriesService.toggleFavorite(req.params.id);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'Favori durumu değiştirilemedi.');
  }
});

router.delete('/saved-queries/:id', (req, res) => {
  try {
    defaultSavedQueriesService.deleteQuery(req.params.id);
    res.json({ ok: true, message: 'Kayıtlı sorgu silindi.' });
  } catch (error) {
    handleSafeError(res, error, 'Kayıtlı sorgu silinemedi.');
  }
});

// ==========================================
// 21. Developer / Diagnostic Test Runner Endpoint
// ==========================================
router.get('/dev/tests', async (_req, res) => {
  try {
    const { runAllSuites } = require('../../test/runAllTests');
    const filter = _req.query.suite || _req.query.filter || null;
    const result = await runAllSuites(filter);
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Testler çalıştırılamadı.');
  }
});

router.get('/dev/test-analyst', async (_req, res) => {
  try {
    const { run } = require('node:test');
    const path = require('path');
    const testFile = path.join(__dirname, '../../test/workbenchPlanAnalyst.test.js');

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    const failures = [];

    const stream = run({ files: [testFile], concurrency: false });
    stream.on('test:pass', (t) => {
      if (!t.name.includes('Tests')) {
        totalTests++;
        passedTests++;
      }
    });
    stream.on('test:fail', (t) => {
      totalTests++;
      failedTests++;
      failures.push({ name: t.name, error: t.details?.error?.message || 'Error' });
    });
    stream.on('end', () => {
      res.json({
        ok: failedTests === 0,
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        failures
      });
    });
  } catch (error) {
    handleSafeError(res, error, 'Analyst testleri çalıştırılamadı.');
  }
});

// ==========================================
// 22. Workbench AI Plan Analyst
// ==========================================
router.post('/workbench/analyze-plan', async (req, res) => {
  try {
    const { sql: sqlText, database, plan, metrics, statistics, forceRefresh } = req.body;
    if (!sqlText || typeof sqlText !== 'string') {
      return res.status(400).json({ ok: false, error: 'sql alanı zorunludur.' });
    }
    const result = await workbenchPlanAnalyst.analyzeWorkbenchPlan({
      sql: sqlText,
      database: database || '',
      parsedPlan: plan || null,
      metrics: metrics || {},
      statistics: statistics || {},
      options: { forceRefresh: Boolean(forceRefresh) }
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'AI plan analizi gerçekleştirilemedi.');
  }
});

module.exports = router;
