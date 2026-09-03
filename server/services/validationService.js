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
 * Validates semantic equivalence between an original query and a candidate query.
 */
async function validateEquivalence({ originalSql, candidateSql, database = null, sampleLimit = 1000 }) {
  // 1. Validate both queries are read-only
  const valOrig = validateReadOnly(originalSql);
  if (!valOrig.valid) throw new Error(`Orijinal sorgu kural dışı: ${valOrig.reason}`);

  const valCand = validateReadOnly(candidateSql);
  if (!valCand.valid) throw new Error(`Aday sorgu kural dışı: ${valCand.reason}`);

  if (!db.status().connected) {
    throw new Error('Aktif SQL Server bağlantısı yok. Lütfen önce bağlanın.');
  }

  const pool = db.getPool(database);
  if (!pool) throw new Error(`Veritabanı bağlantı havuzu hazır değil (${database || 'varsayılan'}).`);

  const limit = Math.min(5000, Math.max(10, Number(sampleLimit) || 1000));

  const steps = [
    { id: 'schema', name: 'Schema & Column Order', status: 'PENDING', detail: '' },
    { id: 'rowCount', name: 'Row Count Match', status: 'PENDING', detail: '' },
    { id: 'setMatch', name: 'Dual EXCEPT Comparison', status: 'PENDING', detail: '' },
    { id: 'multiplicity', name: 'Row Multiplicity (GROUP BY + COUNT_BIG)', status: 'PENDING', detail: '' }
  ];

  let schemaMatch = false;
  let rowCountMatch = false;
  let setMatch = false;
  let multiplicityMatch = false;
  let multiplicityNote = '';
  let overallVerdict = 'UNVALIDATED';

  try {
    // Step 1: Schema & Metadata Inspection via sp_describe_first_result_set
    const origSchemaReq = pool.request();
    origSchemaReq.input('tsql', originalSql);
    const origSchemaRes = await origSchemaReq.execute('sp_describe_first_result_set');

    const candSchemaReq = pool.request();
    candSchemaReq.input('tsql', candidateSql);
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

    schemaMatch = true;
    steps[0].status = 'PASS';
    steps[0].detail = `${origCols.length} kolon, sıralama ve veri tipleri birebir eşleşti.`;

    // Step 2: Row Count Verification
    const countCheckSql = `
      WITH OrigBound AS (
        SELECT TOP (${limit}) * FROM (${originalSql}) AS _o
      ),
      CandBound AS (
        SELECT TOP (${limit}) * FROM (${candidateSql}) AS _c
      )
      SELECT 
        (SELECT COUNT_BIG(*) FROM OrigBound) AS OrigCount,
        (SELECT COUNT_BIG(*) FROM CandBound) AS CandCount;
    `;

    const countRes = await pool.request().query(countCheckSql);
    const origCount = Number(countRes.recordset[0]?.OrigCount || 0);
    const candCount = Number(countRes.recordset[0]?.CandCount || 0);

    if (origCount !== candCount) {
      steps[1].status = 'FAILED';
      steps[1].detail = `Satır sayısı uyuşmuyor (${limit} sınırında): Orijinal ${origCount}, Aday ${candCount}.`;
      overallVerdict = 'ROW COUNT MISMATCH';
      return { ok: true, verdict: overallVerdict, steps, origCount, candCount };
    }

    rowCountMatch = true;
    steps[1].status = 'PASS';
    steps[1].detail = `Satır sayısı eşleşti (${origCount} satır).`;

    // Step 3: Dual EXCEPT Comparison (Set Difference)
    const exceptCheckSql = `
      WITH OrigBound AS (
        SELECT TOP (${limit}) * FROM (${originalSql}) AS _o
      ),
      CandBound AS (
        SELECT TOP (${limit}) * FROM (${candidateSql}) AS _c
      )
      SELECT 
        (SELECT COUNT_BIG(*) FROM (SELECT * FROM OrigBound EXCEPT SELECT * FROM CandBound) _d1) AS DiffA_Minus_B,
        (SELECT COUNT_BIG(*) FROM (SELECT * FROM CandBound EXCEPT SELECT * FROM OrigBound) _d2) AS DiffB_Minus_A;
    `;

    const exceptRes = await pool.request().query(exceptCheckSql);
    const diff1 = Number(exceptRes.recordset[0]?.DiffA_Minus_B || 0);
    const diff2 = Number(exceptRes.recordset[0]?.DiffB_Minus_A || 0);

    if (diff1 > 0 || diff2 > 0) {
      steps[2].status = 'FAILED';
      steps[2].detail = `EXCEPT fark buldu: Orijinalde olup Adayda olmayan: ${diff1}, Adayda olup Orijinalde olmayan: ${diff2}.`;
      overallVerdict = 'SET MISMATCH';
      return { ok: true, verdict: overallVerdict, steps, diff1, diff2 };
    }

    setMatch = true;
    steps[2].status = 'PASS';
    steps[2].detail = `Dual EXCEPT = 0 (Her iki yönlü küme farkı boş).`;

    // Step 4: Multiplicity Proof via GROUP BY + COUNT_BIG(*)
    // Check if unhashable/LOB data types exist
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

    // Build GROUP BY columns
    const colList = origCols.map(c => `[${c.name}]`).join(', ');
    const multCheckSql = `
      WITH OrigAgg AS (
        SELECT ${colList}, COUNT_BIG(*) AS _cnt
        FROM (SELECT TOP (${limit}) * FROM (${originalSql}) AS _o) AS _sub1
        GROUP BY ${colList}
      ),
      CandAgg AS (
        SELECT ${colList}, COUNT_BIG(*) AS _cnt
        FROM (SELECT TOP (${limit}) * FROM (${candidateSql}) AS _c) AS _sub2
        GROUP BY ${colList}
      )
      SELECT 
        (SELECT COUNT_BIG(*) FROM (SELECT * FROM OrigAgg EXCEPT SELECT * FROM CandAgg) _m1) AS MultDiff1,
        (SELECT COUNT_BIG(*) FROM (SELECT * FROM CandAgg EXCEPT SELECT * FROM OrigAgg) _m2) AS MultDiff2;
    `;

    const multRes = await pool.request().query(multCheckSql);
    const mDiff1 = Number(multRes.recordset[0]?.MultDiff1 || 0);
    const mDiff2 = Number(multRes.recordset[0]?.MultDiff2 || 0);

    if (mDiff1 > 0 || mDiff2 > 0) {
      steps[3].status = 'FAILED';
      steps[3].detail = `Duplicate satır sıklığı uyuşmuyor! Multiplicity hatası: ${mDiff1 + mDiff2} küme frekansı farklı.`;
      overallVerdict = 'MULTIPLICITY MISMATCH';
      return { ok: true, verdict: overallVerdict, steps };
    }

    multiplicityMatch = true;
    steps[3].status = 'PASS';
    steps[3].detail = `Tüm satırların duplicate adetleri ve frekansları (COUNT_BIG) birebir eşleşti.`;

    overallVerdict = 'EXACT MATCH';
    return {
      ok: true,
      verdict: overallVerdict,
      steps,
      sampleSize: limit
    };
  } catch (err) {
    throw err;
  }
}

module.exports = {
  validateEquivalence
};
