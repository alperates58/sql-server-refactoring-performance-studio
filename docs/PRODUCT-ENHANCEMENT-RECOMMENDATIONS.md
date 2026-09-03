# Product Enhancement Recommendations
## SQL Server Refactoring & Performance Studio

**Doküman Amacı:**  
Bu doküman, SQL Server Refactoring & Performance Studio'nun vizyonunu generic bir SQL/veritabanı aracı olmaktan çıkarıp; **SQL Server performans optimizasyonu, view refactoring, derinlemesine plan teşhisi, bağımlılık analizi ve güvenli sorgu geliştirme** alanlarında SSMS'ten çok daha odaklı, akıllı ve proaktif bir uzman stüdyo haline getirecek yüksek değerli ürün önerilerini sunar.

---

### 1. Query Store Plan Regression & Plan Forcing Danışmanı

- **Problem:** SQL Server'da zamanla veri hacmi arttığında veya istatistik güncellendiğinde bir view/sorgu için optimizer farklı bir Plan ID seçebilir. Önceden 0.9s süren sorgu aniden Hash Join'den Nested Loops + Key Lookup'a dönerek dakikalarca sürebilir. SSMS'te bunu tespit etmek için Query Store GUI'sinde onlarca sorgu tek tek incelenmek zorundadır.
- **Çözülen İhtiyaç:** Studio, son 24 saat/7 gün içindeki Query Store plan geçmişini analiz ederek bir sorgunun birden fazla planı olup olmadığını, p95 süresinin aniden $\ge 3\times$ artıp artmadığını tespit eder ve regresyona giren sorguları tek listede önceliklendirir.
- **Kullanıcı Faydası:** "Bu sorgu neden dün hızlıydı bugün yavaş?" sorusuna saniyeler içinde eski ve yeni plan ID'leri, süreleri ve mantıksal okuma farklarıyla yanıt verir. İstendiğinde güvenli `sp_query_store_force_plan` komut taslağını kullanıcı onayına sunar.
- **Teknik Karmaşıklık:** Orta (Query Store katalog tabloları `sys.query_store_plan`, `sys.query_store_runtime_stats` sorgulanır).
- **Performans Etkisi:** Minimum (Yalnızca Query Store katalog metadata'sı okunur).
- **Güvenlik Etkisi:** Sıfır risk (Read-only analiz; plan forcing yalnızca script olarak export edilir, otomatik uygulanmaz).
- **Öncelik:** Çok Yüksek (P1).

---

### 2. Parameter Sniffing & Cardinality Varyans Tespit Motoru

- **Problem:** Saklı yordamlar veya parametrik view çağıran sorgularda ilk derlenen parametreye göre plan oluşturulur (parameter sniffing). Geniş bir tarih aralığı veya küçük bir müşteri kodu girildiğinde aynı plan felaket boyutunda IO/süre yaratır.
- **Çözülen İhtiyaç:** Query Store ve plan cache'te aynı query_hash/plan_handle için execution count, min duration, max duration ve standard deviation değerleri karşılaştırılır. Varyansı yüksek olan sorgular "Parameter Sniffing Riski" olarak etiketlenir.
- **Kullanıcı Faydası:** Geliştiriciye `OPTIMIZE FOR`, local değişken kopyalama veya recompile hint alternatiflerini içeren somut refactoring önerileri sunar.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Çok düşük (DMV ve Query Store agregasyonları).
- **Güvenlik Etkisi:** Sıfır risk (Salt-okunur).
- **Öncelik:** Yüksek (P1).

---

### 3. Bayat İstatistik & Veri Modifikasyon Takipçisi (`sys.dm_db_stats_properties`)

- **Problem:** Optimizer'ın yanlış execution plan seçmesinin ve devasa cardinality tahmin hatalarının (%1 tahmin edip 180.000 satır okuması) en yaygın kök nedeni tablolardaki istatistiklerin güncel olmamasıdır.
- **Çözülen İhtiyaç:** Kritik view'ların ulaştığı base tablolar üzerinde `sys.stats` ve `sys.dm_db_stats_properties` okunarak son güncelleme tarihi, satır sayısı, örneklenen satır sayısı ve modifikasyon sayacı (`modification_counter`) oranı hesaplanır. Modifikasyon oranı $>20\%$ olan tablolar görsel olarak "Stale Statistics" uyarısı alır.
- **Kullanıcı Faydası:** AI Refactoring ve Plan X-Ray ekranlarında kök nedenin SQL yazımından mı yoksa bayat istatistikten mi kaynaklandığı doğrudan gösterilir.
- **Teknik Karmaşıklık:** Düşük.
- **Performans Etkisi:** Sıfır (Hafif DMV metadata sorgusu).
- **Güvenlik Etkisi:** Sıfır risk (`UPDATE STATISTICS` otomatik çalıştırılmaz, yalnızca kullanıcıya bilgi verilir).
- **Öncelik:** Çok Yüksek (P1).

---

### 4. Akıllı Eksik İndeks (Missing Index) Analizi & Çakışma Filtresi

- **Problem:** SQL Server missing index DMV'leri (`sys.dm_db_missing_index_details`) her sorgu için ayrık indeks önerir. Bu öneriler körü körüne uygulandığında aynı tabloda 20-30 tane birbirinin kopyası veya ilk 2 sütunu aynı olan gereksiz indeks birikir ve write (INSERT/UPDATE) maliyetini katlar.
- **Çözülen İhtiyaç:** Studio, SQL Server'ın önerdiği eksik indeksleri tablodaki mevcut indeks envanteriyle çapraz kontrol eder. Prefix çakışması (aynı leading columns), include sütunlarının birleştirilme fırsatları ve yazma maliyeti hesaplanarak konsolide indeks önerisi üretilir.
- **Kullanıcı Faydası:** 10 ayrı indeks oluşturmak yerine 1 adet optimize kapsayıcı (covering) indeks önerilir.
- **Teknik Karmaşıklık:** Orta-Yüksek.
- **Performans Etkisi:** İhmal edilebilir.
- **Güvenlik Etkisi:** Sıfır (Dizin oluşturma komutları script export edilir).
- **Öncelik:** Yüksek (P1).

---

### 5. Kullanılmayan ve Mükerrer/Overlapping İndeks Denetçisi

- **Problem:** Yıllar içinde ERP sistemlerinde raporlar için eklenmiş ama artık hiç `Seek` veya `Scan` almayan, yalnız diski işgal eden ve INSERT/UPDATE işlemlerini yavaşlatan yüzlerce atıl indeks bulunur.
- **Çözülen İhtiyaç:** `sys.dm_db_index_usage_stats` ve `sys.indexes` incelenerek sıfır okuma alan veya başka bir bileşik indeksin alt kümesi olan gereksiz indeksler listelenir.
- **Kullanıcı Faydası:** Base table pressure ekranında tablonun bakım yükü ve disk ayak izi netleşir.
- **Teknik Karmaşıklık:** Düşük-Orta.
- **Performans Etkisi:** Sıfır.
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Orta (P2).

---

### 6. TempDB Spill & Bellek İzni (Memory Grant) Alarm Motoru

- **Problem:** Yetersiz bellek izni nedeniyle büyük Sort veya Hash Join işlemleri belleğe sığmayıp TempDB'ye yazar (Sort/Hash Spill). Bu durum sorgu süresini 10 katına çıkarır ve TempDB disk çekişmesine (contention) yol açar.
- **Çözülen İhtiyaç:** Execution plan XML'indeki `<SortSpillDetails>`, `<HashSpillDetails>` ve `<MemoryGrantInfo>` etiketleri parse edilerek sorgunun bellek yetersizliği ve TempDB baskısı tespit edilir.
- **Kullanıcı Faydası:** Sorgunun neden yavaşladığını "TempDB disk dökülmesi" olarak net biçimde açıklar; doğru indeks veya parçalı sorgu çözümü sunar.
- **Teknik Karmaşıklık:** Orta (Plan XML parsing).
- **Performans Etkisi:** Sıfır.
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Yüksek (P1).

---

### 7. Kaynak Bekleme İstatistikleri (Wait Statistics) Korelasyonu

- **Problem:** Bir sorgunun bekleme süresinin kaynağı CPU mu, disk IO mu (`PAGEIOLATCH_SH`), bellek mi (`RESOURCE_SEMAPHORE`), yoksa kilit çekişmesi mi (`LCK_M_*`)? Geliştirici sorgunun neden beklediğini bilmeden kodu optimize edemez.
- **Çözülen İhtiyaç:** Query Store (`sys.query_store_wait_stats`) aktifse sorgunun bekleme kategorileri (CPU, Lock, Buffer IO, Memory, Parallelism) oransal olarak gösterilir.
- **Kullanıcı Faydası:** "Sorgu CPU'da değil, diskten veri beklerken %82 süre kaybediyor" teşhisi konulabilir.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Düşük.
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Orta (P2).

---

### 8. Canlı Kilit & Engelleme Zinciri (Blocking & Concurrency) Haritası

- **Problem:** Bir view raporu çalıştırıldığında aniden donabilir; bunun nedeni sorgunun kendisi değil, arkada açık bir transaction'ın tabloyu kilitlemiş olmasıdır.
- **Çözülen İhtiyaç:** `sys.dm_os_waiting_tasks` ve `sys.dm_exec_requests` üzerinden canlı kilit zinciri ağaç formatında görselleştirilir (Head Blocker -> Blocked Sessions).
- **Kullanıcı Faydası:** Kullanıcı gereksiz yere view kodunu değiştirmek yerine kilit kaynağını anında görür.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Düşük.
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Orta (P2).

---

### 9. Execution Plan XML Operatör Ayrıştırıcısı & Görsel Ağaç

- **Problem:** SSMS'in grafik planı devasa XML'lerde yavaşlar, tarayıcıda ise raw XML okunamaz.
- **Çözülen İhtiyaç:** SQL Server `.sqlplan` XML formatını parse ederek en pahalı operatörleri (% Cost), Table Scan, Clustered Index Scan, Key Lookup, Spool ve Implicit Conversion uyarılarını modern bir ağaç/akış diyagramında sunar.
- **Kullanıcı Faydası:** 10.000 satırlık karmaşık plan XML'i içinden 3 saniyede dar boğaz olan Index Scan veya Key Lookup operatörü tıklanabilir kart olarak öne çıkar.
- **Teknik Karmaşıklık:** Yüksek (ShowPlanXML schema parsing).
- **Performans Etkisi:** Sıfır (İstemci/Node tarafında parse edilir).
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Çok Yüksek (P1 — Faz 2C kapsamında).

---

### 10. Cardinality Estimation Error (Kestirim Hatası) Oran Dedektörü

- **Problem:** Optimizer 1 satır tahmin ettiği için Nested Loops planı seçer, fakat çalışma anında 184.000 satır gelir. 184.000 kere iç döngü çalışarak Key Lookup yapar ve sorgu saatler sürer.
- **Çözülen İhtiyaç:** Actual execution plan ile estimated rows ve actual rows karşılaştırılır; oran $\ge 10\times$ veya $\ge 100\times$ olduğunda "CRITICAL Cardinality Explosion" uyarısı ve operatör vurgulanır.
- **Kullanıcı Faydası:** Katastrofik plan seçiminin kesin sebebi doğrulanır ve AI Refactor context'ine birincil problem olarak aktarılır.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Sıfır.
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Çok Yüksek (P1 — Faz 2C kapsamında).

---

### 11. Güvenli SQL Workbench & Katı Read-Only T-SQL Doğrulayıcı

- **Problem:** Geliştiriciler optimize sorguyu test etmek için SSMS'e geçmek zorunda kalır; bu da araçlar arası bağlam kaybına ve istemsiz DML/DDL kazalarına yol açar.
- **Çözülen İhtiyaç:** Stüdyo içine Monaco Editor tabanlı, sorgu çalıştırabilen, iptal edebilen (`Stop`), süre, CPU, mantıksal okuma ve dönen satır sayısını ölçen bir SQL Workbench entegre edilir.
- **Güvenlik Koruması:** Backend'de çok katmanlı token/ast doğrulayıcı ile `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `EXEC`, `sp_`, `xp_` kesin olarak engellenir; yalnız `SELECT` ve `WITH ... SELECT` sorgularına izin verilir.
- **Kullanıcı Faydası:** SSMS'e gitmeden optimize sorguları güvenli ortamda deneme, biçimlendirme ve sonuçları inceleme imkanı.
- **Teknik Karmaşıklık:** Yüksek.
- **Performans Etkisi:** Sorgu çalıştırma timeout koruması ile kontrol altındadır.
- **Güvenlik Etkisi:** Kritik derecede güvenli (Read-only whitelist politikası).
- **Öncelik:** En Yüksek (P1 — Faz 2B kapsamında).

---

### 12. Karşılaştırmalı Benchmark Modu (Comparative Run Lab)

- **Problem:** Bir sorgunun 1 kez çalıştırılması önbellek (cold/warm cache) nedeniyle yanıltıcı olabilir. 1 kez hızlı çalışan sorgu gerçekte optimize edilmemiş olabilir.
- **Çözülen İhtiyaç:** Workbench içinde 3, 5 veya 10 tekrarlı kontrollü sorgu yürütümü. Median, P95, Min, Max süre ve medyan mantıksal okuma hesabı.
- **Kullanıcı Faydası:** "Bu refactoring sorguyu %78 hızlandırdı ve IO'yu 4.1M'den 120K'ya düşürdü" iddiası istatistiksel medyan değerlerle kanıtlanır.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Kontrollü yük (Kullanıcı onayı ve tekrarlı limit ile çalışır).
- **Güvenlik Etkisi:** Read-only sınırı içinde.
- **Öncelik:** Yüksek (P1 — Faz 2B/2D kapsamında).

---

### 13. Çift Yönlü Sonuç Doğrulama (Semantic Equivalence: EXCEPT + Checksum)

- **Problem:** Bir sorgu optimize edilip daha hızlı çalışabilir ama ya 1 satır eksik döndürüyorsa veya NULL değerleri yanlış birleştiriyorsa?
- **Çözülen İhtiyaç:** Eski sorgu ile yeni sorgu arasında otomatik iki yönlü `EXCEPT` sorgusu (`Old EXCEPT New` ve `New EXCEPT Old`), satır sayısı ve satır hash kontrolü çalıştırılarak semantik doğruluk denetlenir.
- **Kullanıcı Faydası:** Hızlı ama hatalı sorguların canlı sisteme geçişi kesin olarak engellenir. "MATCH" veya "MISMATCH" etiketi üretilir.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Kullanıcı onaylı, satır sınırlı kontrollü sorgu.
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Çok Yüksek (P1 — Faz 2D kapsamında).

---

### 14. SQL Fingerprinting ile View Konsolidasyonu & Atıl View Tespiti

- **Problem:** 600 custom view olan ERP'lerde zamanla aynı rapor için `AA_SIPARIS_RAPOR`, `AA_SIPARIS_RAPOR2`, `AA_SIPARIS_RAPOR_YENI` gibi onlarca kopya view türer. Hangisinin kullanıldığı, hangisinin gereksiz olduğu bilinemez.
- **Çözülen İhtiyaç:** Normalize SQL parmak izi algoritması ile benzerlik oranı $\ge 80\%$ olan view'lar kümelenir. Query Store çalışma geçmişiyle birleştirilerek hiç çağrılmayan atıl kopyalar listelenir.
- **Kullanıcı Faydası:** Yüzlerce view'lık teknik borç temizlenir, şema sadeleşir.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Sıfır (İstemci/Node analizi).
- **Güvenlik Etkisi:** Sıfır risk.
- **Öncelik:** Yüksek (P1 — Faz 2E kapsamında).

---

### 15. Yerel SQLite Tarama Geçmişi (Snapshot Store)

- **Problem:** ERP veritabanına hiçbir tablo eklenemez veya kayıt yazılamaz (read-only kuralı). Ancak kullanıcı haftalık olarak health score değişimini ve hangi view'ların kötüleştiğini takip etmek ister.
- **Çözülen İhtiyaç:** Uygulamanın çalıştığı yerel makinede hafif bir SQLite veritabanı (`studio_history.db`) kullanılarak yapılan taramalar, view hash'leri ve metrikler yerel olarak saklanır.
- **Kullanıcı Faydası:** ERP veritabanına tek bir bayt yazmadan "Geçen aya göre DB Health 72'den 84'e çıktı, 14 regresyon çözüldü" trend grafikleri sunulur.
- **Teknik Karmaşıklık:** Orta.
- **Performans Etkisi:** Sıfır (ERP DB üzerinde sıfır yük).
- **Güvenlik Etkisi:** Şifreler ve kimlik bilgileri SQLite'a kesinlikle kaydedilmez.
- **Öncelik:** Yüksek (P2 — Faz 3).

---

### 16. Akıllı Telemetri Destekli AI Refactoring Context Paketi

- **Problem:** AI modellerine yalnızca view SQL metni verildiğinde model eksik bilgiyle hatalı varsayımlarda bulunur (tablo indekslerini, veri tiplerini, filtre seçiciliğini bilmez).
- **Çözülen İhtiyaç:** Model prompt'una view tanımının yanı sıra çocuk view tanımları, base table sütun tipleri, mevcut indeksler, bayat istatistik durumu, Query Store çalışma metrikleri ve execution plan'daki cardinality hataları otomatik derlenerek tek bir "Diagnostic Context Pack" olarak iletilir.
- **Kullanıcı Faydası:** Model halüsinasyon görmez; SQL Server'ın gerçek dar boğazına (örneğin eksik indeks veya SARGable olmayan predicate) yönelik nokta atışı refactoring ve indeks tavsiyesi üretir.
- **Teknik Karmaşıklık:** Yüksek.
- **Performans Etkisi:** Sıfır.
- **Güvenlik Etkisi:** Veri satırları gönderilmez, yalnızca yapısal metadata ve plan telemetrisi gider.
- **Öncelik:** Çok Yüksek (P1 — Faz 2E kapsamında).

---

### Özet Değerlendirme Tablosu

| No | Özellik | Odak Alanı | Karmaşıklık | Güvenlik | Öncelik |
|---|---|---|---|---|---|
| 1 | Plan Regression & Forcing | Runtime & Query Store | Orta | Sıfır Risk (Read-only) | P1 |
| 2 | Parameter Sniffing Detektörü | Cardinality & Compile | Orta | Sıfır Risk | P1 |
| 3 | Bayat İstatistik Monitörü | İstatistik & Optimizer | Düşük | Sıfır Risk | P1 |
| 4 | Akıllı Eksik İndeks Konsolidasyonu | Dizin Optimizasyonu | Orta-Yüksek | Script Export | P1 |
| 5 | Atıl İndeks Denetçisi | Dizin Temizliği | Düşük-Orta | Sıfır Risk | P2 |
| 6 | TempDB Spill & Memory Grant | Bellek & Disk IO | Orta | Sıfır Risk | P1 |
| 7 | Wait Stats Korelasyonu | Kaynak Darboğazı | Orta | Sıfır Risk | P2 |
| 8 | Canlı Kilit & Blocking Ağacı | Eşzamanlılık (Lock) | Orta | Sıfır Risk | P2 |
| 9 | ShowPlan XML Görsel Ayrıştırıcı | Plan X-Ray | Yüksek | Sıfır Risk | P1 |
| 10 | Cardinality Estimation Error | Hata Kök Neden | Orta | Sıfır Risk | P1 |
| 11 | Güvenli SQL Workbench | Sorgu Geliştirme & Test | Yüksek | Read-only Whitelist | P1 |
| 12 | Karşılaştırmalı Benchmark Modu | Performans Kanıtı | Orta | Kontrollü Yük | P1 |
| 13 | Çift Yönlü Sonuç Doğrulama | Semantik Eşdeğerlik | Orta | Bounded Read | P1 |
| 14 | View Konsolidasyon & Atıl View | Şema & Teknik Borç | Orta | Sıfır Risk | P1 |
| 15 | Yerel SQLite Tarama Geçmişi | Gözlemlenebilirlik | Orta | ERP'den Bağımsız | P2 |
| 16 | Telemetrili AI Context Paketi | AI Refactoring | Yüksek | Metadata Only | P1 |
