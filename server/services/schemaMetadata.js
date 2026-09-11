/**
 * SQL Server Refactoring & Performance Studio
 * Schema Metadata Service (Sprint 4)
 *
 * Batched, non-blocking schema extraction for query tables:
 * - Columns, datatypes, length, precision, scale, nullability, identity
 * - Cross-database support
 * - Implicit conversion detection between column types and literals/parameters
 */

const db = require('./sqlServer');
const metadataCatalog = require('./metadataCatalog');
const { createAstFinding } = require('./ast/canonicalModel');

const schemaCache = new Map();

function getCacheKey(database, schema, table) {
  return `${(database || '').toLowerCase()}.${(schema || 'dbo').toLowerCase()}.${(table || '').toLowerCase()}`;
}

function clearSchemaCache() {
  schemaCache.clear();
}

/**
 * Batched schema retrieval for a list of table names in a database
 */
async function batchGetSchemas(database, tableNames = []) {
  if (!tableNames || !tableNames.length) return {};

  const cleanTables = [...new Set(tableNames.map(t => t.replace(/[\[\]]/g, '').trim()))].filter(Boolean);
  const result = {};
  const missingFromCache = [];

  for (const tbl of cleanTables) {
    const key = getCacheKey(database, 'dbo', tbl);
    if (schemaCache.has(key)) {
      result[tbl.toLowerCase()] = schemaCache.get(key);
    } else {
      missingFromCache.push(tbl);
    }
  }

  if (!missingFromCache.length) {
    return result;
  }

  const pool = db.getPool(database || db.status().primaryDatabase);
  if (!pool) {
    // Fallback to in-memory metadata catalog (e.g. in demo mode or limited permissions)
    return getFallbackSchemas(database, missingFromCache, result);
  }

  try {
    const tableListSql = missingFromCache.map((_, idx) => `@tbl${idx}`).join(', ');
    const query = `
      SELECT 
        s.name AS schema_name,
        t.name AS table_name,
        c.name AS column_name,
        c.column_id,
        tp.name AS data_type,
        c.max_length,
        c.precision,
        c.scale,
        c.is_nullable,
        c.is_identity,
        c.is_computed,
        c.collation_name
      FROM sys.tables t
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      JOIN sys.columns c ON t.object_id = c.object_id
      JOIN sys.types tp ON c.user_type_id = tp.user_type_id
      WHERE t.name IN (${tableListSql})
      ORDER BY s.name, t.name, c.column_id;
    `;

    const request = pool.request();
    missingFromCache.forEach((tbl, idx) => {
      request.input(`tbl${idx}`, tbl);
    });

    const res = await request.query(query);
    const grouped = {};

    for (const row of res.recordset || []) {
      const tblLower = row.table_name.toLowerCase();
      if (!grouped[tblLower]) {
        grouped[tblLower] = {
          database,
          schema: row.schema_name,
          table: row.table_name,
          columns: []
        };
      }
      grouped[tblLower].columns.push({
        name: row.column_name,
        columnId: row.column_id,
        dataType: row.data_type,
        maxLength: row.max_length,
        precision: row.precision,
        scale: row.scale,
        isNullable: Boolean(row.is_nullable),
        isIdentity: Boolean(row.is_identity),
        isComputed: Boolean(row.is_computed),
        collation: row.collation_name
      });
    }

    // Save to cache
    for (const [tblKey, schemaObj] of Object.entries(grouped)) {
      schemaCache.set(getCacheKey(database, schemaObj.schema, tblKey), schemaObj);
      result[tblKey] = schemaObj;
    }

    return result;
  } catch (err) {
    console.warn(`[SchemaMetadata] Veritabanından şema alınamadı, fallback kullanılıyor:`, err.message);
    return getFallbackSchemas(database, missingFromCache, result);
  }
}

function getFallbackSchemas(database, missingTables, existingResult) {
  const cat = metadataCatalog.getCatalog(database);
  for (const tbl of missingTables) {
    const found = (cat.tables || []).find(t => t.name.toLowerCase() === tbl.toLowerCase());
    if (found) {
      const obj = {
        database: found.database || database,
        schema: found.schema || 'dbo',
        table: found.name,
        columns: (found.columns || []).map((c, idx) => ({
          name: c.name,
          columnId: idx + 1,
          dataType: c.dataType || 'nvarchar(50)',
          isNullable: c.nullable !== false
        }))
      };
      schemaCache.set(getCacheKey(database, obj.schema, tbl), obj);
      existingResult[tbl.toLowerCase()] = obj;
    }
  }
  return existingResult;
}

/**
 * Detects implicit conversion risks by comparing column datatypes with predicate expressions
 */
function detectImplicitConversions(predicates = [], tableSchemas = {}) {
  const findings = [];

  // Build column lookup map: column_name -> { dataType, table }
  const colLookup = new Map();
  for (const [tblName, schema] of Object.entries(tableSchemas)) {
    for (const c of schema.columns || []) {
      colLookup.set(c.name.toLowerCase(), { ...c, table: tblName });
      colLookup.set(`${tblName}.${c.name}`.toLowerCase(), { ...c, table: tblName });
    }
  }

  for (const pred of predicates) {
    for (const colName of pred.columns || []) {
      const colInfo = colLookup.get(colName.toLowerCase());
      if (!colInfo) continue;

      const right = (pred.rightExpression || '').trim();
      const left = (pred.leftExpression || '').trim();
      const colType = (colInfo.dataType || '').toLowerCase();

      // Case 1: varchar column compared with unicode N'...' literal
      if (colType === 'varchar' && /^N'/.test(right)) {
        findings.push(createAstFinding({
          code: 'IMPLICIT_CONVERSION_VARCHAR_TO_NVARCHAR',
          title: `Örtük Tür Dönüşümü Riski (varchar vs nvarchar): ${colInfo.name}`,
          severity: 'HIGH',
          category: 'performance',
          evidenceGrade: 'B',
          source: 'SCHEMA',
          expression: pred.expression,
          column: colInfo.name,
          table: colInfo.table,
          explanation: `${colInfo.name} kolonu varchar tipindedir; ancak filtrede N'...' (nvarchar) sabiti ile karşılaştırılmaktadır. SQL Server öncelik kuralı gereği varchar kolonu nvarchar'a dönüştürür ve indeks seek kullanımını engeller.`,
          rewriteHint: `N'...' ön ekini kaldırıp standart ANSI string '...' kullanın.`
        }));
      }

      // Case 2: Integer column compared with string literal '123'
      if (['int', 'bigint', 'smallint', 'tinyint'].includes(colType) && /^'[^']*'$/.test(right)) {
        findings.push(createAstFinding({
          code: 'IMPLICIT_CONVERSION_INT_TO_VARCHAR',
          title: `Örtük Tür Dönüşümü (Sayısal vs Metin): ${colInfo.name}`,
          severity: 'MEDIUM',
          category: 'performance',
          evidenceGrade: 'B',
          source: 'SCHEMA',
          expression: pred.expression,
          column: colInfo.name,
          table: colInfo.table,
          explanation: `${colInfo.name} kolonu ${colType} tipinde iken metin sabiti (${right}) ile karşılaştırılıyor.`,
          rewriteHint: `Tırnak işaretlerini kaldırarak doğrudan sayısal sabit kullanın.`
        }));
      }
    }
  }

  return findings;
}

module.exports = {
  batchGetSchemas,
  detectImplicitConversions,
  clearSchemaCache
};
