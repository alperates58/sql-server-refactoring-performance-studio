# SQL Server Refactoring & Performance Studio

Premium, local-first SQL Server denetim, dependency haritalama, runtime performans analizi ve AI destekli güvenli refactoring stüdyosu.

## Amaç

Özellikle yıllar içinde yüzlerce custom view (`AA_%`) biriken Mikro ERP veritabanlarında şu soruları tek uygulamada cevaplamak:

1. Hangi view hangi view/table/function nesnesine bağlı?
2. Hangi view yapısal olarak riskli?
3. Hangisi gerçekte CPU / logical reads / duration üretiyor?
4. Bugün neden 1 saniyelik sorgu 5 dakikaya çıktı?
5. Aynı fiziksel tablo kaç farklı dependency dalından tekrar kullanılıyor?
6. Bir view değişirse üst tarafta hangi view/raporlar etkilenir?
7. Benzer/duplicate SQL mantıkları nerede?
8. AI daha iyi bir candidate üretebilir mi?
9. Yeni candidate eski sonuçla gerçekten eşdeğer mi?
10. Performans kazanımı ölçülmüş mü, yoksa yalnız tahmin mi?

## Çalıştırma

Windows'ta `Baslat.bat` dosyasına çift tıklayın. İlk çalıştırmada gerekli npm paketleri otomatik kurulur ve uygulama `http://localhost:3000` adresinde açılır.

Manuel:

```bash
npm install
npm start
```

Node.js 20+ önerilir.

## Mevcut Sürüm Özellikleri

- **Canlı SQL Server & Demo Modu**: Bağlantı kurulduğunda canlı `AA_%` metadata'sı taranır; bağlantı yokken mock dataset ile kesintisiz çalışır.
- **Güvenlik**: Yalnızca `127.0.0.1` dinlenir. Tamamen read-only. SQL şifresi ve AI anahtarı tarayıcı depolamasına yazılmaz, backend loglarına düşmez.
- **SQL Server Capability Detection**: SQL sürüm/edition, compatibility level, collation, Query Store durumu ve read permissions (`VIEW DEFINITION`, `VIEW DATABASE STATE`).
- **Dependency DAG Motoru**: `sys.sql_expression_dependencies` üzerinden direct, transitive downstream, upstream blast radius, cycle ve repeated base-table access hesaplaması.
- **Genişletilmiş Statik Analiz**: `SELECT DISTINCT`, `UNION` without `ALL`, window functions, non-SARGable predicate ifadeleri, scalar UDF çağrıları ve `SELECT *` tespiti (kesin bug değil, bağlamsal risk paterni olarak etiketlenir).
- **Health & Risk Scoring**: `docs/03-SCORING.md` standartlarına uygun puanlama, ceza dökümü ve Evidence Grade (A, B, C, D) atıfları.
- **SQL Fingerprinting**: Normalize SQL karşılaştırması ile duplicate view adaylarının tespiti.
- **Table Pressure Haritası**: En çok referanslanan, kritik tüketiciye sahip ve mükerrer erişim alan fiziksel base tablolar.
- **İnteraktif Bağımlılık Haritası**: Seçilen view için upstream/downstream ve base table bağlantılarını görselleştiren SVG & DOM grafiği.
- **Lazy SQL Yükleme**: 600 view tanımını tek seferde taşımak yerine ihtiyaç duyuldukça API üzerinden lazy yükleme.

## Ana İlke

AI hiçbir zaman doğrudan `ALTER VIEW`, `CREATE INDEX`, `UPDATE STATISTICS`, `DROP` veya başka bir değişiklik çalıştırmaz.

Akış her zaman:

`SCAN → DIAGNOSE → PROPOSE → DIFF → VALIDATE → BENCHMARK → HUMAN APPROVAL → EXPORT SCRIPT`

olmalıdır.

## Teknik Not: CTE Materialization Yanılgısı

Bir sorguyu `WITH CTE AS (...)` haline getirmek base table'ın yalnız bir kez okunacağını garanti etmez. SQL Server optimizer CTE'yi inline edebilir. Bu nedenle repeated-access optimizasyonu execution plan ve logical IO ile doğrulanmadan “tek tarama” olarak raporlanmamalıdır.

## Klasörler

- `public/` — Vanilla web UI.
- `server/` — Node.js backend, SQL/AI adapters.
- `sql/` — salt-okunur metadata ve runtime query şablonları.
- `docs/` — ürün, mimari, scoring, AI, validation ve güvenlik sözleşmeleri.
- `AGENTS.md` — Antigravity/Coding Agent için çalışma sözleşmesi.

## Durum Etiketleri

- `Health Score 0–100`: statik/teknik sağlık. Yüksek daha iyi.
- `Risk Score 0–100`: impact + runtime + regression + structural risk. Yüksek daha kötü.
- `Evidence Grade`: runtime iddiasının kanıt kalitesi.
  - A: Query Store + plan/runtime data.
  - B: Plan cache/DMV correlation.
  - C: SQL-text/dependency heuristic.
  - D: yalnız statik tahmin.

## İlk Gerçek Üretim Hedefi

Mikro ERP veritabanına read-only kullanıcıyla bağlanıp yaklaşık 600 `AA_%` view'ı birkaç saniye içinde inventory/dependency açısından taramak. Runtime ağır sorgu kesinlikle otomatik çalıştırılmamalıdır.
