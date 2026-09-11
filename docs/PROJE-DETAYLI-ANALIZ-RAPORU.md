# SQL Server Refactoring & Performance Studio
## Kapsamlı Mimari, Kaynak Kod ve Ürün Olgunluk Denetim Raporu

**Hedef Kitle:** Kıdemli Yazılım Mimarı (Lead Software Architect) & Kıdemli Ürün Geliştirici (Product Lead)  
**Tarih:** 11 Eylül 2026  
**Durum:** Kod Tabanı Doğrulama ve Devir Analizi (Statik Kod Denetimi & Çalışma Zamanı Mimarisi İncelemesi)  
**Proje Deposu:** `sql-server-refactoring-performance-studio`

---

### YÖNETİCİ ÖZETİ

Bu rapor, **SQL Server Refactoring & Performance Studio** projesinin tüm kaynak kodları (`server/`, `public/`, `sql/`, `runtime/`, `docs/`) satır satır incelenerek, iddia edilen yetenekler ile arka planda gerçekten çalışan kodlar arasındaki farkları ortaya koymak amacıyla hazırlanmıştır.

**Temel Çıkarım:**
Proje, SQL Server veritabanlarında görünürlük ve refactoring süreçlerini kolaylaştırmak amacıyla tasarlanmış, görsel dili güçlü bir prototiptir. Çoklu veritabanı havuz yönetimi (`sqlServer.js`), parametrik ShowPlan XML çekilmesi (`workbenchService.js`), `sp_describe_first_result_set` ve `EXCEPT` tabanlı semantik doğrulama (`validationService.js`) ve Express-MSSQL altyapısı mevcuttur. 

Ancak derinlemesine kod analizinde; **aktif regresyon tespitinin canlı veride çalışmayıp rastgele sayı ürettiği (`Math.random()`)**, **genel bakıştaki 24 saatlik regresyon grafiğinin statik bir SVG çizimi olduğu**, **bazı detay sekmelerinin sabit kodlanmış (hardcoded) HTML metinlerinden ibaret kaldığı**, **risk ağırlık ayarlarının hesaplama motoruna bağlanmadığı** ve **SQL parse işlemlerinin AST yerine Regex ile yapıldığı** tespit edilmiştir.

---

### 1. PROJENİN GENEL AMACI

- **Şu Anki Gerçek Amacı:**  
  SQL Server üzerinde belirli bir önekle (`AA_%`) başlayan view tanımlarını katalog metaverisinden (`sys.views`, `sys.sql_expression_dependencies`, `sys.synonyms`) okuyarak bağımlılık haritası çıkaran, temel tablo erişimlerini sayan, DeepSeek/OpenAI uyumlu REST API ile yapay zekaya SQL refaktör adayı ürettiren ve kullanıcı kontrollü salt-okunur sorgu/plan çalıştıran bir geliştirici stüdyosudur.
- **Hedef Kullanıcı:**  
  Kurumsal ERP (Mikro, Logo, Netsis vb.) veya karmaşık veri ambarı üzerinde çalışan DBA'lar, SQL Developer'lar ve veri tabanı performans mühendisleridir.
- **Mevcut Hali Hangi Problemi Çözüyor?**  
  İç içe geçmiş onlarca view'ın hangi tablolara gittiğini görselleştirmeyi, aynı tablolara çoklu erişimleri listelemeyi, manuel yazılan SQL'lerin estimated/actual execution planını tek tuşla almayı ve AI refaktör adaylarını `sp_describe_first_result_set` ile şema/satır sayısı düzeyinde denetlemeyi çözer.
- **Ticari Ürün Olabilme Potansiyeli:**  
  Fikir ve hedef kitle açısından pazar değeri yüksektir (Redgate SQL Prompt, SentryOne Plan Explorer, Idera gibi araçların modernize edilmiş hali). Ancak mevcut haliyle ticari bir ürün (commercial product) değil, **gelişmiş bir iç araç / prototip (Advanced Internal Tool / Late Prototype)** seviyesindedir.

---

### 2. TEKNOLOJİ STACK

- **Frontend:** Vanilla HTML5, modern CSS3 (CSS Variables, Flexbox/Grid, Noise overlay), Vanilla JavaScript (ES6+ IIFE mimarisi, harici framework yok).
- **Backend:** Node.js 20+ (CommonJS `require` yapısı).
- **Web Sunucu:** Express `^5.1.0` (`package.json:15`).
- **Database Driver:** `mssql` `^11.0.1` (`package.json:16`). Tedious tabanlı TDS protokolü.
- **State Management:**  
  - Frontend: `public/assets/js/app.js` içinde tek bir monolitik global `state` nesnesi (`{ connected, isLive, data: { views, pressures, duplicates, regressions }, selectedViewName, ... }`).
  - Backend: Node.js process belleğindeki in-memory Map'ler (`databasePools`, `definitionCache`, `activeRequests`, `inMemoryConfig`).
- **API Yapısı:** RESTful JSON API (`/api/...`, `server/routes/api.js`).
- **SQL Server Driver:** `mssql` ConnectionPool. Çoklu veritabanı için her DB adına ayrı `ConnectionPool` haritası (`databasePools = new Map()`, `server/services/sqlServer.js:18`).
- **AI Entegrasyonu:** Standart `fetch` ile OpenAI Chat Completions API uyumlu REST çağrıları (`server/services/aiProvider.js`).
- **CSS / UI Framework:** Özel (Custom) yazılmış dark-first CSS (`public/assets/css/app.css` - 4,882 satır). Bootstrap/Tailwind kullanılmamış.
- **Test Framework:** **YOK**. `package.json` içinde Jest, Mocha, Vitest veya Playwright yer almamaktadır.
- **Build / Bundle Sistemi:** **YOK**. Webpack, Vite, Rollup, esbuild, TypeScript yoktur. Dosyalar doğrudan `express.static` ile ham servis edilir.
- **Packaging / Deployment:** Windows için `Baslat.bat` ve Linux/macOS için `start.sh` komut dosyaları.

---

### 3. PROJE MİMARİSİ

```
├── server.js                          # Express sunucu giriş noktası ve port dinleyici
├── server/
│   ├── config.js                      # Temel port konfigürasyonu
│   ├── routes/
│   │   └── api.js                     # Tüm API uç noktaları (367 satır)
│   └── services/
│       ├── sqlServer.js               # Havuz yöneticisi & MSSQL bağlantısı (375 satır)
│       ├── scanner.js                 # Çoklu DB tarama & orkestrasyon (530 satır)
│       ├── metadataCatalog.js         # IntelliSense in-memory kataloğu (445 satır)
│       ├── dependencyEngine.js        # Graph BFS & bağımlılık çözümleme (471 satır)
│       ├── staticAnalyzer.js          # Heuristik regex kuralları (192 satır)
│       ├── scoring.js                 # Health & Risk skor motoru (185 satır)
│       ├── runtimeEvidence.js         # Query Store / Plan Cache DMV tarayıcı (188 satır)
│       ├── duplicateFinder.js         # Jaccard benzerlik motoru (97 satır)
│       ├── aiProvider.js              # Prompt mühendisliği & AI API adaptörü (515 satır)
│       ├── sqlValidator.js            # Salt-okunur T-SQL filtreleyici (200 satır)
│       ├── validationService.js       # Şema & EXCEPT doğrulama motoru (286 satır)
│       ├── workbenchService.js        # Sorgu, Plan XML & Benchmark motoru (425 satır)
│       ├── planParser.js              # ShowPlanXML Regex ayrıştırıcısı (220 satır)
│       ├── settingsService.js         # AES-256 ayar yönetimi & persistence (314 satır)
│       ├── capabilities.js            # Sürüm & izin tespit motoru (125 satır)
│       └── canonicalObject.js         # 3/4-part kimlik standartlaştırıcı (110 satır)
├── public/
│   ├── index.html                     # Monolitik UI şablonu (1,383 satır)
│   └── assets/
│       ├── css/app.css                # Monolitik stil dosyası (4,882 satır)
│       └── js/
│           ├── app.js                 # Monolitik GOD FILE (5,675 satır)
│           ├── intellisense.js        # Textarea autocompletion motoru (818 satır)
│           ├── mock-data.js           # Demo modu veri seti (305 satır)
│           └── uiText.js              # Türkçe etiket sözlüğü (110 satır)
├── sql/                               # Bağımsız SQL referans scriptleri (Sunucu çalıştırmaz)
├── runtime/                           # Yerel JSON cache dosyaları (.gitignored)
└── scratch/                           # Geçici manuel doğrulama scriptleri
```

#### Mimari Değerlendirme & "God Component" Tespiti:
1. **Frontend God File (`public/assets/js/app.js`):**  
   Tam **5,675 satır** tek bir IIFE içinde yazılmıştır. Navigasyon, modal, DOM manipülasyonu, chart simülasyonu, graph çizimi, SVG mouse eventleri, AI tab geçişleri, benchmark çalıştırma, split-screen resize, command palette tek bir dosyadadır. Bakımı, refaktörü ve ekip çalışması son derece zordur.
2. **Frontend God File (`public/assets/css/app.css`):**  
   **4,882 satır** tek bir CSS dosyasında toplanmıştır. CSS modülleri veya BEM yapısı ayrışmamıştır.
3. **Backend Yapısı:**  
   Backend tarafı frontend'e kıyasla oldukça modülerdir. Service katmanları (`scanner`, `dependencyEngine`, `workbenchService`, `validationService`) görevlerine göre ayrılmıştır. Ancak `server/routes/api.js` dosyasında Controller katmanı yoktur; route tanımları doğrudan servis metotlarına bağlanmıştır.

---

### 4. GENEL BAKIŞ EKRANI (OVERVIEW)

- **Hangi Verileri Gösteriyor?**  
  DB Health puanı, Kritik View adedi, Dependency Edge sayısı, Mükerrer Tablo Erişimi sayısı, Aktif Regresyon adedi, Duplicate Adayı adedi, Öncelikli Müdahale Listesi, En Çok Baskı Alan Tablolar, 24 Saatlik Performans Regresyon Grafiği ve Analiz Akışı.
- **Veriler Gerçek Backend'den mi Geliyor?**  
  - *Özet Kartları & Listeler:* Bağlantı kurulduğunda `POST /api/scan` ve `GET /api/scan/latest` üzerinden backend verisiyle dolar (`app.js:2550-2590`).
  - *Analiz Akışı (Feed) & Trend Rozetleri:* `index.html:85-141` içerisindeki `+4 bugün`, `Derinlik 11`, `94 pattern` ve akış kartları (`Kardinalite Sapması`, `Mükerrer Tablo Erişimi`) **statik HTML olarak sabittir**, canlı olaylarla tetiklenmez.
  - *24 Saatlik Regresyon Grafiği (`#regressionChart`):* `index.html:123-129` içerisindeki `<path class="chart-area" d="M0,192 C80..."/>` vektörel yolu **sabit bir SVG çizimidir**. `app.js` içinde `regressionChart` ID'sine referans dahi verilmemiştir (`grep` sonucu: 0 eşleşme).
- **Yeniden Tarama Mekanizması:**  
  Topbar'daki "↻ Yeniden Tara" butonuna basıldığında `app.js:2550` (`triggerScan()`) çalışır. Canlı bağlantı varsa `POST /api/scan` çağrılır, metadata yeniden sorgulanır, skorlar hesaplanır ve ekranlar güncellenir. Bağlantı yoksa `STUDIO_MOCK` yeniden atanır.
- **Kritik Sıralama Hatası (`app.js:345-350`):**  
  Genel bakıştaki "Bugün Müdahale Edilecekler" listesinin sıralama butonlarında mantık hatası mevcuttur:
  ```javascript
  // app.js satır 345-350
  if (sortMode === 'reads') {
    sortedViews.sort((a, b) => (b.tables || 0) - (a.tables || 0)); // READS YERİNE TABLO SAYISINA GÖRE SIRALIYOR!
  } else if (sortMode === 'regression') {
    sortedViews.sort((a, b) => (b.depth || 0) - (a.depth || 0));   // REGRESYON YERİNE DERİNLİK DEĞERİNE GÖRE SIRALIYOR!
  }
  ```
  Kullanıcı "Reads" seçtiğinde okuma adedine değil view'ın kullandığı tablo sayısına göre; "Regresyon" seçtiğinde ise bağımlılık derinliğine göre sıralama yapılmaktadır.

---

### 5. VIEW ENVANTERİ (VIEW INVENTORY)

- **View Listesi Nasıl Oluşturuluyor?**  
  `scanner.js:119-133` içinde SQL Server'a gönderilen dinamik sorgu ile:
  ```sql
  SELECT s.name AS schema_name, v.name AS view_name, v.object_id, v.create_date, v.modify_date,
         OBJECT_DEFINITION(v.object_id) AS definition
  FROM sys.views AS v
  JOIN sys.schemas AS s ON s.schema_id = v.schema_id
  WHERE v.is_ms_shipped = 0 AND v.name LIKE 'AA_%'
  ORDER BY v.name;
  ```
- **Hesaplanan Metrikler:**  
  Health Skoru (0-100), Risk Kategorisi (`critical`, `high`, `medium`, `low`), Risk Skoru, Bağımlılık Derinliği (`depth`), Temel Tablo Sayısı (`baseTableCount`), Mükerrer Tablo Sayısı, Üst Bağımlı Sayısı (`dependentCount`), Mantıksal Okumalar (`reads`) ve Medyan Süre.
- **Filtreleme & Arama:**  
  `app.js:432-520` (`renderViewList()`) fonksiyonunda metin araması (ad ve canonicalId) ve risk çipi filtrelemesi (`all`, `critical`, `high`, `medium`, `low`) client-side olarak sorunsuz çalışır.
- **500 - 5.000 View Bulunan Veritabanları İçin Uygunluk:**  
  **UYGUN DEĞİLDİR.**
  1. *DOM Şişmesi (No Virtual Scroll):* `renderViewList` fonksiyonu tüm view listesini (`views.map(...)`) tek seferde DOM'a `innerHTML` ile yazar. 2.000 view olduğunda DOM'a 2.000 kart basılır ve tarayıcı kilitlenir.
  2. *Tarama Süresi (N+1 Parsing):* Tarama sırasında `scanner.js`, her view için `analyzeStaticSql` (regex taramaları) ve `buildDependencyStats` (özyinelemeli BFS) çalıştırır. 5.000 view'da Node.js event loop saniyelerce bloke olur.

---

### 6. BAĞIMLILIK HARİTASI (DEPENDENCY X-RAY)

- **Graph Nasıl Oluşturuluyor?**  
  `scanner.js:137-156` içinde `sys.sql_expression_dependencies` taranır. Ardından `server/services/dependencyEngine.js` içindeki `extractSubGraph()` fonksiyonu, seçilen hedef view'dan başlayarak upstream ve downstream yönlü genişlik öncelikli arama (BFS) yapar.
- **Desteklenen İlişkiler:**
  - View $\rightarrow$ View: **EVET**
  - View $\rightarrow$ Table: **EVET**
  - View $\rightarrow$ Function: **EVET** (`targetType.includes('FUNCTION')`)
  - Cross-Database (Farklı Veritabanı): **EVET** (`raw.referenced_database_name`)
  - Linked Server: **EVET** (`raw.referenced_server_name` $\rightarrow$ 4-part name)
  - Synonyms: **EVET** (`sys.synonyms` haritası üzerinden çözümlenir)
  - Stored Procedure: **HAYIR.** `scanner.js:154` sorgusunda sadece `OBJECT_NAME(referencing_id) LIKE 'AA_%'` filtrelenmektedir. View'ları çağıran Stored Procedure'ler yakalanmaz; view'lar da T-SQL kuralı gereği SP çağıramaz.
- **Circular Dependency Tespiti:**  
  **EVET.** `dependencyEngine.js:187-193`: BFS sırasında dal bazında `visitedInBranch.has(targetId)` kontrolü yapılır; döngü varsa `cycles` dizisine eklenir ve Health cezası (-20) verilir.
- **Graph Layout Kütüphanesi:**  
  **Harici kütüphane YOKTUR (Vis.js / Cytoscape YOK).**  
  `app.js:1303-1378`: Tamamen el yordamıyla geliştirilmiş özel bir kolonlu koordinat motorudur. Düğümler derinliklerine (`depth`) göre sütunlara ayrılır (`x = centerX + (depth * 440)`), Y ekseninde aralıklar hesaplanıp DOM'a `<div class="graph-node" style="left:...; top:...">` olarak basılır. Kenarlar ise bir `<svg>` içine `<path d="M... C..."/>` kübik Bezier eğrileri olarak çizilir.
- **Zoom / Pan / Reset:**  
  `app.js:980` CSS transform (`translate(panX, panY) scale(scale)`) ile çalışır. Mouse wheel ile zoom, sürükleme ile pan yapılır.
- **Kullanılabilirlik ve Performans Problemleri:**  
  1. Kolon bazlı layout nedeniyle aynı sütunda 10'dan fazla düğüm olduğunda Y ekseninde 2000px'i aşan taşmalar ve düğüm üst üste binmeleri yaşanmaktadır.
  2. Kenar (edge) çizgileri için yönlendirme (obstacle avoidance / edge routing) algoritması yoktur; çizgiler düğümlerin üzerinden geçer.
  3. 50'den fazla düğümlü bir planda SVG ve DOM elemanları arasındaki koordinat senkronizasyonu bozulmaktadır.

---

### 7. ÇALIŞMA ZAMANI VE REGRESYON (RUNTIME EVIDENCE & REGRESSION)

- **Query Runtime Nasıl Ölçülüyor?**  
  İki ayrı kanal vardır:
  1. *Pasif Tarama (Background Metadata):* `server/services/runtimeEvidence.js` servisi `sys.database_query_store_options` kontrolü yapar. Query Store açıksa `sys.query_store_runtime_stats`, kapalıysa `sys.dm_exec_query_stats` (Plan Cache) üzerinden view adını içeren (`query_sql_text.includes(vName)`) sorguların istatistiklerini çeker.
  2. *Aktif Çalıştırma (Workbench / Benchmark):* `workbenchService.js:307` sorguyu gerçekte `N` kez çalıştırıp `process.hrtime.bigint()` ile yüksek hassasiyetli süre tutar.
- **Sorgu Birden Fazla Kez Çalıştırılıyor mu?**  
  Workbench Benchmark'ta `runs` parametresi (varsayılan 3, maksimum 10) kadar çalıştırılır (`workbenchService.js:299`).
- **Warm Cache / Cold Cache:**  
  Benchmark sırasında `warmUp = true` ise ilk iterasyon öncesinde `SET NOCOUNT ON; ${sql};` ile tampon bellek ısıtılır ve bu çalıştırma istatistik özetine dahil edilmez (`workbenchService.js:302-306`).
- **İstatistikler (Median, Min, Max, P95, Reads, CPU):**  
  `workbenchService.js:360-376` içinde süreler ve okumalar sıralanarak Median, P95, Min, Max ve Aritmetik Ortalama tam olarak hesaplanır.
- **Logical Reads & CPU Time:**  
  `workbenchService.js:20-60`: `request.on('info')` dinleyicisi ile SQL Server'ın ürettiği `Table '...'. Scan count ..., logical reads ...` ve `CPU time = ... ms, elapsed time = ... ms` mesajları Regex ile parse edilir.
- **KRİTİK TESPİT — AKTİF REGRESYON MOTORU GERÇEKTE ÇALIŞIYOR MU?**  
  **HAYIR, CANLI MODDA TAMAMEN MOCK VE SİMÜLASYONDUR.**  
  1. `runtimeEvidence.js:31`: Fonksiyon başında `const regressions = [];` tanımlanmış, fonksiyon boyunca içine **HİÇBİR ELEMAN EKLENMEMİŞTİR**. Servis SQL Server'a bağlı olsa bile her zaman boş dizi (`regressions: []`) döner!
  2. `app.js:2148-2166`: Frontend backend'den boş regresyon geldiğini görünce `Math.random()` ile rastgele sahte regresyon verisi üretir:
     ```javascript
     // app.js satır 2159-2161 (Canlı veritabanında çalışan kod!)
     before: (0.4 + (Math.random() * 0.8)).toFixed(2) + 's',
     now: (8.5 + (Math.random() * 20)).toFixed(1) + 's',
     delta: '+' + Math.round((Math.random() * 1500 + 300)) + '%',
     ```
  3. Plan X-Ray kök neden analizindeki `%91 İstatistikler Güncel Değil`, `%86 Yürütme Planı Değişti`, `%75 Parametre Sniffing` puanları dinamik hesaplanmaz; `app.js:2120-2124` içinde sabit string olarak yazılmıştır!

---

### 8. AI REFAKTÖR MOTORU

- **AI'ya Hangi SQL Gönderiliyor?**  
  View'ın doğrudan `definition` metni (`server/services/aiProvider.js:179`).
- **Prompt Şablonları Nerede?**  
  `server/services/aiProvider.js`:
  - `buildRefactorPrompt(payload)` (satır 9-21)
  - `buildAnalyzePrompt(payload)` (satır 283-301)
  - `buildDeepAnalyzePrompt(payload)` (satır 389-417)
- **Database Metadata ve Şema AI'ya Gönderiliyor mu?**  
  **HAYIR.**  
  `contextPack` içeriği (`aiProvider.js:179`):
  ```javascript
  const contextPack = { targetView: viewName, originalSql: sql, problems, baseTables, refactorOptions: options };
  ```
  - Tablo sütunları ve veri tipleri: **GÖNDERİLMİYOR.**
  - İndeksler: **GÖNDERİLMİYOR.** (`scanner.getIndexesForView` çağrılmıyor).
  - Execution Plan XML: **GÖNDERİLMİYOR.**
  - Query Runtime İstatistikleri (Reads, CPU, Duration): **GÖNDERİLMİYOR.**
  - Detaylı Bağımlılık Ağacı: **GÖNDERİLMİYOR** (yalnızca tablo isimlerinin string listesi iletiliyor).
- **Hızlı Teşhis, Derinlemesine Analiz ve Aday Refaktör Butonları:**  
  - *Hızlı Teşhis (`#btnAnalyzeQuery`):* `POST /api/ai/analyze` çağırır. Markdown çıktılı teşhis üretir.
  - *Derinlemesine Analiz (`#btnDeepAnalyzeQuery`):* `POST /api/ai/deep-analyze` çağırır. Katman katman inceleme ve V2 SQL kodu talep eder.
  - *Aday Refaktör Oluştur (`#runRefactor`):* `POST /api/ai/refactor` çağırır. Yalnızca SQL bloğu ve guardrail notları üretir.
  - *Farklı İşlemler mi?* Evet, prompt şablonları ve backend metodları farklıdır. Ancak UI tarafındaki "Canlı Düşünce Süreci (Thinking Stream)" `setInterval(..., 700)` ile çalışan sahte bir animasyondur (`app.js:3631`). API çağrısı başarısız olduğunda veya API anahtarı girilmediğinde `app.js:3845` içindeki sabit kodlu `URETIM_MALZEME_PLANLAMA` şablonuna düşülmektedir.

---

### 9. AI PROVIDER SİSTEMİ

- **Desteklenen Sağlayıcılar:** DeepSeek, OpenAI, Anthropic, Custom/OpenAI-Compatible (`settings.panel-ai`).
- **Provider Abstraction Var mı?**  
  **HAYIR.** Tüm sağlayıcılar tek bir URL dönüştürücü üzerinden OpenAI formatına zorlanır (`normalizeChatUrl` $\rightarrow$ `/chat/completions`). Anthropic doğrudan seçilirse OpenAI mesaj gövdesi (`messages: [{ role, content }]`) gönderildiği için Anthropic API hata verecektir (özel Anthropic adaptörü/SDK yoktur).
- **Model Değişikliği:**  
  Settings ekranından serbest model adı girilebilir (`deepseek-flash`, `deepseek-chat`, `gpt-4o`, `gpt-4o-mini`). Ancak `aiProvider.js:67, 173, 325` satırlarında:
  `if (targetModel === 'deepseek-v4-flash' || targetModel === 'deepseek-coder') targetModel = 'deepseek-flash'` şeklinde hardcoded DeepSeek filtreleri bulunmaktadır.
- **Streaming & Timeout & Retry:**  
  - Streaming (Server-Sent Events): **YOK.** Yanıt tek seferde `await response.json()` ile beklenir.
  - Timeout: Yalnızca `testConnection` metodunda 10 saniyelik AbortController vardır (`aiProvider.js:72`). Asıl analiz ve refaktör çağrılarında (`proposeRefactor`, `analyzeQuery`, `deepAnalyzeQuery`) **timeout parametresi tanımlanmamıştır**; model takılırsa Express isteği sonsuza kadar askıda kalabilir.
  - Retry: **YOKTUR.** Hata alındığında tekrar deneme mekanizması bulunmaz.
- **Token Yönetimi & Prompt Taşması:**  
  `max_tokens` değeri 4096 (deep-analyze için 8192) olarak sabittir. Gönderilen SQL'in token sayısını ölçen (`tiktoken` vb.) bir mekanizma yoktur. 3.000 satırlık dev bir view gönderildiğinde model token limitini aşarak sessizce kesilebilir (`finish_reason: length`).

---

### 10. SEMANTIC GUARDRAIL (SEMANTİK KORUMA KALKANI)

Proje dokümantasyonunda (`AGENTS.md` ve `docs/05-AI-REFACTOR.md`) 10 adet kritik semantik kural tanımlanmıştır. Kod düzeyindeki gerçek durum şöyledir:

| Semantik Kural | Kod Düzeyinde Doğrulama | Açıklama |
|---|---|---|
| **Sütun İsimleri** | **EVET** (`validationService.js:154`) | `sp_describe_first_result_set` üzerinden ordinal sırayla kolon isimleri karşılaştırılır. |
| **Sütun Sırası** | **EVET** (`validationService.js:151`) | Ordinal pozisyon birebir döngüyle denetlenir. |
| **Veri Tipleri** | **EVET** (`validationService.js:158`) | `system_type_name` string eşitliği denetlenir. |
| **NULL Davranışları** | **KISMİ / DOLAYLI** | Özel NULL testi yoktur; `EXCEPT` sorgusuna bırakılmıştır (SQL Server'da `EXCEPT` iki NULL değeri eşit kabul eder). |
| **Satır Çokluğu (Multiplicity)**| **EVET** (`validationService.js:237`) | `GROUP BY [cols] + COUNT_BIG(*)` dual EXCEPT ile frekans kontrolü yapılır. |
| **JOIN Multiplicity** | **DOLAYLI** | Multiplicity testi üzerinden yakalanır. |
| **DISTINCT / UNION ALL** | **YOK (Sadece Prompt)** | AI prompt'unda "yapma" denir; kod düzeyinde AST/anlambilim kontrolü yoktur. |
| **LEFT JOIN $\rightarrow$ INNER JOIN** | **KISMİ** | Sample limit (1000 satır) içinde satır düşmesi olursa `ROW COUNT` veya `EXCEPT` aşamasında yakalanır; örneklem dışındaysa kaçar. |
| **ORDER BY / TOP** | **RİSKLİ** | `validationService.js:81`: ORDER BY derived table hatası vermesin diye regex ile silinmektedir! |

---

### 11. REFACTOR DOĞRULAMA MOTORU

`server/services/validationService.js` içerisinde 4 adımlı bir pipeline kodlanmıştır:
1. `sp_describe_first_result_set` ile şema kontrolü (isim, tip, sıra).
2. `#OrigBound` ve `#CandBound` geçici tablolarına `SELECT TOP (1000) * INTO` ile veri çekilmesi.
3. Çift yönlü `EXCEPT` (Set Match):
   `(SELECT * FROM #OrigBound EXCEPT SELECT * FROM #CandBound)` ve tersi.
4. Çift yönlü `GROUP BY [tüm kolonlar] + COUNT_BIG(*)` EXCEPT (Multiplicity Match).

**Motorun Kritik Açığı (Non-Deterministic TOP Hatası):**  
`validationService.js:87`:  
`SELECT TOP (${limit}) * INTO ${tableName} FROM (${cleanedSelect}) AS _bounded;`  
SQL Server'da deterministik bir `ORDER BY` olmadan çalıştırılan `SELECT TOP (N)` sorgularının hangi satırları getireceği garanti değildir. İki farklı yürütme planına sahip sorgu (biri Clustered Index Scan, diğeri Index Seek), tablodan **tamamen farklı 1.000 satır** getirebilir. Bu durumda her iki sorgu da mantıksal olarak aynı sonucu üretecek olsa dahi, doğrulama motoru `EXCEPT fark buldu` diyerek **yanlış negatif (false failure)** üretecektir!

---

### 12. DOĞRULAMA LABORATUVARI (VALIDATION LAB EKRANI)

- **Original vs Candidate Karşılaştırması:**  
  `index.html:4105-4415` ve `app.js:4106-4415`: Split-view ekranında iki sorgu yan yana gösterilir, divider ile boyutlandırılabilir.
- **Parametre Desteği:** **YOKTUR.** Parametreli sorgular (`@tarih`, `@kod`) için parametre bağlama arayüzü yoktur; parametre içeren sorgular SQL Server hatası verir.
- **Performans Karşılaştırması:**  
  "▶ Doğrula" butonuna basıldığında `app.js:4231` her iki sorguyu da `/api/workbench/run` üzerinden çalıştırıp süre, CPU ve mantıksal okuma farklarını ekrana basar.
- **Onaylama / Rollback / Geçmiş:**  
  Kullanıcının adayı onaylayıp veritabanına uygulayabileceği (`Deploy / Apply`) veya geçmişe dönebileceği bir **mekanizma YOKTUR**. Sonuçlar yalnızca ekranda kalır, sayfayı yenileyince silinir.

---

### 13. SQL ÇALIŞMA ALANI (SQL WORKBENCH)

| Özellik | Durum | Kod Dayanağı / Gerçek Durum |
|---|---|---|
| **SQL Editor** | **MEVCUT (İlkel)** | Monaco değil, düz HTML `<textarea id="wbSqlInput">` kullanılmaktadır (`index.html:798`). |
| **Syntax Highlighting** | **YOK** | `<textarea>` içinde yazarken renklendirme yapılamaz, düz metindir. |
| **Autocomplete / IntelliSense** | **MEVCUT** | `public/assets/js/intellisense.js` (818 satır). In-memory metadata kataloğundan tablo/kolon/keyword tamamlar. |
| **Sorgu Çalıştırma (Execute)** | **GERÇEK** | `POST /api/workbench/run` $\rightarrow$ MSSQL'de çalıştırılır. |
| **Sorgu İptal (Cancel)** | **GERÇEK** | `request.cancel()` ile aktif sorgu sonlandırılır (`workbenchService.js:186`). |
| **Execution Duration / Rows** | **GERÇEK** | `process.hrtime.bigint()` ve `primaryRecordset.length`. |
| **Result Grid** | **GERÇEK** | `<table>` elemanı dinamik oluşturulur (`app.js:5175`). |
| **Multiple Result Set** | **YARIM** | Sadece ilk recordset (`result.recordsets[0]`) grid'e basılır (`workbenchService.js:117`). |
| **STATISTICS IO & TIME** | **GERÇEK** | `request.on('info')` dinlenerek regex ile okunur (`workbenchService.js:20-60`). |
| **Estimated Plan** | **GERÇEK** | `SET SHOWPLAN_XML ON;` çalıştırılıp XML alınır (`workbenchService.js:248`). |
| **Actual Plan** | **GERÇEK** | `SET STATISTICS XML ON;` ile sorgu çalıştırılıp XML yakalanır (`workbenchService.js:226`). |
| **Query History** | **KISMİ** | In-memory `sessionHistory` dizisinde (son 50 sorgu) tutulur, sunucu restartında silinir. |
| **Favorite Queries** | **YOK** | Arayüzde veya backend'de favori sorgu desteği yoktur. |
| **Export CSV / TSV** | **GERÇEK** | JavaScript `Blob` ile client-side CSV ve TSV üretilir (`app.js:5099`). |
| **SQL Formatter** | **İLKEL** | Regex ile birkaç anahtar kelimeyi büyütüp satır başı ekleyen basit bir fonksiyondur (`app.js:4817`). |

---

### 14. EXECUTION PLAN (ÇALIŞTIRMA PLANI DESTEĞİ)

- **XML Plan Okuma:**  
  `server/services/planParser.js` raw `ShowPlanXML` string'ini parse eder.
- **Ayrıştırma Yöntemi:**  
  **XML DOM Parser kullanılmamıştır!** Standart olmayan regex'lerle ayrıştırılır (`planParser.js:37`):
  `/<RelOp\b([^>]*?)(?:\/>|>([\s\S]*?)(?=<RelOp\b|<\/QueryPlan>|$))/g`
- **Operatör Ağacı (Operator Tree):**  
  **YOKTUR.** Operatörler ebeveyn-çocuk hiyerarşisine göre bir ağaç haline getirilmez; düz bir dizi (`operators = []`) olarak toplanır. Arayüzde grafiksel bir plan ağacı gösterilmez; yalnızca "En Çok Maliyetli Operatörler" listesi basılır.
- **Analiz Edilen Başlıklar:**
  - *Index Scan / Seek / Key Lookup:* **EVET** (`isScan`, `isLookup`).
  - *Actual vs Estimated Cardinality Mismatch:* **EVET** (`planParser.js:96-111` - 10x ve 100x sapmalar yakalanır).
  - *Missing Indexes:* **EVET** (`<MissingIndexGroup>` bloğundan otomatik `CREATE NONCLUSTERED INDEX` DDL'i üretilir).
  - *Plan Warnings (TempDB Spill, Missing Stats, Implicit Conversion):* **EVET** (`planParser.js:117-145`).
  - *Memory Grant, Parallelism/Exchange, Spool Analizi:* **YOK.** Bu XML düğümleri parse edilmemektedir.

---

### 15. BEFORE / AFTER BENCHMARK

- **Karşılaştırma Yapısı:**  
  Validation Lab ekranındaki "▶ Doğrula" butonu (`app.js:4218`) hem orijinal hem de aday sorguyu çalıştırarak yan yana kartlarda Duration, CPU, Logical Reads ve Rows değerlerini gösterir.
- **Eksik Noktalar:**  
  - Physical Reads delta hesabı arayüzde gösterilmez.
  - Plan Cost delta hesabı gösterilmez.
  - İki sorgu arasındaki yüzde kazanç/kayıp (`Percentage Gain/Loss`) hesaplaması canlı modda otomatik yapılmaz; kullanıcı değerleri manuel kıyaslamak zorundadır (Demo modunda ise hardcoded `-83%` basılmaktadır).

---

### 16. TABLO BASKISI (TABLE PRESSURE)

- **Amacı ve Hesaplanışı:**  
  `scanner.js:373-406`: Taranan tüm view'ların bağımlılık ağaçlarında hangi tabloların yer aldığı taranır.  
  Formül:  
  `Score = Math.min(100, Math.round((refs * 2.5) + (paths * 1.5) + (critical * 8)))`
- **Gerçek Anlamı Nedir?**  
  Bu skor **fiziksel bir I/O veya disk baskısı DEĞİLDİR**. `sys.dm_io_virtual_file_stats` veya Buffer Pool DMVs ile ilgisi yoktur. Yalnızca view bağımlılık katalogundaki statik referans sıklığını gösteren bir "şema popülerliği" puanıdır.

---

### 17. MÜKERRER MANTIK (DUPLICATE LOGIC)

- **Nasıl Tespit Ediliyor?**  
  `server/services/duplicateFinder.js`:
  1. `normalizeSqlForFingerprint`: Yorumlar silinir, köşeli parantezler atılır, string'ler `'?'`, sayılar `0` yapılır, `CREATE VIEW ... AS` silinir, harfler küçültülür.
  2. `tokenize`: `/[a-z0-9_]+|[=<>!+*/(),]/g` ile kelime ve sembol token'ları çıkarılır.
  3. `jaccardSimilarity`: İki sorgunun token **KÜMELERİ (`Set`)** arasındaki Jaccard katsayısı ($A \cap B / A \cup B$) hesaplanır.
- **Riskler:**  
  1. *Aşırı False Positive:* Token sırası ve frekansı tamamen yoksayılır! `SELECT a, b FROM t WHERE c = 1` ile `SELECT c FROM t WHERE a = 1 AND b = 0` sorgularının token setleri neredeyse aynıdır ve sistem bunları %90+ duplicate ilan eder.
  2. *Benzer JOIN veya CASE Bloklarını Bulamaz:* AST analizi olmadığı için alt sorgu veya CASE kalıbı düzeyinde kısmi benzerlik yakalayamaz.
  3. *Performans ($O(N^2)$):* 1.000 view için $1000 \times 999 / 2 \approx 500.000$ ikili karşılaştırma Node.js tek iş parçacığını kilitler.

---

### 18. RISK / HEALTH PUANLAMA SİSTEMİ

- **Hesaplama Yöntemi (`server/services/scoring.js`):**  
  - *Health (0-100):* 100 taban puandan yapısal cezalar düşülür:
    Derinlik > 3 (-12'ye kadar), Mükerrer Tablo (-18'e kadar), SELECT DISTINCT (-5), UNION (ALL olmadan) (-6), Window Functions (-4), Non-SARGable (-12'ye kadar), Skalar UDF (-10'a kadar), SELECT * (-3), LIKE '%...' (-4), Circular Dependency (-20), Blast Radius $\ge 10$ (-8'e kadar).
  - *Risk (0-100):* Runtime verisi varsa logaritmik reads, regresyon ve blast radius toplanır; yoksa Health eksikliği ve karmaşıklık ağırlıklandırılır.
- **Kritik Mimari Kopukluk:**  
  Settings ekranında kullanıcıya sunulan ağırlık girdileri (`weightRuntime`, `weightRegression`, `weightRepeated`, `weightDepth`, `weightSargable`, `weightBlast`) `settings.local.json` içine kaydedilir; **ANCAK `scoring.js` BU AYARLARI HİÇBİR ZAMAN OKUMAZ!** Katsayılar `scoring.js:111-123` içinde sabit kodlanmıştır (Hardcoded). Ayarların değiştirilmesi skorlamayı etkilemez.

---

### 19. SETTINGS SAYFALARI DENETİMİ

| Ayar Sekmesi | UI | Backend Handler | Persistence | Sisteme Gerçek Etkisi |
|---|---|---|---|---|
| **Veritabanı Bağlantısı** | Var | Var (`/api/connection/...`) | Var (`settings.local.json`) | **Aktif çalışıyor** (MSSQL havuzlarını açar). |
| **AI Sağlayıcı** | Var | Var (`/api/ai/test`, `/api/settings/config`) | Var (`settings.local.json`) | **Aktif çalışıyor** (AI çağrılarında kullanılır). |
| **Risk Puanlama** | Var | Var (`/api/settings/config`) | Var (`settings.local.json`) | **YOK (KOPUK)** (`scoring.js` ağırlıkları kullanmaz). |
| **Çalışma Zamanı Kanıtı**| Var | Var (`/api/settings/config`) | Var (`settings.local.json`) | **YOK (KOPUK)** (`runtimeEvidence.js` -7 günü hardcoded kullanır). |
| **Güvenlik ve Yetkiler** | Var | Yok (Statik HTML) | Yok | Sadece bilgilendirme metnidir. |
| **Görünüm** | Var | Var (`/api/settings/config`) | Var (`settings.local.json`) | **Aktif çalışıyor** (CSS class/değişkenleri günceller). |

---

### 20. KONFİGÜRASYON VE PERSISTENCE (VERİ SAKLAMA)

- **Depolama Yeri:**  
  `runtime/settings.local.json` ve `runtime/latest-scan.local.json`.
- **Hassas Bilgilerin Saklanması (Şifre & API Key):**  
  `server/services/settingsService.js:21-70`:
  AES-256-GCM algoritması kullanılır.  
  **Güvenlik Zafiyeti:** Şifreleme anahtarı (`.local_vault_key`), şifreli dosyanın hemen yanında düz dosya olarak saklanmaktadır (`runtime/.local_vault_key`). `AGENTS.md` kuralı (Windows Credential Manager / DPAPI kullanımı) uygulanmamıştır. Sunucu dizinine erişen herhangi bir kullanıcı anahtarı okuyup veritabanı şifrelerini çözebilir.

---

### 21. SECURITY (GÜVENLİK ANALİZİ)

1. **Authentication & Authorization:** **HİÇ YOKTUR.** Sunucuya erişen herkes yetkilidir, kullanıcı hesabı veya rol ayrımı yoktur.
2. **CORS:** CORS middleware'i yapılandırılmamıştır. Uygulama `127.0.0.1` üzerinde dinler (`server.js:18`). Ancak makinede çalışan herhangi bir yerel web sayfası veya zararlı betik localhost:3000 API'lerine POST istekleri atabilir.
3. **Secret Sızıntısı:**  
   - `settingsService.js:198-223` (`getConfig`): Şifre ve API key doğrudan JSON çıktısında dönmez, `hasApiKey: true` ve `hasSavedPassword: true` boolean bayrakları döner.
   - `sqlServer.js:26-40` (`sanitizeError`): SQL bağlantı hatalarında `password=...`, `sk-...`, `Bearer ...` değerleri maskelenir. Bu kısım iyi tasarlanmıştır.

---

### 22. SQL ÇALIŞMA ALANI GÜVENLİĞİ (SQL INJECTION & MUTATION)

- **Kullanıcı DROP / DELETE / ALTER Çalıştırabilir mi?**  
  `server/services/sqlValidator.js`:
  Tüm sorgular çalıştırılmadan önce `validateReadOnly()` kontrolünden geçer.
  1. Yorum satırları ve string literal'lar temizlenir.
  2. İlk geçerli anahtar kelimenin `SELECT` veya `WITH` olması zorunludur.
  3. `PROHIBITED_KEYWORDS` listesindeki kelimeler (`DROP`, `DELETE`, `UPDATE`, `TRUNCATE`, `ALTER`, `EXEC`, `XP_`, `SP_` vb.) bulunursa sorgu engellenir.
- **Kritik Güvenlik Riski:**  
  SQL Server seviyesinde salt-okunur bir kullanıcı (`db_datareader`) zorunluluğu yoktur. Kullanıcı `sa` ile bağlandıysa ve `sqlValidator.js` regex filtresi atlatılırsa (örneğin `SELECT ... INTO ...` tablo yaratır ve engellenmez, ya da `OPENROWSET` prohibited listesinde yoktur), veritabanında **istenen her türlü işlem yapılabilir**. Salt-okunur güvencesi veritabanı izinlerine değil, uygulama katmanındaki string kontrolüne emanettir.

---

### 23. PERFORMANS DARBOĞAZLARI

1. **Monolitik Tarama:** `scanner.js:170`, 5 veritabanı seçildiğinde her biri için `sys.views` ve devasa `sys.sql_expression_dependencies` tablolarını çeker. 500+ view'lık ortamlarda taranan bağımlılık satır sayısı 50.000'i aşar ve bellek tüketimi zıplar.
2. **$O(N^2)$ Duplicate Benzerlik Taraması:** `duplicateFinder.js:69` çift döngüyle tüm view'ları birbiriyle kıyaslar.
3. **Frontend DOM Render:** `app.js`, 600 view için 600 DOM elemanını aynı anda basarak tarayıcı ana iş parçacığını kilitler.

---

### 24. SQL PARSER STRATEJİSİ

- **Kullanılan Yöntem:** **%100 Heuristik Regex.**
- **AST / Grammar Desteği:** **YOK.** (Ne Microsoft ScriptDom, ne ANTLR, ne de node-sql-parser mevcuttur).
- **Regex'in Yanlış Sonuç Ürettiği Noktalar:**
  1. *Subquery / CTE Predicate Ayrımı:* `staticAnalyzer.js:90`: `/(?:WHERE|ON|HAVING)\s+([\s\S]*?)(?:GROUP\s+BY...|$)/gi` regex'i iç içe sorgularda en dıştaki WHERE ile içteki GROUP BY'ı karıştırarak yanlış SARGable analizi yapar.
  2. *String İçindeki Yorum Karakterleri:* Literal içindeki `--` veya `/*` işaretleri hatalı temizlenebilir.
  3. *Derived Table ORDER BY Temizliği:* `validationService.js:81`, `cleanedSelect.replace(/\s+ORDER\s+BY.../i, '')` ile sorgunun en sonundaki ORDER BY'ı silmeye çalışır; subquery içindeki legal bir ORDER BY TOP ifadesini silerek sorguyu bozabilir.

---

### 25. TEST DURUMU

- **Unit Test:** **YOK.**
- **Entegrasyon Testi:** **YOK.**
- **Frontend Testi:** **YOK.**
- **Durum:** Projede otomatikleştirilmiş hiçbir test suite'i (`npm test`) bulunmamaktadır. `scratch/` klasöründe geliştiricinin manuel çalıştırdığı 5 adet ad-hoc `.js` dosyası vardır; bunlardan `scratch/test_validator.js:1` satırında başka bir bilgisayara ait mutlak yol (`c:/Users/alper/Desktop/...`) unutulmuştur.

---

### 26. MOCK / DEMO / PLACEHOLDER TARAMASI

Kod tabanında yapılan taramada tespit edilen önemli mock ve simülasyon noktaları:

1. `public/assets/js/app.js:2159-2161`: Canlı SQL bağlantısı varken Query Store boş döndüğünde `Math.random()` ile **sahte regresyon süreleri ve yüzdeleri türetilmektedir**.
2. `public/assets/js/app.js:3845-3893`: AI Refaktör çağrısı başarısız olduğunda veya API anahtarı girilmediğinde `URETIM_MALZEME_PLANLAMA` için önceden yazılmış **sabit SQL ve notlar** üretilmektedir.
3. `public/assets/js/app.js:4310-4320`: Demo modunda Validation Lab çalıştırıldığında 600ms beklenip her zaman `PASS` dönen **sabit adımlar** simüle edilmektedir.
4. `public/assets/js/app.js:4871-4912`: Demo modunda Workbench "Run" tıklandığında rastgele üretilen 48 satırlık **mock tablo** döndürülmektedir.
5. `public/assets/js/app.js:4981-5012`: Demo modunda Estimated/Actual Plan tıklandığında sabit `STOK_HAREKETLERI` **mock planı** döndürülmektedir.
6. `server/services/capabilities.js:33-37`: Sunucuya bağlanılamadığında sürüm bilgisi `SQLSRV-MAIN`, `SQL Server 2022` olarak **sabit fallback** dönmektedir.
7. `server/services/scanner.js:480-491`: Bağlantı yokken indeks sorgulandığında tablo adında `HAREKET` geçiyorsa `sth_recno`, geçmiyorsa `sto_recno` **sabit indeksleri** uydurulmaktadır.

---

### 27. HARDCODED (SABİT KODLANMIŞ) VERİLER

1. **Overview 24 Saat Regresyon Grafiği:** `index.html:123-129` SVG path koordinatları sabittir.
2. **Overview Feed (Analiz Akışı):** `index.html:138-140` Kardinalite sapması, Mükerrer erişim metinleri HTML içinde sabittir.
3. **View Detail $\rightarrow$ Çalıştırma Planları Sekmesi:** `index.html:235-241` içindeki `Clustered Index Scan (PK_STOK_HAREKETLERI) · %68 plan maliyeti` kartı hiçbir zaman değişmez.
4. **View Detail $\rightarrow$ Çalışma Zamanı Sekmesi:** `index.html:216-224` içindeki `sp_GunlukUretimRaporu (Line 42)` çağıran sorgu kartı sabittir.
5. **View Detail $\rightarrow$ Geçmiş Sekmesi:** `index.html:274-279` içindeki "Son 30 günde 2 plan değişikliği saptandı..." metni sabittir.
6. **Plan X-Ray Kök Neden Yüzdeleri:** `app.js:2120-2124` içindeki `%91`, `%86`, `%75` oranları sabittir.

---

### 28. ERROR HANDLING (HATA YÖNETİMİ)

- **SQL Bağlantısı Koparsa:** `sqlServer.js` havuz hatası fırlatır; API katmanı `handleSafeError` ile şifreleri maskeleyerek 400 döner. Frontend `toast('Hata', ...)` basar.
- **AI Timeout:** `aiProvider.js` içinde `fetch` çağrılarına timeout bağlanmadığı için Node.js varsayılan socket timeout süresine kadar bekler (UI'da buton disabled kalır).
- **AI Geçersiz JSON veya Boş Yanıt Dönerse:** `aiProvider.js:233-247` markdown içindeki ```` ```sql ```` bloğunu regex ile ayıklar. Bulamazsa hata fırlatır ve fallback mekanizmasına düşer.
- **View Tanımı Okuma İzni Yoksa:** `scanner.js:171` `OBJECT_DEFINITION()` NULL döndüğünde view `definition: null` olarak işaretlenir; tarama durmaz, kısmi erişim (`PARTIAL ACCESS`) olarak işaretlenir.

---

### 29. OBSERVABILITY (GÖZLENEBİLİRLİK & LOGLAR)

- **Log Kütüphanesi:** Yoktur; yalnızca standart `console.log`, `console.warn`, `console.error` kullanılır.
- **Structured Logs (JSON formatı):** Yoktur.
- **Request ID:** Express request seviyesinde correlation ID middleware'i yoktur. Yalnızca SQL Workbench sorgu iptali için rastgele bir `requestId` üretilir.
- **Audit Log:** Kullanıcının hangi sorguyu ne zaman çalıştırdığını diske veya veritabanına kaydeden bir denetim günlüğü yoktur.

---

### 30. UX / UI ANALİZİ

- **Güçlü Yönler:** Dark-first tema, renk paleti semantiği (kırmızı=kritik, turuncu=yüksek, yeşil=başarılı, mor=AI/seçili), CSS glassmorphism ve noise filtreleri son derece şık ve profesyonel bir görünüm sunar.
- **Eksik / Amatör Yönler:**
  1. *Editör:* Gerçek bir SQL editörü (Monaco / CodeMirror) yerine `<textarea>` kullanılması profesyonel SQL araçları seviyesinin altındadır.
  2. *Sonuç Tablosu:* Workbench grid'inde sütun genişliği ayarlama (column resize), sütuna göre sıralama veya sayfalama yoktur.
  3. *Ölü Sekmeler:* View Detail içindeki sekmelerin (Planlar, Geçmiş, Çalışma Zamanı) dinamik veri yerine statik HTML göstermesi kullanıcıda sahte özellik hissi uyandırır.

---

### 31. EKRANLAR ARASI WORKFLOW (KULLANICI YOLCULUĞU)

- **Hedeflenen İdeal Akış:**  
  *View Inventory $\rightarrow$ Problemli View $\rightarrow$ Dependency $\rightarrow$ Runtime $\rightarrow$ Plan $\rightarrow$ AI Refactor $\rightarrow$ Diff $\rightarrow$ Validation $\rightarrow$ Benchmark $\rightarrow$ Deploy.*
- **Mevcut Durum:**  
  *View Inventory $\rightarrow$ Dependency $\rightarrow$ AI Refactor $\rightarrow$ Validation Lab* akışı çalışmaktadır (butonlar aradaki parametreleri taşır: `#btnSendCandidateToValidation`, `#btnOpenCandidateInWorkbench`).  
  **Kopuk Olan Kısım:** Validation Lab veya Workbench'ten sonra **hiçbir Deploy / Save / Apply aşaması yoktur**. Süreç Validation ekranında son bulur.

---

### 32. HISTORY & VERSIONING

- Refactor geçmişi, sürüm kontrolü (versioning) veya rollback altyapısı **YOKTUR**.
- Ne SQLite ne de SQL Server üzerinde `Studio_Refactor_History` benzeri bir tablo açılmamıştır. Oturum kapandığında üretilen adaylar kaybolur.

---

### 33. DEPLOY / APPLY MEKANİZMASI

- Üretilen adayın SQL Server'a `ALTER VIEW` olarak uygulanmasını sağlayan bir kod **YOKTUR**.
- `AGENTS.md:58` kuralı gereği ("İlk sürüm DB schema/data mutate ETMEZ") bilinçli olarak yapılmamıştır. Bu güvenlik açısından doğrudur ancak ürün olgunluğu açısından "Deploy Scriptini Dışa Aktar" seçeneği bulunmalıdır.

---

### 34. ÜRÜN OLARAK EKSİK ÖZELLİKLER (GAP ANALYSIS)

Redgate, SentryOne veya SQL Profiler seviyesine ulaşmak için eksik temel özellikler:
1. **İndeks Danışmanı (Index Advisor):** Missing index DMV'lerini (`sys.dm_db_missing_index_*`) view bazında ilişkilendirme.
2. **Kilit & Bloklanma Analizörü (Blocking & Deadlocks):** `sys.dm_exec_requests` ve deadlock grafikleri.
3. **Wait Statistics:** Hangi bekleme türlerinin (PAGEIOLATCH, ASYNC_NETWORK_IO, CXPACKET) oluştuğu.
4. **İstatistik Sağlığı (Statistics Freshness):** `sys.dm_db_stats_properties` ile tablolardaki modifikasyon yüzdeleri.
5. **Geçici Veritabanı Yükü (TempDB Pressure):** TempDB allocation tracking.

---

### 35. AI İÇİN DAHA İLERİ SEVİYE FİKİRLER

1. **AI Execution Plan Explainer:** ShowPlanXML'deki en pahalı operatörleri, kardinalite sapmalarını ve missing index bloklarını prompt'a verip Türkçe neden-sonuç analizi yaptırmak (Mevcut mimariye hemen eklenebilir).
2. **AI Index Advisor:** View tanımı ve WHERE filtrelerini okuyarak kapsayıcı indeks (covering index) önerisi üretmek.
3. **AI Code Smell Detector:** View içindeki antipattern'leri (`SELECT *`, skalar UDF, UNION without ALL) tespit edip refaktör önerisi sunmak.

---

### 36. İDEAL REFACTOR SONUÇ EKRANI İLE MEVCUT DURUMUN KIYASI

| İdeal Bileşen | Mevcut Durum | Eksiklik / Yapılması Gereken |
|---|---|---|
| **Original SQL vs Candidate SQL** | Mevcut (`#candidateSqlTextSplit`) | Monaco Diff Editor entegre edilmeli. |
| **Semantic Validation** | Mevcut (Validation Lab) | Sample non-deterministic TOP hatası giderilmeli. |
| **Execution Plan Before / After** | **YOK** | İki planın XML'i yan yana operatör bazında kıyaslanmalı. |
| **Benchmark (Duration, CPU, Reads, Plan Cost)** | **KISMİ** | Otomatik delta hesaplama (% kazanç/kayıp) eklenmeli. |
| **AI Explanation & Risk** | Mevcut | Yapılandırılmış Türkçe notlar basılıyor. |
| **Approve / Reject / Save Script** | **YOK** | T-SQL deployment scripti oluşturma ve indirme eklenmeli. |

---

### 37. ÖNCELİKLENDİRME MOTORU (PRIORITIZATION ENGINE)

500+ view olan bir veritabanında kullanıcı view'ları tek tek aramamalıdır.
- **Mevcut Altyapı:** Overview ekranındaki "Bugün Müdahale Edilecekler" listesi basit bir `riskScore` sıralamasıdır (`app.js:350`).
- **Olması Gereken:**  
  $$\text{Fırsat Skoru} = (\text{Mantıksal Okuma Yüzdeliği} \times 0.4) + (\text{Çağrılma Sıklığı} \times 0.3) + (\text{Yapısal Problem Cezası} \times 0.2) + (\text{Etki Alanı} \times 0.1)$$
  Bu motorun çalışabilmesi için backend `runtimeEvidence.js` servisinin Query Store'dan gerçek okuma ve yürütme frekanslarını doğru toplayıp sıralaması gerekir.

---

### 38. PROFESSIONAL PRODUCT GAP ANALYSIS

Projenin Seviyesi: **İleri Düzey Dahili Araç / Gelişmiş Prototip (Advanced Internal Tool / Late Prototype)**.
- *Neden Prototype değil?* Gerçek MSSQL bağlantısı, havuzlama, ShowPlan XML alma, T-SQL çalıştırma, validation testleri çalışmaktadır.
- *Neden Commercial Product değil?* Test suite'i sıfırdır, build/bundle altyapısı yoktur, regresyon tespiti `Math.random()` ile çalışmaktadır, grafiği ve bazı sekmeleri sahtedir, kullanıcı yetkilendirmesi yoktur.

---

### 39. DOSYA BAZLI ANALİZ TABLOSU

| Dosya Yolu | Görevi | Durumu | Temel Sorun | Öneri |
|---|---|---|---|---|
| `server/services/sqlServer.js` | MSSQL havuz ve bağlantı yöneticisi | Çalışıyor | Şifre persistent saklanırken zayıf dosya anahtarı kullanılıyor. | DPAPI / Windows Credential Manager entegrasyonu. |
| `server/services/scanner.js` | Veritabanı ve bağımlılık tarayıcısı | Çalışıyor | `AA_%` hardcoded filtreli; büyük DB'lerde bloklayıcı. | Sayfalama ve esnek prefix filtreleme eklenmeli. |
| `server/services/dependencyEngine.js`| Bağımlılık çözümleme ve BFS | Çalışıyor | Stored procedure çağıranlarını yakalamıyor. | `sys.sql_expression_dependencies` kapsamı genişletilmeli. |
| `server/services/staticAnalyzer.js` | Statik SQL kural denetleyicisi | Çalışıyor (Heuristik) | Regex ile subquery ve string içi yorumlar karışıyor. | AST tabanlı T-SQL parser'a geçilmeli. |
| `server/services/scoring.js` | Health ve Risk puanlayıcı | Yarım | Settings'teki ağırlıkları yok sayıyor (Hardcoded). | `settingsService.getConfig().scoring` bağlanmalı. |
| `server/services/runtimeEvidence.js` | Query Store / DMV kanıt toplayıcı | Hatalı / Yarım | `regressions = []` boş dönüyor; sorgu `-7 gün` hardcoded. | Regresyon tespit mantığı yazılmalı, zaman penceresi bağlanmalı. |
| `server/services/duplicateFinder.js` | Mükerrer SQL benzerlik bulucu | Yarım | Token set Jaccard sıra ve frekansı yoksayıyor ($O(N^2)$). | Token n-gram veya AST hashing algoritmasına geçilmeli. |
| `server/services/aiProvider.js` | AI model çağrı ve prompt yöneticisi| Çalışıyor | Streaming ve timeout yok; şema/indeks AI'ya gitmiyor. | İndeks ve şema metadata'sı prompt context'e eklenmeli. |
| `server/services/sqlValidator.js` | Salt-okunur SQL güvenlik kalkanı | Çalışıyor | `SELECT INTO` ve `OPENROWSET` engellenmiyor. | Prohibited keyword listesi sıkılaştırılmalı. |
| `server/services/validationService.js`| Semantik eşdeğerlik doğrulayıcı | Çalışıyor | `TOP (1000)` ORDER BY olmadan non-deterministic veri çeker. | Deterministik sıralama veya hashing eklenmeli. |
| `server/services/workbenchService.js` | SQL Workbench çalıştırma motoru | Çalışıyor | Çoklu result set desteği yok; sadece ilk set basılıyor. | Tüm recordset'leri döndürecek yapı kurulmalı. |
| `server/services/planParser.js` | ShowPlanXML ayrıştırıcı | Çalışıyor | Regex tabanlı XML parsing; operatör ağacı kurmuyor. | `fast-xml-parser` ve görsel ağaç modeli eklenmeli. |
| `server/services/settingsService.js` | Konfigürasyon ve şifreleme | Çalışıyor | Master key diskte düz metin `.local_vault_key` saklanıyor. | OS tabanlı güvenli anahtar kasası kullanılmalı. |
| `public/assets/js/app.js` | Monolitik Frontend Controller | Çalışıyor (Teknik Borç) | 5,675 satırlık GOD FILE; Math.random() regresyonu üretiyor. | Modüllere bölünmeli, sahte kodlar temizlenmeli. |
| `public/assets/js/intellisense.js` | Textarea autocompletion | Çalışıyor | Textarea caret mirror bazen scroll kaymasında şaşırıyor. | Monaco Editor entegrasyonu ile değiştirilmeli. |
| `public/index.html` | UI şablonu | Çalışıyor | Çalışma planları ve geçmiş sekmeleri hardcoded statik. | Dinamik template rendering bağlanmalı. |

---

### 40. SONUÇ RAPORU

#### A. ŞU ANDA GERÇEKTEN ÇALIŞAN ÖZELLİKLER
1. **Çoklu Veritabanı MSSQL Bağlantı Havuzu:** `server/services/sqlServer.js` üzerinden seçilen tüm DB'ler için ayrı ConnectionPool açılması ve sorguların doğru havuza yönlendirilmesi.
2. **Katalog Metadata Taraması:** `sys.views`, `sys.schemas`, `sys.sql_expression_dependencies` ve `sys.synonyms` üzerinden gerçek nesne bağımlılıklarının çıkarılması.
3. **Statik SQL Analizi:** Temel heuristik desenlerin (`SELECT *`, Skalar UDF, DISTINCT, UNION without ALL) regex ile taranması.
4. **AI Refactor Promptlama:** DeepSeek/OpenAI API'sine view tanımının gönderilip geçerli adayın ayıklanması.
5. **SQL Workbench Sorgu Çalıştırma & İptali:** `request.cancel()` ile çalışan sorguyu durdurabilme, süre ve satır sayısı ölçümü.
6. **Estimated ve Actual ShowPlanXML Alma:** SQL Server'dan gerçek XML planının çekilmesi ve missing index DDL'inin üretilmesi.
7. **STATISTICS IO & TIME Ölçümü:** Sorgu mesajlarından mantıksal okuma ve CPU sürelerinin regex ile yakalanması.
8. **Validation Lab Şema ve Dual EXCEPT:** İki sorgunun kolon tiplerini ve veri setlerini geçici tablolar üzerinde karşılaştırma.
9. **Karanlık Tema & Görünüm Ayarları:** CSS değişkenleri üzerinden temasal geçişler.

#### B. YARIM ÇALIŞAN ÖZELLİKLER
1. **Risk ve Health Puanlaması:** Skor hesaplanıyor fakat Settings ekranındaki ağırlık ayarları koda bağlı değil.
2. **Execution Plan Gösterimi:** XML alınıyor ve en pahalı operatörler listeleniyor ancak grafiksel bir plan ağacı oluşturulmuyor.
3. **Mükerrer Mantık Tespiti:** Jaccard benzerliği hesaplanıyor fakat token kümesi bazlı olduğu için yüksek oranda false-positive üretiyor.
4. **SQL IntelliSense:** Çalışıyor ancak `<textarea>` üzerinde çalıştığı için Monaco konforu ve renklendirmesi yok.
5. **Benchmark Karşılaştırması:** Tekil benchmark kusursuz çalışıyor; ancak Before/After delta kıyaslaması otomatik hesaplanmıyor.

#### C. MOCK / DEMO OLAN ÖZELLİKLER
1. **Canlı Mod Aktif Regresyon Tespiti:** `runtimeEvidence.js` backend'de hiçbir regresyon hesaplamaz (`[]` döner). Frontend `app.js:2159` satırında `Math.random()` ile sahte süreler ve regresyon yüzdeleri üretir.
2. **Genel Bakış 24 Saatlik Regresyon Grafiği:** `index.html:123` içindeki SVG path statik bir çizimdir; gerçek veriyle hiçbir bağı yoktur.
3. **View Detail $\rightarrow$ Çalıştırma Planları Sekmesi:** `index.html:230` içindeki plan kartı her view için sabit kodlanmış statik metindir.
4. **View Detail $\rightarrow$ Çalışma Zamanı Sekmesi:** `index.html:207` içindeki `sp_GunlukUretimRaporu` kartı her view için sabittir.
5. **View Detail $\rightarrow$ Geçmiş Sekmesi:** `index.html:274` statik 2 satır metindir.
6. **AI Canlı Düşünce Akışı (Thinking Stream):** `setInterval` ile 700ms'de bir ekrana basılan sahte animasyondur.

#### D. HENÜZ YAPILMAMIŞ ÖZELLİKLER
1. Refactoring geçmişi ve sürümleme (Versioning / History / Rollback).
2. Onaylanan adayı veritabanına uygulama (`Deploy / Apply DDL`) veya deploy scripti export etme.
3. Gerçek zamanlı deadlock, blocking ve wait statistics ekranları.
4. Çoklu result set desteği (Grid'de birden fazla sonuç gösterme).
5. Gerçek AST tabanlı SQL parser (ScriptDom / ANTLR).

#### E. KRİTİK BUGLAR
1. **Overview Sıralama Bug'ı (`app.js:345-350`):** "Reads" seçildiğinde tablo sayısına, "Regresyon" seçildiğinde derinliğe göre sıralama yapılması.
2. **Validation Lab Non-Deterministic TOP Hatası (`validationService.js:87`):** Deterministik `ORDER BY` olmadan yapılan `TOP (1000)` çekiminin iki sorgu arasında farklı veri alt kümeleri üreterek hatalı eşleşmeme (false failure) vermesi.
3. **AI Çağrılarında Timeout Olmaması (`aiProvider.js:187`):** AI API yanıt vermediğinde Express request'inin sonsuza kadar asılı kalması.

#### F. MİMARİ TEKNİK BORÇLAR
1. Frontend'in 5,675 satırlık tek bir dosyada (`app.js`) toplanmış olması.
2. Test altyapısının sıfır olması (`package.json` içinde test komutu dahi yok).
3. Build/bundle adımının olmaması.
4. XML parsing işleminin regex ile yapılması (`planParser.js`).

#### G. SECURITY RİSKLERİ
1. Master şifreleme anahtarının diskte düz metin (`runtime/.local_vault_key`) saklanması.
2. Express sunucusunda kimlik doğrulama (auth) ve CORS kısıtlaması olmaması.
3. Salt-okunur korumanın veritabanı izinleri yerine uygulama düzeyindeki string kontrolüne emanet edilmesi (`SELECT INTO`, `OPENROWSET` açıkları).

#### H. PERFORMANCE RİSKLERİ
1. 1.000+ view içeren veritabanlarında `renderViewList` fonksiyonunun DOM'u dondurması (Virtual scroll yok).
2. `duplicateFinder.js` içindeki $O(N^2)$ ikili döngünün Node.js ana iş parçacığını dakikalarca kilitleme riski.

#### I. UX PROBLEMLERİ
1. SQL editörünün syntax highlighting desteklemeyen düz bir `<textarea>` olması.
2. Bağımlılık grafiğinde çizgilerin düğümlerin üstünden geçmesi ve düğümlerin üst üste binmesi.
3. Kullanıcının tıkladığı bazı sekmelerin (Planlar, Geçmiş) her nesnede aynı sabit yazıyı göstermesi.

#### J. ÜRÜNÜN EN GÜÇLÜ 10 TARAFI
1. SQL Server tooling dünyasında nadir görülen modern, estetik, dark-first arayüz dili.
2. Sıfır harici UI framework kuralına sadık kalınması (React/Vue yükü yok).
3. Çoklu veritabanı havuz mimarisinin (`databasePools Map`) temiz kurulmuş olması.
4. `workbenchService.js` içinde `request.cancel()` ile gerçek sorgu iptali yeteneği.
5. SQL Server `STATISTICS IO` ve `STATISTICS TIME` çıktılarının başarıyla ayrıştırılması.
6. Gerçek Estimated ve Actual ShowPlanXML verisinin SQL Server'dan doğrudan çekilebilmesi.
7. ShowPlanXML'den eksik indeks DDL'inin otomatik üretilmesi.
8. `sp_describe_first_result_set` ve `GROUP BY COUNT_BIG(*)` ile semantik veri tekilliğinin kanıtlanması yaklaşımı.
9. Cross-database 4-part name ve synonym çözümleme yeteneği.
10. `Baslat.bat` ile Windows ortamında tek tıkla ayağa kalkabilen pratik dağıtım modeli.

#### K. ÜRÜNÜN EN ZAYIF 10 TARAFI
1. Aktif regresyon tespitinin canlı veride sahte rastgele sayılarla (`Math.random()`) simüle edilmesi.
2. Genel bakıştaki regresyon grafiğinin statik bir SVG çizimi olması.
3. View Detail sekmelerindeki (Planlar, Geçmiş, Çağıranlar) sabit kodlanmış sahte veriler.
4. Settings'teki skorlama ağırlıklarının backend skorlama motoruna bağlı olmaması.
5. SQL ayrıştırmanın AST yerine kırılgan Regex kalıplarıyla yapılması.
6. SQL Workbench editörünün renklendirmesiz düz `<textarea>` olması (Monaco yok).
7. Projede sıfır birim/entegrasyon testinin bulunması.
8. Frontend'in 5,675 satırlık monolitik bir god file (`app.js`) olması.
9. Büyük veritabanlarında (1000+ view) virtual scrolling olmaması nedeniyle donma riski.
10. Refaktör sonrası deployment / script export / rollback sürecinin bulunmaması.

---

### GELİŞTİRME YOL HARİTASI VE EYLEM PLANI

#### L. P0 - HEMEN YAPILMASI GEREKENLER (CRITICAL HOTFIXES)
1. **Sahte Regresyon Kodunun Temizlenmesi (`app.js:2149`):** `Math.random()` kaldırılmalı. Query Store'dan veri gelmiyorsa "Aktif regresyon bulunamadı" empty-state'i gösterilmeli.
2. **Overview Sıralama Düzeltmesi (`app.js:345`):** "Reads" filtresi gerçek okuma değerine, "Regression" filtresi gerçek süre farkına bağlanmalı.
3. **Validation Lab Deterministic Top (`validationService.js:87`):** Sıralama belirlenmemişse `ORDER BY (SELECT NULL)` veya birincil anahtar sütunları eklenmeli.
4. **Puanlama Ağırlıklarının Bağlanması (`scoring.js`):** Settings'ten gelen ağırlık katsayıları hesaplama formülüne parametre olarak geçirilmeli.
5. **Ölü Sekmelerin Gizlenmesi / Bağlanması:** View Detail içindeki hardcoded Planlar ve Geçmiş sekmeleri dinamik veriye bağlanmalı veya kaldırılmalıdır.

#### M. P1 - SONRAKİ GELİŞTİRME SPRINTİ
1. **Monaco Editor Entegrasyonu:** SQL Workbench ve Validation Lab yüzeylerine CDN/yerel Monaco Editor eklenmeli (Syntax highlighting + diff).
2. **Virtual Scrolling:** View Envanteri listesine sanal kaydırma eklenerek 5.000 view desteği sağlanmalı.
3. **ShowPlanXML Görsel Ağacı:** XML'deki RelOp hiyerarşisinden hiyerarşik bir operatör ağacı türetilmeli.
4. **Before/After Otomatik Delta:** Validation Lab'da iki sorgunun IO/CPU farkı yüzde olarak hesaplanmalı.
5. **Test Altyapısı:** Jest/Vitest kurularak `sqlValidator`, `planParser` ve `validationService` için en az 30 birim test yazılmalı.

#### N. P2 - İLERİ SEVİYE ÖZELLİKLER
1. **T-SQL AST Parser:** Microsoft ScriptDom veya ANTLR tabanlı parser adapter eklenmeli.
2. **Deploy & Export Pipeline:** `DRAFT -> VALIDATED -> BENCHMARKED -> SCRIPT_GENERATED` akışı kurulmalı.
3. **Query Store Zaman Penceresi:** Settings'teki 1h, 24h, 7d ayarları Query Store sorgusuna dinamik bağlanmalı.
4. **Frontend Modülerleştirme:** `app.js`, ES modülleri veya bileşen bazlı dosyalara ayrıştırılmalı.

---

#### O. ÖNERİLEN YENİ MİMARİ / MODÜLLER
- `server/services/astParser.js`: Regex yerine AST tabanlı sözdizim analizörü.
- `server/services/queryStoreEngine.js`: Regresyon ve plan değişimlerini matematiksel analiz eden özel servis.
- `server/services/deploymentService.js`: Refaktör edilen view için rollback özellikli DDL scripti üreten servis.
- `public/assets/js/modules/`: `graphView.js`, `workbench.js`, `validationLab.js`, `inventory.js` şeklinde ayrışmış frontend yapısı.

#### P. ÖNERİLEN YENİ EKRANLAR
1. **Refactor Diff & Deploy Staging Ekranı:** Orijinal ile adayın Monaco Diff ile gösterildiği, validation ve benchmark puanlarının tek raporda toplandığı ve "Deploy Scripti Al" butonu olan nihai kabul ekranı.
2. **Query Store Regresyon Dedektifi Ekranı:** Plan değişimlerini (Hash Match $\rightarrow$ Nested Loops) yan yana karşılaştıran detaylı görsel regresyon ekranı.

#### Q. SİLİNMESİ VEYA BİRLEŞTİRİLMESİ GEREKEN EKRANLAR
- **Tablo Baskısı (Table Pressure) Ekranı:** Bağımsız bir sayfa olmak yerine "View Envanteri" veya "Genel Bakış" altında bir panel olarak konsolide edilmelidir (sayfa gezinme yükünü azaltmak için).
- **Mükerrer Mantık Ekranı:** Mevcut token-Jaccard mantığı yetersiz kaldığı için ya kaldırılmalı ya da AST tabanlı alt-sorgu analizine dönüştürülene kadar deneysel (`Beta`) olarak işaretlenmelidir.

---

#### R. BİR SONRAKİ SPRINT İÇİN EN ÖNEMLİ 15 İŞ

1. `app.js:2159` satırındaki `Math.random()` sahte regresyon kodunu silmek ve Query Store DMV'sini doğrulamak.
2. `app.js:345-350` satırlarındaki ters sıralama (reads $\rightarrow$ tables, regression $\rightarrow$ depth) bug'ını düzeltmek.
3. `scoring.js` içine `settingsService.getConfig().scoring` ağırlıklarını parametre olarak bağlamak.
4. `runtimeEvidence.js:82` sorgusundaki `-7 gün` sabitini Settings'ten gelen pencereye bağlamak.
5. `index.html` içindeki statik plan ve geçmiş kartlarını dinamik API verisine bağlamak.
6. `index.html:123` içindeki 24 saatlik SVG grafiğini ya Query Store saatlik verisiyle çizdirmek ya da yanıltıcı olmaması için kaldırmak.
7. SQL Workbench içine CDN üzerinden Monaco Editor entegre etmek.
8. `validationService.js:87` içindeki non-deterministic `SELECT TOP` hatasını deterministik sıralamayla çözmek.
9. `planParser.js` içine `fast-xml-parser` ekleyerek regex tabanlı XML ayrıştırmayı sonlandırmak.
10. `duplicateFinder.js` içindeki $O(N^2)$ döngüyü kaldırmak veya sınırlandırmak.
11. `package.json` içine Vitest ekleyip `sqlValidator` ve `validationService` için unit test yazmak.
12. `aiProvider.js` fetch isteklerine 30 saniyelik `AbortController` (timeout) eklemek.
13. AI prompt context'ine tablonun gerçek kolon tiplerini (`sys.columns`) ve indekslerini eklemek.
14. SQL Workbench sonuç grid'ine sayfalama veya sınırlı yükleme eklemek.
15. Validation Lab sonuna "Güvenli DDL Scripti Üret (Rollback Korumalı)" butonu eklemek.

---

#### S. PROFESYONEL SQL SERVER PERFORMANCE & REFACTORING ÜRÜNÜ YOL HARİTASI

```
[FAZ 1: Dürüstlük & Stabilizasyon (Sprint 1-2)]
  ├── Sahte/hardcoded verilerin (Math.random, statik grafikler, statik sekmeler) temizlenmesi
  ├── Ağırlık ayarlarının skorlama motoruna bağlanması
  ├── Non-deterministic validation bug'ının giderilmesi
  └── Temel unit test suite'inin kurulması

[FAZ 2: Profesyonel SQL Deneyimi (Sprint 3-4)]
  ├── Monaco Editor entegrasyonu (Renklendirme, auto-indent, minimap)
  ├── 5.000 view için sanal kaydırmalı (virtual scroll) envanter
  ├── fast-xml-parser ile ShowPlanXML operatör ağacının çizilmesi
  └── Before/After benchmark delta motorunun tamamlanması

[FAZ 3: Kurumsal Refactoring & Güvenlik (Sprint 5-6)]
  ├── DRAFT -> VALIDATED -> BENCHMARKED -> SCRIPT yaşam döngüsü
  ├── Windows Credential Manager / DPAPI entegrasyonu
  ├── AST tabanlı SQL parser (ScriptDom) ile kesin SARGable analizi
  └── Query Store plan değişimlerinin (Plan Flip Detection) otomatik tespiti
```

---

### NİHAİ PUANLAMA (0 - 100)

| Kategori | Puan | Gerekçe Özeti |
|---|---|---|
| **Mimari** | **58 / 100** | Backend servis ayrımı iyi; ancak frontend 5.600 satırlık god file, build yok, katmanlar arası kopukluklar var. |
| **Kod Kalitesi** | **52 / 100** | Stil ve isimlendirme temiz; ancak regex ile SQL/XML parse edilmesi ve `Math.random()` simülasyonları kaliteyi düşürüyor. |
| **UI / UX** | **74 / 100** | Dark-first estetik ve renk semantiği çok başarılı; ancak editörün `<textarea>` olması ve bazı sekmelerin statik kalması puan kırıyor. |
| **SQL Analiz Kabiliyeti** | **50 / 100** | AST yerine Regex heuristics kullanılıyor; alt sorgularda ve karmaşık T-SQL bloklarında yanılabiliyor. |
| **Performans Analiz Kabiliyeti** | **62 / 100** | STATISTICS IO/TIME, plan XML ve benchmark ölçümleri gerçek ve doğru; ancak aktif regresyon motoru backend'de boş. |
| **AI Entegrasyonu** | **60 / 100** | Prompt şablonları detaylı ve korumacı; fakat şema/indeks AI'ya gitmiyor, streaming ve timeout yok. |
| **Semantic Safety** | **68 / 100** | `sp_describe_first_result_set` ve Multiplicity EXCEPT doğrulaması çok iyi düşünülmüş; non-deterministic TOP riski var. |
| **Security** | **45 / 100** | Şifreleme anahtarı diskte düz metin saklanıyor; auth/CORS yok; readonly güvencesi string kontrolüne emanet. |
| **Test Coverage** | **5 / 100** | Projede otomatik hiçbir test altyapısı (`npm test`) bulunmamaktadır. |
| **Ticari Ürün Olgunluğu** | **42 / 100** | Harika bir vizyon ve ileri seviye bir prototip; ancak ticari ürün güvenilirliğine ulaşması için P0 ve P1 eylemleri şarttır. |
