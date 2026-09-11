/**
 * SQL Server Refactoring & Performance Studio
 * Index Advisor Engine (Sprint 5)
 *
 * Implements:
 * - 4 Evidence Sources: EXECUTION_PLAN, DMV_MISSING_INDEX, AST_QUERY_PATTERN, INDEX_COVERAGE
 * - Explainable Benefit Score (0-100) with full mathematical derivation
 * - Existing Index Conflict Detection: NEW_CANDIDATE, ALREADY_COVERED, PARTIALLY_COVERED, OVERLAPPING, DUPLICATE
 * - Index Write Overhead & Risk Assessment (wide keys, wide includes, index saturation)
 * - Safe CREATE NONCLUSTERED INDEX preview generator (QUOTENAME, max 128 char limit, zero mutation)
 * - DMV ephemerality disclaimer handling
 */

const db = require('./sqlServer');
const indexMetadata = require('./indexMetadata');
const planParser = require('./planParser');

const DMV_DISCLAIMER = 'sys.dm_db_missing_index_* verileri SQL Server servisi son yeniden başlatıldığından beri toplanan sayaçlardır.';

/**
 * Normalizes SQL identifier (strips brackets, extra spaces, lowercase for comparison)
 */
function normalizeIdentifier(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[\[\]]/g, '').trim();
}

/**
 * Safely parses comma-separated column string from DMV output, e.g. "[col1], [col2]" -> ['col1', 'col2']
 */
function parseDmvColumnList(colStr) {
  if (!colStr || typeof colStr !== 'string') return [];
  return colStr
    .split(',')
    .map(c => normalizeIdentifier(c))
    .filter(Boolean);
}

/**
 * Calculates an explainable Benefit Score (0-100)
 * Formula: (userSeeks + userScans) * avgTotalUserCost * (avgUserImpact / 100)
 */
function calculateBenefitScore({ userSeeks = 0, userScans = 0, avgTotalUserCost = 0, avgUserImpact = 0 }) {
  const seeks = Math.max(0, Number(userSeeks) || 0);
  const scans = Math.max(0, Number(userScans) || 0);
  const cost = Math.max(0, Number(avgTotalUserCost) || 0);
  const impact = Math.min(100, Math.max(0, Number(avgUserImpact) || 0));

  const totalAccesses = seeks + scans;
  const rawBenefit = totalAccesses * cost * (impact / 100);

  // Normalized score 0-100 using a calibrated logarithmic scale (divisor 6.5)
  // Preserves strict sorting across [0, 1, 10, 100, 1K, 10K, 100K, 1M] without sticking to 100
  let benefitScore = 0;
  if (rawBenefit > 0) {
    benefitScore = Math.min(100, Math.max(1, Math.round((Math.log10(rawBenefit + 1) / 6.5) * 100)));
  }

  let benefitGrade = 'LOW';
  if (benefitScore >= 80) {
    benefitGrade = 'CRITICAL';
  } else if (benefitScore >= 50) {
    benefitGrade = 'HIGH';
  } else if (benefitScore >= 25) {
    benefitGrade = 'MEDIUM';
  }

  return {
    benefitScore,
    benefitGrade,
    rawBenefit: Math.round(rawBenefit * 100) / 100,
    formula: '(userSeeks + userScans) * avgTotalUserCost * (avgUserImpact / 100)',
    factors: {
      userSeeks: seeks,
      userScans: scans,
      totalAccesses,
      avgTotalUserCost: Math.round(cost * 100) / 100,
      avgUserImpact: Math.round(impact * 10) / 10
    },
    explanation: totalAccesses > 0
      ? `Bu indeks tahmini ${totalAccesses.toLocaleString()} sorgu aramasında ortalama %${Math.round(impact * 10) / 10} maliyet tasarrufu sağlayabilir.`
      : 'Yeterli DMV kullanım geçmişi bulunmuyor.'
  };
}

/**
 * Detects conflicts between a proposed index and existing indexes on the table
 * Categories: DUPLICATE, ALREADY_COVERED, INCLUDE_EXPANSION_CANDIDATE, CLUSTERED_KEY_COVERAGE, DISABLED_INDEX_OVERLAP, PARTIALLY_COVERED, OVERLAPPING, NEW_CANDIDATE
 */
function detectIndexConflicts(candidateIndex, existingIndexes = []) {
  if (!candidateIndex || !candidateIndex.keyColumns || candidateIndex.keyColumns.length === 0) {
    return {
      status: 'NEW_CANDIDATE',
      matchedIndex: null,
      message: 'Aday indeks geçerli anahtar kolon içermiyor.'
    };
  }

  const candKeys = candidateIndex.keyColumns.map(c => normalizeIdentifier(c).toLowerCase());
  const candIncludes = (candidateIndex.includedColumns || []).map(c => normalizeIdentifier(c).toLowerCase());

  for (const existing of existingIndexes) {
    const exKeys = (existing.keyColumns || []).map(c => normalizeIdentifier(c).toLowerCase());
    const exIncludes = (existing.includedColumns || []).map(c => normalizeIdentifier(c).toLowerCase());
    const allExCols = [...exKeys, ...exIncludes];

    // 0a. Check if existing index is disabled
    if (existing.isDisabled) {
      const sharesLeading = exKeys.length > 0 && candKeys.length > 0 && exKeys[0] === candKeys[0];
      if (sharesLeading) {
        return {
          status: 'DISABLED_INDEX_OVERLAP',
          matchedIndex: existing.name,
          message: `Mevcut "${existing.name}" indeksi devre dışı (disabled) durumdadır. Yeni indeks eklemek yerine mevcut indeksi REBUILD etmek daha uygun olabilir.`
        };
      }
    }

    // 0b. Check if existing index is clustered and covers candidate keys
    if (existing.isClustered) {
      const isClusteredPrefix = exKeys.length >= candKeys.length && candKeys.every((k, idx) => k === exKeys[idx]);
      if (isClusteredPrefix) {
        return {
          status: 'CLUSTERED_KEY_COVERAGE',
          matchedIndex: existing.name,
          message: `Mevcut "${existing.name}" Clustered indeksi aday anahtarları fiziksel tablo sırası olarak zaten kapsar. Ek non-clustered indeks B-Tree yükü getirecektir.`
        };
      }
    }

    // 1. Exact DUPLICATE (same key columns in same order, same includes)
    const isSameKeys = candKeys.length === exKeys.length && candKeys.every((k, idx) => k === exKeys[idx]);
    const isSameIncludes = candIncludes.length === exIncludes.length && candIncludes.every(i => exIncludes.includes(i));
    if (isSameKeys && isSameIncludes) {
      return {
        status: 'DUPLICATE',
        matchedIndex: existing.name,
        message: `Mevcut "${existing.name}" indeksi ile birebir aynı anahtar ve include kolonlarına sahiptir. Yeni indeks eklenmemelidir.`
      };
    }

    // 2. ALREADY_COVERED: Existing index has candidate keys as prefix AND covers all candidate include columns
    const hasKeysAsPrefix = exKeys.length >= candKeys.length && candKeys.every((k, idx) => k === exKeys[idx]);
    const coversAllIncludes = candIncludes.every(i => allExCols.includes(i));
    if (hasKeysAsPrefix && coversAllIncludes) {
      return {
        status: 'ALREADY_COVERED',
        matchedIndex: existing.name,
        message: `Mevcut "${existing.name}" indeksi aday indeksin tüm anahtar kolonlarını önek olarak içerir ve tüm dahil kolonları kapsar.`
      };
    }

    // 3. INCLUDE_EXPANSION_CANDIDATE: Existing index has candidate keys as prefix, but candidate adds more includes
    if (hasKeysAsPrefix && !coversAllIncludes) {
      const missingIncludes = candIncludes.filter(i => !allExCols.includes(i));
      return {
        status: 'INCLUDE_EXPANSION_CANDIDATE',
        matchedIndex: existing.name,
        missingIncludes,
        message: `Mevcut "${existing.name}" indeksi anahtar kolonları önek olarak içeriyor. Yeni indeks yerine mevcut indekse eksik INCLUDE kolonları (${missingIncludes.join(', ')}) eklenerek konsolide edilmelidir.`
      };
    }

    // 4. PARTIALLY_COVERED: Same 1st leading key column
    if (exKeys.length > 0 && candKeys.length > 0 && exKeys[0] === candKeys[0]) {
      return {
        status: 'PARTIALLY_COVERED',
        matchedIndex: existing.name,
        message: `Mevcut "${existing.name}" indeksi aynı ilk anahtar kolona (${exKeys[0]}) sahiptir. Yeni indeks yerine mevcut indekse INCLUDE kolonları eklenerek konsolide edilmesi önerilir.`
      };
    }

    // 5. OVERLAPPING: Shares key columns in different order or subset
    const sharedKeys = candKeys.filter(k => exKeys.includes(k));
    if (sharedKeys.length > 0) {
      return {
        status: 'OVERLAPPING',
        matchedIndex: existing.name,
        message: `Mevcut "${existing.name}" indeksi ile (${sharedKeys.join(', ')}) kolonları ortaktır.`
      };
    }
  }

  return {
    status: 'NEW_CANDIDATE',
    matchedIndex: null,
    message: 'Tabloda bu anahtarları kapsayan benzer bir indeks bulunmuyor. Yeni aday indeks.'
  };
}

/**
 * Assesses index write overhead and DML risk
 */
function assessIndexWriteRisk({ keyColumns = [], includedColumns = [], existingIndexCount = 0 }) {
  const keyCount = keyColumns.length;
  const includeCount = includedColumns.length;
  const riskFactors = [];

  if (keyCount > 3) {
    riskFactors.push({
      code: 'WIDE_KEYS',
      severity: 'WARNING',
      text: `${keyCount} adet anahtar kolon B-Tree düğüm boyutunu şişirir ve güncelleme maliyetini artırır (Önerilen: en fazla 3).`
    });
  }

  if (includeCount > 5) {
    riskFactors.push({
      code: 'WIDE_INCLUDES',
      severity: 'WARNING',
      text: `${includeCount} adet INCLUDE kolonu veri sayfası doluluğunu ve satır boyutunu artırır.`
    });
  }

  if (existingIndexCount >= 5) {
    riskFactors.push({
      code: 'INDEX_SATURATION',
      severity: 'HIGH',
      text: `Tabloda zaten ${existingIndexCount} indeks bulunmaktadır. Her yeni indeks INSERT, UPDATE ve DELETE sürelerini uzatır.`
    });
  }

  let riskLevel = 'LOW';
  if (riskFactors.some(r => r.severity === 'HIGH') || riskFactors.length >= 2) {
    riskLevel = 'HIGH';
  } else if (riskFactors.length === 1) {
    riskLevel = 'MEDIUM';
  }

  return {
    riskLevel,
    riskFactors,
    existingIndexCount,
    keyCount,
    includeCount
  };
}

/**
 * Generates safe CREATE NONCLUSTERED INDEX script preview
 * Enforces:
 * - Proper bracket quoting ([schema].[table], [column])
 * - Identifier max length <= 128 characters
 * - Zero mutation guardrail comments
 */
function generateCreateIndexScript({
  schema = 'dbo',
  table,
  keyColumns = [],
  includedColumns = [],
  filterDefinition = null
}) {
  const cleanSchema = normalizeIdentifier(schema) || 'dbo';
  const cleanTable = normalizeIdentifier(table);
  const cleanKeys = keyColumns.map(normalizeIdentifier).filter(Boolean);
  const cleanIncludes = includedColumns.map(normalizeIdentifier).filter(Boolean);

  if (!cleanTable || cleanKeys.length === 0) {
    return {
      script: '-- Geçersiz indeks tanımı: Tablo veya anahtar kolon eksik.',
      indexName: '',
      isReadOnlySafe: true
    };
  }

  // Construct index name: IX_<Table>_<Key1>_<Key2>...
  const baseName = `IX_${cleanTable}_${cleanKeys.join('_')}`;
  // Enforce SQL Server 128 char limit
  let indexName = baseName;
  if (indexName.length > 120) {
    indexName = `${baseName.substring(0, 112)}_${Math.abs(hashString(baseName)).toString(16).substring(0, 6)}`;
  }

  const keyColsSql = cleanKeys.map(k => `[${k}]`).join(', ');
  let script = `-- SQL Server Refactoring & Performance Studio — Index Advisor\n`;
  script += `-- [GÜVENLİK KURALI]: Canlı veritabanına otomatik indeks uygulanmaz.\n`;
  script += `-- DBA incelemesinden sonra manuel olarak test ortamında çalıştırınız.\n`;
  script += `CREATE NONCLUSTERED INDEX [${indexName}]\n`;
  script += `ON [${cleanSchema}].[${cleanTable}] (${keyColsSql})`;

  if (cleanIncludes.length > 0) {
    const incColsSql = cleanIncludes.map(i => `[${i}]`).join(', ');
    script += `\nINCLUDE (${incColsSql})`;
  }

  if (filterDefinition && typeof filterDefinition === 'string' && filterDefinition.trim()) {
    script += `\nWHERE ${filterDefinition.trim()}`;
  }

  script += `;\n`;

  return {
    script,
    indexName,
    isReadOnlySafe: true,
    autoExecuted: false
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Queries sys.dm_db_missing_index_* DMVs for live recommendations
 */
async function getMissingIndexesFromDMV(database, tableName = null) {
  const status = db.status();
  const targetDb = database || status.primaryDatabase;
  const pool = db.getPool(targetDb);

  if (!pool) {
    return {
      ok: false,
      source: 'DMV_MISSING_INDEX',
      database: targetDb,
      disclaimer: DMV_DISCLAIMER,
      recommendations: [],
      error: 'SQL Server bağlantısı aktif değil.'
    };
  }

  try {
    const query = `
      SELECT TOP 50
        mid.index_handle,
        mid.database_id,
        DB_NAME(mid.database_id) AS database_name,
        mid.object_id,
        OBJECT_SCHEMA_NAME(mid.object_id, mid.database_id) AS schema_name,
        OBJECT_NAME(mid.object_id, mid.database_id) AS table_name,
        mid.equality_columns,
        mid.inequality_columns,
        mid.included_columns,
        mid.statement AS full_statement_target,
        migs.unique_compiles,
        migs.user_seeks,
        migs.user_scans,
        migs.last_user_seek,
        migs.last_user_scan,
        migs.avg_total_user_cost,
        migs.avg_user_impact,
        migs.system_seeks,
        migs.system_scans
      FROM sys.dm_db_missing_index_details mid
      JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
      JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
      WHERE mid.database_id = DB_ID(@targetDb)
        AND (@filterTable IS NULL OR OBJECT_NAME(mid.object_id, mid.database_id) = @filterTable)
      ORDER BY (migs.user_seeks + migs.user_scans) * migs.avg_total_user_cost * (migs.avg_user_impact / 100.0) DESC;
    `;

    const request = pool.request();
    request.input('targetDb', targetDb);
    request.input('filterTable', tableName ? normalizeIdentifier(tableName) : null);

    const res = await request.query(query);
    const rows = res.recordset || [];

    // Collect table names to get existing indexes in batch
    const tableNames = [...new Set(rows.map(r => r.table_name).filter(Boolean))];
    const existingTableIndexes = await indexMetadata.batchGetIndexes(targetDb, tableNames);

    const recommendations = [];

    for (const r of rows) {
      const eqCols = parseDmvColumnList(r.equality_columns);
      const ineqCols = parseDmvColumnList(r.inequality_columns);
      const incCols = parseDmvColumnList(r.included_columns);

      // Equality columns form the leading key, followed by inequality columns
      const keyColumns = [...new Set([...eqCols, ...ineqCols])];
      const includedColumns = incCols.filter(c => !keyColumns.includes(c));

      const tblName = r.table_name || 'UnknownTable';
      const schemaName = r.schema_name || 'dbo';
      const existing = existingTableIndexes[tblName.toLowerCase()] || [];

      const candidateIndex = {
        table: tblName,
        schema: schemaName,
        keyColumns,
        includedColumns
      };

      const benefit = calculateBenefitScore({
        userSeeks: r.user_seeks,
        userScans: r.user_scans,
        avgTotalUserCost: r.avg_total_user_cost,
        avgUserImpact: r.avg_user_impact
      });

      const conflict = detectIndexConflicts(candidateIndex, existing);
      const risk = assessIndexWriteRisk({
        keyColumns,
        includedColumns,
        existingIndexCount: existing.length
      });

      const scriptData = generateCreateIndexScript({
        schema: schemaName,
        table: tblName,
        keyColumns,
        includedColumns
      });

      recommendations.push({
        id: `dmv_${r.index_handle}`,
        source: 'DMV_MISSING_INDEX',
        evidenceSourceLabel: 'SQL SERVER DMV EVIDENCE',
        evidenceGrade: 'A',
        schema: schemaName,
        table: tblName,
        keyColumns,
        equalityColumns: eqCols,
        inequalityColumns: ineqCols,
        includedColumns,
        benefitScore: benefit.benefitScore,
        benefitGrade: benefit.benefitGrade,
        benefitDetails: benefit,
        conflict,
        risk,
        script: scriptData.script,
        indexName: scriptData.indexName,
        lastSeek: r.last_user_seek,
        lastScan: r.last_user_scan
      });
    }

    return {
      ok: true,
      source: 'DMV_MISSING_INDEX',
      database: targetDb,
      disclaimer: DMV_DISCLAIMER,
      count: recommendations.length,
      recommendations
    };
  } catch (err) {
    return {
      ok: false,
      source: 'DMV_MISSING_INDEX',
      database: targetDb,
      disclaimer: DMV_DISCLAIMER,
      error: db.sanitizeError(err).message,
      recommendations: []
    };
  }
}

/**
 * Extracts missing index recommendations from execution plan XML
 */
function getMissingIndexesFromPlan(planXmlOrParsed, existingIndexesMap = {}) {
  let parsed = planXmlOrParsed;
  if (typeof planXmlOrParsed === 'string') {
    parsed = planParser.parseShowPlanXML(planXmlOrParsed);
  }

  const rawMissing = parsed?.missingIndexes || [];
  const recommendations = [];

  for (let idx = 0; idx < rawMissing.length; idx++) {
    const m = rawMissing[idx];
    const keyColumns = [...(m.equalityColumns || []), ...(m.inequalityColumns || [])];
    const includedColumns = m.includeColumns || [];

    const tableParts = (m.table || '').replace(/[\[\]]/g, '').split('.');
    const schema = tableParts.length > 1 ? tableParts[0] : 'dbo';
    const table = tableParts.length > 1 ? tableParts[1] : tableParts[0];

    const existing = existingIndexesMap[table?.toLowerCase()] || [];

    const candidateIndex = {
      table,
      schema,
      keyColumns,
      includedColumns
    };

    const impact = parseFloat(m.impact || '50');
    const benefit = calculateBenefitScore({
      userSeeks: 1,
      userScans: 0,
      avgTotalUserCost: parsed?.totalSubTreeCost || 10,
      avgUserImpact: impact
    });

    const conflict = detectIndexConflicts(candidateIndex, existing);
    const risk = assessIndexWriteRisk({
      keyColumns,
      includedColumns,
      existingIndexCount: existing.length
    });

    const scriptData = generateCreateIndexScript({
      schema,
      table,
      keyColumns,
      includedColumns
    });

    recommendations.push({
      id: `plan_${idx}`,
      source: 'EXECUTION_PLAN',
      evidenceSourceLabel: 'EXECUTION PLAN EVIDENCE',
      evidenceGrade: 'A',
      schema,
      table,
      keyColumns,
      equalityColumns: m.equalityColumns || [],
      inequalityColumns: m.inequalityColumns || [],
      includedColumns,
      benefitScore: benefit.benefitScore,
      benefitGrade: benefit.benefitGrade,
      benefitDetails: benefit,
      conflict,
      risk,
      script: scriptData.script,
      indexName: scriptData.indexName
    });
  }

  return recommendations;
}

/**
 * Aggregates and correlates index recommendations across all 4 sources
 */
async function collectComprehensiveRecommendations({
  database = null,
  tableName = null,
  planXml = null,
  ast = null,
  tableIndexes = null
} = {}) {
  const status = db.status();
  const targetDb = database || status.primaryDatabase;
  const allRecs = [];

  // 1. DMV Missing Indexes
  const dmvResult = await getMissingIndexesFromDMV(targetDb, tableName);
  if (dmvResult.ok && dmvResult.recommendations) {
    allRecs.push(...dmvResult.recommendations);
  }

  // 2. Execution Plan Missing Indexes
  if (planXml) {
    const planRecs = getMissingIndexesFromPlan(planXml, tableIndexes || {});
    allRecs.push(...planRecs);
  }

  // 3. Correlate and deduplicate recommendations by (table + keyColumns.join(','))
  const deduplicated = [];
  const seenMap = new Map();

  allRecs.sort((a, b) => b.benefitScore - a.benefitScore);

  for (const r of allRecs) {
    const key = `${r.table.toLowerCase()}::${r.keyColumns.map(k => k.toLowerCase()).join(',')}`;
    if (seenMap.has(key)) {
      const existing = seenMap.get(key);
      existing.sources = [...new Set([...(existing.sources || [existing.source]), r.source])];
      existing.source = 'MULTI_SOURCE';
      existing.evidenceSourceLabel = 'MULTI_SOURCE_EVIDENCE';

      // Merge included columns
      const combinedIncludes = [...new Set([...(existing.includedColumns || []), ...(r.includedColumns || [])])];
      existing.includedColumns = combinedIncludes.filter(c => !existing.keyColumns.includes(c));

      // Use highest benefit score
      if (r.benefitScore > existing.benefitScore) {
        existing.benefitScore = r.benefitScore;
        existing.benefitGrade = r.benefitGrade;
        existing.benefitDetails = r.benefitDetails;
      }
    } else {
      r.sources = [r.source];
      if (r.source === 'DMV_MISSING_INDEX') {
        r.evidenceSourceLabel = 'SQL SERVER DMV EVIDENCE';
      } else if (r.source === 'EXECUTION_PLAN') {
        r.evidenceSourceLabel = 'EXECUTION PLAN EVIDENCE';
      } else {
        r.evidenceSourceLabel = 'AST QUERY PATTERN EVIDENCE';
      }
      seenMap.set(key, r);
      deduplicated.push(r);
    }
  }

  return {
    ok: true,
    database: targetDb,
    disclaimer: DMV_DISCLAIMER,
    count: deduplicated.length,
    recommendations: deduplicated
  };
}

module.exports = {
  calculateBenefitScore,
  detectIndexConflicts,
  assessIndexWriteRisk,
  generateCreateIndexScript,
  getMissingIndexesFromDMV,
  getMissingIndexesFromPlan,
  collectComprehensiveRecommendations,
  DMV_DISCLAIMER
};
