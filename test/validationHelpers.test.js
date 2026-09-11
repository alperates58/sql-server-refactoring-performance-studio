/**
 * SQL Server Refactoring & Performance Studio
 * Validation Service Helper Utilities Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitCteAndSelect,
  buildBoundedTableScript,
  buildCountProbeScript,
  buildDeterministicOrderBy,
  isComparableColumn,
  getComparableColumns
} = require('../server/services/validationService');

describe('Validation Service - Deterministic Sampling & Parsing Helpers', () => {

  describe('splitCteAndSelect', () => {
    it('returns empty ctePrefix and untouched mainSelect for queries without CTE', () => {
      const sql = 'SELECT sto_kod, sto_isim FROM dbo.STOKLAR WHERE sto_aktif = 1';
      const res = splitCteAndSelect(sql);
      assert.strictEqual(res.ctePrefix, '');
      assert.strictEqual(res.mainSelect, sql);
    });

    it('correctly separates a single CTE from the outer SELECT', () => {
      const sql = `
        WITH CteSummary AS (
          SELECT sto_kod, COUNT(*) AS Total FROM dbo.STOK_HAREKETLERI GROUP BY sto_kod
        )
        SELECT s.sto_kod, c.Total FROM dbo.STOKLAR s JOIN CteSummary c ON c.sto_kod = s.sto_kod;
      `;
      const res = splitCteAndSelect(sql);
      assert.ok(res.ctePrefix.startsWith('WITH CteSummary AS'));
      assert.ok(res.mainSelect.startsWith('SELECT s.sto_kod'));
    });

    it('handles chained multiple CTEs with nested parentheses', () => {
      const sql = `
        WITH CTE_A AS (
          SELECT id, (SELECT MAX(val) FROM t2 WHERE t2.parent_id = t1.id) AS max_val FROM t1
        ),
        CTE_B AS (
          SELECT id, max_val FROM CTE_A WHERE max_val > 100
        )
        SELECT * FROM CTE_B;
      `;
      const res = splitCteAndSelect(sql);
      assert.ok(res.ctePrefix.includes('CTE_A AS'));
      assert.ok(res.ctePrefix.includes('CTE_B AS'));
      assert.strictEqual(res.mainSelect, 'SELECT * FROM CTE_B');
    });
  });

  describe('isComparableColumn & getComparableColumns', () => {
    it('identifies standard SQL Server scalar types as comparable', () => {
      const standardCols = [
        { name: 'Id', system_type_name: 'int' },
        { name: 'Code', system_type_name: 'varchar(50)' },
        { name: 'Amount', system_type_name: 'decimal(18, 2)' },
        { name: 'CreatedDate', system_type_name: 'datetime2' },
        { name: 'Guid', system_type_name: 'uniqueidentifier' }
      ];
      for (const col of standardCols) {
        assert.strictEqual(isComparableColumn(col), true, `${col.system_type_name} must be comparable`);
      }
    });

    it('identifies LOB, XML, and MAX types as non-comparable', () => {
      const lobCols = [
        { name: 'XmlData', system_type_name: 'xml' },
        { name: 'OldNotes', system_type_name: 'text' },
        { name: 'UnicodeNotes', system_type_name: 'ntext' },
        { name: 'Picture', system_type_name: 'image' },
        { name: 'JsonBody', system_type_name: 'nvarchar(max)' },
        { name: 'HtmlBody', system_type_name: 'varchar(max)' },
        { name: 'Blob', system_type_name: 'varbinary(max)' }
      ];
      for (const col of lobCols) {
        assert.strictEqual(isComparableColumn(col), false, `${col.system_type_name} must NOT be comparable`);
      }
    });

    it('filters out non-comparable columns correctly', () => {
      const cols = [
        { name: 'Id', system_type_name: 'int' },
        { name: 'Notes', system_type_name: 'varchar(max)' },
        { name: 'Name', system_type_name: 'nvarchar(100)' }
      ];
      const comparable = getComparableColumns(cols);
      assert.strictEqual(comparable.length, 2);
      assert.strictEqual(comparable[0].name, 'Id');
      assert.strictEqual(comparable[1].name, 'Name');
    });
  });

  describe('buildDeterministicOrderBy', () => {
    it('generates deterministic ORDER BY clause bracketed properly', () => {
      const cols = [
        { name: 'sto_kod', system_type_name: 'varchar(30)' },
        { name: 'sth_tarih', system_type_name: 'datetime' }
      ];
      const clause = buildDeterministicOrderBy(cols);
      assert.strictEqual(clause, 'ORDER BY [sto_kod], [sth_tarih]');
    });

    it('returns empty string when comparable column list is empty', () => {
      assert.strictEqual(buildDeterministicOrderBy([]), '');
      assert.strictEqual(buildDeterministicOrderBy(null), '');
    });
  });

  describe('buildBoundedTableScript & buildCountProbeScript', () => {
    it('includes TOP and ORDER BY when useTop is true', () => {
      const sql = 'SELECT id, name FROM dbo.Users';
      const script = buildBoundedTableScript(sql, '#Sample', 500, 'ORDER BY [id]', true);
      assert.ok(script.includes('TOP (500)'));
      assert.ok(script.includes('ORDER BY [id]'));
      assert.ok(script.includes('INTO #Sample'));
    });

    it('omits TOP and ORDER BY when useTop is false (full dataset comparison)', () => {
      const sql = 'SELECT id, name FROM dbo.Users';
      const script = buildBoundedTableScript(sql, '#FullSet', 500, '', false);
      assert.ok(!script.includes('TOP ('));
      assert.ok(script.includes('SELECT  *'));
      assert.ok(script.includes('INTO #FullSet'));
    });

    it('builds count probe script with limit + 1 bounding', () => {
      const sql = 'SELECT id FROM dbo.Users';
      const probe = buildCountProbeScript(sql, 1000);
      assert.ok(probe.includes('TOP (1001)'));
      assert.ok(probe.includes('COUNT_BIG(*) AS RowCnt'));
    });
  });

});
