/**
 * SQL Server Refactoring & Performance Studio
 * AI Optimizer Test Fixture Suite (12 Canonical Scenarios)
 *
 * Each fixture defines:
 * - sql & sample candidate variations (cosmetic, structural, bad)
 * - expectedRootCause & contributingCauses
 * - expectedAiStatus
 * - allowedRewrite & forbiddenRewrite descriptions
 * - validationExpectation
 */

const OPTIMIZER_FIXTURES = {
  // 1. Non-SARGable Date Function
  nonSargableDate: {
    key: 'nonSargableDate',
    title: 'Non-SARGable Date Function (YEAR)',
    sql: `SELECT sth_stok_kod, SUM(sth_tutar) AS toplam_tutar
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
WHERE YEAR(sth_tarih) = 2026
GROUP BY sth_stok_kod;`,
    cosmeticCandidateSql: `SELECT s.sth_stok_kod, SUM(s.sth_tutar) AS toplam_tutar
FROM dbo.STOK_HAREKETLERI AS s WITH (NOLOCK)
WHERE YEAR(s.sth_tarih) = 2026
GROUP BY s.sth_stok_kod;`,
    structuralCandidateSql: `SELECT sth_stok_kod, SUM(sth_tutar) AS toplam_tutar
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_tarih >= '20260101' AND sth_tarih < '20270101'
GROUP BY sth_stok_kod;`,
    expectedRootCause: 'QUERY_SHAPE',
    contributingCauses: ['INDEX_ACCESS'],
    expectedAiStatus: 'CANDIDATE_GENERATED',
    allowedRewrite: 'SARGable range predicate (sth_tarih >= 20260101 AND sth_tarih < 20270101)',
    forbiddenRewrite: 'Alias rename or whitespace formatting',
    validationExpectation: 'PASS'
  },

  // 2. Function on Join Column (Collation Sensitive)
  functionOnJoin: {
    key: 'functionOnJoin',
    title: 'Function on Join Column (Collation Caution)',
    sql: `SELECT c.cari_kod, a.adr_cadde
FROM dbo.CARI_HESAPLAR c WITH (NOLOCK)
JOIN dbo.CARI_HESAP_ADRESLERI a WITH (NOLOCK)
  ON UPPER(c.cari_kod) = UPPER(a.adr_cari_kod);`,
    cosmeticCandidateSql: `SELECT c.cari_kod, a.adr_cadde
FROM dbo.CARI_HESAPLAR c WITH (NOLOCK)
INNER JOIN dbo.CARI_HESAP_ADRESLERI a WITH (NOLOCK)
  ON UPPER(c.cari_kod) = UPPER(a.adr_cari_kod);`,
    structuralCandidateSql: `SELECT c.cari_kod, a.adr_cadde
FROM dbo.CARI_HESAPLAR c WITH (NOLOCK)
JOIN dbo.CARI_HESAP_ADRESLERI a WITH (NOLOCK)
  ON c.cari_kod = a.adr_cari_kod;`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'INSUFFICIENT_EVIDENCE', // Caution: Collation sensitivity unknown
    allowedRewrite: 'Conditional on case-insensitive collation evidence',
    forbiddenRewrite: 'Blind removal without collation verification',
    validationExpectation: 'PASS_WITH_WARNING'
  },

  // 3. Correlated Scalar Subquery
  correlatedScalarSubquery: {
    key: 'correlatedScalarSubquery',
    title: 'Correlated Scalar Subquery in Projection',
    sql: `SELECT o.cha_Guid, o.cha_kod,
  (SELECT SUM(d.sth_tutar)
   FROM dbo.STOK_HAREKETLERI d WITH (NOLOCK)
   WHERE d.sth_cari_kodu = o.cha_kod) AS toplam_tutar
FROM dbo.CARI_HESAP_HAREKETLERI o WITH (NOLOCK);`,
    cosmeticCandidateSql: `SELECT o.cha_Guid, o.cha_kod,
  (SELECT SUM(sub.sth_tutar)
   FROM dbo.STOK_HAREKETLERI AS sub WITH (NOLOCK)
   WHERE sub.sth_cari_kodu = o.cha_kod) AS toplam_tutar
FROM dbo.CARI_HESAP_HAREKETLERI AS o WITH (NOLOCK);`,
    structuralCandidateSql: `WITH CariToplam AS (
  SELECT sth_cari_kodu, SUM(sth_tutar) AS toplam_tutar
  FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
  GROUP BY sth_cari_kodu
)
SELECT o.cha_Guid, o.cha_kod, ISNULL(t.toplam_tutar, 0) AS toplam_tutar
FROM dbo.CARI_HESAP_HAREKETLERI o WITH (NOLOCK)
LEFT JOIN CariToplam t ON o.cha_kod = t.sth_cari_kodu;`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'CANDIDATE_GENERATED',
    allowedRewrite: 'Pre-aggregated CTE or set-based LEFT JOIN',
    forbiddenRewrite: 'Keeping correlated scalar subquery in SELECT',
    validationExpectation: 'PASS'
  },

  // 4. Repeated Table Scan Consolidation
  repeatedScan: {
    key: 'repeatedScan',
    title: 'Repeated Scan on Same Table',
    sql: `SELECT s.sto_kod,
  (SELECT COUNT(*) FROM dbo.STOK_HAREKETLERI h1 WITH (NOLOCK) WHERE h1.sth_stok_kod = s.sto_kod AND h1.sth_tip = 0) AS giris_adet,
  (SELECT COUNT(*) FROM dbo.STOK_HAREKETLERI h2 WITH (NOLOCK) WHERE h2.sth_stok_kod = s.sto_kod AND h2.sth_tip = 1) AS cikis_adet
FROM dbo.STOKLAR s WITH (NOLOCK);`,
    cosmeticCandidateSql: `SELECT stk.sto_kod,
  (SELECT COUNT(*) FROM dbo.STOK_HAREKETLERI h1 WITH (NOLOCK) WHERE h1.sth_stok_kod = stk.sto_kod AND h1.sth_tip = 0) AS giris_adet,
  (SELECT COUNT(*) FROM dbo.STOK_HAREKETLERI h2 WITH (NOLOCK) WHERE h2.sth_stok_kod = stk.sto_kod AND h2.sth_tip = 1) AS cikis_adet
FROM dbo.STOKLAR AS stk WITH (NOLOCK);`,
    structuralCandidateSql: `WITH HareketOzeti AS (
  SELECT sth_stok_kod,
    SUM(CASE WHEN sth_tip = 0 THEN 1 ELSE 0 END) AS giris_adet,
    SUM(CASE WHEN sth_tip = 1 THEN 1 ELSE 0 END) AS cikis_adet
  FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
  GROUP BY sth_stok_kod
)
SELECT s.sto_kod,
  ISNULL(h.giris_adet, 0) AS giris_adet,
  ISNULL(h.cikis_adet, 0) AS cikis_adet
FROM dbo.STOKLAR s WITH (NOLOCK)
LEFT JOIN HareketOzeti h ON s.sto_kod = h.sth_stok_kod;`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'CANDIDATE_GENERATED',
    allowedRewrite: 'Consolidated conditional aggregation in single scan',
    forbiddenRewrite: 'Multiple separate scans on same table',
    validationExpectation: 'PASS'
  },

  // 5. Unnecessary DISTINCT (Safe Removal)
  unnecessaryDistinctSafe: {
    key: 'unnecessaryDistinctSafe',
    title: 'Unnecessary DISTINCT on Unique Key',
    sql: `SELECT DISTINCT sto_Guid, sto_kod, sto_isim
FROM dbo.STOKLAR WITH (NOLOCK);`,
    cosmeticCandidateSql: `SELECT DISTINCT s.sto_Guid, s.sto_kod, s.sto_isim
FROM dbo.STOKLAR AS s WITH (NOLOCK);`,
    structuralCandidateSql: `SELECT sto_Guid, sto_kod, sto_isim
FROM dbo.STOKLAR WITH (NOLOCK);`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'CANDIDATE_GENERATED',
    allowedRewrite: 'Remove redundant DISTINCT on unique key table',
    forbiddenRewrite: 'Reordering columns or leaving DISTINCT',
    validationExpectation: 'PASS'
  },

  // 6. DISTINCT Unsafe Case (Multiplicity Trap)
  distinctUnsafe: {
    key: 'distinctUnsafe',
    title: 'Semantic DISTINCT on Non-Unique Column',
    sql: `SELECT DISTINCT sto_anagrup_kod
FROM dbo.STOKLAR WITH (NOLOCK);`,
    cosmeticCandidateSql: `SELECT DISTINCT s.sto_anagrup_kod
FROM dbo.STOKLAR AS s WITH (NOLOCK);`,
    badCandidateSql: `SELECT sto_anagrup_kod
FROM dbo.STOKLAR WITH (NOLOCK);`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'NO_SAFE_OPTIMIZATION_FOUND',
    allowedRewrite: 'None (DISTINCT is required for business semantics)',
    forbiddenRewrite: 'Removing DISTINCT blindly',
    validationExpectation: 'FAIL_IF_REMOVED'
  },

  // 7. Already Optimized Query
  alreadyOptimizedQuery: {
    key: 'alreadyOptimizedQuery',
    title: 'Already Optimized SARGable Query',
    sql: `SELECT sto_Guid, sto_kod, sto_isim
FROM dbo.STOKLAR WITH (NOLOCK)
WHERE sto_cins = 4;`,
    cosmeticCandidateSql: `SELECT s.sto_Guid, s.sto_kod, s.sto_isim
FROM dbo.STOKLAR AS s WITH (NOLOCK)
WHERE s.sto_cins = 4;`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'NO_SAFE_OPTIMIZATION_FOUND',
    allowedRewrite: 'None (Query is already optimal)',
    forbiddenRewrite: 'Cosmetic rewrite pretending to be optimization',
    validationExpectation: 'PASS'
  },

  // 8. Missing-Index-Only Query
  missingIndexOnly: {
    key: 'missingIndexOnly',
    title: 'SARGable Query with Missing Index Bottleneck',
    sql: `SELECT sto_Guid, sto_kod, sto_isim
FROM dbo.STOKLAR WITH (NOLOCK)
WHERE sto_ozelkod1 = 'VIP';`,
    cosmeticCandidateSql: `SELECT s.sto_Guid, s.sto_kod, s.sto_isim
FROM dbo.STOKLAR AS s WITH (NOLOCK)
WHERE s.sto_ozelkod1 = 'VIP';`,
    expectedRootCause: 'INDEX_ACCESS',
    expectedAiStatus: 'NEEDS_INDEX_CHANGE',
    allowedRewrite: 'None (SQL rewrite is ineffective, requires index on sto_ozelkod1)',
    forbiddenRewrite: 'Any cosmetic SQL rewrite',
    validationExpectation: 'PASS'
  },

  // 9. Statistics-Driven Case
  statisticsDriven: {
    key: 'statisticsDriven',
    title: 'Severe Cardinality Mismatch from Stale Statistics',
    sql: `SELECT s.sto_kod, h.sth_tutar
FROM dbo.STOKLAR s WITH (NOLOCK)
JOIN dbo.STOK_HAREKETLERI h WITH (NOLOCK) ON s.sto_kod = h.sth_stok_kod
WHERE s.sto_altgrup_kod = 'ENDUSTRIYEL';`,
    expectedRootCause: 'STATISTICS',
    expectedAiStatus: 'NEEDS_STATISTICS_ATTENTION',
    allowedRewrite: 'None (Optimizer needs fresh stats)',
    forbiddenRewrite: 'Forcing optimizer hints',
    validationExpectation: 'PASS'
  },

  // 10. Semantic Trap: NOT IN with NULL risk
  semanticTrapNotInNull: {
    key: 'semanticTrapNotInNull',
    title: 'Semantic Trap: NOT IN vs NOT EXISTS with Nullable Column',
    sql: `SELECT c.cari_kod, c.cari_unvan1
FROM dbo.CARI_HESAPLAR c WITH (NOLOCK)
WHERE c.cari_kod NOT IN (
  SELECT h.sth_cari_kodu
  FROM dbo.STOK_HAREKETLERI h WITH (NOLOCK)
);`,
    unsafeCandidateSql: `SELECT c.cari_kod, c.cari_unvan1
FROM dbo.CARI_HESAPLAR c WITH (NOLOCK)
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.STOK_HAREKETLERI h WITH (NOLOCK)
  WHERE h.sth_cari_kodu = c.cari_kod
);`,
    safeCandidateSql: `SELECT c.cari_kod, c.cari_unvan1
FROM dbo.CARI_HESAPLAR c WITH (NOLOCK)
WHERE c.cari_kod NOT IN (
  SELECT h.sth_cari_kodu
  FROM dbo.STOK_HAREKETLERI h WITH (NOLOCK)
  WHERE h.sth_cari_kodu IS NOT NULL
);`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'CANDIDATE_GENERATED',
    allowedRewrite: 'Safe NOT EXISTS or explicit IS NOT NULL guard',
    forbiddenRewrite: 'Blind NOT EXISTS that alters empty set behavior when NULL is present',
    validationExpectation: 'EXACT_SEMANTICS_REQUIRED'
  },

  // 11. Repeated CTE Reference
  cteRepeatedReference: {
    key: 'cteRepeatedReference',
    title: 'Repeated Unmaterialized CTE References',
    sql: `WITH AggStok AS (
  SELECT sth_stok_kod, SUM(sth_tutar) AS tutar, COUNT(*) AS adet
  FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
  GROUP BY sth_stok_kod
)
SELECT s.sto_kod, a1.tutar, a2.adet
FROM dbo.STOKLAR s WITH (NOLOCK)
LEFT JOIN AggStok a1 ON s.sto_kod = a1.sth_stok_kod
LEFT JOIN AggStok a2 ON s.sto_kod = a2.sth_stok_kod AND a2.adet > 10;`,
    cosmeticCandidateSql: `WITH MyAggStok AS (
  SELECT sth_stok_kod, SUM(sth_tutar) AS tutar, COUNT(*) AS adet
  FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
  GROUP BY sth_stok_kod
)
SELECT s.sto_kod, a1.tutar, a2.adet
FROM dbo.STOKLAR s WITH (NOLOCK)
LEFT JOIN MyAggStok a1 ON s.sto_kod = a1.sth_stok_kod
LEFT JOIN MyAggStok a2 ON s.sto_kod = a2.sth_stok_kod AND a2.adet > 10;`,
    expectedRootCause: 'QUERY_SHAPE',
    expectedAiStatus: 'CANDIDATE_GENERATED',
    allowedRewrite: 'Consolidated single join with conditional logic',
    forbiddenRewrite: 'Renaming CTE',
    validationExpectation: 'PASS'
  },

  // 12. Window Function Heavy Case
  windowFunctionHeavy: {
    key: 'windowFunctionHeavy',
    title: 'Window Function Heavy Case with Multi-Column Partition',
    sql: `SELECT sth_stok_kod, sth_tarih, sth_tutar,
  ROW_NUMBER() OVER (PARTITION BY sth_stok_kod, sth_tip ORDER BY sth_tarih DESC) AS rn
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK);`,
    expectedRootCause: 'CARDINALITY',
    expectedAiStatus: 'INSUFFICIENT_EVIDENCE',
    allowedRewrite: 'Indexed partition alignment recommendation',
    forbiddenRewrite: 'Stripping ROW_NUMBER',
    validationExpectation: 'PASS'
  }
};

module.exports = {
  OPTIMIZER_FIXTURES
};
