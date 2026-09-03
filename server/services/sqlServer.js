const sql = require('mssql');

let pool = null;
let current = null;

function sanitizeError(err, secret) {
  if (!err) return new Error('Unknown database error');
  let msg = typeof err === 'string' ? err : err.message || 'Database error';
  if (secret && typeof secret === 'string' && secret.length > 0) {
    msg = msg.split(secret).join('********');
  }
  // Remove password from connection strings if present
  msg = msg.replace(/password=[^;]*/gi, 'password=********');
  msg = msg.replace(/pwd=[^;]*/gi, 'pwd=********');
  const safeErr = new Error(msg);
  if (err.code) safeErr.code = err.code;
  if (err.number) safeErr.number = err.number;
  return safeErr;
}

function buildConfig(input) {
  return {
    server: input.server,
    database: input.database,
    user: input.user,
    password: input.password,
    port: Number(input.port || 1433),
    options: {
      encrypt: Boolean(input.encrypt),
      trustServerCertificate: input.trustServerCertificate !== false,
      enableArithAbort: true
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
    connectionTimeout: 10000
  };
}

async function connect(input) {
  if (!input.server || !input.database || !input.user) {
    throw new Error('Server, database ve kullanıcı adı zorunludur.');
  }
  if (pool) {
    try { await pool.close(); } catch (_) {}
    pool = null;
    current = null;
  }
  try {
    const config = buildConfig(input);
    const newPool = new sql.ConnectionPool(config);
    pool = await newPool.connect();
    current = {
      server: input.server,
      database: input.database,
      user: input.user,
      port: config.port,
      connectedAt: new Date().toISOString()
    };
    return current;
  } catch (err) {
    throw sanitizeError(err, input.password);
  }
}

function getPool() {
  if (!pool || !pool.connected) throw new Error('SQL Server bağlantısı aktif değil.');
  return pool;
}

async function query(text, params = []) {
  try {
    const request = getPool().request();
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

function status() {
  return {
    connected: Boolean(pool && pool.connected),
    connection: current ? {
      server: current.server,
      database: current.database,
      user: current.user,
      port: current.port,
      connectedAt: current.connectedAt
    } : null
  };
}

async function disconnect() {
  if (pool) {
    try { await pool.close(); } catch (_) {}
    pool = null;
  }
  current = null;
}

module.exports = { connect, disconnect, query, getPool, status, sanitizeError, sql };

