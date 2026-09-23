/**
 * SQL Server Refactoring & Performance Studio
 * AI Provider Structured Output & Capability Unit Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getProviderCapabilities,
  buildStructuredRefactorPrompt
} = require('../server/services/aiProvider');

describe('AI Provider - Structured Refactor & Capabilities', () => {

  it('detects provider capabilities accurately', () => {
    const capsDeepSeek = getProviderCapabilities({ provider: 'deepseek', model: 'deepseek-flash' });
    assert.strictEqual(capsDeepSeek.supportsJsonSchema, true);
    assert.strictEqual(capsDeepSeek.supportsTemperature, true);
    assert.strictEqual(capsDeepSeek.recommendedTemperature, 0.05);

    const capsOpenAi = getProviderCapabilities({ provider: 'openai', model: 'gpt-4o' });
    assert.strictEqual(capsOpenAi.supportsJsonSchema, true);
    assert.strictEqual(capsOpenAi.supportsSeed, true);

    const capsAnthropic = getProviderCapabilities({ provider: 'anthropic', model: 'claude-3-5-sonnet' });
    assert.strictEqual(capsAnthropic.supportsJsonSchema, false);
  });

  it('buildStructuredRefactorPrompt enforces cosmetic ban, hypothesis, and refusal statuses', () => {
    const dummyContext = {
      target: { viewName: 'TEST_VIEW' },
      sql: { original: 'SELECT id FROM T' }
    };
    const prompt = buildStructuredRefactorPrompt(dummyContext);

    assert.ok(prompt.includes('COSMETIC REWRITE BAN (STRICT)'), 'Missing cosmetic rewrite ban');
    assert.ok(prompt.includes('NO_MEANINGFUL_REWRITE and REJECTED'), 'Missing rejection directive');
    assert.ok(prompt.includes('NO_SAFE_OPTIMIZATION_FOUND'), 'Missing NO_SAFE_OPTIMIZATION_FOUND option');
    assert.ok(prompt.includes('NEEDS_INDEX_CHANGE'), 'Missing NEEDS_INDEX_CHANGE option');
    assert.ok(prompt.includes('STRUCTURED HYPOTHESIS BEFORE SQL'), 'Missing hypothesis requirement');
    assert.ok(prompt.includes('Strict prohibition of speculative percentages'), 'Missing percentage ban');
    assert.ok(prompt.includes('"status":'), 'Missing status in schema');
    assert.ok(prompt.includes('"hypothesis":'), 'Missing hypothesis in schema');
  });

  it('buildStructuredRefactorPrompt injects previous iteration feedback pack when provided', () => {
    const dummyContext = {
      target: { viewName: 'TEST_VIEW' },
      sql: { original: 'SELECT id FROM T' }
    };
    const feedback = {
      previousStrategyId: 'SARGABLE_RANGE_REWRITE',
      readsDeltaPercent: 0,
      cpuDeltaPercent: 2,
      durationDeltaPercent: -3,
      planSummary: 'Plan operatörleri ve mantıksal okumalar değişmedi.',
      unaddressedFindings: ['F01']
    };

    const prompt = buildStructuredRefactorPrompt(dummyContext, feedback);

    assert.ok(prompt.includes('PREVIOUS ITERATION FEEDBACK (CRITICAL - DO NOT REPEAT)'));
    assert.ok(prompt.includes('SARGABLE_RANGE_REWRITE'));
    assert.ok(prompt.includes('Reads Delta: 0%'));
    assert.ok(prompt.includes('DIRECTIVE: Your previous candidate was ineffective'));
  });

});
