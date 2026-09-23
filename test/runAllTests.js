/**
 * Master Test Runner for SQL Server Refactoring & Performance Studio
 * Executes all 15 test suites and outputs structured report
 */

const fs = require('fs');
const path = require('path');
const { run } = require('node:test');

async function runAllSuites(suiteFilter = null) {
  const testDir = __dirname;
  let files = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join(testDir, f));

  if (suiteFilter) {
    files = files.filter(f => path.basename(f).toLowerCase().includes(suiteFilter.toLowerCase()));
  }

  console.log(`[TestRunner] Running ${files.length} test suites...`);

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const failures = [];

  const stream = run({
    files,
    concurrency: false
  });

  stream.on('test:pass', (t) => {
    if (!t.name.includes('Tests')) {
      totalTests++;
      passedTests++;
    }
  });

  stream.on('test:fail', (t) => {
    totalTests++;
    failedTests++;
    failures.push({
      name: t.name,
      file: t.file,
      error: t.details?.error?.message || 'Unknown error',
      stack: t.details?.error?.stack
    });
    console.error(`  ✕ FAIL: ${t.name}`);
  });

  return new Promise((resolve) => {
    stream.on('end', () => {
      console.log('\n=============================================');
      console.log(`TEST SUMMARY:`);
      console.log(`Total:  ${totalTests}`);
      console.log(`Passed: ${passedTests}`);
      console.log(`Failed: ${failedTests}`);
      console.log('=============================================\n');

      if (failedTests > 0) {
        console.error('Failures detail:');
        failures.forEach(f => console.error(` - [${path.basename(f.file || '')}] ${f.name}: ${f.error}`));
      }

      resolve({
        ok: failedTests === 0,
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        failures
      });
    });
  });
}

if (require.main === module) {
  runAllSuites().then(res => {
    process.exit(res.ok ? 0 : 1);
  });
}

module.exports = { runAllSuites };
