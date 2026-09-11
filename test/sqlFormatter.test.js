const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatSql, tokenize } = require('../server/services/sqlFormatter');

describe('Safe T-SQL Formatter Tests (Sprint 7)', () => {
  describe('Tokenizer Accuracy & Token Preservation', () => {
    it('preserves string literals verbatim including spaces, keywords and quotes', () => {
      const sql = "SELECT 'SELECT * FROM nowhere', 'It''s dangerous' FROM dbo.T";
      const tokens = tokenize(sql);
      const strTokens = tokens.filter(t => t.type === 'LITERAL');

      assert.equal(strTokens.length, 2);
      assert.equal(strTokens[0].value, "'SELECT * FROM nowhere'");
      assert.equal(strTokens[1].value, "'It''s dangerous'");
    });

    it('preserves bracketed identifiers with keywords or spaces', () => {
      const sql = 'SELECT [from], [order id], [table] FROM [my schema].[my table]';
      const tokens = tokenize(sql);
      const idTokens = tokens.filter(t => t.type === 'IDENTIFIER');

      assert.equal(idTokens.length, 5);
      assert.equal(idTokens[0].value, '[from]');
      assert.equal(idTokens[1].value, '[order id]');
      assert.equal(idTokens[2].value, '[table]');
      assert.equal(idTokens[3].value, '[my schema]');
      assert.equal(idTokens[4].value, '[my table]');
    });

    it('preserves line comments and block comments', () => {
      const sql = '-- Line comment\nSELECT 1 /* block comment */ FROM dbo.T';
      const tokens = tokenize(sql);
      const comments = tokens.filter(t => t.type === 'COMMENT');

      assert.equal(comments.length, 2);
      assert.equal(comments[0].value, '-- Line comment');
      assert.equal(comments[1].value, '/* block comment */');
    });
  });

  describe('Keyword Capitalization & Clause Indentation', () => {
    it('capitalizes T-SQL keywords accurately', () => {
      const raw = 'select id, name from dbo.users where is_active = 1 and status is not null';
      const formatted = formatSql(raw);

      assert.ok(formatted.includes('SELECT id, name'));
      assert.ok(formatted.includes('FROM dbo.users'));
      assert.ok(formatted.includes('WHERE is_active = 1 AND status IS NOT NULL'));
    });

    it('breaks major clauses onto separate lines', () => {
      const raw = 'select col1 from tbl where col2 = 1 group by col1 having count(*) > 0 order by col1 desc';
      const formatted = formatSql(raw);
      const lines = formatted.split('\n').map(l => l.trim());

      assert.ok(lines.some(l => l.startsWith('SELECT')));
      assert.ok(lines.some(l => l.startsWith('FROM tbl')));
      assert.ok(lines.some(l => l.startsWith('WHERE col2 = 1')));
      assert.ok(lines.some(l => l.startsWith('GROUP BY col1')));
      assert.ok(lines.some(l => l.startsWith('HAVING COUNT(*) > 0')));
      assert.ok(lines.some(l => l.startsWith('ORDER BY col1 DESC')));
    });

    it('indents JOIN clauses appropriately', () => {
      const raw = 'select a.id, b.name from dbo.A a inner join dbo.B b on a.id = b.a_id left join dbo.C c on b.id = c.b_id';
      const formatted = formatSql(raw);

      assert.ok(formatted.includes('    INNER JOIN dbo.B b ON a.id = b.a_id'));
      assert.ok(formatted.includes('    LEFT JOIN dbo.C c ON b.id = c.b_id'));
    });

    it('formats CASE WHEN statements with uppercase tokens', () => {
      const raw = 'select case when status = 1 then \'Active\' else \'Inactive\' end as user_status from dbo.users';
      const formatted = formatSql(raw);

      assert.ok(formatted.includes('CASE WHEN status = 1 THEN \'Active\' ELSE \'Inactive\' END AS user_status'));
    });
  });

  describe('Idempotency & Safe Round-trip', () => {
    it('produces identical output when formatted multiple times (Idempotence)', () => {
      const raw = 'SELECT o.id, c.name FROM dbo.Orders o INNER JOIN dbo.Customers c ON o.cust_id = c.id WHERE o.total > 100 ORDER BY o.date DESC;';
      const firstPass = formatSql(raw);
      const secondPass = formatSql(firstPass);
      const thirdPass = formatSql(secondPass);

      assert.equal(secondPass, firstPass, 'Second pass must equal first pass');
      assert.equal(thirdPass, firstPass, 'Third pass must equal first pass');
    });

    it('handles empty strings, null, and undefined gracefully without throwing', () => {
      assert.equal(formatSql(''), '');
      assert.equal(formatSql(null), '');
      assert.equal(formatSql(undefined), '');
      assert.equal(formatSql('   '), '');
    });

    it('retains dot-notation without unwanted whitespace around dots', () => {
      const raw = 'SELECT dbo.tbl.column_name FROM dbo.tbl';
      const formatted = formatSql(raw);

      assert.ok(formatted.includes('dbo.tbl.column_name'));
      assert.ok(!formatted.includes('dbo . tbl'));
    });
  });
});
