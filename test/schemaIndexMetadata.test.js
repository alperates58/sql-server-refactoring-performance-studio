/**
 * SQL Server Refactoring & Performance Studio
 * Schema & Index Metadata Service Unit Tests (Sprint 4)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  batchGetSchemas,
  detectImplicitConversions,
  clearSchemaCache
} = require('../server/services/schemaMetadata');
const {
  batchGetIndexes,
  analyzeIndexCoverage,
  analyzeOverlappingIndexes,
  clearIndexCache
} = require('../server/services/indexMetadata');
const { estimateAndPruneTokenBudget } = require('../server/services/aiProvider');
const { parseSql } = require('../server/services/ast/astParser');

describe('Schema & Index Metadata Services', () => {

  beforeEach(() => {
    clearSchemaCache();
    clearIndexCache();
  });

  describe('Schema Metadata & Implicit Conversions', () => {

    it('returns empty object when table list is empty', async () => {
      const res = await batchGetSchemas('TEST_DB', []);
      assert.deepStrictEqual(res, {});
    });

    it('detects IMPLICIT_CONVERSION_VARCHAR_TO_NVARCHAR when varchar column is compared with unicode N literal', () => {
      const predicates = [
        {
          expression: "sto_kod = N'ABC01'",
          leftExpression: 'sto_kod',
          operator: '=',
          rightExpression: "N'ABC01'",
          columns: ['sto_kod']
        }
      ];

      const tableSchemas = {
        stoklar: {
          table: 'STOKLAR',
          columns: [
            { name: 'sto_kod', dataType: 'varchar', maxLength: 25 }
          ]
        }
      };

      const findings = detectImplicitConversions(predicates, tableSchemas);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].code, 'IMPLICIT_CONVERSION_VARCHAR_TO_NVARCHAR');
      assert.strictEqual(findings[0].severity, 'HIGH');
      assert.ok(findings[0].rewriteHint.includes("N'...'"));
    });

    it('detects IMPLICIT_CONVERSION_INT_TO_VARCHAR when numeric column is compared with string literal', () => {
      const predicates = [
        {
          expression: "cust_id = '1050'",
          leftExpression: 'cust_id',
          operator: '=',
          rightExpression: "'1050'",
          columns: ['cust_id']
        }
      ];

      const tableSchemas = {
        customers: {
          table: 'CUSTOMERS',
          columns: [
            { name: 'cust_id', dataType: 'int' }
          ]
        }
      };

      const findings = detectImplicitConversions(predicates, tableSchemas);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].code, 'IMPLICIT_CONVERSION_INT_TO_VARCHAR');
      assert.strictEqual(findings[0].severity, 'MEDIUM');
    });

    it('does NOT flag when data types match appropriately', () => {
      const predicates = [
        {
          expression: "sto_kod = 'ABC01'",
          leftExpression: 'sto_kod',
          operator: '=',
          rightExpression: "'ABC01'",
          columns: ['sto_kod']
        },
        {
          expression: 'amount = 100',
          leftExpression: 'amount',
          operator: '=',
          rightExpression: '100',
          columns: ['amount']
        }
      ];

      const tableSchemas = {
        stoklar: {
          table: 'STOKLAR',
          columns: [
            { name: 'sto_kod', dataType: 'varchar' },
            { name: 'amount', dataType: 'int' }
          ]
        }
      };

      const findings = detectImplicitConversions(predicates, tableSchemas);
      assert.strictEqual(findings.length, 0, 'Matching datatypes should produce zero conversion warnings');
    });

  });

  describe('Index Metadata & Coverage Analysis', () => {

    it('evaluates FULL coverage when index covers leading filter and projection', () => {
      const ast = parseSql('SELECT sth_id, sth_stok_kod FROM dbo.STOK_HAREKETLERI WHERE sth_stok_kod = 100');
      const tableIndexes = {
        stok_hareketleri: [
          {
            name: 'IX_STOK_HAREKETLERI_KOD',
            table: 'STOK_HAREKETLERI',
            keyColumns: ['sth_stok_kod'],
            includedColumns: ['sth_id']
          }
        ]
      };

      const { coverageResults, findings } = analyzeIndexCoverage(ast, tableIndexes);
      assert.strictEqual(coverageResults.length, 1);
      assert.strictEqual(coverageResults[0].coverage, 'FULL');
      assert.strictEqual(coverageResults[0].matchedIndex, 'IX_STOK_HAREKETLERI_KOD');
      assert.strictEqual(findings.length, 0);
    });

    it('evaluates PARTIAL coverage when leading filter is indexed but projections are not covered', () => {
      const ast = parseSql('SELECT sth_tutar, sth_aciklama FROM dbo.STOK_HAREKETLERI WHERE sth_stok_kod = 100');
      const tableIndexes = {
        stok_hareketleri: [
          {
            name: 'IX_STOK_HAREKETLERI_KOD',
            table: 'STOK_HAREKETLERI',
            keyColumns: ['sth_stok_kod'],
            includedColumns: [] // sth_tutar and sth_aciklama are missing -> Key Lookup
          }
        ]
      };

      const { coverageResults, findings } = analyzeIndexCoverage(ast, tableIndexes);
      assert.strictEqual(coverageResults.length, 1);
      assert.strictEqual(coverageResults[0].coverage, 'PARTIAL');
      const partFinding = findings.find(f => f.code === 'INDEX_COVERAGE_PARTIAL');
      assert.ok(partFinding, 'Should report partial coverage with Key Lookup risk');
    });

    it('evaluates NONE coverage and flags INDEX_COVERAGE_NONE when no leading index exists', () => {
      const ast = parseSql('SELECT id, name FROM dbo.UnindexedTable WHERE secret_code = 999');
      const tableIndexes = {
        unindexedtable: [
          {
            name: 'IX_OTHER_COL',
            table: 'UnindexedTable',
            keyColumns: ['other_col'],
            includedColumns: []
          }
        ]
      };

      const { coverageResults, findings } = analyzeIndexCoverage(ast, tableIndexes);
      assert.strictEqual(coverageResults.length, 1);
      assert.strictEqual(coverageResults[0].coverage, 'NONE');
      const noneFinding = findings.find(f => f.code === 'INDEX_COVERAGE_NONE');
      assert.ok(noneFinding, 'Should report missing index coverage risk');
      assert.strictEqual(noneFinding.severity, 'HIGH');
    });

    it('detects INDEX_DUPLICATE when two indexes have identical key columns', () => {
      const tableIndexes = {
        orders: [
          {
            name: 'IX_ORDERS_DATE_1',
            keyColumns: ['order_date', 'customer_id'],
            includedColumns: []
          },
          {
            name: 'IX_ORDERS_DATE_2',
            keyColumns: ['order_date', 'customer_id'],
            includedColumns: []
          }
        ]
      };

      const findings = analyzeOverlappingIndexes(tableIndexes);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].code, 'INDEX_DUPLICATE');
      assert.strictEqual(findings[0].severity, 'MEDIUM');
      assert.ok(findings[0].title.includes('Mükerrer'));
    });

    it('detects INDEX_PREFIX_OVERLAP when one index key is a prefix of another', () => {
      const tableIndexes = {
        orders: [
          {
            name: 'IX_ORDERS_CUST',
            keyColumns: ['customer_id'],
            includedColumns: []
          },
          {
            name: 'IX_ORDERS_CUST_DATE',
            keyColumns: ['customer_id', 'order_date'],
            includedColumns: []
          }
        ]
      };

      const findings = analyzeOverlappingIndexes(tableIndexes);
      assert.strictEqual(findings.length, 1);
      assert.strictEqual(findings[0].code, 'INDEX_PREFIX_OVERLAP');
      assert.strictEqual(findings[0].severity, 'LOW');
      assert.ok(findings[0].title.includes('Önek Örtüşen'));
    });

    it('returns empty findings when indexes have disjoint keys', () => {
      const tableIndexes = {
        orders: [
          {
            name: 'IX_ORDERS_CUST',
            keyColumns: ['customer_id'],
            includedColumns: []
          },
          {
            name: 'IX_ORDERS_STATUS',
            keyColumns: ['status_code'],
            includedColumns: []
          }
        ]
      };

      const findings = analyzeOverlappingIndexes(tableIndexes);
      assert.strictEqual(findings.length, 0);
    });

  });

  describe('AI Context Pack V2 & Token Budget Pruning', () => {

    it('leaves payload untouched when size is well within maxChars budget', () => {
      const smallPack = {
        viewName: 'V_SMALL',
        sql: 'SELECT 1 AS a',
        ast: { predicates: [{ expression: 'a = 1' }] }
      };

      const pruned = estimateAndPruneTokenBudget(smallPack, 24000);
      assert.deepStrictEqual(pruned, smallPack);
    });

    it('deterministically prunes secondary metadata when payload exceeds maxChars budget', () => {
      // Construct a huge payload
      const hugePack = {
        viewName: 'V_HUGE',
        sql: 'SELECT x FROM dbo.BigTable WHERE a = 1',
        ast: {
          subqueries: Array.from({ length: 20 }, (_, i) => ({ id: i, raw: `(SELECT ${i})` })),
          predicates: Array.from({ length: 30 }, (_, i) => ({ expression: `col${i} = ${i}` }))
        },
        runtime: {
          queries: Array.from({ length: 20 }, (_, i) => ({ queryId: i, text: `SELECT * FROM tbl WHERE id = ${i}` }))
        },
        schema: {
          bigtable: {
            columns: Array.from({ length: 50 }, (_, i) => ({ name: `col${i}`, dataType: 'varchar(100)' }))
          }
        },
        indexes: {
          bigtable: Array.from({ length: 15 }, (_, i) => ({ name: `IX_${i}`, keyColumns: [`col${i}`], includedColumns: [] }))
        }
      };

      const budgetLimit = 1500;
      const pruned = estimateAndPruneTokenBudget(hugePack, budgetLimit);

      // Core fields MUST NOT be destroyed
      assert.strictEqual(pruned.viewName, 'V_HUGE');
      assert.strictEqual(pruned.sql, hugePack.sql);

      // Subqueries should be sliced to at most 3
      assert.ok(pruned.ast.subqueries.length <= 3);

      // Runtime queries should be sliced to at most 3
      assert.ok(pruned.runtime.queries.length <= 3);

      // Schema should be compacted
      assert.ok(Array.isArray(pruned.schema.bigtable));

      // Indexes should be sliced to top 5
      assert.ok(pruned.indexes.bigtable.length <= 5);
    });

  });

});
