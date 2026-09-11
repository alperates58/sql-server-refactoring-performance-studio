/**
 * SQL Server Refactoring & Performance Studio
 * T-SQL AST Parser & Adapters Unit Tests (Sprint 4)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { parseSql, clearAstCache, getCacheStats, computeHash } = require('../server/services/ast/astParser');
const { parseTsql, cleanIdentifier, parseQualifiedObjectName } = require('../server/services/ast/adapters/tsqlParserAdapter');
const { parseWithRegexFallback } = require('../server/services/ast/adapters/regexFallbackAdapter');

describe('T-SQL AST Parser & Adapters', () => {

  beforeEach(() => {
    clearAstCache();
  });

  it('correctly parses cleanIdentifier removing brackets and quotes', () => {
    assert.strictEqual(cleanIdentifier('[dbo]'), 'dbo');
    assert.strictEqual(cleanIdentifier('"my_table"'), 'my_table');
    assert.strictEqual(cleanIdentifier(' [users] '), 'users');
    assert.strictEqual(cleanIdentifier('regular_name'), 'regular_name');
  });

  it('correctly parses 1-part, 2-part, and 3-part qualified object names', () => {
    const p1 = parseQualifiedObjectName('STOKLAR');
    assert.strictEqual(p1.object, 'STOKLAR');
    assert.strictEqual(p1.schema, null);
    assert.strictEqual(p1.database, null);

    const p2 = parseQualifiedObjectName('[dbo].[STOK_HAREKETLERI]');
    assert.strictEqual(p2.schema, 'dbo');
    assert.strictEqual(p2.object, 'STOK_HAREKETLERI');
    assert.strictEqual(p2.database, null);

    const p3 = parseQualifiedObjectName('[ERP_PROD].[dbo].[CARI_HESAPLAR]');
    assert.strictEqual(p3.database, 'ERP_PROD');
    assert.strictEqual(p3.schema, 'dbo');
    assert.strictEqual(p3.object, 'CARI_HESAPLAR');
  });

  it('parses a basic SELECT statement into canonical model', () => {
    const sql = 'SELECT sto_kod, sto_isim FROM dbo.STOKLAR WHERE sto_tip = 1';
    const ast = parseSql(sql);

    assert.strictEqual(ast.analysisSource, 'AST');
    assert.strictEqual(ast.status, 'AST_AVAILABLE');
    assert.strictEqual(ast.tables.length, 1);
    assert.strictEqual(ast.tables[0].object, 'STOKLAR');
    assert.strictEqual(ast.tables[0].schema, 'dbo');
    assert.strictEqual(ast.projections.length, 2);
    assert.strictEqual(ast.predicates.length, 1);
    assert.strictEqual(ast.predicates[0].operator, '=');
    assert.strictEqual(ast.hasWildcardSelect, false);
  });

  it('parses CTEs and detects recursive references', () => {
    const sql = `
      WITH BOM_TREE AS (
        SELECT parent_id, child_id, 1 AS level
        FROM dbo.BOM
        WHERE parent_id = 100
        UNION ALL
        SELECT b.parent_id, b.child_id, t.level + 1
        FROM dbo.BOM b
        INNER JOIN BOM_TREE t ON b.parent_id = t.child_id
      )
      SELECT * FROM BOM_TREE;
    `;
    const ast = parseSql(sql);

    assert.strictEqual(ast.ctes.length, 1);
    assert.strictEqual(ast.ctes[0].name, 'BOM_TREE');
    assert.strictEqual(ast.ctes[0].isRecursive, true);
    assert.strictEqual(ast.hasWildcardSelect, true);
  });

  it('parses JOIN variations: INNER, LEFT, CROSS JOIN, CROSS APPLY', () => {
    const sql = `
      SELECT o.id, c.name, d.detail_val, f.calc_val
      FROM dbo.Orders o
      INNER JOIN dbo.Customers c ON o.cust_id = c.id
      LEFT JOIN dbo.OrderDetails d ON o.id = d.order_id
      CROSS JOIN dbo.SystemConfig cfg
      CROSS APPLY dbo.fn_GetDiscounts(o.id) f;
    `;
    const ast = parseSql(sql);

    assert.strictEqual(ast.joins.length, 4);
    assert.strictEqual(ast.joins[0].type, 'INNER JOIN');
    assert.strictEqual(ast.joins[1].type, 'LEFT JOIN');
    assert.strictEqual(ast.joins[2].type, 'CROSS JOIN');
    assert.strictEqual(ast.joins[3].type, 'CROSS APPLY');
  });

  it('parses table hints such as WITH (NOLOCK)', () => {
    const sql = 'SELECT id FROM dbo.Logs WITH (NOLOCK) WHERE status = 1';
    const ast = parseSql(sql);

    assert.strictEqual(ast.tables.length, 1);
    assert.strictEqual(ast.tables[0].hint, 'NOLOCK');
  });

  it('distinguishes SELECT * from COUNT(*)', () => {
    const sqlStar = 'SELECT * FROM dbo.Products';
    const astStar = parseSql(sqlStar);
    assert.strictEqual(astStar.hasWildcardSelect, true);

    const sqlCount = 'SELECT COUNT(*) AS total_count FROM dbo.Products';
    const astCount = parseSql(sqlCount);
    assert.strictEqual(astCount.hasWildcardSelect, false);
    assert.strictEqual(astCount.projections[0].alias, 'total_count');
  });

  it('parses window functions with PARTITION BY and ORDER BY', () => {
    const sql = `
      SELECT 
        id, 
        ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY price DESC) as rn,
        SUM(price) OVER (PARTITION BY category_id) as cat_sum
      FROM dbo.Products;
    `;
    const ast = parseSql(sql);

    assert.strictEqual(ast.windowFunctions.length, 2);
    assert.strictEqual(ast.windowFunctions[0].function, 'ROW_NUMBER');
    assert.strictEqual(ast.windowFunctions[0].partitionBy, 'category_id');
    assert.strictEqual(ast.windowFunctions[1].function, 'SUM');
  });

  it('parses subqueries: scalar, IN, and EXISTS', () => {
    const sql = `
      SELECT 
        c.name,
        (SELECT MAX(order_date) FROM dbo.Orders o WHERE o.cust_id = c.id) AS last_order
      FROM dbo.Customers c
      WHERE c.id IN (SELECT cust_id FROM dbo.VIP_Customers)
        AND EXISTS (SELECT 1 FROM dbo.Invoices i WHERE i.cust_id = c.id);
    `;
    const ast = parseSql(sql);

    assert.strictEqual(ast.subqueries.length, 3);
    assert.strictEqual(ast.subqueries[0].type, 'SCALAR_SUBQUERY');
    assert.strictEqual(ast.subqueries[0].isCorrelated, true);
    assert.strictEqual(ast.subqueries[1].type, 'IN');
    assert.strictEqual(ast.subqueries[2].type, 'EXISTS');
  });

  it('parses UNION and UNION ALL set operations', () => {
    const sqlUnion = 'SELECT id FROM dbo.A UNION SELECT id FROM dbo.B';
    const astUnion = parseSql(sqlUnion);
    assert.strictEqual(astUnion.unions.length, 1);
    assert.strictEqual(astUnion.unions[0].type, 'UNION');

    const sqlUnionAll = 'SELECT id FROM dbo.A UNION ALL SELECT id FROM dbo.B';
    const astUnionAll = parseSql(sqlUnionAll);
    assert.strictEqual(astUnionAll.unions.length, 1);
    assert.strictEqual(astUnionAll.unions[0].type, 'UNION ALL');
  });

  it('caches parsed queries by SHA256 and retrieves from cache on repeat calls', () => {
    const sql = 'SELECT col1 FROM dbo.CacheTestTable WHERE col1 = 123';
    assert.strictEqual(getCacheStats().cachedEntries, 0);

    const ast1 = parseSql(sql);
    assert.strictEqual(getCacheStats().cachedEntries, 1);

    const ast2 = parseSql(sql);
    assert.strictEqual(ast1, ast2, 'Should return exact cached object instance');
    assert.strictEqual(getCacheStats().cachedEntries, 1);
  });

  it('supports forceRefresh option to bypass cache', () => {
    const sql = 'SELECT col2 FROM dbo.RefreshTable';
    const ast1 = parseSql(sql);
    const ast2 = parseSql(sql, { forceRefresh: true });

    assert.notStrictEqual(ast1, ast2, 'Bypassing cache should return a new parse object');
    assert.strictEqual(ast1.tables[0].object, ast2.tables[0].object);
  });

  it('gracefully falls back to Regex Fallback adapter on malformed SQL or parser errors', () => {
    // Malformed query
    const brokenSql = 'SELECT FROM WHERE JOIN (((( @@INVALID_SYNTAX';
    const ast = parseSql(brokenSql, { fallbackToRegex: true });

    assert.ok(ast);
    assert.ok(['AST', 'REGEX_FALLBACK'].includes(ast.analysisSource));
    assert.ok(Array.isArray(ast.tables));
  });

  it('regexFallbackAdapter parses tables and projections with analysisSource: REGEX_FALLBACK', () => {
    const sql = 'SELECT id, name FROM dbo.Users WHERE active = 1';
    const fallbackAst = parseWithRegexFallback(sql, new Error('Synthetic AST test error'));

    assert.strictEqual(fallbackAst.analysisSource, 'REGEX_FALLBACK');
    assert.strictEqual(fallbackAst.status, 'AST_PARTIAL');
    assert.strictEqual(fallbackAst.parseErrors.length, 1);
    assert.strictEqual(fallbackAst.tables.length, 1);
    assert.strictEqual(fallbackAst.tables[0].object, 'Users');
    assert.strictEqual(fallbackAst.predicates.length, 1);
  });

  it('handles empty or non-string inputs safely', () => {
    const emptyAst = parseSql('');
    assert.strictEqual(emptyAst.analysisSource, 'REGEX_FALLBACK');

    const nullAst = parseSql(null);
    assert.strictEqual(nullAst.analysisSource, 'REGEX_FALLBACK');
  });

});
