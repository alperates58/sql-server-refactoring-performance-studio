window.STUDIO_MOCK = {
  selectedDatabases: ['MikroDB_V16_LIDER25', 'RAPOR_DB', 'MikroDB_V16_TEST'],
  primaryDatabase: 'MikroDB_V16_LIDER25',
  databaseSummaries: {
    'MikroDB_V16_LIDER25': { database: 'MikroDB_V16_LIDER25', status: 'FULL ACCESS', viewCount: 5, criticalCount: 2, highCount: 1, avgHealth: 54 },
    'RAPOR_DB': { database: 'RAPOR_DB', status: 'FULL ACCESS', viewCount: 5, criticalCount: 1, highCount: 2, avgHealth: 68 },
    'MikroDB_V16_TEST': { database: 'MikroDB_V16_TEST', status: 'FULL ACCESS', viewCount: 2, criticalCount: 0, highCount: 1, avgHealth: 72 }
  },
  views: [
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_URETIM_MALZEME_PLANLAMA',
      database: 'MikroDB_V16_LIDER25',
      schema: 'dbo',
      name: 'AA_URETIM_MALZEME_PLANLAMA',
      health: 38,
      risk: 'critical',
      riskScore: 92,
      depth: 6,
      tables: 9,
      dependents: 27,
      reads: '4.1B',
      median: '284s',
      modified: '03.09.2026 16:47'
    },
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_ISEMRI_MALZEME_DURUMLARI',
      database: 'MikroDB_V16_LIDER25',
      schema: 'dbo',
      name: 'AA_ISEMRI_MALZEME_DURUMLARI',
      health: 44,
      risk: 'critical',
      riskScore: 88,
      depth: 5,
      tables: 7,
      dependents: 18,
      reads: '2.7B',
      median: '96s',
      modified: '02.09.2026 14:10'
    },
    {
      canonicalId: 'RAPOR_DB.dbo.AA_STOK_HAREKET_OZET',
      database: 'RAPOR_DB',
      schema: 'dbo',
      name: 'AA_STOK_HAREKET_OZET',
      health: 49,
      risk: 'high',
      riskScore: 76,
      depth: 4,
      tables: 5,
      dependents: 31,
      reads: '1.8B',
      median: '18.4s',
      modified: '28.08.2026 11:33'
    },
    {
      canonicalId: 'MikroDB_V16_TEST.dbo.AA_ldrprog_mamulstoklar',
      database: 'MikroDB_V16_TEST',
      schema: 'dbo',
      name: 'AA_ldrprog_mamulstoklar',
      health: 56,
      risk: 'high',
      riskScore: 69,
      depth: 4,
      tables: 6,
      dependents: 22,
      reads: '984M',
      median: '8.2s',
      modified: '30.08.2026 09:18'
    },
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_ldrprog_yurtiçi_genel',
      database: 'MikroDB_V16_LIDER25',
      schema: 'dbo',
      name: 'AA_ldrprog_yurtiçi_genel',
      health: 61,
      risk: 'high',
      riskScore: 65,
      depth: 3,
      tables: 8,
      dependents: 14,
      reads: '812M',
      median: '5.1s',
      modified: '27.08.2026 15:42'
    },
    {
      canonicalId: 'RAPOR_DB.dbo.AA_STOK_DURUMU',
      database: 'RAPOR_DB',
      schema: 'dbo',
      name: 'AA_STOK_DURUMU',
      health: 58,
      risk: 'high',
      riskScore: 63,
      depth: 4,
      tables: 6,
      dependents: 29,
      reads: '702M',
      median: '4.8s',
      modified: '25.08.2026 10:04'
    },
    {
      canonicalId: 'RAPOR_DB.dbo.AA_SIPARIS_KALAN',
      database: 'RAPOR_DB',
      schema: 'dbo',
      name: 'AA_SIPARIS_KALAN',
      health: 71,
      risk: 'medium',
      riskScore: 48,
      depth: 3,
      tables: 4,
      dependents: 17,
      reads: '388M',
      median: '2.6s',
      modified: '22.08.2026 08:51'
    },
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_URETIM_EMIRLERI',
      database: 'MikroDB_V16_LIDER25',
      schema: 'dbo',
      name: 'AA_URETIM_EMIRLERI',
      health: 67,
      risk: 'medium',
      riskScore: 46,
      depth: 3,
      tables: 5,
      dependents: 12,
      reads: '344M',
      median: '2.1s',
      modified: '21.08.2026 17:20'
    },
    {
      canonicalId: 'RAPOR_DB.dbo.AA_DEPO_BAKIYE',
      database: 'RAPOR_DB',
      schema: 'dbo',
      name: 'AA_DEPO_BAKIYE',
      health: 76,
      risk: 'medium',
      riskScore: 38,
      depth: 2,
      tables: 3,
      dependents: 8,
      reads: '202M',
      median: '1.4s',
      modified: '19.08.2026 12:14'
    },
    {
      canonicalId: 'MikroDB_V16_TEST.dbo.AA_CARI_SIPARIS_OZET',
      database: 'MikroDB_V16_TEST',
      schema: 'dbo',
      name: 'AA_CARI_SIPARIS_OZET',
      health: 84,
      risk: 'low',
      riskScore: 22,
      depth: 2,
      tables: 3,
      dependents: 5,
      reads: '74M',
      median: '0.8s',
      modified: '11.08.2026 13:21'
    },
    {
      canonicalId: 'RAPOR_DB.dbo.AA_URUN_AGACI',
      database: 'RAPOR_DB',
      schema: 'dbo',
      name: 'AA_URUN_AGACI',
      health: 88,
      risk: 'low',
      riskScore: 18,
      depth: 2,
      tables: 4,
      dependents: 9,
      reads: '66M',
      median: '0.6s',
      modified: '09.08.2026 16:36'
    },
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.AA_DEPO_LISTESI',
      database: 'MikroDB_V16_LIDER25',
      schema: 'dbo',
      name: 'AA_DEPO_LISTESI',
      health: 93,
      risk: 'low',
      riskScore: 11,
      depth: 1,
      tables: 1,
      dependents: 3,
      reads: '12M',
      median: '0.2s',
      modified: '03.08.2026 09:12'
    }
  ],
  pressures: [
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.STOK_HAREKETLERI',
      database: 'MikroDB_V16_LIDER25',
      name: 'STOK_HAREKETLERI',
      refs: 183,
      paths: 647,
      critical: 27,
      score: 96,
      repeated: 94
    },
    {
      canonicalId: 'RAPOR_DB.dbo.STOK_HAREKETLERI',
      database: 'RAPOR_DB',
      name: 'STOK_HAREKETLERI',
      refs: 112,
      paths: 320,
      critical: 14,
      score: 78,
      repeated: 42
    },
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.STOKLAR',
      database: 'MikroDB_V16_LIDER25',
      name: 'STOKLAR',
      refs: 211,
      paths: 522,
      critical: 18,
      score: 84,
      repeated: 62
    },
    {
      canonicalId: 'RAPOR_DB.dbo.STOKLAR',
      database: 'RAPOR_DB',
      name: 'STOKLAR',
      refs: 94,
      paths: 180,
      critical: 8,
      score: 61,
      repeated: 19
    },
    {
      canonicalId: 'MikroDB_V16_LIDER25.dbo.ISEMIRLERI',
      database: 'MikroDB_V16_LIDER25',
      name: 'ISEMIRLERI',
      refs: 74,
      paths: 241,
      critical: 16,
      score: 71,
      repeated: 37
    },
    {
      canonicalId: 'RAPOR_DB.dbo.SIPARISLER',
      database: 'RAPOR_DB',
      name: 'SIPARISLER',
      refs: 96,
      paths: 218,
      critical: 11,
      score: 65,
      repeated: 22
    }
  ],
  problems: [
    { symbol: '⇄', title: 'Mükerrer Tablo Erişimi (Repeated Table Access)', detail: 'STOK_HAREKETLERI tablosuna 4 farklı mantıksal koldan tekrar tekrar erişiliyor.', severity: 'CRITICAL', penalty: 18 },
    { symbol: '∿', title: 'Performans Regresyonu (Performance Regression)', detail: 'Ortanca süre 0.94s seviyesinden 284s seviyesine yükseldi (+30,112%).', severity: 'CRITICAL', penalty: 16 },
    { symbol: '∞', title: 'Çapraz DB Bağımlılık Derinliği (Cross-DB Depth)', detail: '6 seviyeli derin çapraz veritabanı ağacı.', severity: 'HIGH', penalty: 9 },
    { symbol: 'ƒ', title: 'İndeks Aramasını Engelleyen İfadeler (Non-SARGable)', detail: 'Filtre veya JOIN koşullarında indeks kullanımını engelleyen CONVERT / ISNULL kalıpları.', severity: 'HIGH', penalty: 8 },
    { symbol: '≋', title: 'Kardinalite Tahmin Hatası (Cardinality Mismatch)', detail: 'Tahmin: 1 satır, Gerçek: 187,431 satır (Nested Loops darboğazı).', severity: 'CRITICAL', penalty: 16 },
    { symbol: '⊛', title: 'Geniş Etki Alanı (Large Blast Radius)', detail: '3 farklı veritabanındaki 27 bağımlı nesne etkileniyor.', severity: 'MEDIUM', penalty: 5 }
  ],
  riskBars: [
    { label: 'Runtime / Regresyon', value: 92, penalty: 16 },
    { label: 'Mükerrer Erişim', value: 86, penalty: 18 },
    { label: 'Çapraz DB Derinlik', value: 68, penalty: 9 },
    { label: 'SARG Uyumluluğu', value: 59, penalty: 8 },
    { label: 'Etki Alanı (Blast Radius)', value: 54, penalty: 5 }
  ],
  plans: [
    { time: '03.09.2026 17:09', title: 'Plan #8812 · aktif', detail: 'Nested Loops + Anahtar Araması (Key Lookup) · ortalama 3.48M logical read', state: 'Regresyon +30,112%' },
    { time: '03.09.2026 08:14', title: 'Plan #8779 · önceki iyi plan', detail: 'Hash Match + İndeks Araması (Index Seek) · ortalama 41.2K logical read', state: '0.94s ortanca' },
    { time: '02.09.2026 14:45', title: 'Plan #8712', detail: 'Hash Match + Paralellik · ortalama 48.7K logical read', state: '1.08s ortanca' }
  ],
  regressions: [
    { name: 'AA_URETIM_MALZEME_PLANLAMA', database: 'MikroDB_V16_LIDER25', before: '0.94s', now: '284s', delta: '+30,112%', reads: '3.48M', evidence: 'A' },
    { name: 'AA_ISEMRI_MALZEME_DURUMLARI', database: 'MikroDB_V16_LIDER25', before: '1.8s', now: '96s', delta: '+5,233%', reads: '1.92M', evidence: 'A' },
    { name: 'AA_STOK_HAREKET_OZET', database: 'RAPOR_DB', before: '2.4s', now: '18.4s', delta: '+667%', reads: '882K', evidence: 'B' },
    { name: 'AA_ldrprog_mamulstoklar', database: 'MikroDB_V16_TEST', before: '1.6s', now: '8.2s', delta: '+413%', reads: '741K', evidence: 'A' },
    { name: 'AA_URETIM_EMIRLERI', database: 'MikroDB_V16_LIDER25', before: '0.7s', now: '2.1s', delta: '+200%', reads: '318K', evidence: 'B' }
  ],
  duplicates: [
    { similarity: 94, a: 'AA_ldrprog_stokrapor', b: 'AA_ldrprog_stokrapor2', common: ['STOKLAR', 'STOK_HAREKETLERI', 'DEPOLAR'], diff: 'Warehouse filter' },
    { similarity: 91, a: 'AA_MALZEME_DURUM', b: 'AA_MALZEME_DURUM_YENI', common: ['ISEMIRLERI', 'STOKLAR', 'URETIM_MALZEME_PLANLAMA'], diff: 'Additional status column' }
  ],
  sql: `CREATE VIEW [dbo].[AA_URETIM_MALZEME_PLANLAMA]
AS
SELECT
    a.[Ana İş Emri],
    a.[İş Kodu],
    a.[Sipariş No],
    a.[Ürün Kodu],
    a.[Ürün Adı],
    ISNULL(i.[Kalan Miktar], 0) AS [Kalan Miktar],
    a.Seviye,
    u.upl_kodu AS [Tüketim Kod],
    s.sto_isim AS [Tüketim Ad],
    (u.upl_miktar / NULLIF(u.upl_uret_miktar, 0)) AS [Birim Tüketim]
FROM dbo.AA_URETIM_AGACI AS a
LEFT JOIN dbo.AA_ISEMRI_MALZEME_DURUMLARI AS i
    ON i.[İş Kodu] = a.[İş Kodu]
LEFT JOIN [RAPOR_DB].dbo.URETIM_MALZEME_PLANLAMA AS u
    ON u.upl_isemri = a.[İş Kodu]
LEFT JOIN [RAPOR_DB].dbo.STOKLAR AS s
    ON s.sto_kod = u.upl_kodu;`,
  timeseries: {
    source: 'QUERY_STORE',
    window: '24h',
    database: 'MikroDB_V16_LIDER25',
    points: [
      { bucketStart: '2026-09-21T12:00:00Z', avgDurationMs: 42, executionCount: 142, totalReads: 51200 },
      { bucketStart: '2026-09-21T13:00:00Z', avgDurationMs: 48, executionCount: 168, totalReads: 62400 },
      { bucketStart: '2026-09-21T14:00:00Z', avgDurationMs: 65, executionCount: 215, totalReads: 89300 },
      { bucketStart: '2026-09-21T15:00:00Z', avgDurationMs: 142, executionCount: 384, totalReads: 341000 },
      { bucketStart: '2026-09-21T16:00:00Z', avgDurationMs: 198, executionCount: 420, totalReads: 482000 },
      { bucketStart: '2026-09-21T17:00:00Z', avgDurationMs: 110, executionCount: 290, totalReads: 195000 },
      { bucketStart: '2026-09-21T18:00:00Z', avgDurationMs: 52, executionCount: 112, totalReads: 58000 },
      { bucketStart: '2026-09-21T19:00:00Z', avgDurationMs: 38, executionCount: 75, totalReads: 31000 },
      { bucketStart: '2026-09-21T20:00:00Z', avgDurationMs: 35, executionCount: 42, totalReads: 18000 },
      { bucketStart: '2026-09-21T21:00:00Z', avgDurationMs: 32, executionCount: 35, totalReads: 14000 },
      { bucketStart: '2026-09-21T22:00:00Z', avgDurationMs: 30, executionCount: 28, totalReads: 11000 },
      { bucketStart: '2026-09-21T23:00:00Z', avgDurationMs: 30, executionCount: 22, totalReads: 9500 },
      { bucketStart: '2026-09-22T00:00:00Z', avgDurationMs: 29, executionCount: 18, totalReads: 8200 },
      { bucketStart: '2026-09-22T01:00:00Z', avgDurationMs: 31, executionCount: 19, totalReads: 8400 },
      { bucketStart: '2026-09-22T02:00:00Z', avgDurationMs: 33, executionCount: 21, totalReads: 9100 },
      { bucketStart: '2026-09-22T03:00:00Z', avgDurationMs: 36, executionCount: 25, totalReads: 11200 },
      { bucketStart: '2026-09-22T04:00:00Z', avgDurationMs: 40, executionCount: 38, totalReads: 16800 },
      { bucketStart: '2026-09-22T05:00:00Z', avgDurationMs: 48, executionCount: 65, totalReads: 28400 },
      { bucketStart: '2026-09-22T06:00:00Z', avgDurationMs: 82, executionCount: 180, totalReads: 89000 },
      { bucketStart: '2026-09-22T07:00:00Z', avgDurationMs: 164, executionCount: 395, totalReads: 410000 },
      { bucketStart: '2026-09-22T08:00:00Z', avgDurationMs: 220, executionCount: 480, totalReads: 615000 },
      { bucketStart: '2026-09-22T09:00:00Z', avgDurationMs: 185, executionCount: 430, totalReads: 520000 },
      { bucketStart: '2026-09-22T10:00:00Z', avgDurationMs: 140, executionCount: 370, totalReads: 380000 },
      { bucketStart: '2026-09-22T11:00:00Z', avgDurationMs: 125, executionCount: 340, totalReads: 315000 }
    ]
  }
};
