const express = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/node_modules/express');
const http = require('http');
const api = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/routes/api');

async function testPhase2All() {
  console.log('>>> Starting Comprehensive Phase 2 End-to-End Test Suite <<<\n');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', api);

  const server = app.listen(3097, '127.0.0.1');

  function request(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 3097,
        path: reqPath,
        method: options.method || 'GET',
        headers: options.headers || {}
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  try {
    // 1. Settings GET & POST
    const sGet = await request('/api/settings/config');
    console.log('[1] GET /api/settings/config -> Status:', sGet.status);
    const sGetData = JSON.parse(sGet.body);
    if (!sGetData.ok || !sGetData.data.scoring) throw new Error('Settings GET failed');

    const sPost = await request('/api/settings/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoring: { runtimeWeight: 35 } })
    });
    console.log('[2] POST /api/settings/config -> Status:', sPost.status);

    // 2. AI Connection Test Safe Error
    const aiTest = await request('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-coder' })
    });
    console.log('[3] POST /api/ai/test without key -> Status:', aiTest.status);
    if (aiTest.status !== 400 || !aiTest.body.includes('API Anahtarı eksik')) {
      throw new Error('AI test safe rejection failed');
    }

    // 3. Workbench Validator Guardrail 1: Mutating Query Rejection
    const dropTest = await request('/api/workbench/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'DROP TABLE dbo.Test' })
    });
    console.log('[4] Mutating query DROP rejection -> Status:', dropTest.status);
    if (dropTest.status !== 400) throw new Error('Failed to block DROP statement');

    // 4. Workbench Validator Guardrail 1: Inline Mutating Token Rejection
    const inlineDrop = await request('/api/workbench/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT * FROM t; DROP TABLE t;' })
    });
    console.log('[5] Inline DROP token rejection -> Status:', inlineDrop.status);
    if (inlineDrop.status !== 400 || !inlineDrop.body.includes('Read-only safety policy blocked')) {
      throw new Error('Failed to block inline DROP statement');
    }

    // 5. Workbench Validator Guardrail 1: String Literal Protection ('DROP TABLE' inside string literal)
    const strLiteral = await request('/api/workbench/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "SELECT 'DROP TABLE' AS Ex" })
    });
    console.log('[6] String literal SELECT \'DROP TABLE\' -> Status:', strLiteral.status);
    // Offline: passes validator, fails with connection/pool error (NOT Read-only safety policy)
    if (strLiteral.body.includes('Read-only safety policy')) {
      throw new Error('String literal validation was incorrectly blocked');
    }

    // 6. Workbench Validator Guardrail 1: Comment Protection (-- DELETE comment)
    const commentTest = await request('/api/workbench/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: "-- DELETE eski kod\nSELECT 1 AS Val" })
    });
    console.log('[7] Comment line -- DELETE -> Status:', commentTest.status);
    if (commentTest.body.includes('Read-only safety policy')) {
      throw new Error('Comment validation was incorrectly blocked');
    }

    // 7. Workbench Cancellation
    const cancelRes = await request('/api/workbench/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'non_existent' })
    });
    console.log('[8] POST /api/workbench/cancel -> Status:', cancelRes.status);

    // 8. Workbench History
    const histRes = await request('/api/workbench/history');
    console.log('[9] GET /api/workbench/history -> Status:', histRes.status);
    const histData = JSON.parse(histRes.body);
    if (!histData.ok || !Array.isArray(histData.data)) throw new Error('History check failed');

    // 9. Validation Lab Equivalence Validation Guardrail 1 & 4 (Offline Check)
    const valVerify = await request('/api/validation/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalSql: 'SELECT 1 AS A',
        candidateSql: 'SELECT 1 AS A'
      })
    });
    console.log('[10] POST /api/validation/verify -> Status:', valVerify.status);
    // Offline returns 400 with "Aktif SQL Server bağlantısı yok"
    if (!valVerify.body.includes('Aktif SQL Server bağlantısı yok')) {
      throw new Error('Validation verify connection check failed');
    }

    console.log('\n========================================================');
    console.log('>>> ALL PHASE 2 BACKEND & ARCHITECTURE TESTS PASSED! <<<');
    console.log('========================================================\n');
  } finally {
    server.close();
  }
}

testPhase2All().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
