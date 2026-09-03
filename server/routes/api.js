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

// 9. Subgraph for a specific view
router.get('/views/:name/graph', (req, res) => {
  const viewName = req.params.name;
  const graph = scanner.getSubGraphForView(viewName);
  if (!graph) {
    return res.status(404).json({
      ok: false,
      error: `"${viewName}" için bağımlılık grafiği bulunamadı.`
    });
  }
  res.json({ ok: true, name: viewName, graph });
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

module.exports = router;
