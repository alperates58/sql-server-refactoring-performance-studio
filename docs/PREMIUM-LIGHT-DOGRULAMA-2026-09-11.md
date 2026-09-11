# Premium light ve etkileşim doğrulaması

Tarih: 11 Eylül 2026
Ürün: SQL Server Refactoring & Performance Studio

Bu rapor, UI-UX-ANALIZ-2026-09-11.md dosyasındaki ilk incelemeden sonra yapılan değişiklikleri kaydeder. İlk rapordaki satır numaraları önceki kaynak sürümüne aittir. Bütün ilk bulguların kapatıldığı anlamına gelmez.

## Uygulanan değişiklikler

- Premium light varsayılanı: açık gri zemin, beyaz paneller, mor ana aksiyonlar, okunabilir metin ve anlamsal durum renkleri. Tema ilk çizimden önce yüklenir; sonraki kullanıcı seçimi saklanır. Ayarlara eksik Light seçeneği eklendi; Monaco tema geçişine eşlik eder.
- Ana yerleşim, Workbench araç çubuğu, view ayrıntıları ve ayarlar dar alana uyarlanır. Daraltılmış menü 68 px yer kaplar; 900 px altında açılır gezinme menüsü kullanılabilir.
- Doğrulama Lab demo modunda sahte PASS veya performans sonucu üretmez. SQL/veritabanı değişikliği, temizleme, örnek yükleme ve aday aktarımı önceki sonucu geçersiz kılar. Eski isteğin geç dönen sonucu yeni SQL üzerine yazılmaz.
- Semantik karşılaştırma ile performans ölçümü ayrı ve açıklayıcı etiketlere sahip. Hedef veritabanı açıkça seçilir; sorguları çalıştırma kabulü varsayılan olarak işaretli değildir.
- SQL aktarımı görünür Monaco modelinde yeni bir sekme açar. Workbench ve Çalışma Alanları üzerinden erişilen eksik yeni çalışma formu eklendi; SQL, veritabanı ve başlık forma taşınır. Form yerel kayıt oluşturur, SQL çalıştırmaz.
- View tanımı bulunamazsa uydurma SELECT/NOLOCK üretilmez. Tanımı olmayan nesne için AI eylemleri sınırlandırılır; açıklama metni Workbench'e SQL diye gönderilmez.
- Kritik view kısayolu gerçek kritik filtreyi uygular; K/M/B birimli Reads değerleri sayısal büyüklükle sıralanır.
- İndeks ve aktivite isteklerinde HTTP hataları başarı olarak gösterilmez. İndeks ekranı ortak hata bileşeninden bağlantı penceresine yönlendirir.
- İlk kurulum sihirbazı mevcut test-server ve set-scope uçlarıyla eşleştirildi. Başarılı test olmadan ileri bağlantı adımları tamamlanmaz; keşifte gerçek veritabanı isimleri kullanılır.
- Üretilen AI metinlerindeki özel fonksiyonlara erişemeyen inline tıklamalar ortak olay işleyicisine geçirildi; F5 doğru Workbench çalıştırma düğmesine bağlandı.

## Tarayıcıda kontrol edilen davranışlar

Yerel inceleme sunucusu 3017 portunda, otomatik SQL bağlantısı kapalı çalıştırıldı. Bu testler canlı veritabanına bağlanmadı.

| Alan / aksiyon | Gözlenen sonuç |
|---|---|
| 13 ana sayfaya menüden geçiş | Sayfa ve hash yönlendirmeleri açıldı; 1280×720 ölçümünde ana içerikte sayfa düzeyinde yatay taşma görülmedi. |
| View ayrıntısı: 9 sekme | Seçilen sekmeye karşılık gelen içerik açıldı. |
| Ayarlar: 8 sekme | Doğru panel açıldı; Light seçeneği düzeltildi. |
| Kritik view kısayolu | Kritik filtre ve 2 demo satırı açıldı. |
| Graph yakınlaştır/uzaklaştır/sığdır/sıfırla/merkezle | Grafik dönüşümü değişti; ayrıntıyı aç eylemi View Envanteri'ne geçti. |
| Açık/koyu tema ve yeniden yükleme | Tema değişti; light tercihi yeniden yüklemede korundu. |
| Masaüstü menü daraltma | Menü 68 px oldu; içerik soldaki boşluğu kullandı. |
| 900×720 menü → Workbench | Menü açıldı, Workbench'e geçildi, menü kapandı; belge genişliği 900 px kaldı. |
| Farklı iki demo SQL ile semantik karşılaştırma / ölçüm | Sonuç DOĞRULANMADI kaldı; sahte metrik oluşmadı. |
| Lab → Workbench | SELECT 42 AS value; görünür Monaco editörüne geldi; hedef veritabanı korundu. |
| Workbench biçimlendirme | SQL korundu, biçimlendirme bildirimi gösterildi. |
| Workbench → Çalışma Alanı Aç | Workspaces sayfası ve yeni çalışma formu açıldı; SQL forma aynen geldi. |
| Çalışma Alanları → Yeni Çalışma Başlat | Başlık/veritabanı/nesne alanları açıldı; alınamayan SQL tanımı boş bırakıldı. |
| Yeni çalışma formu Vazgeç | Form kapandı. Yerel test kaydı oluşturulmadı. |
| Bağlantı düğmesi / kapat | Sunucu ve veritabanı kapsamı penceresi açıldı ve kapandı. |
| İndeks yenile, bağlantısız | Başarı yerine hata gösterildi; hata panelindeki Bağlantı Ayarları düğmesi bağlantı penceresini açtı. |
| Tarayıcı hata günlüğü | Son kontrol dizisinde error/warn kaydı yoktu. |

## Otomatik kontroller

- Son kaynakla npm test: **378 başarılı, 0 başarısız**, 111 suite, yaklaşık 10,8 saniye.
- node --check public/assets/js/app.js: başarılı.
- git diff --check: boşluk hatası yok; yalnız Windows CRLF dönüşüm uyarıları var.
- Test sayısı mevcut backend/modül regresyon paketini ifade eder; 378 tarayıcı etkileşimi anlamına gelmez.

## Açık kalan bulgular ve doğrulama sınırları

- İlk rapordaki F10/F11/F22: demo regresyon ayrıntıları, grafik/özet bağımlılık sayıları ve runtime kanıt kapsamı henüz bütün ekranlarda tek tutarlı senaryo oluşturmuyor. Bu örnek değerler operasyonel karar kanıtı sayılmamalı. Tema değişikliği bu veri sorunlarını çözmez.
- F17: Graph sığdırma düğmesi çalışır; başlangıç yerleşiminin otomatik sığdırılması ve yoğun ağlarda okunabilirlik iyileştirmesi açık.
- F18/F19/F20/F21 kısmen giderildi: eksik tema değişkenleri, bazı terimler, aktarım ve navigasyon düzeldi. Bütün ekranların ortak durum bileşenlerine geçirilmesi, tam klavye/focus-trap denetimi ve ekran okuyucu kabulü tamamlanmadı.
- Gerçek bağlantı keşfi, çoklu veritabanı taraması, SQL yürütme/iptal, actual plan, benchmark, canlı validation, AI sağlayıcı sonucu ve aday onay/export zinciri bu bağlantısız incelemede uçtan uca çalıştırılmadı. Sihirbaz düzeltmesi kaynak/API sözleşmesi incelemesiyle doğrulandı.
- Yeni çalışma formunun açılışı, aktarımı ve vazgeçmesi tarayıcıda doğrulandı. Kalıcı kayıt ve aday yaşam döngüsü mevcut otomatik testlerle kapsanır; bu tur kullanıcı deposuna yeni test çalışması yazılmadı.
- Dar ekran kontrolü 900 px; telefon boyutlarında tam kabul testi yapılmadı.

SQL Server şeması/verisi değiştirilmedi; gerçek sorgu workload'u veya AI çağrısı başlatılmadı.
