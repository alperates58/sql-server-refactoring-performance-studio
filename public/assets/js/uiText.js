/**
 * SQL Server Refactoring & Performance Studio
 * Merkezi UI Sözlüğü ve Terim Haritası (Phase 2.6)
 *
 * Kurallar:
 * 1. Birincil kullanıcı dili tamamen Türkçedir.
 * 2. SQL Server teknik kavramları ve operatörleri parantez içinde veya teknik detay alanlarında korunur.
 * 3. Çıplak/karışık İngilizce etiket bırakılmaz.
 */

window.uiText = {
  navigation: {
    overview: 'Genel Bakış',
    views: 'View Envanteri',
    graph: 'Bağımlılık Haritası',
    runtime: 'Çalışma Zamanı ve Regresyon',
    ai: 'AI Refaktör',
    validation: 'Doğrulama Laboratuvarı',
    workbench: 'SQL Çalışma Alanı',
    tables: 'Tablo Baskısı',
    duplicates: 'Mükerrer Mantık',
    settings: 'Ayarlar'
  },

  labels: {
    selectedNode: 'Seçili Nesne',
    baseTable: 'Temel Tablo',
    dependencyPaths: 'Bağımlılık Yolları',
    criticalConsumers: 'Kritik Tüketiciler',
    repeatedAccessPath: 'Mükerrer Erişim Yolu',
    proofVerdict: 'Doğrulama Sonucu',
    candidateSql: 'Aday Sorgu',
    originalSql: 'Orijinal Sorgu',
    benchmarkProjection: 'Kıyaslama Projeksiyonu',
    analyzerFeed: 'Analiz Akışı',
    demoDataset: 'Demo Veri Kümesi',
    offline: 'Çevrimdışı',
    online: 'Canlı Bağlantı',
    readOnly: 'Salt-Okunur Denetim Modu',
    lastScan: 'Son Tarama',
    scanAction: 'Yeniden Tara',
    connectAction: 'Bağlantı'
  },

  severity: {
    CRITICAL: { label: 'KRİTİK', class: 'critical', desc: 'Acil müdahale gerektiren yüksek performans riski' },
    HIGH:     { label: 'YÜKSEK', class: 'high',     desc: 'Sistem kaynaklarını belirgin tüketen darboğaz' },
    MEDIUM:   { label: 'ORTA',   class: 'medium',   desc: 'Optimizasyon potansiyeli bulunan yapı' },
    LOW:      { label: 'DÜŞÜK',  class: 'low',      desc: 'İzlenmesi önerilen hafif bulgu' },
    WARNING:  { label: 'UYARI',  class: 'warning',  desc: 'Tasarım veya şema uyarısı' },
    INFO:     { label: 'BİLGİ',  class: 'info',     desc: 'Bilgilendirme notu' }
  },

  evidenceGrade: {
    A: { title: 'Çok Güçlü Kanıt', source: 'Query Store Verisi', desc: 'Doğrudan Query Store çalışma zamanı telemetrisine dayanır (Grade A)' },
    B: { title: 'Güçlü Kanıt',     source: 'Plan Cache / DMV',   desc: 'Sunucu önbelleğindeki derlenmiş plan ve DMV istatistiklerine dayanır (Grade B)' },
    D: { title: 'Tahmini Kanıt',   source: 'Statik SQL Analizi', desc: 'Katalog ve bağımlılık grafiği çıkarımına dayanır (Grade D)' }
  },

  operators: {
    'Clustered Index Scan': { tr: 'Kümelenmiş İndeks Taraması', en: 'Clustered Index Scan', icon: 'SCAN', desc: 'Tablonun fiziksel sıralı tüm yaprak sayfaları taranıyor.' },
    'Index Scan':           { tr: 'İndeks Taraması',           en: 'Index Scan',           icon: 'SCAN', desc: 'Nonclustered indeksin tüm yaprak sayfaları baştan sona okunuyor.' },
    'Index Seek':           { tr: 'İndeks Arama',             en: 'Index Seek',           icon: 'SEEK', desc: 'B-Tree indeksi üzerinden doğrudan hedeflenen satırlara erişiliyor.' },
    'Key Lookup':           { tr: 'Anahtar Araması',           en: 'Key Lookup',           icon: 'LOOKUP', desc: 'Nonclustered indekste bulunmayan kolonlar için ana tabloya ek okuma yapılıyor.' },
    'Table Scan':           { tr: 'Tablo Taraması',            en: 'Table Scan',           icon: 'SCAN', desc: 'İndeksi olmayan yığın (heap) tablonun tamamı okunuyor.' },
    'Nested Loops':         { tr: 'İç İçe Döngü Birleştirmesi', en: 'Nested Loops',        icon: 'JOIN', desc: 'Dış tablodaki her satır için iç tabloda eşleşenler aranıyor.' },
    'Hash Match':           { tr: 'Hash Eşleştirme',           en: 'Hash Match',           icon: 'JOIN', desc: 'Büyük veri setleri için bellekte hash tablosu kurularak birleştiriliyor.' },
    'Hash Match (Aggregate)': { tr: 'Hash Eşleştirme (Gruplama)', en: 'Hash Match (Aggregate)', icon: 'JOIN', desc: 'Gruplama ve toplama işlemleri hash tablosu üzerinden yapılıyor.' },
    'Merge Join':           { tr: 'Birleştirme Eşleştirmesi',  en: 'Merge Join',           icon: 'JOIN', desc: 'Her iki taraf da sıralı olduğunda en hızlı birleştirme operatörü.' },
    'Sort':                 { tr: 'Sıralama',                  en: 'Sort',                 icon: 'SORT', desc: 'Veriler bellek veya TempDB üzerinde sıralanıyor.' },
    'Spool':                { tr: 'Geçici Sonuç Saklama',      en: 'Table/Lazy Spool',     icon: 'SPOOL', desc: 'Tekrar eden ara sonuçlar geçici TempDB alanında tutuluyor.' },
    'Parallelism':          { tr: 'Paralel İşlem',             en: 'Parallelism',          icon: 'PARA', desc: 'Sorgu birden fazla CPU çekirdeğine dağıtılarak çalıştırılıyor.' }
  },

  findings: {
    MISSING_STATS: {
      tr: 'Bayat İstatistik',
      en: 'Stale Statistics',
      why: 'Verilerdeki değişim sonrasında istatistikler güncellenmediği için SQL Server yanlış kardinalite tahmininde bulunabilir.'
    },
    CARDINALITY_MISMATCH: {
      tr: 'Kardinalite Tahmin Hatası',
      en: 'Cardinality Estimation Error',
      why: 'Optimizatörün tahmin ettiği satır sayısı ile gerçek satır sayısı arasındaki fark yanlış join tipi (örn. Hash yerine Loops) seçilmesine yol açar.'
    },
    SPILL_TEMPDB: {
      tr: "TempDB'ye Taşma",
      en: 'TempDB Spill',
      why: 'Sorguya ayrılan bellek (memory grant) yetersiz kaldığı için veriler diske yazılmıştır; bu durum ciddi I/O gecikmesine neden olur.'
    },
    NON_SARGABLE: {
      tr: 'İndeks Aramasını Engelleyen İfade',
      en: 'Non-SARGable Expression',
      why: 'WHERE veya ON şartındaki kolon fonksiyon içine alındığı için indeks seek yapılamaz ve tüm tablo taranır.'
    },
    REPEATED_ACCESS: {
      tr: 'Mükerrer Tablo Erişimi',
      en: 'Repeated Base Table Access',
      why: 'Aynı ana tabloya birden çok view dalı üzerinden gereksiz yere tekrar tekrar erişilmektedir.'
    }
  },

  candidateStatus: {
    UNVALIDATED:            { label: 'DOĞRULANMADI',              class: 'status-unvalidated', desc: 'Aday sorgu henüz eşitlik testinden geçmedi' },
    PARTIALLY_VALIDATED:    { label: 'KISMEN DOĞRULANDI',         class: 'status-partial',     desc: 'Şema ve satır sayısı uyumlu, küme farkı bekleniyor' },
    SEMANTICALLY_VALIDATED: { label: 'SEMANTİK OLARAK DOĞRULANDI', class: 'status-validated',   desc: 'Şema, satır sayısı, EXCEPT ve satır çokluğu kanıtlandı' },
    BENCHMARKED:            { label: 'PERFORMANS TESTİ YAPILDI',  class: 'status-benchmarked', desc: 'IO ve süre iyileşmesi benchmark ile teyit edildi' },
    MISMATCH:               { label: 'SONUÇ UYUŞMUYOR',           class: 'status-mismatch',    desc: 'Aday sorgu orijinal sorgu ile farklı sonuç üretti' }
  },

  pipelineSteps: {
    READY:   { label: 'HAZIR',   class: 'step-ready' },
    WAITING: { label: 'BEKLİYOR', class: 'step-waiting' },
    RUNNING: { label: 'ÇALIŞIYOR', class: 'step-running' },
    PASS:    { label: 'BAŞARILI', class: 'step-pass' },
    FAIL:    { label: 'BAŞARISIZ', class: 'step-fail' }
  }
};
