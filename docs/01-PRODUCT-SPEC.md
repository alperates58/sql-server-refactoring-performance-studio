# Product Specification

## Problem

Mikro ERP veritabanında zamanla biriken yaklaşık 600 `AA_%` view, birbirini çağıran katmanlar, aynı base table'a farklı kollardan tekrar erişim, yanlış cardinality tahminleri, stale statistics, plan regression ve duplicate business logic nedeniyle manuel olarak yönetilemez hale gelebilir.

Studio bu karmaşıklığı haritalar, puanlar, runtime kanıtıyla önceliklendirir ve güvenli refactoring candidate'ları üretir.

## Personas

### Planning/ERP Technical Owner
Hangi AA view'ın üretim/planlama ekranlarını yavaşlattığını hızlı bulmak ister.

### SQL/IT Administrator
Server'a ağır yük bindirmeden root-cause görmek, indeks/statistics durumunu incelemek ister.

### Developer
Bir view'ı değiştirmeden blast radius, SQL source, plan findings ve semantic validation sonucunu görmek ister.

## Primary Workflows

### A. First Scan
1. Connection ekranı.
2. SQL Server test.
3. Database capability detection.
4. `AA_` inventory.
5. dependency graph.
6. static findings.
7. runtime evidence availability.
8. dashboard.

### B. Investigate Critical View
1. View inventory'den seç.
2. Health/Risk breakdown.
3. Downstream graph.
4. Upstream blast radius.
5. base table repeated paths.
6. Query Store correlations.
7. Plan X-Ray.
8. root-cause candidates.

### C. AI Refactor
1. Context pack hazırlanır.
2. AI provider'a yalnız gereken metadata/source gönderilir.
3. Candidate + rationale + risks + indexes + validation pack alınır.
4. Side-by-side diff.
5. Candidate `UNVALIDATED` olarak kaydedilir.

### D. Validation
1. Metadata/schema compatibility.
2. static semantic invariants.
3. controlled result equivalence.
4. controlled benchmark.
5. report.
6. user isterse script export.

## Screens

1. Overview
2. View Inventory
3. Dependency Graph
4. Runtime & Regression
5. AI Refactor
6. Validation Lab
7. Table Pressure
8. Duplicate Logic
9. Settings
10. Future: Scan History
11. Future: Compare Snapshots
12. Future: Export Report

## Non Goals — V1

- ERP transaction editing.
- Automatic index creation.
- Automatic statistics update.
- Automatic view deployment.
- Continuous profiler tracing.
- SQL Agent replacement.
- Full APM.

## Success Metrics

- 600 view metadata scan < 10s under normal LAN conditions, excluding runtime enrichment.
- No user view execution during initial scan.
- Every score has explainable findings.
- Every runtime claim has evidence grade.
- AI change cannot reach deploy state without validation/explicit action.
