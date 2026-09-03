/**
 * SQL Server Refactoring & Performance Studio
 * Server-Centric Connection & Multi-Database Pool Manager
 *
 * Guardrail Enforcement:
 * - NO "USE [db] + restore" on pooled connections.
 * - Dedicated ConnectionPool per database:
 *    - masterPool: server discovery & instance operations (sys.databases)
 *    - databasePools Map: dbName.toLowerCase() -> ConnectionPool(database: dbName)
 * - Credentials kept strictly in volatile Node.js process memory.
 * - Queries and Workbench executions run directly on the specific database's pool.
 */

const sql = require('mssql');

let masterPool = null;
const databasePools = new Map(); // dbName.toLowerCase() -> ConnectionPool

let serverCredentials = null;
let currentScope = {
  primaryDatabase: null,
  selectedDatabases: []
};

function sanitizeError(err, secret) {
  if (!err) return new Error('Unknown database error');
  let msg = typeof err === 'string' ? err : err.message || 'Database error';
  if (secret && typeof secret === 'string' && secret.length > 0) {
    msg = msg.split(secret).join('********');
  }
  msg = msg.replace(/password=[^;]*/gi, 'password=********');
  msg = msg.replace(/pwd=[^;]*/gi, 'pwd=********');
  const safeErr = new Error(msg);
  if (err.code) safeErr.code = err.code;
  if (err.number) safeErr.number = err.number;
  return safeErr;
}

function buildConfig(credentials, database = 'master') {
  return {
    server: credentials.server,
    database: database,
    user: credentials.user,
    password: credentials.password,
    port: Number(credentials.port || 1433),
    options: {
      encrypt: Boolean(credentials.encrypt),
      trustServerCertificate: credentials.trustServerCertificate !== false,
      enableArithAbort: true
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
    connectionTimeout: 10000
  };
}

/**
 * Step 1: Connect to server (master) and discover accessible online databases.
 */
async function testServerConnection(input) {
  if (!input.server || !input.user) {
    throw new Error('Server ve kullanıcı adı zorunludur.');
  }

  // Close existing master pool if present
  if (masterPool) {
    try { await masterPool.close(); } catch (_) {}
    masterPool = null;
  }

  try {
    const config = buildConfig(input, 'master');
    const pool = new sql.ConnectionPool(config);
    masterPool = await pool.connect();

    serverCredentials = {
      server: input.server,
      port: config.port,
      user: input.user,
      password: input.password,
      encrypt: config.options.encrypt,
      trustServerCertificate: config.options.trustServerCertificate
    };

    // Discover accessible databases
    const discoveryQuery = `
      SELECT 
        name,
        database_id,
        state_desc AS state,
        compatibility_level,
        collation_name AS collation,
        is_read_only,
        HAS_DBACCESS(name) AS has_dbaccess
      FROM sys.databases
      WHERE name NOT IN ('master', 'model', 'msdb', 'tempdb')
        AND state_desc = 'ONLINE'
        AND HAS_DBACCESS(name) = 1
      ORDER BY name;
    `;

    const res = await masterPool.request().query(discoveryQuery);
    const discovered = res.recordset || [];

    return {
      ok: true,
      server: input.server,
      user: input.user,
      port: config.port,
      databases: discovered
    };
  } catch (err) {
    throw sanitizeError(err, input.password);
  }
}

/**
 * Step 2: Establish dedicated connection pools for all selected databases.
 */
async function setDatabaseScope({ primaryDatabase, selectedDatabases = [] }) {
  if (!serverCredentials) {
    throw new Error('Önce sunucu bağlantısı kurulmalıdır.');
  }
  if (!Array.isArray(selectedDatabases) || selectedDatabases.length === 0) {
    throw new Error('En az bir veritabanı seçilmelidir.');
  }

  const primary = primaryDatabase || selectedDatabases[0];
  if (!selectedDatabases.includes(primary)) {
    selectedDatabases.unshift(primary);
  }

  // Close any pools for databases no longer in scope
  for (const [key, pool] of databasePools.entries()) {
    const isRetained = selectedDatabases.some(db => db.toLowerCase() === key);
    if (!isRetained) {
      try { await pool.close(); } catch (_) {}
      databasePools.delete(key);
    }
  }

  // Initialize pools for newly selected databases
  const initErrors = [];
  for (const dbName of selectedDatabases) {
    const key = dbName.toLowerCase();
    if (!databasePools.has(key) || !databasePools.get(key).connected) {
      try {
        const config = buildConfig(serverCredentials, dbName);
        const pool = new sql.ConnectionPool(config);
        const connectedPool = await pool.connect();
        databasePools.set(key, connectedPool);
      } catch (err) {
        initErrors.push({ database: dbName, error: err.message });
      }
    }
  }

  currentScope = {
    primaryDatabase: primary,
    selectedDatabases: [...selectedDatabases]
  };

  return {
    ok: true,
    primaryDatabase: primary,
    selectedDatabases: currentScope.selectedDatabases,
    activePools: Array.from(databasePools.keys()),
    initErrors: initErrors.length > 0 ? initErrors : null
  };
}

/**
 * Get dedicated ConnectionPool for a specific database.
 */
function getPool(databaseName) {
  const targetDb = databaseName || currentScope.primaryDatabase;
  if (!targetDb) {
    if (masterPool && masterPool.connected) return masterPool;
    throw new Error('SQL Server bağlantısı aktif değil veya veritabanı seçilmedi.');
  }

  const key = targetDb.toLowerCase();
  const pool = databasePools.get(key);
  if (!pool || !pool.connected) {
    // If masterPool exists and is connected, fall back only if no dedicated pool yet
    if (masterPool && masterPool.connected) return masterPool;
    throw new Error(`"${targetDb}" veritabanı için aktif bağlantı havuzu bulunamadı.`);
  }

  return pool;
}

/**
 * Ensures or dynamically connects a pool for a database if not already connected.
 */
async function ensurePool(databaseName) {
  if (!databaseName) return getPool();
  const key = databaseName.toLowerCase();
  if (databasePools.has(key) && databasePools.get(key).connected) {
    return databasePools.get(key);
  }

  if (!serverCredentials) {
    throw new Error('Sunucu kimlik bilgileri mevcut değil.');
  }

  const config = buildConfig(serverCredentials, databaseName);
  const newPool = new sql.ConnectionPool(config);
  const connected = await newPool.connect();
  databasePools.set(key, connected);
  return connected;
}

/**
 * Execute query on the specific database pool.
 */
async function query(text, params = [], databaseName = null) {
  try {
    const pool = getPool(databaseName);
    const request = pool.request();
    for (const p of params) {
      if (p.type) {
        request.input(p.name, p.type, p.value);
      } else {
        request.input(p.name, p.value);
      }
    }
    return await request.query(text);
  } catch (err) {
    throw sanitizeError(err);
  }
}

/**
 * Disconnect and close all pools.
 */
async function disconnect() {
  if (masterPool) {
    try { await masterPool.close(); } catch (_) {}
    masterPool = null;
  }
  for (const pool of databasePools.values()) {
    try { await pool.close(); } catch (_) {}
  }
  databasePools.clear();
  serverCredentials = null;
  currentScope = { primaryDatabase: null, selectedDatabases: [] };
}

/**
 * Backward-compatible connect method (for legacy single-database calls).
 */
async function connect(input) {
  if (!input.server || !input.user) {
    throw new Error('Server ve kullanıcı adı zorunludur.');
  }
  const dbName = input.database || 'master';
  await testServerConnection(input);
  await setDatabaseScope({
    primaryDatabase: dbName,
    selectedDatabases: [dbName]
  });
  return {
    server: input.server,
    database: dbName,
    user: input.user,
    port: input.port || 1433,
    connectedAt: new Date().toISOString()
  };
}

function status() {
  const isConnected = Boolean((masterPool && masterPool.connected) || databasePools.size > 0);
  return {
    connected: isConnected,
    server: serverCredentials ? serverCredentials.server : null,
    user: serverCredentials ? serverCredentials.user : null,
    port: serverCredentials ? serverCredentials.port : 1433,
    primaryDatabase: currentScope.primaryDatabase,
    selectedDatabases: currentScope.selectedDatabases,
    activePools: Array.from(databasePools.keys()),
    connection: serverCredentials ? {
      server: serverCredentials.server,
      database: currentScope.primaryDatabase || 'master',
      user: serverCredentials.user,
      port: serverCredentials.port,
      selectedDatabases: currentScope.selectedDatabases,
      connectedAt: new Date().toISOString()
    } : null
  };
}

module.exports = {
  testServerConnection,
  setDatabaseScope,
  getPool,
  ensurePool,
  query,
  connect,
  disconnect,
  status,
  sanitizeError,
  sql,
  databasePools
};
