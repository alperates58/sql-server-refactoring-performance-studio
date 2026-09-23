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
const { validateReadOnly, extractExecutableQueryFromView } = require('./sqlValidator');

/**
 * Checks if a column data type is comparable and sortable (non-LOB).
 */
function isComparableColumn(col) {
  if (!col || !col.system_type_name) return false;
  const t = String(col.system_type_name).toLowerCase();
  if (
    t.includes('xml') ||
    t.includes('text') || // covers text, ntext
    t.includes('image') ||
    t.includes('varbinary(max)') ||
    t.includes('varchar(max)') ||
    t.includes('nvarchar(max)') ||
    t.includes('geography') ||
    t.includes('geometry') ||
    t.includes('hierarchyid')
  ) {
    return false;
  }
  return true;
}

function getComparableColumns(cols = []) {
  return (cols || []).filter(isComparableColumn);
}

function buildDeterministicOrderBy(comparableCols = []) {
  if (!comparableCols || comparableCols.length === 0) return '';
  const cols = comparableCols.slice(0, 8).map(c => `[${c.name.replace(/\]/g, ']]')}]`);
  return `ORDER BY ${cols.join(', ')}`;
}

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

function buildCountProbeScript(sql, limit) {
  const { ctePrefix, mainSelect } = splitCteAndSelect(sql);
  let cleanedSelect = mainSelect;
  if (!/\bTOP\b/i.test(cleanedSelect)) {
    cleanedSelect = cleanedSelect.replace(/\s+ORDER\s+BY\s+[\w\d_.,\s\[\]\(\)]+$/i, '');
  }
  const prefixLine = ctePrefix ? `${ctePrefix}\n` : '';
  return `
    ${prefixLine}
    SELECT COUNT_BIG(*) AS RowCnt FROM (SELECT TOP (${limit + 1}) 1 AS _x FROM (${cleanedSelect}) AS _p) _sub;
  `;
}

function buildBoundedTableScript(sql, tableName, limit, orderByClause = '', useTop = true) {
  const { ctePrefix, mainSelect } = splitCteAndSelect(sql);
  let cleanedSelect = mainSelect;

  // If outer query has an ORDER BY without TOP, remove it for derived table safety
  if (!/\bTOP\b/i.test(cleanedSelect)) {
    cleanedSelect = cleanedSelect.replace(/\s+ORDER\s+BY\s+[\w\d_.,\s\[\]\(\)]+$/i, '');
  }

  const prefixLine = ctePrefix ? `${ctePrefix}\n` : '';
  const topClause = (useTop && limit) ? `TOP (${limit})` : '';
  const orderClause = (useTop && limit && orderByClause) ? `\n    ${orderByClause}` : '';

  return `
    ${prefixLine}
    SELECT ${topClause} *
    INTO ${tableName}
    FROM (${cleanedSelect}) AS _bounded${orderClause};
  `;
}

/**
 * Validates semantic equivalence between an original query and a candidate query.
 * Produces four distinct verdicts:
 *   - PASS: Full dataset verified across schema, row count, set (EXCEPT), and multiplicity
 *   - PASS_WITH_WARNING: Deterministic sample verified across all steps
 *   - FAIL: Detected schema mismatch, row count divergence, set diff, or multiplicity diff
 *   - INCONCLUSIVE: LOB/XML types or unbounded dataset without comparable columns
 */
async function validateEquivalence({ originalSql, candidateSql, database = null, sampleLimit = 1000 }) {
  const cleanOrig = extractExecutableQueryFromView(originalSql);
  const cleanCand = extractExecutableQueryFromView(candidateSql);

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

  let overallVerdict = 'INCONCLUSIVE';

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

    if (origCols.length === 0 || candCols.length === 0) {
      steps[0].status = 'FAILED';
      steps[0].detail = 'Sorgu kolon metadata kümesi boş döndü veya çözümlenemedi.';
      overallVerdict = 'FAIL';
      return { ok: true, verdict: overallVerdict, steps };
    }

    if (origCols.length !== candCols.length) {
      steps[0].status = 'FAILED';
      steps[0].detail = `Kolon sayısı uyuşmuyor: Orijinal ${origCols.length}, Aday ${candCols.length}.`;
      overallVerdict = 'FAIL';
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
      overallVerdict = 'FAIL';
      return { ok: true, verdict: overallVerdict, steps };
    }

    steps[0].status = 'PASS';
    steps[0].detail = `${origCols.length} kolon, sıralama ve veri tipleri birebir eşleşti.`;

    // Check if total rows are within limit to avoid TOP if possible
    let origProbe = limit + 1;
    let candProbe = limit + 1;
    try {
      const p1 = await transaction.request().query(buildCountProbeScript(cleanOrig, limit));
      origProbe = Number(p1.recordset[0]?.RowCnt || 0);
      const p2 = await transaction.request().query(buildCountProbeScript(cleanCand, limit));
      candProbe = Number(p2.recordset[0]?.RowCnt || 0);
    } catch (_) {
      origProbe = limit + 1;
      candProbe = limit + 1;
    }

    const isFullDataset = (origProbe <= limit && candProbe <= limit);
    const useTop = !isFullDataset;

    // Filter comparable columns (excluding LOB, XML, TEXT)
    const comparableCols = getComparableColumns(origCols);
    const hasComparable = comparableCols.length > 0;
    const orderByClause = hasComparable ? buildDeterministicOrderBy(comparableCols) : '';

    if (useTop && !hasComparable) {
      // Without comparable columns, deterministic sample cannot be guaranteed
      steps[1].status = 'WARNING';
      steps[1].detail = 'Non-LOB karşılaştırılabilir kolon bulunamadığından örneklem sıralaması oluşturulamadı.';
      steps[2].status = 'WARNING';
      steps[2].detail = 'LOB kolonlar nedeniyle EXCEPT küme farkı testi uygulanamadı.';
      steps[3].status = 'WARNING';
      steps[3].detail = 'LOB kolonlar nedeniyle frekans testi uygulanamadı.';
      overallVerdict = 'INCONCLUSIVE';
      return {
        ok: true,
        verdict: overallVerdict,
        steps,
        reason: 'Tüm kolonlar LOB/XML türünde olduğundan ve satır sayısı örneklem sınırını aştığından deterministik doğrulama yapılamadı.'
      };
    }

    // Materialize into connection-scoped temp tables
    await req.batch(`
      DROP TABLE IF EXISTS #OrigBound;
      DROP TABLE IF EXISTS #CandBound;
      ${buildBoundedTableScript(cleanOrig, '#OrigBound', limit, orderByClause, useTop)}
      ${buildBoundedTableScript(cleanCand, '#CandBound', limit, orderByClause, useTop)}
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
      steps[1].detail = `Satır sayısı uyuşmuyor: Orijinal ${origCount}, Aday ${candCount}.`;
      overallVerdict = 'FAIL';
      return { ok: true, verdict: overallVerdict, steps, origCount, candCount };
    }

    steps[1].status = 'PASS';
    steps[1].detail = isFullDataset
      ? `Tam veri seti satır sayısı eşleşti (${origCount} satır, TOP kullanılmadı).`
      : `Örneklem satır sayısı eşleşti (${origCount} satır, deterministik sıralı).`;

    // Step 3: Dual EXCEPT Comparison (Set Difference)
    const hasLob = origCols.some(c => !isComparableColumn(c));
    if (hasLob) {
      steps[2].status = 'WARNING';
      steps[2].detail = 'Sorgu LOB/XML kolonları içerdiğinden EXCEPT küme farkı ve multiplicity testi uygulanamadı.';
      steps[3].status = 'WARNING';
      steps[3].detail = 'LOB/XML kolonları GROUP BY ve EXCEPT operatörlerini desteklemez.';
      overallVerdict = 'INCONCLUSIVE';
      return {
        ok: true,
        verdict: overallVerdict,
        steps,
        sampleSize: origCount,
        reason: 'LOB/XML veri tipleri EXCEPT ve GROUP BY operatörlerini desteklemediği için semantik eşitlik kesin kanıtlanamadı.'
      };
    }

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
      overallVerdict = 'FAIL';
      return { ok: true, verdict: overallVerdict, steps, diff1, diff2 };
    }

    steps[2].status = 'PASS';
    steps[2].detail = 'Dual EXCEPT = 0 (Her iki yönlü küme farkı boş).';

    // Step 4: Multiplicity Proof via GROUP BY + COUNT_BIG(*)
    const colList = origCols.map(c => `[${c.name.replace(/\]/g, ']]')}]`).join(', ');
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
      overallVerdict = 'FAIL';
      return { ok: true, verdict: overallVerdict, steps, mDiff1, mDiff2 };
    }

    steps[3].status = 'PASS';
    steps[3].detail = 'Tüm satırların tekilleştirme adetleri ve frekansları (COUNT_BIG) birebir eşleşti.';

    overallVerdict = isFullDataset ? 'PASS' : 'PASS_WITH_WARNING';

    return {
      ok: true,
      verdict: overallVerdict,
      steps,
      isFullDataset,
      sampleSize: origCount
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
  buildBoundedTableScript,
  buildCountProbeScript,
  buildDeterministicOrderBy,
  isComparableColumn,
  getComparableColumns,
  extractExecutableQueryFromView
};
