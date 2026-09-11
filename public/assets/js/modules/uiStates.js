/**
 * SQL Server Refactoring & Performance Studio
 * Unified UI States, Terminology & Severity Standards (Sprint 8)
 *
 * Responsibilities:
 * - Common Empty State renderer (Icon, Title, Description, Action)
 * - Common Loading State & Skeleton generator
 * - Common Error State renderer (Human title, message, technical details toggle, retry/settings action)
 * - Standardized Severity and Status badges
 * - Standardized Technical Terminology dictionary & Tooltips
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------
  // 1. Standardized Terminology Dictionary & Definitions
  // ------------------------------------------------------------
  const TERMINOLOGY = {
    CTE: {
      title: 'Common Table Expression (CTE)',
      description: 'Geçici adlandırılmış sonuç kümesi; subquery karmaşasını önler ancak SQL Server tarafından varsayılan olarak materialize edilmez.',
      tr: 'Ortak Tablo İfadesi (CTE)',
      desc: 'SQL Server üzerinde geçici sonuç kümesi.'
    },
    SARGABLE: {
      title: 'SARGable (Search Argument Able)',
      description: 'WHERE veya JOIN koşullarında indeks aramasını engellemeyen (fonksiyon içinde sarılmamış) temiz filtreleme yapısı.',
      tr: 'SARGable (Arama Bağımsız)',
      desc: 'WHERE veya JOIN koşullarında indeks kullanımını engellemeyen temiz filtreleme yapısı.'
    },
    LOGICAL_READS: {
      title: 'Mantıksal Okuma (Logical Reads)',
      description: 'Sorgunun Buffer Pool veya bellekten okuduğu 8 KB boyutundaki sayfa sayısı. Performans ölçümünün temel taşıdır.',
      tr: 'Mantıksal Okuma (Logical Reads)',
      desc: 'Buffer Pool veri önbelleğinden okunan 8 KB sayfa sayısı.'
    },
    QUERY_STORE: {
      title: 'Sorgu Deposu (Query Store)',
      description: 'SQL Server 2016+ üzerinde yürütme planı geçmişini ve çalışma zamanı metriklerini otomatik toplayan kara kutu mekanizması.',
      tr: 'Sorgu Deposu (Query Store)',
      desc: 'Plan geçmişini ve metrikleri saklayan depo.'
    },
    WORKSPACES: {
      title: 'Refactor Çalışma Alanı (Workspaces)',
      description: 'İzole ve güvenli refactoring çalışma alanı; canlı veritabanında mutasyon yapmadan aday SQL geliştirme ve kıyaslama ortamı sağlar.',
      tr: 'Refactor Çalışma Alanı',
      desc: 'İzole ve güvenli analiz alanı.'
    },
    view: {
      tr: 'View (Görünüm)',
      desc: 'SQL Server üzerinde sanal tablo gibi davranan, saklanan sorgu tanımı.'
    },
    executionPlan: {
      tr: 'Yürütme Planı (Execution Plan)',
      desc: 'Sorgu iyileştiricisinin (Query Optimizer) sorguyu en az maliyetle çalıştırmak için oluşturduğu operasyon ağacı.'
    },
    logicalReads: {
      tr: 'Mantıksal Okuma (Logical Reads)',
      desc: 'Sorgunun veri önbelleğinden (Buffer Pool) veya bellekten okuduğu 8 KB boyutundaki sayfa sayısı. Performans ölçümünün temel taşıdır.'
    },
    cpuTime: {
      tr: 'İşlemci Süresi (CPU Time)',
      desc: 'SQL Server iş parçacıklarının (threads) sorguyu işlerken harcadığı toplam işlemci süresi (milisaniye).'
    },
    elapsedTime: {
      tr: 'Geçen Süre (Elapsed Time)',
      desc: 'Sorgunun başlatılmasından istemciye tüm sonuçların aktarılmasına kadar geçen gerçek toplam süre.'
    },
    regression: {
      tr: 'Performans Regresyonu (Regression)',
      desc: 'Daha önce hızlı çalışan bir sorgunun, plan değişikliği veya veri büyümesi nedeniyle önemli ölçüde yavaşlaması.'
    },
    blastRadius: {
      tr: 'Etki Alanı (Blast Radius)',
      desc: 'Bir view üzerinde yapılacak değişikliğin onu doğrudan veya dolaylı kullanan diğer üst view ve nesneler üzerindeki etki derinliği.'
    },
    sargability: {
      tr: 'SARGable (Arama Bağımsız)',
      desc: 'WHERE veya JOIN koşullarında indeks kullanımını engellemeyen (fonksiyon içinde sarılmamış) temiz filtreleme yapısı.'
    },
    cardinality: {
      tr: 'Kardinalite (Cardinality)',
      desc: 'Bir sorgu adımının üretmesi beklenen tahmini satır sayısı ile gerçekte üretilen satır sayısı arasındaki ilişki.'
    },
    memoryGrant: {
      tr: 'Bellek Tahsisi (Memory Grant)',
      desc: 'Sıralama (SORT) veya karma birleştirme (HASH JOIN) operasyonları için SQL Server tarafından ayrılan çalışma belleği.'
    },
    missingIndex: {
      tr: 'Eksik İndeks (Missing Index)',
      desc: 'SQL Server Yürütme Planı veya DMV motorunun sorgu performansını artıracağını öngördüğü indeks önerisi.'
    },
    queryStore: {
      tr: 'Sorgu Deposu (Query Store)',
      desc: 'SQL Server 2016+ üzerinde yürütme planı geçmişini ve çalışma zamanı metriklerini otomatik toplayan kara kutu mekanizması.'
    },
    planCache: {
      tr: 'Plan Önbelleği (Plan Cache)',
      desc: 'Daha önce derlenmiş SQL sorgularının ve yordamların bellekte saklanan anlık yürütme planları.'
    },
    headBlocker: {
      tr: 'Kök Kilitleyici (Head Blocker)',
      desc: 'Kendisi başka hiçbir oturum tarafından kilitlenmediği halde diğer tüm oturumları arkasında kuyrukta bekleten ana oturum.'
    },
    waitType: {
      tr: 'Bekleme Türü (Wait Type)',
      desc: 'Bir SQL Server iş parçacığının kaynak (CPU, Disk I/O, Kilit, Bellek) beklerken kaydettiği bekleme kategorisi (örn. PAGEIOLATCH_SH).'
    },
    benefitScore: {
      tr: 'Fayda Puanı (Benefit Score)',
      desc: 'Eksik indeksin oluşturulması durumunda Query Optimizer tarafından beklenen tahmini toplam performans kazancı oranı.'
    },
    opportunityScore: {
      tr: 'Fırsat Skoru (Opportunity Score)',
      desc: 'Çalışma alanında yapılan refaktör iyileştirmelerinin toplam okuma ve süre tasarruf potansiyeli.'
    }
  };

  // ------------------------------------------------------------
  // 2. Standardized Severity & Status Helpers
  // ------------------------------------------------------------
  const SEVERITY_CONFIG = {
    CRITICAL: {
      label: 'KRİTİK',
      icon: '✕',
      className: 'badge-severity-critical severity-pill critical',
      color: '#ef4444'
    },
    HIGH: {
      label: 'YÜKSEK',
      icon: '▲',
      className: 'badge-severity-high severity-pill high',
      color: '#f97316'
    },
    MEDIUM: {
      label: 'ORTA',
      icon: '●',
      className: 'badge-severity-medium severity-pill medium',
      color: '#eab308'
    },
    LOW: {
      label: 'DÜŞÜK',
      icon: 'ℹ',
      className: 'badge-severity-low severity-pill low',
      color: '#06b6d4'
    },
    INFO: {
      label: 'BİLGİ',
      icon: 'ℹ',
      className: 'badge-severity-info severity-pill info',
      color: '#64748b'
    }
  };

  const STATUS_CONFIG = {
    // Validation statuses
    PASS: { label: 'BAŞARILI', icon: '✓', className: 'badge-status-pass' },
    PASS_WITH_WARNING: { label: 'UYARI', icon: '⚠', className: 'badge-status-warning' },
    FAIL: { label: 'BAŞARISIZ', icon: '✕', className: 'badge-status-fail' },
    INCONCLUSIVE: { label: 'BELİRSİZ', icon: '?', className: 'badge-status-inconclusive' },

    // Lifecycle statuses
    DRAFT: { label: 'TASLAK', icon: '✎', className: 'badge-lifecycle-draft' },
    ANALYZED: { label: 'ANALİZ EDİLDİ', icon: '⚲', className: 'badge-lifecycle-analyzed' },
    CANDIDATE_GENERATED: { label: 'ADAY ÜRETİLDİ', icon: '✦', className: 'badge-lifecycle-candidate' },
    VALIDATED: { label: 'DOĞRULANDI', icon: '✓', className: 'badge-lifecycle-validated' },
    BENCHMARKED: { label: 'PERFORMANS KIYASLANDI', icon: '⏱', className: 'badge-lifecycle-benchmarked' },
    APPROVED: { label: 'ONAYLANDI', icon: '★', className: 'badge-lifecycle-approved' },
    REJECTED: { label: 'REDDEDİLDİ', icon: '✕', className: 'badge-lifecycle-rejected' },
    SCRIPT_GENERATED: { label: 'SCRİPT HAZIR', icon: '📦', className: 'badge-lifecycle-script' }
  };

  function renderSeverityBadge(severity) {
    const key = String(severity || 'INFO').toUpperCase();
    const cfg = SEVERITY_CONFIG[key] || SEVERITY_CONFIG.LOW;
    return `<span class="studio-badge ${cfg.className}" title="${cfg.label}"><span class="badge-icon">${cfg.icon}</span> ${cfg.label}</span>`;
  }

  function renderStatusBadge(status) {
    const key = String(status || '').toUpperCase();
    const cfg = STATUS_CONFIG[key] || { label: status || '—', icon: '●', className: 'badge-status-default' };
    return `<span class="studio-badge ${cfg.className}"><span class="badge-icon">${cfg.icon}</span> ${cfg.label}</span>`;
  }

  // ------------------------------------------------------------
  // 3. Unified Empty State Generator
  // ------------------------------------------------------------
  function renderEmptyState(options = {}) {
    const icon = options.icon || '◫';
    const title = options.title || 'Kayıt Bulunamadı';
    const description = options.description || 'Bu kriterlere uygun herhangi bir veri bulunamadı.';
    const actionText = options.actionText || null;
    const actionId = options.actionId || '';
    const extraHtml = options.extraHtml || '';

    return `
      <div class="studio-empty-state">
        <div class="empty-state-icon" aria-hidden="true">${icon}</div>
        <h3 class="empty-state-title">${escapeHtml(title)}</h3>
        <p class="empty-state-desc">${escapeHtml(description)}</p>
        ${extraHtml}
        ${actionText ? `
          <div class="empty-state-action">
            <button class="button primary" id="${actionId}">${escapeHtml(actionText)}</button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ------------------------------------------------------------
  // 4. Unified Loading State Generator (with skeleton rows)
  // ------------------------------------------------------------
  function renderLoadingState(options = {}) {
    const message = options.text || options.message || 'Veriler yükleniyor...';
    const subtext = options.subtext || (options.text ? '' : 'Lütfen bekleyin');
    const skeletonRows = options.rows !== undefined ? options.rows : (options.skeletonRows || 0);

    let skeletonHtml = '';
    if (skeletonRows > 0) {
      skeletonHtml = `
        <div class="studio-skeleton-container" aria-hidden="true">
          ${Array.from({ length: skeletonRows }, () => `
            <div class="studio-skeleton-row">
              <div class="studio-skeleton-bar" style="width: 100%; height: 14px;"></div>
            </div>
          `).join('')}
        </div>
      `;
    }

    return `
      <div class="studio-loading-state" role="status" aria-live="polite">
        <div class="studio-loading-spinner" aria-hidden="true"></div>
        <div class="loading-state-text">
          <strong>${escapeHtml(message)}</strong>
          ${subtext ? `<small>${escapeHtml(subtext)}</small>` : ''}
        </div>
        ${skeletonHtml}
      </div>
    `;
  }

  // ------------------------------------------------------------
  // 5. Unified Error State Generator
  // ------------------------------------------------------------
  function renderErrorState(options = {}) {
    const title = options.title || 'Bir Hata Oluştu';
    const message = options.message || 'İşlem gerçekleştirilirken beklenmeyen bir hata meydana geldi.';
    const technicalDetail = options.technicalDetails || options.technicalDetail || null;
    const retryActionId = options.retryId || options.retryActionId || null;
    const retryActionText = options.retryText || '↻ Tekrar Dene';
    const settingsActionId = options.settingsActionId || null;

    const detailId = `err_detail_${Math.random().toString(36).substr(2, 6)}`;

    return `
      <div class="studio-error-state" role="alert">
        <div class="error-state-header">
          <span class="error-state-icon" aria-hidden="true">✕</span>
          <div class="error-state-copy">
            <h4 class="error-state-title">${escapeHtml(title)}</h4>
            <p class="error-state-message">${escapeHtml(message)}</p>
          </div>
        </div>
        ${technicalDetail ? `
          <div class="error-technical-box">
            <button class="link-button error-toggle-detail" onclick="document.getElementById('${detailId}').classList.toggle('hidden')">
              ▶ Teknik Detayları Göster / Gizle
            </button>
            <pre class="error-detail-content hidden" id="${detailId}"><code>${escapeHtml(String(technicalDetail))}</code></pre>
          </div>
        ` : ''}
        <div class="error-state-actions">
          ${retryActionId ? `<button class="button primary" id="${retryActionId}">${escapeHtml(retryActionText)}</button>` : ''}
          ${settingsActionId ? `<button class="button ghost" id="${settingsActionId}">⚙ Bağlantı Ayarları</button>` : ''}
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const StudioUiStates = {
    TERMINOLOGY,
    SEVERITY_CONFIG,
    STATUS_CONFIG,
    renderSeverityBadge,
    renderStatusBadge,
    renderEmptyState,
    renderLoadingState,
    renderErrorState,
    escapeHtml
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StudioUiStates;
  } else {
    global.StudioUiStates = StudioUiStates;
  }
})(typeof window !== 'undefined' ? window : globalThis);
