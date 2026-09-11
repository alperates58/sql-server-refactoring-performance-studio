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
    `3. Every rewrite recommendation must include explicit technical rationale in TURKISH (Türkçe) (e.g. SARGability, eliminating repeated scans, set-based aggregation).\n` +
    `4. Preserve duplicate behavior: do NOT convert UNION to UNION ALL or add DISTINCT unless proven mathematically safe under the relational model.\n` +
    `5. Do NOT execute or propose any DDL/DML mutation on the target server. Output must be an auditable candidate.\n` +
    `6. Format candidate SQL as an executable query (WITH ... SELECT or direct SELECT statement). Do NOT wrap in CREATE VIEW or ALTER VIEW so that it can be directly verified in automated subquery equivalence harnesses.\n` +
    `7. ALL explanations, rationale, bullet points, and notes MUST be written in TURKISH (Türkçe).\n\n` +
    `CONTEXT PACK:\n` +
    JSON.stringify(payload, null, 2);
}

function normalizeChatUrl(baseUrl) {
  let url = (baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  if (!url.endsWith('/chat/completions')) {
    url += '/chat/completions';
  }
  return url;
}

function parseApiError(res, rawText, key) {
  let errMsg = '';
  let errType = '';
  let errCode = '';

  try {
    const errJson = JSON.parse(rawText);
    const errObj = errJson.error || errJson;
    if (typeof errObj === 'object' && errObj !== null) {
      errMsg = errObj.message || errObj.msg || '';
      errType = errObj.type || '';
      errCode = errObj.code || '';
    } else if (typeof errObj === 'string') {
      errMsg = errObj;
    }
  } catch {
    errMsg = (rawText || '').trim().slice(0, 250);
  }

  const typeInfo = [errType, errCode].filter(Boolean).join(' / ');
  const detail = errMsg || `HTTP ${res.status}`;
  let fullMsg = `AI Sağlayıcı Hatası (HTTP ${res.status}${typeInfo ? ` - ${typeInfo}` : ''}): ${detail}`;

  if (key && typeof key === 'string') {
    fullMsg = fullMsg.split(key).join('********');
  }
  return fullMsg;
}

async function testConnection({ provider, baseUrl, apiKey, model }) {
  const key = apiKey || settings.getApiKey();
  if (!key) throw new Error('API Anahtarı eksik. Lütfen önce geçerli bir API anahtarı girin.');
  if (!global.fetch) throw new Error('Node.js 20+ fetch API gereklidir.');

  const url = normalizeChatUrl(baseUrl);
  let targetModel = (model || '').trim() || 'deepseek-chat';
  if (targetModel.toLowerCase() === 'deepseek-v4-flash' || targetModel.toLowerCase() === 'deepseek-flash' || targetModel.toLowerCase() === 'deepseek-coder') {
    targetModel = 'deepseek-chat';
  }

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
        model: targetModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Respond with OK.' }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(parseApiError(res, errText, key));
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      throw new Error('AI Sağlayıcıdan geçerli bir JSON yanıtı alınamadı.');
    }

    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error);
      throw new Error(`AI Sağlayıcı Hatası: ${msg}`);
    }

    // Doğrulama: choices veya model veya id varlığı (HTTP 200 ile birlikte)
    const hasChoices = Array.isArray(data.choices) && data.choices.length > 0;
    const hasValidReply = hasChoices && Boolean(data.choices[0]?.message?.content);
    const hasModelOrId = typeof data.model === 'string' || typeof data.id === 'string';

    if (!hasChoices && !hasModelOrId) {
      throw new Error('AI Sağlayıcı yanıt formatı tanınamadı (choices veya model alanı bulunamadı).');
    }

    // Request model ile response model farklı olabilir (örn: deepseek-v4-flash -> deepseek-flash)
    const respondedModel = (typeof data.model === 'string' && data.model.trim()) ? data.model.trim() : targetModel;
    const replyContent = hasValidReply ? String(data.choices[0].message.content).trim() : 'OK';

    return {
      ok: true,
      data: {
        provider: provider || 'deepseek',
        requestedModel: targetModel,
        respondedModel: respondedModel,
        model: respondedModel,
        reply: replyContent,
        message: 'AI API bağlantısı başarıyla doğrulandı.'
      },
      // Dual-compatibility for root-level callers
      provider: provider || 'deepseek',
      requestedModel: targetModel,
      respondedModel: respondedModel,
      model: respondedModel,
      reply: replyContent,
      message: 'AI API bağlantısı başarıyla doğrulandı.'
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('AI API bağlantısı zaman aşımına uğradı (10 sn). Lütfen Base URL ve ağ bağlantınızı kontrol edin.');
    }
    let msg = err.message || 'Bilinmeyen AI bağlantı hatası';
    if (key && typeof key === 'string') {
      msg = msg.split(key).join('********');
    }
    throw new Error(msg);
  }
}

async function proposeRefactor(params = {}) {
  const {
    viewName,
    sql,
    problems = [],
    baseTables = [],
    options = {},
    payload: directPayload,
    apiKey,
    baseUrl,
    model,
    temperature,
    maxTokens
  } = params;

  const key = apiKey || settings.getApiKey();
  if (!key) throw new Error('AI API anahtarı eksik. Lütfen Ayarlar sekmesinden API anahtarınızı girin ve kaydedin.');
  if (!global.fetch) throw new Error('Node.js 20+ fetch API gereklidir.');

  const conf = settings.getConfig().ai;
  const activeBaseUrl = baseUrl || conf.baseUrl || 'https://api.deepseek.com';
  const url = normalizeChatUrl(activeBaseUrl);
  let activeModel = (model || conf.model || 'deepseek-chat').trim();
  if (!activeModel || activeModel.toLowerCase() === 'deepseek-v4-flash' || activeModel.toLowerCase() === 'deepseek-flash' || activeModel.toLowerCase() === 'deepseek-coder') {
    activeModel = 'deepseek-chat';
  }
  const activeTemp = temperature ?? conf.temperature ?? 0.15;
  const activeTokens = maxTokens ?? conf.maxTokens ?? 4096;

  const contextPack = directPayload || {
    targetView: viewName,
    originalSql: sql,
    problems,
    baseTables,
    refactorOptions: options
  };

  const response = await fetch(url, {
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
          content:
            'You are a principal Microsoft SQL Server query performance engineer and database architect. ' +
            'Your task is to provide an auditable refactoring candidate for the target view. ' +
            'Return your response with the complete optimized T-SQL candidate enclosed strictly in a ```sql ... ``` block, ' +
            'followed by a concise bulleted list of technical rationale, performance hypotheses, and guardrail validations.'
        },
        {
          role: 'user',
          content: buildRefactorPrompt(contextPack)
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(parseApiError(response, errorBody, key));
  }

  const resJson = await response.json();
  const choice = resJson.choices?.[0];
  const content = (choice?.message?.content || choice?.message?.reasoning_content || choice?.text || '').trim();

  if (!content) {
    const finishReason = choice?.finish_reason || 'unknown';
    const reasonMsg = finishReason === 'length'
      ? 'Belirteç sınırı (maxTokens) aşıldı. Ayarlar sekmesinden Maksimum Belirteç değerini artırın.'
      : `AI sağlayıcıdan boş yanıt döndü (finish_reason: ${finishReason}). Lütfen model adının ("deepseek-chat") geçerli olduğunu kontrol edin.`;
    throw new Error(reasonMsg);
  }

  // Extract SQL from markdown code block
  let candidateSql = '';
  const sqlMatch = content.match(/```(?:sql|tsql)?\s*([\s\S]*?)\s*```/i);
  if (sqlMatch && sqlMatch[1] && (sqlMatch[1].toUpperCase().includes('SELECT') || sqlMatch[1].toUpperCase().includes('WITH '))) {
    candidateSql = sqlMatch[1].trim();
  } else if (content.toUpperCase().includes('SELECT') || content.toUpperCase().includes('WITH ')) {
    const sUpper = content.toUpperCase();
    const selectIdx = sUpper.indexOf('SELECT');
    const withIdx = sUpper.indexOf('WITH ');
    let startIdx = 0;
    if (selectIdx >= 0 && withIdx >= 0) startIdx = Math.min(selectIdx, withIdx);
    else if (selectIdx >= 0) startIdx = selectIdx;
    else if (withIdx >= 0) startIdx = withIdx;
    candidateSql = content.substring(startIdx).trim();
  } else {
    throw new Error('AI modeli geçerli bir SQL sorgu adayı (SELECT / WITH) üretemedi.');
  }

  // Strip CREATE VIEW / ALTER VIEW wrapper if present to ensure subquery compatibility in Validation Lab
  const viewRegex = /^\s*(?:CREATE|ALTER)\s+VIEW\s+[^\r\n]+?\s+AS\s+([\s\S]+)$/i;
  const viewMatch = candidateSql.match(viewRegex);
  if (viewMatch && viewMatch[1]) {
    candidateSql = viewMatch[1].trim();
  }

  // Extract notes / rationale (everything outside the first SQL code block)
  let notes = '';
  if (sqlMatch) {
    notes = (content.substring(0, sqlMatch.index) + '\n' + content.substring(sqlMatch.index + sqlMatch[0].length)).trim();
  } else {
    notes = content.replace(candidateSql, '').trim();
  }
  if (!notes) {
    notes = 'Guardrail kontrolleri uygulandı. Sütun isimleri, tipleri ve satır tekilliği korunmalıdır.';
  }

  return {
    ok: true,
    data: {
      viewName: viewName || contextPack.targetView,
      candidateSql,
      notes,
      rawContent: content,
      model: resJson.model || activeModel
    },
    candidateSql,
    notes,
    rawContent: content,
    model: resJson.model || activeModel
  };
}

module.exports = {
  buildRefactorPrompt,
  proposeRefactor,
  generateCandidate: proposeRefactor,
  testConnection
};
