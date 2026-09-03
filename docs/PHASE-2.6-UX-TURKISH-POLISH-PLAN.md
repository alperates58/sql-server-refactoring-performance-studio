# Phase 2.6 — UX, Türkçeleştirme & Premium Polish Uygulama Planı (Revize)

## 1. Giriş ve Kapsam

Phase 2.5 ile multi-database çekirdek mimarisi, SQL Workbench şema-duyarlı IntelliSense motoru ve Light Theme altyapısı tamamlandı.

**Phase 2.6'nın temel amacı:**
Mevcut çalışan backend, multi-database mimarisi ve SQL execution motoruna **kesinlikle dokunmadan**; uygulamanın kullanıcıya dönük tüm yüzeylerini, bilgi hiyerarşisini, görsel kalitesini, menülerini ve teşhis kartlarını birinci sınıf bir mühendislik stüdyosu seviyesine taşımak ve **tamamen Türkçe** hale getirmektir.

---

## 2. Öncelik Sıralaması (P0 / P1 / P2)

Kullanıcının belirlediği zorunlu öncelik matrisi:

### P0 (Kritik & Birinci Öncelik)
1. **Light Theme Baştan Polish**: Sadece dark temanın tersine çevrilmesi değil; Linear / GitHub / DataGrip Light çizgisinde bağımsız, yumuşak sınırlı, kontrollü gölgeli, birinci sınıf açık tema.
2. **Sol Menü ve Tüm Ana Modüllerin Tam Türkçeleştirilmesi**: Karışık İngilizce/Türkçe kalmayacak, tüm ana modül başlıkları ve sidebar butonları Türkçe olacak.
3. **Validation Lab Tam Yeniden Düzenlenmesi**: Boşlukların giderilmesi, geniş çift sütunlu karşılaştırma editörleri, sabit doğrulama özet kartı ve kademeli 4 aşamalı pipeline kartları.
4. **Table Pressure Ekranının Yeniden Tasarlanması**: Ham kart/uzun progress bar listesi yerine üst KPI şeridi + interaktif grid/tablo + sağ inspector paneli.
5. **Bağımlılık Haritası Inspector Kapatılabilmesi**: Sağ inspector paneline kapatma (✕) butonu, ESC tuşu desteği, boş canvas tıklaması ile kapanma ve tekrar seçimde açılma.

### P1 (Yüksek Öncelik)
6. **View Inventory & Problem Kartları**: [KRİTİK/YÜKSEK] rozeti, Başlık, Kısa Açıklama, Neden Önemli?, Bulgu & Kanıt, Ne Yapılabilir? ve 1-tıklamayla aksiyon butonları (`[Haritayı Aç]`, `[SQL'i Gör]`, `[AI ile İncele]`).
7. **Execution Plan Görünümü**: Plan özeti (Maliyet, Operatör), Kardinalite Tahmin Hatası ve TempDB taşması blokları, Türkçe operatör sözlüğü ve DBA onay uyarılı İndeks Önerileri.
8. **Runtime & Regresyon Polish**: Kök neden olasılık kartları (%92 Bayat İstatistik, %87 Plan Değişimi, %74 Parametre Hassasiyeti) ve Kanıt Gücü rozetleri (Grade A / Çok Güçlü, Grade B / Güçlü).
9. **AI Refactor Ekranı**: 4 mantıksal bölme (Hedef Özeti, Mevcut SQL, Analiz Kapsamı Onay Kutuları, Yapılandırılmış Türkçe AI Çıktısı ve `DOĞRULANMADI` aday paneli).
10. **Duplicate Logic Ekranı**: %94 benzerlik çift kartları, ortak nesneler, temel fark ve yan yana SQL/bağımlılık karşılaştırma butonları.

### P2 (İnce İşçilik & Cilalama)
11. Tooltip açıklamaları (Logical reads, CPU time, Subtree cost, Blast radius).
12. Mikro metin düzeltmeleri (Demo Dataset $\rightarrow$ Demo Veri Kümesi, Offline $\rightarrow$ Çevrimdışı vb.).
13. Global visual consistency (tüm modüllerde standart card radius, border, font boyutu ve spacing).

---

## 3. Regresyon Risk Analizi ve Güvenlik Önlemleri

| Alt Sistem | Potansiyel Risk | Önlem & Koruma Stratejisi |
| :--- | :--- | :--- |
| **Backend & Veritabanı Havuzları** | API parametre veya rota adlarının değişmesi. | `server/` dizinindeki servislere (`sqlServer.js`, `scanner.js`, `dependencyEngine.js`, `workbenchService.js`) **kesinlikle dokunulmaz**. |
| **DOM Element ID'leri** | Event listener'ların bağlı olduğu ID'lerin değişerek `Ctrl+Enter`, `F5`, `Ctrl+L` veya tarama akışlarını bozması. | Mevcut tüm ID'ler (`#btnWbRun`, `#btnWbEstPlan`, `#wbSqlInput`, `#wbDatabaseSelect`, `#viewSearch`, `#scanButton`) %100 korunur. |
| **Validation Lab Pipeline** | State kodlarının (`UNVALIDATED`, `SEMANTICALLY_VALIDATED`, `MISMATCH`) değişmesi. | Dahili state makinesi string kodları aynı kalır; arayüz metinleri `uiText.candidateStatus[state]` üzerinden map edilir. |
| **ShowPlan XML Parser** | Backend parser çıktısındaki anahtarların değişmesi. | `planParser.js` dahili anahtarları korunur; operatör eşlemeleri sunum anında `uiText.operators[op.physicalOp]` üzerinden yapılır. |
| **Graph Inspector Kapatma** | Inspector DOM'unun kaldırılıp tekrar açılırken event listener'ların kopması. | Inspector DOM'dan silinmez; `.hidden` sınıfı eklenip çıkarılarak CSS geçişi ile yönetilir. |

---

## 4. Merkezi UI Sözlüğü (`public/assets/js/uiText.js`)

Merkezi Türkçe sözlük mimarisi:

```javascript
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
    online: 'Bağlı · Canlı',
    readOnly: 'Salt-Okunur Denetim Modu'
  },

  severity: {
    CRITICAL: { label: 'KRİTİK', class: 'critical', desc: 'Acil müdahale gerektiren yüksek performans riski' },
    HIGH:     { label: 'YÜKSEK', class: 'high',     desc: 'Sistem kaynaklarını belirgin tüketen dar boğaz' },
    MEDIUM:   { label: 'ORTA',   class: 'medium',   desc: 'Optimizasyon potansiyeli bulunan yapı' },
    LOW:      { label: 'DÜŞÜK',  class: 'low',      desc: 'İzlenmesi önerilen hafif bulgu' },
    WARNING:  { label: 'UYARI',  class: 'warning',  desc: 'Tasarım veya şema uyarısı' },
    INFO:     { label: 'BİLGİ',  class: 'info',     desc: 'Bilgilendirme notu' }
  },

  evidenceGrade: {
    A: { title: 'Çok Güçlü Kanıt', source: 'Query Store Verisi', desc: 'Gerçek çalışma zamanı telemetrisine dayanır (Grade A)' },
    B: { title: 'Güçlü Kanıt',     source: 'Plan Cache / DMV',   desc: 'Sunucu önbelleğindeki derlenmiş plan verisine dayanır (Grade B)' },
    D: { title: 'Tahmini / Heuristik', source: 'Statik SQL Analizi', desc: 'Katalog ve bağımlılık grafiği çıkarımına dayanır (Grade D)' }
  },

  operators: {
    'Clustered Index Scan': { tr: 'Kümelenmiş İndeks Taraması', en: 'Clustered Index Scan', icon: 'SCAN', desc: 'Tablonun fiziksel sıralı tüm yaprak sayfaları taranıyor.' },
    'Index Scan':           { tr: 'İndeks Taraması',           en: 'Index Scan',           icon: 'SCAN', desc: 'Nonclustered indeksin tüm yaprak sayfaları okunuyor.' },
    'Index Seek':           { tr: 'İndeks Arama',             en: 'Index Seek',           icon: 'SEEK', desc: 'B-Tree indeksi üzerinden doğrudan ilgili satırlara erişiliyor.' },
    'Key Lookup':           { tr: 'Anahtar Araması',           en: 'Key Lookup',           icon: 'LOOKUP', desc: 'Nonclustered indekste olmayan kolonlar için ana tabloya ek okuma yapılıyor.' },
    'Table Scan':           { tr: 'Tablo Taraması',            en: 'Table Scan',           icon: 'SCAN', desc: 'İndeksi olmayan tablonun tüm satırları baştan sona okunuyor.' },
    'Nested Loops':         { tr: 'İç İçe Döngü Birleştirmesi', en: 'Nested Loops',        icon: 'JOIN', desc: 'Dış tablodaki her satır için iç tabloda eşleşenler aranıyor.' },
    'Hash Match':           { tr: 'Hash Eşleştirme',           en: 'Hash Match',           icon: 'JOIN', desc: 'Büyük veri setleri için bellekte hash tablosu kurularak birleştiriliyor.' },
    'Merge Join':           { tr: 'Birleştirme Eşleştirmesi',  en: 'Merge Join',           icon: 'JOIN', desc: 'Her iki taraf da sıralı olduğunda en hızlı birleştirme operatörü.' },
    'Sort':                 { tr: 'Sıralama',                  en: 'Sort',                 icon: 'SORT', desc: 'Veriler bellek veya TempDB üzerinde sıralanıyor.' },
    'Spool':                { tr: 'Geçici Sonuç Saklama',      en: 'Table/Lazy Spool',     icon: 'SPOOL', desc: 'Tekrar eden ara sonuçlar geçici TempDB alanında tutuluyor.' },
    'Parallelism':          { tr: 'Paralel İşlem',             en: 'Parallelism',          icon: 'PARA', desc: 'Sorgu birden fazla CPU çekirdeğine dağıtılarak çalıştırılıyor.' }
  },

  candidateStatus: {
    UNVALIDATED:            { label: 'DOĞRULANMADI',              class: 'status-unvalidated', desc: 'Aday sorgu henüz eşitlik testinden geçmedi' },
    PARTIALLY_VALIDATED:    { label: 'KISMEN DOĞRULANDI',         class: 'status-partial',     desc: 'Şema ve satır sayısı uyumlu, küme farkı bekleniyor' },
    SEMANTICALLY_VALIDATED: { label: 'SEMANTİK OLARAK DOĞRULANDI', class: 'status-validated',   desc: 'Şema, satır sayısı, EXCEPT ve satır çokluğu kanıtlandı' },
    BENCHMARKED:            { label: 'PERFORMANS TESTİ YAPILDI',  class: 'status-benchmarked', desc: 'IO ve süre iyileşmesi benchmark ile teyit edildi' },
    MISMATCH:               { label: 'SONUÇ UYUŞMUYOR',           class: 'status-mismatch',    desc: 'Aday sorgu orijinal sorgu ile farklı sonuç üretti' }
  }
};
```

---

## 5. P0 Detaylı Uygulama Tasarımları

### 5.1. Light Theme Baştan Polish
Açık tema sadece renk tersine çevirme değil, bağımsız bir tasarım dili olarak yapılandırılacaktır:
- **Yüzey Katmanları (Surface Elevation)**:
  - `--bg: #f8fafc` (Modern soft canvas)
  - `--surface: #ffffff` (Kartlar, paneller, modal)
  - `--surface2: #f1f5f9` (Tablo başlıkları, alt şeritler)
  - `--surface3: #e2e8f0` (Bileşen ayraçları)
  - `--line: #e2e8f0`, `--line2: #cbd5e1` (Hafif, net sınırlar)
- **Kontrollü Gölgeler (Soft Elevations)**:
  - `--shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.03)`
  - `--shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.05)`
- **Tipografi Kontrastı**:
  - `--text-primary: #0f172a` (Koyu lacivert-siyah, net okunurluk)
  - `--text-secondary: #334155` (İkincil açıklamalar)
  - `--text-muted: #64748b` (Meta etiketler)
- **Vurgu ve Durum Renkleri**:
  - Mor: `#6366f1` (Açık zeminde kontrastı yüksek indigo)
  - Tehlike: `#dc2626` (Kırmızı zemin yerine kırmızı border + yumuşak pastel arka plan)
  - Başarı: `#059669`, Uyarı: `#d97706`
- **Tüm Bileşenlerin Kontrolü**:
  - Tablo satır hover durumları
  - Command Palette (`Ctrl+K`)
  - IntelliSense dropdown popup
  - Grafikler (SVG eksenleri ve çizgileri)
  - Modal arka plan overlay'i
  - Kod editörleri ve gutter alanları

### 5.2. Sol Menü & Modül Adları
`public/index.html` ve `public/assets/js/app.js` içerisindeki tüm menü ve başlıklar:
1. `Genel Bakış` (Overview)
2. `View Envanteri` (View Inventory)
3. `Bağımlılık Haritası` (Dependency Graph)
4. `Çalışma Zamanı ve Regresyon` (Runtime & Regression)
5. `AI Refaktör` (AI Refactor)
6. `Doğrulama Laboratuvarı` (Validation Lab)
7. `SQL Çalışma Alanı` (SQL Workbench)
8. `Tablo Baskısı` (Table Pressure)
9. `Mükerrer Mantık` (Duplicate Logic)
10. `Ayarlar` (Settings)

### 5.3. Bağımlılık Haritası Inspector Kapatılabilmesi
- **DOM**: `.graph-inspector` başlığına `<button class="icon-button close-btn" id="closeInspectorBtn" title="Kapat (Esc)">✕</button>` eklenecektir.
- **Kapatma Mantığı**:
  - Butona tıklandığında `.graph-inspector` üzerine `hidden` sınıfı eklenir.
  - Klavyeden `Escape` tuşuna basıldığında panel kapanır.
  - Haritanın boş canvas alanına tıklandığında panel kapanır.
  - Başka bir düğüme tıklandığında panel açık kalır ve içeriği yeni nesne ile güncellenir; kapalıysa yeniden görünür hale gelir.
- **İçerik & Başlık**:
  - Başlık: `Seçili Nesne`
  - Rozet: `VIEW`, `TEMEL TABLO`, `SYNONYM`, `DIŞ KAPSAM`, `BAĞLI SUNUCU`
  - Aksiyon Butonları: `[Detayı Aç]`, `[SQL'i Gör]`, `[Bağımlılıkları İncele]`, `[Tablo Baskısında Aç]`

### 5.4. Validation Lab Yeniden Tasarımı
- **Üst Başlık Alanı**:
  - Sol: Başlık (`Doğrulama Laboratuvarı`), alt açıklama (`Semantik Eşitlik ve Regresyon Kanıtlama Stüdyosu`).
  - Sağ: Büyük Hüküm Rozeti (`DOĞRULANMADI`, `SEMANTİK OLARAK KANITLANDI`, `SONUÇ UYUŞMUYOR`) + Aksiyon Butonları (`[Örnekleri Yükle]`, `[İki Sorguyu Doğrula]`, `[Temizle]`).
- **Ana Karşılaştırma Alanı (Yan Yana Çift Editör)**:
  - Sol Kolon: `Orijinal Sorgu (V1)` $\rightarrow$ Araç çubuğu: Kopyala, Workbench'e Gönder, Planı Çek. Geniş editör yüksekliği.
  - Sağ Kolon: `Aday Sorgu (V2)` $\rightarrow$ Araç çubuğu: Kopyala, Workbench'e Gönder, Planı Çek. Geniş editör yüksekliği.
- **Doğrulama Özeti Sabit Kartı**:
  - `Şema Eşleşmesi` (sp_describe_first_result_set)
  - `Satır Sayısı Eşleşmesi` (Row Count Match)
  - `Çift Yönlü Küme Farkı` (Bounded EXCEPT Proof)
  - `Satır Çokluğu Güvencesi` (Multiplicity Proof)
  - `Genel Sonuç`
- **Alt Alan (4 Aşamalı Pipeline Kartları)**:
  - 4 aşama ayrı premium kartlar halinde durum rozetleri taşır (`HAZIR`, `BEKLİYOR`, `ÇALIŞIYOR`, `BAŞARILI`, `BAŞARISIZ`).
- **Performans Kıyaslama (Benchmark)**:
  - Ayrı bir premium kart olarak yer alır; median süre, P95 ve mantıksal okuma farklarını karşılaştırır.

### 5.5. Table Pressure (Tablo Baskısı) Yeniden Tasarımı
- **Üst KPI Şeridi**:
  - `Toplam Temel Tablo`: 18
  - `Yüksek Baskılı Tablo`: 4
  - `Kritik Tüketici View`: 37
  - `Mükerrer Erişim Yolu`: 94
- **Ana Veri Tablosu**:
  - `Tablo Adı` | `Veritabanı` | `Risk Skoru` | `Kullanan View Sayısı` | `Bağımlılık Yolu (Paths)` | `Mükerrer Yol` | `Kritik Tüketici` | `Son Kanıt` | `Aksiyon`
  - Satıra tıklandığında satır aktif olur ve sağ inspector açılır.
- **Sağ Inspector Paneli**:
  - Başlık: `STOK_HAREKETLERI (MikroDB_V16_LIDER25.dbo)`
  - *Neden Yüksek Baskı Var?*: 183 farklı view doğrudan veya dolaylı olarak bu tabloya erişiyor.
  - *En Çok Kullanan View'lar*: `AA_URETIM_MALZEME_PLANLAMA` (4 path), `AA_ISEMRI_MALZEME_DURUMLARI` (2 path)...
  - *Mükerrer Erişim Örnekleri*
  - *İndeks ve İstatistik Durumu*
  - *Aksiyonlar*: `[Bağımlılık Haritasında Aç]`, `[Kullanan View'ları Listele]`, `[İndeksleri Görüntüle]`, `[SQL Workbench'te İncele]`

---

## 6. Doğrulama ve Kabul Kriterleri

1. **Light Theme**:
   - 10 ana ekranın tamamında tutarlı ve premium kontrast.
   - Hiçbir kartta veya popup'ta okunaksız koyu arka plan kalmaması.
2. **Türkçe Tutarlılık**:
   - Sol menünün tamamı Türkçe.
   - Modül başlıkları ve aksiyon butonları tamamen Türkçe.
   - Teknik SQL Server terimleri parantez içinde korunmuş.
3. **Validation Lab**:
   - Boşluk ve hizalama hatalarının olmaması; editörlerin geniş, butonların erişilebilir olması.
4. **Table Pressure**:
   - Grid tablonun ve sağ inspector'ın akıcı şekilde çalışması.
5. **Dependency Inspector**:
   - Kapatma (✕) butonu ve `Esc` tuşu ile kapanması; başka düğüm seçilince güncellenerek açılması.
6. **Regresyon Testleri**:
   - `test_intellisense_and_theme.js` (12 test)
   - `test_phase2_5_multidb.js` (10 test)
   - `test_phase2_all.js` (10 test)
   - `test_validator.js` (12 test)
   - `test_plan_parser.js`
   - `node -c` syntax kontrolleri.
7. **Görsel Doğrulama Raporu**:
   - `walkthrough.md` içine Dark ve Light tema ekran özetleri, Validation Lab ve Table Pressure before/after açıklamaları eklenecek.
