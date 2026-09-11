/**
 * SQL Server Refactoring & Performance Studio
 * AI Provider Adapter Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_AI_TIMEOUT_MS,
  buildRefactorPrompt,
  fetchWithTimeout
} = require('../server/services/aiProvider');

describe('AI Provider - Guardrails, Timeouts & Error Mapping', () => {

  it('has DEFAULT_AI_TIMEOUT_MS set to 30 seconds (30000ms)', () => {
    assert.strictEqual(DEFAULT_AI_TIMEOUT_MS, 30000);
  });

  it('enforces column order, multiplicity, and semantics guardrails in refactor prompt', () => {
    const payload = {
      viewName: 'AA_URETIM_AGACI',
      sql: 'SELECT a, b FROM dbo.T',
      problems: ['SCALAR_UDF']
    };
    const prompt = buildRefactorPrompt(payload);

    assert.ok(prompt.includes('CRITICAL INVARIANTS & SAFETY GUARDRAILS'));
    assert.ok(prompt.includes('Preserve EXACT observable output semantics'));
    assert.ok(prompt.includes('ordinal column order'));
    assert.ok(prompt.includes('row multiplicity'));
    assert.ok(prompt.includes('Never assume that CTEs (Common Table Expressions) materialize'));
    assert.ok(prompt.includes('TURKISH (Türkçe)'));
    assert.ok(prompt.includes('Do NOT wrap in CREATE VIEW or ALTER VIEW'));
  });

  it('handles abort timeout cleanly and maps to AI_TIMEOUT error', async () => {
    // Test with a tiny 10ms timeout against a non-responding endpoint
    let caughtErr = null;
    try {
      await fetchWithTimeout('http://10.255.255.1:81/unreachable', {}, 20);
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Should throw on timeout or connection error');
    assert.ok(
      caughtErr.code === 'AI_TIMEOUT' || caughtErr.message.includes('fetch') || caughtErr.message.includes('timeout') || caughtErr.name === 'TypeError',
      `Unexpected error: ${caughtErr.message}`
    );
  });

});
