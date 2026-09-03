# Agent Contract — SQL Server Refactoring & Performance Studio

Bu dosya Antigravity veya başka coding agent'ın projeyi geliştirirken uyması gereken zorunlu kurallardır.

## 1. Ürün Kimliği

Ürün adı her yerde: **SQL Server Refactoring & Performance Studio**.
Kısa UI adı gerektiğinde: **SQL Studio**.

## 2. Teknoloji Kısıtı

- Frontend: Vanilla HTML + modern CSS + vanilla JavaScript.
- Framework ekleme: React/Vue/Angular/Svelte YOK, kullanıcı açıkça istemedikçe.
- Backend: Node.js 20+.
- SQL client: `mssql`.
- Tarayıcıda SQL credential tutulmaz.
- UI localhost üzerinden Node server'dan servis edilir.
- Kullanıcı deneyimi: Windows'ta `Baslat.bat` ile açılabilir.

## 3. Veri Güvenliği

- Default mode READ ONLY.
- İlk sürüm DB schema/data mutate ETMEZ.
- AI hiçbir zaman doğrudan SQL Server'a DDL/DML uygulamaz.
- Şifre/API key localStorage/sessionStorage/IndexedDB içine yazılmaz.
- Backend loglarında password/API key yok.
- Credential persistence istenirse Windows Credential Manager/DPAPI gibi OS secret store kullan.

## 4. Ağır Sorgu Yasağı

Initial scan sırasında:
- `SELECT * FROM huge_table` çalıştırma.
- User view'ları execute etme.
- `COUNT(*)` ile dev view ölçme.
- Actual execution plan üretmek için workload çalıştırma.
- İzin almadan `SET STATISTICS IO/TIME` benchmark başlatma.

Öncelik: sys catalog, Query Store, plan cache, DMVs, metadata.

## 5. Runtime Attribution Dürüstlüğü

View bağımsız executable object değildir. Runtime maliyetini view'a kesin olarak atfetmek çoğu durumda mümkün değildir.
Her runtime finding yanında `evidenceGrade` ve `attributionMethod` sakla.

Kesin olmayan ilişkileri “bu view 4.1B read yaptı” diye sunma. Bunun yerine:
“Bu view tanımını içeren/correlate edilen calling queries son 24 saatte toplam X logical reads üretti (Evidence B).”

## 6. CTE Kuralı

CTE materialize edilmez varsayımıyla tasarla. CTE kullanılması repeated scan'in kalktığı anlamına gelmez. İddia yalnız execution plan/IO benchmark ile doğrulanabilir.

## 7. AI Refactoring Guardrails

AI prompt'u her zaman şunları korumalı:
- output column order
- output names
- SQL data types
- nullability behavior where observable
- row multiplicity
- join/filter semantics
- grouping semantics
- duplicate behavior (`DISTINCT`, `UNION` vs `UNION ALL`)
- date/time boundary behavior
- collation/string comparison semantics

AI candidate state: `UNVALIDATED`.
Validation geçerse: `SEMANTICALLY_VALIDATED`.
Benchmark geçerse: `BENCHMARKED`.
Hiçbiri otomatik `DEPLOYED` olmaz.

## 8. Scoring

Health ve Risk ayrı tutulmalı. Health düşük ama kullanılmayan view önceliksiz olabilir. Runtime usage ve blast radius Risk'e dahil edilmeli.
Scoring ağırlıkları settings üzerinden ileride ayarlanabilir olmalı.

## 9. Dependency Graph

Her edge için source, target, object type, resolution status, ambiguity ve discovery source sakla.
Hem downstream (bu view ne kullanıyor?) hem upstream (bunu kim kullanıyor?) graph desteklenmeli.
Circular dependency/unresolved dependency ayrı finding olmalı.

## 10. SQL Parser Stratejisi

Regex yalnız V1 heuristic olabilir. Final analiz için ScriptDom veya sağlam T-SQL parser/AST servisi tercih edilmeli. Parser eklemek backend'de ayrı adapter olarak yapılmalı; UI framework değiştirilmemeli.

## 11. Premium UI

- Dark-first, SQL tooling aesthetic.
- Generic Bootstrap/admin panel görünümü YOK.
- Renk semantiği sabit: red=critical, orange=high, yellow=warning, green=healthy/pass, purple=brand/AI/selected.
- Yoğun veri gösterilebilir ama hierarchy korunmalı.
- Monaco editor eklenirse yalnız SQL/diff yüzeylerinde kullan.
- Dependency graph için Vis Network veya Cytoscape değerlendirilebilir; UI'nin mevcut görsel dilini bozma.

## 12. İş Sırası

1. Read-only connection.
2. Inventory/dependency scanner.
3. Structural analyzer.
4. Reverse dependencies/blast radius.
5. Table pressure.
6. Query Store / plan cache evidence.
7. Plan XML analysis.
8. Duplicate SQL fingerprinting.
9. AI context pack + refactor candidate.
10. Validation Lab.
11. Export scripts.
12. Optional controlled deployment only after explicit future decision.
