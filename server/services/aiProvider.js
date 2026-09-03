const config = require('../config');

function buildRefactorPrompt(payload) {
  return `You are a senior Microsoft SQL Server performance engineer.\n\n` +
    `Goal: refactor the target view while preserving EXACT output semantics, column order, data types, NULL behavior, row multiplicity and filters.\n` +
    `Never assume that a CTE is materialized. Reduce repeated base-table access only when logically valid. Prefer SARGable predicates and set-based aggregation.\n` +
    `Do not deploy anything. Return an auditable candidate plus explanation, risks, validation queries, and index suggestions.\n\n` +
    JSON.stringify(payload, null, 2);
}

async function proposeRefactor({ apiKey, payload, provider = config.ai.provider, baseUrl = config.ai.baseUrl, model = config.ai.model }) {
  if (!apiKey) throw new Error('AI API key is required.');
  if (!global.fetch) throw new Error('Node.js 20+ is required for fetch().');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'Return structured, conservative SQL Server refactoring guidance. Never claim equivalence without validation.' },
        { role: 'user', content: buildRefactorPrompt(payload) }
      ]
    })
  });
  if (!response.ok) throw new Error(`AI provider error: HTTP ${response.status}`);
  return response.json();
}

module.exports = { buildRefactorPrompt, proposeRefactor };
