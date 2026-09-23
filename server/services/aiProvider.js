/**
 * AI Provider Adapter
 * Supports DeepSeek, OpenAI, Anthropic, and OpenAI-Compatible Custom Endpoints.
 * Guardrails enforce conservative SQL refactoring without automatic mutation.
 */

const settings = require('./settingsService');

const DEFAULT_AI_TIMEOUT_MS = 30000; // 30s default timeout

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const sec = Math.round(timeoutMs / 1000);
      const timeoutErr = new Error(`AI_TIMEOUT: AI servisi ${sec} saniye içinde yanıt vermedi. Lütfen model seçiminizi veya ağ bağlantınızı kontrol edin.`);
      timeoutErr.code = 'AI_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  }
}

function estimateAndPruneTokenBudget(pack, maxChars = 24000) {
  if (!pack || typeof pack !== 'object') return pack;
  const jsonStr = JSON.stringify(pack);
  if (jsonStr.length <= maxChars) {
    return pack;
  }

  // Deep clone to prune safely without mutating original
  try {
    const pruned = JSON.parse(jsonStr);

    // Priority 7: Trim subqueries & secondary CTE details
    if (pruned.ast && Array.isArray(pruned.ast.subqueries) && pruned.ast.subqueries.length > 3) {
      pruned.ast.subqueries = pruned.ast.subqueries.slice(0, 3);
    }
    if (JSON.stringify(pruned).length <= maxChars) return pruned;

    // Priority 6: Truncate runtime queries
    if (pruned.runtime && Array.isArray(pruned.runtime.queries) && pruned.runtime.queries.length > 3) {
      pruned.runtime.queries = pruned.runtime.queries.slice(0, 3);
    }
    if (JSON.stringify(pruned).length <= maxChars) return pruned;

    // Priority 5: Compact schema representation
    if (pruned.schema && typeof pruned.schema === 'object') {
      const compactSchema = {};
      for (const [tbl, s] of Object.entries(pruned.schema)) {
        compactSchema[tbl] = (s.columns || []).map(c => `${c.name} (${c.dataType})`);
      }
      pruned.schema = compactSchema;
    }
    if (JSON.stringify(pruned).length <= maxChars) return pruned;

    // Priority 4: Limit indexes to top 5
    if (pruned.indexes && typeof pruned.indexes === 'object') {
      const compactIndexes = {};
      for (const [tbl, idxList] of Object.entries(pruned.indexes)) {
        compactIndexes[tbl] = (idxList || []).slice(0, 5).map(i => ({
          name: i.name,
          keys: i.keyColumns || i.keys,
          includes: (i.includedColumns || i.includes || []).slice(0, 5)
        }));
      }
      pruned.indexes = compactIndexes;
    }
    if (JSON.stringify(pruned).length <= maxChars) return pruned;

    // Priority 3: Limit AST predicates to top 15
    if (pruned.ast && Array.isArray(pruned.ast.predicates) && pruned.ast.predicates.length > 15) {
      pruned.ast.predicates = pruned.ast.predicates.slice(0, 15);
    }

    // Priority 1 & 2 (SQL, Semantic Constraints, Plan Warnings) are NEVER pruned!
    return pruned;
  } catch (_) {
    return pack;
  }
}

function buildRefactorPrompt(payload) {
  return `You are a principal Microsoft SQL Server query performance engineer and database architect.\n\n` +
    `CRITICAL INVARIANTS & SAFETY GUARDRAILS:\n` +
    `1. Preserve EXACT observable output semantics: column count, ordinal column order, column names, SQL data types, nullability, row multiplicity, and filter predicates.\n` +
    `2. Never assume that CTEs (Common Table Expressions) materialize. SQL Server optimizer inlines CTE definitions unless proven otherwise.\n` +
    `3. Every rewrite recommendation must include explicit technical rationale in TURKISH (Türkçe) (e.g. SARGability, eliminating repeated scans, set-based aggregation).\n` +
    `4. Preserve duplicate behavior: do NOT convert UNION to UNION ALL or add DISTINCT unless proven mathematically safe under the relational model.\n` +
    `5. Do NOT execute or propose any DDL/DML mutation on the target server. Output must be an auditable candidate.\n` +
    `6. Format candidate SQL as an executable query (WITH ... SELECT or direct SELECT statement). Do NOT wrap in CREATE VIEW or ALTER VIEW so that it can be directly verified in automated subquery equivalence harnesses.\n` +
    `7. ALL explanations, rationale, bullet points, and notes MUST be written in TURKISH (Türkçe).\n` +
    `8. PERFORMANCE CLAIMS GUARDRAIL (STRICT): Asla kanıtsız ve abartılı performans iddialarında bulunma (örn: "%80 daha hızlı çalışacak", "10x hızlanacak" gibi uydurma yüzdeler YASAKTIR). T-SQL motorunun gerçek çalışma süresi donanıma, I/O durumuna ve veri hacmine bağlıdır. Yüzde uydurmak yerine somut mühendislik hipotezi sun (örn: "Index Seek dönüşümü ve scalar fonksiyonun kaldırılması ile Logical Reads ve CPU tüketiminin belirgin biçimde azalması beklenmektedir; net kazanım Validation Lab benchmark ve plan karşılaştırması ile ölçülmelidir").\n` +
    `9. EVIDENCE-DRIVEN REFACTORING (V2): Review all provided multi-layer evidence: AST structural findings (non-SARGable functions, join cartesian risks), SCHEMA metadata (column datatypes, nullability), EXISTING INDEXES (coverage status), and EXECUTION PLAN / RUNTIME warnings. Ground every optimization in this evidence.\n` +
    `10. INDEX ADVICE GUARDRAIL: Do not suggest creating indexes that already exist in the provided existing indexes list. Distinctly label any new indexing suggestion as a hypothesis requiring DBA review.\n` +
    `11. SARGABILITY & RANGE REFACTORING GUARDRAIL (STRICT): When converting a non-SARGable expression like CAST(DateCol AS DATE) = [expression] into a SARGable range predicate (DateCol >= StartDate AND DateCol < EndDate): ` +
    `NEVER duplicate a complex expression or CASE WHEN block twice in the WHERE clause! Duplicating non-trivial expressions in WHERE conditions causes SQL Server Query Optimizer to misestimate cardinality, abandon index seeks, and cause severe table scan / logical read regressions. ` +
    `INSTEAD, pre-calculate the scalar boundary ONCE using a single-row CTE (e.g. WITH TargetDate AS (SELECT ... AS Dt)) or CROSS APPLY (SELECT ... AS Dt) and reference that single evaluated column in the range comparison (e.g. DateCol >= CAST(Dt AS DATETIME) AND DateCol < DATEADD(DAY, 1, CAST(Dt AS DATETIME))).\n` +
    `12. AVOID REDUNDANT EXPRESSION EXPANSION: Keep WHERE clauses concise and index-friendly. Avoid repeating non-deterministic or volatile function calls (like multiple GETDATE() or nested DATEADDs) across filter branches.\n\n` +
    `CONTEXT PACK:\n` +
    JSON.stringify(payload, null, 2);
}

function getProviderCapabilities({ provider, model } = {}) {
  const p = (provider || 'deepseek').toLowerCase();
  const m = (model || '').toLowerCase();
  const isDeepSeek = p.includes('deepseek') || m.includes('deepseek');
  const isOpenAi = p.includes('openai') || m.includes('gpt');
  const isAnthropic = p.includes('anthropic') || m.includes('claude');

  return {
    provider: p,
    model: m,
    supportsJsonSchema: isDeepSeek || isOpenAi,
    supportsTemperature: !isAnthropic,
    supportsSeed: isOpenAi,
    recommendedTemperature: 0.05
  };
}

function buildStructuredRefactorPrompt(contextPack, iterationFeedback = null) {
  let prompt = `You are a principal Microsoft SQL Server query performance engineer and database architect.\n\n` +
    `CRITICAL INVARIANTS & SAFETY GUARDRAILS:\n` +
    `1. Preserve EXACT observable output semantics: column count, ordinal column order, column names, SQL data types, nullability, row multiplicity, and filter predicates.\n` +
    `2. Never assume that CTEs materialize. SQL Server optimizer inlines CTE definitions unless proven otherwise.\n` +
    `3. Every rewrite recommendation must include explicit technical rationale in TURKISH (Türkçe).\n` +
    `4. COSMETIC REWRITE BAN (STRICT): Renaming aliases, reformatting SQL, changing indentation, renaming CTEs, or moving expressions without relational algebraic effect is STRICTLY FORBIDDEN and will be flagged as NO_MEANINGFUL_REWRITE and REJECTED.\n` +
    `5. FIRST-CLASS REFUSAL STATUSES: You do NOT have to generate candidate SQL on every request! If no safe structural optimization exists, return status "NO_SAFE_OPTIMIZATION_FOUND". If the query is already SARGable and the bottleneck is an unindexed table, return status "NEEDS_INDEX_CHANGE".\n` +
    `6. STRUCTURED HYPOTHESIS BEFORE SQL: Formulate a concrete hypothesis identifying the exact bottleneck, root cause, proposed change, and target metric (logical_reads, cpu, duration, plan_shape).\n` +
    `7. PERFORMANCE CLAIMS GUARDRAIL: Strict prohibition of speculative percentages (e.g. "%80 daha hızlı" is FORBIDDEN). Only specify expectedMetric.\n` +
    `8. Do NOT wrap output in CREATE VIEW or ALTER VIEW. Format as executable query (WITH ... SELECT or SELECT ...).\n\n`;

  if (iterationFeedback) {
    prompt += `PREVIOUS ITERATION FEEDBACK (CRITICAL - DO NOT REPEAT):\n` +
      `Previous Strategy: ${iterationFeedback.previousStrategyId || 'UNKNOWN'}\n` +
      `Measured Results: Reads Delta: ${iterationFeedback.readsDeltaPercent ?? 'N/A'}%, CPU Delta: ${iterationFeedback.cpuDeltaPercent ?? 'N/A'}%, Duration Delta: ${iterationFeedback.durationDeltaPercent ?? 'N/A'}%\n` +
      `Plan Result: ${iterationFeedback.planSummary || 'Yürütme planı değişmedi, aynı tarama operatörleri korundu.'}\n` +
      `Unaddressed Findings: ${(iterationFeedback.unaddressedFindings || []).join(', ') || 'Yok'}\n` +
      `DIRECTIVE: Your previous candidate was ineffective and produced an identical execution plan. Do NOT repeat strategy ${iterationFeedback.previousStrategyId || 'previous approach'}. Formulate a fundamentally different structural hypothesis, or if SQL rewrite cannot resolve this, return status "NEEDS_INDEX_CHANGE" or "NO_SAFE_OPTIMIZATION_FOUND".\n\n`;
  }

  prompt += `RESPONSE FORMAT (MANDATORY JSON):\n` +
    `You must respond with a single valid JSON object strictly matching this schema:\n` +
    `{\n` +
    `  "status": "CANDIDATE_GENERATED | NO_SAFE_OPTIMIZATION_FOUND | NEEDS_INDEX_CHANGE | NEEDS_STATISTICS_ATTENTION | INSUFFICIENT_EVIDENCE",\n` +
    `  "strategyId": "STRING_IDENTIFIER_OF_STRATEGY (e.g. SARGABLE_RANGE_REWRITE, PRE_AGGREGATE_CTE, APPLY_TO_JOIN)",\n` +
    `  "hypothesis": {\n` +
    `    "bottlenecks": [\n` +
    `      {\n` +
    `        "findingId": "F01",\n` +
    `        "evidence": "Clustered Index Scan on Table",\n` +
    `        "cause": "Function wrapping column",\n` +
    `        "proposedChange": "Rewrite to range predicate",\n` +
    `        "expectedMetric": "logical_reads | cpu | duration | plan_shape"\n` +
    `      }\n` +
    `    ]\n` +
    `  },\n` +
    `  "candidateSql": "The complete executable T-SQL query (null if status is not CANDIDATE_GENERATED)",\n` +
    `  "changes": [\n` +
    `    {\n` +
    `      "findingId": "F01",\n` +
    `      "changeId": "C01",\n` +
    `      "description": "Explanation in Turkish"\n` +
    `    }\n` +
    `  ],\n` +
    `  "addressedFindings": ["F01"],\n` +
    `  "unaddressedFindings": [],\n` +
    `  "risks": [],\n` +
    `  "explanation": "Summary of decision in Turkish"\n` +
    `}\n\n` +
    `CONTEXT PACK:\n` +
    JSON.stringify(contextPack, null, 2);

  return prompt;
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
  let targetModel = (model || '').trim() || 'deepseek-flash';
  if (targetModel.toLowerCase() === 'deepseek-v4-flash' || targetModel.toLowerCase() === 'deepseek-coder') {
    targetModel = 'deepseek-flash';
  }

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: targetModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Respond with OK.' }]
      })
    }, 10000);

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
    astContext = null,
    schemaContext = null,
    indexContext = null,
    runtimeContext = null,
    planContext = null,
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
  let activeModel = (model || conf.model || 'deepseek-flash').trim();
  if (!activeModel || activeModel.toLowerCase() === 'deepseek-v4-flash' || activeModel.toLowerCase() === 'deepseek-coder') {
    activeModel = 'deepseek-flash';
  }
  const activeTemp = temperature ?? conf.temperature ?? 0.15;
  const activeTokens = maxTokens ?? conf.maxTokens ?? 4096;

  const rawContextPack = directPayload || {
    target: {
      viewName,
      database: params.database || null
    },
    sql: {
      original: sql,
      lineCount: (sql || '').split('\n').length
    },
    ast: astContext,
    schema: schemaContext,
    indexes: indexContext,
    runtime: runtimeContext,
    plan: planContext,
    problems,
    baseTables,
    refactorOptions: options
  };

  const contextPack = estimateAndPruneTokenBudget(rawContextPack);

  const response = await fetchWithTimeout(url, {
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
  }, DEFAULT_AI_TIMEOUT_MS);

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

function extractJsonPayload(content = '') {
  let clean = (content || '').trim();
  const jsonBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    clean = jsonBlockMatch[1].trim();
  } else {
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1).trim();
    }
  }
  return JSON.parse(clean);
}

async function proposeStructuredRefactor(params = {}) {
  const {
    contextPack,
    iterationFeedback = null,
    apiKey,
    baseUrl,
    model,
    temperature,
    maxTokens
  } = params;

  if (!contextPack) throw new Error('contextPack parametresi zorunludur.');

  const key = apiKey || settings.getApiKey();
  if (!key) throw new Error('AI API anahtarı eksik. Lütfen Ayarlar sekmesinden API anahtarınızı girin ve kaydedin.');
  if (!global.fetch) throw new Error('Node.js 20+ fetch API gereklidir.');

  const conf = settings.getConfig().ai;
  const activeBaseUrl = baseUrl || conf.baseUrl || 'https://api.deepseek.com';
  const url = normalizeChatUrl(activeBaseUrl);
  let activeModel = (model || conf.model || 'deepseek-flash').trim();
  if (!activeModel || activeModel.toLowerCase() === 'deepseek-v4-flash' || activeModel.toLowerCase() === 'deepseek-coder') {
    activeModel = 'deepseek-flash';
  }

  const capabilities = getProviderCapabilities({ provider: conf.provider, model: activeModel });
  const activeTemp = capabilities.supportsTemperature
    ? (temperature ?? capabilities.recommendedTemperature)
    : undefined;
  const activeTokens = maxTokens ?? conf.maxTokens ?? 4096;

  const promptContent = buildStructuredRefactorPrompt(contextPack, iterationFeedback);

  const requestBody = {
    model: activeModel,
    max_tokens: activeTokens,
    messages: [
      {
        role: 'system',
        content: 'You are a principal Microsoft SQL Server performance architect. You always respond strictly with a single valid JSON object following the required schema.'
      },
      {
        role: 'user',
        content: promptContent
      }
    ]
  };

  if (activeTemp !== undefined) {
    requestBody.temperature = activeTemp;
  }
  if (capabilities.supportsJsonSchema) {
    requestBody.response_format = { type: 'json_object' };
  }

  let response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(requestBody)
  }, DEFAULT_AI_TIMEOUT_MS);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(parseApiError(response, errorBody, key));
  }

  const resJson = await response.json();
  const choice = resJson.choices?.[0];
  const rawContent = (choice?.message?.content || choice?.message?.reasoning_content || choice?.text || '').trim();

  let parsed = null;
  try {
    parsed = extractJsonPayload(rawContent);
  } catch (parseErr) {
    // Controlled 1-attempt repair retry
    try {
      const repairRes = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: activeModel,
          max_tokens: 2048,
          messages: [
            {
              role: 'system',
              content: 'Fix the following invalid JSON string and output ONLY a single valid JSON object with no explanations or markdown wrapping.'
            },
            {
              role: 'user',
              content: rawContent.slice(0, 4000)
            }
          ]
        })
      }, 10000);

      if (repairRes.ok) {
        const repairJson = await repairRes.json();
        const repairedText = repairJson.choices?.[0]?.message?.content || '';
        parsed = extractJsonPayload(repairedText);
      }
    } catch (_) {}
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      status: 'AI_RESPONSE_INVALID',
      error: 'AI geçerli bir JSON yanıtı döndüremedi.',
      rawContent
    };
  }

  // Normalize candidate SQL
  let candidateSql = parsed.candidateSql ? String(parsed.candidateSql).trim() : null;
  if (candidateSql) {
    const viewRegex = /^\s*(?:CREATE|ALTER)\s+VIEW\s+[^\r\n]+?\s+AS\s+([\s\S]+)$/i;
    const viewMatch = candidateSql.match(viewRegex);
    if (viewMatch && viewMatch[1]) {
      candidateSql = viewMatch[1].trim();
    }
  }

  const validStatuses = [
    'CANDIDATE_GENERATED',
    'NO_SAFE_OPTIMIZATION_FOUND',
    'NEEDS_INDEX_CHANGE',
    'NEEDS_STATISTICS_ATTENTION',
    'INSUFFICIENT_EVIDENCE'
  ];

  const status = validStatuses.includes(parsed.status) ? parsed.status : (candidateSql ? 'CANDIDATE_GENERATED' : 'INSUFFICIENT_EVIDENCE');

  return {
    ok: true,
    status,
    strategyId: parsed.strategyId || 'GENERAL_REWRITE',
    hypothesis: parsed.hypothesis || null,
    candidateSql,
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    addressedFindings: Array.isArray(parsed.addressedFindings) ? parsed.addressedFindings : [],
    unaddressedFindings: Array.isArray(parsed.unaddressedFindings) ? parsed.unaddressedFindings : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    explanation: parsed.explanation || '',
    model: resJson.model || activeModel,
    rawContent
  };
}

function buildAnalyzePrompt(payload) {
  return `You are a principal Microsoft SQL Server performance architect and query tuning specialist.\n\n` +
    `YOUR MISSION:\n` +
    `Analyze the provided SQL Server view query and context. Provide an in-depth, rigorous, and completely honest diagnostic analysis in TURKISH (Türkçe).\n\n` +
    `CRITICAL INSTRUCTIONS:\n` +
    `1. Language MUST be 100% TURKISH (Türkçe).\n` +
    `2. Structure your response in clear, highly readable markdown with bullet points and bold highlights.\n` +
    `3. Address the following key areas clearly with dedicated headers:\n` +
    `   ### 🚨 Neden Yavaş Çalışıyor? (Temel Performans Darboğazları)\n` +
    `   - Point out RBAR (Row-By-Agonizing-Row) patterns, user-defined scalar functions (dbo.fn_*), implicit data type conversions, correlated subqueries, or cartesian join hazards.\n` +
    `   ### 🔄 Mükerrer Tablo Taramaları & Mantıksal Okuma (I/O) Baskısı\n` +
    `   - Identify repeated table scans (e.g. accessing large tables multiple times across joins/subqueries), CTE inlining behavior, and lack of set-based aggregation.\n` +
    `   ### 📉 İndeksleme & SARGability Sorunları\n` +
    `   - Mention non-SARGable WHERE/JOIN predicates (functions on columns, calculations) that prevent index seeks and force table/clustered index scans.\n` +
    `   ### 💡 Somut İyileştirme ve Refaktör Stratejisi\n` +
    `   - Explain bullet by bullet what architectural changes would yield 70%+ I/O and CPU savings.\n\n` +
    `TARGET VIEW CONTEXT:\n` +
    JSON.stringify(payload, null, 2);
}

async function analyzeQuery(params = {}) {
  const {
    viewName,
    sql,
    problems = [],
    baseTables = [],
    options = {},
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
  let activeModel = (model || conf.model || 'deepseek-flash').trim();
  if (!activeModel || activeModel.toLowerCase() === 'deepseek-v4-flash' || activeModel.toLowerCase() === 'deepseek-coder') {
    activeModel = 'deepseek-flash';
  }
  const activeTemp = temperature ?? conf.temperature ?? 0.2;
  const activeTokens = maxTokens ?? conf.maxTokens ?? 4096;

  const contextPack = {
    targetView: viewName,
    originalSql: sql,
    problems,
    baseTables,
    options
  };

  const response = await fetchWithTimeout(url, {
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
            'Provide a rigorous, actionable diagnostic analysis in TURKISH (Türkçe) explaining why the given SQL Server query suffers from performance degradation and logical I/O pressure.'
        },
        {
          role: 'user',
          content: buildAnalyzePrompt(contextPack)
        }
      ]
    })
  }, DEFAULT_AI_TIMEOUT_MS);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(parseApiError(response, errorBody, key));
  }

  const resJson = await response.json();
  const choice = resJson.choices?.[0];
  const content = (choice?.message?.content || choice?.message?.reasoning_content || choice?.text || '').trim();

  if (!content) {
    throw new Error('AI sağlayıcıdan analiz yanıtı alınamadı.');
  }

  return {
    ok: true,
    data: {
      viewName,
      analysis: content,
      model: resJson.model || activeModel
    },
    analysis: content,
    model: resJson.model || activeModel
  };
}

function buildDeepAnalyzePrompt(payload) {
  return `You are a world-class Microsoft SQL Server Principal Performance Architect & Query Tuning Specialist.\n\n` +
    `YOUR MISSION:\n` +
    `Perform a deep-dive, multi-level hierarchical performance analysis of the given SQL query in TURKISH (Türkçe).\n` +
    `Drill down recursively: from the Outer Query -> Subqueries/CTEs -> Scalar UDFs/Dependent Objects -> Base Tables/Indexes.\n\n` +
    `CRITICAL INSTRUCTIONS:\n` +
    `1. Language MUST be 100% TURKISH (Türkçe).\n` +
    `2. Expose your step-by-step THINKING PROCESS (Chain of Thought) at each layer so the user sees what you are inspecting in real-time.\n` +
    `3. Structure your response in clear, beautifully formatted markdown with the following required sections:\n\n` +
    `### 🧠 Canlı Analiz & Düşünce Süreci (Katman Katman İnceleme)\n` +
    `- **1. Katman (Dış Sorgu & Projeksiyon):** [Analyze outer SELECT, DISTINCT, GROUP BY, TOP, projection width, memory grant risks]\n` +
    `- **2. Katman (İç Alt Sorgular & CTE Blokları):** [Analyze nested subqueries, CTE materialization limits, derived tables, correlated filters]\n` +
    `- **3. Katman (Fonksiyon Çağrıları & Bağımlı Nesneler):** [Analyze dbo.fn_* scalar UDFs, RBAR behavior, CROSS/OUTER APPLY, inline vs multi-statement TVF]\n` +
    `- **4. Katman (Fiziksel Tablo Taramaları & İndeksler):** [Analyze repeated table scans, non-SARGable predicates like CONVERT/CAST, missing covering indexes]\n\n` +
    `### 🌳 Katman Katman Darboğaz Hiyerarşisi\n` +
    `Provide an ASCII tree or structured list of the query components and where the worst bottlenecks are located.\n\n` +
    `### 🚨 Neden Yavaş Çalışıyor? (Madde Madde Kök Nedenler)\n` +
    `- Provide rigorous, concrete bullet points explaining exactly why this query is slow in production.\n\n` +
    `### 💡 Derinlemesine Mimari İyileştirme ve Refaktör Önerileri\n` +
    `- Provide concrete, set-based architectural solutions (e.g. flattening subqueries, inlining UDFs, window functions, covering indexes).\n\n` +
    `### ⚡ Problemi Çözen Optimize Edilmiş Refaktör View (V2 T-SQL)\n` +
    `Write the COMPLETE, production-ready, fully executable \`CREATE OR ALTER VIEW [dbo].[${payload.targetView || 'ViewName'}]\` SQL statement.\n` +
    `- You MUST resolve all identified bottlenecks: pre-aggregate subqueries/CTEs by join keys, eliminate repeated table scans, prevent Cartesian fan-out, simplify redundant ISNULL chains, use uniform NOLOCK (or RCSI recommendation), and ensure SARGable predicates.\n` +
    `- You MUST strictly preserve all output columns, their exact names, exact ordinal positions, datatypes, and business semantics.\n` +
    `- Include concise inline SQL comments explaining why each CTE or optimization was introduced.\n` +
    `- CRITICAL: Do NOT truncate, do NOT use placeholder comments like "-- rest of code here". Write the COMPLETE, ready-to-execute T-SQL view code.\n\n` +
    `TARGET QUERY CONTEXT:\n` +
    JSON.stringify(payload, null, 2);
}

async function deepAnalyzeQuery(params = {}) {
  const {
    viewName,
    sql,
    problems = [],
    baseTables = [],
    options = {},
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
  let activeModel = (model || conf.model || 'deepseek-flash').trim();
  if (!activeModel || activeModel.toLowerCase() === 'deepseek-v4-flash' || activeModel.toLowerCase() === 'deepseek-coder') {
    activeModel = 'deepseek-flash';
  }
  const activeTemp = temperature ?? conf.temperature ?? 0.2;
  const activeTokens = maxTokens ?? 8192;

  const contextPack = {
    targetView: viewName,
    originalSql: sql,
    problems,
    baseTables,
    options
  };

  const response = await fetchWithTimeout(url, {
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
            'You are a principal Microsoft SQL Server performance architect and internals tuning specialist. ' +
            'Provide an exhaustive, hierarchical deep-dive diagnostic analysis in TURKISH (Türkçe), systematically drilling down into outer queries, subqueries, CTEs, scalar UDFs, and table access patterns.'
        },
        {
          role: 'user',
          content: buildDeepAnalyzePrompt(contextPack)
        }
      ]
    })
  }, DEFAULT_AI_TIMEOUT_MS);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(parseApiError(response, errorBody, key));
  }

  const resJson = await response.json();
  const choice = resJson.choices?.[0];
  const content = (choice?.message?.content || choice?.message?.reasoning_content || choice?.text || '').trim();

  if (!content) {
    throw new Error('AI sağlayıcıdan derinlemesine analiz yanıtı alınamadı.');
  }

  return {
    ok: true,
    data: {
      viewName,
      analysis: content,
      model: resJson.model || activeModel
    },
    analysis: content,
    model: resJson.model || activeModel
  };
}

module.exports = {
  buildRefactorPrompt,
  buildStructuredRefactorPrompt,
  buildAnalyzePrompt,
  buildDeepAnalyzePrompt,
  proposeRefactor,
  proposeStructuredRefactor,
  getProviderCapabilities,
  analyzeQuery,
  deepAnalyzeQuery,
  generateCandidate: proposeRefactor,
  testConnection,
  estimateAndPruneTokenBudget,
  DEFAULT_AI_TIMEOUT_MS,
  fetchWithTimeout
};
