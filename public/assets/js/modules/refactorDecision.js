/**
 * SQL Server Refactoring & Performance Studio
 * Refactor Decision & Confidence Engine (Sprint 3)
 *
 * Deterministic decision matrix and confidence scoring for refactored SQL candidates.
 * Compatible with Node.js and modern browsers.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STUDIO_MODULES = root.STUDIO_MODULES || {};
    root.STUDIO_MODULES.refactorDecision = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DECISIONS = {
    MEASURED_IMPROVEMENT: {
      code: 'MEASURED_IMPROVEMENT',
      label: 'Ölçülen İyileştirme',
      badgeClass: 'badge-success',
      color: '#10b981',
      description: 'Semantik doğrulama başarılı, kaynak tüketimi azaldı ve planda iyileşme doğrulandı.'
    },
    SAFE_IMPROVEMENT: {
      code: 'SAFE_IMPROVEMENT',
      label: 'Güvenli İyileştirme',
      badgeClass: 'badge-success',
      color: '#10b981',
      description: 'Semantik doğrulama başarılı, kaynak tüketimi azaldı ve planda risk tespit edilmedi.'
    },
    SQL_REWRITE_VALID_BUT_INDEX_REQUIRED: {
      code: 'SQL_REWRITE_VALID_BUT_INDEX_REQUIRED',
      label: 'SQL Yapısı Doğrulandı (İndeks Bekleniyor)',
      badgeClass: 'badge-info',
      color: '#8b5cf6',
      description: 'Sorgu yapısı ve SARGability semantik olarak iyileştirildi; fiziksel I/O kazancı için önerilen indeks gereklidir.'
    },
    POTENTIAL_IMPROVEMENT: {
      code: 'POTENTIAL_IMPROVEMENT',
      label: 'Potansiyel İyileştirme',
      badgeClass: 'badge-info',
      color: '#3b82f6',
      description: 'Planda veya metriklerde olumlu sinyaller var, ancak bazı uyarılar veya eksik testler mevcut.'
    },
    NEEDS_INDEX_CHANGE: {
      code: 'NEEDS_INDEX_CHANGE',
      label: 'İndeks Değişikliği Gerekli',
      badgeClass: 'badge-warning',
      color: '#f59e0b',
      description: 'Sorgu biçimi zaten temiz; ana darboğaz tablodaki eksik indekstir.'
    },
    NO_MEANINGFUL_CHANGE: {
      code: 'NO_MEANINGFUL_CHANGE',
      label: 'Belirgin Değişim Yok',
      badgeClass: 'badge-neutral',
      color: '#64748b',
      description: 'Sorgu çıktısı korunmuş ancak performans ve plan yapısında anlamlı bir fark oluşmamış.'
    },
    REGRESSION: {
      code: 'REGRESSION',
      label: 'Performans Regresyonu',
      badgeClass: 'badge-warning',
      color: '#f59e0b',
      description: 'Aday sorgu orijinalden daha yavaş çalışıyor, daha fazla I/O yapıyor veya planda riskler arttı.'
    },
    UNSAFE: {
      code: 'UNSAFE',
      label: 'Güvensiz Aday',
      badgeClass: 'badge-danger',
      color: '#ef4444',
      description: 'Semantik doğrulama başarısız oldu veya satır/şema uyumsuzluğu tespit edildi. Asla uygulanmamalıdır!'
    }
  };

  /**
   * Evaluates overall refactoring decision based on validation, benchmark and plan comparison.
   */
  function evaluateRefactorDecision({ validation = {}, benchmark = {}, planComparison = {} } = {}) {
    const reasons = [];
    const valStatus = (validation.status || '').toUpperCase();

    // 1. STRICT SAFETY GUARDRAIL: Semantic validation or row count mismatch
    if (valStatus === 'FAIL') {
      reasons.push('Semantik doğrulama başarısız oldu: ' + (validation.reason || validation.message || 'Sorgu sonuç veya şema uyumsuzluğu.'));
      return {
        decision: DECISIONS.UNSAFE.code,
        metadata: DECISIONS.UNSAFE,
        reasons,
        isDeployable: false
      };
    }

    if (benchmark.isRowCountEqual === false || validation.rowCountsMatch === false) {
      reasons.push('Çalışma zamanında üretilen satır sayıları uyuşmuyor.');
      return {
        decision: DECISIONS.UNSAFE.code,
        metadata: DECISIONS.UNSAFE,
        reasons,
        isDeployable: false
      };
    }

    // 2. REGRESSION CHECK
    const durationImpr = benchmark.improvements?.durationPercent ?? 0;
    const readsImpr = benchmark.improvements?.readsPercent ?? 0;
    const isPlanSpillAdded = (planComparison.changes || []).some(c => c.code === 'TEMPDB_SPILL_ADDED');

    if (benchmark.winner === 'ORIGINAL' || durationImpr <= -15 || readsImpr <= -20) {
      reasons.push(`Aday sorgu belirgin biçimde daha fazla kaynak tüketti (Süre %${Math.abs(durationImpr)}, Reads %${Math.abs(readsImpr)} arttı).`);
      return {
        decision: DECISIONS.REGRESSION.code,
        metadata: DECISIONS.REGRESSION,
        reasons,
        isDeployable: false
      };
    }

    if (isPlanSpillAdded) {
      reasons.push('Aday sorgu planında TempDB Spill oluştu (Hafıza yetersizliği / disk dökülmesi).');
      return {
        decision: DECISIONS.REGRESSION.code,
        metadata: DECISIONS.REGRESSION,
        reasons,
        isDeployable: false
      };
    }

    // 3. SAFE IMPROVEMENT CHECK
    const isValPass = valStatus === 'PASS';
    const hasBenchmarkImprovement = (durationImpr >= 10 || readsImpr >= 15);
    const hasPlanImprovement = (planComparison.changes || []).some(c => c.significance === 'POSITIVE');
    const hasNegativePlanChange = (planComparison.changes || []).some(c => c.significance === 'NEGATIVE');

    if (isValPass && hasBenchmarkImprovement && !hasNegativePlanChange) {
      reasons.push(`Benchmark testinde anlamlı iyileşme doğrulandı (Süre: %${durationImpr}, Reads: %${readsImpr}).`);
      if (hasPlanImprovement) {
        reasons.push('Execution plan yapısında iyileştirici operatör dönüşümleri tespit edildi.');
      }
      return {
        decision: DECISIONS.SAFE_IMPROVEMENT.code,
        metadata: DECISIONS.SAFE_IMPROVEMENT,
        reasons,
        isDeployable: true
      };
    }

    // 4. POTENTIAL IMPROVEMENT CHECK
    if ((isValPass || valStatus === 'WARNING') && (hasPlanImprovement || durationImpr >= 5 || readsImpr >= 10)) {
      if (valStatus === 'WARNING') {
        reasons.push('Semantik doğrulamada dikkat edilmesi gereken uyarılar mevcut.');
      }
      if (hasPlanImprovement) {
        reasons.push('Execution planında iyileştirici adımlar var (tarama azalması / seek artışı).');
      }
      if (durationImpr >= 5 || readsImpr >= 10) {
        reasons.push(`Ölçümlerde pozitif eğilim var (Süre %${durationImpr}, Reads %${readsImpr}).`);
      }
      return {
        decision: DECISIONS.POTENTIAL_IMPROVEMENT.code,
        metadata: DECISIONS.POTENTIAL_IMPROVEMENT,
        reasons,
        isDeployable: false // Requires user review
      };
    }

    // 5. NO MEANINGFUL CHANGE CHECK
    if (isValPass && Math.abs(durationImpr) < 10 && Math.abs(readsImpr) < 15 && !hasNegativePlanChange) {
      reasons.push('Semantik olarak eşdeğer ancak ölçülebilir bir performans veya plan farkı oluşmadı.');
      return {
        decision: DECISIONS.NO_MEANINGFUL_CHANGE.code,
        metadata: DECISIONS.NO_MEANINGFUL_CHANGE,
        reasons,
        isDeployable: false
      };
    }

    // 6. DEFAULT / INCONCLUSIVE
    reasons.push('Yeterli doğrulama veya benchmark kanıtı toplanamadı; manuel inceleme önerilir.');
    return {
      decision: DECISIONS.NO_MEANINGFUL_CHANGE.code,
      metadata: DECISIONS.NO_MEANINGFUL_CHANGE,
      reasons,
      isDeployable: false
    };
  }

  /**
   * Calculates confidence score (0-100) and confidence level (HIGH, MEDIUM, LOW).
   */
  function calculateRefactorConfidence({ validation = {}, benchmark = {}, plan = {} } = {}) {
    let score = 0;
    const factors = [];

    // Factor 1: Validation Depth (max 40 pts)
    const valStatus = (validation.status || '').toUpperCase();
    if (valStatus === 'PASS') {
      const pts = validation.rowCountsMatch !== false ? 40 : 25;
      score += pts;
      factors.push({ name: 'Semantik Doğrulama', score: pts, max: 40, note: 'Sorgu çıktısı ve şeması tam olarak eşleşti.' });
    } else if (valStatus === 'WARNING') {
      score += 20;
      factors.push({ name: 'Semantik Doğrulama', score: 20, max: 40, note: 'Küçük uyarılarla geçti, manuel kontrol önerilir.' });
    } else {
      factors.push({ name: 'Semantik Doğrulama', score: 0, max: 40, note: 'Doğrulama başarısız veya çalıştırılamadı.' });
    }

    // Factor 2: Benchmark Runs & Evidence (max 35 pts)
    const runsCount = benchmark.runsCount || (benchmark.runs || []).length || (benchmark.candidate?.runsCount || 0);
    if (runsCount >= 3) {
      score += 35;
      factors.push({ name: 'Performans Benchmark', score: 35, max: 35, note: `${runsCount} yinelemeli STATISTICS IO/TIME ölçümü yapıldı.` });
    } else if (runsCount >= 1) {
      score += 20;
      factors.push({ name: 'Performans Benchmark', score: 20, max: 35, note: 'Tek yinelemeli temel ölçüm yapıldı.' });
    } else {
      factors.push({ name: 'Performans Benchmark', score: 0, max: 35, note: 'Benchmark ölçümü yapılmadı.' });
    }

    // Factor 3: Execution Plan Depth (max 25 pts)
    const hasBeforePlan = !!(plan.beforePlan || plan.beforePlanXml || plan.originalPlan);
    const hasAfterPlan = !!(plan.afterPlan || plan.afterPlanXml || plan.candidatePlan);

    if (hasBeforePlan && hasAfterPlan) {
      score += 25;
      factors.push({ name: 'Execution Plan X-Ray', score: 25, max: 25, note: 'Hem orijinal hem aday plan ayrıştırılıp karşılaştırıldı.' });
    } else if (hasBeforePlan || hasAfterPlan) {
      score += 12;
      factors.push({ name: 'Execution Plan X-Ray', score: 12, max: 25, note: 'Yalnızca tek bir plan ayrıştırılabildi.' });
    } else {
      factors.push({ name: 'Execution Plan X-Ray', score: 0, max: 25, note: 'Execution plan verisi bulunamadı.' });
    }

    // Clamp score 0 - 100
    score = Math.min(100, Math.max(0, score));

    let level = 'LOW';
    let levelLabel = 'Düşük Güvenilirlik';
    if (score >= 80) {
      level = 'HIGH';
      levelLabel = 'Yüksek Güvenilirlik';
    } else if (score >= 50) {
      level = 'MEDIUM';
      levelLabel = 'Orta Güvenilirlik';
    }

    return {
      score,
      level,
      levelLabel,
      factors
    };
  }

  return {
    DECISIONS,
    evaluateRefactorDecision,
    calculateRefactorConfidence
  };
}));
