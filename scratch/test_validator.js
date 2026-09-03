const { validateReadOnly } = require('c:/Users/alper/Desktop/sql-server-refactoring-performance-studio/server/services/sqlValidator');

const testCases = [
  { sql: "SELECT 'DROP TABLE' AS Example", expected: true },
  { sql: "-- DELETE eski açıklama\nSELECT * FROM dbo.Table", expected: true },
  { sql: "/* DROP DATABASE test */ SELECT 1", expected: true },
  { sql: "WITH Cte AS (SELECT id FROM t) SELECT * FROM Cte", expected: true },
  { sql: "SELECT * FROM [DROP_TABLE_NAME]", expected: true },
  { sql: "DROP TABLE foo", expected: false },
  { sql: "SELECT * FROM t; DELETE FROM t", expected: false },
  { sql: "INSERT INTO t SELECT * FROM s", expected: false },
  { sql: "EXEC sp_who2", expected: false },
  { sql: "WITH Cte AS (SELECT id FROM t) DELETE FROM Cte", expected: false },
  { sql: "UPDATE dbo.STOKLAR SET sto_isim = 'test'", expected: false },
  { sql: "TRUNCATE TABLE dbo.LOGS", expected: false }
];

let failed = 0;
for (const tc of testCases) {
  const res = validateReadOnly(tc.sql);
  if (res.valid !== tc.expected) {
    console.error(`FAILED test for SQL:\n${tc.sql}\nExpected: ${tc.expected}, Got: ${res.valid}, Reason: ${res.reason}`);
    failed++;
  } else {
    console.log(`PASS: "${tc.sql.split('\n')[0].slice(0, 45)}" -> valid: ${res.valid}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} validator tests failed!`);
  process.exit(1);
} else {
  console.log('\n>>> All SQL Validator tests PASSED perfectly! <<<');
}
