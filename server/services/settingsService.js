/**
 * Settings Management Service
 *
 * Keeps runtime configuration in Node.js process memory AND persists locally to
 * runtime/settings.local.json (which is strictly gitignored).
 *
 * Passwords and API keys are stored locally with machine-bound AES-256-GCM encryption
 * and are NEVER returned raw over public API responses.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const pkg = require('../../package.json');

const RUNTIME_DIR = path.join(__dirname, '..', '..', 'runtime');
const SETTINGS_FILE = path.join(RUNTIME_DIR, 'settings.local.json');
const VAULT_KEY_FILE = path.join(RUNTIME_DIR, '.local_vault_key');

// --- Encryption Helpers ---
function getOrCreateVaultKey() {
  try {
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }
    if (fs.existsSync(VAULT_KEY_FILE)) {
      return fs.readFileSync(VAULT_KEY_FILE);
    }
    const newKey = crypto.randomBytes(32);
    fs.writeFileSync(VAULT_KEY_FILE, newKey, { mode: 0o600 });
    return newKey;
  } catch (_) {
    // Fallback: machine-bound deterministic key
    const machineId = `${os.hostname()}_${os.userInfo()?.username || 'sqlstudio'}_local_vault_salt_2026`;
    return crypto.createHash('sha256').update(machineId).digest();
  }
}

const VAULT_KEY = getOrCreateVaultKey();

function encryptSecret(plainText) {
  if (!plainText || typeof plainText !== 'string') return null;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  } catch (err) {
    console.error('[Settings] Encrypt error:', err.message);
    return null;
  }
}

function decryptSecret(cipherPayload) {
  if (!cipherPayload || typeof cipherPayload !== 'string' || !cipherPayload.includes(':')) return null;
  try {
    const [ivHex, tagHex, encryptedHex] = cipherPayload.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return null;
  }
}

const inMemoryConfig = {
  activePrefix: 'AA_',
  scoring: {
    runtimeWeight: 35,
    regressionWeight: 25,
    repeatedWeight: 15,
    depthWeight: 10,
    sargableWeight: 10,
    blastWeight: 5
  },
  ai: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    temperature: 0.15,
    maxTokens: 4096,
    hasApiKey: false,
    apiKey: null
  },
  runtime: {
    preference: 'auto',
    historyWindow: '24h'
  },
  appearance: {
    theme: 'dark',
    density: 'comfortable',
    fontScale: 'default',
    editorFontSize: 14,
    graphGrid: 'on',
    animations: 'on'
  },
  workbench: {
    maxRows: 10000,
    historyRetention: 10000,
    editorFontSize: 14,
    minimap: true,
    wordWrap: 'off'
  }
};

let savedDbConnection = null; // { server, port, user, password, encrypt, trustServerCertificate, primaryDatabase, selectedDatabases }

// --- Persistence Helpers ---
function loadPersistedConfig() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    if (parsed.activePrefix) inMemoryConfig.activePrefix = parsed.activePrefix;
    if (parsed.scoring) inMemoryConfig.scoring = { ...inMemoryConfig.scoring, ...parsed.scoring };
    if (parsed.runtime) inMemoryConfig.runtime = { ...inMemoryConfig.runtime, ...parsed.runtime };
    if (parsed.appearance) inMemoryConfig.appearance = { ...inMemoryConfig.appearance, ...parsed.appearance };
    if (parsed.workbench) inMemoryConfig.workbench = { ...inMemoryConfig.workbench, ...parsed.workbench };

    if (parsed.ai) {
      if (parsed.ai.provider) inMemoryConfig.ai.provider = parsed.ai.provider;
      if (parsed.ai.baseUrl) inMemoryConfig.ai.baseUrl = parsed.ai.baseUrl;
      if (parsed.ai.model) inMemoryConfig.ai.model = parsed.ai.model;
      if (parsed.ai.temperature !== undefined) inMemoryConfig.ai.temperature = Number(parsed.ai.temperature);
      if (parsed.ai.maxTokens !== undefined) inMemoryConfig.ai.maxTokens = Number(parsed.ai.maxTokens);

      if (parsed.ai.encryptedApiKey) {
        const decryptedKey = decryptSecret(parsed.ai.encryptedApiKey);
        if (decryptedKey) {
          inMemoryConfig.ai.apiKey = decryptedKey;
        }
      }
    }

    if (parsed.dbConnection) {
      const db = parsed.dbConnection;
      let decPassword = null;
      if (db.encryptedPassword) {
        decPassword = decryptSecret(db.encryptedPassword);
      }
      savedDbConnection = {
        server: db.server || '127.0.0.1',
        port: Number(db.port || 1433),
        user: db.user || '',
        password: decPassword || '',
        encrypt: Boolean(db.encrypt),
        trustServerCertificate: db.trustServerCertificate !== false,
        primaryDatabase: db.primaryDatabase || null,
        selectedDatabases: Array.isArray(db.selectedDatabases) ? db.selectedDatabases : []
      };
    }
  } catch (err) {
    console.warn('[Settings] Failed to load local settings:', err.message);
  }
}

function savePersistedConfig() {
  try {
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }

    const payload = {
      activePrefix: inMemoryConfig.activePrefix,
      scoring: inMemoryConfig.scoring,
      runtime: inMemoryConfig.runtime,
      appearance: inMemoryConfig.appearance,
      workbench: inMemoryConfig.workbench,
      ai: {
        provider: inMemoryConfig.ai.provider,
        baseUrl: inMemoryConfig.ai.baseUrl,
        model: inMemoryConfig.ai.model,
        temperature: inMemoryConfig.ai.temperature,
        maxTokens: inMemoryConfig.ai.maxTokens,
        encryptedApiKey: inMemoryConfig.ai.apiKey ? encryptSecret(inMemoryConfig.ai.apiKey) : null
      },
      dbConnection: savedDbConnection ? {
        server: savedDbConnection.server,
        port: savedDbConnection.port,
        user: savedDbConnection.user,
        encrypt: savedDbConnection.encrypt,
        trustServerCertificate: savedDbConnection.trustServerCertificate,
        primaryDatabase: savedDbConnection.primaryDatabase,
        selectedDatabases: savedDbConnection.selectedDatabases,
        encryptedPassword: savedDbConnection.password ? encryptSecret(savedDbConnection.password) : null
      } : null,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('[Settings] Failed to save local settings:', err.message);
  }
}

// Load on initialization
loadPersistedConfig();

function getConfig() {
  return {
    activePrefix: inMemoryConfig.activePrefix,
    scoring: { ...inMemoryConfig.scoring },
    ai: {
      provider: inMemoryConfig.ai.provider,
      baseUrl: inMemoryConfig.ai.baseUrl,
      model: inMemoryConfig.ai.model,
      temperature: inMemoryConfig.ai.temperature,
      maxTokens: inMemoryConfig.ai.maxTokens,
      hasApiKey: Boolean(inMemoryConfig.ai.apiKey && inMemoryConfig.ai.apiKey.length > 0)
    },
    runtime: { ...inMemoryConfig.runtime },
    appearance: { ...inMemoryConfig.appearance },
    workbench: { ...inMemoryConfig.workbench },
    savedDbConnection: savedDbConnection ? {
      server: savedDbConnection.server,
      port: savedDbConnection.port,
      user: savedDbConnection.user,
      encrypt: savedDbConnection.encrypt,
      trustServerCertificate: savedDbConnection.trustServerCertificate,
      primaryDatabase: savedDbConnection.primaryDatabase,
      selectedDatabases: savedDbConnection.selectedDatabases,
      hasSavedPassword: Boolean(savedDbConnection.password && savedDbConnection.password.length > 0)
    } : null
  };
}

function updateConfig(updates = {}) {
  if (updates.activePrefix) inMemoryConfig.activePrefix = String(updates.activePrefix).trim();
  if (updates.scoring) {
    const { normalizeWeights } = require('./scoring');
    inMemoryConfig.scoring = normalizeWeights({
      ...inMemoryConfig.scoring,
      ...updates.scoring
    });
  }
  if (updates.ai) {
    const aiUpdates = { ...updates.ai };
    if (aiUpdates.apiKey !== undefined) {
      const raw = String(aiUpdates.apiKey || '').trim();
      if (raw) {
        inMemoryConfig.ai.apiKey = raw;
      }
      delete aiUpdates.apiKey;
    }
    inMemoryConfig.ai = {
      ...inMemoryConfig.ai,
      ...aiUpdates
    };
  }
  if (updates.runtime) {
    const validWindows = ['1h', '24h', '7d', '30d'];
    if (updates.runtime.historyWindow) {
      const keyNorm = String(updates.runtime.historyWindow).toLowerCase().trim();
      updates.runtime.historyWindow = validWindows.includes(keyNorm) ? keyNorm : '24h';
    }
    inMemoryConfig.runtime = {
      ...inMemoryConfig.runtime,
      ...updates.runtime
    };
  }
  if (updates.appearance) {
    inMemoryConfig.appearance = {
      ...inMemoryConfig.appearance,
      ...updates.appearance
    };
  }
  if (updates.workbench) {
    const wb = { ...updates.workbench };
    if (wb.maxRows !== undefined) {
      const mr = Number(wb.maxRows);
      wb.maxRows = Math.max(100, Math.min(50000, Number.isNaN(mr) ? 10000 : mr));
    }
    if (wb.historyRetention !== undefined) {
      const hr = Number(wb.historyRetention);
      wb.historyRetention = Math.max(1000, Math.min(50000, Number.isNaN(hr) ? 10000 : hr));
    }
    if (wb.editorFontSize !== undefined) {
      const fs = Number(wb.editorFontSize);
      wb.editorFontSize = Math.max(11, Math.min(24, Number.isNaN(fs) ? 14 : fs));
    }
    inMemoryConfig.workbench = {
      ...inMemoryConfig.workbench,
      ...wb
    };
  }

  savePersistedConfig();
  return getConfig();
}

function getApiKey() {
  return inMemoryConfig.ai.apiKey;
}

function getSavedDbConnection() {
  return savedDbConnection ? { ...savedDbConnection } : null;
}

function saveDbConnection(conn) {
  if (!conn) return;
  savedDbConnection = {
    server: conn.server || (savedDbConnection?.server || '127.0.0.1'),
    port: Number(conn.port || savedDbConnection?.port || 1433),
    user: conn.user || (savedDbConnection?.user || ''),
    password: conn.password !== undefined ? conn.password : (savedDbConnection?.password || ''),
    encrypt: conn.encrypt !== undefined ? Boolean(conn.encrypt) : (savedDbConnection?.encrypt || false),
    trustServerCertificate: conn.trustServerCertificate !== undefined ? Boolean(conn.trustServerCertificate) : (savedDbConnection?.trustServerCertificate !== false),
    primaryDatabase: conn.primaryDatabase !== undefined ? conn.primaryDatabase : (savedDbConnection?.primaryDatabase || null),
    selectedDatabases: Array.isArray(conn.selectedDatabases) ? conn.selectedDatabases : (savedDbConnection?.selectedDatabases || [])
  };
  savePersistedConfig();
}

function clearDbConnection() {
  savedDbConnection = null;
  savePersistedConfig();
}

function resetScoringDefaults() {
  inMemoryConfig.scoring = {
    runtimeWeight: 35,
    regressionWeight: 25,
    repeatedWeight: 15,
    depthWeight: 10,
    sargableWeight: 10,
    blastWeight: 5
  };
  savePersistedConfig();
  return inMemoryConfig.scoring;
}

function exportDiagnostics(extraInfo = {}) {
  const cfg = getConfig();
  const safeDb = cfg.savedDbConnection ? {
    server: cfg.savedDbConnection.server,
    port: cfg.savedDbConnection.port,
    user: cfg.savedDbConnection.user,
    encrypt: cfg.savedDbConnection.encrypt,
    trustServerCertificate: cfg.savedDbConnection.trustServerCertificate,
    primaryDatabase: cfg.savedDbConnection.primaryDatabase,
    selectedDatabases: cfg.savedDbConnection.selectedDatabases
  } : null;

  return {
    studioVersion: pkg.version,
    exportTimestamp: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    app: {
      name: 'SQL Server Refactoring & Performance Studio',
      version: pkg.version,
      mode: 'READ ONLY (ZERO MUTATION)'
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    },
    settingsSummary: {
      ai: {
        provider: cfg.ai.provider,
        baseUrl: cfg.ai.baseUrl,
        model: cfg.ai.model,
        temperature: cfg.ai.temperature,
        maxTokens: cfg.ai.maxTokens,
        hasApiKey: cfg.ai.hasApiKey
      },
      database: safeDb || {}
    },
    database: safeDb,
    scoring: cfg.scoring,
    ai: {
      provider: cfg.ai.provider,
      baseUrl: cfg.ai.baseUrl,
      model: cfg.ai.model,
      temperature: cfg.ai.temperature,
      maxTokens: cfg.ai.maxTokens,
      hasApiKey: cfg.ai.hasApiKey
    },
    workbench: cfg.workbench || { maxRows: 10000, historyRetention: 10000 },
    appearance: cfg.appearance,
    ...extraInfo
  };
}

function saveWorkbenchConfig(updates = {}) {
  if (!inMemoryConfig.workbench) {
    inMemoryConfig.workbench = {
      maxRows: 10000,
      historyRetention: 10000,
      editorFontSize: 14,
      minimap: true,
      wordWrap: 'off'
    };
  }
  if (updates.maxRows !== undefined) {
    const r = Number(updates.maxRows);
    inMemoryConfig.workbench.maxRows = Math.max(100, Math.min(50000, Number.isFinite(r) ? r : 10000));
  }
  if (updates.historyRetention !== undefined) {
    const h = Number(updates.historyRetention);
    inMemoryConfig.workbench.historyRetention = Math.max(1000, Math.min(50000, Number.isFinite(h) ? h : 10000));
  }
  if (updates.minimap !== undefined) {
    inMemoryConfig.workbench.minimap = Boolean(updates.minimap);
  }
  if (updates.wordWrap !== undefined) {
    const valid = ['on', 'off', 'wordWrapColumn', 'bounded'];
    inMemoryConfig.workbench.wordWrap = valid.includes(updates.wordWrap) ? updates.wordWrap : 'off';
  }
  if (updates.editorFontSize !== undefined) {
    const f = Number(updates.editorFontSize);
    if (Number.isFinite(f) && f >= 10 && f <= 32) {
      inMemoryConfig.workbench.editorFontSize = f;
    }
  }
  savePersistedConfig();
  return getConfig();
}

module.exports = {
  getConfig,
  updateConfig,
  getApiKey,
  getSavedDbConnection,
  saveDbConnection,
  clearDbConnection,
  resetScoringDefaults,
  exportDiagnostics,
  saveWorkbenchConfig
};
