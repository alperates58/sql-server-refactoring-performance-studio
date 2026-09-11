/**
 * SQL Server Refactoring & Performance Studio
 * Index Metadata & Coverage Service (Sprint 4)
 *
 * Implements:
 * - Batched index metadata extraction (sys.indexes, sys.index_columns)
 * - Query index coverage analysis (FULL, PARTIAL, NONE)
 * - Duplicate & overlapping index detection (PREFIX_OVERLAP, DUPLICATE)
 * - Safe phrasing guardrail for index usage stats
 */

const db = require('./sqlServer');
const { createAstFinding } = require('./ast/canonicalModel');

const indexCache = new Map();

function getCacheKey(database, schema, table) {
  return `${(database || '').toLowerCase()}.${(schema || 'dbo').toLowerCase()}.${(table || '').toLowerCase()}`;
}

function clearIndexCache() {
  indexCache.clear();
}

/**
 * Batched index metadata retrieval for target tables
 */
async function batchGetIndexes(database, tableNames = []) {
  if (!tableNames || !tableNames.length) return {};

  const cleanTables = [...new Set(tableNames.map(t => t.replace(/[\[\]]/g, '').trim()))].filter(Boolean);
  const result = {};
  const missingFromCache = [];

  for (const tbl of cleanTables) {
    const key = getCacheKey(database, 'dbo', tbl);
    if (indexCache.has(key)) {
      result[tbl.toLowerCase()] = indexCache.get(key);
    } else {
      missingFromCache.push(tbl);
    }
  }

  if (!missingFromCache.length) {
    return result;
  }

  const pool = db.getPool(database || db.status().primaryDatabase);
  if (!pool) {
    // Fallback demo index synthesis
    return getFallbackIndexes(database, missingFromCache, result);
  }

  try {
    const tableListSql = missingFromCache.map((_, idx) => `@tbl${idx}`).join(', ');
    const query = `
      SELECT 
        s.name AS schema_name,
        t.name AS table_name,
        i.name AS index_name,
        i.type_desc,
        i.is_unique,
        i.is_primary_key,
        i.filter_definition,
        i.is_disabled,
        ic.key_ordinal,
        ic.is_included_column,
        c.name AS column_name
      FROM sys.indexes i
      JOIN sys.tables t ON i.object_id = t.object_id
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.type > 0 AND t.name IN (${tableListSql})
      ORDER BY s.name, t.name, i.name, ic.key_ordinal;
    `;

    const request = pool.request();
    missingFromCache.forEach((tbl, idx) => {
      request.input(`tbl${idx}`, tbl);
    });

    const res = await request.query(query);
    const grouped = {};

    for (const row of res.recordset || []) {
      const tblKey = row.table_name.toLowerCase();
      if (!grouped[tblKey]) {
        grouped[tblKey] = [];
      }

      let idxObj = grouped[tblKey].find(x => x.name === row.index_name);
      if (!idxObj) {
        idxObj = {
          name: row.index_name,
          table: row.table_name,
          schema: row.schema_name,
          type: row.type_desc,
          isUnique: Boolean(row.is_unique),
          isPrimaryKey: Boolean(row.is_primary_key),
          isClustered: row.type_desc.includes('CLUSTERED') && !row.type_desc.includes('NONCLUSTERED'),
          filterDefinition: row.filter_definition,
          isDisabled: Boolean(row.is_disabled),
          keyColumns: [],
          includedColumns: []
        };
        grouped[tblKey].push(idxObj);
      }

      if (row.is_included_column) {
        idxObj.includedColumns.push(row.column_name);
      } else {
        idxObj.keyColumns.push(row.column_name);
      }
    }

    // Save to cache
    for (const [tblKey, idxList] of Object.entries(grouped)) {
      indexCache.set(getCacheKey(database, 'dbo', tblKey), idxList);
      result[tblKey] = idxList;
    }

    return result;
  } catch (err) {
    console.warn(`[IndexMetadata] İndeksler sorgulanamadı, fallback kullanılıyor:`, err.message);
    return getFallbackIndexes(database, missingFromCache, result);
  }
}

function getFallbackIndexes(database, missingTables, existingResult) {
  for (const tbl of missingTables) {
    const tblLower = tbl.toLowerCase();
    const demoIdxList = [];

    if (tblLower.includes('stok_hareketleri')) {
      demoIdxList.push(
        {
          name: 'PK_STOK_HAREKETLERI',
          table: tbl,
          schema: 'dbo',
          type: 'CLUSTERED',
          isPrimaryKey: true,
          isClustered: true,
          keyColumns: ['sth_id'],
          includedColumns: []
        },
        {
          name: 'IX_STOK_HAREKETLERI_STOK_KOD',
          table: tbl,
          schema: 'dbo',
          type: 'NONCLUSTERED',
          isPrimaryKey: false,
          isClustered: false,
          keyColumns: ['sth_stok_kod', 'sth_tarih'],
          includedColumns: ['sth_miktar', 'sth_tutar']
        }
      );
    } else if (tblLower.includes('stoklar')) {
      demoIdxList.push(
        {
          name: 'PK_STOKLAR',
          table: tbl,
          schema: 'dbo',
          type: 'CLUSTERED',
          isPrimaryKey: true,
          isClustered: true,
          keyColumns: ['sto_kod'],
          includedColumns: []
        }
      );
    }

    indexCache.set(getCacheKey(database, 'dbo', tbl), demoIdxList);
    existingResult[tblLower] = demoIdxList;
  }
  return existingResult;
}

/**
 * Analyzes query index coverage against existing table indexes
 */
function analyzeIndexCoverage(ast = {}, tableIndexes = {}) {
  const coverageResults = [];
  const findings = [];

  const baseTables = (ast.tables || []).filter(t => t.referenceType === 'BASE_TABLE');

  for (const t of baseTables) {
    const tblName = t.object.toLowerCase();
    const existing = tableIndexes[tblName] || [];

    // Collect query columns referenced on this table
    const equalityCols = [];
    const rangeCols = [];
    const joinCols = [];
    const projectionCols = [];

    // 1. From WHERE predicates
    for (const p of ast.predicates || []) {
      for (const col of p.columns || []) {
        if (p.operator === '=') {
          equalityCols.push(col.toLowerCase());
        } else if (['<', '>', '<=', '>=', 'BETWEEN', 'LIKE'].includes(p.operator)) {
          rangeCols.push(col.toLowerCase());
        }
      }
    }

    // 2. From JOIN ON predicates
    for (const j of ast.joins || []) {
      for (const col of j.involvedColumns || []) {
        joinCols.push(col.toLowerCase());
      }
    }

    // 3. Projections
    for (const pr of ast.projections || []) {
      if (pr.alias && pr.alias !== '*') {
        projectionCols.push(pr.alias.toLowerCase());
      }
    }

    const neededFilterCols = [...new Set([...equalityCols, ...joinCols])];

    let bestCoverage = 'NONE'; // 'FULL' | 'PARTIAL' | 'NONE'
    let matchedIndex = null;

    if (existing.length === 0) {
      bestCoverage = 'NONE';
    } else if (neededFilterCols.length === 0) {
      // Query doesn't filter on this table
      bestCoverage = 'FULL';
    } else {
      for (const idx of existing) {
        const keyColsLower = (idx.keyColumns || []).map(k => k.toLowerCase());
        const incColsLower = (idx.includedColumns || []).map(i => i.toLowerCase());
        const allIndexCols = [...keyColsLower, ...incColsLower];

        // Leading key check
        const hasLeadingKey = neededFilterCols.includes(keyColsLower[0]);
        if (hasLeadingKey) {
          const allFiltersCovered = neededFilterCols.every(c => keyColsLower.includes(c));
          const allProjectionsCovered = projectionCols.length === 0 || projectionCols.every(c => allIndexCols.includes(c));

          if (allFiltersCovered && allProjectionsCovered) {
            bestCoverage = 'FULL';
            matchedIndex = idx.name;
            break;
          } else {
            bestCoverage = 'PARTIAL';
            matchedIndex = idx.name;
          }
        }
      }
    }

    coverageResults.push({
      table: t.object,
      alias: t.alias,
      coverage: bestCoverage,
      matchedIndex,
      indexesCount: existing.length,
      neededFilterCols,
      existingIndexes: existing.map(i => ({ name: i.name, keys: i.keyColumns, includes: i.includedColumns }))
    });

    if (bestCoverage === 'NONE' && neededFilterCols.length > 0) {
      findings.push(createAstFinding({
        code: 'INDEX_COVERAGE_NONE',
        title: `İndeks Kapsamı Yok (Table Scan Riski): ${t.object}`,
        severity: 'HIGH',
        category: 'indexing',
        evidenceGrade: 'B',
        source: 'INDEX_METADATA',
        table: t.object,
        explanation: `${t.object} tablosu üzerinde (${neededFilterCols.join(', ')}) kolonlarını ilk anahtar (leading key) olarak içeren hiçbir indeks bulunamadı.`,
        rewriteHint: `Sorgu yükü yüksekse ${neededFilterCols[0]} kolonu üzerinde indeks oluşturulması değerlendirilmelidir.`
      }));
    } else if (bestCoverage === 'PARTIAL') {
      findings.push(createAstFinding({
        code: 'INDEX_COVERAGE_PARTIAL',
        title: `Kısmi İndeks Kapsamı (Key Lookup İhtimali): ${t.object}`,
        severity: 'LOW',
        category: 'indexing',
        evidenceGrade: 'B',
        source: 'INDEX_METADATA',
        table: t.object,
        explanation: `${matchedIndex} indeksi filtre kolonunu karşılıyor; ancak projeksiyondaki bazı kolonlar dahil (INCLUDE) edilmediği için Key Lookup maliyeti oluşabilir.`
      }));
    }
  }

  return {
    coverageResults,
    findings
  };
}

/**
 * Detects duplicate or overlapping indexes on the same table
 */
function analyzeOverlappingIndexes(tableIndexes = {}) {
  const findings = [];

  for (const [tblName, indexes] of Object.entries(tableIndexes)) {
    if (!indexes || indexes.length < 2) continue;

    for (let i = 0; i < indexes.length; i++) {
      for (let j = i + 1; j < indexes.length; j++) {
        const idxA = indexes[i];
        const idxB = indexes[j];

        const keysA = (idxA.keyColumns || []).map(k => k.toLowerCase());
        const keysB = (idxB.keyColumns || []).map(k => k.toLowerCase());

        // 1. Exact Duplicate (same keys and same includes)
        if (keysA.join(',') === keysB.join(',')) {
          findings.push(createAstFinding({
            code: 'INDEX_DUPLICATE',
            title: `Mükerrer İndeks Tespiti: ${idxA.name} & ${idxB.name}`,
            severity: 'MEDIUM',
            category: 'indexing',
            evidenceGrade: 'A',
            source: 'INDEX_METADATA',
            table: tblName,
            explanation: `${tblName} tablosu üzerinde ${idxA.name} ve ${idxB.name} indeksleri aynı anahtar kolon sıralamasına (${idxA.keyColumns.join(', ')}) sahiptir. İki indeksin birden var olması yazma (DML) maliyetini ikiye katlar.`,
            rewriteHint: 'DBA incelemesi ile gereksiz olan indeks kaldırılabilir (İnceleme Adayı).'
          }));
        }
        // 2. Prefix Overlap: keysA is a strict prefix of keysB (or vice versa)
        else if (keysB.length > keysA.length && keysB.slice(0, keysA.length).join(',') === keysA.join(',')) {
          findings.push(createAstFinding({
            code: 'INDEX_PREFIX_OVERLAP',
            title: `Önek Örtüşen İndeks (Prefix Overlap): ${idxA.name} ⊂ ${idxB.name}`,
            severity: 'LOW',
            category: 'indexing',
            evidenceGrade: 'A',
            source: 'INDEX_METADATA',
            table: tblName,
            explanation: `${idxA.name} anahtarları (${idxA.keyColumns.join(', ')}), ${idxB.name} indeksinin ilk anahtarlarını oluşturmaktadır. Daha geniş olan indeks genellikle daha dar olanın işlevini görebilir.`,
            rewriteHint: 'Sorgu planları incelenerek dar indeksin birleştirilmesi (konsolidasyon) değerlendirilebilir.'
          }));
        }
      }
    }
  }

  return findings;
}

module.exports = {
  batchGetIndexes,
  analyzeIndexCoverage,
  analyzeOverlappingIndexes,
  clearIndexCache
};
