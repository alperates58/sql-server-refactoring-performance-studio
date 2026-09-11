# SQL Server Refactoring & Performance Studio

**Sürüm:** `v0.8.0-beta`  
**Lisans & İlke:** %100 Salt-Okunur (Zero Database Mutation)  
**Mimari:** Vanilla Web UI + Node.js 20+ Local Server + SQLite Workspaces & Offline Monaco Engine

SQL Server view envanteri, dependency haritalama, Query Store / DMV runtime kanıtı, AST analizi, güvenli AI refactoring ve profesyonel SQL geliştirme ortamını birleştiren kurumsal stüdyo.

---

## 🎯 Temel Amaç

Özellikle yıllar içinde yüzlerce custom view (`AA_%`) biriken karmaşık SQL Server ve Mikro ERP veritabanlarında:
1. **Hangi view hangi tablolara veya alt view'lara bağlı?** (İki yönlü bağımlılık grafiği & döngüsel referans tespiti)
2. **Hangi view yapısal olarak riskli?** (Non-SARGable filtreler, SELECT DISTINCT, UNION ALL ihlalleri, SELECT *)
3. **Hangisi gerçekte CPU / Logical IO / Süre tüketiyor?** (Query Store & Plan Cache DMV korelasyonu, Evidence Grade A-D)
4. **Bugün 1 saniyelik sorgu neden 5 dakikaya çıktı?** (Plan regresyonları, CPU/IO ani yükselmeleri)
5. **Aynı fiziksel tablo kaç farklı daldan taranıyor?** (Table Pressure & base table scan çoğalması)
6. **Bir view değişirse üst tarafta hangi raporlar etkilenir?** (Upstream blast radius analizi)
7. **Benzer veya mükerrer SQL mantıkları nerede?** (SQL Fingerprint benzerlik skorlaması)
8. **AI güvenli ve şema-korumalı bir SQL alternatifi üretebilir mi?** (DeepSeek / OpenAI / Anthropic entegrasyonu)
9. **Yeni sorgu eskisinin yerine geçebilir mi?** (Doğrulama Lab, checksum, row count & bounded execution benchmark)
10. **Profesyonel SQL geliştirme için ne gerekiyor?** (Çok sekmeli SQL Workbench, multi-result, plan XML görselleştirici, kayıtlı sorgular)

---

## 🚀 Hızlı Başlangıç

### Windows (Önerilen)
`Baslat.bat` dosyasına çift tıklayın. Gerekli bağımlılıklar kontrol edilir ve stüdyo tarayıcınızda açılır (`http://localhost:3000`).

### Manuel Başlatma
```bash
npm install
npm start
```
*Gereksinim: Node.js 20+*

---

## 🧭 Bilgi Mimarisi & Modüller

Stüdyo 5 ana kategoride toplanmış 13 modülden oluşur:

| Kategori | Modül | Açıklama |
|---|---|---|
| **GENEL** | **Genel Bakış** (`#overview`) | Veritabanı sağlık skoru, kritik darboğazlar, özet metrikler ve hızlı aksiyonlar. |
| **ANALİZ** | **View Envanteri** (`#views`) | Önek bazlı filtrelenmiş view listesi, health/risk puanları ve filtreleme. |
| | **Bağımlılık Haritası** (`#graph`) | İki yönlü bağımlılık grafiği, döngüsel bağımlılıklar ve etki alanı (blast radius). |
| | **Çalışma Zamanı** (`#runtime`) | Query Store & DMV kanıtlarıyla runtime maliyeti ve aktif regresyonlar. |
| | **Tablo Baskısı** (`#tables`) | View ağaçları altında en çok baskı gören temel tablolar ve erişim sıklıkları. |
| | **Mükerrer Mantık** (`#duplicates`) | Farklı view'lar arasındaki normalize SQL benzerlikleri ve fingerprint analizi. |
| **OPTİMİZASYON** | **AI Refaktör** (`#refactor`) | Yapay zeka destekli view refaktör önerileri, güvenli SQL adayları ve diff. |
| | **Doğrulama Lab** (`#validation`) | Semantik doğrulama, IO/süre benchmark karşılaştırması ve deployment scriptleri. |
| | **Çalışma Alanları** (`#workspaces`) | Kalıcı refaktör oturumları, aşamalar, diff geçmişi ve SQLite kayıtları. |
| **SQL ARAÇLARI** | **SQL Workbench** (`#workbench`) | Çok sekmeli Monaco editörü, multi-result, execution plan ve sonuç ızgarası. |
| | **İndeks & İstatistik** (`#indexes`) | Eksik indeks tavsiyeleri, istatistik güncelliği ve parçalanma durumu. |
| | **Canlı Aktivite & Kilit** (`#activity`) | Canlı SQL Server oturumları, kilitlenmeler, bekleme istatistikleri ve aktif sorgular. |
| **SİSTEM** | **Ayarlar & Tanılama** (`#settings`) | 8 sekmeli sistem yapılandırması, AI ayarları, puanlama ve destek tanılaması. |

---

## ⌨️ Klavye Kısayolları

| Kısayol | İşlem |
|---|---|
| <kbd>F5</kbd> / <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Aktif SQL sorgusunu çalıştır |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> | Yeni SQL sekmesi aç |
| <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> | T-SQL kodunu biçimlendir |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Sorguyu kaydet (Favorilere ekle) |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | Sol menüyü daralt / genişlet |
| <kbd>F2</kbd> | Temayı değiştir (Açık / Koyu) |
| <kbd>Esc</kbd> | Aktif modalı veya sorguyu iptal et |
| <kbd>?</kbd> veya <kbd>F1</kbd> | Kısayol rehberi modalını aç |

---

## 🛡️ Güvenlik Kalkanı & Kurallar (Invariants)

1. **ZERO DATABASE MUTATION**: Stüdyo canlı SQL Server üzerinde hiçbir zaman `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `INSERT`, `UPDATE`, `DELETE` çalıştırmaz.
2. **SALT-OKUNUR ÇALIŞMA**: Tüm sorgular metadata kataloğu (`sys.views`, `sys.sql_expression_dependencies`), Query Store ve plan cache DMV'leri üzerinden salt-okunur (read-only) yürütülür.
3. **DAĞITIM BETİĞİ KONTROLÜ**: Refaktör onaylandığında doğrudan veritabanına uygulanmaz; `DEPLOY.sql` ve `ROLLBACK.sql` işlem bloklu (transactional) betikler olarak üretilir ve DBA onayına sunulur.
4. **SIFIR ŞİFRE / ANAHTAR SIZINTISI**: SQL parolaları ve AI API anahtarları asla tarayıcı depolamasına (localStorage/IndexedDB), log dosyalarına veya destek tanılaması JSON dökümüne yazılmaz.
5. **%100 ÇEVRİMDIŞI MONACO EDITÖRÜ**: Monaco Editor harici CDN gerektirmeden yerel static dosyalardan servis edilir; internet erişimi olmayan izole ağlarda sorunsuz çalışır.
6. **AĞIR SORGU YASAĞI**: Canlı tarama sırasında kullanıcı tabloları üzerinde doğrudan `SELECT *` veya `COUNT(*)` gibi kilitleyici sorgular kesinlikle çalıştırılmaz.

---

## 🧪 Test Kapsamı

Proje `node:test` standart test koşucusuyla 26 test süiti ve 368'in üzerinde birim/entegrasyon testiyle doğrulanmaktadır:
```bash
npm test
```
*Total Suites: 26 · Total Tests: 368+ · Zero Failures*
