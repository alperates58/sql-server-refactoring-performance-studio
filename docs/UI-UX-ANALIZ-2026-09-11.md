# SQL Server Refactoring & Performance Studio — Arayüz ve İşlevsellik İncelemesi

Tarih: 11 Eylül 2026

## Sonuç

Ürünün ana sorunu yalnız renk, font veya boşluk değildir. Analiz araçları arasında tutarlı bir iş akışı kurulmamış; bazı ekranlar kullanıcının işlemi gerçekten tamamlayıp tamamlamadığını yanlış bildiriyor. Görsel yoğunluk, taşan araç çubukları ve kopan nesne/veritabanı bağlamı bu sorunu büyütüyor.

Backend ve yardımcı modüllerde kullanılabilir bir temel var. Buna karşılık mevcut arayüz, operasyonel kararların güvenle verilebildiği bütünleşik bir SQL çalışma ortamı seviyesinde değil. Önce sonuç doğruluğu ve akış bütünlüğü, sonra ekran düzeni düzeltilmeli.

## Kapsam ve yöntem

- 13 ana sayfa yerel tarayıcıda açıldı; içerik, durum ve navigasyon incelendi.
- Görsel inceleme 1280×720 boyutunda; dar ekran kontrolü 900×720 boyutunda yapıldı.
- Kritik listeye gitme, Reads sıralama, menü daraltma, demo doğrulama, SQL değiştirme ve bağlantısız indeks yenileme etkileşimleri tekrar üretildi.
- `public/index.html`, `public/assets/css/app.css`, `public/assets/js/app.js`, ilgili backend rotaları ve testler incelendi.
- `npm test`: **378 test, 378 başarılı, 0 başarısız**, yaklaşık 10,7 saniye.
- İnceleme sunucusu 3017 portunda, otomatik SQL bağlantısı devre dışı bırakılarak çalıştırıldı. Canlı SQL Server'a bağlanılmadı, SQL workload/benchmark çalıştırılmadı, AI sağlayıcısına istek gönderilmedi.
- Canlı bağlantı gerektiren bulgular kod incelemesidir; canlı sistemde uçtan uca doğrulanmış gibi değerlendirilmemelidir.
- Uygulama kaynakları değiştirilmedi; yalnız bu rapor eklendi.

Kanıt türleri: **UI** = tarayıcıda tekrar üretildi; **Kod** = kaynak/rota incelemesi; **Tasarım değerlendirmesi** = gözlenen düzenin kullanılabilirlik yorumu.

Öncelikler: **P1** = güvenilir karar veya temel akış bozuluyor; **P2** = kullanım önemli ölçüde zorlaşıyor; **P3** = tutarlılık ve bakım iyileştirmesi.

## 1. Sonuç doğruluğu ve işlevsel hatalar

### F01 — P1: Demo doğrulaması farklı sorguları başarılı gösteriyor

**Kanıt: UI + Kod.** Doğrulama Lab'a `SELECT 1 AS a;` ve `SELECT 2 AS b;` girildi. Ekran dört kontrolü BAŞARILI, genel sonucu PASS (UYARI İLE DOĞRULANDI) gösterdi. Tek kolonlu sorgular için “4 kolon” ve “1.000 satır” raporlandı.

Kaynak: `public/assets/js/app.js:5742` — demo dalı sorgulardan bağımsız sabit sonuçlar üretiyor.

**Etki:** Kullanıcı gerçek doğrulama ile demonstrasyonu ayırt edemeyebilir. Üstteki demo rozeti, sonuç panelindeki somut kanıt iddiasını düzeltmiyor.

**Düzeltme:** Demo çıktısı ayrı SIMULATED durumunda olmalı; gerçek PASS/SEMANTICALLY_VALIDATED dili ve yaşam döngüsü ilerlemesi kullanmamalı. SQL doğrulanmadıysa sonuç “doğrulanmadı” kalmalı.

### F02 — P1: SQL değiştirildikten sonra eski doğrulama kararı kalıyor

**Kanıt: UI.** Yukarıdaki testten sonra aday `SELECT 999 AS completely_different;` olarak değiştirildi. PASS etiketi ve dört başarılı kontrol değişmedi.

Kaynak: `public/assets/js/app.js:5540` civarındaki `initValidationLab`; editör değişimini eski kanıttan ayıran geçersizleştirme akışı eksik.

**Etki:** Kullanıcı farklı bir SQL sürümüne ait kanıtla karar verebilir. Gözlem demo modunda yapıldı; aynı editörlerin canlı sonuçları için de kodda ayrı bir geçersizleştirme mekanizması görülmedi.

**Düzeltme:** Kanıtı original/candidate SQL özeti, veritabanı ve test ayarlarına bağla. Bunlardan biri değişince sonucu STALE/UNVALIDATED yap; yeni doğrulama olmadan ilerlemeyi engelle.

### F03 — P1: İlk kurulum sihirbazı backend sözleşmesiyle uyuşmuyor

**Kanıt: Kod.** Son adım `/api/connection/connect` adresine POST gönderiyor; backend'de bu rota yok. Test adımı `/api/connection/test` kullanıyor ancak cevaptan `databases` bekliyor; bu rota `connection` ve `server` döndürüyor. Veritabanı keşfi ayrı `/connection/test-server` rotasında.

Kaynaklar: `public/assets/js/app.js:9906`, `public/assets/js/app.js:9959`, `server/routes/api.js:73`, `server/routes/api.js:96`.

Ayrıca son adımdaki HTTP sonucu kontrol edilmiyor, hatalar yutuluyor, sihirbaz bağlantı doğrulanmadan kapanıp “Kurulum Tamamlandı” diyor. İleri düğmesi test başarısını zorunlu tutmuyor. Başlangıçta sihirbaz, mevcut bağlantı senkronizasyonundan önce açılıyor (`app.js:10015`).

**Düzeltme:** Normal bağlantı modalı ve sihirbaz aynı bağlantı servisini kullansın: sunucuyu test et → veritabanlarını getir → kapsamı uygula → frontend bağlantısını yenile → tara. Başarı durumu gerçek API sonucuna bağlı olsun.

### F04 — P1: İndeks yenileme başarısızken başarı bildiriliyor

**Kanıt: UI + HTTP + Kod.** Bağlantısız durumda “Verileri Tara” tıklandı; “Veriler başarıyla güncellendi” mesajı çıktı. `/api/index-advisor` ve `/api/statistics-health` aynı oturumda HTTP 400 ve “SQL Server bağlantısı aktif değil veya veritabanı seçilmedi” döndürüyor.

Kaynak: `public/assets/js/app.js:8568` — `res.ok` false olunca hata gösterilmiyor; sonunda başarı toast'ı çalışıyor.

**Düzeltme:** Bağlantı önkoşulunu açık göster; HTTP/uygulama hatalarını ortak hata bileşenine dönüştür. Kısmi başarıyı ayrıca belirt. Başarısız yenilemede eski sonuç korunuyorsa tarihini ve güncel olmadığını göster.

### F05 — P1: View tanımı bulunamayınca tanım yerine yapay sorgu üretiliyor

**Kanıt: UI + Kod.** AI Refaktör'de “View SQL Tanımı” olarak `SELECT * FROM dbo.[view] WITH (NOLOCK) WHERE 1 = 1` gösterildi. `getViewDefinition` tanım alınamadığında bu sorguyu döndürüyor; fallback yalnız demo dalıyla sınırlandırılmamış.

Kaynak: `public/assets/js/app.js:825`, özellikle `:857`.

**Etki:** Bu, view'ın gövdesi değildir. AI bağlamı veya SQL karşılaştırması gerçek tanıma dayanıyormuş gibi sunulabilir. Hata sırasında veritabanı/schema bağlamı da `dbo` varsayımına indirgeniyor.

**Düzeltme:** Tanım yok durumunu görünür kıl; ilgili refaktör aksiyonunu kapat. Örnek kullanım sorgusu istenirse bunu ayrı ve açık bir işlem olarak sun.

### F06 — P1: Doğrulama Lab seçili veritabanını isteğe taşımıyor

**Kanıt: Kod.** `/validation/verify` rotası `database` alabiliyor; frontend yalnız originalSql, candidateSql ve sampleLimit gönderiyor. Üstteki “Doğrula” üzerinden yapılan iki `/workbench/run` isteğinde de database yok.

Kaynaklar: `public/assets/js/app.js:5665`, `public/assets/js/app.js:5730`, `server/routes/api.js:653`.

**Etki:** Birden fazla veritabanıyla çalışırken iki parçalı nesne isimleri için hedef bağlam açık biçimde korunmuyor; backend varsayılanına düşme ve yanlış nesneyi değerlendirme riski var. Canlı yanlış-veritabanı yürütmesi bu incelemede yapılmadı.

**Düzeltme:** Bağlantı, veritabanı, schema, canonical object ID ve aday sürümünü ekranlar arasında tek bağlam nesnesi olarak taşı. Hedef veritabanını doğrulama ekranında görünür tut.

### F07 — P1: Aynı ekranda iki farklı “doğrulama” anlamı var

**Kanıt: UI + Kod.** Üstteki “Doğrula”, iki sorguyu çalıştırıp metriklerini yan yana yazıyor. Alttaki “Validation Lab Doğrulamasını Başlat” semantik karşılaştırmayı çağırıyor. Kullanıcı ilk düğmeden sonuç eşitliği bekleyebilir.

Kaynaklar: `public/assets/js/app.js:5651`, `:5714`; `public/index.html:1278`.

Üretim test riskini kabul kutusu başlangıçta işaretli. Üst düğme bu kutuya bağlı değil. Dolayısıyla arayüz kontrollü test ile normal analiz arasındaki farkı yeterince açık kurmuyor.

**Düzeltme:** “Semantik karşılaştır” ve “Performans ölç” işlemlerini ayır. Ölçüm için hedef DB, sınırlar ve çalıştırılacak iki SQL açıkça gösterilsin; önceden işaretli kabul kullanılmasın.

### F08 — P2: Kritik view kısayolu kritik filtreyi uygulamıyor

**Kanıt: UI + Kod.** Genel Bakış → “Kritik View'ları İncele” sonrasında Tümü 12 seçili kaldı; Kritik 2 uygulanmadı.

Kaynaklar: `public/index.html:145` civarı hero aksiyonu; `public/assets/js/app.js:269` genel data-goto işleyicisi.

**Düzeltme:** Navigasyon hedefi yalnız sayfa adı değil filtre ve seçim içermeli. Düğme kritik filtreli envanteri açmalı; hash/URL bu bağlamı geri yükleyebilmeli.

### F09 — P2: Reads sıralaması sayısal büyüklüğü yanlış değerlendiriyor

**Kanıt: UI + Kod.** Reads'e basıldığında 984M, 812M, 702M üst sıralara geldi; 4.1B görünür ilk beşten çıktı. Fallback parser M/B birimlerini ve ondalık ayıracını siliyor.

Kaynak: `public/assets/js/app.js:615` civarı `parseInt(...replace(/[^0-9]/g, ''))`.

**Düzeltme:** Sıralama ham sayısal logicalReads alanıyla yapılmalı. Formatlı metin yalnız görünüm çıktısı olmalı. Demo veri de aynı veri sözleşmesini kullanmalı.

### F10 — P1: Regresyon tablosu ve X-Ray birbirini yalanlıyor

**Kanıt: UI + Kod.** Aynı nesne için tabloda 0.94s → 284s, +30.112% artış gösterilirken X-Ray STABİL ve “performans anomalisi tespit edilmedi” diyor. Bellek alanında Normal, kardinalite alanında Sapma Yok yazıyor.

Kaynak: `public/assets/js/app.js:2583` içindeki `updateRegressionXRay`.

Eksik alanlar “bilinmiyor” yerine normal/stabil olarak yorumlanıyor. X-Ray bazı alanlarında süre değişimi kardinaliteye, CPU değişimi bellek tahsisine yazılıyor. Bunlar farklı ölçümlerdir.

**Düzeltme:** Tek bir normalize edilmiş regresyon veri modeli kullan. Plan XML yoksa operatör akışını gerçek plan gibi sunma. Kardinalite ve memory grant alanları yalnız ilgili kanıt varsa dolsun; eksik veri “ölçülmedi” olsun.

### F11 — P1: Runtime kanıtının kapsamı özetlerde kayboluyor

**Kanıt: UI + Kod.** Genel Bakış öncelik satırlarında view adı yanında “24h Reads 4.1B” yazıyor; attributionMethod, çağıran sorgu kapsamı ve Evidence Grade gösterilmiyor. Runtime sayfasının üst kanıt rozeti demo modunda A gösteriyor.

Kaynaklar: `public/assets/js/app.js:640` civarı risk satırı şablonu; `public/index.html` runtime ekranı.

**Etki:** Calling query maliyeti view'ın doğrudan maliyeti gibi okunabilir. Projenin Runtime Attribution Dürüstlüğü kuralı sunum katmanında tutarlı uygulanmıyor.

**Düzeltme:** “Bu view ile ilişkilendirilen çağrılar” ifadesi, zaman aralığı, yöntem ve kanıt derecesi birlikte görünmeli. Kanıt bulunmaması A/başarılı anlamına gelmemeli.

## 2. Görsel düzen ve kullanılabilirlik

### F12 — P1: Workbench araç çubuğu çalışma alanını yatay taşırıyor

**Kanıt: UI + ölçüm.** 1280×720 ekranda `.main.clientWidth = 1015`, `.main.scrollWidth = 1953`: yaklaşık **938 px yatay taşma**. Çalıştırma, plan, benchmark, kayıt, workspace, font, metadata ve sınır kontrolleri aynı satıra yüklenmiş.

Kaynak: `public/assets/css/app.css:3183`, `.workbench-toolbar` ve üç flex grubu.

**Düzeltme:** Birincil satırda DB + Çalıştır + İptal + durum; ikincil satır/menüde plan, format ve kayıt; çalıştırma ayarlarında limit/timeout. Editör ve sonuçlar kalan alana sığan ayarlanabilir bölmeler olmalı. Genel sayfa yerine yalnız sonuç tablosu gerektiğinde yatay kaymalı.

### F13 — P2: Envanter panelinde başlık ve sekmeler kesiliyor

**Kanıt: UI.** 1280 px genişlikte 250 px menü, 390 px envanter ve içerik padding'i sonrasında detay paneli dar kalıyor. Uzun view adı health rozetiyle sıkışıyor; sağ sekmeler görünüm dışında kalıyor; bulgu kartı cümleleri çok sayıda satıra bölünüyor.

Kaynak: `public/assets/css/app.css:1882`, `.views-workspace`; detay bölümü `public/index.html`.

**Düzeltme:** Envanter genişliği ayarlanabilsin. Kimlik satırı ve sağlık/risk ayrı hizalansın. Sekmeler bilinçli kaydırılabilir veya ikincil menüye taşınabilir olsun. Dar durumda iki sütunlu detay kartları tek sütuna geçsin.

### F14 — P2: Menü daraltma içerik alanı kazandırmıyor

**Kanıt: UI + ölçüm.** Menü 60 px oluyor ama grid ilk sütunu 250 px kalıyor; ana içerik x=250'de başlıyor. **190 px boş şerit** oluşuyor.

Kaynak: `public/assets/css/app.css:968`, `:6395`.

**Düzeltme:** Daraltma sidebar genişliğini ve app-shell grid kolonunu aynı token üzerinden değiştirsin.

### F15 — P1: 900 px ve altında temel navigasyon kaldırılıyor

**Kanıt: UI + Kod.** 900×720'de sidebar yok oluyor; yerine görünür menü açma düğmesi gelmiyor. Aynı breakpoint envanter listesini, graph inspector'ı ve ayarlar navigasyonunu da gizliyor.

Kaynak: `public/assets/css/app.css:5385`.

**Etki:** Kullanıcı modül, view ve ayar kategorisi seçimini kaybediyor. Bu yalnız telefon sorunu değil; bölünmüş Windows pencerelerinde de görülür.

**Düzeltme:** Gizlenen navigasyonun yerini drawer/seçici almalı. Masaüstü odaklı ürün olsa da desteklenen minimum genişlikte temel işlevler erişilebilir kalmalı.

### F16 — P2: Dashboard'da karar listesi ilk ekranın dışında kalıyor

**Kanıt: UI; tasarım değerlendirmesi.** Büyük tanıtım bloğu, sağlık halkası ve beş sütunda yedi metrik kartı ilk ekranı dolduruyor. Son iki kart ayrı bir satır oluşturuyor. Kullanıcının çalışacağı “Bugün Müdahale Edilecekler” listesi aşağıda kalıyor.

Kaynak: `public/index.html:133`, `public/assets/css/app.css:1494`.

**Düzeltme:** İlk açılışta kısa yönlendirme; sonraki açılışlarda kompakt bağlantı/tarama özeti ve öncelik tablosu. Sağlık halkası ve tanıtım metni ikincil olmalı. Kartlar tek operasyonel soruyu yanıtlamalı.

### F17 — P2: Graph ilk görünümde tüm ağı okunabilir sunmuyor

**Kanıt: UI.** 1280 px genişlikte sol düğümler kısmen kesiliyor, inspector sağdaki düğümleri örtüyor; araç çubuğunun tamamı sığmıyor. Fit düğmesi mevcut, fakat ilk görünüm otomatik olarak kullanılabilir bir çerçeve üretmiyor.

**Düzeltme:** İlk yerleşim ve fit hesabı açık inspector'ın kapladığı alanı dikkate alsın. Araç çubuğu dar genişlikte gruplanmalı. Seçili nesne ve upstream/downstream yönü tüm görünümde anlaşılır kalmalı.

### F18 — P2: Tasarım token sistemi eksik ve ortak bileşenler fiilen kullanılmıyor

**Kanıt: Kod + hesaplanan stil.** CSS'de fallback olmadan kullanılan 13 token aynı dosyada tanımlı değil: `--border`, `--radius-md`, `--font-family-mono`, `--accent`, `--font-family-sans`, `--surface-2`, `--radius-lg`, `--text-bright`, `--danger`, `--warning`, `--success`, `--surface-sunken`, `--radius-pill`. İncelenen `--border`, `--radius-md`, `--danger`, `--warning`, `--success` hesaplanan kök stillerde de boş.

`uiStates.js` ve `formatters.js` HTML'de yükleniyor; `app.js` bunları kullanmak yerine kendi durum markup'ını ve formatlarını üretiyor.

Kaynaklar: `public/assets/css/app.css:3190`, `public/assets/js/app.js:121`, `public/index.html:2581`.

**Düzeltme:** Tek isimlendirilmiş token sözlüğü; komponentler bu tokenlarla çalışmalı. Empty/loading/error ve sayı/süre/bellek çıktısı ortak modüllerden gelmeli. Bu, AGENTS.md'nin State Standardization şartıyla da uyum sağlar.

### F19 — P2: Renk ve dil, ölçüm anlamını yeterince taşımıyor

**Kanıt: UI; tasarım değerlendirmesi.** HEALTH ve RISK farklı yönlerde iyi/kötü anlam taşıyor ama aynı görsel blokta sıkışıyor. “Risk Dağılımı” altında “Sağlık cezaları” yer alıyor. Türkçe metin içinde depth, dependents, reads, Clean, STABİL, MODERATE ve İngilizce durumlar karışıyor. Emoji ve metin karakterlerinden oluşan ikonlar farklı ağırlık ve hizalar üretiyor.

**Düzeltme:** “Sağlık: yüksek iyi”, “Öncelik riski: yüksek acil” açıklaması tutarlı olsun. Türkçe birincil etiket, gerekiyorsa ikincil teknik terim kullanılsın. Aynı strok/ölçüde yerel SVG ikon seti yeterli; framework değişikliği gerekmiyor.

## 3. Akış ve mimari sorunlar

### F20 — P2: Çok sayıda giriş noktası var, ortak çalışma bağlamı zayıf

Envanterde AI sekmesi, ayrı AI sayfası, ayrı Validation Lab, Workbench ve Workspaces var. Aynı işi birden fazla yerde başlatmak mümkün; aktif adayın hangi nesne/veritabanı/sürüme ait olduğu her geçişte açık değil. Sayfa hash'i var ama nesne, alt sekme, filtre ve aday sürümü hash'e dahil edilmiyor.

Kaynaklar: `public/assets/js/app.js:208`, `:5877`, `:4800`.

Eski ve yeni aktarım kodları birlikte bulunuyor. Örneğin aynı candidate → Workbench düğmesine hem yeni aktarım işleyicisi hem `initAiWorkbenchIntegration` içinde textarea'ya doğrudan yazan işleyici bağlanıyor. Bu incelemede bütün aktarım varyantlarının Monaco üzerindeki sonucu test edilmedi; tek entegrasyon yolu altında birleştirilmeleri gerekir.

**Hedef akış:** Bağlan → kapsamı tara → öncelikli nesneyi seç → kanıtını incele → çalışma oluştur → aday üret → doğrula → kontrollü benchmark → betik dışa aktar.

Her aşamada şu bağlam görünür kalmalı: sunucu / DB / schema.nesne / aday sürümü / kanıt durumu. Her ekran bir sonraki işlemi ve eksik önkoşulu açıkça söylemeli.

### F21 — P2: Kısayol ve erişilebilirlik sözleşmesi tamamlanmamış

**Kanıt: Kod ve erişilebilirlik ağacı.** Global F5 işleyicisi HTML'de olmayan `#btnWbRunQuery` düğmesini çağırıyor; gerçek düğme `#btnWbRun`. Monaco'nun kendi kısayolları ayrıca bulunduğu için “F5 hiçbir yerde çalışmaz” sonucu çıkarılmamalı; odak dışındaki global yol bozuktur.

Kaynak: `public/assets/js/app.js:9834`, `public/index.html:1350`.

Risk ve envanter satırları tıklanabilir div/container olarak sunuluyor. Semantik düğme/link, odak ve klavye aktivasyonu eksik. Grup başlıklarında açılma durumu erişilebilirlik ağacına belirgin bir expanded state olarak yansımıyor.

**Düzeltme:** Kısayollar tek komut kayıt tablosundan hem UI yardımına hem işleyicilere üretilebilir. Etkileşimli satırlar klavyeyle seçilip açılmalı; modal odak ve geri dönüş davranışları ayrıca test edilmeli.

### F22 — P2: Demo verisi kendi içinde tutarlı bir senaryo değil

**Kanıt: UI.** Envanterde 12 view var, Mükerrer Mantık başlığında 600 yazıyor; tablo baskısında 183/211 kullanan view gibi sayılar görülüyor. Runtime'da ciddi artışlar normal olarak etiketleniyor. Bazı özetler sabit “+4 bugün” ve “1 dk önce” ifadeleri taşıyor.

Kaynaklar: `public/index.html`, `public/assets/js/mock-data.js`, `public/assets/js/app.js:53`.

**Düzeltme:** Bütün demo ekranları aynı küçük, tutarlı veriden türetilsin. Her örneğin nesnesi, bağımlılığı, çağıran sorgusu, planı ve aday sonucu birbirini desteklesin. Tarihler canlı akış izlenimi vermesin.

## 4. Testler neden bu sorunları yakalamıyor?

378 testin geçmesi backend ve yardımcı fonksiyonlar için değerli bir sinyal. Fakat ürün kullanılabilirliğinin kanıtı değil. `test/productUxAndRelease.test.js:251` ve devamındaki birçok kontrol HTML'de ID/metin bulunmasını test ediyor. Düğmenin hedef filtreyi açması, 1280 px'de kesilmemesi veya HTTP 400 sonrası başarı bildirilmeyeceği bu şekilde doğrulanamıyor.

Frontend controller yaklaşık **10.055 satır**, CSS **6.791 satır**, HTML **2.589 satır**. Boyut tek başına hata değildir; ancak dağınık fetch işleme, tekrar bağlanan event'ler, birden fazla veri alanı adı ve inline stil birleşince davranış değişikliklerinin etkisini takip etmek zorlaşıyor.

Öncelikli anlamlı kabul testleri:

1. İlk kurulum yalnız başarılı test ve kapsam uygulamasından sonra tamamlanır.
2. Kritik CTA kritik filtreyi açar; Reads sayısal büyüklükle sıralanır.
3. Bağlantısız/hatalı API çağrısı başarı veya “sorun yok” sonucu üretmez.
4. Demo karşılaştırma doğrulanmış statüsü üretmez.
5. SQL/DB/ayar değişikliği mevcut kanıtı geçersizleştirir.
6. Çoklu DB'de seçili nesnenin bağlamı AI, Workbench ve Validation boyunca korunur.
7. Tanım erişilemezse yapay tanım üretilmez.
8. 1280×720 ve 1366×768'de temel komutlar görünür; 900 px'de alternatif navigasyon vardır.
9. Menü daraltma gerçek içerik alanı kazandırır.
10. Klavyeyle envanter seçimi ve modal aç/kapa/odak dönüşü tamamlanır.

## 5. Önerilen uygulama sırası

### Aşama 1 — Güvenilir sonuç ve bağlantı akışı

F01–F07, F10–F11. Ortak API hata işleyicisi ve açık veri durumları: bağlantısız, demo, yükleniyor, canlı, eksik yetki, hata, eski sonuç. Doğrulama kanıtı SQL sürümüne bağlanır. SQL tanımı bulunamadığında işlem durur.

**Kabul:** Uygulama tamamlamadığı bir işi tamamlandı/başarılı göstermez; başka DB veya SQL sürümüne ait kanıtı kullanmaz.

### Aşama 2 — Çalışılabilir ekran iskeleti

F12–F18. Shell, menü, topbar, split pane ve toolbar ölçüleri birlikte düzenlenir. Workbench birincil komutları ve envanter detay alanı önceliklidir. Tokenlar ve ortak durum bileşenleri tamamlanır.

**Kabul:** Desteklenen masaüstü boyutlarında sayfa düzeyinde yatay taşma yoktur; önemli kontroller gizlenmez; menü daraltma ve dar ekran seçicileri çalışır.

### Aşama 3 — Tek çalışma akışı ve karar sunumu

F08–F09, F19–F22. Seçili nesne ve adayın ortak bağlamı; overview'da gerçek öncelik tablosu; kanıt ayrıntısından aday/validation/workspace'e tek aktarım yolu; tutarlı demo senaryosu.

**Kabul:** Kullanıcı “hangi nesneye bakıyorum, hangi kanıt var, sonuç ne kadar güvenilir ve sıradaki işlem ne?” sorularını her ekranda yanıtlayabilir.

### Aşama 4 — Davranış testleri ve görsel kalite kapısı

Kritik kullanıcı yolculukları için tarayıcı testleri, ölçülen taşma kontrolleri ve hata durumu kontrolleri eklenir. Mevcut anlamlı backend testleri korunur. Vanilla HTML/CSS/JS mimarisi yeterlidir; çözüm için framework göçü gerekmiyor.

## Korunması gerekenler

- Beş gruplu navigasyon ve sayfa hash yönlendirmesi mevcut bir temel sunuyor.
- Yerel Monaco bu ortamda açıldı; bu bütün makinelerde offline paketlemeyi kanıtlamaz fakat editör entegrasyonu çalışıyor.
- Workbench'te sekme, sonuç, geçmiş, export ve limit kontrolleri mevcut; yeniden tasarım bunları tek kullanılabilir komut düzeninde toplamalı.
- Ayrı sağlık/risk kavramı, kanıt dereceleri ve aday yaşam döngüsü servisleri doğru ürün yönü; sunum ve geçişler bunlarla hizalanmalı.
- Uygulamanın güçlü yanı çok modül içermesi değil, bu modülleri güvenilir tek bir refaktör sürecine bağlayabilecek altyapısının bulunmasıdır.
