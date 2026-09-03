/**
 * AI Provider Adapter
 * Supports DeepSeek, OpenAI, Anthropic, and OpenAI-Compatible Custom Endpoints.
 * Guardrails enforce conservative SQL refactoring without automatic mutation.
 */

const settings = require('./settingsService');

function buildRefactorPrompt(payload) {
  return `You are a principal Microsoft SQL Server query performance engineer and database architect.\n\n` +
    `CRITICAL INVARIANTS & SAFETY GUARDRAILS:\n` +
    `1. Preserve EXACT observable output semantics: column count, ordinal column order, column names, SQL data types, nullability, row multiplicity, and filter predicates.\n` +
    `2. Never assume that CTEs (Common Table Expressions) materialize. SQL Server optimizer inlines CTE definitions unless proven otherwise.\n` +
    `3. Every rewrite recommendation must include explicit technical rationale (e.g. SARGability, eliminating repeated scans, set-based aggregation).\n` +
    `4. Preserve duplicate behavior: do NOT convert UNION to UNION ALL or add DISTINCT unless proven mathematically safe under the relational model.\n` +
    `5. Do NOT execute or propose any DDL/DML mutation on the target server. Output must be an auditable candidate.\n\n` +
    `CONTEXT PACK:\n` +
    JSON.stringify(payload, null, 2);
}

async function testConnection({ provider, baseUrl, apiKey, model }) {
  const key = apiKey || settings.getApiKey();
  if (!key) throw new Error('API Anahtarı eksik. Lütfen önce geçerli bir API anahtarı girin.');
  if (!global.fetch) throw new Error('Node.js 20+ fetch API gereklidir.');

  const endpoint = (baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const url = `${endpoint}/chat/completions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: model || 'deepseek-coder',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Respond with OK.' }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`AI Sağlayıcı yanıt vermedi: HTTP ${res.status} (${errText.slice(0, 120)})`);
    }

    const data = await res.json();
    return {
      ok: true,
      provider: provider || 'deepseek',
      model: model || 'deepseek-coder',
      message: 'AI API bağlantısı doğrulandı.'
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('AI API bağlantısı zaman aşımına uğradı (10 sn).');
    }
    throw err;
  }
}

async function proposeRefactor({ apiKey, payload, provider, baseUrl, model, temperature, maxTokens }) {
  const key = apiKey || settings.getApiKey();
  if (!key) throw new Error('AI API key is required.');
  if (!global.fetch) throw new Error('Node.js 20+ is required for fetch().');

  const conf = settings.getConfig().ai;
  const activeBaseUrl = (baseUrl || conf.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const activeModel = model || conf.model || 'deepseek-coder';
  const activeTemp = temperature ?? conf.temperature ?? 0.15;
  const activeTokens = maxTokens ?? conf.maxTokens ?? 4096;

  const response = await fetch(`${activeBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: activeModel,
      temperature: activeTemp,
      max_tokens: activeTokens,
      messages: [
        {
          role: 'system',
          content: 'You are an auditable SQL Server refactoring advisor. Return structured, conservative SQL guidance with exact semantic preservation.'
        },
        {
          role: 'user',
          content: buildRefactorPrompt(payload)
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`AI provider error: HTTP ${response.status} - ${errorBody.slice(0, 150)}`);
  }

  return response.json();
}

module.exports = {
  buildRefactorPrompt,
  proposeRefactor,
  testConnection
};
