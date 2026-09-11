/**
 * SQL Server Refactoring & Performance Studio
 * Plan Comparison Engine (Sprint 3)
 *
 * Pure, deterministic comparison function between Before and After ShowPlan models.
 * Compatible with Node.js and modern browsers.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STUDIO_MODULES = root.STUDIO_MODULES || {};
    root.STUDIO_MODULES.planComparison = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function comparePlans(beforePlan = {}, afterPlan = {}) {
    const beforeCost = beforePlan.totalSubTreeCost || beforePlan.planMetadata?.totalSubTreeCost || 0;
    const afterCost = afterPlan.totalSubTreeCost || afterPlan.planMetadata?.totalSubTreeCost || 0;
    const costDelta = afterCost - beforeCost;
    const costDeltaPercent = beforeCost > 0
      ? Math.round(((afterCost - beforeCost) / beforeCost) * 100)
      : 0;

    const beforeOps = beforePlan.operators || [];
    const afterOps = afterPlan.operators || [];

    const beforeOpCount = beforePlan.operatorCount != null ? beforePlan.operatorCount : beforeOps.length;
    const afterOpCount = afterPlan.operatorCount != null ? afterPlan.operatorCount : afterOps.length;

    const beforeScans = beforePlan.scans != null ? beforePlan.scans : beforeOps.filter(o => o.isScan).length;
    const afterScans = afterPlan.scans != null ? afterPlan.scans : afterOps.filter(o => o.isScan).length;

    const beforeSeeks = beforePlan.seeks != null ? beforePlan.seeks : beforeOps.filter(o => o.isSeek).length;
    const afterSeeks = afterPlan.seeks != null ? afterPlan.seeks : afterOps.filter(o => o.isSeek).length;

    const beforeLookups = beforePlan.lookups != null ? beforePlan.lookups : beforeOps.filter(o => o.isLookup).length;
    const afterLookups = afterPlan.lookups != null ? afterPlan.lookups : afterOps.filter(o => o.isLookup).length;

    const beforeSpools = beforePlan.spools != null ? beforePlan.spools : beforeOps.filter(o => o.category === 'SPOOL').length;
    const afterSpools = afterPlan.spools != null ? afterPlan.spools : afterOps.filter(o => o.category === 'SPOOL').length;

    const beforeSorts = beforePlan.sorts != null ? beforePlan.sorts : beforeOps.filter(o => o.category === 'SORT').length;
    const afterSorts = afterPlan.sorts != null ? afterPlan.sorts : afterOps.filter(o => o.category === 'SORT').length;

    const beforeWarns = beforePlan.warnings || [];
    const afterWarns = afterPlan.warnings || [];

    const beforeCards = beforePlan.cardinalityMismatches || [];
    const afterCards = afterPlan.cardinalityMismatches || [];

    const beforeMem = beforePlan.memoryGrant?.grantedMemoryKb || 0;
    const afterMem = afterPlan.memoryGrant?.grantedMemoryKb || 0;

    const deltas = {
      estimatedCostPercent: costDeltaPercent,
      costDelta: parseFloat(costDelta.toFixed(4)),
      operatorCount: afterOpCount - beforeOpCount,
      scans: afterScans - beforeScans,
      seeks: afterSeeks - beforeSeeks,
      lookups: afterLookups - beforeLookups,
      spools: afterSpools - beforeSpools,
      sorts: afterSorts - beforeSorts,
      warnings: afterWarns.length - beforeWarns.length,
      cardinalityIssues: afterCards.length - beforeCards.length,
      memoryGrantKb: afterMem - beforeMem
    };

    const changes = [];

    // Scans & Seeks transitions
    if (beforeScans > 0 && afterScans === 0) {
      changes.push({
        code: 'TABLE_SCAN_REMOVED',
        significance: 'POSITIVE',
        title: 'Tüm Tablo Taramaları Kaldırıldı',
        detail: `${beforeScans} adet Index/Table Scan operasyonu kaldırılarak doğrudan Index Seek'e dönüştürüldü.`
      });
    } else if (afterScans < beforeScans) {
      changes.push({
        code: 'TABLE_SCAN_REDUCED',
        significance: 'POSITIVE',
        title: 'Tarama Operatörleri Azaldı',
        detail: `Tarama sayısı ${beforeScans}'den ${afterScans}'e düşürüldü.`
      });
    } else if (afterScans > beforeScans) {
      changes.push({
        code: 'TABLE_SCAN_ADDED',
        significance: 'NEGATIVE',
        title: 'Yeni Tablo Taraması Eklendi',
        detail: `Plan içine fazladan ${afterScans - beforeScans} adet tarama (Scan) operatörü eklendi.`
      });
    }

    if (afterSeeks > beforeSeeks) {
      changes.push({
        code: 'INDEX_SEEK_ADDED',
        significance: 'POSITIVE',
        title: 'İndeks Seek Eklendi',
        detail: `Optimizatör ${afterSeeks - beforeSeeks} adet yeni Index Seek operasyonu kullanıyor.`
      });
    } else if (afterSeeks < beforeSeeks) {
      changes.push({
        code: 'INDEX_SEEK_REDUCED',
        significance: 'NEGATIVE',
        title: 'İndeks Seek Azaldı',
        detail: `Önceki plandaki Index Seek operatörü kaldırıldı veya taramaya dönüştü.`
      });
    }

    // Lookups
    if (afterLookups > beforeLookups) {
      changes.push({
        code: 'KEY_LOOKUP_ADDED',
        significance: 'NEGATIVE',
        title: 'Key/RID Lookup Operatörü Eklendi',
        detail: `Yeni planda ${afterLookups - beforeLookups} adet Key Lookup tespit edildi. Eksik covering index nedeniyle her satır için ek I/O maliyeti oluşacaktır.`
      });
    } else if (beforeLookups > 0 && afterLookups === 0) {
      changes.push({
        code: 'KEY_LOOKUP_REMOVED',
        significance: 'POSITIVE',
        title: 'Key Lookup Operatörü Ortadan Kalktı',
        detail: `Önceki plandaki ${beforeLookups} adet Key Lookup başarıyla bertaraf edildi.`
      });
    }

    // Sorts
    if (beforeSorts > 0 && afterSorts === 0) {
      changes.push({
        code: 'SORT_REMOVED',
        significance: 'POSITIVE',
        title: 'Maliyetli Sort Operatörü Kaldırıldı',
        detail: 'Sıralama operasyonu indeks sırasından yararlanılarak veya küme bazlı yeniden yazılarak kaldırıldı.'
      });
    } else if (afterSorts > beforeSorts) {
      changes.push({
        code: 'SORT_ADDED',
        significance: 'NEGATIVE',
        title: 'Yeni Sort Operatörü Eklendi',
        detail: 'Planda ek bellek tüketen ve TempDB riski taşıyan Sort operatörü oluştu.'
      });
    }

    // Spools
    if (afterSpools > beforeSpools) {
      changes.push({
        code: 'SPOOL_ADDED',
        significance: 'REVIEW',
        title: 'Table/Index Spool Eklendi',
        detail: 'Optimizatör ara sonuçları saklamak için Spool oluşturdu; büyük veri kümelerinde TempDB baskısı oluşturabilir.'
      });
    } else if (beforeSpools > 0 && afterSpools === 0) {
      changes.push({
        code: 'SPOOL_REMOVED',
        significance: 'POSITIVE',
        title: 'Spool Operatörü Kaldırıldı',
        detail: 'Ara tablo saklama (Spool) operasyonu giderildi.'
      });
    }

    // TempDB Spills
    const beforeHasSpill = beforeWarns.some(w => w.code === 'SPILL_TEMPDB');
    const afterHasSpill = afterWarns.some(w => w.code === 'SPILL_TEMPDB');
    if (beforeHasSpill && !afterHasSpill) {
      changes.push({
        code: 'TEMPDB_SPILL_REMOVED',
        significance: 'POSITIVE',
        title: 'TempDB Spill Riski Giderildi',
        detail: 'Önceki plandaki hafızadan diske taşma (TempDB Spill) problemi çözüldü.'
      });
    } else if (!beforeHasSpill && afterHasSpill) {
      changes.push({
        code: 'TEMPDB_SPILL_ADDED',
        significance: 'NEGATIVE',
        title: 'Yeni TempDB Spill Uyarısı!',
        detail: 'Aday planda hafıza yetersizliği nedeniyle diske (TempDB) taşma uyarısı oluştu.'
      });
    }

    // Implicit Conversions
    const beforeHasConv = beforeWarns.some(w => w.code === 'IMPLICIT_CONVERSION');
    const afterHasConv = afterWarns.some(w => w.code === 'IMPLICIT_CONVERSION');
    if (beforeHasConv && !afterHasConv) {
      changes.push({
        code: 'IMPLICIT_CONVERSION_REMOVED',
        significance: 'POSITIVE',
        title: 'Örtük Tip Dönüşümü (Implicit Conversion) Çözüldü',
        detail: 'Veri tipi uyuşmazlığı giderildi, indeks seek önündeki engel kalktı.'
      });
    } else if (!beforeHasConv && afterHasConv) {
      changes.push({
        code: 'IMPLICIT_CONVERSION_ADDED',
        significance: 'NEGATIVE',
        title: 'Örtük Tip Dönüşümü Tespit Edildi',
        detail: 'Aday sorguda kolon ile filtre tipi arasında örtük dönüşüm uyarısı oluştu.'
      });
    }

    // Missing Indexes
    const beforeMiCount = (beforePlan.missingIndexes || []).length;
    const afterMiCount = (afterPlan.missingIndexes || []).length;
    if (beforeMiCount > 0 && afterMiCount === 0) {
      changes.push({
        code: 'MISSING_INDEX_RESOLVED',
        significance: 'POSITIVE',
        title: 'Eksik İndeks İhtiyacı Giderildi',
        detail: 'Sorgu optimizasyonu sonrası optimizatörün talep ettiği eksik indeks uyarısı ortadan kalktı.'
      });
    }

    if (changes.length === 0) {
      changes.push({
        code: 'PLAN_UNCHANGED',
        significance: 'NEUTRAL',
        title: 'Plan Yapısı Korundu',
        detail: 'Operatör ağacı ve erişim rotalarında anlamlı bir topolojik sapma saptanmadı.'
      });
    }

    return {
      before: {
        estimatedCost: beforeCost,
        operatorCount: beforeOpCount,
        scans: beforeScans,
        seeks: beforeSeeks,
        lookups: beforeLookups,
        spools: beforeSpools,
        sorts: beforeSorts,
        warningCount: beforeWarns.length,
        cardinalityIssueCount: beforeCards.length,
        memoryGrantKb: beforeMem
      },
      after: {
        estimatedCost: afterCost,
        operatorCount: afterOpCount,
        scans: afterScans,
        seeks: afterSeeks,
        lookups: afterLookups,
        spools: afterSpools,
        sorts: afterSorts,
        warningCount: afterWarns.length,
        cardinalityIssueCount: afterCards.length,
        memoryGrantKb: afterMem
      },
      deltas,
      changes
    };
  }

  return { comparePlans };
}));
