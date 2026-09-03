# Antigravity Master Prompt

Aşağıdaki görevi mevcut repo üzerinde uygula. Önce `README.md`, `AGENTS.md` ve `docs/` altındaki tüm spesifikasyonları oku. Bunlar ürün sözleşmesidir; keyfi şekilde değiştirme.

## Proje

**SQL Server Refactoring & Performance Studio**

Vanilla HTML/CSS/JS + Node.js ile çalışan, localhost üzerinde açılan premium SQL Server auditing/refactoring aracı. İlk hedef Mikro ERP veritabanındaki yaklaşık 600 adet `AA_%` view.

## Zorunlu Mimari

- Frontend framework kullanma; mevcut HTML/CSS/JS yapısını koru.
- Node.js 20+ backend.
- `mssql` ile SQL bağlantısı.
- `Baslat.bat` ile açılabilirlik korunacak.
- SQL secret ve AI key browser storage'a yazılmayacak.
- Server yalnız `127.0.0.1` üzerinde dinleyecek.
- İlk sürüm tamamen read-only.
- AI SQL Server'a hiçbir DDL/DML çalıştırmayacak.

## İlk Uygulama Görevi

Mevcut premium mock UI'yi BOZMADAN gerçek backend verisiyle çalıştır:

1. Connection modal gerçek bağlantı durumunu yönetmeli.
2. SQL Server capability detection ekle:
   - version/edition
   - DB compatibility
   - collation
   - Query Store state
   - ilgili read permissions
3. `AA_` prefix configurasyonu ile gerçek view inventory getir.
4. `sys.sql_expression_dependencies` ile direct graph oluştur.
5. Reverse dependencies ve transitive graph hesapla.
6. Cycle/unresolved dependency tespit et.
7. Her view için:
   - depth
   - base table count
   - direct/transitive dependencies
   - dependent count
   - repeated base-table dependency paths
   hesapla.
8. Static analyzer'ı genişlet. Regex heuristic finding'leri kesin bug gibi etiketleme.
9. Health/Risk scoring'i `docs/03-SCORING.md` sözleşmesine yaklaştır.
10. Frontend mock data yerine API verisi geldiğinde aynı ekranlara map et; SQL bağlantısı yoksa demo mode devam etsin.
11. Error/loading/empty state'leri premium şekilde tamamla.
12. Tüm API response'larında güvenli hata handling yap; secret loglama.

## Sonraki Görevler İçin Hazırlık

Kod mimarisi şu modülleri kolay eklenebilir bırakmalı:
- Query Store runtime evidence
- plan XML parser
- statistics freshness
- duplicate fingerprinting
- AI provider abstraction
- validation lab
- local SQLite scan history

## Kritik Teknik Kurallar

- CTE materialize olmaz; repeated dependency path'i doğrudan physical scan sayma.
- View runtime cost attribution'ı kesinmiş gibi sunma. Evidence Grade kullan.
- `SELECT DISTINCT`, `ROW_NUMBER`, `UNION`, `ISNULL`, `CONVERT` tek başına hata değildir; bağlama göre risk pattern'idir.
- Query Store yoksa plan cache verisinin volatile olduğunu UI'da belirt.
- Actual benchmark initial scan sırasında çalışmasın.
- User view execute etme.
- Büyük base table üzerinde COUNT/SELECT taraması yapma.

## UX

Mevcut tasarım dilini koru:
- premium dark SQL tooling
- compact data density
- purple brand, red critical, orange high, yellow warning, green pass
- generic bootstrap/admin dashboard'a dönüştürme
- dependency graph merkez ekranlardan biri

## Definition of Done

- `npm start` hatasız.
- `Baslat.bat` çalışıyor.
- SQL bağlantısı yokken demo mode tam çalışıyor.
- SQL bağlantısıyla gerçek AA_% view listesi ve dependency graph gelir.
- hiçbir DB write yapılmaz.
- credentials persist edilmez/loglanmaz.
- API failures UI'yi bozmaz.
- README gerektiği kadar güncellenir.
