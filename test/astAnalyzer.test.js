/**
 * SQL Server Refactoring & Performance Studio
 * AST Analyzer & SARGability Engine Unit Tests (Sprint 4)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSql } = require('../server/services/ast/astParser');
const {
  analyzeAst,
  analyzeSargability,
  analyzeJoins,
  analyzeCtes,
  analyzeSubqueries,
  analyzeProjections,
  analyzeUnions,
  analyzeWindowFunctions
} = require('../server/services/ast/astAnalyzer');

describe('AST Analyzer & SARGability Engine', () => {

  it('detects NON_SARGABLE_DATE_FUNCTION with actionable rewriteHint', () => {
    const sql = 'SELECT id FROM dbo.Orders WHERE YEAR(order_date) = 2026';
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const sarg = findings.find(f => f.code === 'NON_SARGABLE_DATE_FUNCTION');
    assert.ok(sarg, 'Should flag YEAR(order_date) as non-SARGable');
    assert.strictEqual(sarg.severity, 'HIGH');
    assert.strictEqual(sarg.source, 'AST');
    assert.ok(sarg.rewriteHint.includes('>=') && sarg.rewriteHint.includes('<'), 'Rewrite hint should suggest date range comparison');
  });

  it('detects NON_SARGABLE_TYPE_CONVERSION on filtered columns', () => {
    const sql = "SELECT id FROM dbo.Orders WHERE CONVERT(varchar, order_date, 112) = '20260101'";
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const conv = findings.find(f => f.code === 'NON_SARGABLE_TYPE_CONVERSION');
    assert.ok(conv, 'Should flag CONVERT on order_date');
    assert.strictEqual(conv.severity, 'HIGH');
  });

  it('detects NON_SARGABLE_NULL_WRAPPING wrapper on predicates', () => {
    const sql = 'SELECT id FROM dbo.Orders WHERE ISNULL(discount_rate, 0) > 0.05';
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const isnullFinding = findings.find(f => f.code === 'NON_SARGABLE_NULL_WRAPPING');
    assert.ok(isnullFinding, 'Should flag ISNULL wrapper');
    assert.ok(isnullFinding.rewriteHint.includes('OR'), 'Rewrite hint should suggest OR condition');
  });

  it('detects NON_SARGABLE_STRING_FUNCTION (UPPER/LOWER) on filtered columns', () => {
    const sql = "SELECT id FROM dbo.Users WHERE UPPER(username) = 'ADMIN'";
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const upperFinding = findings.find(f => f.code === 'NON_SARGABLE_STRING_FUNCTION');
    assert.ok(upperFinding, 'Should flag UPPER(username)');
  });

  it('detects LEADING_WILDCARD_LIKE on LIKE expressions', () => {
    const sql = "SELECT id FROM dbo.Products WHERE product_code LIKE '%ABC'";
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const wildcard = findings.find(f => f.code === 'LEADING_WILDCARD_LIKE');
    assert.ok(wildcard, 'Should flag leading % wildcard');
    assert.strictEqual(wildcard.severity, 'MEDIUM');
  });

  it('detects NON_SARGABLE_ARITHMETIC on column operations in WHERE', () => {
    const sql = 'SELECT id FROM dbo.Accounts WHERE balance + 100 < 500';
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const arith = findings.find(f => f.code === 'NON_SARGABLE_ARITHMETIC');
    assert.ok(arith, 'Should flag balance + 100 arithmetic');
  });

  it('INVARIANTS: does NOT flag SARGable date ranges, prefix LIKE, or standard equality', () => {
    const sql = `
      SELECT id, name 
      FROM dbo.Orders 
      WHERE order_date >= '2026-01-01' 
        AND order_date < '2027-01-01'
        AND status_code = 1
        AND name LIKE 'PRE_%'
        AND total_amount BETWEEN 100 AND 500;
    `;
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const nonSargCodes = [
      'NON_SARGABLE_DATE_FUNCTION',
      'NON_SARGABLE_TYPE_CONVERSION',
      'NON_SARGABLE_NULL_WRAPPING',
      'NON_SARGABLE_STRING_FUNCTION',
      'LEADING_WILDCARD_LIKE',
      'NON_SARGABLE_ARITHMETIC'
    ];

    const violations = findings.filter(f => nonSargCodes.includes(f.code));
    assert.strictEqual(violations.length, 0, 'SARGable predicates must NOT be flagged as non-SARGable');
  });

  it('detects NO_JOIN_PREDICATE (Cartesian Product risk)', () => {
    const sql = `
      SELECT o.id, c.name 
      FROM dbo.Orders o 
      CROSS JOIN dbo.Customers c;
    `;
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const cartesian = findings.find(f => f.code === 'NO_JOIN_PREDICATE');
    assert.ok(cartesian, 'Should flag Cartesian Product risk for CROSS JOIN');
    assert.strictEqual(cartesian.severity, 'CRITICAL');
  });

  it('detects FUNCTION_ON_JOIN_COLUMN when functions are applied to join keys', () => {
    const sql = `
      SELECT a.id, b.name
      FROM dbo.TableA a
      INNER JOIN dbo.TableB b ON UPPER(a.code) = UPPER(b.code);
    `;
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const joinFunc = findings.find(f => f.code === 'FUNCTION_ON_JOIN_COLUMN');
    assert.ok(joinFunc, 'Should flag function calls on join predicate columns');
  });

  it('detects REPEATED_CTE_REFERENCE without claiming automatic CTE materialization', () => {
    const sql = `
      WITH SummarizedSales AS (
        SELECT store_id, SUM(amount) AS total_sales
        FROM dbo.Sales
        GROUP BY store_id
      )
      SELECT a.store_id, a.total_sales, b.total_sales AS target_sales
      FROM SummarizedSales a
      INNER JOIN SummarizedSales b ON a.store_id = b.store_id + 1;
    `;
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const repeatedCte = findings.find(f => f.code === 'REPEATED_CTE_REFERENCE');
    assert.ok(repeatedCte, 'Should flag multiple CTE references');
    assert.ok(repeatedCte.explanation.includes('materialize etmez'), 'Explanation must state SQL Server inlines CTEs without materialization');
  });

  it('detects RECURSIVE_CTE for recursive CTEs', () => {
    const sql = `
      WITH RecTree AS (
        SELECT id, parent_id FROM dbo.Categories WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, c.parent_id FROM dbo.Categories c INNER JOIN RecTree r ON c.parent_id = r.id
      )
      SELECT * FROM RecTree;
    `;
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const recFinding = findings.find(f => f.code === 'RECURSIVE_CTE');
    assert.ok(recFinding, 'Should flag recursive CTE risk');
  });

  it('detects CORRELATED_SCALAR_SUBQUERY and IN_SUBQUERY_DETECTED', () => {
    const sql = `
      SELECT 
        c.id,
        (SELECT COUNT(*) FROM dbo.Orders o WHERE o.cust_id = c.id) AS order_cnt
      FROM dbo.Customers c
      WHERE c.id NOT IN (SELECT cust_id FROM dbo.BlockedCustomers);
    `;
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const scalar = findings.find(f => f.code === 'CORRELATED_SCALAR_SUBQUERY');
    assert.ok(scalar, 'Should flag correlated scalar subquery');

    const inSub = findings.find(f => f.code === 'IN_SUBQUERY_DETECTED');
    assert.ok(inSub, 'Should flag IN/NOT IN subquery');
    assert.ok(inSub.rewriteHint.includes('NOT EXISTS'), 'Should suggest NOT EXISTS as rewrite');
  });

  it('flags SELECT_STAR_RISK for SELECT * but ignores COUNT(*)', () => {
    const sqlStar = 'SELECT * FROM dbo.Employees';
    const astStar = parseSql(sqlStar);
    const resStar = analyzeAst(astStar);
    const starFinding = resStar.findings.find(f => f.code === 'SELECT_STAR_RISK');
    assert.ok(starFinding, 'Should flag SELECT * contract risk');

    const sqlCount = 'SELECT COUNT(*) AS total_recs FROM dbo.Employees';
    const astCount = parseSql(sqlCount);
    const resCount = analyzeAst(astCount);
    const starCountFinding = resCount.findings.find(f => f.code === 'SELECT_STAR_RISK');
    assert.strictEqual(starCountFinding, undefined, 'COUNT(*) should never be flagged as wildcard contract risk');
  });

  it('flags UNION_DISTINCT_OVERHEAD for UNION but not for UNION ALL', () => {
    const sqlUnion = 'SELECT id FROM dbo.A UNION SELECT id FROM dbo.B';
    const resUnion = analyzeAst(parseSql(sqlUnion));
    const unionFinding = resUnion.findings.find(f => f.code === 'UNION_DISTINCT_OVERHEAD');
    assert.ok(unionFinding, 'Should flag UNION distinct overhead');

    const sqlUnionAll = 'SELECT id FROM dbo.A UNION ALL SELECT id FROM dbo.B';
    const resUnionAll = analyzeAst(parseSql(sqlUnionAll));
    const unionAllFinding = resUnionAll.findings.find(f => f.code === 'UNION_DISTINCT_OVERHEAD');
    assert.strictEqual(unionAllFinding, undefined, 'UNION ALL should not produce overhead finding');
  });

  it('flags WINDOW_FUNCTION_DETECTED when window functions are used', () => {
    const sql = 'SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM dbo.Data';
    const ast = parseSql(sql);
    const { findings } = analyzeAst(ast);

    const wf = findings.find(f => f.code === 'WINDOW_FUNCTION_DETECTED');
    assert.ok(wf, 'Should flag window function presence');
    assert.strictEqual(wf.severity, 'INFO');
  });

});
