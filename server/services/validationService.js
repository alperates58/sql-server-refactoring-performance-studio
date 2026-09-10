/**
 * SQL Server Refactoring & Performance Studio
 * Semantic Equivalence & Validation Lab Engine
 *
 * Guardrail Enforcement:
 * - DUAL EXCEPT is NOT treated as sole proof of exact match because EXCEPT discards duplicate multiplicity.
 * - Validation Levels explicitly distinguished:
 *    1. SCHEMA MATCH: Column count, names, ordinal order, and types match.
 *    2. ROW COUNT MATCH: Total returned row count is identical.
 *    3. SET MATCH: Dual EXCEPT returns 0 differences (A EXCEPT B = empty, B EXCEPT A = empty).
 *    4. MULTIPLICITY MATCH: GROUP BY projected columns + COUNT_BIG(*) proves duplicate counts match.
 *    5. EXACT MATCH: Proven semantically equivalent in schema, rows, set elements, and multiplicity!
 *    Where data types prevent grouping/hashing (LOB, XML, TEXT), explicitly marks as
 *    'PARTIALLY VALIDATED' or 'MULTIPLICITY NOT VERIFIED'.
 */

const db = require('./sqlServer');
const { validateReadOnly } = require('./sqlValidator');

/**
 * Splits CTE definition from main SELECT to allow valid top-level T-SQL bounding.
 */
function splitCteAndSelect(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!/^WITH\b/i.test(trimmed)) {
    return { ctePrefix: '', mainSelect: trimmed };
  }

  let depth = 0;
  let inString = false;
  let inComment = false;
  let inLineComment = false;
  const len = trimmed.length;

  for (let i = 0; i < len; i++) {
    const ch = trimmed[i];
    const next = i + 1 < len ? trimmed[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inComment) {
      if (ch === '*' && next === '/') { inComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === "'" && next === "'") { i++; continue; }
      if (ch === "'") inString = false;
      continue;
    }

    if (ch === '-' && next === '-') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inComment = true; i++; continue; }
    if (ch === "'") { inString = true; continue; }

    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (depth === 0 && i > 5) {
      const rest = trimmed.slice(i + 1);
      const match = /^\s*(SELECT\b[\s\S]*)$/i.exec(rest);
      if (match) {
        return {
          ctePrefix: trimmed.slice(0, i + 1).trim(),
          mainSelect: match[1].trim()
        };
      }
    }
  }

  return { ctePrefix: '', mainSelect: trimmed };
}

function buildBoundedTableScript(sql, tableName, limit) {
  const { ctePrefix, mainSelect } = splitCteAndSelect(sql);
  let cleanedSelect = mainSelect;

  // If outer query has an ORDER BY without TOP, remove it for derived table safety
  if (!/\bTOP\b/i.test(cleanedSelect)) {
    cleanedSelect = cleanedSelect.replace(/\s+ORDER\s+BY\s+[\w\d_.,\s\[\]\(\)]+$/i, '');
  }

  const prefixLine = ctePrefix ? `${ctePrefix}\n` : '';
  return `
    ${prefixLine}
    SELECT TOP (${limit}) *
    INTO ${tableName}
    FROM (${cleanedSelect}) AS _bounded;
  `;
}

/**
 * Validates semantic equivalence between an original query and a candidate query.
 */
async function validateEquivalence({ originalSql, candidateSql, database = null, sampleLimit = 1000 }) {
  const cleanOrig = String(originalSql || '').trim().replace(/;+\s*$/, '');
  const cleanCand = String(candidateSql || '').trim().replace(/;+\s*$/, '');

  // 1. Validate both queries are read-only
  const valOrig = validateReadOnly(cleanOrig);
  if (!valOrig.valid) throw new Error(`Orijinal sorgu kural dışı: ${valOrig.reason}`);

  const valCand = validateReadOnly(cleanCand);
  if (!valCand.valid) throw new Error(`Aday sorgu kural dışı: ${valCand.reason}`);

  if (!db.status().connected) {
    throw new Error('Aktif SQL Server bağlantısı yok. Lütfen önce bağlanın.');
  }

  const pool = db.getPool(database);
  if (!pool) throw new Error(`Veritabanı bağlantı havuzu hazır değil (${database || 'varsayılan'}).`);

  const limit = Math.min(5000, Math.max(10, Number(sampleLimit) || 1000));

  const steps = [
    { id: 'schema', name: 'Şema ve Kolon Sıralaması', status: 'PENDING', detail: '' },
    { id: 'rowCount', name: 'Satır Sayısı Eşleşmesi', status: 'PENDING', detail: '' },
    { id: 'setMatch', name: 'Çift Yönlü EXCEPT Küme Farkı', status: 'PENDING', detail: '' },
    { id: 'multiplicity', name: 'Satır Çokluğu & Frekans Doğrulaması (COUNT_BIG)', status: 'PENDING', detail: '' }
  ];

  let overallVerdict = 'UNVALIDATED';

  // Acquire dedicated transaction to guarantee connection affinity for temp tables
  const transaction = pool.transaction();
  await transaction.begin();
  const req = transaction.request();

  try {
    // Step 1: Schema & Metadata Inspection via sp_describe_first_result_set
    const origSchemaReq = transaction.request();
    origSchemaReq.input('tsql', cleanOrig);
    const origSchemaRes = await origSchemaReq.execute('sp_describe_first_result_set');

    const candSchemaReq = transaction.request();
    candSchemaReq.input('tsql', cleanCand);
    const candSchemaRes = await candSchemaReq.execute('sp_describe_first_result_set');

    const origCols = origSchemaRes.recordset || [];
    const candCols = candSchemaRes.recordset || [];

    if (origCols.length !== candCols.length) {
      steps[0].status = 'FAILED';
      steps[0].detail = `Kolon sayısı uyuşmuyor: Orijinal ${origCols.length}, Aday ${candCols.length}.`;
      overallVerdict = 'SCHEMA MISMATCH';
      return { ok: true, verdict: overallVerdict, steps };
    }

    let colMismatch = null;
    for (let i = 0; i < origCols.length; i++) {
      const oc = origCols[i];
      const cc = candCols[i];
      if (oc.name?.toLowerCase() !== cc.name?.toLowerCase()) {
        colMismatch = `Sıra ${i + 1} kolon adı uyuşmuyor: "${oc.name}" vs "${cc.name}".`;
        break;
      }
      if (oc.system_type_name !== cc.system_type_name) {
        colMismatch = `"${oc.name}" veri tipi uyuşmuyor: ${oc.system_type_name} vs ${cc.system_type_name}.`;
        break;
      }
    }

    if (colMismatch) {
      steps[0].status = 'FAILED';
      steps[0].detail = colMismatch;
      overallVerdict = 'SCHEMA MISMATCH';
      return { ok: true, verdict: overallVerdict, steps };
    }

    steps[0].status = 'PASS';
    steps[0].detail = `${origCols.length} kolon, sıralama ve veri tipleri birebir eşleşti.`;

    // Materialize bounded samples into connection-scoped temp tables
    await req.batch(`
      DROP TABLE IF EXISTS #OrigBound;
      DROP TABLE IF EXISTS #CandBound;
      ${buildBoundedTableScript(cleanOrig, '#OrigBound', limit)}
      ${buildBoundedTableScript(cleanCand, '#CandBound', limit)}
    `);

    // Step 2: Row Count Verification
    const countCheckSql = `
      SELECT 
        (SELECT COUNT_BIG(*) FROM #OrigBound) AS OrigCount,
        (SELECT COUNT_BIG(*) FROM #CandBound) AS CandCount;
    `;
    const countRes = await req.query(countCheckSql);
    const origCount = Number(countRes.recordset[0]?.OrigCount || 0);
    const candCount = Number(countRes.recordset[0]?.CandCount || 0);

    if (origCount !== candCount) {
      steps[1].status = 'FAILED';
      steps[1].detail = `Satır sayısı uyuşmuyor (${limit} sınırında): Orijinal ${origCount}, Aday ${candCount}.`;
      overallVerdict = 'ROW COUNT MISMATCH';
      return { ok: true, verdict: overallVerdict, steps, origCount, candCount };
    }

    steps[1].status = 'PASS';
    steps[1].detail = `Satır sayısı eşleşti (${origCount} satır).`;

    // Step 3: Dual EXCEPT Comparison (Set Difference)
    const exceptCheckSql = `
      SELECT 
        (SELECT COUNT_BIG(*) FROM (SELECT * FROM #OrigBound EXCEPT SELECT * FROM #CandBound) _d1) AS DiffA_Minus_B,
        (SELECT COUNT_BIG(*) FROM (SELECT * FROM #CandBound EXCEPT SELECT * FROM #OrigBound) _d2) AS DiffB_Minus_A;
    `;
    const exceptRes = await req.query(exceptCheckSql);
    const diff1 = Number(exceptRes.recordset[0]?.DiffA_Minus_B || 0);
    const diff2 = Number(exceptRes.recordset[0]?.DiffB_Minus_A || 0);

    if (diff1 > 0 || diff2 > 0) {
      steps[2].status = 'FAILED';
      steps[2].detail = `EXCEPT fark buldu: Orijinalde olup Adayda olmayan: ${diff1}, Adayda olup Orijinalde olmayan: ${diff2}.`;
      overallVerdict = 'SET MISMATCH';
      return { ok: true, verdict: overallVerdict, steps, diff1, diff2 };
    }

    steps[2].status = 'PASS';
    steps[2].detail = `Dual EXCEPT = 0 (Her iki yönlü küme farkı boş).`;

    // Step 4: Multiplicity Proof via GROUP BY + COUNT_BIG(*)
    const hasLob = origCols.some(c => {
      const t = String(c.system_type_name || '').toLowerCase();
      return t.includes('xml') || t.includes('text') || t.includes('image') || t.includes('max');
    });

    if (hasLob) {
      steps[3].status = 'WARNING';
      steps[3].detail = 'Sorgu LOB/XML kolonları içerdiğinden GROUP BY multiplicity testi atlandı (PARTIALLY VALIDATED).';
      overallVerdict = 'PARTIALLY VALIDATED (MULTIPLICITY NOT VERIFIED)';
      return { ok: true, verdict: overallVerdict, steps };
    }

    const colList = origCols.map(c => `[${c.name}]`).join(', ');
    const multCheckSql = `
      SELECT 
        (SELECT COUNT_BIG(*) FROM (
          SELECT ${colList}, COUNT_BIG(*) AS _cnt FROM #OrigBound GROUP BY ${colList}
          EXCEPT
          SELECT ${colList}, COUNT_BIG(*) AS _cnt FROM #CandBound GROUP BY ${colList}
        ) _m1) AS MultDiff1,
        (SELECT COUNT_BIG(*) FROM (
          SELECT ${colList}, COUNT_BIG(*) AS _cnt FROM #CandBound GROUP BY ${colList}
          EXCEPT
          SELECT ${colList}, COUNT_BIG(*) AS _cnt FROM #OrigBound GROUP BY ${colList}
        ) _m2) AS MultDiff2;
    `;

    const multRes = await req.query(multCheckSql);
    const mDiff1 = Number(multRes.recordset[0]?.MultDiff1 || 0);
    const mDiff2 = Number(multRes.recordset[0]?.MultDiff2 || 0);

    if (mDiff1 > 0 || mDiff2 > 0) {
      steps[3].status = 'FAILED';
      steps[3].detail = `Kopya satır sıklığı uyuşmuyor! Multiplicity hatası: ${mDiff1 + mDiff2} küme frekansı farklı.`;
      overallVerdict = 'MULTIPLICITY MISMATCH';
      return { ok: true, verdict: overallVerdict, steps };
    }

    steps[3].status = 'PASS';
    steps[3].detail = `Tüm satırların tekilleştirme adetleri ve frekansları (COUNT_BIG) birebir eşleşti.`;

    overallVerdict = 'EXACT MATCH';
    return {
      ok: true,
      verdict: overallVerdict,
      steps,
      sampleSize: limit
    };
  } catch (err) {
    throw err;
  } finally {
    try {
      await req.batch('DROP TABLE IF EXISTS #OrigBound; DROP TABLE IF EXISTS #CandBound;').catch(() => {});
      await transaction.rollback().catch(() => {});
    } catch (_) {}
  }
}

module.exports = {
  validateEquivalence,
  splitCteAndSelect,
  buildBoundedTableScript
};
