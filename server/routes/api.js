const express = require('express');
const db = require('../services/sqlServer');
const scanner = require('../services/scanner');
const ai = require('../services/aiProvider');
const capabilities = require('../services/capabilities');

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

// 1. Health check
router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'SQL Server Refactoring & Performance Studio',
    version: '0.1.0'
  });
});

// 2. Connection status
router.get('/connection', (_req, res) => {
  res.json(db.status());
});

// 3. Test & connect
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
router.delete('/connection', async (_req, res) => {
  try {
    await db.disconnect();
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
    const data = await scanner.scan(prefix);
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

// 8. Lazy load SQL definition for a specific view
router.get('/views/:name/source', (req, res) => {
  const viewName = req.params.name;
  const sql = scanner.getDefinition(viewName);
  if (!sql) {
    return res.status(404).json({
      ok: false,
      error: `"${viewName}" için kaynak kod bulunamadı veya henüz taranmadı.`
    });
  }
  res.json({ ok: true, name: viewName, sql });
});

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

// 10. AI Refactor candidate proposal
router.post('/ai/refactor', async (req, res) => {
  try {
    const data = await ai.proposeRefactor(req.body);
    res.json({ ok: true, data });
  } catch (error) {
    handleSafeError(res, error, 'AI refactoring adayı üretilemedi.');
  }
});

// 11. AI Connection Test
router.post('/ai/test', async (req, res) => {
  try {
    const result = await ai.testConnection(req.body);
    res.json({ ok: true, data: result });
  } catch (error) {
    handleSafeError(res, error, 'AI bağlantı testi başarısız.');
  }
});

// 12. Settings Get & Update
const settings = require('../services/settingsService');

router.get('/settings/config', (_req, res) => {
  res.json({ ok: true, data: settings.getConfig() });
});

router.post('/settings/config', (req, res) => {
  try {
    const updated = settings.updateConfig(req.body);
    res.json({ ok: true, data: updated });
  } catch (error) {
    handleSafeError(res, error, 'Ayarlar kaydedilemedi.');
  }
});

router.post('/settings/scoring/reset', (_req, res) => {
  try {
    const defaults = settings.resetScoringDefaults();
    res.json({ ok: true, data: defaults });
  } catch (error) {
    handleSafeError(res, error, 'Puanlama varsayılanlarına dönülemedi.');
  }
});

// ==========================================
// 13. SQL Workbench & Plan Execution Engine
// ==========================================
const workbench = require('../services/workbenchService');
const planParser = require('../services/planParser');

// Run Query
router.post('/workbench/run', async (req, res) => {
  try {
    const result = await workbench.executeQuery({
      sql: req.body.sql,
      timeoutMs: req.body.timeoutMs,
      requestId: req.body.requestId
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Sorgu çalıştırılamadı.');
  }
});

// Cancel Active Query
router.post('/workbench/cancel', (req, res) => {
  const result = workbench.cancelQuery(req.body.requestId);
  res.json(result);
});

// Execution Plan (Estimated / Actual)
router.post('/workbench/plan', async (req, res) => {
  try {
    const planResult = await workbench.getExecutionPlan({
      sql: req.body.sql,
      mode: req.body.mode || 'estimated',
      timeoutMs: req.body.timeoutMs
    });
    const parsed = planParser.parseShowPlanXML(planResult.rawXml);
    res.json({
      ok: true,
      planType: planResult.planType,
      parsed,
      rawXml: planResult.rawXml
    });
  } catch (error) {
    handleSafeError(res, error, 'Execution plan alınamadı.');
  }
});

// Query Benchmark
router.post('/workbench/benchmark', async (req, res) => {
  try {
    const result = await workbench.executeBenchmark({
      sql: req.body.sql,
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

// Session History
router.get('/workbench/history', (_req, res) => {
  res.json({ ok: true, data: workbench.getHistory() });
});

// ==========================================
// 14. Validation Lab Equivalence Proof Engine
// ==========================================
const validation = require('../services/validationService');

router.post('/validation/verify', async (req, res) => {
  try {
    const result = await validation.validateEquivalence({
      originalSql: req.body.originalSql,
      candidateSql: req.body.candidateSql,
      sampleLimit: req.body.sampleLimit || 1000
    });
    res.json(result);
  } catch (error) {
    handleSafeError(res, error, 'Validation testi tamamlanamadı.');
  }
});

module.exports = router;
