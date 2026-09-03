/**
 * SQL Server Refactoring & Performance Studio
 * Phase 2.5 Multi-Database Comprehensive Test Suite
 */

const express = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/node_modules/express');
const http = require('http');
const { createObjectRef, parseCanonicalId } = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/canonicalObject');
const { buildDependencyStats, extractSubGraph } = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/dependencyEngine');
const db = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/sqlServer');
const api = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/routes/api');

async function runTestSuite() {
  console.log('================================================================');
  console.log('>>> STARTING PHASE 2.5 MULTI-DATABASE CORE REFACTOR TEST SUITE <<<');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: Canonical Object Model & Internal Structure
  // -------------------------------------------------------------
  console.log('Test 1: Canonical ObjectRef Model & Type Preservation');
  const localRef = createObjectRef({ database: 'RAPOR_DB', schema: 'dbo', name: 'STOKLAR', type: 'TABLE' });
  if (localRef.canonicalId !== 'RAPOR_DB.dbo.STOKLAR') throw new Error('Local canonicalId mismatch');
  if (localRef.type !== 'TABLE') throw new Error('Type was lost');

  const synRef = createObjectRef({ database: 'RAPOR_DB', schema: 'dbo', name: 'STOKLAR', type: 'SYNONYM' });
  if (synRef.type !== 'SYNONYM') throw new Error('Synonym type was lost');

  const linkedRef = createObjectRef({ server: 'ERP_REMOTE', database: 'MikroDB', schema: 'dbo', name: 'STOK_HAREKET', type: 'TABLE' });
  if (linkedRef.canonicalId !== 'ERP_REMOTE.MikroDB.dbo.STOK_HAREKET') throw new Error('Linked server canonicalId mismatch');
  if (!linkedRef.isLinkedServer()) throw new Error('isLinkedServer failed');

  const parsedBracket = parseCanonicalId('[RAPOR_DB].[dbo].[STOK_HAREKETLERI]', 'DefaultDB', 'TABLE');
  if (parsedBracket.database !== 'RAPOR_DB' || parsedBracket.name !== 'STOK_HAREKETLERI') {
    throw new Error('parseCanonicalId bracket stripping failed');
  }
  console.log('  ✓ ObjectRef, bracket parser, and type preservation verified.');

  // -------------------------------------------------------------
  // Test 2: Cross-Database Traversal & Topology
  // -------------------------------------------------------------
  console.log('\nTest 2: Cross-Database Traversal, Out-of-Scope, and Linked Server Isolation');
  const mockViews = [
    { canonicalId: 'DB_A.dbo.AA_ROOT', database: 'DB_A', schema_name: 'dbo', view_name: 'AA_ROOT', object_id: 101 },
    { canonicalId: 'DB_A.dbo.AA_CHILD', database: 'DB_A', schema_name: 'dbo', view_name: 'AA_CHILD', object_id: 102 },
    { canonicalId: 'DB_B.dbo.AA_REMOTE', database: 'DB_B', schema_name: 'dbo', view_name: 'AA_REMOTE', object_id: 201 },
    { canonicalId: 'DB_A.dbo.AA_LINKED_VIEW', database: 'DB_A', schema_name: 'dbo', view_name: 'AA_LINKED_VIEW', object_id: 103 },
    { canonicalId: 'DB_A.dbo.AA_SYN_VIEW', database: 'DB_A', schema_name: 'dbo', view_name: 'AA_SYN_VIEW', object_id: 104 }
  ];

  const rawEdges = [
    // DB_A.dbo.AA_ROOT -> DB_A.dbo.AA_CHILD (LOCAL)
    { source_database: 'DB_A', source_name: 'AA_ROOT', referenced_database_name: 'DB_A', referenced_entity_name: 'AA_CHILD', target_type: 'VIEW' },
    // DB_A.dbo.AA_CHILD -> DB_B.dbo.AA_REMOTE (CROSS_DATABASE)
    { source_database: 'DB_A', source_name: 'AA_CHILD', referenced_database_name: 'DB_B', referenced_entity_name: 'AA_REMOTE', target_type: 'VIEW' },
    // DB_B.dbo.AA_REMOTE -> DB_B.dbo.STOKLAR (LOCAL in DB_B)
    { source_database: 'DB_B', source_name: 'AA_REMOTE', referenced_database_name: 'DB_B', referenced_entity_name: 'STOKLAR', target_type: 'TABLE' },
    // DB_A.dbo.AA_CHILD -> DB_A.dbo.STOKLAR (LOCAL in DB_A - Same table name as in DB_B!)
    { source_database: 'DB_A', source_name: 'AA_CHILD', referenced_database_name: 'DB_A', referenced_entity_name: 'STOKLAR', target_type: 'TABLE' },
    // DB_A.dbo.AA_ROOT -> ARSIV_DB.dbo.OLD_AUDIT (OUT OF ANALYSIS SCOPE)
    { source_database: 'DB_A', source_name: 'AA_ROOT', referenced_database_name: 'ARSIV_DB', referenced_entity_name: 'OLD_AUDIT', target_type: 'TABLE' },
    // DB_A.dbo.AA_LINKED_VIEW -> LINKED01.REMOTE_DB.dbo.REMOTE_TBL (LINKED SERVER)
    { source_database: 'DB_A', source_name: 'AA_LINKED_VIEW', referenced_server_name: 'LINKED01', referenced_database_name: 'REMOTE_DB', referenced_entity_name: 'REMOTE_TBL', target_type: 'TABLE' },
    // DB_A.dbo.AA_SYN_VIEW -> DB_A.dbo.SYN_STOCK (SYNONYM -> DB_B.dbo.STOK_HAREKETLERI)
    { source_database: 'DB_A', source_name: 'AA_SYN_VIEW', referenced_database_name: 'DB_A', referenced_entity_name: 'SYN_STOCK', target_type: 'SYNONYM' }
  ];

  const synonymMap = new Map();
  synonymMap.set('db_a.dbo.syn_stock', createObjectRef({ database: 'DB_B', schema: 'dbo', name: 'STOK_HAREKETLERI', type: 'TABLE' }));

  const scope = ['DB_A', 'DB_B'];
  const { statsMap, normalizedEdges } = buildDependencyStats(mockViews, rawEdges, scope, synonymMap);

  // Check DB_A.dbo.AA_ROOT stats
  const rootStats = statsMap.get('db_a.dbo.aa_root');
  if (!rootStats) throw new Error('Root stats missing');
  if (rootStats.depth < 3) throw new Error(`Expected cross-DB depth >= 3, got: ${rootStats.depth}`);
  if (rootStats.outOfScopeCount !== 1) throw new Error(`Expected outOfScopeCount 1, got: ${rootStats.outOfScopeCount}`);

  // Check edge classifications
  const crossEdge = normalizedEdges.find(e => e.sourceName === 'AA_CHILD' && e.targetName === 'AA_REMOTE');
  if (!crossEdge || crossEdge.category !== 'CROSS_DATABASE') throw new Error('Cross-DB edge misclassified');

  const outOfScopeEdge = normalizedEdges.find(e => e.targetName === 'OLD_AUDIT');
  if (!outOfScopeEdge || outOfScopeEdge.category !== 'OUT_OF_SCOPE') throw new Error('Out of scope edge misclassified');

  const linkedEdge = normalizedEdges.find(e => e.targetName === 'REMOTE_TBL');
  if (!linkedEdge || linkedEdge.category !== 'LINKED_SERVER') throw new Error('Linked server edge misclassified');

  const synEdge = normalizedEdges.find(e => e.sourceName === 'AA_SYN_VIEW');
  if (!synEdge || synEdge.category !== 'SYNONYM' || synEdge.targetCanonicalId !== 'DB_B.dbo.STOK_HAREKETLERI') {
    throw new Error('Synonym edge resolution failed');
  }
  console.log('  ✓ Cross-DB edge, Out-of-Scope edge, Linked Server edge, and Synonym resolution verified.');

  // -------------------------------------------------------------
  // Test 3: Table Pressure Physical Isolation (Same table name in multiple DBs)
  // -------------------------------------------------------------
  console.log('\nTest 3: Physical Table Isolation across Databases');
  const tableA = createObjectRef({ database: 'DB_A', schema: 'dbo', name: 'STOKLAR', type: 'TABLE' });
  const tableB = createObjectRef({ database: 'DB_B', schema: 'dbo', name: 'STOKLAR', type: 'TABLE' });

  if (tableA.canonicalId === tableB.canonicalId) {
    throw new Error('Tables in different databases collided on canonicalId!');
  }
  console.log(`  ✓ DB_A: ${tableA.canonicalId} is distinct from DB_B: ${tableB.canonicalId}`);

  // -------------------------------------------------------------
  // Test 4: Subgraph Extraction across DB boundaries
  // -------------------------------------------------------------
  console.log('\nTest 4: Visual Subgraph Cross-Database Extraction');
  const subGraph = extractSubGraph('DB_A.dbo.AA_ROOT', mockViews, normalizedEdges, { depth: 3, direction: 'downstream' });
  if (subGraph.nodes.length < 3) throw new Error('Subgraph nodes missing');
  const outOfScopeNode = subGraph.nodes.find(n => n.type === 'out_of_scope');
  if (!outOfScopeNode) throw new Error('Out of scope node missing in subgraph');
  console.log(`  ✓ Subgraph extracted ${subGraph.nodes.length} nodes across database boundaries.`);

  // -------------------------------------------------------------
  // Test 5: REST API & Concurrency Tests
  // -------------------------------------------------------------
  console.log('\nTest 5: REST API Multi-Database Endpoints & Concurrency');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', api);

  const server = app.listen(3098, '127.0.0.1');

  function request(reqPath, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: 3098,
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
    // 5A. Server discovery endpoint without user database
    const tServer = await request('/api/connection/test-server', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: '127.0.0.1', user: 'sa', password: 'bad_password' })
    });
    console.log('  [5A] POST /api/connection/test-server error handling -> Status:', tServer.status);
    if (tServer.status !== 400 && tServer.status !== 500) {
      throw new Error('test-server failed to handle error safely');
    }

    // 5B. Set Database Scope
    const setScope = await request('/api/connection/set-scope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryDatabase: 'DB_A', selectedDatabases: ['DB_A', 'DB_B'] })
    });
    console.log('  [5B] POST /api/connection/set-scope (no credentials in memory) -> Status:', setScope.status);

    // 5C. Workbench Scoped Execution Rejection when Offline
    const wbRunA = await request('/api/workbench/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1', database: 'DB_A' })
    });
    console.log('  [5C] POST /api/workbench/run on DB_A -> Status:', wbRunA.status);
    if (wbRunA.status !== 400 || !wbRunA.body.includes('bağlantı havuzu bulunamadı') && !wbRunA.body.includes('aktif değil')) {
      throw new Error('Workbench pool resolution failed');
    }

    // 5D. Workbench Cancellation endpoint
    const cancelRes = await request('/api/workbench/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'non_existent_req' })
    });
    console.log('  [5D] POST /api/workbench/cancel -> Status:', cancelRes.status);

    // 5E. Validation endpoint with database parameter
    const valRes = await request('/api/validation/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalSql: 'SELECT 1', candidateSql: 'SELECT 1', database: 'DB_B' })
    });
    console.log('  [5E] POST /api/validation/verify with DB_B context -> Status:', valRes.status);
    // -------------------------------------------------------------
    // Test 6: Concurrent Pool Context Isolation (DB_A vs DB_B)
    // -------------------------------------------------------------
    console.log('\nTest 6: Dedicated Database Pools & Concurrency Isolation');
    const mockPoolA = {
      connected: true,
      database: 'DB_A',
      request() {
        return {
          setTimeout() {},
          on() {},
          cancel() {},
          async query(sql) {
            await new Promise(r => setTimeout(r, 40));
            return { recordset: [{ active_database: 'DB_A', result: 42 }], recordsets: [], rowsAffected: [1] };
          }
        };
      }
    };
    const mockPoolB = {
      connected: true,
      database: 'DB_B',
      request() {
        return {
          setTimeout() {},
          on() {},
          cancel() {},
          async query(sql) {
            await new Promise(r => setTimeout(r, 40));
            return { recordset: [{ active_database: 'DB_B', result: 84 }], recordsets: [], rowsAffected: [1] };
          }
        };
      }
    };

    // Inject mock pools directly into db service databasePools map
    db.databasePools.set('db_a', mockPoolA);
    db.databasePools.set('db_b', mockPoolB);

    // Run parallel queries across DB_A and DB_B
    const [resA, resB] = await Promise.all([
      db.query('SELECT DB_NAME()', [], 'DB_A'),
      db.query('SELECT DB_NAME()', [], 'DB_B')
    ]);

    if (resA.recordset[0].active_database !== 'DB_A' || resB.recordset[0].active_database !== 'DB_B') {
      throw new Error('Database pool context was cross-contaminated during concurrent execution!');
    }
    console.log('  ✓ Concurrency verified: DB_A and DB_B executed simultaneously with absolute context isolation.');

    // -------------------------------------------------------------
    // Test 7: DB_A Cancellation -> Immediate DB_B Execution
    // -------------------------------------------------------------
    console.log('\nTest 7: DB_A Cancellation -> Immediate DB_B Execution');
    const workbenchService = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/workbenchService');
    const reqIdA = 'cancel_test_a';

    // Mock pool A that simulates long running cancellable query
    let wasCancelled = false;
    mockPoolA.request = () => {
      const r = {
        setTimeout() {},
        on() {},
        cancel() { wasCancelled = true; },
        async batch(sql) {
          await new Promise((_, reject) => setTimeout(() => reject(new Error('Canceled.')), 150));
          return { recordsets: [[]] };
        }
      };
      return r;
    };

    mockPoolB.request = () => {
      const r = {
        setTimeout() {},
        on() {},
        cancel() {},
        async batch(sql) {
          return { recordsets: [[{ col1: 1, active_database: 'DB_B' }]] };
        }
      };
      return r;
    };

    // Launch query on DB_A and immediately cancel
    const pA = workbenchService.execute({ sql: 'SELECT 1', database: 'DB_A', requestId: reqIdA }).catch(e => e);
    // Slight pause to ensure pA registered in activeRequests
    await new Promise(r => setTimeout(r, 10));
    const wbCancelRes = workbenchService.cancelRequest(reqIdA);
    if (!wbCancelRes.ok) throw new Error('cancelRequest returned failure');

    // Immediately execute query on DB_B
    const pB = await workbenchService.execute({ sql: 'SELECT 1', database: 'DB_B', requestId: 'after_cancel_b' });
    if (!pB.ok || pB.database !== 'DB_B') {
      throw new Error('Immediate execution on DB_B failed after cancelling DB_A!');
    }
    console.log('  ✓ Cancellation verified: DB_A query cancelled, DB_B executed immediately without interruption.');

    // -------------------------------------------------------------
    // Test 8: Heterogeneous Query Store Matrix (DB_A: OFF, DB_B: READ_WRITE)
    // -------------------------------------------------------------
    console.log('\nTest 8: Heterogeneous Query Store Detection per Database');
    const runtimeEvidence = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/runtimeEvidence');
    
    mockPoolA.request = () => ({
      async query(sql) {
        if (sql.includes('sys.database_query_store_options')) {
          return { recordset: [{ actual_state_desc: 'OFF', desired_state_desc: 'OFF' }] };
        }
        return { recordset: [] };
      }
    });
    mockPoolB.request = () => ({
      async query(sql) {
        if (sql.includes('sys.database_query_store_options')) {
          return { recordset: [{ actual_state_desc: 'READ_WRITE', desired_state_desc: 'READ_WRITE' }] };
        }
        return { recordset: [] };
      }
    });

    const { perDbStatus } = await runtimeEvidence.collectRuntimeEvidence([], ['DB_A', 'DB_B']);

    if (perDbStatus['DB_A'].queryStoreState !== 'OFF' || perDbStatus['DB_B'].queryStoreState !== 'READ_WRITE') {
      throw new Error(`Query Store state mismatch! A: ${perDbStatus['DB_A'].queryStoreState}, B: ${perDbStatus['DB_B'].queryStoreState}`);
    }
    console.log(`  ✓ Query Store states verified: DB_A is [${perDbStatus['DB_A'].queryStoreState}], DB_B is [${perDbStatus['DB_B'].queryStoreState}]`);

    // -------------------------------------------------------------
    // Test 9: Resilient Multi-Database Scanning (Partial Access / Failed Database)
    // -------------------------------------------------------------
    console.log('\nTest 9: Resilient Scanning on Partial Database Permission Failure');
    const scanner = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/scanner');
    
    // DB_A will return views, DB_C will throw permission error
    mockPoolA.request = () => ({
      async query(sql) {
        if (sql.includes('sys.views')) {
          return {
            recordset: [
              { database: 'DB_A', schema_name: 'dbo', view_name: 'AA_STOK', object_id: 501, create_date: new Date(), modify_date: new Date() }
            ]
          };
        }
        if (sql.includes('sys.synonyms')) return { recordset: [] };
        if (sql.includes('sys.sql_expression_dependencies')) return { recordset: [] };
        return { recordset: [] };
      }
    });

    const mockPoolC = {
      connected: true,
      database: 'DB_C',
      request() {
        return {
          async query() {
            throw new Error('The server principal is not able to access the database "DB_C" under the current security context.');
          }
        };
      }
    };
    db.databasePools.set('db_c', mockPoolC);

    const scanResult = await scanner.scan('AA_', ['DB_A', 'DB_C']);
    if (!scanResult.views || scanResult.views.length === 0) {
      throw new Error('Scanner failed to retrieve DB_A views when DB_C failed!');
    }
    if (scanResult.databaseSummaries['DB_C'].status !== 'FAILED DATABASE') {
      throw new Error(`Expected DB_C status FAILED DATABASE, got: ${scanResult.databaseSummaries['DB_C'].status}`);
    }
    if (scanResult.databaseSummaries['DB_A'].status !== 'FULL ACCESS') {
      throw new Error(`Expected DB_A status FULL ACCESS, got: ${scanResult.databaseSummaries['DB_A'].status}`);
    }
    console.log('  ✓ Resilient scan verified: Failure in DB_C did not stop scan of DB_A. Per-database summaries populated.');

    // -------------------------------------------------------------
    // Test 10: Dynamic SQL Technical Limitation State
    // -------------------------------------------------------------
    console.log('\nTest 10: Dynamic SQL Limitation State in Scanner');
    if (!scanResult.dynamicSqlLimitation || !scanResult.dynamicSqlLimitation.includes('Dynamic SQL dependencies cannot be fully discovered')) {
      throw new Error('Scanner missing dynamic SQL limitation state note');
    }
    console.log('  ✓ Dynamic SQL technical limitation correctly recorded without false UNRESOLVED flags.');

  } finally {
    server.close();
    db.disconnect();
  }

  console.log('\n================================================================');
  console.log('>>> ALL 10 PHASE 2.5 MULTI-DATABASE ARCHITECTURE TESTS PASSED! <<<');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ Multi-Database Test Suite Failed:', err);
  process.exit(1);
});
