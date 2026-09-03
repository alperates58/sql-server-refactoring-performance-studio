const fs = require('fs');
const path = require('path');
const db = require('./sqlServer');

const queryPath = path.join(__dirname, '..', '..', 'sql', '00-capabilities.sql');

function friendlyVersion(versionStr) {
  if (!versionStr) return 'Unknown SQL Server';
  const major = parseInt(versionStr.split('.')[0], 10);
  switch (major) {
    case 16: return 'SQL Server 2022';
    case 15: return 'SQL Server 2019';
    case 14: return 'SQL Server 2017';
    case 13: return 'SQL Server 2016';
    case 12: return 'SQL Server 2014';
    case 11: return 'SQL Server 2012';
    default: return `SQL Server (v${major})`;
  }
}

function friendlyCompat(compat) {
  switch (Number(compat)) {
    case 160: return 'SQL Server 2022 (160)';
    case 150: return 'SQL Server 2019 (150)';
    case 140: return 'SQL Server 2017 (140)';
    case 130: return 'SQL Server 2016 (130)';
    case 120: return 'SQL Server 2014 (120)';
    case 110: return 'SQL Server 2012 (110)';
    default: return `Compat ${compat}`;
  }
}

async function detect() {
  const sql = fs.readFileSync(queryPath, 'utf8');
  const result = await db.query(sql);
  const row = result.recordset[0] || {};

  const canViewDef = Boolean(row.can_view_definition);
  const canViewState = Boolean(row.can_view_database_state || row.can_view_performance_state);
  const qsState = (row.query_store_state || 'OFF').toUpperCase();
  const qsActive = qsState === 'READ_WRITE' || qsState === 'READ_ONLY';

  const warnings = [];
  if (!canViewDef) {
    warnings.push('VIEW DEFINITION izni eksik: Bazı view kaynak kodları okunamayabilir.');
  }
  if (!canViewState) {
    warnings.push('VIEW DATABASE STATE izni eksik: Plan cache ve DMV istatistikleri okunamayabilir.');
  }
  if (!qsActive) {
    warnings.push('Query Store kapalı: Runtime analizi yalnızca geçici plan cache (DMV) üzerinden yapılabilir.');
  }

  return {
    productVersion: row.product_version,
    productLevel: row.product_level,
    edition: row.edition,
    machineName: row.machine_name,
    databaseName: row.database_name,
    friendlyVersion: friendlyVersion(row.product_version),
    compatibilityLevel: row.compatibility_level,
    friendlyCompat: friendlyCompat(row.compatibility_level),
    collation: row.collation_name,
    isRcsiOn: Boolean(row.is_read_committed_snapshot_on),
    snapshotIsolation: row.snapshot_isolation_state_desc,
    queryStore: {
      supported: Boolean(row.query_store_supported),
      state: qsState,
      desiredState: row.query_store_desired_state,
      active: qsActive
    },
    permissions: {
      canViewDefinition: canViewDef,
      canViewDatabaseState: canViewState,
      canViewPerformanceState: Boolean(row.can_view_performance_state)
    },
    metrics: {
      userTableCount: Number(row.user_table_count || 0),
      userViewCount: Number(row.user_view_count || 0),
      approxTotalRows: Number(row.approx_total_rows || 0),
      approxSizeMb: Number(row.approx_size_mb || 0)
    },
    warnings
  };
}

module.exports = { detect };

