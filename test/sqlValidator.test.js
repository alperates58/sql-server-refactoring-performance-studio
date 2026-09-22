/**
 * SQL Server Refactoring & Performance Studio
 * Read-Only SQL Validator Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateReadOnly, stripCommentsAndLiterals, PROHIBITED_KEYWORDS } = require('../server/services/sqlValidator');

describe('SQL Validator - Read-Only Enforcement', () => {

  it('allows simple SELECT queries', () => {
    const res = validateReadOnly('SELECT 1 AS Test;');
    assert.strictEqual(res.valid, true);
  });

  it('allows SELECT with joins, grouping, and subqueries', () => {
    const sql = `
      SELECT s.sto_kod, COUNT(*) AS Total
      FROM dbo.STOKLAR AS s
      INNER JOIN dbo.STOK_HAREKETLERI AS h ON h.sth_stok_kod = s.sto_kod
      WHERE s.sto_aktif = 1
      GROUP BY s.sto_kod
      HAVING COUNT(*) > 5;
    `;
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, true);
  });

  it('allows WITH (CTE) queries ending in SELECT', () => {
    const sql = `
      WITH CTE_Stok AS (
        SELECT sto_kod, sto_isim FROM dbo.STOKLAR
      )
      SELECT * FROM CTE_Stok;
    `;
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, true);
  });

  it('allows multiple chained CTEs ending in SELECT', () => {
    const sql = `
      WITH CTE_1 AS (SELECT 1 AS A),
           CTE_2 AS (SELECT 2 AS B)
      SELECT * FROM CTE_1 CROSS JOIN CTE_2;
    `;
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, true);
  });

  it('rejects INSERT statements', () => {
    const res = validateReadOnly('INSERT INTO dbo.STOKLAR (sto_kod) VALUES (\'TEST\');');
    assert.strictEqual(res.valid, false);
    assert.match(res.reason, /INSERT|Yalnızca salt-okunur/);
  });

  it('rejects UPDATE statements', () => {
    const res = validateReadOnly('UPDATE dbo.STOKLAR SET sto_aktif = 0;');
    assert.strictEqual(res.valid, false);
  });

  it('rejects DELETE statements', () => {
    const res = validateReadOnly('DELETE FROM dbo.STOKLAR WHERE sto_kod = \'TEST\';');
    assert.strictEqual(res.valid, false);
  });

  it('rejects DROP statements', () => {
    const res = validateReadOnly('DROP TABLE dbo.STOKLAR;');
    assert.strictEqual(res.valid, false);
  });

  it('rejects TRUNCATE statements', () => {
    const res = validateReadOnly('TRUNCATE TABLE dbo.STOK_HAREKETLERI;');
    assert.strictEqual(res.valid, false);
  });

  it('rejects ALTER statements', () => {
    const res = validateReadOnly('ALTER TABLE dbo.STOKLAR ADD x INT;');
    assert.strictEqual(res.valid, false);
  });

  it('rejects MERGE statements', () => {
    const res = validateReadOnly('MERGE INTO TargetTable USING SourceTable ON 1=1 WHEN MATCHED THEN DELETE;');
    assert.strictEqual(res.valid, false);
  });

  it('rejects EXEC and EXECUTE statements', () => {
    assert.strictEqual(validateReadOnly('EXEC sp_who2;').valid, false);
    assert.strictEqual(validateReadOnly('EXECUTE sp_help;').valid, false);
  });

  it('rejects SELECT ... INTO table creation', () => {
    const sql = 'SELECT sto_kod, sto_isim INTO #TempBackup FROM dbo.STOKLAR;';
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.keyword, 'INTO');
  });

  it('rejects OPENROWSET, OPENDATASOURCE, and OPENQUERY', () => {
    assert.strictEqual(validateReadOnly('SELECT * FROM OPENROWSET(\'SQLNCLI\', \'Server=x\', \'SELECT 1\');').valid, false);
    assert.strictEqual(validateReadOnly('SELECT * FROM OPENDATASOURCE(\'SQLNCLI\', \'Data Source=x\').db.dbo.tbl;').valid, false);
    assert.strictEqual(validateReadOnly('SELECT * FROM OPENQUERY(OracleSrv, \'SELECT 1 FROM DUAL\');').valid, false);
  });

  it('rejects WRITETEXT and UPDATETEXT', () => {
    assert.strictEqual(validateReadOnly('WRITETEXT dbo.T.col @ptr \'data\';').valid, false);
    assert.strictEqual(validateReadOnly('UPDATETEXT dbo.T.col @ptr 0 0 \'data\';').valid, false);
  });

  it('rejects GO batch separators', () => {
    const sql = 'SELECT 1; GO; DROP TABLE dbo.STOKLAR;';
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, false);
  });

  it('does NOT reject string literals containing prohibited words like DROP or INTO', () => {
    const sql = 'SELECT \'DROP TABLE STOKLAR\' AS Description, \'INTO\' AS LiteralCol FROM dbo.STOKLAR;';
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, true);
  });

  it('does NOT reject single-line and multi-line comments with prohibited words', () => {
    const sql = `
      -- DROP TABLE STOKLAR;
      /* DELETE FROM STOKLAR WHERE 1=1; */
      SELECT sto_kod FROM dbo.STOKLAR;
    `;
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, true);
  });

  it('does NOT reject bracketed identifiers with prohibited words', () => {
    const sql = 'SELECT [INTO], [DROP] FROM dbo.[ALTER];';
    const res = validateReadOnly(sql);
    assert.strictEqual(res.valid, true);
  });

  it('rejects empty or whitespace-only queries', () => {
    assert.strictEqual(validateReadOnly('').valid, false);
    assert.strictEqual(validateReadOnly('   \n\t  ').valid, false);
    assert.strictEqual(validateReadOnly(null).valid, false);
  });

  it('verifies PROHIBITED_KEYWORDS contains all required guardrails', () => {
    const required = ['INTO', 'OPENROWSET', 'OPENDATASOURCE', 'OPENQUERY', 'WRITETEXT', 'UPDATETEXT', 'GO', 'DROP', 'ALTER', 'DELETE', 'TRUNCATE'];
    for (const kw of required) {
      assert.ok(PROHIBITED_KEYWORDS.includes(kw), `PROHIBITED_KEYWORDS must include ${kw}`);
    }
  });

  describe('Whitelisted Session SET Options (Sprint 9)', () => {
    it('allows SET NOCOUNT ON before SELECT', () => {
      const res = validateReadOnly('SET NOCOUNT ON; SELECT 1 AS num;');
      assert.strictEqual(res.valid, true);
    });

    it('allows SET NOCOUNT OFF before SELECT', () => {
      const res = validateReadOnly('SET NOCOUNT OFF;\nSELECT 1 AS num;');
      assert.strictEqual(res.valid, true);
    });

    it('allows SET ARITHABORT ON before SELECT', () => {
      const res = validateReadOnly('SET ARITHABORT ON; SELECT 1 AS num;');
      assert.strictEqual(res.valid, true);
    });

    it('allows chained safe SET statements', () => {
      const sql = `
        SET NOCOUNT ON;
        SET ARITHABORT ON;
        SELECT sto_kod FROM dbo.STOKLAR;
      `;
      const res = validateReadOnly(sql);
      assert.strictEqual(res.valid, true);
    });

    it('allows SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED', () => {
      const sql = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT TOP 10 * FROM dbo.STOKLAR;';
      const res = validateReadOnly(sql);
      assert.strictEqual(res.valid, true);
    });

    it('rejects SET NOCOUNT ON followed by DELETE (mutation blocked)', () => {
      const res = validateReadOnly('SET NOCOUNT ON; DELETE FROM dbo.STOKLAR;');
      assert.strictEqual(res.valid, false);
      assert.match(res.reason, /DELETE|ihlal ediyor/);
    });

    it('rejects SET NOCOUNT ON followed by EXEC (dynamic execution blocked)', () => {
      const res = validateReadOnly('SET NOCOUNT ON; EXEC sp_who2;');
      assert.strictEqual(res.valid, false);
      assert.match(res.reason, /EXEC|ihlal ediyor/);
    });

    it('rejects non-whitelisted SET options like SET ANSI_NULLS OFF', () => {
      const res = validateReadOnly('SET ANSI_NULLS OFF; SELECT 1;');
      assert.strictEqual(res.valid, false);
      assert.match(res.reason, /izin verilmeyen oturum komutunu engelledi/);
    });

    it('rejects variable assignment via SET @x = 1', () => {
      const res = validateReadOnly('SET @var = 1; SELECT @var;');
      assert.strictEqual(res.valid, false);
      assert.match(res.reason, /izin verilmeyen oturum komutunu engelledi/);
    });

    it('rejects standalone SET statements with no subsequent SELECT or WITH', () => {
      const res = validateReadOnly('SET NOCOUNT ON;');
      assert.strictEqual(res.valid, false);
      assert.match(res.reason, /SELECT veya WITH/);
    });
  });

});
