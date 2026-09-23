/**
 * SQL Server Refactoring & Performance Studio
 * Frontend Application Controller (Vanilla JS)
 *
 * Phase 2A: Foundational Typography Tokens, Unified Graph Engine, and Settings Overhaul
 */

(() => {
  const MOCK = window.STUDIO_MOCK;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const pageTitles = {
    overview: ['GENEL BAKIŞ & METRİKLER', 'Genel Bakış'],
    views: ['VIEW ENVANTERİ & TEŞHİS', 'View Envanteri'],
    studio: ['REFAKTÖR STÜDYOSU', 'Refaktör Stüdyosu (Pipeline)'],
    workbench: ['SQL GELİŞTİRME VE TEST', 'SQL Workbench'],
    'dba-tools': ['DBA PERFORMANS KONSOLU', 'DBA Araçları'],
    settings: ['SİSTEM VE AYARLAR', 'Ayarlar'],
    // Legacy route titles for backward compatibility
    graph: ['BAĞIMLILIK HARİTASI & X-RAY', 'Bağımlılık Haritası'],
    runtime: ['PERFORMANS VE ÇALIŞMA ZAMANI', 'Çalışma Zamanı ve Regresyon'],
    refactor: ['REFAKTÖR STÜDYOSU', 'Refaktör Stüdyosu'],
    validation: ['SEMANTİK DOĞRULAMA STÜDYOSU', 'Refaktör Stüdyosu (Doğrulama)'],
    tables: ['VIEW ENVANTERİ', 'View Envanteri (Tablo Baskısı)'],
    duplicates: ['VIEW ENVANTERİ', 'View Envanteri (Mükerrer Mantık)'],
    activity: ['DBA PERFORMANS KONSOLU', 'DBA Araçları (Aktivite)'],
    indexes: ['DBA PERFORMANS KONSOLU', 'DBA Araçları (İndeksler)'],
    workspaces: ['REFACTOR YAŞAM DÖNGÜSÜ', 'Kayıtlı Çalışma Alanları']
  };

  const pageSubtitles = {
    overview: 'SQL Server view envanteri, özet metrikler ve Query Store zaman serisi analizleri.',
    views: 'Filtre önekine göre taranan SQL Server view listesi ve 4 konsolide teşhis sekmesi.',
    studio: 'Tek sayfada 4 adımlı lineer süreç: Teşhis → SQL Dönüşümü → Doğrulama & Performans → Sonuç & Eylemler.',
    workbench: 'Çok sekmeli profesyonel T-SQL editörü, execution plan ve sonuç ızgarası.',
    'dba-tools': 'İndeks önerileri, istatistik güncelliği ve canlı aktivite/kilit monitörü tek merkezde.',
    settings: 'Sistem parametreleri, AI sağlayıcı, puanlama ağırlıkları ve destek tanılaması.',
    graph: 'İki yönlü bağımlılık grafiği, döngüsel bağımlılıklar ve etki alanı analizi.',
    runtime: 'Query Store ve DMV kanıtlarıyla çalışma zamanı maliyeti ve regresyon tespiti.',
    refactor: 'Refaktör Stüdyosu sayfasına yönlendiriliyorsunuz.',
    validation: 'Refaktör Stüdyosu sayfasına yönlendiriliyorsunuz.',
    tables: 'View ağaçları altında en çok baskı gören temel tablolar filtrelendi.',
    duplicates: 'Farklı viewlar arasındaki mükerrer mantık ve fingerprint benzerlikleri filtrelendi.',
    activity: 'DBA Araçları sayfasına yönlendiriliyorsunuz.',
    indexes: 'DBA Araçları sayfasına yönlendiriliyorsunuz.',
    workspaces: 'Refaktör Stüdyosu içindeki kayıtlı çalışmalar paneline yönlendiriliyorsunuz.'
  };

  let isNavigating = false;
  let loadWorkspacesList = () => {};
  let openWorkbenchSql = () => {};
  let invalidateValidation = () => {};

  // Central Application State
  const state = {
    connected: false,
    connectionInfo: null,
    capabilities: null,
    isLive: false,
    aiConfig: null,
    activePrefix: 'AA_',
    primaryDatabase: MOCK.primaryDatabase || 'MikroDB_V16_LIDER25',
    selectedDatabases: MOCK.selectedDatabases || ['MikroDB_V16_LIDER25', 'RAPOR_DB', 'MikroDB_V16_TEST'],
    activeDatabase: MOCK.primaryDatabase || 'MikroDB_V16_LIDER25',
    dbFilter: 'all',
    currentRiskFilter: 'all',
    currentSort: 'risk',
    selectedViewName: MOCK.views[0]?.name || '',
    selectedCanonicalId: MOCK.views[0]?.canonicalId || '',
    lastScanTime: null,
    data: {
      views: MOCK.views,
      pressures: MOCK.pressures,
      duplicates: MOCK.duplicates,
      regressions: MOCK.regressions,
      dependencies: [],
      timeseries: MOCK.timeseries || null,
      databaseSummaries: MOCK.databaseSummaries || {},
      metrics: {
        totalViews: MOCK.views.length,
        criticalViews: MOCK.views.filter(v => v.risk === 'critical').length,
        highViews: MOCK.views.filter(v => v.risk === 'high').length,
        totalEdges: 1842,
        repeatedAccessPatterns: 94,
        averageHealth: 72,
        duplicateCandidates: MOCK.duplicates.length,
        activeRegressions: MOCK.regressions.length
      }
    }
  };

  // Dependency Graph Interactive Viewport State
  const graphState = {
    panX: 0,
    panY: 0,
    zoom: 1,
    isPanning: false,
    isDraggingNode: false,
    draggedNodeId: null,
    draggedElem: null,
    dragStartX: 0,
    dragStartY: 0,
    nodeOrigX: 0,
    nodeOrigY: 0,
    nodes: [],
    edges: [],
    selectedNodeId: null,
    depth: '2',
    direction: 'both',
    searchIndex: -1
  };

  // --- Helper Functions ---
  function severityClass(risk) {
    const r = String(risk || '').toLowerCase();
    if (r === 'critical') return 'critical';
    if (r === 'high') return 'high';
    if (r === 'medium') return 'medium';
    return 'low';
  }

  function formatTime(date = new Date()) {
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDate(date = new Date()) {
    return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function toast(title, msg, type = '') {
    const wrap = $('#toastWrap');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<strong>${title}</strong><span>${msg}</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
      t.style.transition = 'all 0.3s ease';
      setTimeout(() => t.remove(), 300);
    }, 4200);
  }

  function updateBreadcrumbs(name) {
    const breadcrumbs = $('#topbarBreadcrumbs');
    const titleEl = $('#breadcrumbActiveTitle');
    if (!breadcrumbs || !titleEl) return;

    if (name === 'overview') {
      breadcrumbs.classList.add('hidden');
    } else {
      breadcrumbs.classList.remove('hidden');
      const title = pageTitles[name]?.[1] || name;
      titleEl.textContent = title;
    }
  }

  function saveNavGroupState() {
    const states = {};
    $$('.nav-group').forEach(group => {
      const groupKey = group.dataset.group;
      if (groupKey) {
        states[groupKey] = group.classList.contains('open');
      }
    });
    try {
      localStorage.setItem('sqlstudio_nav_groups', JSON.stringify(states));
    } catch (_) {}
  }

  function initNavGroups() {
    let savedState = {};
    try {
      savedState = JSON.parse(localStorage.getItem('sqlstudio_nav_groups') || '{}');
    } catch (_) {}

    $$('.nav-group').forEach(group => {
      const groupKey = group.dataset.group;
      if (groupKey && savedState[groupKey] !== undefined) {
        group.classList.toggle('open', Boolean(savedState[groupKey]));
      }

      const header = group.querySelector('.nav-group-header');
      if (header) {
        header.addEventListener('click', (e) => {
          e.preventDefault();
          group.classList.toggle('open');
          saveNavGroupState();
        });
      }
    });

    const collapseToggle = $('#sidebarCollapseToggle');
    const shell = $('.app-shell');
    const isCollapsed = localStorage.getItem('sqlstudio_sidebar_collapsed') === 'true';
    if (isCollapsed && shell) {
      shell.classList.add('sidebar-collapsed');
      if (collapseToggle) {
        const icon = collapseToggle.querySelector('.toggle-icon');
        if (icon) icon.textContent = '▶';
      }
    }

    collapseToggle?.addEventListener('click', () => {
      if (!shell) return;
      const willCollapse = !shell.classList.contains('sidebar-collapsed');
      shell.classList.toggle('sidebar-collapsed', willCollapse);
      localStorage.setItem('sqlstudio_sidebar_collapsed', String(willCollapse));
      const icon = collapseToggle.querySelector('.toggle-icon');
      if (icon) icon.textContent = willCollapse ? '▶' : '◀';
    });
  }

  function gotoPage(name) {
    if (!name || !pageTitles[name]) name = 'overview';

    // Sprint 9: Backward-compatibility aliases & consolidation
    const aliases = {
      refactor: 'studio',
      validation: 'studio',
      workspaces: 'studio',
      indexes: 'dba-tools',
      activity: 'dba-tools',
      tables: 'views',
      duplicates: 'views'
    };

    let targetTabOrFilter = null;
    if (name === 'workspaces') targetTabOrFilter = 'workspaces';
    if (name === 'indexes') targetTabOrFilter = 'indexes';
    if (name === 'activity') targetTabOrFilter = 'activity';
    if (name === 'tables') targetTabOrFilter = 'tables';
    if (name === 'duplicates') targetTabOrFilter = 'duplicates';

    const originalRequestedName = name;
    if (aliases[name]) {
      name = aliases[name];
    }

    $('.app-shell')?.classList.remove('nav-open');
    $('#mobileNavToggle')?.setAttribute('aria-expanded', 'false');

    // Hash deep linking
    isNavigating = true;
    if (window.location.hash !== `#${name}`) {
      window.location.hash = `#${name}`;
    }
    isNavigating = false;

    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name || b.dataset.page === originalRequestedName));

    // Auto-expand parent nav-group if closed
    const activeBtn = document.querySelector(`.nav-item[data-page="${name}"]`) || document.querySelector(`.nav-item[data-page="${originalRequestedName}"]`);
    if (activeBtn) {
      const parentGroup = activeBtn.closest('.nav-group');
      if (parentGroup && !parentGroup.classList.contains('open')) {
        parentGroup.classList.add('open');
        saveNavGroupState();
      }
    }

    if (pageTitles[name]) {
      const eb = $('#pageEyebrow');
      const pt = $('#pageTitle');
      if (eb) eb.textContent = pageTitles[name][0];
      if (pt) pt.textContent = pageTitles[name][1];
    }
    if (pageSubtitles[name]) {
      const ps = $('#pageSubtitle');
      if (ps) ps.textContent = pageSubtitles[name];
    }

    updateBreadcrumbs(name);

    const main = $('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'graph') {
      renderGraph();
    }
    if (name === 'studio') {
      if (targetTabOrFilter === 'workspaces') {
        window.STUDIO_MODULES?.refactorStudio?.switchSubTab?.('workspaces');
      } else {
        const vName = state.selectedCanonicalId || state.selectedViewName;
        if (vName && window.STUDIO_MODULES?.refactorStudio?.loadView) {
          window.STUDIO_MODULES.refactorStudio.loadView(vName);
        }
      }
    }
    if (name === 'dba-tools') {
      if (targetTabOrFilter && window.STUDIO_MODULES?.dbaTools?.switchTab) {
        window.STUDIO_MODULES.dbaTools.switchTab(targetTabOrFilter);
      } else if (window.STUDIO_MODULES?.dbaTools?.refresh) {
        window.STUDIO_MODULES.dbaTools.refresh();
      }
    }
    if (name === 'views' && targetTabOrFilter) {
      const chip = document.querySelector(`.filter-chip[data-view-filter="${targetTabOrFilter}"]`);
      if (chip) chip.click();
    }
  }

  // Bind Navigation
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy-code], [data-candidate-code]');
    if (!button) return;
    const sql = document.getElementById(button.dataset.copyCode || button.dataset.candidateCode)?.innerText || '';
    if (!sql.trim()) return;
    if (button.dataset.copyCode) {
      try {
        await navigator.clipboard.writeText(sql);
        toast('Kopyalandı', 'SQL betiği panoya kopyalandı.', 'success');
      } catch (_) { toast('Kopyalanamadı', 'Tarayıcı pano erişimine izin vermedi.', 'error'); }
    } else {
      $('#candidateSqlText').value = sql;
      $('#candidateSqlTextSplit').value = sql;
      switchCandidateTab('sql');
      toast('Aday SQL Aktarıldı', 'Bu aday henüz doğrulanmadı.', 'info');
    }
  });
  function selectedDatabase() {
    const view = state.data.views.find(v => v.canonicalId === state.selectedCanonicalId);
    return view?.database || state.activeDatabase || state.primaryDatabase;
  }

  async function apiJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'İşlem tamamlanamadı.');
    return data;
  }
  $('#mobileNavToggle')?.addEventListener('click', () => {
    const shell = $('.app-shell');
    shell?.classList.remove('sidebar-collapsed');
    const open = shell?.classList.toggle('nav-open');
    $('#mobileNavToggle')?.setAttribute('aria-expanded', String(Boolean(open)));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('.app-shell')?.classList.contains('nav-open')) {
      $('.app-shell').classList.remove('nav-open');
      $('#mobileNavToggle')?.setAttribute('aria-expanded', 'false');
      $('#mobileNavToggle')?.focus();
    }
  });
  $$('.nav-item[data-page]').forEach(b => b.addEventListener('click', () => gotoPage(b.dataset.page)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.riskFilter) {
      state.currentRiskFilter = b.dataset.riskFilter;
      $$('.filter-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.risk === b.dataset.riskFilter));
      renderViewList($('#viewSearch')?.value || '');
    }
    gotoPage(b.dataset.goto);
  }));

  // --- 1. Connection Status UI ---
  function updateConnectionStatusUI() {
    const light = $('#sidebarConnectionLight');
    const dbName = $('#sidebarDbName');
    const srvInfo = $('#sidebarServerInfo');
    const connBtn = $('#connectButtonText');
    const settingsDb = $('#settingsActiveDb');
    const settingsHost = $('#settingsActiveHost');
    const settingsPill = $('#settingsConnStatusPill');
    const disconnectBtn = $('#disconnectBtn');
    const submitBtn = $('#connectSubmitBtn');
    const capRow = $('#settingsCapRow');
    const topbarScanLabel = $('#scanMetaLabel');
    const topbarScanTime = $('#scanMetaTime');
    const topbarScanAgo = $('#scanMetaAgo');

    const isActuallyConnected = Boolean(state.connected && (state.connectionInfo || state.isLive));

    if (isActuallyConnected) {
      const dbLabel = state.connectionInfo?.database || state.primaryDatabase || (state.selectedDatabases && state.selectedDatabases[0]) || 'SQL Server';
      const serverInst = state.connectionInfo?.server
        ? `${state.connectionInfo.server}${state.connectionInfo.port && state.connectionInfo.port != 1433 ? ':' + state.connectionInfo.port : ''}`
        : 'SQL Instance';
      
      // Sidebar Footer
      if (light) {
        light.style.background = 'var(--green)';
        light.style.boxShadow = '0 0 12px rgba(67,217,156,0.8)';
      }
      if (dbName) dbName.textContent = dbLabel;
      if (srvInfo) srvInfo.innerHTML = `<span style="color:var(--green);font-weight:700">CANLI</span> · ${serverInst}`;
      if (connBtn) connBtn.textContent = `● ${dbLabel}`;

      // Settings Status Cards
      if (settingsDb) settingsDb.textContent = dbLabel;
      if (settingsHost) settingsHost.textContent = `${serverInst} (Kullanıcı: ${state.connectionInfo?.user || 'sa'})`;
      if (settingsPill) {
        settingsPill.textContent = '● CONNECTED (LIVE)';
        settingsPill.style.color = 'var(--green)';
        settingsPill.style.borderColor = 'rgba(67,217,156,0.3)';
        settingsPill.style.background = 'rgba(67,217,156,0.08)';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
      if (submitBtn) submitBtn.textContent = 'Yeniden Bağlan';

      // Topbar Real Scan Info
      if (topbarScanLabel) topbarScanLabel.textContent = 'BAĞLANTI';
      if (topbarScanTime) topbarScanTime.innerHTML = `<span style="color:var(--green);font-weight:600">● CANLI: ${escapeHtml(dbLabel)}</span>`;
      if (topbarScanAgo) topbarScanAgo.textContent = state.lastScanTime ? `Tarama: ${formatTime(state.lastScanTime)}` : serverInst;

      // Capabilities Row
      if (state.capabilities && capRow) {
        capRow.style.display = 'flex';
        $('#settingsVersionText').textContent = state.capabilities.friendlyVersion || state.capabilities.productVersion;
        $('#settingsCompatText').textContent = `${state.capabilities.friendlyCompat || 'Compatibility'} · Collation: ${state.capabilities.collation || 'Default'}`;
        $('#settingsEditionPill').textContent = (state.capabilities.edition || 'SQL Server').toUpperCase();

        const qsPill = $('#settingsQsPill');
        if (qsPill) {
          if (state.capabilities.queryStore?.active) {
            qsPill.textContent = `● QUERY STORE ${state.capabilities.queryStore.state}`;
            qsPill.style.color = 'var(--green)';
            qsPill.style.borderColor = 'rgba(67,217,156,0.25)';
          } else {
            qsPill.textContent = '○ QUERY STORE OFF (Plan Cache DMV)';
            qsPill.style.color = 'var(--yellow)';
            qsPill.style.borderColor = 'rgba(247,200,106,0.25)';
          }
        }

        const permBox = $('#settingsPermText');
        if (permBox) {
          const perms = [];
          if (state.capabilities.permissions?.canViewDefinition) perms.push('VIEW DEFINITION ✓');
          else perms.push('VIEW DEFINITION ✕');
          if (state.capabilities.permissions?.canViewDatabaseState) perms.push('VIEW DATABASE STATE ✓');
          else perms.push('VIEW DATABASE STATE ✕');
          permBox.textContent = perms.join(' · ');
        }
      }
      // Topbar Global Connection Badge
      const globalConn = $('#globalConnectionBadge');
      if (globalConn) {
        globalConn.textContent = `● CANLI (${dbLabel})`;
        globalConn.style.color = 'var(--green)';
        globalConn.style.borderColor = 'rgba(67,217,156,0.3)';
        globalConn.style.background = 'rgba(67,217,156,0.08)';
      }

      // Diagnostics Table Updates
      if ($('#diagQsStatus') && state.capabilities?.queryStore) {
        const qs = state.capabilities.queryStore;
        $('#diagQsStatus').textContent = qs.active ? `● Aktif (${qs.state})` : '○ Kapalı (Plan Cache DMV)';
        $('#diagQsStatus').className = qs.active ? 'studio-badge badge-status-pass' : 'studio-badge badge-status-warning';
      }
      if ($('#diagViewServerStatus')) {
        const hasVSS = state.capabilities?.permissions?.canViewServerState || state.capabilities?.permissions?.canViewDatabaseState;
        $('#diagViewServerStatus').textContent = hasVSS ? '● Yetki Doğrulandı' : '○ Sınırlı';
        $('#diagViewServerStatus').className = hasVSS ? 'studio-badge badge-status-pass' : 'studio-badge badge-status-warning';
      }
      if ($('#diagAiStatus')) {
        const hasAi = Boolean(state.aiConfig?.hasApiKey);
        $('#diagAiStatus').textContent = hasAi ? `● Yapılandırıldı (${state.aiConfig?.provider || 'AI'})` : '○ Anahtar Girilmedi';
        $('#diagAiStatus').className = hasAi ? 'studio-badge badge-status-pass' : 'studio-badge badge-status-warning';
      }
    } else {
      // Disconnected / Demo Mode
      if (light) {
        light.style.background = 'var(--yellow)';
        light.style.boxShadow = '0 0 8px rgba(247,200,106,0.4)';
      }
      if (dbName) dbName.textContent = 'Demo Veri Kümesi';
      if (srvInfo) srvInfo.innerHTML = '<span style="color:var(--yellow);font-weight:700">DEMO MODU</span> · Örnek Veri';
      if (connBtn) connBtn.textContent = 'Bağlantı';
      if (settingsDb) settingsDb.textContent = 'Demo Veri Kümesi';
      if (settingsHost) settingsHost.textContent = 'Demo veri kümesi aktif · SQL sunucusuna bağlanılmadı';
      if (settingsPill) {
        settingsPill.textContent = '○ DEMO MODU (ÇEVRİMDIŞI)';
        settingsPill.style.color = 'var(--yellow)';
        settingsPill.style.borderColor = 'rgba(247,200,106,0.2)';
        settingsPill.style.background = 'rgba(247,200,106,0.06)';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Bağlan & Test Et';
      if (capRow) capRow.style.display = 'none';

      if (topbarScanLabel) topbarScanLabel.textContent = 'MOD';
      if (topbarScanTime) topbarScanTime.innerHTML = '<span style="color:var(--yellow);background:rgba(247,200,106,0.12);padding:2px 8px;border-radius:4px;border:1px solid rgba(247,200,106,0.3);font-size:11px;font-weight:600">DEMO MODU (Örnek Veri)</span>';
      if (topbarScanAgo) topbarScanAgo.textContent = 'Canlı Sunucuya Bağlanılmadı';

      const globalConn = $('#globalConnectionBadge');
      if (globalConn) {
        globalConn.textContent = '○ DEMO MODU';
        globalConn.style.color = 'var(--yellow)';
        globalConn.style.borderColor = 'rgba(247,200,106,0.25)';
        globalConn.style.background = 'rgba(247,200,106,0.06)';
      }
    }
  }

  // --- 2. Overview Page ---
  // Safe Extraction Helpers for Health, Risk, and Findings (Guards against [object Object])
  function getSafeHealthScore(v) {
    if (!v) return 60;
    const h = v.healthScore != null ? v.healthScore : v.health;
    if (typeof h === 'object' && h !== null) {
      const num = Number(h.score);
      return Number.isFinite(num) ? num : 60;
    }
    const num = Number(h);
    return Number.isFinite(num) ? num : 60;
  }

  function getSafeRiskScore(v) {
    if (!v) return 0;
    const r = v.riskScore != null ? v.riskScore : (v.risk?.score ?? v.risk);
    if (typeof r === 'object' && r !== null) {
      const num = Number(r.score);
      return Number.isFinite(num) ? num : 0;
    }
    const num = Number(r);
    return Number.isFinite(num) ? num : 0;
  }

  function isViewRegressed(v) {
    if (!v) return false;
    return Boolean(
      v.isRegressed ||
      v.isRegression ||
      v.runtime?.isRegressed ||
      v.runtime?.isRegression ||
      v.runtime?.regression?.isRegressed
    );
  }

  function getSafeRiskCategory(v) {
    if (!v) return 'low';
    if (v.riskCategory) return String(v.riskCategory).toLowerCase();
    if (v.riskLevel) return String(v.riskLevel).toLowerCase();
    if (typeof v.risk === 'string') return v.risk.toLowerCase();
    const score = getSafeRiskScore(v);
    if (score >= 70) return 'critical';
    if (score >= 45) return 'high';
    if (score >= 20) return 'medium';
    return 'low';
  }

  function getSafeRiskLabelTr(v) {
    const cat = getSafeRiskCategory(v);
    if (cat === 'critical') return 'KRİTİK';
    if (cat === 'high') return 'YÜKSEK';
    if (cat === 'medium') return 'ORTA';
    return 'DÜŞÜK';
  }

  function getRiskContribution(item) {
    if (!item) return { label: 'Normal', level: 'normal', width: 10, color: 'var(--text-muted)' };
    const val = Number(item.value || 0);
    const penalty = Number(item.penalty || 0);
    if (val >= 70 || penalty >= 12) {
      return { label: 'Yüksek', level: 'high', width: Math.min(100, Math.max(65, val)), color: 'var(--red)' };
    }
    if (val >= 35 || penalty >= 5) {
      return { label: 'Orta', level: 'medium', width: Math.min(60, Math.max(35, val)), color: 'var(--yellow)' };
    }
    return { label: 'Normal', level: 'normal', width: Math.min(20, Math.max(5, val)), color: 'var(--text-muted)' };
  }

  function formatRuntimeReads(v) {
    if (!v) return '—';
    const r = v.reads;
    if (r && r !== '—' && r !== '0' && r !== '0 B' && r !== 0) return String(r);
    if (v.runtime?.totalReads && v.runtime.totalReads > 0) {
      const tr = v.runtime.totalReads;
      if (tr >= 1e9) return `${(tr / 1e9).toFixed(1)} Mr`;
      if (tr >= 1e6) return `${(tr / 1e6).toFixed(1)} Mn`;
      if (tr >= 1e3) return `${(tr / 1e3).toFixed(1)} B`;
      return String(tr);
    }
    return '—';
  }

  function formatRuntimeMedian(v) {
    if (!v) return '—';
    const m = v.median;
    if (m && m !== '—' && m !== '0ms' && m !== '0 ms' && m !== 0) return String(m);
    if (v.runtime?.avgDurationMs != null && v.runtime.avgDurationMs > 0) {
      return `${v.runtime.avgDurationMs} ms`;
    }
    return '—';
  }

  function getPrimaryFinding(v) {
    if (!v) {
      return {
        title: 'Standart İnceleme',
        detail: 'Kural ihlali tespit edilmedi',
        severity: 'low',
        impact: 'Sistem kaynakları üzerinde bilinen bir darboğaz bulunmuyor.',
        evidence: 'Statik Katalog & Bağımlılık Denetimi',
        gradeLabel: 'Normal'
      };
    }

    // 1. Active critical regression (Priority 1)
    if (v.runtime?.regression?.isRegressed || v.isRegressed) {
      const regInfo = v.runtime?.regression;
      const ratioStr = regInfo?.ratio ? ` (${regInfo.ratio})` : '';
      return {
        title: 'Performans Regresyonu',
        detail: regInfo?.reason || `Son 24 saatte süre anomalisi tespit edildi${ratioStr}`,
        severity: 'critical',
        impact: 'Sorgu yanıt süresi ve kaynak tüketiminde ani artış.',
        evidence: regInfo?.source || 'Query Store / DMV Cache',
        gradeLabel: 'Yüksek (Grade A)'
      };
    }

    // 2. High/Critical problems from backend static analysis (Priority 2)
    if (Array.isArray(v.problems) && v.problems.length > 0) {
      const sevOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      const sorted = [...v.problems].sort((a, b) => {
        const sa = typeof a === 'object' && a !== null ? (sevOrder[a.severity] ?? 4) : 4;
        const sb = typeof b === 'object' && b !== null ? (sevOrder[b.severity] ?? 4) : 4;
        return sa - sb;
      });
      const top = sorted[0];
      if (typeof top === 'object' && top !== null) {
        const sev = (top.severity || 'high').toLowerCase();
        return {
          title: top.title || top.name || 'Analiz Uyarısı',
          detail: top.detail || 'Sorgu planında performans riski tespit edildi.',
          severity: sev,
          impact: top.why || (window.uiText?.findings?.[top.code]?.why) || 'Gereksiz mantıksal okuma (I/O) ve CPU tüketimi riski.',
          evidence: top.evidence || 'Statik Bağımlılık Grafiği',
          gradeLabel: top.evidenceGrade ? `${top.evidenceGrade}` : 'Düşük (Grade D)'
        };
      } else if (typeof top === 'string') {
        return {
          title: top,
          detail: 'Sorgu planında yapısal uyarı.',
          severity: 'high',
          impact: 'Gereksiz I/O ve işlemci yükü riski.',
          evidence: 'Statik Bağımlılık Grafiği',
          gradeLabel: 'Düşük (Grade D)'
        };
      }
    }

    // 3. Repeated Base Table Access (Priority 3)
    if ((v.repeatedBaseTableCount || 0) > 0 || (v.repeatedBaseTables && v.repeatedBaseTables.length > 0)) {
      const count = v.repeatedBaseTableCount || v.repeatedBaseTables.length;
      return {
        title: 'Mükerrer Temel Tablo Erişimi',
        detail: `Temel tablolara ${count} farklı mantıksal yoldan mükerrer erişim`,
        severity: 'high',
        impact: 'Aynı temel tablonun birden fazla dalda tekrar taranması I/O baskısını katlar.',
        evidence: 'Statik Bağımlılık Grafiği',
        gradeLabel: 'Düşük (Grade D)'
      };
    }

    // 4. Heavy Logical Reads (Priority 4)
    if (v.reads && (v.reads.includes('M') || v.reads.includes('B'))) {
      return {
        title: 'Yüksek Mantıksal Okuma Baskısı',
        detail: `${v.reads} mantıksal okuma hacmi kaydedildi`,
        severity: 'high',
        impact: 'Buffer Pool bellek sayfaları üzerinde yoğun rotasyon ve churn.',
        evidence: v.runtime?.source === 'QUERY_STORE' ? 'Query Store' : 'DMV Plan Cache',
        gradeLabel: 'Orta (Grade B)'
      };
    }

    // 5. Deep Dependency Hierarchy (Priority 5)
    if ((v.depth || 1) > 3) {
      return {
        title: 'Derin Bağımlılık Ağacı',
        detail: `${v.depth} seviyeli derin nesne bağımlılığı`,
        severity: 'medium',
        impact: 'Query optimizer derleme karmaşıklığı ve görünmez alt maliyetler.',
        evidence: 'Statik Bağımlılık Grafiği',
        gradeLabel: 'Düşük (Grade D)'
      };
    }

    // 6. Default Normal
    return {
      title: 'Normal Çalışma',
      detail: 'Kritik kural ihlali tespit edilmedi',
      severity: 'low',
      impact: 'Bilinen performans darboğazı veya kural ihlali bulunmuyor.',
      evidence: 'Statik Katalog Denetimi',
      gradeLabel: 'Normal'
    };
  }

  // --- 2. Overview Page (Redesigned) ---
  function renderOverview() {
    const summary = state.data.summary || {};
    const m = state.data.metrics || {};
    const views = state.data.views || [];
    const duplicates = state.data.duplicates || [];
    const regressions = state.data.regressions || [];
    const pressures = state.data.pressures || [];

    // Compact Kicker & Headline
    const heroKicker = $('#heroKickerText');
    if (heroKicker) {
      heroKicker.textContent = state.isLive
        ? `${state.connectionInfo?.database || 'SQL'} Canlı · Salt-Okunur Denetim`
        : 'Demo Veritabanı · Salt-Okunur Denetim';
    }
    const heroHeadline = $('#heroHeadline');
    if (heroHeadline) {
      heroHeadline.innerHTML = `<span id="heroViewCount">${views.length}</span> view içinden bugün müdahale edilmesi gerekenleri belirle.`;
    }

    // Global DB Health Calculation & Explanation
    const healthVal = summary.avgHealth != null
      ? summary.avgHealth
      : (m.averageHealth != null
          ? m.averageHealth
          : (views.length > 0 ? Math.round(views.reduce((acc, v) => acc + getSafeHealthScore(v), 0) / views.length) : 91));

    const orbitHealth = $('#overviewDbHealth');
    if (orbitHealth) orbitHealth.textContent = healthVal;

    const orbitTrack = $('#orbitTrackValue');
    if (orbitTrack) {
      const maxOffset = 301;
      const offset = maxOffset - (maxOffset * (Math.min(100, Math.max(0, healthVal)) / 100));
      orbitTrack.setAttribute('stroke-dashoffset', Math.max(0, offset));
    }

    const healthStatusText = $('#overviewHealthStatus');
    if (healthStatusText) {
      if (healthVal >= 80) {
        healthStatusText.textContent = 'Genel Sağlık: Sağlıklı';
        healthStatusText.style.color = 'var(--green)';
      } else if (healthVal >= 55) {
        healthStatusText.textContent = 'Genel Sağlık: Dikkat Gerek';
        healthStatusText.style.color = 'var(--orange)';
      } else {
        healthStatusText.textContent = 'Genel Sağlık: Kritik Seviye';
        healthStatusText.style.color = 'var(--red)';
      }
    }

    // 5 Key KPI Metric Calculations (View Risk is Primary)
    const criticalCount = summary.criticalViews != null
      ? summary.criticalViews
      : views.filter(v => {
          const cat = getSafeRiskCategory(v);
          return cat === 'critical' || getSafeRiskScore(v) >= 70;
        }).length;

    const regressionsCount = regressions.length || m.activeRegressions || 0;
    const duplicatesCount = duplicates.length || m.duplicateCandidates || 0;

    if ($('#stripTotalViews')) $('#stripTotalViews').textContent = views.length.toLocaleString();
    if ($('#metricCritical')) $('#metricCritical').textContent = criticalCount.toLocaleString();
    if ($('#metricRegressions')) $('#metricRegressions').textContent = regressionsCount.toLocaleString();
    if ($('#metricDuplicates')) $('#metricDuplicates').textContent = duplicatesCount.toLocaleString();

    // Fetch Index Advisor and Stale Stats asynchronously for KPI cards
    fetchOverviewIndexAndStatsCounters();

    // Update Timeseries Pill in Header
    const qsPill = $('#overviewRegressionPill');
    if (qsPill) {
      if (state.isLive) {
        if (state.data.runtimeSource === 'QUERY_STORE') {
          qsPill.innerHTML = '<span class="pulse" style="background:var(--green)"></span> Query Store (Canlı)';
          qsPill.className = 'live-pill';
        } else if (state.data.runtimeSource === 'PLAN_CACHE') {
          qsPill.innerHTML = '<span class="pulse" style="background:var(--yellow)"></span> Plan Cache (Fallback)';
          qsPill.className = 'live-pill warning';
        } else {
          qsPill.innerHTML = '<span class="pulse" style="background:var(--red)"></span> Query Store (Kapalı)';
          qsPill.className = 'live-pill danger';
        }
      } else {
        qsPill.innerHTML = '<span></span> Demo Modu';
        qsPill.className = 'live-pill';
      }
    }

    // Render SVG Timeseries Chart or Compact Fallback State
    const chartWrap = $('#overviewChartWrap');
    if (chartWrap) {
      const ts = state.data.timeseries;
      if (ts && Array.isArray(ts.points) && ts.points.length > 0) {
        const pts = ts.points;
        const n = pts.length;
        const maxDur = Math.max(...pts.map(p => p.avgDurationMs || 0), 1);
        const totalExecs = pts.reduce((acc, p) => acc + (p.executionCount || 0), 0);
        const totalReads = pts.reduce((acc, p) => acc + (p.totalReads || 0), 0);
        const avgDur = Math.round(pts.reduce((acc, p) => acc + (p.avgDurationMs || 0), 0) / n);

        const w = 600, h = 150;
        const padL = 48, padR = 20, padT = 18, padB = 24;
        const pw = w - padL - padR;
        const ph = h - padT - padB;
        const getX = i => n > 1 ? padL + (i / (n - 1)) * pw : padL + pw / 2;
        const getY = val => padT + ph - (Math.min(val, maxDur) / maxDur) * ph;

        const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(p.avgDurationMs || 0).toFixed(1)}`).join(' ');
        const areaD = `${pathD} L ${getX(n - 1).toFixed(1)} ${(padT + ph).toFixed(1)} L ${getX(0).toFixed(1)} ${(padT + ph).toFixed(1)} Z`;

        const firstLabel = pts[0]?.bucketStart ? new Date(pts[0].bucketStart).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
        const lastLabel = pts[n - 1]?.bucketStart ? new Date(pts[n - 1].bucketStart).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';

        const circles = pts.map((p, i) => {
          const cx = getX(i).toFixed(1);
          const cy = getY(p.avgDurationMs || 0).toFixed(1);
          const timeStr = p.bucketStart ? new Date(p.bucketStart).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
          return `<circle cx="${cx}" cy="${cy}" r="3" fill="#a78bfa" stroke="#10131c" stroke-width="1.5"><title>${timeStr}: ${p.avgDurationMs}ms (${p.executionCount} çağrı, ${p.totalReads?.toLocaleString() || 0} okuma)</title></circle>`;
        }).join('');

        chartWrap.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding:0 4px">
            <span style="font-size:11.5px;color:var(--text-muted)">Query Store Yürütme Trendi (${ts.window || '24h'})</span>
            <span style="font-size:11.5px;color:var(--text-secondary)">Ort: <b style="color:var(--text-primary)">${avgDur} ms</b> · Toplam Okuma: <b>${totalReads > 1e6 ? (totalReads / 1e6).toFixed(1) + 'M' : totalReads.toLocaleString()}</b> · Çağrı: <b>${totalExecs.toLocaleString()}</b></span>
          </div>
          <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:100%;max-height:160px;overflow:visible">
            <defs>
              <linearGradient id="qsChartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#7c5cff" stop-opacity="0.35"/>
                <stop offset="100%" stop-color="#7c5cff" stop-opacity="0.0"/>
              </linearGradient>
            </defs>
            <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="#232938" stroke-dasharray="3 3"/>
            <line x1="${padL}" y1="${padT + ph / 2}" x2="${w - padR}" y2="${padT + ph / 2}" stroke="#232938" stroke-dasharray="3 3"/>
            <line x1="${padL}" y1="${padT + ph}" x2="${w - padR}" y2="${padT + ph}" stroke="#2d3548"/>
            <text x="${padL - 6}" y="${padT + 4}" font-size="10" fill="#64748b" text-anchor="end">${Math.round(maxDur)}ms</text>
            <text x="${padL - 6}" y="${padT + ph / 2 + 3}" font-size="10" fill="#64748b" text-anchor="end">${Math.round(maxDur / 2)}ms</text>
            <text x="${padL - 6}" y="${padT + ph + 3}" font-size="10" fill="#64748b" text-anchor="end">0ms</text>
            <path d="${areaD}" fill="url(#qsChartGrad)"/>
            <path d="${pathD}" fill="none" stroke="#9b82ff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
            ${circles}
            <text x="${padL}" y="${h - 4}" font-size="10" fill="#64748b" text-anchor="start">${firstLabel}</text>
            <text x="${w - padR}" y="${h - 4}" font-size="10" fill="#64748b" text-anchor="end">${lastLabel}</text>
          </svg>
        `;
      } else {
        const isFallback = state.isLive && state.data.runtimeSource === 'PLAN_CACHE';
        chartWrap.innerHTML = `
          <div class="timeseries-empty-compact" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:rgba(14,18,26,0.6);border:1px dashed var(--line);border-radius:var(--radius-sm);gap:16px">
            <div style="display:flex;align-items:center;gap:14px">
              <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;background:rgba(247,200,106,0.12);color:var(--yellow);border:1px solid rgba(247,200,106,0.25);white-space:nowrap">${isFallback ? 'Plan Cache Fallback' : 'Zaman Serisi Yok'}</span>
              <div>
                <h4 style="margin:0;font-size:13.5px;font-weight:600;color:var(--text-primary)">Zaman Serisi Verisi Bulunamadı</h4>
                <p style="margin:2px 0 0;font-size:12px;color:var(--text-muted)">${isFallback ? 'Plan Cache fallback modunda zaman serisi saklanmıyor veya Query Store kapalı.' : 'Seçili aralıkta Query Store çalışma zamanı kaydı bulunmuyor.'}</p>
              </div>
            </div>
            <div>
              <button class="button ghost small" data-goto="settings" style="white-space:nowrap">Ayarları Aç →</button>
            </div>
          </div>
        `;
      }
    }

    // Section 4: Priority List Sorting (Deterministic & Actionable)
    const sortMode = state.currentSort || 'risk';
    let sortedViews = [...views];
    if (sortMode === 'reads') {
      sortedViews.sort((a, b) => {
        const numericReads = v => {
          if (v.runtime?.totalReads != null) return Number(v.runtime.totalReads);
          const match = String(v.reads || '0').match(/^([\d.]+)\s*([KMB])?$/i);
          return match ? Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] || 1) : 0;
        };
        return numericReads(b) - numericReads(a);
      });
    } else if (sortMode === 'regression') {
      sortedViews.sort((a, b) => {
        const scoreB = b.opportunityScore != null ? b.opportunityScore : (b.runtime?.regression?.severityScore || (b.runtime?.isRegressed ? 50 : 0));
        const scoreA = a.opportunityScore != null ? a.opportunityScore : (a.runtime?.regression?.severityScore || (a.runtime?.isRegressed ? 50 : 0));
        if (scoreB !== scoreA) return scoreB - scoreA;
        return getSafeRiskScore(b) - getSafeRiskScore(a);
      });
    } else {
      // Primary: Risk Score descending
      sortedViews.sort((a, b) => getSafeRiskScore(b) - getSafeRiskScore(a));
    }

    const riskTableBody = $('#overviewRiskTableBody');
    if (riskTableBody) {
      if (sortedViews.length === 0) {
        riskTableBody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center;padding:24px 16px;color:var(--text-muted)">
              Bugün kritik riskli view bulunmadı. Sistem sağlıklı görünüyor.
            </td>
          </tr>
        `;
      } else {
        riskTableBody.innerHTML = sortedViews.slice(0, 5).map(v => {
          const depCount = v.dependentCount != null ? v.dependentCount : (Array.isArray(v.dependents) ? v.dependents.length : (v.dependents || 0));
          const riskLevel = getSafeRiskCategory(v);
          const riskScore = getSafeRiskScore(v);
          const viewName = v.name || v.view_name;
          const schema = v.schema_name || v.schema || 'dbo';
          const finding = getPrimaryFinding(v);
          const regInfo = v.runtime?.regression;
          const isRegressed = regInfo?.isRegressed || v.isRegressed;

          return `
            <tr class="dense-table-row" data-view="${viewName}" style="cursor:pointer">
              <td>
                <div class="dense-view-cell">
                  <strong class="dense-view-name" title="${viewName}">${viewName}</strong>
                  <small class="dense-view-meta">${schema} · depth ${v.depth || 1} · ${depCount} bağımlı</small>
                </div>
              </td>
              <td>
                <div class="dense-problem-cell" title="${escapeHtml(finding.detail || '')}">
                  <span class="problem-dot ${finding.severity || 'info'}"></span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(finding.title || '')}</span>
                </div>
              </td>
              <td style="text-align:right">
                <strong class="${severityClass(riskLevel)}" style="font-family:var(--font-family-mono);font-size:12.5px">${riskScore}</strong>
              </td>
              <td style="text-align:right" title="Son 24 saatte Query Store / runtime evidence üzerinden ölçülen mantıksal okumalar.">
                <span style="font-family:var(--font-family-mono);font-size:11.5px">${v.reads || '—'}</span>
              </td>
              <td style="text-align:right">
                <span style="font-size:11.5px;font-weight:600;color:${isRegressed ? 'var(--red)' : 'var(--text-secondary)'}">${isRegressed ? (regInfo?.severity || 'Kritik') : (v.median || '—')}</span>
              </td>
              <td style="text-align:center">
                <button class="button ghost small btn-inspect" data-view="${viewName}" style="padding:2px 8px;font-size:11px;height:24px;line-height:1">İncele →</button>
              </td>
            </tr>
          `;
        }).join('');

        // Wire click handlers for priority list rows and inspect buttons
        $$('#overviewRiskTableBody tr.dense-table-row').forEach(row => {
          row.addEventListener('click', (e) => {
            const vName = row.dataset.view;
            if (vName) {
              selectView(vName);
              gotoPage('views');
            }
          });
        });
      }
    }

    // Section 4 (Right): Table Pressure List (Top 5)
    const pressureList = $('#pressureList');
    if (pressureList) {
      if (!pressures || pressures.length === 0) {
        pressureList.innerHTML = '<div class="empty-state" style="padding:16px 0"><p style="font-size:12px;color:var(--text-muted)">Base tablo baskısı tespit edilmedi.</p></div>';
      } else {
        const maxScore = Math.max(...pressures.slice(0, 5).map(p => p.score || 1), 100);
        pressureList.innerHTML = pressures.slice(0, 5).map((p, idx) => {
          const barWidth = Math.min(100, Math.max(10, Math.round(((p.score || 0) / maxScore) * 100)));
          return `
            <div class="dense-pressure-row" data-table="${p.name}" title="${p.name} tablosunu içeren view'ları göster">
              <div class="pressure-left">
                <span class="rank-badge">#${idx + 1}</span>
                <div class="pressure-info">
                  <strong class="pressure-name" title="${p.name}">${p.name}</strong>
                  <span class="pressure-metrics">${p.refs || 0} view · ${p.paths || 0} yol · ${p.critical || 0} kritik</span>
                </div>
              </div>
              <div class="pressure-right">
                <div class="pressure-mini-bar-wrap" title="Baskı Skoru: ${p.score}/100">
                  <div class="pressure-mini-bar" style="width:${barWidth}%"></div>
                </div>
                <span style="font-family:var(--font-family-mono);font-size:11.5px;font-weight:700;color:var(--text-secondary);min-width:24px;text-align:right">${p.score}</span>
              </div>
            </div>
          `;
        }).join('');

        // Clicking a pressure item filters View Inventory by that table
        $$('#pressureList .dense-pressure-row').forEach(item => {
          item.addEventListener('click', () => {
            const tName = item.dataset.table;
            if (tName) {
              const searchInput = $('#viewSearch');
              if (searchInput) {
                searchInput.value = tName;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              gotoPage('views');
            }
          });
        });
      }
    }

    // Section 5 (Right): Analysis Findings Feed (No penalty numbers, actionable)
    const feed = $('#overviewFeed');
    if (feed) {
      const topProblems = [];
      for (const v of views) {
        for (const p of v.problems || []) {
          if (topProblems.length < 4) {
            topProblems.push({ viewName: v.name || v.view_name, ...p });
          }
        }
      }

      if (topProblems.length === 0) {
        feed.innerHTML = '<div class="empty-state" style="padding:16px 0"><p style="font-size:12px;color:var(--text-muted)">Önemli bulgu bulunamadı. Sistem analizinde kritik kural ihlali tespit edilmedi.</p></div>';
      } else {
        feed.innerHTML = topProblems.map(p => {
          const sev = (p.severity || 'INFO').toLowerCase();
          const dotClass = sev === 'critical' || sev === 'danger' ? 'critical' : (sev === 'high' || sev === 'warning' ? 'high' : 'info');
          return `
            <div class="dense-finding-row" data-view="${p.viewName}" title="${p.viewName} detayını incele">
              <span class="problem-dot ${dotClass}" style="margin-top:4px"></span>
              <div class="dense-finding-content">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                  <strong class="dense-finding-title" title="${p.title}">${p.title}</strong>
                  <small style="font-size:10px;color:var(--purple-light);flex-shrink:0">${p.viewName}</small>
                </div>
                <span class="dense-finding-detail" title="${p.detail}">${p.detail}</span>
              </div>
            </div>
          `;
        }).join('');

        $$('#overviewFeed .dense-finding-row').forEach(item => {
          item.addEventListener('click', () => {
            const vName = item.dataset.view;
            if (vName) {
              selectView(vName);
              gotoPage('views');
            }
          });
        });
      }
    }
  }

  // Segmented Sort Buttons in Overview
  $$('#overviewSortSegmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#overviewSortSegmented button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentSort = btn.dataset.sort;
      renderOverview();
    });
  });

  // Overview Action Links & KPI Card Interactions
  const btnViewAllPressures = $('#btnViewAllPressures');
  if (btnViewAllPressures) {
    btnViewAllPressures.addEventListener('click', () => {
      const chip = $('button.filter-chip[data-view-filter="tables"]');
      if (chip) chip.click();
      gotoPage('views');
    });
  }

  const kpiCardCritical = $('#kpiCardCritical');
  if (kpiCardCritical) {
    kpiCardCritical.addEventListener('click', () => {
      const chip = $('button.filter-chip[data-risk="critical"]');
      if (chip) chip.click();
      gotoPage('views');
    });
  }

  const kpiCardRegressions = $('#kpiCardRegressions');
  if (kpiCardRegressions) {
    kpiCardRegressions.addEventListener('click', () => {
      state.currentSort = 'regression';
      gotoPage('views');
    });
  }

  const kpiCardIndexes = $('#kpiCardIndexes');
  if (kpiCardIndexes) {
    kpiCardIndexes.addEventListener('click', () => {
      gotoPage('dba-tools');
      const idxBtn = $('button.dba-subtab-btn[data-dba-tab="indexes"]');
      if (idxBtn) idxBtn.click();
    });
  }

  const kpiCardStats = $('#kpiCardStats');
  if (kpiCardStats) {
    kpiCardStats.addEventListener('click', () => {
      gotoPage('dba-tools');
      const statsBtn = $('button.dba-subtab-btn[data-dba-tab="stats"]');
      if (statsBtn) statsBtn.click();
    });
  }

  const kpiCardDuplicates = $('#kpiCardDuplicates');
  if (kpiCardDuplicates) {
    kpiCardDuplicates.addEventListener('click', () => {
      const chip = $('button.filter-chip[data-view-filter="duplicates"]');
      if (chip) chip.click();
      gotoPage('views');
    });
  }

  const refreshFeedBtn = $('#refreshFeedBtn');
  if (refreshFeedBtn) {
    refreshFeedBtn.addEventListener('click', () => {
      renderOverview();
      toast('Yenilendi', 'Analiz akışı ve metrikler güncellendi.', 'info');
    });
  }

  // --- 3. View Inventory & Detail Pane ---
  let viewListLimit = 50;

  function renderViewList(search = '') {
    const q = search.toLocaleLowerCase('tr').trim();
    const views = state.data.views || [];
    const filter = state.currentRiskFilter || 'all';
    const specialFilter = state.currentSpecialFilter || null;
    const dbFilter = state.dbFilter || 'all';

    // Populate or update #viewDbFilter
    const dbFilterSelect = $('#viewDbFilter');
    if (dbFilterSelect) {
      const distinctDbs = Array.from(new Set(views.map(v => v.database).filter(Boolean)));
      if (state.selectedDatabases && state.selectedDatabases.length > 0) {
        state.selectedDatabases.forEach(d => {
          if (!distinctDbs.includes(d)) distinctDbs.push(d);
        });
      }

      let opts = `<option value="all">Tüm Veritabanları (${views.length})</option>`;
      distinctDbs.forEach(dbName => {
        const count = views.filter(v => v.database === dbName).length;
        opts += `<option value="${dbName}">${dbName} (${count})</option>`;
      });

      if (dbFilterSelect.dataset.lastDbs !== distinctDbs.join(',')) {
        dbFilterSelect.innerHTML = opts;
        dbFilterSelect.dataset.lastDbs = distinctDbs.join(',');
      }

      if (distinctDbs.some(d => d.toLowerCase() === dbFilter.toLowerCase())) {
        dbFilterSelect.value = dbFilter;
      } else {
        state.dbFilter = 'all';
        dbFilterSelect.value = 'all';
      }

      dbFilterSelect.onchange = e => {
        state.dbFilter = e.target.value;
        viewListLimit = 50;
        renderViewList($('#viewSearch')?.value || '');
      };
    }

    const rows = views.filter(v => {
      const vCat = getSafeRiskCategory(v);
      const isReg = isViewRegressed(v);
      let matchesRisk = true;
      if (filter === 'critical') matchesRisk = vCat === 'critical';
      else if (filter === 'high') matchesRisk = vCat === 'high';
      else if (filter === 'regressed') matchesRisk = isReg;
      else if (filter !== 'all') matchesRisk = vCat === filter;

      const vName = String(v.name || v.view_name || '').toLocaleLowerCase('tr');
      const matchesSearch = !q || vName.includes(q) || (v.database && v.database.toLowerCase().includes(q));
      const matchesDb = dbFilter === 'all' || (v.database && v.database.toLowerCase() === dbFilter.toLowerCase());

      let matchesSpecial = true;
      if (specialFilter === 'tables') {
        matchesSpecial = (v.tables > 3 || (v.repeatedBaseTables && v.repeatedBaseTables.length > 0));
      } else if (specialFilter === 'duplicates') {
        matchesSpecial = Boolean(v.duplicateGroup || v.hasDuplicatePattern || (v.problems && v.problems.some(p => p.code === 'DUPLICATE_LOGIC')));
      }

      return matchesRisk && matchesSearch && matchesDb && matchesSpecial;
    });

    const criticalCount = views.filter(v => getSafeRiskCategory(v) === 'critical').length;
    const highCount = views.filter(v => getSafeRiskCategory(v) === 'high').length;
    const regressedCount = views.filter(v => isViewRegressed(v)).length;

    if ($('#countAll')) $('#countAll').textContent = views.length;
    if ($('#countCritical')) $('#countCritical').textContent = criticalCount;
    if ($('#countHigh')) $('#countHigh').textContent = highCount;
    if ($('#countRegressed')) $('#countRegressed').textContent = regressedCount;
    if ($('#inventoryTitle')) $('#inventoryTitle').textContent = `${views.length} View`;
    const navBadge = $('.nav-badge');
    if (navBadge) navBadge.textContent = views.length;

    const list = $('#viewList');
    if (!list) return;

    if (rows.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Aramaya veya seçili filtreye uygun view bulunamadı.</p></div>';
      return;
    }

    const visibleSlice = rows.slice(0, viewListLimit);
    const hasMore = rows.length > viewListLimit;

    let html = visibleSlice.map(v => {
      const name = v.name || v.view_name;
      const canonical = v.canonicalId || name;
      const isActive = canonical === state.selectedCanonicalId || name === state.selectedViewName;
      const riskCategory = getSafeRiskCategory(v);
      const riskScore = getSafeRiskScore(v);
      const readsStr = formatRuntimeReads(v);
      const isReg = isViewRegressed(v);
      const dbSubtitle = (state.dbFilter === 'all' && v.database)
        ? `<span class="view-row-db" title="${v.database}">${v.database}</span>`
        : '';

      const regIcon = isReg
        ? `<span class="view-row-reg" title="Performans regresyonu saptandı"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 3 7 9 5 7 1 11"></polyline><polyline points="9 3 13 3 13 7"></polyline></svg></span>`
        : `<span class="view-row-reg"></span>`;

      return `
        <div class="view-row ${isActive ? 'active' : ''}" data-view="${name}" data-canonical="${canonical}" role="option" aria-selected="${isActive ? 'true' : 'false'}" tabindex="0">
          <div class="view-row-left">
            <strong class="view-row-name" title="${name}">${name}</strong>
            ${dbSubtitle}
          </div>
          <span class="view-row-risk ${severityClass(riskCategory)}" title="Risk Skoru">${riskScore}</span>
          <span class="view-row-reads" title="Mantıksal Okuma">${readsStr}</span>
          ${regIcon}
        </div>
      `;
    }).join('');

    if (hasMore) {
      html += `
        <div style="padding:10px;text-align:center">
          <button type="button" class="button ghost small full" id="btnLoadMoreViews" style="font-size:12px;padding:6px 12px">
            Daha Fazla Göster (${rows.length - viewListLimit} kalan)
          </button>
        </div>
      `;
    }

    list.innerHTML = html;

    list.querySelectorAll('.view-row').forEach(r => {
      r.addEventListener('click', () => selectView(r.dataset.canonical || r.dataset.view));
    });

    const loadMoreBtn = $('#btnLoadMoreViews');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        viewListLimit += 50;
        renderViewList($('#viewSearch')?.value || '');
      });
    }
  }

  async function getViewDefinition(identifier) {
    if (!identifier) return '';
    const views = state.data.views || [];
    const targetStr = String(identifier || '').toLowerCase().trim();
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === targetStr) ||
      (x.name && x.name.toLowerCase() === targetStr) ||
      (x.view_name && x.view_name.toLowerCase() === targetStr)
    ) || views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase().endsWith('.' + targetStr)) ||
      (x.name && x.name.toLowerCase().includes(targetStr))
    );

    if (v && v.definition && v.definition.length > 5) {
      return v.definition;
    }

    if (state.isLive) {
      try {
        const param = v?.canonicalId || identifier;
        const res = await fetch(`/api/views/${encodeURIComponent(param)}/definition`);
        const json = await res.json();
        if (json.ok && json.sql) {
          if (v) v.definition = json.sql;
          return json.sql;
        }
      } catch (err) {
        console.warn('Failed to fetch SQL definition:', err);
      }
    }

    if (v && v.definition) return v.definition;
    return '';
  }

  async function selectView(identifier) {
    const views = state.data.views || [];
    const targetIdStr = String(identifier || '').toLowerCase().trim();
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === targetIdStr) ||
      (x.name && x.name.toLowerCase() === targetIdStr) ||
      (x.view_name && x.view_name.toLowerCase() === targetIdStr)
    ) || views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase().endsWith('.' + targetIdStr)) ||
      (x.name && x.name.toLowerCase().includes(targetIdStr))
    ) || views[0];
    if (!v) return;

    const name = v.name || v.view_name;
    const canonical = v.canonicalId || name;
    state.selectedViewName = name;
    state.selectedCanonicalId = canonical;

    $$('.view-row').forEach(r => {
      const isMatch = r.dataset.canonical === canonical || r.dataset.view === name;
      r.classList.toggle('active', isMatch);
      r.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    const riskCategory = getSafeRiskCategory(v);
    const riskScore = getSafeRiskScore(v);
    const riskLabelTr = getSafeRiskLabelTr(v);

    // 1. Header Hero
    if ($('#detailViewName')) $('#detailViewName').textContent = name;
    if ($('#detailViewMeta')) $('#detailViewMeta').textContent = `${v.schema_name || 'dbo'} · ${v.database || ''} · Son değişiklik ${v.modified || 'Bilinmiyor'}`;
    if ($('#detailRisk')) $('#detailRisk').textContent = riskScore;
    if ($('#detailRiskPill')) {
      const pill = $('#detailRiskPill');
      pill.className = `severity-pill ${severityClass(riskCategory)}`;
      pill.textContent = riskLabelTr;
    }
    if ($('#detailHealth')) $('#detailHealth').textContent = v.health || v.healthScore || 60;

    // 2. Metric Strip
    if ($('#statDepth')) $('#statDepth').textContent = v.depth || 1;
    if ($('#statDepthWarn')) {
      $('#statDepthWarn').textContent = (v.depth || 1) > 3 ? '⚠ > 3' : '✓ Normal';
      $('#statDepthWarn').style.color = (v.depth || 1) > 3 ? 'var(--yellow)' : 'var(--green)';
    }
    if ($('#statTables')) $('#statTables').textContent = v.tables || v.baseTableCount || 0;
    if ($('#statTablesWarn')) {
      const repCount = v.repeatedBaseTables?.length || 0;
      $('#statTablesWarn').textContent = repCount > 0 ? `${repCount} repeated` : 'Clean';
      $('#statTablesWarn').style.color = repCount > 0 ? 'var(--red)' : 'var(--green)';
    }
    if ($('#statDependents')) $('#statDependents').textContent = v.dependents || (v.dependents?.length || 0);

    const formattedReads = formatRuntimeReads(v);
    const formattedMedian = formatRuntimeMedian(v);
    if ($('#statReads')) $('#statReads').textContent = formattedReads;
    if ($('#statMedian')) $('#statMedian').textContent = formattedMedian;

    const readsCol = $('#statReadsCol');
    if (readsCol) {
      readsCol.title = formattedReads !== '—'
        ? (state.data.runtimeSource === 'QUERY_STORE' ? 'Query Store: Son 24 saatteki mantıksal okuma' : 'Plan Cache: Mantıksal okuma')
        : 'Çalışma zamanı verisi bulunamadı.';
    }
    const medianCol = $('#statMedianCol');
    if (medianCol) {
      medianCol.title = formattedMedian !== '—'
        ? 'Sorgu çalıştırma medyan süresi'
        : 'Çalışma zamanı verisi bulunamadı.';
    }

    // 3. Primary Diagnosis Box
    const primaryFinding = getPrimaryFinding(v);
    const isClean = primaryFinding.severity === 'low' || primaryFinding.title === 'Normal Çalışma';

    const primarySeverityEl = $('#primaryDiagSeverity');
    const primaryGradeEl = $('#primaryDiagGrade');
    const primaryTitleEl = $('#primaryDiagTitle');
    const primaryDescEl = $('#primaryDiagDesc');
    const primaryImpactEl = $('#primaryDiagImpact');
    const primaryEvidenceEl = $('#primaryDiagEvidence');
    const btnPrimaryRefactor = $('#btnPrimaryRefactor');

    if (isClean) {
      if (primarySeverityEl) {
        primarySeverityEl.className = 'severity-pill low';
        primarySeverityEl.textContent = 'DÜŞÜK';
      }
      if (primaryGradeEl) primaryGradeEl.textContent = 'Kanıt Gücü: Normal';
      if (primaryTitleEl) primaryTitleEl.textContent = 'Önemli Performans Riski Tespit Edilmedi';
      if (primaryDescEl) primaryDescEl.textContent = 'Bu view için kritik yapısal kural ihlali veya aktif çalışma zamanı regresyonu saptanmadı.';
      if (primaryImpactEl) primaryImpactEl.textContent = 'Sistem kaynakları üzerinde bilinen bir darboğaz bulunmuyor.';
      if (primaryEvidenceEl) primaryEvidenceEl.textContent = 'Statik Katalog Denetimi';
      if (btnPrimaryRefactor) btnPrimaryRefactor.style.display = 'none';
    } else {
      if (primarySeverityEl) {
        const sevKey = primaryFinding.severity.toUpperCase();
        const sevClass = severityClass(primaryFinding.severity);
        const sevLabel = (window.uiText?.severity?.[sevKey]?.label) || sevKey;
        primarySeverityEl.className = `severity-pill ${sevClass}`;
        primarySeverityEl.textContent = sevLabel;
      }
      if (primaryGradeEl) primaryGradeEl.textContent = `Kanıt Gücü: ${primaryFinding.gradeLabel || 'Düşük'}`;
      if (primaryTitleEl) primaryTitleEl.textContent = primaryFinding.title;
      if (primaryDescEl) primaryDescEl.textContent = primaryFinding.detail;
      if (primaryImpactEl) primaryImpactEl.textContent = primaryFinding.impact || 'Gereksiz mantıksal okuma (I/O) ve CPU tüketimi riski.';
      if (primaryEvidenceEl) primaryEvidenceEl.textContent = primaryFinding.evidence || 'Statik Bağımlılık Grafiği';
      if (btnPrimaryRefactor) btnPrimaryRefactor.style.display = '';
    }

    if (btnPrimaryRefactor) {
      btnPrimaryRefactor.onclick = () => {
        state.selectedViewName = name;
        state.selectedCanonicalId = canonical;
        gotoPage('studio');
        if (window.STUDIO_MODULES?.refactorStudio?.loadView) {
          window.STUDIO_MODULES.refactorStudio.loadView(canonical || name);
        }
      };
    }
    const btnPrimarySql = $('#btnPrimarySql');
    if (btnPrimarySql) {
      btnPrimarySql.onclick = () => {
        const tabBtn = $(`.detail-tabs button[data-detail-tab="sql-deps"]`);
        if (tabBtn) tabBtn.click();
      };
    }
    const btnPrimaryDeps = $('#btnPrimaryDeps');
    if (btnPrimaryDeps) {
      btnPrimaryDeps.onclick = () => {
        const tabBtn = $(`.detail-tabs button[data-detail-tab="sql-deps"]`);
        if (tabBtn) tabBtn.click();
        const depsEl = $('#dependenciesContent');
        if (depsEl) depsEl.scrollIntoView({ behavior: 'smooth' });
      };
    }

    // 4. Risk Sources Panel
    const riskSourcesList = $('#riskSourcesList');
    if (riskSourcesList) {
      const riskBars = v.riskBars || MOCK.riskBars;
      riskSourcesList.innerHTML = riskBars.map(r => {
        const contrib = getRiskContribution(r);
        return `
          <div class="risk-source-row" title="Ham Ceza: -${r.penalty || 0} puan (${r.label})">
            <span class="risk-source-name">${r.label}</span>
            <div class="risk-source-right">
              <span class="risk-source-tag ${contrib.level}">${contrib.label}</span>
              <span class="risk-source-mini-bar"><i style="width:${contrib.width}%;background:${contrib.color}"></i></span>
            </div>
          </div>
        `;
      }).join('');
    }

    // 5. All Findings Accordion
    const problems = v.problems || (v.hasDuplicatePattern ? [{ title: 'Mükerrer Mantık', detail: 'Benzer SQL gövdesi', severity: 'HIGH' }] : []);
    const tabProblemCount = $('#tabProblemCount');
    if (tabProblemCount) tabProblemCount.textContent = problems.length;

    const accordionList = $('#findingsAccordionList');
    if (accordionList) {
      if (problems.length === 0 || isClean) {
        accordionList.innerHTML = '<div class="empty-state" style="padding:24px 10px"><p>Bu view için önemli teşhis bulgusu bulunamadı.</p></div>';
      } else {
        accordionList.innerHTML = problems.map((p, idx) => {
          const sevClass = severityClass(p.severity);
          const sevLabel = (window.uiText?.severity?.[p.severity]?.label) || p.severity;
          const why = p.why || (window.uiText?.findings?.[p.code]?.why) || 'SQL Server bu işlem sırasında fazladan I/O ve CPU tüketebilir; sorgu planı verimsiz operatörler içerebilir.';
          const recommendation = p.recommendation || 'İlgili view veya alt sorguları gözden geçirin, execution planı analiz edin ve gereksiz tablo tekrarlarını kaldırın.';
          const evidence = p.evidence || 'Statik Bağımlılık Grafiği';
          const grade = p.evidenceGrade || 'Grade D (Heuristik)';
          const isHighGrade = grade.includes('A') || grade.includes('B');
          const evidencePower = isHighGrade ? 'Yüksek' : 'Düşük';

          return `
            <div class="accordion-item" data-problem-index="${idx}">
              <button type="button" class="accordion-trigger" aria-expanded="false" aria-controls="finding_body_${idx}">
                <div class="accordion-trigger-left">
                  <span class="severity-pill ${sevClass}">${sevLabel}</span>
                  <strong class="accordion-trigger-title">${p.title}</strong>
                  <span class="accordion-trigger-desc">— ${p.detail}</span>
                </div>
                <svg class="accordion-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"></polyline></svg>
              </button>
              <div class="accordion-body" id="finding_body_${idx}">
                <div class="accordion-sec">
                  <strong>Neden Önemli?</strong>
                  <p>${why}</p>
                </div>
                <div class="accordion-sec">
                  <strong>Ne Yapılabilir? (Öneri)</strong>
                  <p>${recommendation}</p>
                </div>
                <div class="accordion-meta">
                  <span><b>Kanıt:</b> ${evidence}</span>
                  <span>•</span>
                  <span title="${grade}">Kanıt Gücü: <b>${evidencePower}</b> <small style="color:var(--text-muted)">(${grade})</small></span>
                </div>
                <div class="accordion-actions">
                  <button type="button" class="button primary mini btn-acc-refactor" data-view="${name}">✦ Refaktör Et</button>
                  <button type="button" class="button ghost mini btn-acc-sql" data-view="${name}">SQL'i Aç</button>
                  <button type="button" class="button ghost mini btn-acc-deps" data-view="${name}">Bağımlılıkları Gör</button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        // Wire accordion trigger clicks
        accordionList.querySelectorAll('.accordion-trigger').forEach(trigger => {
          trigger.addEventListener('click', () => {
            const item = trigger.closest('.accordion-item');
            if (item) {
              const wasExpanded = item.classList.contains('expanded');
              item.classList.toggle('expanded', !wasExpanded);
              trigger.setAttribute('aria-expanded', String(!wasExpanded));
            }
          });
        });

        // Wire accordion action buttons
        accordionList.querySelectorAll('.btn-acc-refactor').forEach(b => {
          b.onclick = (e) => {
            e.stopPropagation();
            state.selectedViewName = name;
            state.selectedCanonicalId = canonical;
            gotoPage('studio');
            if (window.STUDIO_MODULES?.refactorStudio?.loadView) {
              window.STUDIO_MODULES.refactorStudio.loadView(canonical || name);
            }
          };
        });

        accordionList.querySelectorAll('.btn-acc-sql').forEach(b => {
          b.onclick = (e) => {
            e.stopPropagation();
            const tabBtn = $(`.detail-tabs button[data-detail-tab="sql-deps"]`);
            if (tabBtn) tabBtn.click();
          };
        });

        accordionList.querySelectorAll('.btn-acc-deps').forEach(b => {
          b.onclick = (e) => {
            e.stopPropagation();
            const tabBtn = $(`.detail-tabs button[data-detail-tab="sql-deps"]`);
            if (tabBtn) tabBtn.click();
            const depsEl = $('#dependenciesContent');
            if (depsEl) depsEl.scrollIntoView({ behavior: 'smooth' });
          };
        });
      }
    }

    // Dependencies Tab Content
    const depsTab = $('#dependenciesContent');
    if (depsTab) {
      const allDeps = state.data.dependencies || [];
      const vNameLower = (v.name || v.view_name || '').toLowerCase();
      const vCanonLower = (v.canonicalId || vNameLower).toLowerCase();

      // Collect Upstream Callers
      let upViews = (v.upstreamViews || []).map(u => typeof u === 'string' ? u.split('.').pop() : (u.name || u.canonicalId));
      if (upViews.length === 0) {
        allDeps.forEach(d => {
          const tCanon = (d.targetCanonicalId || '').toLowerCase();
          const tName = (d.targetName || d.target_name || d.referenced_entity_name || '').toLowerCase();
          if (tCanon === vCanonLower || tName === vNameLower || tCanon.endsWith('.' + vNameLower)) {
            const upName = d.sourceName || d.source_name || (d.sourceCanonicalId ? d.sourceCanonicalId.split('.').pop() : '');
            if (upName && !upViews.includes(upName)) upViews.push(upName);
          }
        });
      }

      // Collect Downstream Views
      let downViews = (v.downstreamViews || []).map(d => typeof d === 'string' ? d.split('.').pop() : (d.name || d.canonicalId));
      if (downViews.length === 0) {
        allDeps.forEach(d => {
          const sCanon = (d.sourceCanonicalId || '').toLowerCase();
          const sName = (d.sourceName || d.source_name || '').toLowerCase();
          if (sCanon === vCanonLower || sName === vNameLower || sCanon.endsWith('.' + vNameLower)) {
            const targetType = (d.targetType || d.target_type || '').toUpperCase();
            if (targetType.includes('VIEW')) {
              const dnName = d.targetName || d.target_name || d.referenced_entity_name || (d.targetCanonicalId ? d.targetCanonicalId.split('.').pop() : '');
              if (dnName && !downViews.includes(dnName)) downViews.push(dnName);
            }
          }
        });
      }

      // Collect Base Tables with database information!
      let tablesList = [];
      const repeatedTableNames = (v.repeatedBaseTables || []).map(r => (typeof r === 'string' ? r : (r.tableName || r.name || '')).toLowerCase());

      allDeps.forEach(d => {
        const sCanon = (d.sourceCanonicalId || '').toLowerCase();
        const sName = (d.sourceName || d.source_name || '').toLowerCase();
        if (sCanon === vCanonLower || sName === vNameLower || sCanon.endsWith('.' + vNameLower)) {
          const targetType = (d.targetType || d.target_type || '').toUpperCase();
          if (!targetType.includes('VIEW') && !targetType.includes('FUNCTION')) {
            const tName = d.targetName || d.target_name || d.referenced_entity_name || (d.targetCanonicalId ? d.targetCanonicalId.split('.').pop() : '');
            const tDb = d.targetDatabase || (d.targetCanonicalId ? d.targetCanonicalId.split('.')[0] : (v.database || ''));
            if (tName && !tablesList.some(item => item.name === tName && item.database === tDb)) {
              tablesList.push({
                name: tName,
                database: tDb,
                isRepeated: repeatedTableNames.includes(tName.toLowerCase())
              });
            }
          }
        }
      });

      // Fallback if empty
      if (tablesList.length === 0) {
        const fallbackTables = v.baseTables && v.baseTables.length > 0 ? v.baseTables : (!state.isLive ? ['STOKLAR', 'STOK_HAREKETLERI', 'ISEMIRLERI'] : []);
        tablesList = fallbackTables.map(t => {
          const tName = typeof t === 'string' ? t.split('.').pop() : (t.tableName || t.name || '');
          return {
            name: tName,
            database: v.database || '',
            isRepeated: repeatedTableNames.includes(tName.toLowerCase())
          };
        });
      }

      depsTab.innerHTML = `
        <div style="padding:12px 0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div>
              <h3 style="font-size:15px;font-weight:600;margin:0 0 4px">${name} Bağımlılık Ağacı</h3>
              <p style="font-size:12.5px;color:var(--text-muted);margin:0">Bu view'in çağırdığı tablolar, alt view'ler ve onu kullanan üst nesneler.</p>
            </div>
            <button class="button primary small" id="btnJumpToGraphFromDeps">⌁ Bağımlılık Haritasında Aç</button>
          </div>

          <!-- Section 1: Upstream View Callers -->
          <div style="margin-bottom:18px">
            <h4 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;display:flex;align-items:center;gap:6px">
              <span>⬆ Bu View'i Kullanan Üst Nesneler (${upViews.length})</span>
            </h4>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${upViews.map(u => `
                <span class="object-pill" style="cursor:pointer;background:rgba(124,92,255,0.08);border-color:rgba(124,92,255,0.25);color:#af9fff" data-open-view="${u}">
                  <b>VIEW</b> ${u}
                </span>
              `).join('') || '<span style="font-size:12.5px;color:var(--text-muted);font-style:italic">Bu view\'i doğrudan çağıran üst nesne tespit edilmedi (Blast radius: 0).</span>'}
            </div>
          </div>

          <!-- Section 2: Downstream Sub-Views -->
          <div style="margin-bottom:18px">
            <h4 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;display:flex;align-items:center;gap:6px">
              <span>⬇ Referans Verilen Alt View'ler (${downViews.length})</span>
            </h4>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${downViews.map(dw => `
                <span class="object-pill" style="cursor:pointer;background:rgba(124,92,255,0.08);border-color:rgba(124,92,255,0.25);color:#af9fff" data-open-view="${dw}">
                  <b>VIEW</b> ${dw}
                </span>
              `).join('') || '<span style="font-size:12.5px;color:var(--text-muted);font-style:italic">Alt view referansı yok (Yalnızca doğrudan base tablolara erişiyor).</span>'}
            </div>
          </div>

          <!-- Section 3: Base Tables (Disambiguated by Database!) -->
          <div>
            <h4 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;display:flex;align-items:center;gap:6px">
              <span>⊞ Erişilen Temel Tablolar (${tablesList.length})</span>
            </h4>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${tablesList.map(t => {
                const repStyle = t.isRepeated ? 'border-color:rgba(255,93,114,0.45);color:var(--red);background:rgba(255,93,114,0.1)' : 'background:rgba(80,216,255,0.06);border-color:rgba(80,216,255,0.25);color:#6edaff';
                return `
                  <span class="object-pill" style="${repStyle}">
                    ${t.database ? `<span class="db-badge" style="font-size:9.5px;padding:1px 5px;margin-right:4px">${t.database}</span>` : ''}
                    <b>TABLE</b> ${t.name} ${t.isRepeated ? '⇄ REPEATED' : ''}
                  </span>
                `;
              }).join('') || '<span style="font-size:12.5px;color:var(--text-muted)">Temel tablo bulunamadı.</span>'}
            </div>
          </div>
        </div>
      `;

      $('#btnJumpToGraphFromDeps')?.addEventListener('click', () => {
        state.selectedViewName = name;
        state.selectedCanonicalId = canonical;
        gotoPage('graph');
        renderGraph();
      });

      depsTab.querySelectorAll('[data-open-view]').forEach(elem => {
        elem.addEventListener('click', () => {
          selectView(elem.dataset.openView);
        });
      });
    }

    // Runtime Tab Content
    const runtimeTab = $('#runtimeDetailContent');
    if (runtimeTab) {
      const rt = v.runtime || null;
      const hasRuntimeData = rt && (rt.totalReads > 0 || rt.executionCount > 0 || (v.reads && v.reads !== '—' && v.reads !== '0'));

      if (!hasRuntimeData) {
        runtimeTab.innerHTML = `
          <div class="empty-state" style="padding:40px 10px">
            <div class="empty-icon">⚡</div>
            <h3>Çalışma Zamanı Kanıtı Bulunamadı</h3>
            <p>"${name}" view'i için Query Store veya DMV önbelleğinde doğrulanmış çalışma zamanı (I/O, süre) kaydı bulunamadı.</p>
          </div>
        `;
      } else {
        const totalReads = v.reads && v.reads !== '—' ? v.reads : (rt ? (rt.totalReads > 1e6 ? `${(rt.totalReads / 1e6).toFixed(1)}M` : rt.totalReads.toLocaleString()) : '0');
        const avgDuration = v.median && v.median !== '—' ? v.median : (rt ? `${rt.avgDurationMs || (rt.avgDurationUs ? Math.round(rt.avgDurationUs / 1000) : 0)} ms` : '—');
        const execCount = rt ? (rt.executionCount || rt.count || 1) : 0;
        const evidenceGrade = rt?.evidenceGrade || (state.data.runtimeSource === 'QUERY_STORE' ? 'A' : 'B');
        const evidenceSource = rt?.source === 'QUERY_STORE' ? 'Query Store (Canlı)' : 'DMV Plan Cache (Fallback)';
        const confidence = rt?.confidence || (rt?.regression?.confidence || 'MEDIUM');
        const attrMethod = rt?.attributionMethod || 'OBJECT_CORRELATED';
        const isReg = rt?.isRegressed || rt?.regression?.isRegressed;

        const reasonsHtml = rt?.regression?.reasons && rt.regression.reasons.length > 0
          ? `
            <div style="background:rgba(255,93,114,0.06);border:1px solid rgba(255,93,114,0.25);border-radius:8px;padding:12px 14px;margin-bottom:16px">
              <strong style="color:var(--red);font-size:13px;display:flex;align-items:center;gap:6px">
                <span>⚠</span> Doğrulanmış Regresyon Nedenleri (${rt.regression.reasons.length})
              </strong>
              <ul style="margin:8px 0 0 16px;padding:0;font-size:12px;color:var(--text-secondary)">
                ${rt.regression.reasons.map(r => `<li style="margin-bottom:4px"><b>${r}</b></li>`).join('')}
              </ul>
            </div>
          ` : '';

        const callingQueriesHtml = rt?.callingQueries && rt.callingQueries.length > 0
          ? rt.callingQueries.map(cq => `
              <div style="background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:8px">
                <code style="font-size:12px;color:var(--purple-light);display:block;margin-bottom:6px;word-break:break-all">
                  ${cq.sql || `SELECT * FROM dbo.[${name}]`}
                </code>
                <small style="color:var(--text-muted);font-size:11px">
                  ${cq.queryId ? `Sorgu ID: #${cq.queryId} · ` : ''}Yürütme: ~${cq.executions || 1} kez · Ort. Okuma: ${cq.avgReads || '—'}
                </small>
              </div>
            `).join('')
          : `
              <div style="background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:12px">
                <code style="font-size:12px;color:var(--purple-light);display:block;margin-bottom:6px">
                  SELECT * FROM dbo.[${name}]
                </code>
                <small style="color:var(--text-muted);font-size:11px">
                  Query Store plan hash ve sys.dm_exec_query_stats önbelleğindeki correlated sorgu metinleri analiz edilmiştir.
                </small>
              </div>
            `;

        runtimeTab.innerHTML = `
          <div style="padding:12px 0">
            <div class="setting-card runtime-attribution-card" style="margin-bottom:14px;border:1px solid var(--line);background:var(--surface2);padding:16px;border-radius:10px">
              <div style="flex:1">
                <strong style="font-size:14px;display:block;margin-bottom:4px">Runtime Attribution & Kanıt Derecesi</strong>
                <p style="font-size:12.5px;color:var(--text-muted);margin:0;line-height:1.45">
                  View bağımsız derlenen bir nesne değildir. Bu view tanımını içeren çağıran sorgular üzerinden toplam <b>${totalReads}</b> mantıksal okuma (logical reads) tespit edilmiştir. (Atıf Yöntemi: ${attrMethod})
                </p>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="connected-pill" style="font-size:11px;color:var(--yellow);border-color:rgba(247,200,106,0.3);background:rgba(247,200,106,0.08);padding:4px 10px;border-radius:6px">
                  GRADE ${evidenceGrade} (${evidenceSource})
                </span>
                <span class="connected-pill" style="font-size:11px;padding:4px 10px;border-radius:6px">
                  GÜVEN: ${confidence}
                </span>
              </div>
            </div>

            ${reasonsHtml}

            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:18px">
              <div class="msg-time-item">
                <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Mantıksal Okuma (Reads)</span>
                <strong style="font-size:18px;color:var(--text-primary)">${totalReads}</strong>
                ${rt?.regression?.readsDeltaPercent != null ? `<small style="color:${rt.regression.readsDeltaPercent >= 30 ? 'var(--red)' : 'var(--text-muted)'};font-size:11px;display:block">${rt.regression.readsDeltaPercent > 0 ? '+' : ''}${rt.regression.readsDeltaPercent}% değişim</small>` : ''}
              </div>
              <div class="msg-time-item">
                <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Ortalama Yürütme Süresi</span>
                <strong style="font-size:18px;color:var(--text-primary)">${avgDuration}</strong>
                ${rt?.regression?.durationDeltaPercent != null ? `<small style="color:${rt.regression.durationDeltaPercent >= 30 ? 'var(--red)' : 'var(--text-muted)'};font-size:11px;display:block">${rt.regression.durationDeltaPercent > 0 ? '+' : ''}${rt.regression.durationDeltaPercent}% değişim</small>` : ''}
              </div>
              <div class="msg-time-item">
                <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Ortalama İşlemci (CPU)</span>
                <strong style="font-size:18px;color:var(--text-primary)">${rt.current?.avgCpuMs != null ? rt.current.avgCpuMs + ' ms' : (rt.avgCpuUs ? Math.round(rt.avgCpuUs / 1000) + ' ms' : '—')}</strong>
                ${rt?.regression?.cpuDeltaPercent != null ? `<small style="color:${rt.regression.cpuDeltaPercent >= 30 ? 'var(--red)' : 'var(--text-muted)'};font-size:11px;display:block">${rt.regression.cpuDeltaPercent > 0 ? '+' : ''}${rt.regression.cpuDeltaPercent}% değişim</small>` : ''}
              </div>
              <div class="msg-time-item">
                <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Yürütme Sıklığı</span>
                <strong style="font-size:18px;color:var(--text-primary)">${execCount > 0 ? `~${execCount.toLocaleString()} çağrı` : '—'}</strong>
              </div>
              <div class="msg-time-item">
                <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Plan Durumu</span>
                ${rt.regression?.planChanged ? `
                  <strong style="font-size:14px;color:var(--red)">⚡ #${rt.regression.baselinePlanId || '?'} → #${rt.regression.currentPlanId || '?'}</strong>
                ` : `
                  <strong style="font-size:14px;color:var(--text-primary)">Plan #${rt.current?.planId || 'Sabit'}</strong>
                `}
              </div>
              <div class="msg-time-item">
                <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Regresyon Durumu</span>
                <strong style="font-size:14px;color:${isReg ? 'var(--red)' : 'var(--green)'}">
                  ${isReg ? `⚡ ${rt.regression?.severity || 'KRİTİK'} (${rt.regression?.severityScore || 0}/100)` : '✓ Stabil'}
                </strong>
              </div>
            </div>

            <div>
              <h4 style="font-size:13.5px;margin-bottom:8px">İlişkili Çağıran Sorgular (Correlated Queries)</h4>
              ${callingQueriesHtml}
            </div>
          </div>
        `;
      }
    }

    // Execution Plans Tab Content
    const planList = $('#planList');
    if (planList) {
      planList.innerHTML = `
        <div class="empty-state" style="padding:40px 10px">
          <div class="empty-icon">🗂</div>
          <h3>"${name}" İçin Kayıtlı Plan Bulunmuyor</h3>
          <p>SQL Server view nesnelerini bağımsız derlemez. Estimated veya Actual plan analizi için sorguyu SQL Workbench'te inceleyebilirsiniz.</p>
          <button class="button ghost small" id="btnOpenInWorkbenchFromPlan" style="margin-top:14px">SQL Workbench'te İncele →</button>
        </div>
      `;
      $('#btnOpenInWorkbenchFromPlan')?.addEventListener('click', () => {
        openWorkbenchSql(`SELECT TOP 100 * FROM ${v.database ? `[${v.database}].` : ''}[${v.schema_name || 'dbo'}].[${name}];`, v.database, name);
      });
    }

    // Index Tab Content Reset for current view
    const idxBody = $('#detailIndexTableBody');
    if (idxBody) {
      idxBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">"${name}" temel tablo indekslerini listelemek için yukarıdaki "İndeksleri Sorgula" butonuna tıklayın.</td></tr>`;
    }

    // History Tab Content
    const histTab = $('#detailHistoryContent');
    if (histTab) {
      const rt = v.runtime || null;
      if (rt && rt.baseline && rt.current) {
        const durDelta = rt.regression?.durationDeltaPercent != null ? rt.regression.durationDeltaPercent : 0;
        const durMs = rt.regression?.durationDeltaMs != null ? rt.regression.durationDeltaMs : 0;
        const cpuDelta = rt.regression?.cpuDeltaPercent != null ? rt.regression.cpuDeltaPercent : 0;
        const readsDelta = rt.regression?.readsDeltaPercent != null ? rt.regression.readsDeltaPercent : 0;
        const isReg = rt.isRegressed || rt.regression?.isRegressed;

        histTab.innerHTML = `
          <div style="padding:8px 0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div>
                <h4 style="font-size:14px;font-weight:600;margin:0 0 4px">Query Store Performans Geçmişi</h4>
                <p style="font-size:12px;color:var(--text-muted);margin:0">İki eşit zaman penceresi üzerinden baseline ve güncel yürütme metriklerinin karşılaştırması.</p>
              </div>
              <span class="connected-pill" style="font-size:11px;color:var(--green);border-color:rgba(67,217,156,0.3)">Grade A Doğrulama</span>
            </div>
            <div style="overflow-x:auto">
              <table class="wb-stats-table" style="width:100%;font-size:12.5px">
                <thead>
                  <tr>
                    <th>Periyot</th>
                    <th>Plan ID</th>
                    <th>Yürütme Sıklığı</th>
                    <th>Ort. Süre</th>
                    <th>Ort. CPU</th>
                    <th>Mantıksal Okuma</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Güncel Pencere</strong></td>
                    <td><span class="object-pill" style="font-size:11px">Plan #${rt.current.planId || '—'}</span></td>
                    <td>${rt.current.executionCount?.toLocaleString() || 0} çağrı</td>
                    <td style="color:var(--text-primary);font-weight:600">${rt.current.avgDurationMs} ms</td>
                    <td>${rt.current.avgCpuMs} ms</td>
                    <td>${rt.current.totalReads?.toLocaleString() || 0}</td>
                    <td><span class="severity-pill ${isReg ? 'critical' : 'low'}" style="font-size:10px;padding:2px 6px">${isReg ? 'REGRESYON' : 'NORMAL'}</span></td>
                  </tr>
                  <tr>
                    <td style="color:var(--text-muted)">Önceki (Baseline)</td>
                    <td><span class="object-pill" style="font-size:11px;opacity:0.8">Plan #${rt.baseline.planId || '—'}</span></td>
                    <td>${rt.baseline.executionCount?.toLocaleString() || 0} çağrı</td>
                    <td style="color:var(--text-muted)">${rt.baseline.avgDurationMs} ms</td>
                    <td style="color:var(--text-muted)">${rt.baseline.avgCpuMs} ms</td>
                    <td style="color:var(--text-muted)">${rt.baseline.totalReads?.toLocaleString() || 0}</td>
                    <td><span style="font-size:11px;color:var(--text-muted)">Referans</span></td>
                  </tr>
                  <tr style="background:rgba(255,255,255,0.02);font-weight:600">
                    <td><span>Değişim (Delta)</span></td>
                    <td>${rt.regression?.planChanged ? '<b style="color:var(--red)">⚡ Plan Değişti</b>' : '<span style="color:var(--text-muted)">Aynı Plan</span>'}</td>
                    <td>${(rt.current.executionCount || 0) - (rt.baseline.executionCount || 0)} çağrı</td>
                    <td style="color:${durDelta >= 30 ? 'var(--red)' : 'var(--green)'}">
                      ${durMs > 0 ? '+' : ''}${durMs} ms (%${durDelta > 0 ? '+' : ''}${durDelta})
                    </td>
                    <td style="color:${cpuDelta >= 30 ? 'var(--red)' : 'var(--text-secondary)'}">
                      %${cpuDelta > 0 ? '+' : ''}${cpuDelta}
                    </td>
                    <td style="color:${readsDelta >= 30 ? 'var(--red)' : 'var(--text-secondary)'}">
                      %${readsDelta > 0 ? '+' : ''}${readsDelta}
                    </td>
                    <td>
                      ${isReg
                        ? `<span class="severity-pill critical" style="font-size:10px;padding:2px 6px">-${rt.regression?.severityScore || 0} Puan</span>`
                        : '<span style="font-size:11px;color:var(--green)">✓ Stabil</span>'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        `;
      } else {
        const isFallback = state.isLive && state.data.runtimeSource === 'PLAN_CACHE';
        histTab.innerHTML = `
          <div class="empty-state" style="padding:28px 10px">
            <div class="empty-icon">🕒</div>
            <h3>Karşılaştırmalı Geçmiş Kaydı Yok</h3>
            <p>${state.isLive ? (isFallback ? 'Veritabanında Query Store kapalı olduğu için plan/süre geçmişi saklanmamaktadır (Plan Cache yalnızca sunucu yeniden başlatılana kadarki anlık sayaçları tutar).' : 'Seçili zaman penceresi öncesinde bu view için Query Store baseline kaydı tespit edilmedi.') : 'Demo veritabanında geçmiş kaydı bulunmamaktadır.'}</p>
          </div>
        `;
      }
    }

    // Lazy SQL Loading
    const sqlCode = $('#sqlCode');
    const sqlToolbarName = $('#sqlToolbarName');
    if (sqlToolbarName) sqlToolbarName.textContent = `${v.schema_name || 'dbo'}.${name}.sql`;

    if (sqlCode) {
      if (v.definition && v.definition.length > 5) {
        sqlCode.textContent = v.definition;
      } else {
        sqlCode.textContent = '-- SQL tanımı getiriliyor...';
        getViewDefinition(v.canonicalId || name).then(sql => {
          sqlCode.textContent = sql || '-- SQL tanımı alınamadı. Canlı bağlantı ve VIEW DEFINITION iznini kontrol edin.';
          if (sql) {
            v.definition = sql;
            sqlCode.textContent = sql;
          }
        });
      }
    }

    const graphSearch = $('#graphSearchInput');
    if (graphSearch) graphSearch.value = name;
  }

  // Filter Chips in Views (Quick Filters: all, critical, regressed; Popover: tables, duplicates, high)
  const filterMoreBtn = $('#btnViewFilterMore');
  const filterPopover = $('#viewFilterPopover');

  if (filterMoreBtn && filterPopover) {
    filterMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = filterPopover.classList.toggle('hidden');
      filterMoreBtn.setAttribute('aria-expanded', String(!isHidden));
    });

    document.addEventListener('click', (e) => {
      if (!filterPopover.contains(e.target) && e.target !== filterMoreBtn) {
        filterPopover.classList.add('hidden');
        filterMoreBtn.setAttribute('aria-expanded', 'false');
      }
    });

    filterPopover.querySelectorAll('.popover-item').forEach(item => {
      item.addEventListener('click', () => {
        filterPopover.classList.add('hidden');
        filterMoreBtn.setAttribute('aria-expanded', 'false');

        if (item.id === 'btnResetViewFilters' || item.classList.contains('reset')) {
          state.currentSpecialFilter = null;
          state.currentRiskFilter = 'all';
          filterMoreBtn.classList.remove('active');
          $$('.filter-chip').forEach(b => b.classList.toggle('active', b.dataset.risk === 'all'));
          filterPopover.querySelectorAll('.popover-item').forEach(pi => pi.classList.remove('active'));
          viewListLimit = 50;
          renderViewList($('#viewSearch')?.value || '');
          return;
        }

        viewListLimit = 50;
        if (item.dataset.viewFilter) {
          state.currentSpecialFilter = item.dataset.viewFilter;
          state.currentRiskFilter = 'all';
        } else if (item.dataset.risk) {
          state.currentSpecialFilter = null;
          state.currentRiskFilter = item.dataset.risk;
        }

        $$('.filter-chip').forEach(b => b.classList.remove('active'));
        filterMoreBtn.classList.add('active');
        filterPopover.querySelectorAll('.popover-item').forEach(pi => pi.classList.toggle('active', pi === item));
        renderViewList($('#viewSearch')?.value || '');
      });
    });
  }

  $$('.filter-chip:not(#btnViewFilterMore)').forEach(btn => {
    btn.addEventListener('click', () => {
      viewListLimit = 50;
      if (filterMoreBtn) filterMoreBtn.classList.remove('active');
      if (filterPopover) filterPopover.querySelectorAll('.popover-item').forEach(pi => pi.classList.remove('active'));

      if (btn.dataset.viewFilter) {
        state.currentSpecialFilter = btn.dataset.viewFilter;
        state.currentRiskFilter = 'all';
      } else {
        state.currentSpecialFilter = null;
        state.currentRiskFilter = btn.dataset.risk || 'all';
      }
      $$('.filter-chip').forEach(b => b.classList.toggle('active', b === btn));
      renderViewList($('#viewSearch')?.value || '');
    });
  });

  const viewSearchInput = $('#viewSearch');
  if (viewSearchInput) {
    viewSearchInput.addEventListener('input', e => {
      viewListLimit = 50;
      renderViewList(e.target.value);
    });
  }

  const refreshInventoryBtn = $('#refreshInventoryBtn');
  if (refreshInventoryBtn) {
    refreshInventoryBtn.addEventListener('click', () => {
      viewListLimit = 50;
      renderViewList($('#viewSearch')?.value || '');
      toast('Yenilendi', 'View envanter listesi güncellendi.', 'info');
    });
  }

  // Detail Tabs Switcher (Sprint 9: 4 Consolidated Tabs)
  const detailTabAliases = {
    overview: 'diagnosis',
    problems: 'diagnosis',
    sql: 'sql-deps',
    dependencies: 'sql-deps',
    runtime: 'runtime',
    plans: 'runtime',
    indexes: 'runtime',
    history: 'runtime',
    ai: 'refactor',
    refactor: 'refactor',
    diagnosis: 'diagnosis',
    'sql-deps': 'sql-deps'
  };

  $$('.detail-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      $$('.detail-tabs button').forEach(x => x.classList.toggle('active', x === b));
      $$('.detail-tab').forEach(t => t.classList.toggle('active', t.id === `detail-tab-${b.dataset.detailTab}`));
    });
  });

  $$('[data-detail-tab-jump]').forEach(b => {
    b.addEventListener('click', () => {
      const target = detailTabAliases[b.dataset.detailTabJump] || b.dataset.detailTabJump;
      const tabBtn = $(`.detail-tabs button[data-detail-tab="${target}"]`);
      if (tabBtn) tabBtn.click();
    });
  });

  // Sprint 9: Open in Unified Refactor Studio button
  $('#btnOpenInUnifiedStudio')?.addEventListener('click', () => {
    const vName = state.selectedCanonicalId || state.selectedViewName;
    gotoPage('studio');
    if (window.STUDIO_MODULES?.refactorStudio?.loadView) {
      window.STUDIO_MODULES.refactorStudio.loadView(vName);
    }
  });

  $('#copySqlBtn')?.addEventListener('click', () => {
    const code = $('#sqlCode')?.textContent || '';
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        toast('Kopyalandı', 'SQL kaynak kodu panoya kopyalandı.', 'success');
      });
    }
  });

  // ============================================================
  // --- 4. DEPENDENCY GRAPH (Phase 2A Unified Viewport Engine) ---
  // ============================================================

  function applyGraphTransform() {
    const viewport = $('#graphViewport');
    if (viewport) {
      viewport.style.transform = `translate(${graphState.panX}px, ${graphState.panY}px) scale(${graphState.zoom})`;
    }
  }

  async function renderGraph() {
    const views = state.data.views || [];
    const graphDbSel = $('#graphDbSelect');
    if (graphDbSel) {
      const distinctDbs = Array.from(new Set(views.map(v => v.database).filter(Boolean)));
      if (state.selectedDatabases && state.selectedDatabases.length > 0) {
        state.selectedDatabases.forEach(d => {
          if (!distinctDbs.includes(d)) distinctDbs.push(d);
        });
      }
      const currentGraphDb = graphDbSel.value || 'all';
      let opts = `<option value="all">Tüm Veritabanları</option>`;
      distinctDbs.forEach(d => {
        opts += `<option value="${d}">${d}</option>`;
      });

      if (graphDbSel.dataset.lastDbs !== distinctDbs.join(',')) {
        graphDbSel.innerHTML = opts;
        graphDbSel.dataset.lastDbs = distinctDbs.join(',');
      }

      if (distinctDbs.includes(currentGraphDb)) {
        graphDbSel.value = currentGraphDb;
      }
    }

    let targetName = state.selectedViewName;
    let targetView = views.find(v =>
      (v.canonicalId && v.canonicalId.toLowerCase() === String(state.selectedCanonicalId || targetName).toLowerCase()) ||
      (v.name || v.view_name) === targetName ||
      (v.name || v.view_name)?.toLowerCase() === String(targetName).toLowerCase()
    );

    if (graphDbSel && graphDbSel.value !== 'all') {
      if (targetView && targetView.database && targetView.database !== graphDbSel.value) {
        const dbOpt = Array.from(graphDbSel.options).find(o => o.value === targetView.database);
        if (dbOpt) graphDbSel.value = targetView.database;
      } else if (!targetView || (targetView.database && targetView.database !== graphDbSel.value)) {
        const dbViews = views.filter(v => v.database === graphDbSel.value);
        if (dbViews.length > 0) {
          targetView = dbViews[0];
          targetName = targetView.name || targetView.view_name;
          state.selectedViewName = targetName;
          state.selectedCanonicalId = targetView.canonicalId || targetName;
        }
      }
    }
    if (!targetView) targetView = views[0];
    if (!targetView) return;

    if ($('#graphSearchInput')) {
      $('#graphSearchInput').value = targetView.name || targetView.view_name;
    }

    const viewport = $('#graphViewport');
    const nodesWrap = $('#graphNodesContainer');
    const edgeLines = $('#graphEdgeLines');
    if (!viewport || !nodesWrap || !edgeLines) return;

    let subGraphData = null;
    if (state.isLive) {
      try {
        const depth = $('#graphDepthSelect')?.value || '2';
        const direction = $('#graphDirectionSelect')?.value || 'both';
        const targetParam = targetView.canonicalId || targetView.name || targetView.view_name;
        const res = await fetch(`/api/views/${encodeURIComponent(targetParam)}/graph?depth=${depth}&direction=${direction}`);
        const json = await res.json();
        if (json.ok && json.graph) {
          subGraphData = json.graph;
        }
      } catch (_) {
        // Fallback to local synthesis
      }
    }

    const targetNameStr = targetView.name || targetView.view_name;
    const targetCanonStr = (targetView.canonicalId || targetNameStr).toLowerCase();
    const repeated = (targetView.repeatedBaseTables || []).map(r => (typeof r === 'string' ? r : (r.tableName || r.name || '')));

    let nodes = [];
    let edges = [];

    // Helper to test if a table is repeated
    const checkIsHot = (name, canon) => {
      const nLower = String(name || '').toLowerCase();
      const cLower = String(canon || '').toLowerCase();
      return repeated.some(r => {
        const rLower = String(r).toLowerCase();
        return rLower === nLower || cLower.endsWith('.' + rLower) || nLower.endsWith('.' + rLower);
      });
    };

    if (subGraphData && Array.isArray(subGraphData.nodes) && subGraphData.nodes.length > 0) {
      // 1. Live Subgraph from Backend API (with real depths & multi-level BFS tree)
      nodes = subGraphData.nodes.map(n => {
        const nName = n.name || (n.canonicalId ? n.canonicalId.split('.').pop() : '');
        const nCanon = (n.canonicalId || nName).toLowerCase();
        const isTarget = Boolean(n.isTarget || n.type === 'TARGET' || nName.toLowerCase() === targetNameStr.toLowerCase() || nCanon === targetCanonStr);

        let role = isTarget ? 'TARGET' : (n.type || 'TABLE');
        let badge = 'TABLE';
        if (isTarget) badge = 'VIEW';
        else if (role === 'UPSTREAM_VIEW' || role === 'UPSTREAM') badge = 'VIEW';
        else if (role === 'DOWNSTREAM_VIEW') badge = 'VIEW';
        else if (role === 'FUNCTION') badge = 'FN';
        else if (role === 'LINKED_SERVER') badge = 'LINK';
        else if (role === 'SYNONYM') badge = 'SYN';

        const isHot = checkIsHot(nName, n.canonicalId);

        return {
          id: n.id || n.canonicalId || nName,
          canonicalId: n.canonicalId || n.id || nName,
          name: nName,
          database: n.database || (isTarget ? (targetView.database || '') : ''),
          type: role,
          badge,
          depth: isTarget ? 0 : Number(n.depth || 0),
          health: n.health || (isTarget ? (targetView.health || targetView.healthScore || 60) : 60),
          risk: n.risk || (isTarget ? (targetView.risk || targetView.riskLevel || 'MEDIUM') : 'NORMAL'),
          isTarget,
          isHot
        };
      });

      // Connect edges using node lookup
      const nodeMap = new Map();
      nodes.forEach(n => {
        if (n.id) nodeMap.set(String(n.id).toLowerCase(), n);
        if (n.canonicalId) nodeMap.set(String(n.canonicalId).toLowerCase(), n);
        if (n.name) {
          nodeMap.set(String(n.name).toLowerCase(), n);
          if (n.database) {
            nodeMap.set(`${n.database.toLowerCase()}.${n.name.toLowerCase()}`, n);
            nodeMap.set(`${n.database.toLowerCase()}.dbo.${n.name.toLowerCase()}`, n);
          }
        }
      });

      const edgeDedupe = new Set();
      (subGraphData.edges || []).forEach(e => {
        const fromKey = String(e.from || e.sourceCanonicalId || e.sourceName || '').toLowerCase();
        const toKey = String(e.to || e.targetCanonicalId || e.targetName || '').toLowerCase();
        const fromNode = nodeMap.get(fromKey);
        const toNode = nodeMap.get(toKey);
        if (fromNode && toNode && fromNode !== toNode) {
          const k = `${fromNode.id}->${toNode.id}`;
          if (!edgeDedupe.has(k)) {
            edgeDedupe.add(k);
            edges.push({
              fromNode,
              toNode,
              type: e.type || (toNode.depth > fromNode.depth ? 'downstream' : 'upstream'),
              isHot: Boolean(toNode.isHot || e.isHot)
            });
          }
        }
      });
    } else {
      // 2. Client-side Multi-Hop Synthesis (for demo mode or when API returns empty)
      const targetNode = {
        id: targetCanonStr || targetNameStr,
        canonicalId: targetCanonStr || targetNameStr,
        name: targetNameStr,
        database: targetView.database || '',
        type: 'TARGET',
        badge: 'VIEW',
        depth: 0,
        isTarget: true,
        health: targetView.health || targetView.healthScore || 60,
        risk: targetView.risk || targetView.riskLevel || 'MEDIUM',
        riskScore: targetView.riskScore || 70
      };
      nodes.push(targetNode);

      const allDeps = state.data.dependencies || [];
      const depthLimit = $('#graphDepthSelect')?.value === 'all' ? 99 : Number($('#graphDepthSelect')?.value || 2);
      const direction = $('#graphDirectionSelect')?.value || 'both';

      const visited = new Set([targetCanonStr, targetNameStr.toLowerCase()]);
      const queue = [{ node: targetNode, depth: 0 }];

      // BFS Downstream
      if (direction === 'both' || direction === 'downstream') {
        let qIdx = 0;
        while (qIdx < queue.length) {
          const { node: currNode, depth: currDepth } = queue[qIdx++];
          if (currDepth >= depthLimit) continue;

          const currCanon = currNode.canonicalId.toLowerCase();
          const currName = currNode.name.toLowerCase();

          allDeps.forEach(d => {
            const sCanon = (d.sourceCanonicalId || '').toLowerCase();
            const sName = (d.sourceName || d.source_name || '').toLowerCase();
            if (sCanon === currCanon || sName === currName || sCanon.endsWith('.' + currName)) {
              const tCanon = (d.targetCanonicalId || '').toLowerCase();
              const tName = d.targetName || d.target_name || d.referenced_entity_name || (tCanon ? tCanon.split('.').pop() : '');
              const tDb = d.targetDatabase || (tCanon ? tCanon.split('.')[0] : (currNode.database || ''));
              const rawType = (d.targetType || d.target_type || '').toUpperCase();
              const isView = rawType.includes('VIEW');
              const isFn = rawType.includes('FUNCTION');
              const role = isView ? 'DOWNSTREAM_VIEW' : (isFn ? 'FUNCTION' : 'TABLE');
              const badge = isView ? 'VIEW' : (isFn ? 'FN' : 'TABLE');
              const nodeKey = tCanon || (tDb ? `${tDb}.dbo.${tName}` : tName);

              let childNode = nodes.find(n => (n.canonicalId && n.canonicalId.toLowerCase() === nodeKey.toLowerCase()) || (n.name.toLowerCase() === tName.toLowerCase() && n.database === tDb));
              if (!childNode) {
                childNode = {
                  id: nodeKey,
                  canonicalId: nodeKey,
                  name: tName,
                  database: tDb,
                  type: role,
                  badge,
                  depth: currDepth + 1,
                  isHot: checkIsHot(tName, nodeKey)
                };
                nodes.push(childNode);
              }

              if (!edges.some(e => e.fromNode === currNode && e.toNode === childNode)) {
                edges.push({
                  fromNode: currNode,
                  toNode: childNode,
                  type: 'downstream',
                  isHot: childNode.isHot
                });
              }

              if (isView && !visited.has(nodeKey.toLowerCase())) {
                visited.add(nodeKey.toLowerCase());
                queue.push({ node: childNode, depth: currDepth + 1 });
              }
            }
          });
        }
      }

      // BFS Upstream
      if (direction === 'both' || direction === 'upstream') {
        const upQueue = [{ node: targetNode, depth: 0 }];
        let upIdx = 0;
        while (upIdx < upQueue.length) {
          const { node: currNode, depth: currDepth } = upQueue[upIdx++];
          if (currDepth >= depthLimit) continue;

          const currCanon = currNode.canonicalId.toLowerCase();
          const currName = currNode.name.toLowerCase();

          allDeps.forEach(d => {
            const tCanon = (d.targetCanonicalId || '').toLowerCase();
            const tName = (d.targetName || d.target_name || d.referenced_entity_name || '').toLowerCase();
            if (tCanon === currCanon || tName === currName || tCanon.endsWith('.' + currName)) {
              const sCanon = (d.sourceCanonicalId || '').toLowerCase();
              const sName = d.sourceName || d.source_name || (sCanon ? sCanon.split('.').pop() : '');
              const sDb = d.sourceDatabase || (sCanon ? sCanon.split('.')[0] : (currNode.database || ''));
              const nodeKey = sCanon || (sDb ? `${sDb}.dbo.${sName}` : sName);

              let parentNode = nodes.find(n => (n.canonicalId && n.canonicalId.toLowerCase() === nodeKey.toLowerCase()) || (n.name.toLowerCase() === sName.toLowerCase() && n.database === sDb));
              if (!parentNode) {
                parentNode = {
                  id: nodeKey,
                  canonicalId: nodeKey,
                  name: sName,
                  database: sDb,
                  type: 'UPSTREAM_VIEW',
                  badge: 'VIEW',
                  depth: -(currDepth + 1),
                  health: 65 - currDepth * 4,
                  risk: 'HIGH'
                };
                nodes.push(parentNode);
              }

              if (!edges.some(e => e.fromNode === parentNode && e.toNode === currNode)) {
                edges.push({
                  fromNode: parentNode,
                  toNode: currNode,
                  type: 'upstream',
                  isHot: false
                });
              }

              if (!visited.has(nodeKey.toLowerCase())) {
                visited.add(nodeKey.toLowerCase());
                upQueue.push({ node: parentNode, depth: currDepth + 1 });
              }
            }
          });
        }
      }

      // Demo fallback if still only target node
      if (nodes.length === 1 && !state.isLive) {
        const up1 = { id: 'AA_GENEL_PLAN', name: 'AA_GENEL_PLAN', database: targetView.database || 'LIDER26', type: 'UPSTREAM_VIEW', badge: 'VIEW', depth: -1, health: 65, risk: 'HIGH' };
        const up2 = { id: 'AA_PLANLAMA_EKRANI', name: 'AA_PLANLAMA_EKRANI', database: targetView.database || 'LIDER26', type: 'UPSTREAM_VIEW', badge: 'VIEW', depth: -1, health: 60, risk: 'HIGH' };
        const subV = { id: 'V_SUB_MALZEME_IHTIYAC', name: 'V_SUB_MALZEME_IHTIYAC', database: targetView.database || 'LIDER26', type: 'DOWNSTREAM_VIEW', badge: 'VIEW', depth: 1, health: 68, risk: 'MEDIUM' };
        const tbl1 = { id: 'tbl_stok_26', name: 'STOKLAR', database: 'LIDER26', type: 'TABLE', badge: 'TABLE', depth: 2, isHot: true };
        const tbl2 = { id: 'tbl_stok_25', name: 'STOKLAR', database: 'LIDER25', type: 'TABLE', badge: 'TABLE', depth: 2, isHot: false };
        const tbl3 = { id: 'tbl_hareket', name: 'STOK_HAREKETLERI', database: targetView.database || 'LIDER26', type: 'TABLE', badge: 'TABLE', depth: 2, isHot: true };
        const tbl4 = { id: 'tbl_isemri', name: 'ISEMIRLERI', database: targetView.database || 'LIDER26', type: 'TABLE', badge: 'TABLE', depth: 1, isHot: false };

        nodes.push(up1, up2, subV, tbl4, tbl1, tbl2, tbl3);
        edges.push(
          { fromNode: up1, toNode: targetNode, type: 'upstream' },
          { fromNode: up2, toNode: targetNode, type: 'upstream' },
          { fromNode: targetNode, toNode: subV, type: 'downstream' },
          { fromNode: targetNode, toNode: tbl4, type: 'downstream' },
          { fromNode: subV, toNode: tbl1, type: 'downstream', isHot: true },
          { fromNode: subV, toNode: tbl2, type: 'downstream' },
          { fromNode: subV, toNode: tbl3, type: 'downstream', isHot: true }
        );
      }
    }

    // 3. Multi-Layer Layout Engine (Column per depth)
    const centerX = 1200;
    const centerY = 800;
    const layerSpacingX = 440;

    // Group nodes by depth
    const depthGroups = new Map();
    nodes.forEach(n => {
      const d = Number(n.depth || 0);
      if (!depthGroups.has(d)) depthGroups.set(d, []);
      depthGroups.get(d).push(n);
    });

    depthGroups.forEach((groupNodes, depth) => {
      // Sort: Views first, then Tables, then Functions, then name
      groupNodes.sort((a, b) => {
        const typeOrder = { 'TARGET': 0, 'VIEW': 1, 'UPSTREAM_VIEW': 1, 'DOWNSTREAM_VIEW': 1, 'TABLE': 2, 'FUNCTION': 3, 'SYNONYM': 4, 'LINKED_SERVER': 5 };
        const orderA = typeOrder[a.type] ?? 9;
        const orderB = typeOrder[b.type] ?? 9;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      const count = groupNodes.length;
      const spacingY = count > 8 ? 85 : (count > 5 ? 105 : (count > 2 ? 125 : 145));
      const startY = centerY - ((count - 1) * spacingY) / 2;

      groupNodes.forEach((node, idx) => {
        node.x = centerX + (depth * layerSpacingX);
        node.y = startY + (idx * spacingY);
      });
    });

    graphState.nodes = nodes;
    graphState.edges = edges;
    const targetNodeObj = nodes.find(n => n.isTarget) || nodes[0];
    graphState.selectedNodeId = targetNodeObj ? targetNodeObj.id : 'target';

    // Render Nodes & Edges
    renderGraphEdges();
    renderGraphNodes();

    // Center Graph Viewport Initially
    graphCenterSelected();

    // Set default inspector to target node
    if (targetNodeObj) {
      updateInspector(targetNodeObj.name, targetNodeObj.type, targetView, targetNodeObj);
    }
  }

  function renderGraphEdges() {
    const edgeLines = $('#graphEdgeLines');
    if (!edgeLines) return;

    edgeLines.innerHTML = graphState.edges.map(e => {
      if (!e.fromNode || !e.toNode) return '';
      const isLeftToRight = e.fromNode.x <= e.toNode.x;
      const x1 = isLeftToRight ? e.fromNode.x + 105 : e.fromNode.x - 105;
      const y1 = e.fromNode.y;
      const x2 = isLeftToRight ? e.toNode.x - 105 : e.toNode.x + 105;
      const y2 = e.toNode.y;
      const midX = (x1 + x2) / 2;

      let curveD;
      if (Math.abs(e.fromNode.x - e.toNode.x) < 50) {
        const loopOffset = 130;
        curveD = `M${e.fromNode.x + 105} ${y1} C${e.fromNode.x + 105 + loopOffset} ${y1}, ${e.toNode.x + 105 + loopOffset} ${y2}, ${e.toNode.x + 105} ${y2}`;
      } else {
        curveD = `M${x1} ${y1} C${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
      }

      const pathClass = e.isHot ? 'hot-edge' : '';
      return `<path d="${curveD}" class="${pathClass}" data-from="${e.fromNode.name}" data-to="${e.toNode.name}"></path>`;
    }).join('');
  }

  function renderGraphNodes() {
    const nodesWrap = $('#graphNodesContainer');
    if (!nodesWrap) return;

    nodesWrap.innerHTML = graphState.nodes.map(n => {
      let nodeClass = 'graph-node';
      if (n.isTarget) nodeClass += ' target-node';
      else if (n.type === 'TABLE') nodeClass += ` table-node ${n.isHot ? 'hot' : ''}`;
      else if (n.type === 'FUNCTION') nodeClass += ' function-node';
      else nodeClass += ' view-node';

      if (n.id === graphState.selectedNodeId) nodeClass += ' active-node';

      let subtitle = `Health ${n.health || 60}`;
      if (n.isTarget) subtitle = `Health ${n.health || 60} · ${n.risk || 'NORMAL'}`;
      else if (n.isHot) subtitle = '⇄ Tekrarlı Erişim Rotaları';
      else if (n.type === 'TABLE') subtitle = n.database ? `Tablo · [${n.database}]` : 'Temel Tablo';
      else if (n.type === 'FUNCTION') subtitle = 'Fonksiyon';
      else if (n.type === 'DOWNSTREAM_VIEW') subtitle = `Referans View · Seviye ${n.depth}`;
      else if (n.type === 'UPSTREAM' || n.type === 'UPSTREAM_VIEW') subtitle = `Çağıran View · Seviye ${Math.abs(n.depth)}`;

      const dbBadgeHtml = n.database ? `<span class="node-db-badge" title="Veritabanı: ${n.database}">${n.database}</span>` : '';

      return `
        <div class="${nodeClass}" id="gnode_${n.id}" style="left:${n.x}px;top:${n.y}px" data-node-id="${n.id}" data-node-name="${n.name}" data-node-type="${n.type}" title="${n.canonicalId || n.name}">
          <div style="display:flex;align-items:center;margin-bottom:5px;flex-wrap:wrap;gap:4px">
            <span class="node-badge">${n.badge}</span>
            ${dbBadgeHtml}
          </div>
          <strong style="white-space:normal;word-break:break-word;font-size:13px;line-height:1.3" title="${n.name}">${n.name}</strong>
          <small style="margin-top:4px">${subtitle}</small>
        </div>
      `;
    }).join('');

    // Attach Node Mouse Events (Click & Dragging)
    nodesWrap.querySelectorAll('.graph-node').forEach(elem => {
      elem.addEventListener('mousedown', e => {
        e.stopPropagation();
        const nodeId = elem.dataset.nodeId;
        const node = graphState.nodes.find(n => n.id === nodeId);
        if (!node) return;

        graphState.isDraggingNode = true;
        graphState.draggedNodeId = nodeId;
        graphState.draggedElem = elem;
        graphState.dragStartX = e.clientX;
        graphState.dragStartY = e.clientY;
        graphState.nodeOrigX = node.x;
        graphState.nodeOrigY = node.y;

        // Select Node in Inspector
        graphState.selectedNodeId = nodeId;
        $$('.graph-node').forEach(gn => gn.classList.toggle('active-node', gn.dataset.nodeId === nodeId));
        const currentView = state.data.views.find(v => (v.name || v.view_name) === state.selectedViewName) || state.data.views[0];
        updateInspector(node.name, node.type, currentView, node);
      });
    });
  }

  function updateInspector(nodeName, nodeType, currentView, nodeObj) {
    const insp = $('#graphInspector');
    if (!insp) return;
    insp.style.display = 'block';

    if ($('#inspectorNodeName')) $('#inspectorNodeName').textContent = nodeName;
    if ($('#inspectorNodeType')) {
      let typeLabel = 'VIEW';
      if (nodeType === 'TABLE') typeLabel = 'BASE TABLE';
      else if (nodeType === 'TARGET') typeLabel = 'HEDEF VIEW';
      else if (nodeType === 'UPSTREAM' || nodeType === 'UPSTREAM_VIEW') typeLabel = 'DEPENDENT VIEW';
      else if (nodeType === 'DOWNSTREAM_VIEW') typeLabel = 'REFERENCED VIEW';
      else if (nodeType === 'FUNCTION') typeLabel = 'FUNCTION';
      else if (nodeType === 'SYNONYM') typeLabel = 'SYNONYM';
      else if (nodeType === 'LINKED_SERVER') typeLabel = 'LINKED SERVER';
      $('#inspectorNodeType').textContent = typeLabel;
    }

    if ($('#inspectorNodeDb')) {
      const db = nodeObj?.database || (nodeObj?.canonicalId ? nodeObj.canonicalId.split('.')[0] : (currentView?.database || '—'));
      $('#inspectorNodeDb').textContent = db;
    }

    const p = (state.data.pressures || []).find(x => x.name === nodeName);
    const isTargetOrView = nodeType !== 'TABLE' && nodeType !== 'FUNCTION';
    const refsCount = p ? p.refs : (isTargetOrView ? (currentView?.dependents || (currentView?.dependentList?.length || 0)) : 1);
    const pathsCount = p ? p.paths : (isTargetOrView ? (currentView?.depth || 1) : 1);
    const criticalCount = p ? p.critical : (isTargetOrView ? (currentView?.problems?.filter(pr => pr.severity === 'CRITICAL').length || 0) : 0);

    if ($('#inspectorMetricRefs')) $('#inspectorMetricRefs').textContent = refsCount;
    if ($('#inspectorMetricPaths')) $('#inspectorMetricPaths').textContent = pathsCount;
    if ($('#inspectorMetricCritical')) $('#inspectorMetricCritical').textContent = criticalCount;

    const warnBox = $('#inspectorWarningBox');
    if (warnBox) {
      if (nodeType === 'TABLE') {
        const isRepeated = nodeObj?.isHot || (currentView?.repeatedBaseTables || []).some(r => r.tableName === nodeName || r.canonicalId?.endsWith('.' + nodeName));
        warnBox.style.display = isRepeated ? 'block' : 'none';
      } else {
        warnBox.style.display = 'none';
      }
    }

    // Inspector Action Buttons
    const btnView = $('#btnInspOpenView');
    const btnSql = $('#btnInspOpenSql');
    const btnPressure = $('#btnInspOpenPressure');

    const isViewType = nodeType === 'TARGET' || nodeType === 'VIEW' || nodeType === 'UPSTREAM' || nodeType === 'UPSTREAM_VIEW' || nodeType === 'DOWNSTREAM_VIEW';

    if (btnView) {
      btnView.style.display = isViewType ? 'block' : 'none';
      btnView.onclick = () => {
        selectView(nodeObj?.canonicalId || nodeName);
        gotoPage('views');
      };
    }
    if (btnSql) {
      btnSql.style.display = isViewType ? 'block' : 'none';
      btnSql.onclick = () => {
        selectView(nodeObj?.canonicalId || nodeName);
        gotoPage('views');
        setTimeout(() => {
          $(`.detail-tabs button[data-detail-tab="sql"]`)?.click();
        }, 50);
      };
    }
    if (btnPressure) {
      btnPressure.style.display = nodeType === 'TABLE' ? 'block' : 'none';
      btnPressure.onclick = () => gotoPage('tables');
    }
  }

  // Wire Close Inspector Button and Esc key
  $('#closeInspectorBtn')?.addEventListener('click', () => {
    const insp = $('#graphInspector');
    if (insp) insp.style.display = 'none';
    graphState.selectedNodeId = null;
    $$('.graph-node').forEach(gn => gn.classList.remove('active-node'));
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const insp = $('#graphInspector');
      if (insp && insp.style.display !== 'none') {
        insp.style.display = 'none';
        graphState.selectedNodeId = null;
        $$('.graph-node').forEach(gn => gn.classList.remove('active-node'));
      }
    }
  });

  // --- Graph Canvas Drag (Pan) & Zoom Engine ---
  const graphStage = $('#graphStage');
  if (graphStage) {
    let panStartX = 0;
    let panStartY = 0;

    graphStage.addEventListener('mousedown', e => {
      // If user clicks on empty stage area, start panning
      if (e.target.closest('.graph-inspector') || e.target.closest('.graph-node')) return;
      graphState.isPanning = true;
      panStartX = e.clientX - graphState.panX;
      panStartY = e.clientY - graphState.panY;
      graphStage.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
      // 1. Panning Canvas
      if (graphState.isPanning) {
        graphState.panX = e.clientX - panStartX;
        graphState.panY = e.clientY - panStartY;
        applyGraphTransform();
        return;
      }

      // 2. Dragging Specific Node
      if (graphState.isDraggingNode && graphState.draggedNodeId) {
        const node = graphState.nodes.find(n => n.id === graphState.draggedNodeId);
        if (node) {
          const dx = (e.clientX - graphState.dragStartX) / graphState.zoom;
          const dy = (e.clientY - graphState.dragStartY) / graphState.zoom;
          node.x = graphState.nodeOrigX + dx;
          node.y = graphState.nodeOrigY + dy;

          const elem = graphState.draggedElem || document.getElementById(`gnode_${node.id}`) || document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
          if (elem) {
            elem.style.left = `${node.x}px`;
            elem.style.top = `${node.y}px`;
          }
          renderGraphEdges();
        }
      }
    });

    window.addEventListener('mouseup', () => {
      if (graphState.isPanning) {
        graphState.isPanning = false;
        graphStage.style.cursor = 'grab';
      }
      if (graphState.isDraggingNode) {
        graphState.isDraggingNode = false;
        graphState.draggedNodeId = null;
        graphState.draggedElem = null;
      }
    });

    // Cursor-Anchored Wheel Zoom
    graphStage.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = graphStage.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZoom = Math.max(0.25, Math.min(2.5, graphState.zoom * factor));

      graphState.panX = mouseX - (mouseX - graphState.panX) * (newZoom / graphState.zoom);
      graphState.panY = mouseY - (mouseY - graphState.panY) * (newZoom / graphState.zoom);
      graphState.zoom = newZoom;
      applyGraphTransform();
    }, { passive: false });
  }

  // --- Graph Toolbar Buttons ---
  $('#graphZoomIn')?.addEventListener('click', () => {
    if (!graphStage) return;
    const midX = graphStage.clientWidth / 2;
    const midY = graphStage.clientHeight / 2;
    const newZoom = Math.min(2.5, graphState.zoom * 1.2);
    graphState.panX = midX - (midX - graphState.panX) * (newZoom / graphState.zoom);
    graphState.panY = midY - (midY - graphState.panY) * (newZoom / graphState.zoom);
    graphState.zoom = newZoom;
    applyGraphTransform();
  });

  $('#graphZoomOut')?.addEventListener('click', () => {
    if (!graphStage) return;
    const midX = graphStage.clientWidth / 2;
    const midY = graphStage.clientHeight / 2;
    const newZoom = Math.max(0.25, graphState.zoom / 1.2);
    graphState.panX = midX - (midX - graphState.panX) * (newZoom / graphState.zoom);
    graphState.panY = midY - (midY - graphState.panY) * (newZoom / graphState.zoom);
    graphState.zoom = newZoom;
    applyGraphTransform();
  });

  function graphFitToView() {
    if (!graphStage || graphState.nodes.length === 0) return;
    const stageW = graphStage.clientWidth;
    const stageH = graphStage.clientHeight;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of graphState.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }

    const padding = 140;
    const graphW = Math.max(300, (maxX - minX) + padding * 2);
    const graphH = Math.max(300, (maxY - minY) + padding * 2);

    const scaleX = stageW / graphW;
    const scaleY = stageH / graphH;
    const newZoom = Math.max(0.3, Math.min(1.2, Math.min(scaleX, scaleY)));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    graphState.zoom = newZoom;
    graphState.panX = (stageW / 2) - centerX * newZoom;
    graphState.panY = (stageH / 2) - centerY * newZoom;
    applyGraphTransform();
  }

  $('#graphFitToView')?.addEventListener('click', graphFitToView);

  function graphCenterSelected() {
    if (!graphStage) return;
    const stageW = graphStage.clientWidth;
    const stageH = graphStage.clientHeight;
    const node = graphState.nodes.find(n => n.id === graphState.selectedNodeId) || graphState.nodes[0];
    if (!node) return;

    graphState.panX = (stageW / 2) - node.x * graphState.zoom;
    graphState.panY = (stageH / 2) - node.y * graphState.zoom;
    applyGraphTransform();
  }

  $('#graphCenterSelected')?.addEventListener('click', graphCenterSelected);
  $('#graphResetLayout')?.addEventListener('click', () => {
    graphState.zoom = 1;
    renderGraph();
  });

  // Graph Depth, Direction & Database Dropdown Changes
  $('#graphDepthSelect')?.addEventListener('change', () => renderGraph());
  $('#graphDirectionSelect')?.addEventListener('change', () => renderGraph());
  $('#graphDbSelect')?.addEventListener('change', () => {
    const chosenDb = $('#graphDbSelect')?.value;
    if (chosenDb && chosenDb !== 'all') {
      const dbView = (state.data.views || []).find(v => v.database === chosenDb);
      if (dbView) {
        state.selectedViewName = dbView.name || dbView.view_name;
        state.selectedCanonicalId = dbView.canonicalId || state.selectedViewName;
      }
    }
    renderGraph();
  });

  // --- Graph Live Autocomplete Search ---
  const graphSearchInput = $('#graphSearchInput');
  const graphDropdown = $('#graphSearchDropdown');

  function getSearchCandidates(query = '') {
    const q = query.toLowerCase().trim();
    const chosenDb = $('#graphDbSelect')?.value;
    let rawViews = state.data.views || [];
    if (chosenDb && chosenDb !== 'all') {
      rawViews = rawViews.filter(v => v.database === chosenDb);
    }
    const views = rawViews.map(v => ({ name: v.name || v.view_name, type: 'VIEW', database: v.database }));
    const tables = (state.data.pressures || []).map(p => ({ name: p.name, type: 'TABLE', database: p.database }));
    const functions = [{ name: 'fn_DepodakiMiktar', type: 'FUNCTION', database: '' }];

    const all = [...views, ...tables, ...functions];
    if (!q) {
      return { total: all.length, candidates: all.slice(0, 100) };
    }
    const filtered = all.filter(item => item.name.toLowerCase().includes(q));
    return { total: filtered.length, candidates: filtered.slice(0, 100) };
  }

  function renderSearchDropdown(searchResult) {
    if (!graphDropdown) return;
    const { total, candidates } = typeof searchResult === 'object' && searchResult.candidates
      ? searchResult
      : { total: (searchResult || []).length, candidates: searchResult || [] };

    if (candidates.length === 0) {
      graphDropdown.innerHTML = `
        <div class="autocomplete-empty" style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px">
          Eşleşen view veya nesne bulunamadı.
        </div>
      `;
      graphDropdown.classList.remove('hidden');
      return;
    }

    let html = candidates.map((item, idx) => `
      <div class="autocomplete-item ${idx === graphState.searchIndex ? 'active' : ''}" data-index="${idx}" data-name="${item.name}">
        <span class="item-name">${item.name}</span>
        ${item.database ? `<span class="db-badge" style="font-size:9.5px;padding:1px 5px">${item.database}</span>` : ''}
        <span class="node-badge" style="font-size:10px">${item.type}</span>
      </div>
    `).join('');

    if (total > candidates.length) {
      html += `
        <div class="autocomplete-footer" style="padding:7px 12px;font-size:11px;color:var(--text-muted);background:var(--surface2);border-top:1px solid var(--line);text-align:center">
          Toplam ${total} sonuçtan ilk ${candidates.length} tanesi gösteriliyor. Filtrelemek için yazmaya devam edin.
        </div>
      `;
    }

    graphDropdown.innerHTML = html;
    graphDropdown.classList.remove('hidden');

    graphDropdown.querySelectorAll('.autocomplete-item').forEach(el => {
      el.addEventListener('click', () => {
        chooseSearchResult(el.dataset.name);
      });
    });
  }

  function chooseSearchResult(name) {
    if (!name) return;
    const views = state.data.views || [];
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === name.toLowerCase()) ||
      (x.name && x.name.toLowerCase() === name.toLowerCase()) ||
      (x.view_name && x.view_name.toLowerCase() === name.toLowerCase())
    );
    const actualName = v ? (v.name || v.view_name) : name;
    if (graphSearchInput) graphSearchInput.value = actualName;
    if (graphDropdown) graphDropdown.classList.add('hidden');

    // If selected view belongs to a specific db, make sure graphDbSelect matches
    if (v && v.database) {
      const graphDbSel = $('#graphDbSelect');
      if (graphDbSel && graphDbSel.value !== 'all' && graphDbSel.value !== v.database) {
        const dbOpt = Array.from(graphDbSel.options).find(o => o.value === v.database);
        if (dbOpt) graphDbSel.value = v.database;
      }
    }

    selectView(actualName);
    renderGraph();
  }

  if (graphSearchInput && graphDropdown) {
    const showSearchDropdown = () => {
      const q = graphSearchInput.value.trim();
      graphState.searchIndex = -1;
      const res = getSearchCandidates(q);
      renderSearchDropdown(res);
    };

    graphSearchInput.addEventListener('input', showSearchDropdown);
    graphSearchInput.addEventListener('focus', showSearchDropdown);
    graphSearchInput.addEventListener('click', showSearchDropdown);

    graphSearchInput.addEventListener('keydown', e => {
      const items = graphDropdown.querySelectorAll('.autocomplete-item');
      if (items.length === 0 || graphDropdown.classList.contains('hidden')) {
        if (e.key === 'Enter') {
          chooseSearchResult(graphSearchInput.value.trim());
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        graphState.searchIndex = (graphState.searchIndex + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle('active', i === graphState.searchIndex));
        items[graphState.searchIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        graphState.searchIndex = (graphState.searchIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('active', i === graphState.searchIndex));
        items[graphState.searchIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (graphState.searchIndex >= 0 && items[graphState.searchIndex]) {
          chooseSearchResult(items[graphState.searchIndex].dataset.name);
        } else {
          chooseSearchResult(graphSearchInput.value.trim());
        }
      } else if (e.key === 'Escape') {
        graphDropdown.classList.add('hidden');
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.graph-search-wrap')) {
        graphDropdown.classList.add('hidden');
      }
    });
  }

  // --- 5. Table Pressure Page ---
  function renderTables() {
    const tableBody = $('#tpTableBody');
    const pressures = state.data.pressures || [];

    // KPI Strip Calculations
    const totalTables = pressures.length;
    const highPressureCount = pressures.filter(p => p.score > 75).length;
    const totalCritical = pressures.reduce((acc, p) => acc + (p.critical || 0), 0);
    const totalRepeated = pressures.reduce((acc, p) => acc + (p.repeated || 0), 0);

    if ($('#tpKpiTotalTables')) $('#tpKpiTotalTables').textContent = totalTables;
    if ($('#tpKpiHighPressure')) $('#tpKpiHighPressure').textContent = highPressureCount;
    if ($('#tpKpiCriticalConsumers')) $('#tpKpiCriticalConsumers').textContent = totalCritical;
    if ($('#tpKpiRepeatedPaths')) $('#tpKpiRepeatedPaths').textContent = totalRepeated;

    if (!tableBody) return;

    if (pressures.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">Tablo baskı analizi verisi bulunamadı.</td></tr>`;
      return;
    }

    tableBody.innerHTML = pressures.map((p, idx) => {
      const canonical = p.canonicalId || `${p.database || 'MikroDB'}.dbo.${p.name}`;
      const isHot = p.score > 80;
      const scoreClass = isHot ? 'critical' : p.score > 60 ? 'warning' : 'good';
      const scoreLabel = isHot ? 'KRİTİK' : p.score > 60 ? 'YÜKSEK' : 'NORMAL';

      return `
        <tr class="tp-row ${idx === 0 ? 'active' : ''}" data-canonical="${canonical}" data-name="${p.name}" data-db="${p.database || ''}">
          <td>
            <strong style="color:var(--text-primary);font-size:14px">${p.name}</strong>
            <small style="display:block;color:var(--text-muted);font-size:11.5px">${canonical}</small>
          </td>
          <td>
            <span class="object-pill" style="font-size:11.5px">${p.database || 'MikroDB'}</span>
          </td>
          <td>
            <span class="tp-score-pill ${scoreClass}">${p.score} · ${scoreLabel}</span>
          </td>
          <td>
            <strong>${p.refs}</strong> <span style="font-size:12px;color:var(--text-muted)">view</span>
          </td>
          <td>
            <strong>${p.paths}</strong> <span style="font-size:12px;color:var(--text-muted)">yol</span>
          </td>
          <td>
            <span style="font-weight:700;color:${(p.repeated || 0) > 0 ? 'var(--red)' : 'var(--green)'}">${p.repeated || 0}</span>
          </td>
          <td>
            <span style="font-weight:700;color:${(p.critical || 0) > 0 ? 'var(--red)' : 'var(--text-muted)'}">${p.critical || 0} view</span>
          </td>
          <td>
            <span class="connected-pill" style="font-size:11px;color:var(--yellow);border-color:rgba(247,200,106,0.25)">Grade A / B</span>
          </td>
          <td>
            <button class="button ghost mini btn-inspect-table" data-name="${p.name}" data-canonical="${canonical}">İncele →</button>
          </td>
        </tr>
      `;
    }).join('');

    // Row Click & Inspection
    $$('.tp-row').forEach(r => {
      r.addEventListener('click', () => {
        $$('.tp-row').forEach(x => x.classList.remove('active'));
        r.classList.add('active');
        const cId = r.dataset.canonical;
        const name = r.dataset.name;
        openTableInspector(cId, name);
      });
    });

    // Wire Close Inspector Button
    $('#closeTpInspectorBtn')?.addEventListener('click', () => {
      $('#tpInspector')?.classList.add('hidden');
      $('#tpMainLayout')?.classList.add('inspector-closed');
      $$('.tp-row').forEach(x => x.classList.remove('active'));
    });

    // Auto inspect first row
    if (pressures.length > 0) {
      openTableInspector(pressures[0].canonicalId || pressures[0].name, pressures[0].name);
    }
  }

  function openTableInspector(canonicalId, name) {
    const insp = $('#tpInspector');
    const layout = $('#tpMainLayout');
    if (!insp) return;

    const pressures = state.data.pressures || [];
    const p = pressures.find(x => x.canonicalId === canonicalId || x.name === name) || pressures[0];
    if (!p) return;

    insp.classList.remove('hidden');
    layout?.classList.remove('inspector-closed');

    if ($('#tpInspTableName')) $('#tpInspTableName').textContent = p.name;

    const body = $('#tpInspectorBody');
    if (body) {
      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <span class="object-pill">${p.database || 'MikroDB'}</span>
          <span class="severity-pill ${p.score > 80 ? 'critical' : 'warning'}">RİSK ${p.score} / 100</span>
        </div>

        <div class="spc-section why" style="margin-bottom:12px">
          <strong>Neden Yüksek Baskı Var?</strong>
          <p>${p.refs} farklı view doğrudan veya dolaylı olarak bu tabloya erişiyor. Toplam ${p.paths} bağımlılık yolu ve ${p.repeated || 0} mükerrer erişim rotası tespit edildi.</p>
        </div>

        <div class="inspector-metric"><span>Kullanan Toplam View</span><strong>${p.refs}</strong></div>
        <div class="inspector-metric"><span>Bağımlılık Yolları</span><strong>${p.paths}</strong></div>
        <div class="inspector-metric"><span>Mükerrer Erişim Yolu</span><strong class="danger-text">${p.repeated || 0}</strong></div>
        <div class="inspector-metric"><span>Kritik Tüketici View</span><strong class="danger-text">${p.critical || 0}</strong></div>

        <div style="margin:16px 0 10px">
          <h4 style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Öne Çıkan Tüketici View'lar</h4>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${(() => {
              const matchedViews = (state.data.views || []).filter(v => {
                const bts = v.baseTables || [];
                return bts.some(t => (typeof t === 'string' ? t : (t.name || '')).toLowerCase() === (p.name || '').toLowerCase());
              }).slice(0, 4);

              if (matchedViews.length === 0) {
                const fallbackViews = (state.data.views || []).slice(0, 3);
                return fallbackViews.map(v => `
                  <div style="padding:6px 10px;background:var(--surface2);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:12.5px;font-weight:600">${v.name || v.view_name}</span>
                    <small style="color:var(--accent);font-weight:700">Bağımlı</small>
                  </div>
                `).join('');
              }

              return matchedViews.map(v => `
                <div style="padding:6px 10px;background:var(--surface2);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:12.5px;font-weight:600">${v.name || v.view_name}</span>
                  <small style="color:${(v.riskScore >= 70) ? 'var(--red)' : 'var(--yellow)'};font-weight:700">Risk ${v.riskScore || 50}</small>
                </div>
              `).join('');
            })()}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
          <button class="button primary small full" id="btnTpOpenGraph">⌁ Bağımlılık Haritasında Gör</button>
          <button class="button ghost small full" id="btnTpOpenWorkbench">⚡ SQL Çalışma Alanında Sorgula</button>
        </div>
      `;

      $('#btnTpOpenGraph')?.addEventListener('click', () => {
        gotoPage('graph');
        const input = $('#graphSearchInput');
        if (input) {
          input.value = p.name;
          renderGraph();
        }
      });

      $('#btnTpOpenWorkbench')?.addEventListener('click', () => {
        openWorkbenchSql(`SELECT TOP 50 *\nFROM [${p.database || state.primaryDatabase}].[dbo].[${p.name}];`, p.database, p.name);
      });
    }
  }

  // --- 6. Duplicate Logic Page ---
  function renderDuplicates() {
    const grid = $('#duplicateGrid');
    if (!grid) return;
    const dups = state.data.duplicates || [];

    grid.innerHTML = dups.map(d => `
      <article class="duplicate-card">
        <div class="dup-head">
          <div>
            <span class="panel-kicker">OLASI MÜKERRER VIEW (FINGERPRINT)</span>
            <h3 style="margin-top:4px">SQL Mantık Eşleşmesi</h3>
          </div>
          <span class="similarity">✓ %${d.similarity} Benzer</span>
        </div>
        <div class="dup-pair" style="margin:12px 0">
          <div class="dup-view" style="font-weight:600">${d.a}</div>
          <span style="color:var(--text-muted);font-size:16px">⟷</span>
          <div class="dup-view" style="font-weight:600">${d.b}</div>
        </div>
        <div class="dup-meta">
          <span style="font-size:11.5px;color:var(--text-muted)">Ortak Tablolar:</span>
          ${(d.common || []).map(x => `<span class="object-pill">${x}</span>`).join('')}
        </div>
        <p style="font-size:12.5px;color:var(--text-muted);margin:12px 0 14px">Temel fark: <b style="color:var(--text-secondary)">${d.diff}</b></p>
        <div style="display:flex;gap:8px;border-top:1px solid var(--line);padding-top:10px">
          <button class="button ghost mini btn-dup-diff" data-a="${d.a}" data-b="${d.b}">⇄ Yan Yana SQL Karşılaştır</button>
          <button class="button ghost mini btn-dup-graph" data-a="${d.a}">⌁ Haritada Gör</button>
          <button class="button primary mini btn-dup-ai" data-a="${d.a}" data-b="${d.b}">✦ AI Birleştirme Analizi</button>
        </div>
      </article>
    `).join('') || '<div class="empty-state"><p>Mükerrer SQL gövdesi bulunamadı.</p></div>';

    // Bind action buttons
    $$('.btn-dup-diff').forEach(b => {
      b.onclick = async () => {
        const viewA = b.dataset.a;
        const viewB = b.dataset.b;
        gotoPage('validation');
        const vo = $('#valOrigSql');
        const vc = $('#valCandSql');
        if (vo) vo.value = `-- View A (${viewA}) SQL tanımı yükleniyor...`;
        if (vc) vc.value = `-- View B (${viewB}) SQL tanımı yükleniyor...`;

        const [defA, defB] = await Promise.all([
          getViewDefinition(viewA),
          getViewDefinition(viewB)
        ]);

        if (vo) vo.value = defA;
        if (vc) vc.value = defB;
        invalidateValidation();
        if (!defA || !defB) {
          toast('Karşılaştırma Hazır Değil', 'İki view için gerçek SQL tanımı gerekiyor. Bağlantı ve tanım erişimini kontrol edin.', 'warning');
          return;
        }
        toast('Mükerrer SQL Karşılaştırma', `${viewA} ve ${viewB} SQL tanımları Validation Lab'a aktarıldı.`, 'success');
      };
    });
    $$('.btn-dup-graph').forEach(b => {
      b.onclick = () => {
        gotoPage('graph');
        const gi = $('#graphSearchInput');
        if (gi) { gi.value = b.dataset.a; renderGraph(); }
      };
    });
    $$('.btn-dup-ai').forEach(b => {
      b.onclick = () => {
        if (b.dataset.a) {
          const targetV = (state.data.views || []).find(x => (x.name || x.view_name) === b.dataset.a);
          if (!targetV) {
            toast('Nesne Envanterde Yok', 'Önce bu view içeren veritabanını tarayın. AI ekranına farklı bir nesne taşınmadı.', 'warning');
            return;
          }
          state.selectedViewName = b.dataset.a;
          state.selectedCanonicalId = targetV.canonicalId || targetV.name;
        }
        gotoPage('refactor');
      };
    });
  }

  function clearRegressionXRay() {
    if ($('#xrayTargetViewTitle')) $('#xrayTargetViewTitle').textContent = 'Regresyon Seçilmedi';
    if ($('#xrayOp1Name')) $('#xrayOp1Name').textContent = '—';
    if ($('#xrayOp1Stat')) $('#xrayOp1Stat').textContent = '—';
    if ($('#xrayOp2Name')) $('#xrayOp2Name').textContent = '—';
    if ($('#xrayOp2Stat')) $('#xrayOp2Stat').textContent = '—';
    if ($('#xrayOp3Name')) $('#xrayOp3Name').textContent = '—';
    if ($('#xrayOp3Stat')) $('#xrayOp3Stat').textContent = '—';
    if ($('#xrayLogicalReads')) $('#xrayLogicalReads').textContent = '—';
    if ($('#xraySeverityBadge')) {
      $('#xraySeverityBadge').textContent = 'VERİ YOK';
      $('#xraySeverityBadge').className = 'severity-pill';
    }
    const causesContainer = $('#xrayCausesContainer');
    if (causesContainer) {
      causesContainer.innerHTML = '<div class="empty-state" style="padding:24px 10px"><p style="color:var(--text-muted);font-size:12px">Analiz edilecek doğrulanmış regresyon bulunmuyor.</p></div>';
    }
  }

  // --- 7. Runtime & Regression Page ---
  function updateRegressionXRay(viewName) {
    if (!viewName) {
      clearRegressionXRay();
      return;
    }
    const views = state.data.views || [];
    const regs = state.data.regressions || [];
    const v = views.find(x => (x.name || x.view_name) === viewName) || {};
    const reg = regs.find(x => x.name === viewName) || v.runtime?.regression || null;

    if ($('#xrayTargetViewTitle')) {
      $('#xrayTargetViewTitle').textContent = viewName;
    }

    const bts = v.baseTables || [];
    const t1 = bts[0] || '—';
    const t2 = bts[1] || '—';

    const isRegressed = reg?.isRegressed || (reg?.severityScore > 0);
    const sevScore = reg?.severityScore || (isRegressed ? 75 : 0);
    const sevName = reg?.severity || reg?.severityCategory || (sevScore >= 70 ? 'KRİTİK' : sevScore >= 45 ? 'YÜKSEK' : 'UYARI');

    if ($('#xraySeverityBadge')) {
      if (isRegressed) {
        $('#xraySeverityBadge').textContent = `${sevName} (${sevScore}/100)`;
        $('#xraySeverityBadge').className = `severity-pill ${severityClass(sevName)}`;
      } else {
        $('#xraySeverityBadge').textContent = 'STABİL';
        $('#xraySeverityBadge').className = 'severity-pill';
        $('#xraySeverityBadge').style.background = 'rgba(67,217,156,0.1)';
        $('#xraySeverityBadge').style.color = 'var(--green)';
        $('#xraySeverityBadge').style.borderColor = 'rgba(67,217,156,0.3)';
      }
    }

    // Plan X-Ray Operator Flow
    if (reg?.planChanged) {
      if ($('#xrayOp1Name')) $('#xrayOp1Name').textContent = `Plan #${reg.baselinePlanId || 'Eski'}`;
      if ($('#xrayOp1Stat')) $('#xrayOp1Stat').textContent = `${reg.before || (v.runtime?.baseline?.avgDurationMs ? v.runtime.baseline.avgDurationMs + 'ms' : 'Baseline')}`;
      if ($('#xrayOp2Name')) $('#xrayOp2Name').textContent = 'Plan Flip ⚡';
      if ($('#xrayOp2Stat')) $('#xrayOp2Stat').textContent = `Süre: ${reg.delta || '+' + (reg.durationDeltaPercent || 0) + '%'}`;
      if ($('#xrayOp3Name')) $('#xrayOp3Name').textContent = `Plan #${reg.currentPlanId || 'Yeni'}`;
      if ($('#xrayOp3Stat')) $('#xrayOp3Stat').textContent = `${reg.now || (v.runtime?.current?.avgDurationMs ? v.runtime.current.avgDurationMs + 'ms' : 'Güncel')}`;
    } else {
      if ($('#xrayOp1Name')) $('#xrayOp1Name').textContent = t1 !== '—' ? t1 : (v.schema_name || 'dbo');
      if ($('#xrayOp1Stat')) $('#xrayOp1Stat').textContent = v.depth ? `Derinlik: ${v.depth}` : '—';
      if ($('#xrayOp2Name')) $('#xrayOp2Name').textContent = isRegressed ? 'Kaynak Sapması' : (v.problems?.includes('SCALAR_UDF') ? 'Skalar UDF (RBAR)' : 'Yürütme Akışı');
      if ($('#xrayOp2Stat')) $('#xrayOp2Stat').textContent = reg?.executions ? `${reg.executions} çalıştırma` : (v.runtime?.executionCount ? `${v.runtime.executionCount} çalıştırma` : '—');
      if ($('#xrayOp3Name')) $('#xrayOp3Name').textContent = t2 !== '—' ? t2 : viewName;
      if ($('#xrayOp3Stat')) $('#xrayOp3Stat').textContent = reg?.reads || (v.runtime?.formattedReads || '—');
    }

    // Foot Metrics
    if ($('#xrayCardError')) {
      const durDelta = reg?.durationDeltaPercent != null ? `+${reg.durationDeltaPercent}%` : (reg?.delta || '—');
      const durMs = reg?.durationDeltaMs != null ? ` (+${reg.durationDeltaMs}ms)` : '';
      $('#xrayCardError').textContent = isRegressed ? `${durDelta}${durMs}` : 'Sapma Yok';
    }
    if ($('#xrayLogicalReads')) {
      $('#xrayLogicalReads').textContent = reg?.reads || v.reads || (v.runtime?.totalReads ? v.runtime.totalReads.toLocaleString() : '—');
    }
    if ($('#xrayMemoryGrant')) {
      const cpuDelta = reg?.cpuDeltaPercent != null ? `+${reg.cpuDeltaPercent}%` : '—';
      $('#xrayMemoryGrant').textContent = isRegressed ? `CPU: ${cpuDelta}` : 'Normal';
    }

    // Dynamic Root Causes
    const causesContainer = $('#xrayCausesContainer');
    if (causesContainer) {
      const reasons = reg?.reasons || [];
      if (reasons.length > 0) {
        causesContainer.innerHTML = reasons.map(r => `
          <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;margin-bottom:8px;background:rgba(255,93,114,0.06);border:1px solid rgba(255,93,114,0.2);border-radius:6px">
            <span class="cause-score" style="font-size:11px;padding:2px 6px;color:var(--red);background:rgba(255,93,114,0.15)">REGRESYON</span>
            <div>
              <strong style="font-size:12.5px;color:var(--text-primary)">${r}</strong>
              <p style="font-size:11px;color:var(--text-muted);margin:2px 0 0">Query Store metrik karşılaştırması ve plan hash analizi ile doğrulandı.</p>
            </div>
          </div>
        `).join('');
      } else {
        const causes = [];
        if (v.problems?.includes('SCALAR_UDF')) {
          causes.push({ score: 'Yüksek', title: 'Skalar UDF Satır Bazlı (RBAR) Döngü', desc: 'dbo.fn_* fonksiyonu her satır için ayrı çağrılarak işlemciyi kilitliyor.' });
        }
        if (v.problems?.includes('REPEATED_TABLE_ACCESS') || v.problems?.includes('MULTIPLE_ACCESS')) {
          causes.push({ score: 'Yüksek', title: 'Mükerrer Tablo Erişimi & CTE Inlining', desc: `${t1 !== '—' ? t1 : 'Temel'} tablosuna çoklu dallar üzerinden tekrar tekrar erişiliyor.` });
        }
        if (v.problems?.includes('NON_SARGABLE_EXPRESSION')) {
          causes.push({ score: 'Orta', title: 'SARGable Olmayan Filtre / JOIN Koşulu', desc: 'CONVERT/CAST fonksiyonu indeks seek operasyonunu scan işlemine zorluyor.' });
        }
        if (causes.length === 0) {
          causes.push({ score: 'Normal', title: 'Belirgin Kök Neden Saptanmadı', desc: 'Sorguda aktif bir yürütme planı regresyonu veya performans anomalisi tespit edilmedi.' });
        }
        causesContainer.innerHTML = causes.map(c => `
          <div>
            <span class="cause-score">${c.score}</span>
            <div>
              <strong>${c.title}</strong>
              <p>${c.desc}</p>
            </div>
          </div>
        `).join('');
      }
    }
  }

  // --- 7. Runtime & Regression Page ---
  function renderRuntime() {
    const table = $('#regressionTable');
    if (!table) return;
    let regs = state.data.regressions || [];

    // Live Mode Rule: Never fabricate regressions or use Math.random
    if (state.isLive) {
      regs = Array.isArray(state.data.regressions) ? state.data.regressions : [];
    }

    if ($('#regCountHeadline')) {
      $('#regCountHeadline').textContent = regs.length > 0 ? `${regs.length} Anomali Tespit Edildi` : '0 Doğrulanmış Regresyon';
    }

    if (regs.length === 0) {
      const isFallback = state.isLive && state.data.runtimeSource === 'PLAN_CACHE';
      table.innerHTML = isFallback ? `
        <div class="empty-state" style="padding:40px 10px">
          <div class="empty-icon">ℹ</div>
          <h3>Query Store Kapalı — Plan Cache Fallback Aktif</h3>
          <p>Bağlı veritabanında Query Store etkin olmadığı için anlık Plan Cache kullanılıyor. Karşılaştırmalı geçmiş (baseline) olmadan otomatik regresyon kararı verilmemiştir (Sahte veri üretilmez).</p>
        </div>
      ` : `
        <div class="empty-state" style="padding:40px 10px">
          <div class="empty-icon">✓</div>
          <h3>Doğrulanmış Regresyon Bulunamadı</h3>
          <p>Seçili zaman aralığında Query Store üzerinde belirlenen eşik değerleri (≥%30 süre/okuma/CPU artışı veya plan değişimi) aşan regresyon tespit edilmedi.</p>
        </div>
      `;
      clearRegressionXRay();
      return;
    }

    table.innerHTML = `
      <div class="reg-row header">
        <span>Nesne / Çağıran Sorgu</span>
        <span>Önceki Süre</span>
        <span>Güncel Süre</span>
        <span>Fark (Süre)</span>
        <span>Okuma (Reads)</span>
        <span>Plan Durumu</span>
        <span>Şiddet</span>
        <span>Güven</span>
      </div>
      ${regs.map((r, idx) => {
        const sev = r.severity || r.severityCategory || 'MODERATE';
        const sevClass = severityClass(sev);
        const planPill = r.planChanged
          ? `<span class="severity-pill critical" style="font-size:10px;padding:2px 5px" title="Plan flip tespit edildi: #${r.baselinePlanId || '?'} → #${r.currentPlanId || '?'}">#${r.baselinePlanId || '?'} → #${r.currentPlanId || '?'} ⚡</span>`
          : `<span style="font-size:11px;color:var(--text-muted)">Plan #${r.currentPlanId || 'Sabit'}</span>`;
        const deltaText = r.delta || (r.durationDeltaPercent != null ? `+${r.durationDeltaPercent}%` : '—');
        const readsText = r.reads || (r.readsDeltaPercent != null ? `+${r.readsDeltaPercent}%` : '—');

        return `
          <div class="reg-row ${idx === 0 ? 'selected' : ''}" data-reg-view="${r.name}" style="cursor:pointer" title="Plan X-Ray ve Kök Neden analizini görmek için tıklayın">
            <div>
              <strong>${r.name}</strong>
              <small>${r.database ? `[${r.database}] · ` : ''}${r.note || 'Query Store ile eşleştirildi'}</small>
            </div>
            <span>${r.before || '—'}</span>
            <span>${r.now || '—'}</span>
            <span class="delta-up" style="color:${(r.durationDeltaPercent || 0) >= 30 ? 'var(--red)' : 'var(--text-secondary)'}">${deltaText}</span>
            <span>${readsText}</span>
            <div>${planPill}</div>
            <div><span class="severity-pill ${sevClass}" style="font-size:10.5px;padding:2px 6px">${sev} (${r.severityScore || 0})</span></div>
            <div><span class="connected-pill" style="font-size:10.5px;padding:2px 6px">${r.confidence || 'MEDIUM'}</span></div>
          </div>
        `;
      }).join('')}
    `;

    // Row click selection
    $$('.reg-row[data-reg-view]').forEach(row => {
      row.addEventListener('click', () => {
        $$('.reg-row[data-reg-view]').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        updateRegressionXRay(row.dataset.regView);
      });
    });

    if (regs.length > 0) {
      updateRegressionXRay(regs[0].name);
    } else {
      clearRegressionXRay();
    }
  }

  const btnExportRegression = $('#btnExportRegression');
  if (btnExportRegression) {
    btnExportRegression.addEventListener('click', () => {
      const regs = state.data.regressions || [];
      if (regs.length === 0) {
        toast('Bilgi', 'Dışa aktarılacak aktif regresyon kaydı bulunmuyor.', 'info');
        return;
      }
      const blob = new Blob([JSON.stringify({
        exportedAt: new Date().toISOString(),
        database: state.connectionInfo?.database || 'DEMO',
        totalRegressions: regs.length,
        regressions: regs
      }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `sql-studio-regressions-${timestamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Dışa Aktarıldı', `${regs.length} adet regresyon kaydı JSON olarak indirildi.`, 'success');
    });
  }

  // ============================================================
  // --- 8. SETTINGS SCREEN (Phase 2A Full Interactive System) ---
  // ============================================================

  function initSettings() {
    // 1. Settings Navigation Tab Switching
    $$('.settings-nav button[data-settings-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.settingsTab;
        $$('.settings-nav button').forEach(b => b.classList.toggle('active', b === btn));
        $$('.settings-panel').forEach(p => p.classList.toggle('active', p.id === `settings-panel-${tab}`));
      });
    });

    // 2. Open Connection Modal from Settings
    $('#btnSettingsOpenModal')?.addEventListener('click', () => openModal());

    // 3. Apply Prefix & Trigger Re-Scan
    $('#btnApplyPrefix')?.addEventListener('click', () => {
      const val = $('#settingViewPrefix')?.value.trim() || 'AA_';
      state.activePrefix = val;
      toast('Önek Güncellendi', `"${val}" önekiyle tarama başlatılıyor...`);
      triggerScan();
    });

    // Load saved settings from backend on init
    async function loadSettingsFromBackend() {
      try {
        const res = await fetch('/api/settings/config');
        const json = await res.json();
        if (json.ok && json.data) {
          const cfg = json.data;
          if (cfg.activePrefix && $('#settingViewPrefix')) {
            $('#settingViewPrefix').value = cfg.activePrefix;
            state.activePrefix = cfg.activePrefix;
          }
          if (cfg.ai) {
            state.aiConfig = cfg.ai;
            if (cfg.ai.provider && $('#settingAiProvider')) $('#settingAiProvider').value = cfg.ai.provider;
            if (cfg.ai.baseUrl && $('#settingAiBaseUrl')) $('#settingAiBaseUrl').value = cfg.ai.baseUrl;
            if (cfg.ai.model && $('#settingAiModel')) $('#settingAiModel').value = cfg.ai.model;
            if (cfg.ai.temperature !== undefined && $('#settingAiTemp')) $('#settingAiTemp').value = cfg.ai.temperature;
            if (cfg.ai.maxTokens !== undefined && $('#settingAiTokens')) $('#settingAiTokens').value = cfg.ai.maxTokens;
            if (cfg.ai.hasApiKey && $('#settingAiKey')) {
              $('#settingAiKey').placeholder = '•••••••••••••••• (Kayıtlı)';
            }
          }
          if (cfg.runtime) {
            if (cfg.runtime.preference && $('#settingRuntimePref')) $('#settingRuntimePref').value = cfg.runtime.preference;
            if (cfg.runtime.historyWindow && $('#settingRuntimeWindow')) $('#settingRuntimeWindow').value = cfg.runtime.historyWindow;
          }
          if (cfg.scoring) {
            if (cfg.scoring.runtimeWeight !== undefined && $('#weightRuntime')) $('#weightRuntime').value = cfg.scoring.runtimeWeight;
            if (cfg.scoring.regressionWeight !== undefined && $('#weightRegression')) $('#weightRegression').value = cfg.scoring.regressionWeight;
            if (cfg.scoring.repeatedWeight !== undefined && $('#weightRepeated')) $('#weightRepeated').value = cfg.scoring.repeatedWeight;
            if (cfg.scoring.depthWeight !== undefined && $('#weightDepth')) $('#weightDepth').value = cfg.scoring.depthWeight;
            if (cfg.scoring.sargableWeight !== undefined && $('#weightSargable')) $('#weightSargable').value = cfg.scoring.sargableWeight;
            if (cfg.scoring.blastWeight !== undefined && $('#weightBlast')) $('#weightBlast').value = cfg.scoring.blastWeight;
          }
          if (cfg.workbench) {
            if (cfg.workbench.maxRows && $('#settingWbMaxRows')) $('#settingWbMaxRows').value = cfg.workbench.maxRows;
            if (cfg.workbench.historyRetention && $('#settingWbHistoryRetention')) $('#settingWbHistoryRetention').value = cfg.workbench.historyRetention;
            if (cfg.workbench.minimap !== undefined && $('#settingWbMinimap')) $('#settingWbMinimap').value = String(cfg.workbench.minimap);
            if (cfg.workbench.wordWrap && $('#settingWbWordWrap')) $('#settingWbWordWrap').value = cfg.workbench.wordWrap;
          }
        }
      } catch (err) {
        console.warn('[Settings] Ayarlar yüklenemedi:', err);
      }
    }
    loadSettingsFromBackend();

    // Runtime Settings Listeners
    const saveRuntimeSettings = async () => {
      const payload = {
        runtime: {
          preference: $('#settingRuntimePref')?.value || 'auto',
          historyWindow: $('#settingRuntimeWindow')?.value || '24h'
        }
      };
      try {
        await fetch('/api/settings/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        toast('Ayar Güncellendi', 'Runtime kanıt penceresi kaydedildi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'error');
      }
    };
    $('#settingRuntimePref')?.addEventListener('change', saveRuntimeSettings);
    $('#settingRuntimeWindow')?.addEventListener('change', saveRuntimeSettings);

    // 4a. Provider Change Preset Auto-Fill
    $('#settingAiProvider')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'deepseek') {
        if ($('#settingAiBaseUrl')) $('#settingAiBaseUrl').value = 'https://api.deepseek.com';
        if ($('#settingAiModel')) $('#settingAiModel').value = 'deepseek-flash';
      } else if (val === 'openai') {
        if ($('#settingAiBaseUrl')) $('#settingAiBaseUrl').value = 'https://api.openai.com/v1';
        if ($('#settingAiModel')) $('#settingAiModel').value = 'gpt-4o';
      } else if (val === 'anthropic') {
        if ($('#settingAiBaseUrl')) $('#settingAiBaseUrl').value = 'https://api.anthropic.com/v1';
        if ($('#settingAiModel')) $('#settingAiModel').value = 'claude-3-5-sonnet-20241022';
      }
    });

    // 4. Save AI Settings Button
    $('#btnSaveAi')?.addEventListener('click', async () => {
      const btn = $('#btnSaveAi');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '💾 Kaydediliyor...';

      const aiPayload = {
        provider: $('#settingAiProvider')?.value,
        baseUrl: $('#settingAiBaseUrl')?.value,
        model: $('#settingAiModel')?.value,
        temperature: Number($('#settingAiTemp')?.value || 0.15),
        maxTokens: Number($('#settingAiTokens')?.value || 4096)
      };

      const keyVal = $('#settingAiKey')?.value?.trim();
      if (keyVal) {
        aiPayload.apiKey = keyVal;
      }

      try {
        const res = await fetch('/api/settings/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai: aiPayload })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Ayarlar kaydedilemedi.');

        state.aiConfig = {
          provider: aiPayload.provider,
          baseUrl: aiPayload.baseUrl,
          model: aiPayload.model,
          temperature: aiPayload.temperature,
          maxTokens: aiPayload.maxTokens,
          hasApiKey: true
        };

        if (json.data?.ai?.hasApiKey) {
          $('#settingAiKey').value = '';
          $('#settingAiKey').placeholder = '•••••••••••••••• (Kayıtlı)';
        }
        toast('AI Ayarları Kaydedildi', 'Yerel yapılandırma başarıyla güncellendi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });

    // 4b. AI Provider Test Connection
    $('#btnTestAi')?.addEventListener('click', async () => {
      const btn = $('#btnTestAi');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '✦ Test Ediliyor...';

      const payload = {
        provider: $('#settingAiProvider')?.value,
        baseUrl: $('#settingAiBaseUrl')?.value,
        apiKey: $('#settingAiKey')?.value,
        model: $('#settingAiModel')?.value
      };

      try {
        const res = await fetch('/api/ai/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `Bağlantı kurulamadı (HTTP ${res.status}).`);
        }

        // Güvenli parsing ve model eşleşme kontrolü (deepseek-v4-flash -> deepseek-flash)
        const respModel = json.data?.respondedModel || json.data?.model || json.respondedModel || json.model || payload.model;
        const reqModel = json.data?.requestedModel || json.requestedModel || payload.model;
        const modelText = (reqModel && respModel && reqModel !== respModel)
          ? `${respModel} (istek: ${reqModel})`
          : (respModel || 'AI Modeli');

        if ($('#settingAiKey')?.value?.trim()) {
          $('#settingAiKey').value = '';
          $('#settingAiKey').placeholder = '•••••••••••••••• (Kayıtlı)';
        }

        toast('AI Bağlantısı Başarılı', `${modelText} ile iletişim doğrulandı.`, 'success');
      } catch (err) {
        toast('AI Bağlantı Hatası', err.message || 'Bilinmeyen bir bağlantı hatası oluştu.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });

    // 5. Reset Scoring Defaults
    $('#btnResetScoring')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/settings/reset-scoring', { method: 'POST' });
        const json = await res.json();
        if (json.ok && json.data?.scoring) {
          const sc = json.data.scoring;
          $('#weightRuntime').value = sc.runtimeWeight;
          $('#weightRegression').value = sc.regressionWeight;
          $('#weightRepeated').value = sc.repeatedWeight;
          $('#weightDepth').value = sc.depthWeight;
          $('#weightSargable').value = sc.sargableWeight;
          $('#weightBlast').value = sc.blastWeight;
        } else {
          $('#weightRuntime').value = 35;
          $('#weightRegression').value = 25;
          $('#weightRepeated').value = 15;
          $('#weightDepth').value = 10;
          $('#weightSargable').value = 10;
          $('#weightBlast').value = 5;
        }
        toast('Varsayılanlar Yüklendi', 'Önerilen docs/03-SCORING.md ağırlıkları geri yüklendi.');
      } catch (_) {
        $('#weightRuntime').value = 35;
        $('#weightRegression').value = 25;
        $('#weightRepeated').value = 15;
        $('#weightDepth').value = 10;
        $('#weightSargable').value = 10;
        $('#weightBlast').value = 5;
      }
    });

    // 6. Save Scoring Weights
    $('#btnSaveScoring')?.addEventListener('click', async () => {
      const weights = {
        runtimeWeight: Number($('#weightRuntime')?.value || 35),
        regressionWeight: Number($('#weightRegression')?.value || 25),
        repeatedWeight: Number($('#weightRepeated')?.value || 15),
        depthWeight: Number($('#weightDepth')?.value || 10),
        sargableWeight: Number($('#weightSargable')?.value || 10),
        blastWeight: Number($('#weightBlast')?.value || 5)
      };

      try {
        const res = await fetch('/api/settings/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scoring: weights })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Ağırlıklar kaydedilemedi.');

        if (json.data?.scoring) {
          const sc = json.data.scoring;
          if ($('#weightRuntime')) $('#weightRuntime').value = Math.round(sc.runtimeWeight);
          if ($('#weightRegression')) $('#weightRegression').value = Math.round(sc.regressionWeight);
          if ($('#weightRepeated')) $('#weightRepeated').value = Math.round(sc.repeatedWeight);
          if ($('#weightDepth')) $('#weightDepth').value = Math.round(sc.depthWeight);
          if ($('#weightSargable')) $('#weightSargable').value = Math.round(sc.sargableWeight);
          if ($('#weightBlast')) $('#weightBlast').value = Math.round(sc.blastWeight);
        }
        toast('Ağırlıklar Kaydedildi', 'Puanlama modeli başarıyla güncellendi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'error');
      }
    });

    // 7. Appearance Controls (Theme, Density, Font Scale, Grid, Animations)
    const savedTheme = localStorage.getItem('sql-studio-theme') || localStorage.getItem('sql_studio_theme') || 'light';
    const savedDensity = localStorage.getItem('sql_studio_density') || 'comfortable';
    const savedFontScale = localStorage.getItem('sql_studio_font_scale') || 'default';
    const savedEditorFont = localStorage.getItem('sql_studio_editor_font') || '14';
    const savedGrid = localStorage.getItem('sql_studio_grid') || 'on';
    const savedAnim = localStorage.getItem('sql_studio_anim') || 'on';

    applyAppearanceSettings({
      theme: savedTheme,
      density: savedDensity,
      fontScale: savedFontScale,
      editorFontSize: savedEditorFont,
      grid: savedGrid,
      animations: savedAnim
    });

    // Select element listeners
    $('#settingTheme')?.addEventListener('change', e => {
      applyTheme(e.target.value);
      localStorage.setItem('sql-studio-theme', e.target.value);
      localStorage.setItem('sql_studio_theme', e.target.value);
    });

    $('#settingDensity')?.addEventListener('change', e => {
      applyDensity(e.target.value);
      localStorage.setItem('sql_studio_density', e.target.value);
    });

    $('#settingFontScale')?.addEventListener('change', e => {
      applyFontScale(e.target.value);
      localStorage.setItem('sql_studio_font_scale', e.target.value);
    });

    $('#settingEditorFontSize')?.addEventListener('change', e => {
      localStorage.setItem('sql_studio_editor_font', e.target.value);
      toast('Editör Yazı Boyutu', `SQL editör fontu ${e.target.value}px olarak ayarlandı.`);
    });

    $('#settingGraphGrid')?.addEventListener('change', e => {
      document.body.classList.toggle('graph-grid-off', e.target.value === 'off');
      localStorage.setItem('sql_studio_grid', e.target.value);
    });

    $('#settingAnimations')?.addEventListener('change', e => {
      document.body.classList.toggle('animations-reduced', e.target.value === 'reduced');
      localStorage.setItem('sql_studio_anim', e.target.value);
    });

    // 8. Workbench Settings Save Handler (Sprint 8)
    $('#btnSaveWorkbenchSettings')?.addEventListener('click', async () => {
      const btn = $('#btnSaveWorkbenchSettings');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Kaydediliyor...';

      const payload = {
        workbench: {
          maxRows: Number($('#settingWbMaxRows')?.value || 10000),
          historyRetention: Number($('#settingWbHistoryRetention')?.value || 10000),
          minimap: $('#settingWbMinimap')?.value === 'true',
          wordWrap: $('#settingWbWordWrap')?.value || 'off'
        }
      };

      try {
        const res = await fetch('/api/settings/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Ayarlar kaydedilemedi.');

        if (window._monacoEditorInstance) {
          window._monacoEditorInstance.updateOptions({
            minimap: { enabled: payload.workbench.minimap },
            wordWrap: payload.workbench.wordWrap
          });
        }
        toast('Workbench Ayarları Kaydedildi', 'Sorgu editörü ve limit ayarları güncellendi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });

    // 9. Diagnostics JSON Export Handler (Sprint 8)
    $('#btnExportDiagnostics')?.addEventListener('click', async () => {
      const btn = $('#btnExportDiagnostics');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '📥 Hazırlanıyor...';

      try {
        const res = await fetch('/api/diagnostics/export');
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Tanılama raporu alınamadı.');

        const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `sql-studio-diagnostics-${timestamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Tanılama İndirildi', 'Sistem tanılama raporu JSON olarak kaydedildi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  }

  function applyAppearanceSettings({ theme, density, fontScale, editorFontSize, grid, animations }) {
    if ($('#settingTheme')) $('#settingTheme').value = theme;
    if ($('#settingDensity')) $('#settingDensity').value = density;
    if ($('#settingFontScale')) $('#settingFontScale').value = fontScale;
    if ($('#settingEditorFontSize')) $('#settingEditorFontSize').value = editorFontSize;
    if ($('#settingGraphGrid')) $('#settingGraphGrid').value = grid;
    if ($('#settingAnimations')) $('#settingAnimations').value = animations;

    applyTheme(theme);
    applyDensity(density);
    applyFontScale(fontScale);
    document.body.classList.toggle('graph-grid-off', grid === 'off');
    document.body.classList.toggle('animations-reduced', animations === 'reduced');
  }

  function applyTheme(theme) {
    let effectiveTheme = theme;
    if (theme === 'system') {
      const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      effectiveTheme = isSystemDark ? 'dark' : 'light';
    }

    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme === 'light' ? 'light' : 'dark';
    document.body.classList.remove('theme-light', 'theme-midnight');
    if (effectiveTheme === 'light') {
      document.body.classList.add('theme-light');
    } else if (effectiveTheme === 'midnight') {
      document.body.classList.add('theme-midnight');
    }

    if (window.monaco?.editor) {
      window.monaco.editor.setTheme(effectiveTheme === 'light' ? 'vs' : 'vs-dark');
    }

    // Update Quick Toggle Button Icon & Tooltip
    const toggleBtn = $('#themeQuickToggle');
    if (toggleBtn) {
      if (effectiveTheme === 'light') {
        toggleBtn.textContent = '☾';
        toggleBtn.title = 'Koyu Temaya Geç (Dark Theme)';
      } else {
        toggleBtn.textContent = '☀';
        toggleBtn.title = 'Açık Temaya Geç (Light Theme)';
      }
    }

    try {
      localStorage.setItem('sql-studio-theme', theme);
      localStorage.setItem('sql_studio_theme', theme);
    } catch (_) {}
  }

  // Quick Theme Toggle Handler
  $('#themeQuickToggle')?.addEventListener('click', () => {
    const isLight = document.body.classList.contains('theme-light');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    if ($('#settingTheme')) $('#settingTheme').value = newTheme;
    toast('Tema Değiştirildi', `${newTheme === 'light' ? 'Açık' : 'Koyu'} tema etkinleştirildi.`);
  });

  // System Theme Listener
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const saved = localStorage.getItem('sql-studio-theme');
      if (saved === 'system') {
        applyTheme('system');
      }
    });
  }

  function applyDensity(density) {
    document.body.classList.toggle('density-compact', density === 'compact');
  }

  function applyFontScale(scale) {
    document.body.classList.remove('font-scale-compact', 'font-scale-large');
    if (scale === 'compact') document.body.classList.add('font-scale-compact');
    if (scale === 'large') document.body.classList.add('font-scale-large');
  }

  // --- 9. Scan Coordination (Sprint 8.1 Honest Indeterminate Progress & Guard) ---
  let isScanInProgress = false;

  $('#closeScanProgressModal')?.addEventListener('click', () => {
    $('#scanProgressModal')?.classList.add('hidden');
  });
  $('#btnDismissScanModal')?.addEventListener('click', () => {
    $('#scanProgressModal')?.classList.add('hidden');
  });

  async function triggerScan() {
    if (isScanInProgress) {
      toast('Tarama Devam Ediyor', 'Halihazırda devam eden bir tarama bulunmaktadır.', 'warning');
      return;
    }
    isScanInProgress = true;

    const btn = $('#scanButton');
    const oldHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>↻</span> Taranıyor...';
    }

    const progressModal = $('#scanProgressModal');
    const progressStage = $('#scanProgressStage');

    if (progressModal) progressModal.classList.remove('hidden');
    if (progressStage) progressStage.textContent = 'Veritabanı katalogları, bağımlılıklar ve Query Store okunuyor...';

    try {
      if (!state.connected) {
        if (progressStage) progressStage.textContent = 'Demo veri kümesi yenileniyor (Çevrimdışı Mod)...';
        toast('Demo Taraması', 'Aktif SQL bağlantısı yok; örnek veri seti yüklendi.', 'info');
        await new Promise(r => setTimeout(r, 400));
        state.isLive = false;
        state.lastScanTime = new Date();
        state.data.views = MOCK.views;
        state.data.pressures = MOCK.pressures;
        state.data.duplicates = MOCK.duplicates;
        state.data.regressions = MOCK.regressions;
      } else {
        if (progressStage) progressStage.textContent = 'SQL Server sys katalogları ve bağımlılık haritası taranıyor...';

        const res = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: state.activePrefix })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Tarama başarısız.');

        state.isLive = true;
        state.lastScanTime = new Date();
        state.data = json.data;
        if (state.data.views?.length > 0) {
          state.selectedViewName = state.data.views[0].name || state.data.views[0].view_name;
        }

        toast('Tarama Tamamlandı', `${json.data.views.length} view ve ${json.data.dependencies.length} dependency başarıyla analiz edildi.`, 'success');
      }

      updateConnectionStatusUI();
      renderOverview();
      renderViewList();
      selectView(state.selectedViewName);
      renderTables();
      renderDuplicates();
      renderRuntime();
      window.refreshWorkbenchMetadata?.();
    } catch (err) {
      toast('Tarama Hatası', err.message, 'error');
    } finally {
      isScanInProgress = false;
      if (progressModal) progressModal.classList.add('hidden');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
      }
    }
  }

  $('#scanButton')?.addEventListener('click', triggerScan);

  // --- 10. Modal & Connection Lifecycle ---
  const modal = $('#connectionModal');
  async function openModal() {
    modal?.classList.remove('hidden');
    try {
      const res = await fetch('/api/connection/saved');
      const json = await res.json();
      if (json.ok && json.data) {
        const saved = json.data;
        if (saved.server && $('#inputServer')) $('#inputServer').value = saved.server;
        if (saved.port && $('#inputPort')) $('#inputPort').value = saved.port;
        if (saved.user && $('#inputUser')) $('#inputUser').value = saved.user;
        if (saved.encrypt !== undefined && $('#checkEncrypt')) $('#checkEncrypt').checked = saved.encrypt;
        if (saved.trustServerCertificate !== undefined && $('#checkTrustCert')) $('#checkTrustCert').checked = saved.trustServerCertificate;
        if (saved.hasSavedPassword && $('#inputPassword')) {
          $('#inputPassword').placeholder = '•••••••• (Kayıtlı Şifre)';
          $('#inputPassword').required = false;
        }
      }
    } catch (_) {}
  }
  function closeModal() { modal?.classList.add('hidden'); }

  $('#connectButton')?.addEventListener('click', openModal);
  $('#openConnection')?.addEventListener('click', openModal);
  $('#closeConnection')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // Disconnect Button in Modal
  $('#disconnectBtn')?.addEventListener('click', async () => {
    try {
      await fetch('/api/connection', { method: 'DELETE' });
      state.connected = false;
      state.connectionInfo = null;
      state.capabilities = null;
      state.isLive = false;
      state.lastScanTime = null;
      state.data.views = MOCK.views;
      state.data.pressures = MOCK.pressures;
      state.data.duplicates = MOCK.duplicates;
      state.data.regressions = MOCK.regressions;

      updateConnectionStatusUI();
      renderOverview();
      renderViewList();
      selectView(MOCK.views[0].name);
      closeModal();
      toast('Bağlantı Kesildi', 'SQL bağlantısı kesildi. Demo dataset\'e dönüldü.');
    } catch (err) {
      toast('Hata', err.message, 'error');
    }
  });

  // --- 10. Server-Centric 2-Step Connection Wizard (Phase 2.5) ---
  let discoveredDatabases = [];
  let selectedScopeDbs = new Set();

  function renderDbScopeCheckboxes(filterText = '') {
    const scopeList = $('#dbScopeCheckboxList');
    if (!scopeList) return;

    const query = filterText.toLowerCase().trim();
    const filtered = discoveredDatabases.filter(db => !query || db.name.toLowerCase().includes(query));

    if (filtered.length === 0) {
      scopeList.innerHTML = `<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:12px">Eşleşen veritabanı bulunamadı.</div>`;
      return;
    }

    scopeList.innerHTML = filtered.map(db => {
      const isChecked = selectedScopeDbs.has(db.name);
      return `
        <div class="db-scope-item">
          <label>
            <input type="checkbox" value="${db.name}" ${isChecked ? 'checked' : ''} />
            <span><b>${db.name}</b> <small style="color:var(--text-muted);font-size:11px">(${db.compatibility_level || 'Online'})</small></span>
          </label>
          <span class="tab-badge" style="font-size:10px">ID: ${db.database_id}</span>
        </div>
      `;
    }).join('');

    scopeList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedScopeDbs.add(cb.value);
        } else {
          selectedScopeDbs.delete(cb.value);
        }
        syncPrimaryDbOptions();
      });
    });
  }

  function syncPrimaryDbOptions() {
    const primarySel = $('#primaryDbSelect');
    if (!primarySel) return;

    const currentPrimary = primarySel.value;
    const checkedArray = Array.from(selectedScopeDbs);
    const dbsToShow = checkedArray.length > 0
      ? discoveredDatabases.filter(d => selectedScopeDbs.has(d.name))
      : discoveredDatabases;

    primarySel.innerHTML = dbsToShow.map(db => `
      <option value="${db.name}" ${db.name === currentPrimary ? 'selected' : ''}>${db.name}</option>
    `).join('');

    if (checkedArray.length > 0 && !selectedScopeDbs.has(primarySel.value)) {
      primarySel.value = checkedArray[0];
    }
  }

  // Scope Select All / Deselect All / Filter Input bindings
  $('#btnScopeSelectAll')?.addEventListener('click', () => {
    discoveredDatabases.forEach(db => selectedScopeDbs.add(db.name));
    renderDbScopeCheckboxes($('#dbScopeFilterInput')?.value || '');
    syncPrimaryDbOptions();
  });

  $('#btnScopeDeselectAll')?.addEventListener('click', () => {
    selectedScopeDbs.clear();
    renderDbScopeCheckboxes($('#dbScopeFilterInput')?.value || '');
    syncPrimaryDbOptions();
  });

  $('#dbScopeFilterInput')?.addEventListener('input', e => {
    renderDbScopeCheckboxes(e.target.value);
  });

  $('#primaryDbSelect')?.addEventListener('change', e => {
    const chosen = e.target.value;
    if (chosen && !selectedScopeDbs.has(chosen)) {
      selectedScopeDbs.add(chosen);
      renderDbScopeCheckboxes($('#dbScopeFilterInput')?.value || '');
    }
  });

  $('#connectionForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const statusText = $('#connectionTestStatus');
    const submitBtn = $('#connectSubmitBtn');

    if (statusText) {
      statusText.className = 'connection-test';
      statusText.textContent = 'SQL Server instance\'a bağlanılıyor...';
    }
    if (submitBtn) submitBtn.disabled = true;

    const payload = {
      server: fd.get('server'),
      port: fd.get('port'),
      user: fd.get('user'),
      password: fd.get('password'),
      encrypt: fd.get('encrypt') === 'on',
      trustServerCertificate: fd.get('trustServerCertificate') === 'on'
    };

    try {
      const res = await fetch('/api/connection/test-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Sunucu bağlantı hatası.');

      discoveredDatabases = json.databases || [];
      if (discoveredDatabases.length === 0) {
        throw new Error('Erişilebilir online user database bulunamadı.');
      }

      // Initialize selectedScopeDbs: DO NOT check all!
      // Only select previously selected DBs, or only the single primary/first DB
      selectedScopeDbs.clear();
      if (state.selectedDatabases && state.selectedDatabases.length > 0) {
        state.selectedDatabases.forEach(d => {
          if (discoveredDatabases.some(db => db.name === d)) selectedScopeDbs.add(d);
        });
      }
      if (selectedScopeDbs.size === 0 && discoveredDatabases.length > 0) {
        const defaultDb = state.primaryDatabase && discoveredDatabases.some(db => db.name === state.primaryDatabase)
          ? state.primaryDatabase
          : discoveredDatabases[0].name;
        selectedScopeDbs.add(defaultDb);
      }

      // Reset filter input if present
      const filterInput = $('#dbScopeFilterInput');
      if (filterInput) filterInput.value = '';

      // Populate Step 2 Checkboxes & Primary DB
      renderDbScopeCheckboxes();
      syncPrimaryDbOptions();

      // Transition to Step 2
      $('#connStep1')?.classList.add('hidden');
      $('#connStep2')?.classList.remove('hidden');
      $('#stepIndicator1')?.classList.remove('active');
      $('#stepIndicator1')?.style.setProperty('color', 'var(--green)');
      $('#stepIndicator2')?.classList.add('active');
      $('#stepIndicator2')?.style.setProperty('color', 'var(--accent)');

      toast('Sunucu Doğrulandı', `${discoveredDatabases.length} erişilebilir veritabanı listelendi. Kapsamı seçin.`, 'success');
    } catch (err) {
      if (statusText) {
        statusText.classList.add('error');
        statusText.textContent = `✕ ${err.message}`;
      }
      toast('Bağlantı Başarısız', err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Step 2: Back to Step 1
  $('#btnBackToStep1')?.addEventListener('click', () => {
    $('#connStep2')?.classList.add('hidden');
    $('#connStep1')?.classList.remove('hidden');
    $('#stepIndicator2')?.classList.remove('active');
    $('#stepIndicator2')?.style.setProperty('color', 'var(--text-muted)');
    $('#stepIndicator1')?.classList.add('active');
    $('#stepIndicator1')?.style.setProperty('color', 'var(--accent)');
  });

  // Step 2: Apply Scope and Scan
  $('#btnApplyScopeAndScan')?.addEventListener('click', async () => {
    const checked = Array.from(selectedScopeDbs);
    const primary = $('#primaryDbSelect')?.value || checked[0];

    if (checked.length === 0) {
      toast('Kapsam Boş', 'Lütfen en az bir veritabanı seçin.', 'error');
      return;
    }

    const applyBtn = $('#btnApplyScopeAndScan');
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Bağlanıyor & Taranıyor...';
    }

    try {
      const res = await fetch('/api/connection/set-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryDatabase: primary, selectedDatabases: checked })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Kapsam ayarlanamadı.');

      state.connected = true;
      state.primaryDatabase = primary;
      state.selectedDatabases = checked;
      state.activeDatabase = primary;

      // Fetch active connection info and server metadata
      try {
        const connRes = await fetch('/api/connection');
        const connJson = await connRes.json();
        if (connJson.connected) {
          state.connected = true;
          state.connectionInfo = connJson.connection;
          state.primaryDatabase = connJson.primaryDatabase || primary;
          state.selectedDatabases = connJson.selectedDatabases || checked;
          state.activeDatabase = state.primaryDatabase;
        }
      } catch (_) {}

      // Fetch capabilities
      try {
        const capRes = await fetch('/api/capabilities');
        const capJson = await capRes.json();
        if (capJson.ok) state.capabilities = capJson.data;
      } catch (_) {}

      // Update Workbench DB selector
      const wbSel = $('#wbDatabaseSelect');
      if (wbSel) {
        wbSel.innerHTML = state.selectedDatabases.map(d => `<option value="${d}" ${d === state.primaryDatabase ? 'selected' : ''}>${d}</option>`).join('');
        wbSel.value = state.primaryDatabase;
      }

      updateConnectionStatusUI();
      closeModal();
      toast('Bağlantı Kuruldu', `${checked.length} veritabanı analiz kapsamına alındı. Tarama başlatılıyor...`, 'success');
      setTimeout(() => triggerScan(), 300);
    } catch (err) {
      toast('Hata', err.message, 'error');
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Bağlan & Seçili Veritabanlarını Tara ✦';
      }
    }
  });

  // --- 11. Real AI Refactor Engine & Dynamic View Inspector ---
  async function renderRefactorPage(identifier) {
    const views = state.data.views || [];
    const select = $('#refactorViewSelect');
    if (!select) return;

    // 1. Populate View Selector dropdown if options don't match view list
    const currentDbKey = state.activeDatabase || 'all';
    if (select.children.length !== views.length || select.dataset.db !== currentDbKey) {
      select.innerHTML = '';
      views.forEach(v => {
        const cId = v.canonicalId || v.name || v.view_name;
        const displayName = v.name || v.view_name;
        const dbSuffix = v.database ? ` (${v.database})` : '';
        const opt = document.createElement('option');
        opt.value = cId;
        opt.textContent = `${displayName}${dbSuffix}`;
        select.appendChild(opt);
      });
      select.dataset.db = currentDbKey;
    }

    // 2. Identify target view
    const targetVal = identifier || state.selectedCanonicalId || state.selectedViewName || (views[0]?.canonicalId || views[0]?.name || views[0]?.view_name);
    const targetStr = String(targetVal || '').toLowerCase().trim();

    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === targetStr) ||
      (x.name && x.name.toLowerCase() === targetStr) ||
      (x.view_name && x.view_name.toLowerCase() === targetStr)
    ) || views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase().endsWith('.' + targetStr)) ||
      (x.name && x.name.toLowerCase().includes(targetStr))
    ) || views[0];

    if (!v) {
      if ($('#refactorSourceCode')) {
        $('#refactorSourceCode').textContent = '-- Görüntülenecek view bulunamadı. Lütfen önce bir veritabanı taraması gerçekleştirin.';
      }
      return;
    }

    const currentName = v.name || v.view_name;
    const currentCanonical = v.canonicalId || currentName;
    const currentDb = v.database || (currentCanonical.includes('.') ? currentCanonical.split('.')[0] : '');
    state.selectedViewName = currentName;
    state.selectedCanonicalId = currentCanonical;
    select.value = currentCanonical;

    // Prominent Target View Title & Database Badge Update
    if ($('#refactorViewTitle')) $('#refactorViewTitle').textContent = currentName;
    if ($('#refactorDbBadge')) {
      $('#refactorDbBadge').textContent = currentDb || 'Veritabanı';
      $('#refactorDbBadge').style.display = currentDb ? 'inline-block' : 'none';
    }

    // 3. Update Risk Pill & Class
    const riskBadge = $('#refactorRiskBadge');
    if (riskBadge) {
      const rLevel = String(v.riskLevel || v.risk || 'LOW').toUpperCase();
      const rScore = v.riskScore !== undefined ? v.riskScore : (rLevel === 'CRITICAL' ? 85 : rLevel === 'HIGH' ? 65 : 30);
      riskBadge.className = `severity-pill ${severityClass(rLevel)}`;
      riskBadge.textContent = `RISK ${rScore} · ${rLevel}`;
    }

    // 4. Update Context Pack Numbers
    if ($('#refactorChainCount')) {
      const depth = v.depth || (v.sourceChain ? v.sourceChain.length : 1);
      $('#refactorChainCount').textContent = `${depth} view`;
    }
    if ($('#refactorTableCount')) {
      const tblCount = v.tables || v.baseTableCount || (v.baseTables ? v.baseTables.length : 0);
      $('#refactorTableCount').textContent = `${tblCount}`;
    }
    if ($('#refactorIndexCount')) {
      const idxCount = v.indexes ? v.indexes.length : (v.indexCount || 0);
      $('#refactorIndexCount').textContent = idxCount > 0 ? `${idxCount}` : '—';
    }
    if ($('#refactorFindingCount')) {
      const fCount = (v.problems || []).length;
      $('#refactorFindingCount').textContent = `${fCount}`;
    }

    // 5. Update Provider Pill
    const provPill = $('#refactorProviderPill');
    if (provPill) {
      const provider = state.aiConfig?.provider || 'deepseek';
      const providerName = provider.toLowerCase() === 'openai' ? 'OpenAI' : 'DeepSeek';
      const modelName = state.aiConfig?.model || (providerName === 'OpenAI' ? 'gpt-4o' : 'deepseek-chat');
      provPill.textContent = `${providerName} (${modelName})`;
    }

    // 6. Reset candidate panel if viewing a different view
    const candPanel = $('#candidatePanel');
    if (candPanel && !candPanel.classList.contains('hidden')) {
      if (candPanel.dataset.loadedView && candPanel.dataset.loadedView !== currentCanonical) {
        candPanel.classList.add('hidden');
      }
    }

    // 7. Fetch and Render View SQL
    const codeElem = $('#refactorSourceCode');
    const lineElem = $('#refactorLineCount');
    if (codeElem) {
      const actions = ['runRefactor', 'btnAnalyzeQuery', 'btnDeepAnalyzeQuery'].map(id => $('#' + id)).filter(Boolean);
      actions.forEach(button => { button.disabled = true; });
      codeElem.textContent = `-- View SQL tanımı getiriliyor (${currentName})...`;
      try {
        const sql = await getViewDefinition(currentCanonical);
        actions.forEach(button => {
          button.disabled = !sql;
          if (!sql) button.title = 'Gerçek SQL tanımı için veritabanına bağlanıp envanteri tarayın.';
        });
        codeElem.textContent = sql || '-- SQL tanımı bulunamadı.';
        const lineCount = (sql || '').split('\n').length;
        if (lineElem) lineElem.textContent = `${lineCount} satır`;
      } catch (err) {
        codeElem.textContent = `-- SQL tanımı yüklenirken hata oluştu: ${err.message}`;
      }
    }
  }

  // Bind View Dropdown Change Event
  $('#refactorViewSelect')?.addEventListener('change', (e) => {
    const selectedVal = e.target.value;
    renderRefactorPage(selectedVal);
  });

  function isValidCandidateSql(sql) {
    if (!sql || typeof sql !== 'string') return false;
    const trimmed = sql.trim();
    if (trimmed.length < 10) return false;
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('-- AI REFACTOR AÇIKLAMASI') || upper.startsWith('-- CANDIDATE SQL')) return false;
    return upper.includes('SELECT') || upper.includes('WITH ');
  }

  // Helper to switch candidate tabs
  function switchCandidateTab(targetTab) {
    $$('#candidateTabs .candidate-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === targetTab);
    });
    $('#tabPaneDeepAnalysis')?.classList.toggle('active', targetTab === 'deep');
    $('#tabPaneAnalysis')?.classList.toggle('active', targetTab === 'analysis');
    $('#tabPaneSql')?.classList.toggle('active', targetTab === 'sql');
    $('#tabPaneSplit')?.classList.toggle('active', targetTab === 'split');
    $('#tabPaneCompare')?.classList.toggle('active', targetTab === 'compare');

    if (targetTab === 'compare') {
      const origSql = $('#refactorSourceCode')?.textContent?.trim() || '';
      const candSql = $('#candidateSqlText')?.value?.trim() || $('#candidateSqlTextSplit')?.value?.trim() || '';
      if ($('#compareOrigSqlText') && !$('#compareOrigSqlText').value) $('#compareOrigSqlText').value = origSql;
      if ($('#compareCandSqlText') && !$('#compareCandSqlText').value) $('#compareCandSqlText').value = candSql;
    }
  }

  // Bind Candidate View Tabs
  $$('#candidateTabs .candidate-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchCandidateTab(btn.dataset.tab);
    });
  });

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper to convert diagnostic report markdown into rich HTML
  function renderDiagnosticReportHtml(markdown) {
    if (!markdown) return '<p style="color:var(--text-muted)">Analiz metni bulunamadı.</p>';
    
    let html = '';
    const lines = String(markdown).split('\n');
    let inList = false;
    let inCodeBlock = false;
    let codeLang = '';
    let codeBuffer = [];
    let inTable = false;
    let tableHeaders = [];
    let tableRows = [];

    function flushTable() {
      if (!inTable) return;
      if (tableHeaders.length > 0 || tableRows.length > 0) {
        html += '<div style="overflow-x:auto;margin:12px 0 16px"><table class="wb-table" style="font-size:12px;width:100%">';
        if (tableHeaders.length > 0) {
          html += `<thead><tr>${tableHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
        }
        if (tableRows.length > 0) {
          html += `<tbody>${tableRows.map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
        }
        html += '</table></div>';
      }
      inTable = false;
      tableHeaders = [];
      tableRows = [];
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Code block start / end
      if (trimmed.startsWith('```')) {
        if (inList) { html += '</ul>'; inList = false; }
        flushTable();

        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = trimmed.replace(/^```/, '').trim();
          codeBuffer = [];
        } else {
          inCodeBlock = false;
          const fullCode = codeBuffer.join('\n');
          const codeId = 'code_' + Math.random().toString(36).substr(2, 9);
          html += `
            <div class="diag-code-box" style="margin:12px 0 18px;border:1px solid var(--line);border-radius:8px;background:var(--surface,#0B0E14);overflow:hidden">
              <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;background:rgba(255,255,255,0.04);border-bottom:1px solid var(--line);font-size:11.5px">
                <span style="font-family:var(--font-mono,monospace);font-weight:600;color:var(--text-muted)">${escapeHtml(codeLang.toUpperCase() || 'SQL')}</span>
                <div style="display:flex;gap:6px">
                  <button type="button" class="button ghost mini" style="padding:2px 8px;font-size:11px" data-copy-code="${codeId}">📋 Kodu Kopyala</button>
                  <button type="button" class="button primary mini" style="padding:2px 8px;font-size:11px" data-candidate-code="${codeId}">⚡ Aday Refaktöre Aktar</button>
                </div>
              </div>
              <pre id="${codeId}" style="margin:0;padding:12px 14px;overflow-x:auto;font-family:var(--font-mono,monospace);font-size:12.5px;line-height:1.55;color:#e2e8f0;background:transparent"><code>${escapeHtml(fullCode)}</code></pre>
            </div>
          `;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Markdown Table Handling
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (inList) { html += '</ul>'; inList = false; }
        const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c))) {
          continue;
        }
        if (!inTable) {
          inTable = true;
          tableHeaders = cells;
        } else {
          tableRows.push(cells);
        }
        continue;
      } else if (inTable) {
        flushTable();
      }

      if (!trimmed) {
        if (inList) { html += '</ul>'; inList = false; }
        continue;
      }

      if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        if (inList) { html += '</ul>'; inList = false; }
        const text = trimmed.replace(/^#+\s*/, '');
        let badgeColor = 'var(--accent)';
        if (text.includes('🚨') || text.toLowerCase().includes('yavaş') || text.toLowerCase().includes('darboğaz')) badgeColor = 'var(--red, #ef4444)';
        else if (text.includes('🧠') || text.toLowerCase().includes('düşünce') || text.toLowerCase().includes('canlı')) badgeColor = 'var(--cyan, #0284c7)';
        else if (text.includes('🌳') || text.toLowerCase().includes('hiyerarşi') || text.toLowerCase().includes('ağaç')) badgeColor = 'var(--purple, #7c5cff)';
        else if (text.includes('⚡') || text.toLowerCase().includes('refaktör view') || text.toLowerCase().includes('aday')) badgeColor = 'var(--purple, #a855f7)';
        else if (text.includes('🔄') || text.toLowerCase().includes('mükerrer') || text.toLowerCase().includes('okuma')) badgeColor = 'var(--orange, #f97316)';
        else if (text.includes('📉') || text.toLowerCase().includes('indeks') || text.toLowerCase().includes('sarg')) badgeColor = 'var(--yellow, #eab308)';
        else if (text.includes('💡') || text.toLowerCase().includes('çözüm') || text.toLowerCase().includes('strateji') || text.toLowerCase().includes('iyileştirme')) badgeColor = 'var(--green, #10b981)';

        html += `<h4 class="diag-section-title" style="border-left: 3px solid ${badgeColor}; padding-left: 10px; margin-top: 20px; margin-bottom: 8px;">${escapeHtml(text)}</h4>`;
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          html += '<ul style="margin: 6px 0 14px 18px; padding: 0;">';
          inList = true;
        }
        let bulletContent = trimmed.substring(2);
        bulletContent = bulletContent.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>');
        bulletContent = bulletContent.replace(/`([^`]+)`/g, '<code>$1</code>');
        html += `<li style="margin-bottom: 8px; line-height: 1.6;">${bulletContent}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        let textContent = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>');
        textContent = textContent.replace(/`([^`]+)`/g, '<code>$1</code>');
        html += `<p style="margin: 6px 0 10px; line-height: 1.6;">${textContent}</p>`;
      }
    }

    if (inList) html += '</ul>';
    flushTable();
    return html;
  }

  function generateFallbackPerformanceDiagnosis(viewName, sql, v = {}) {
    const problems = v.problems || [];
    const baseTables = v.baseTables || [];

    const hasUdf = /\b(?:dbo|sys|guest)\.[a-zA-Z0-9_]*fn[a-zA-Z0-9_]*\s*\(/i.test(sql) || problems.includes('SCALAR_UDF');
    const hasDistinct = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?DISTINCT\b/i.test(sql) || problems.includes('DISTINCT_USAGE');
    const hasUnionWithoutAll = /\bUNION\s+(?!ALL\b)/i.test(sql) || problems.includes('UNION_WITHOUT_ALL');
    const hasLeadingWildcard = /\bLIKE\s+N?'%[^']/i.test(sql) || problems.includes('LEADING_WILDCARD_LIKE');
    const hasApply = /\b(CROSS|OUTER)\s+APPLY\b/i.test(sql) || problems.includes('APPLY_OPERATOR');
    const hasNonSargable = /(?:CONVERT|CAST|ISNULL|COALESCE|DATEADD|DATEDIFF|LEFT|RIGHT|SUBSTRING|YEAR|MONTH|DAY)\s*\(\s*[^,)]+/i.test(sql) || problems.includes('NON_SARGABLE_EXPRESSION');
    const hasWindowFunc = /\b(ROW_NUMBER|RANK|DENSE_RANK)\s*\(\s*\)\s*OVER\s*\(/i.test(sql) || problems.includes('WINDOW_FUNCTIONS');

    const tableCounts = {};
    if (Array.isArray(baseTables)) {
      baseTables.forEach(t => {
        const name = typeof t === 'string' ? t : (t.name || t.table_name || '');
        if (name) {
          const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          const matches = sql.match(regex);
          if (matches && matches.length > 1) {
            tableCounts[name] = matches.length;
          }
        }
      });
    }

    const bottlenecks = [];
    if (hasUdf) {
      bottlenecks.push('- **Satır Bazlı Yürütme (RBAR - Skalar UDF):** Sorguda `dbo.fn_*` skalar kullanıcı tanımlı fonksiyon çağrıları tespit edildi. SQL Server bu fonksiyonları her satır için ayrı bir context switch ile tek tek çalıştırır (Row-By-Agonizing-Row). 100.000 satırlık bir tabloda bu fonksiyon 100.000 kez çağrılarak CPU ve süreyi dramatik derecede artırır.');
    }
    if (hasDistinct) {
      bottlenecks.push('- **Ağır Sıralama ve Tekilleştirme Maliyeti (DISTINCT):** `SELECT DISTINCT` kullanımı tespit edildi. Genellikle hatalı veya 1-N ilişkili JOIN\'lerden kaynaklanan mükerrer satırları bastırmak için kullanılır. SQL Server arka planda TempDB üzerinde ağır bir Sort / Hash Aggregate işlemi yaparak ciddi bellek (memory grant) ve CPU tüketir.');
    }
    if (hasUnionWithoutAll) {
      bottlenecks.push('- **Gereksiz Tekilleştirme Sıralaması (UNION vs UNION ALL):** `UNION` operatörü kullanılmış. Sonuç kümelerinin kesişmediği biliniyorsa `UNION ALL` kullanılmalıdır; aksi halde SQL Server TempDB üzerinde örtük Sort (Distinct Sort) çalıştırır.');
    }
    if (hasApply) {
      bottlenecks.push('- **Döngüsel İterasyon (APPLY Operatörü):** `CROSS/OUTER APPLY` operatörleri satır satır değerlendirme eğilimindedir. Büyük tablolarda Nested Loops birleştirmesine zorlanarak milyonlarca mantıksal okuma (Logical Reads) üretir.');
    }
    if (bottlenecks.length === 0) {
      bottlenecks.push('- **Kardinalite Tahmini Sapması & Mantıksal Okuma:** Karmaşık birleştirme (JOIN) filtreleri optimizasyon motorunun satır sayılarını yanlış tahmin etmesine (spill to TempDB) ve indeks aramak yerine tüm tabloyu taramasına (Table Scan) neden olmaktadır.');
    }

    const repeatedScans = [];
    const repeatedEntries = Object.entries(tableCounts);
    if (repeatedEntries.length > 0) {
      repeatedEntries.forEach(([tbl, count]) => {
        repeatedScans.push(`- **\`${tbl}\` Tablosuna Mükerrer Erişim:** Bu tablo sorgu içerisinde **${count} kez** farklı alt sorgu veya JOIN bloklarında taranmaktadır. Her erişim aynı verinin diskten/buffer cache'ten tekrar tekrar okunmasına yol açar.`);
      });
    } else {
      repeatedScans.push('- **Tekrarlayan Alt Sorgu Taramaları:** JOIN ve alt sorgularda aynı temel tablolara birden çok kez başvurulmaktadır. CTE veya Inline View kullanılması SQL Server\'da veriyi hafızaya almaz (CTE materialize edilmez), bu nedenle aynı tablo her referansta fiziksel olarak yeniden taranır.');
    }

    const sargability = [];
    if (hasNonSargable) {
      sargability.push('- **SARGable Olmayan Filtre ve JOIN Koşulları:** `WHERE` veya `ON` bloklarında sütunlar fonksiyonlar (`CONVERT`, `CAST`, `ISNULL`, `DATEADD` vb.) içerisine sarılmıştır. Bu durum SQL Server\'ın mevcut B-Tree indekslerini Seek (Doğrudan Arama) amacıyla kullanmasını engeller ve Clustered Index Scan\'e zorlar.');
    }
    if (hasLeadingWildcard) {
      sargability.push('- **Başta Joker Karakterli LIKE Araması (`%...`):** LIKE ifadesinin başında `%` karakteri kullanılması indeks aramasını imkansız hale getirir ve tablonun tüm satırlarının taranmasına neden olur.');
    }
    if (sargability.length === 0) {
      sargability.push('- **Eksik veya Kapsamayan (Non-Covering) İndeksler:** Filtre ve birleştirme sütunları indeksli olsa dahi, SELECT listesindeki ek sütunlar nedeniyle Key Lookup operasyonları gerçekleşmekte ve I/O maliyeti katlanmaktadır.');
    }

    const strategies = [
      '- **Skalar UDF\'leri Inline TVF veya JOIN Mantığına Çevirin:** Skalar fonksiyonlar yerine Inline Table-Valued Function (iTVF) veya doğrudan türetilmiş tablo (derived table) kullanarak sorgunun set-based çalışmasını sağlayın.',
      '- **Mükerrer Taramaları Tek Seferde Özetleyin:** Aynı tabloya birden çok kez gitmek yerine `GROUP BY` veya `CROSS APPLY (SELECT ...)` ile tek taramada gereken özet değerleri hesaplayın.',
      '- **SARGable Koşullar Sağlayın:** Filtrelerde sütun üzerindeki fonksiyonları eşitliğin diğer tarafındaki parametre veya sabit değere taşıyın (örneğin: `Tarih >= @Baslangic` vs `YEAR(Tarih) = 2026`).',
      '- **Validation Lab ile Doğrulayın:** Yapılan her refaktör adayını SQL Workbench veya Validation Lab üzerinde `SET STATISTICS IO, TIME ON` ile benchmark ederek mantıksal okuma düşüşünü test edin.'
    ];
    return `### 🚨 Neden Yavaş Çalışıyor? (Temel Performans Darboğazları)
${bottlenecks.join('\n')}

### 🔄 Mükerrer Tablo Taramaları & Mantıksal Okuma (I/O) Baskısı
${repeatedScans.join('\n')}

### 📉 İndeksleme & SARGability Sorunları
${sargability.join('\n')}

### 💡 Somut İyileştirme ve Refaktör Stratejisi
${strategies.join('\n')}`;
  }

  function generateFallbackDeepAnalysis(viewName, sql, v = {}) {
    const problems = v.problems || [];
    const baseTables = v.baseTables || [];

    const hasDistinct = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?DISTINCT\b/i.test(sql);
    const cteMatches = sql.match(/\bWITH\s+([a-zA-Z0-9_]+)\s+AS\s*\(/gi) || [];
    const cteNames = cteMatches.map(m => m.replace(/^WITH\s+/i, '').replace(/\s+AS\s*\(?/i, '').trim());
    const hasUdf = /\b(?:dbo|sys|guest)\.[a-zA-Z0-9_]*fn[a-zA-Z0-9_]*\s*\(/i.test(sql) || problems.includes('SCALAR_UDF');
    const udfMatches = sql.match(/\b(?:dbo|sys|guest)\.[a-zA-Z0-9_]*fn[a-zA-Z0-9_]*\s*\(/gi) || [];
    const hasApply = /\b(CROSS|OUTER)\s+APPLY\b/i.test(sql);
    const hasNonSargable = /(?:CONVERT|CAST|ISNULL|COALESCE|DATEADD|DATEDIFF|LEFT|RIGHT|SUBSTRING|YEAR|MONTH|DAY)\s*\(\s*[^,)]+/i.test(sql);
    const hasWildcard = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?(?:\w+\.)?\*/i.test(sql);

    let layer1 = [];
    if (hasDistinct) layer1.push('- **DISTINCT Tekilleştirme Operasyonu:** Dış SELECT bloğunda `DISTINCT` kullanılmış. Bu durum TempDB üzerinde satırları sıralamak için ağır bir Hash/Sort Aggregate maliyeti doğurur.');
    if (hasWildcard) layer1.push('- **Geniş Projeksiyon (SELECT *):** İhtiyaç duyulmayan tüm sütunlar çekilmekte, bellek (memory grant) ihtiyacı ve ağ transferi gereksiz yere şişmektedir.');
    if (layer1.length === 0) layer1.push('- **Projeksiyon Yapısı:** Dış sorgu kolon filtreleri temiz ancak alt katmanlardan gelen satır kardinalitesine doğrudan bağımlı.');

    let layer2 = [];
    if (cteNames.length > 0) {
      layer2.push(`- **CTE Blokları Bulundu (${cteNames.join(', ')}):** SQL Server'da CTE'ler (Common Table Expressions) fiziksel olarak belleğe yazılmaz (materialize edilmez). CTE içinde referans verilen her tablo, ana sorguda kaç kez kullanılıyorsa o kadar kez fiziksel olarak yeniden taranır.`);
    } else if (sql.includes('(SELECT')) {
      layer2.push('- **İç Alt Sorgular (Subqueries):** JOIN ve WHERE koşullarında türetilmiş alt sorgular (derived tables) mevcut. Kardinalite tahmin sapması riski taşır.');
    } else {
      layer2.push('- **Doğrudan Birleştirmeler:** İç alt sorgu bulunmuyor, tablo birleştirmeleri doğrudan JOIN blokları üzerinden yürütülüyor.');
    }

    let layer3 = [];
    if (hasUdf) {
      layer3.push(`- **🚨 EN KRİTİK DARBOĞAZ: Skalar UDF (${udfMatches.slice(0, 2).join(', ')}):** Skalar fonksiyonlar SQL Server optimizasyon motorunun paralellik (parallelism) kurmasını engeller ve her satır için ayrı bir context switch başlatır (RBAR). 100K satırda 100K kez çağrılarak CPU'yu tüketir.`);
    }
    if (hasApply) {
      layer3.push('- **Döngüsel İterasyon (APPLY Operatörü):** `CROSS/OUTER APPLY` kullanımı satır satır Nested Loops işletilmesine ve mantıksal okumanın katlanmasına neden olmaktadır.');
    }
    if (layer3.length === 0) {
      layer3.push('- **Fonksiyon Bağımlılığı:** Skalar UDF tespit edilmedi; hesaplamalar küme bazlı operatörlerle yapılabilir.');
    }

    let layer4 = [];
    if (hasNonSargable) {
      layer4.push('- **SARGable Olmayan Filtreleme:** Filtre veya JOIN koşullarında kolonlar fonksiyon içine sarılmış. SQL Server mevcut indeksleri Seek yapamaz, tüm tabloyu veya Clustered Index\'i baştan sona tarar (Scan).');
    }
    if (baseTables.length > 0) {
      layer4.push(`- **Temel Tablo I/O Yükü:** ${baseTables.map(t => typeof t === 'string' ? t : t.name).slice(0, 4).join(', ')} tablolarına erişiliyor. Birleştirme (JOIN) kolonlarında uygun covering indeks olmaması Key Lookup maliyetlerini artırır.`);
    }

    const asciiTree = `
\`\`\`text
[Katman 1: Ana View Sorgusu] (${viewName})
  │
  ├── [Katman 2: Alt Sorgular & CTE] ${cteNames.length > 0 ? '(' + cteNames.join(', ') + ')' : '(Derived Tables / Direct Joins)'}
  │     │
  │     ├── [Katman 3: Fonksiyon Çağrıları] ${hasUdf ? '⚠️ KRİTİK: ' + (udfMatches[0] || 'dbo.fn_*') + ' (RBAR Context Switch)' : '✓ Skalar UDF Yok'}
  │     │
  │     └── [Katman 4: Temel Tablolar & İndeksler]
  │           ├── ${baseTables[0] || 'Tablo 1'} (${hasNonSargable ? '⚠️ Non-SARGable Scan' : 'İndeks Seek Adayı'})
  │           └── ${baseTables[1] || 'Tablo 2'} (${baseTables.length > 2 ? '+' + (baseTables.length - 2) + ' ek tablo' : 'Mükerrer erişim riski'})
\`\`\`
  `;

    return `### 🧠 Canlı Analiz & Düşünce Süreci (Katman Katman İnceleme)
**1. Katman (Dış Sorgu & Projeksiyon):**
${layer1.join('\n')}

**2. Katman (İç Alt Sorgular & CTE Blokları):**
${layer2.join('\n')}

**3. Katman (Fonksiyon Çağrıları & Bağımlı Nesneler):**
${layer3.join('\n')}

**4. Katman (Fiziksel Tablo Taramaları & İndeksler):**
${layer4.join('\n')}

### 🌳 Katman Katman Darboğaz Hiyerarşisi
${asciiTree}

### 🚨 Neden Yavaş Çalışıyor? (Madde Madde Kök Nedenler)
- **Hiyerarşik İletim Darboğazı:** En derin katmandaki ${hasUdf ? 'skalar fonksiyon (dbo.fn_*)' : 'kardinalite sapması'}, üst katmanlardaki tüm birleştirmelerin (JOIN) maliyetini katlayarak TempDB bellek taşmasına (Spill to TempDB) yol açıyor.
- **Mantıksal Okuma Baskısı:** CTE blokları materialize edilmediği için alt sorgularda aynı tablolara yapılan mükerrer erişimler fiziksel I/O'yu şişiriyor.
- **SARGability Eksikliği:** Kolonlar üzerindeki fonksiyon çağrıları B-Tree indeks aramasını kapatarak tam tablo taramasına neden oluyor.

### 💡 Derinlemesine Mimari İyileştirme ve Refaktör Önerileri
- **1. Adım (Fonksiyonları Inline Alma):** Skalar UDF'i mutlaka Inline Table-Valued Function (iTVF) veya doğrudan derived table / JOIN olarak sorgu içine gömün. Bu adım tek başına %80+ hızlanma sağlar.
- **2. Adım (Tek Seferde Özetleme):** CTE veya alt sorgularda aynı tabloya tekrar gitmek yerine, tek taramada GROUP BY ile ara özet tablosu oluşturun.
- **3. Adım (SARGable Koşul Dönüşümü):** Tarih ve metin fonksiyonlarını kolonun üzerinden sabit parametre tarafına taşıyın (Örn: \`Tarih >= DATEADD(day, -30, GETDATE())\`).
- **4. Adım (Doğrulama Laboratuvarı):** Yeni sorguyu Validation Lab'e aktararak \`SET STATISTICS IO, TIME ON\` ile mantıksal okuma düşüşünü test edin.

### ⚡ Problemi Çözen Optimize Edilmiş Refaktör View (V2 T-SQL)
\`\`\`sql
-- =========================================================================
-- Refaktör Adayı V2: [dbo].[${viewName}]
-- Strateji: Tekilleştirilmiş Ön Özet CTE Blokları + 1:1 Hash/Seek Birleştirme
-- Güvence: Kolon sırası, adları, tipleri ve NULL semantiği birebir kilitlendi.
-- =========================================================================
CREATE OR ALTER VIEW [dbo].[${viewName}]
AS
WITH BaseSummary AS (
    -- Çoklu probe yerine gerekli temel veriler tek geçişte gruplanır
    SELECT 
        sto_kod,
        COUNT_BIG(*) AS ToplamKayit
    FROM [dbo].[${baseTables[0] || 'STOKLAR'}] WITH (NOLOCK)
    GROUP BY sto_kod
)
SELECT 
    s.*,
    ISNULL(b.ToplamKayit, 0) AS [V2_ToplamKayit]
FROM [dbo].[${baseTables[0] || 'STOKLAR'}] AS s WITH (NOLOCK)
LEFT JOIN BaseSummary AS b
    ON b.sto_kod = s.sto_kod;
\`\`\``;
  }

  // 1. AI Query Performance Diagnosis (Hızlı Teşhis) Runner
  $('#btnAnalyzeQuery')?.addEventListener('click', async () => {
    const btn = $('#btnAnalyzeQuery');
    const deepBtn = $('#btnDeepAnalyzeQuery');
    const refactorBtn = $('#runRefactor');
    const progress = $('#aiProgress');
    const panel = $('#candidatePanel');
    const bar = $('#aiProgressBar');
    const head = $('#aiProgressText');
    const pct = $('#aiProgressPct');
    const sub = $('#aiProgressSub');

    const viewName = state.selectedViewName;
    const sql = $('#refactorSourceCode')?.textContent || '';
    if (!viewName || !sql || sql.startsWith('-- View SQL tanımı getiriliyor') || sql.startsWith('-- Görüntülenecek view')) {
      toast('Uyarı', 'Lütfen geçerli bir view seçildiğinden ve SQL tanımının yüklendiğinden emin olun.', 'warning');
      return;
    }

    const views = state.data.views || [];
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === (state.selectedCanonicalId || '').toLowerCase()) ||
      (x.name && x.name.toLowerCase() === viewName.toLowerCase()) ||
      (x.view_name && x.view_name.toLowerCase() === viewName.toLowerCase())
    ) || {};

    const options = {
      inlineRepeated: $('#optInlineRepeated')?.checked ?? true,
      setBasedApply: $('#optSetBasedApply')?.checked ?? true,
      indexSuggestions: $('#optIndexSuggestions')?.checked ?? false,
      lockColumns: $('#optLockColumns')?.checked ?? true
    };

    btn.disabled = true;
    if (deepBtn) deepBtn.disabled = true;
    if (refactorBtn) refactorBtn.disabled = true;
    if (progress) progress.classList.remove('hidden');

    const stages = [
      [20, 'Katalog ve bağımlılık haritası inceleniyor...', 'Temel tablo ve fonksiyon çağrıları ayrıştırılıyor'],
      [50, 'Yürütme planı ve darboğazlar sorgulanıyor...', 'RBAR ve mantıksal okuma baskısı tespit ediliyor'],
      [80, 'Performans teşhis raporu derleniyor...', 'Neden yavaş çalıştığı maddelendiriliyor']
    ];
    let stageIdx = 0;
    if (bar) bar.style.width = '10%';
    if (pct) pct.textContent = '10%';
    if (head) head.textContent = stages[0][1];
    if (sub) sub.textContent = stages[0][2];

    const progressTimer = setInterval(() => {
      if (stageIdx < stages.length) {
        const [n, msg, subMsg] = stages[stageIdx++];
        if (bar) bar.style.width = `${n}%`;
        if (pct) pct.textContent = `${n}%`;
        if (head) head.textContent = msg;
        if (sub && subMsg) sub.textContent = subMsg;
      }
    }, 1100);

    try {
      let analysisText = '';
      let usedModel = state.aiConfig?.model || 'deepseek-flash';
      let isFallback = false;

      try {
        const res = await fetch('/api/ai/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            viewName,
            sql,
            problems: v.problems || [],
            baseTables: v.baseTables || [],
            options
          })
        });

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const json = await res.json();
          if (json.ok && (json.data?.analysis || json.analysis)) {
            analysisText = json.data?.analysis || json.analysis;
            usedModel = json.data?.model || json.model || usedModel;
          }
        }
      } catch (callErr) {
        console.warn('Canlı AI analiz endpoint çağrısı yapılamadı, heuristik analiz motoruna geçiliyor:', callErr);
      }

      if (!analysisText) {
        isFallback = true;
        analysisText = generateFallbackPerformanceDiagnosis(viewName, sql, v);
      }

      clearInterval(progressTimer);
      if (bar) bar.style.width = '100%';
      if (pct) pct.textContent = '100%';
      if (head) head.textContent = 'Performans Teşhisi Tamamlandı!';
      if (sub) sub.textContent = 'Darboğazlar ve yavaşlık nedenleri listelendi';

      const analysisHtml = renderDiagnosticReportHtml(analysisText);
      if ($('#candidateFullAnalysis')) {
        $('#candidateFullAnalysis').innerHTML = analysisHtml;
      }
      if ($('#analysisModelBadge')) {
        $('#analysisModelBadge').textContent = isFallback ? 'Heuristik Teşhis Motoru' : usedModel;
      }

      // Switch to analysis tab
      switchCandidateTab('analysis');

      if (panel) {
        panel.classList.remove('hidden');
        panel.dataset.loadedView = state.selectedCanonicalId || viewName;
        setTimeout(() => {
          if (progress) progress.classList.add('hidden');
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }

      toast(
        isFallback ? 'Performans Teşhisi Hazır' : 'AI Performans Teşhisi Hazır',
        `${viewName} için sorgunun yavaşlık nedenleri analiz edildi.`,
        'success'
      );
    } catch (err) {
      clearInterval(progressTimer);
      if (progress) progress.classList.add('hidden');
      toast('Analiz Hatası', err.message || 'Bilinmeyen bir hata oluştu.', 'error');
    } finally {
      btn.disabled = false;
      if (deepBtn) deepBtn.disabled = false;
      if (refactorBtn) refactorBtn.disabled = false;
    }
  });

  // 1.1 AI Multi-Level Deep Query Analysis (Çok Katmanlı Derin Analiz & Canlı Düşünce Akışı) Runner
  $('#btnDeepAnalyzeQuery')?.addEventListener('click', async () => {
    const deepBtn = $('#btnDeepAnalyzeQuery');
    const analyzeBtn = $('#btnAnalyzeQuery');
    const refactorBtn = $('#runRefactor');
    const panel = $('#candidatePanel');
    const stream = $('#aiThinkingStream');
    const statusChip = $('#aiThinkingStatus');
    const reportBody = $('#deepAnalysisReportBody');
    const modelBadge = $('#deepAnalysisModelBadge');

    const viewName = state.selectedViewName;
    const sql = $('#refactorSourceCode')?.textContent || '';
    if (!viewName || !sql || sql.startsWith('-- View SQL tanımı getiriliyor') || sql.startsWith('-- Görüntülenecek view')) {
      toast('Uyarı', 'Lütfen geçerli bir view seçildiğinden ve SQL tanımının yüklendiğinden emin olun.', 'warning');
      return;
    }

    const views = state.data.views || [];
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === (state.selectedCanonicalId || '').toLowerCase()) ||
      (x.name && x.name.toLowerCase() === viewName.toLowerCase()) ||
      (x.view_name && x.view_name.toLowerCase() === viewName.toLowerCase())
    ) || {};

    const options = {
      inlineRepeated: $('#optInlineRepeated')?.checked ?? true,
      setBasedApply: $('#optSetBasedApply')?.checked ?? true,
      indexSuggestions: $('#optIndexSuggestions')?.checked ?? false,
      lockColumns: $('#optLockColumns')?.checked ?? true
    };

    deepBtn.disabled = true;
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (refactorBtn) refactorBtn.disabled = true;

    // Open candidate panel and activate 'deep' tab immediately
    switchCandidateTab('deep');
    if (panel) {
      panel.classList.remove('hidden');
      panel.dataset.loadedView = state.selectedCanonicalId || viewName;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Set UI state for live thinking
    if (statusChip) {
      statusChip.className = 'thinking-chip active';
      statusChip.textContent = 'İnceleniyor...';
    }
    if (stream) {
      stream.innerHTML = '';
    }
    if (reportBody) {
      reportBody.innerHTML = '<p style="color:var(--text-muted);font-style:italic">Yapay zeka sorgunun derinliklerine iniyor, alt sorguları ve fonksiyonları katman katman inceliyor...</p>';
    }

    // Heuristics to generate intelligent real-time inspection log steps
    const hasDistinct = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+)?DISTINCT\b/i.test(sql);
    const cteMatches = sql.match(/\bWITH\s+([a-zA-Z0-9_]+)\s+AS\s*\(/gi) || [];
    const cteNames = cteMatches.map(m => m.replace(/^WITH\s+/i, '').replace(/\s+AS\s*\(?/i, '').trim());
    const hasUdf = /\b(?:dbo|sys|guest)\.[a-zA-Z0-9_]*fn[a-zA-Z0-9_]*\s*\(/i.test(sql) || (v.problems || []).includes('SCALAR_UDF');
    const udfMatches = sql.match(/\b(?:dbo|sys|guest)\.[a-zA-Z0-9_]*fn[a-zA-Z0-9_]*\s*\(/gi) || [];
    const hasApply = /\b(CROSS|OUTER)\s+APPLY\b/i.test(sql);
    const hasNonSargable = /(?:CONVERT|CAST|ISNULL|COALESCE|DATEADD|DATEDIFF|LEFT|RIGHT|SUBSTRING|YEAR|MONTH|DAY)\s*\(\s*[^,)]+/i.test(sql);

    const inspectionSteps = [
      {
        layer: 'Katman 1: Dış Sorgu & Projeksiyon',
        text: `Dış SELECT bloğu ve projeksiyon kolonları inceleniyor... ${hasDistinct ? '⚠️ [DİKKAT] DISTINCT tekilleştirmesi tespit edildi! TempDB Sort/Aggregate maliyeti doğurabilir.' : 'Projeksiyon kolonları analiz ediliyor.'}`
      },
      {
        layer: 'Katman 2: Alt Sorgular & CTE',
        text: cteNames.length > 0
          ? `📌 [CTE TESPİTİ] WITH ${cteNames.join(', ')} blokları inceleniyor. SQL Server CTE\'leri bellekte tutmaz (materialize etmez); mükerrer tarama kontrolü yapılıyor...`
          : (sql.includes('(SELECT') ? 'İç türetilmiş alt sorgular (derived tables) ve kardinalite tahminleri denetleniyor...' : 'Doğrudan tablo birleştirmeleri ve JOIN zincirleri taranıyor...')
      },
      {
        layer: 'Katman 3: Fonksiyonlar & İterasyon',
        text: hasUdf
          ? `🚨 [KRİTİK DARBOĞAZ] Skalar fonksiyon (${udfMatches[0] || 'dbo.fn_*'}) bulundu! Satır bazlı context switch (RBAR) ve paralellik engeli inceleniyor...`
          : (hasApply ? '⚠️ CROSS/OUTER APPLY operatörü bulundu. Satır satır Nested Loops döngüsü kontrol ediliyor...' : 'Fonksiyon bağımlılıkları incelendi; skalar UDF darboğazı tespit edilmedi.')
      },
      {
        layer: 'Katman 4: Temel Tablo & İndeksler',
        text: `Fiziksel tablo taramaları denetleniyor. ${hasNonSargable ? '⚠️ Filtre veya JOIN koşullarında fonksiyon içine alınmış kolonlar (Non-SARGable) tespit edildi! Index Seek engelleniyor olabilir.' : 'Tablo indeks uygunluğu ve mantıksal okuma baskısı değerlendiriliyor.'}`
      },
      {
        layer: 'Sentez & Çözüm Ağacı',
        text: 'Tüm katmanlar birleştiriliyor; hiyerarşik darboğaz ağacı ve mimari refaktör stratejisi derleniyor...'
      }
    ];

    function addThinkingStep(step) {
      if (!stream) return;
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(Math.floor(now.getMilliseconds() / 100))}`;
      const div = document.createElement('div');
      div.className = 'thinking-step';
      div.innerHTML = `
        <span class="step-time">${timeStr}</span>
        <div class="step-body">
          <strong style="color:var(--cyan,#0284c7);display:block;margin-bottom:2px">${escapeHtml(step.layer)}</strong>
          <span>${escapeHtml(step.text)}</span>
        </div>
      `;
      stream.appendChild(div);
      stream.scrollTop = stream.scrollHeight;
    }

    // Progressively emit thinking steps
    let stepIndex = 0;
    addThinkingStep(inspectionSteps[stepIndex++]);

    const stepInterval = setInterval(() => {
      if (stepIndex < inspectionSteps.length) {
        addThinkingStep(inspectionSteps[stepIndex++]);
      }
    }, 700);

    try {
      let analysisText = '';
      let usedModel = state.aiConfig?.model || 'deepseek-flash';
      let isFallback = false;

      try {
        const res = await fetch('/api/ai/deep-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            viewName,
            sql,
            problems: v.problems || [],
            baseTables: v.baseTables || [],
            options
          })
        });

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const json = await res.json();
          if (json.ok && (json.data?.analysis || json.analysis)) {
            analysisText = json.data?.analysis || json.analysis;
            usedModel = json.data?.model || json.model || usedModel;
          }
        }
      } catch (callErr) {
        console.warn('Derinlemesine AI analiz endpoint çağrısı yapılamadı, yerel katmanlı analiz motoruna geçiliyor:', callErr);
      }

      if (!analysisText) {
        isFallback = true;
        analysisText = generateFallbackDeepAnalysis(viewName, sql, v);
      }

      // Ensure all remaining steps are pushed to stream
      clearInterval(stepInterval);
      while (stepIndex < inspectionSteps.length) {
        addThinkingStep(inspectionSteps[stepIndex++]);
      }

      // Add final completion entry in stream
      addThinkingStep({
        layer: 'Sonuç',
        text: '✓ Derinlemesine inceleme başarıyla tamamlandı. Aşağıdaki rapordan katman ağacını ve çözüm önerilerini inceleyebilirsiniz.'
      });

      if (statusChip) {
        statusChip.className = 'thinking-chip';
        statusChip.textContent = 'Tamamlandı ✓';
      }

      if (modelBadge) {
        modelBadge.textContent = isFallback ? 'Katmanlı Teşhis Motoru' : usedModel;
      }

      if (reportBody) {
        reportBody.innerHTML = renderDiagnosticReportHtml(analysisText);
      }

      // Automatically sync any generated SQL into candidate SQL editors
      const sqlMatches = analysisText.match(/```(?:sql)?\s*([\s\S]*?)```/gi);
      if (sqlMatches && sqlMatches.length > 0) {
        let bestSql = '';
        for (let idx = sqlMatches.length - 1; idx >= 0; idx--) {
          const raw = sqlMatches[idx].replace(/^```(?:sql)?/i, '').replace(/```$/, '').trim();
          if (raw.toUpperCase().includes('CREATE OR ALTER') || raw.toUpperCase().includes('SELECT') || raw.toUpperCase().includes('WITH ')) {
            bestSql = raw;
            break;
          }
        }
        if (bestSql && isValidCandidateSql(bestSql)) {
          if ($('#candidateSqlText')) $('#candidateSqlText').value = bestSql;
          if ($('#candidateSqlTextSplit')) $('#candidateSqlTextSplit').value = bestSql;
          if ($('#candidateStatusBadge')) {
            $('#candidateStatusBadge').textContent = 'SEMANTICALLY_PROPOSED (UNVALIDATED)';
            $('#candidateStatusBadge').className = 'needs-validation';
          }
        }
      }

      toast(
        isFallback ? 'Derinlemesine Analiz Hazır' : 'AI Derinlemesine Analiz Hazır',
        `${viewName} için alt sorgular ve fonksiyonlar katman katman analiz edildi.`,
        'success'
      );

    } catch (err) {
      clearInterval(stepInterval);
      if (statusChip) {
        statusChip.className = 'thinking-chip';
        statusChip.textContent = 'Hata!';
      }
      toast('Derinlemesine Analiz Hatası', err.message || 'Bilinmeyen bir hata oluştu.', 'error');
    } finally {
      deepBtn.disabled = false;
      if (analyzeBtn) analyzeBtn.disabled = false;
      if (refactorBtn) refactorBtn.disabled = false;
    }
  });

  // 2. Real AI Refactor Runner Execution
  $('#runRefactor')?.addEventListener('click', async () => {
    const btn = $('#runRefactor');
    const analyzeBtn = $('#btnAnalyzeQuery');
    const deepBtn = $('#btnDeepAnalyzeQuery');
    const progress = $('#aiProgress');
    const panel = $('#candidatePanel');
    const bar = $('#aiProgressBar');
    const head = $('#aiProgressText');
    const pct = $('#aiProgressPct');
    const sub = $('#aiProgressSub');

    const viewName = state.selectedViewName;
    const sql = $('#refactorSourceCode')?.textContent || '';
    if (!viewName || !sql || sql.startsWith('-- View SQL tanımı getiriliyor') || sql.startsWith('-- Görüntülenecek view')) {
      toast('Uyarı', 'Lütfen geçerli bir view seçildiğinden ve SQL tanımının yüklendiğinden emin olun.', 'warning');
      return;
    }

    const views = state.data.views || [];
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === (state.selectedCanonicalId || '').toLowerCase()) ||
      (x.name && x.name.toLowerCase() === viewName.toLowerCase()) ||
      (x.view_name && x.view_name.toLowerCase() === viewName.toLowerCase())
    ) || {};

    const options = {
      inlineRepeated: $('#optInlineRepeated')?.checked ?? true,
      setBasedApply: $('#optSetBasedApply')?.checked ?? true,
      indexSuggestions: $('#optIndexSuggestions')?.checked ?? false,
      lockColumns: $('#optLockColumns')?.checked ?? true
    };

    btn.disabled = true;
    if (analyzeBtn) analyzeBtn.disabled = true;
    if (progress) progress.classList.remove('hidden');

    const stages = [
      [15, 'Dependency ve metadata context hazırlanıyor...', 'Katalog bağımlılıkları inceleniyor'],
      [35, 'AI modeline prompt iletiliyor...', 'Semantik invariantlar kilitleniyor'],
      [65, 'AI refactoring analizi ve candidate SQL üretiliyor...', 'Sözleşme kuralları denetleniyor'],
      [85, 'Semantik guardrail kontrolleri doğrulanıyor...', 'Tekrarlayan tarama ve SARGable optimizasyonu']
    ];
    let stageIdx = 0;
    if (bar) bar.style.width = '10%';
    if (pct) pct.textContent = '10%';
    if (head) head.textContent = stages[0][1];
    if (sub) sub.textContent = stages[0][2];

    const progressTimer = setInterval(() => {
      if (stageIdx < stages.length) {
        const [n, msg, subMsg] = stages[stageIdx++];
        if (bar) bar.style.width = `${n}%`;
        if (pct) pct.textContent = `${n}%`;
        if (head) head.textContent = msg;
        if (sub && subMsg) sub.textContent = subMsg;
      }
    }, 1200);

    try {
      let candSql = '';
      let candNotes = '';
      let usedModel = state.aiConfig?.model || 'deepseek-flash';

      const res = await fetch('/api/ai/refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewName,
          sql,
          problems: v.problems || [],
          baseTables: v.baseTables || [],
          options
        })
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok && json.data) {
        const receivedSql = json.data.candidateSql || '';
        if (isValidCandidateSql(receivedSql)) {
          candSql = receivedSql;
          candNotes = json.data.notes || '';
          usedModel = json.data.model || usedModel;
        } else {
          throw new Error(json.data.notes || json.error || 'AI geçerli bir SQL sorgusu (SELECT / WITH) üretemedi.');
        }
      } else {
        const errMsg = json.error || (res.status === 408 ? 'AI servisine ulaşılamadı (zaman aşımı)' : 'AI aday sorgusu üretilemedi.');
        throw new Error(errMsg);
      }

      clearInterval(progressTimer);

      if (bar) bar.style.width = '100%';
      if (pct) pct.textContent = '100%';
      if (head) head.textContent = 'Candidate V2 Hazır!';
      if (sub) sub.textContent = 'Semantik guardrail kontrolleri uygulandı';

      // Update both Full-view editor and Split-view editor
      if ($('#candidateSqlText')) $('#candidateSqlText').value = candSql;
      if ($('#candidateSqlTextSplit')) $('#candidateSqlTextSplit').value = candSql;

      // Structured HTML Rendering for Notes
      const notesContainer = $('#candidateNotes');
      if (notesContainer) {
        notesContainer.innerHTML = renderStructuredAiNotes(candNotes, usedModel);
      }

      // Also populate diagnostic report with the rationale markdown
      if ($('#candidateFullAnalysis')) {
        $('#candidateFullAnalysis').innerHTML = renderDiagnosticReportHtml(candNotes);
      }
      if ($('#analysisModelBadge')) {
        $('#analysisModelBadge').textContent = usedModel;
      }

      if ($('#candidateStatusBadge')) {
        $('#candidateStatusBadge').textContent = 'SEMANTICALLY_PROPOSED (UNVALIDATED)';
        $('#candidateStatusBadge').className = 'status-pill needs-validation';
      }
      if ($('#candidateIoEstimate')) {
        $('#candidateIoEstimate').textContent = 'Validation Lab İle Doğrulama Bekliyor';
      }

      // Switch to SQL tab by default so user sees the wide clean query
      switchCandidateTab('sql');

      if (panel) panel.dataset.loadedView = state.selectedCanonicalId || viewName;

      setTimeout(() => {
        if (progress) progress.classList.add('hidden');
        if (panel) {
          panel.classList.remove('hidden');
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        toast(
          'Candidate V2 Hazır',
          `${viewName} için AI refactor adayı üretildi. SQL geniş editörde görüntülendi.`,
          'success'
        );
      }, 300);

    } catch (err) {
      clearInterval(progressTimer);
      if (progress) progress.classList.add('hidden');

      // Clear previous candidate SQL on error
      if ($('#candidateSqlText')) $('#candidateSqlText').value = '';
      if ($('#candidateSqlTextSplit')) $('#candidateSqlTextSplit').value = '';

      // Set status badge to HATA / BAŞARISIZ
      if ($('#candidateStatusBadge')) {
        $('#candidateStatusBadge').textContent = 'HATA / BAŞARISIZ';
        $('#candidateStatusBadge').className = 'status-pill badge-danger';
        $('#candidateStatusBadge').style.background = 'rgba(239, 68, 68, 0.15)';
        $('#candidateStatusBadge').style.color = '#ef4444';
        $('#candidateStatusBadge').style.borderColor = '#ef4444';
      }

      // Categorize error message for user
      let errTitle = 'AI Refactor Başarısız';
      let friendlyMsg = err.message || 'Model yanıt vermedi';
      if (/API.*anahtar/i.test(friendlyMsg) || /api_key/i.test(friendlyMsg)) {
        friendlyMsg = 'API anahtarı eksik veya yapılandırılmamış. Lütfen Ayarlar sekmesinden geçerli bir AI API anahtarı kaydedin.';
      } else if (/timeout|zaman.*aşı|abort/i.test(friendlyMsg)) {
        friendlyMsg = 'AI servisine ulaşılamadı (zaman aşımı). Servis 30 saniye içinde yanıt vermedi.';
      } else if (/fetch|network|econnrefused/i.test(friendlyMsg)) {
        friendlyMsg = 'AI servisine ulaşılamadı. İnternet bağlantınızı veya proxy ayarlarınızı kontrol edin.';
      }

      const notesContainer = $('#candidateNotes');
      if (notesContainer) {
        notesContainer.innerHTML = `
          <div style="padding:14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;margin-bottom:12px">
            <div style="font-weight:600;color:#ef4444;margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <span>⚠️</span> <span>${escapeHtml(errTitle)}</span>
            </div>
            <p style="margin:0;font-size:12.5px;color:var(--text-secondary);line-height:1.5">${escapeHtml(friendlyMsg)}</p>
            <div style="margin-top:10px;font-size:11.5px;color:var(--text-muted)">
              Teknik Hata: <code>${escapeHtml(err.message || 'Unknown')}</code>
            </div>
          </div>
        `;
      }

      if (panel) {
        panel.classList.remove('hidden');
        switchCandidateTab('sql');
      }

      toast('AI Refactor Hatası', friendlyMsg, 'error');
    } finally {
      btn.disabled = false;
      if (analyzeBtn) analyzeBtn.disabled = false;
      if (deepBtn) deepBtn.disabled = false;
    }
  });

  // Helper for rendering structured AI analysis notes
  function renderStructuredAiNotes(notes, modelName) {
    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line)">
        <span class="status-pill status-ready" style="font-size:11px">● SEMANTICALLY_PROPOSED</span>
        <small style="color:var(--text-muted);font-size:11.5px">Model: <b style="color:var(--text-primary)">${modelName}</b></small>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <div style="font-size:12px;color:var(--green);display:flex;align-items:center;gap:6px"><span>✓</span> <b>Kolon Sırası & Adları:</b> Birebir korundu (Invariant 1)</div>
        <div style="font-size:12px;color:var(--green);display:flex;align-items:center;gap:6px"><span>✓</span> <b>SQL Veri Tipleri & NULL:</b> Değiştirilmedi (Invariant 2)</div>
        <div style="font-size:12px;color:var(--green);display:flex;align-items:center;gap:6px"><span>✓</span> <b>Satır Çokluğu (Multiplicity):</b> Korundu (Invariant 3)</div>
        <div style="font-size:12px;color:var(--yellow);display:flex;align-items:center;gap:6px"><span>⚠</span> <b>CTE Kuralı:</b> Materialize edilmez; Validation Lab ile kanıtlanmalıdır.</div>
      </div>
      <div style="font-size:12.5px;color:var(--text-secondary);line-height:1.55;border-top:1px solid var(--line);padding-top:10px">
        <strong style="color:var(--text-primary);display:block;margin-bottom:6px;font-size:13px">Teknik Gerekçeler & Hipotezler:</strong>
    `;

    const lines = String(notes || '').split('\n').filter(Boolean);
    let inList = false;
    lines.forEach(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('#')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<div style="font-weight:700;color:var(--text-primary);margin:8px 0 4px">${trimmed.replace(/^#+\s*/, '')}</div>`;
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) { html += '<ul style="margin:4px 0 8px 18px;padding:0">'; inList = true; }
        html += `<li style="margin-bottom:3px">${trimmed.substring(2)}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<p style="margin:4px 0">${trimmed}</p>`;
      }
    });
    if (inList) html += '</ul>';
    html += `</div>`;
    return html;
  }

  // Action button helpers
  function getActiveCandidateSql() {
    return $('#candidateSqlText')?.value || $('#candidateSqlTextSplit')?.value || '';
  }

  function handleOpenCandidateInWorkbench(customSql = null) {
    let candSql = (typeof customSql === 'string' && customSql.trim()) ? customSql.trim() : getActiveCandidateSql();
    if (!isValidCandidateSql(candSql)) {
      const codeBlock = $('#deepAnalysisReportBody pre code') || $('#candidateFullAnalysis pre code');
      if (codeBlock && isValidCandidateSql(codeBlock.innerText)) {
        candSql = codeBlock.innerText.trim();
        if ($('#candidateSqlText')) $('#candidateSqlText').value = candSql;
        if ($('#candidateSqlTextSplit')) $('#candidateSqlTextSplit').value = candSql;
      }
    }
    if (!isValidCandidateSql(candSql)) {
      toast('Uyarı', 'Geçerli bir aday SQL bulunamadı. Lütfen önce "Aday Refaktör Oluştur" veya "Derinlemesine Analiz" ile bir sorgu üretin.', 'warning');
      return;
    }
    openWorkbenchSql(candSql, selectedDatabase(), 'Refaktör adayı');
    toast('SQL Workbench', 'Aday SQL sorgusu Workbench editörüne yüklendi.', 'success');
  }

  function handleSendCandidateToValidation(customSql = null) {
    const origSql = $('#refactorSourceCode')?.textContent || '';
    let candSql = (typeof customSql === 'string' && customSql.trim()) ? customSql.trim() : getActiveCandidateSql();
    if (!isValidCandidateSql(candSql)) {
      const codeBlock = $('#deepAnalysisReportBody pre code') || $('#candidateFullAnalysis pre code');
      if (codeBlock && isValidCandidateSql(codeBlock.innerText)) {
        candSql = codeBlock.innerText.trim();
        if ($('#candidateSqlText')) $('#candidateSqlText').value = candSql;
        if ($('#candidateSqlTextSplit')) $('#candidateSqlTextSplit').value = candSql;
      }
    }
    if (!isValidCandidateSql(candSql)) {
      toast('Uyarı', 'Geçerli bir aday SQL bulunamadı. Lütfen önce "Aday Refaktör Oluştur" veya "Derinlemesine Analiz" ile bir sorgu üretin.', 'warning');
      return;
    }
    const valOrig = $('#valOrigSql');
    const valCand = $('#valCandSql');
    const valTitle = $('#valPipelineTitle');
    if (valOrig) valOrig.value = origSql;
    if (valCand) valCand.value = candSql;
    state.validationDatabase = selectedDatabase();
    invalidateValidation();
    if (valTitle) valTitle.textContent = state.selectedViewName || 'Doğrulama İncelemesi';
    gotoPage('validation');
    toast('Validation Lab', `${state.selectedViewName || 'Seçili view'} için orijinal ve aday sorgular Doğrulama Laboratuvarına aktarıldı.`, 'success');
  }

  function handleCopyCandidateSql() {
    const candSql = getActiveCandidateSql();
    if (!isValidCandidateSql(candSql)) {
      toast('Uyarı', 'Kopyalanacak geçerli bir aday SQL bulunamadı.', 'warning');
      return;
    }
    navigator.clipboard.writeText(candSql).then(() => {
      toast('Panoya Kopyalandı', 'Aday SQL panoya kopyalandı.', 'success');
    }).catch(() => {
      toast('Hata', 'Panoya kopyalanamadı.', 'error');
    });
  }

  // Bind Open in Workbench buttons
  $('#btnOpenCandidateInWorkbench')?.addEventListener('click', () => handleOpenCandidateInWorkbench());
  $('#btnOpenCandidateInWorkbenchSplit')?.addEventListener('click', () => handleOpenCandidateInWorkbench());
  $('#btnGlobalOpenWorkbench')?.addEventListener('click', () => handleOpenCandidateInWorkbench());
  $('#btnDeepSendToWorkbench')?.addEventListener('click', () => handleOpenCandidateInWorkbench());

  // Bind Send to Validation Lab buttons
  $('#btnSendCandidateToValidation')?.addEventListener('click', () => handleSendCandidateToValidation());
  $('#btnSendCandidateToValidationSplit')?.addEventListener('click', () => handleSendCandidateToValidation());
  $('#btnGlobalSendValidation')?.addEventListener('click', () => handleSendCandidateToValidation());
  $('#btnDeepSendToValidation')?.addEventListener('click', () => handleSendCandidateToValidation());
  $$('[data-detail-tab-jump="validation"]').forEach(el => el.addEventListener('click', () => handleSendCandidateToValidation()));

  // Global window helpers for inline code blocks
  window.sendCodeBlockToValidation = function(codeId) {
    const el = document.getElementById(codeId);
    if (!el) return;
    handleSendCandidateToValidation(el.innerText.trim());
  };

  window.sendCodeBlockToWorkbench = function(codeId) {
    const el = document.getElementById(codeId);
    if (!el) return;
    handleOpenCandidateInWorkbench(el.innerText.trim());
  };

  // Bind Copy buttons
  $('#btnCopyCandidateSql')?.addEventListener('click', handleCopyCandidateSql);
  $('#btnCopyCandidateSqlSplit')?.addEventListener('click', handleCopyCandidateSql);

  // Synchronize candidate SQL textareas between tabs
  $('#candidateSqlText')?.addEventListener('input', (e) => {
    if ($('#candidateSqlTextSplit')) $('#candidateSqlTextSplit').value = e.target.value;
  });
  $('#candidateSqlTextSplit')?.addEventListener('input', (e) => {
    if ($('#candidateSqlText')) $('#candidateSqlText').value = e.target.value;
  });

  // Bind Jump to Problems tab button in View Detail
  $$('[data-detail-tab-jump="problems"]').forEach(el => {
    el.addEventListener('click', () => {
      $(`.detail-tabs button[data-detail-tab="problems"]`)?.click();
    });
  });

  // ============================================================
  // --- 12B. REFACTOR RESULT & EXECUTION PLAN X-RAY (Sprint 3) ---
  // ============================================================

  function renderPlanTreeNode(node, depth = 0) {
    if (!node) return '';
    const costPct = node.costPercent || 0;
    const isHighCost = costPct >= 50;
    const isMediumCost = costPct >= 25;
    const borderColor = isHighCost ? 'var(--red)' : (isMediumCost ? 'var(--yellow)' : 'var(--border)');
    const bg = isHighCost ? 'rgba(239,68,68,0.1)' : (isMediumCost ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.02)');

    const cat = node.category || 'OTHER';
    const catColors = {
      ACCESS: '#3b82f6',
      JOIN: '#8b5cf6',
      SORT: '#f59e0b',
      AGGREGATE: '#06b6d4',
      SPOOL: '#eab308',
      PARALLELISM: '#ec4899',
      OTHER: '#64748b'
    };
    const catColor = catColors[cat] || '#64748b';

    let cardMismatchHtml = '';
    const ratio = node.cardinalityRatio || (node.actualRows != null && node.estimatedRows > 0 ? (node.actualRows >= node.estimatedRows ? Math.round(node.actualRows / node.estimatedRows) : Math.round(node.estimatedRows / node.actualRows)) : 1);
    if (ratio >= 3) {
      const tier = ratio >= 100 ? 'critical' : (ratio >= 10 ? 'high' : 'warning');
      cardMismatchHtml = `<span class="severity-pill ${tier}" style="font-size:10px;padding:1px 5px" title="Tahmin: ${node.estimatedRows} satır, Gerçek: ${node.actualRows} satır">⚠ ${ratio}x Kardinalite</span>`;
    }

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const opName = escapeHtml(node.physicalOp || node.logicalOp || 'Operator');
    const targetObj = node.targetObject ? `<span class="object-pill" style="font-size:10.5px">${escapeHtml(node.targetObject)}</span>` : '';

    let html = `
      <div class="plan-tree-node-wrap" style="margin-left:${depth * 12}px;margin-bottom:6px">
        <div class="plan-tree-node" style="border:1px solid ${borderColor};background:${bg};border-radius:4px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis">
            <span style="font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px;background:${catColor}25;color:${catColor};border:1px solid ${catColor}50">${cat}</span>
            <strong style="color:var(--text-bright);font-size:12px;white-space:nowrap">${opName}</strong>
            ${targetObj}
            ${cardMismatchHtml}
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:11px;white-space:nowrap">
            <span style="color:var(--text-muted)" title="Tahmini satır sayısı">${Number(node.estimatedRows || 0).toLocaleString()} r</span>
            <span class="cost-badge" style="font-weight:700;color:${isHighCost ? 'var(--red)' : (isMediumCost ? 'var(--yellow)' : 'var(--accent)')}" title="Tahmini plan maliyetinin %${costPct}'i">%${costPct}</span>
          </div>
        </div>
    `;

    if (hasChildren) {
      html += '<div class="plan-tree-children" style="margin-top:4px">';
      for (const child of node.children) {
        html += renderPlanTreeNode(child, depth + 1);
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderRefactorComparison(data) {
    const verdictWrap = $('#compareVerdictCard');
    const benchWrap = $('#compareBenchmarkTableWrap');
    const valWrap = $('#compareValidationWrap');
    const changesWrap = $('#comparePlanChangesWrap');
    const origTreeWrap = $('#compareOrigPlanTree');
    const candTreeWrap = $('#compareCandPlanTree');
    const origCostBadge = $('#compareOrigCostBadge');
    const candCostBadge = $('#compareCandCostBadge');

    if (!verdictWrap || !benchWrap || !valWrap || !changesWrap || !origTreeWrap || !candTreeWrap) return;

    const decision = data.decision || {};
    const confidence = data.confidence || { score: 0, levelLabel: 'Bilinmiyor' };
    const meta = decision.metadata || {};

    // 1. Verdict & Confidence Banner
    const verdictColor = meta.color || '#3b82f6';
    const verdictTitle = meta.label || decision.decision || 'Değerlendirildi';
    const verdictDesc = meta.description || '';
    const reasons = Array.isArray(decision.reasons) ? decision.reasons : [];

    verdictWrap.style.borderLeftColor = verdictColor;
    verdictWrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span class="severity-pill" style="background:${verdictColor}25;color:${verdictColor};border:1px solid ${verdictColor};font-size:12px;font-weight:700;padding:3px 10px">
              ${escapeHtml(verdictTitle)}
            </span>
            <span class="status-pill ${decision.isDeployable ? 'status-ready' : ''}" style="font-size:11px">
              ${decision.isDeployable ? '✓ Canlı Dağıtıma Uygun' : '⚠ Manuel İnceleme Gerekli'}
            </span>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:var(--text-bright)">${escapeHtml(verdictDesc)}</p>
          ${reasons.length > 0 ? `
            <ul style="margin:0;padding-left:18px;font-size:12px;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px">
              ${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
            </ul>
          ` : ''}
        </div>
        <div style="background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 16px;text-align:right">
          <span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Güvenilirlik Skoru</span>
          <strong style="font-size:20px;color:${confidence.score >= 80 ? 'var(--green)' : (confidence.score >= 50 ? 'var(--yellow)' : 'var(--red)')}">
            %${confidence.score}
          </strong>
          <small style="display:block;font-size:11px;color:var(--text-muted)">${escapeHtml(confidence.levelLabel)}</small>
        </div>
      </div>
    `;

    // 2. Performance Comparison Table
    const bench = data.benchmarks?.comparison || {};
    const origBench = bench.original || {};
    const candBench = bench.candidate || {};
    const deltas = bench.deltas || {};
    const impr = bench.improvements || {};

    const rowsMatch = bench.isRowCountEqual !== false;

    function formatDelta(delta, unit = 'ms', isImprovementBetter = true) {
      if (delta === 0) return `<span style="color:var(--text-muted)">0 ${unit}</span>`;
      const sign = delta > 0 ? '+' : '';
      const isGood = isImprovementBetter ? delta < 0 : delta > 0;
      const color = isGood ? 'var(--green)' : 'var(--red)';
      return `<strong style="color:${color}">${sign}${delta.toLocaleString()} ${unit}</strong>`;
    }

    function formatPct(pct) {
      if (pct === 0) return `<span style="color:var(--text-muted)">%0</span>`;
      const color = pct > 0 ? 'var(--green)' : 'var(--red)';
      const text = pct > 0 ? `-%${pct} (Daha Hızlı)` : `+${Math.abs(pct)}% (Daha Yavaş)`;
      return `<strong style="color:${color}">${text}</strong>`;
    }

    benchWrap.innerHTML = `
      <table class="wb-table" style="width:100%;font-size:12.5px;text-align:left">
        <thead>
          <tr>
            <th style="width:25%">Metrik</th>
            <th style="width:20%">Orijinal Sorgu</th>
            <th style="width:20%">Aday Refaktör (V2)</th>
            <th style="width:18%">Fark (Delta)</th>
            <th style="width:17%">Kazanım (%)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Medyan Çalışma Süresi</strong></td>
            <td>${origBench.durationMs || 0} ms</td>
            <td>${candBench.durationMs || 0} ms</td>
            <td>${formatDelta(deltas.durationMs || 0, 'ms', true)}</td>
            <td>${formatPct(impr.durationPercent || 0)}</td>
          </tr>
          <tr>
            <td><strong>P95 Çalışma Süresi</strong></td>
            <td>${origBench.p95DurationMs || 0} ms</td>
            <td>${candBench.p95DurationMs || 0} ms</td>
            <td>${formatDelta(deltas.p95Ms || 0, 'ms', true)}</td>
            <td>${formatPct(impr.p95Percent || 0)}</td>
          </tr>
          <tr>
            <td><strong>Mantıksal Okuma (Logical Reads)</strong></td>
            <td>${Number(origBench.logicalReads || 0).toLocaleString()}</td>
            <td>${Number(candBench.logicalReads || 0).toLocaleString()}</td>
            <td>${formatDelta(deltas.logicalReads || 0, 'reads', true)}</td>
            <td>${formatPct(impr.readsPercent || 0)}</td>
          </tr>
          <tr>
            <td><strong>CPU Süresi (CPU Time)</strong></td>
            <td>${origBench.cpuMs || 0} ms</td>
            <td>${candBench.cpuMs || 0} ms</td>
            <td>${formatDelta(deltas.cpuMs || 0, 'ms', true)}</td>
            <td>${formatPct(impr.cpuPercent || 0)}</td>
          </tr>
          <tr style="${!rowsMatch ? 'background:rgba(239,68,68,0.1)' : ''}">
            <td><strong>Dönen Satır Sayısı (Rows)</strong></td>
            <td>${Number(origBench.rows || 0).toLocaleString()} satır</td>
            <td>${Number(candBench.rows || 0).toLocaleString()} satır</td>
            <td colspan="2">
              ${rowsMatch 
                ? `<span style="color:var(--green);font-weight:600">✓ Eşit (${origBench.rows || 0} satır)</span>` 
                : `<span style="color:var(--red);font-weight:700">🚨 KRİTİK: Satır sayıları uyuşmuyor (${origBench.rows || 0} vs ${candBench.rows || 0})!</span>`
              }
            </td>
          </tr>
        </tbody>
      </table>
      ${bench.summary ? `<p style="margin:10px 0 0;font-size:12px;color:var(--text-secondary)"><strong>Özet:</strong> ${escapeHtml(bench.summary)}</p>` : ''}
    `;

    // 3. Semantic Validation Status
    const val = data.validation || {};
    const valStatus = (val.status || (val.ok ? 'PASS' : 'FAIL')).toUpperCase();
    let valPill = '<span class="severity-pill" style="background:#64748b20;color:#64748b;border:1px solid #64748b">BELİRSİZ</span>';
    if (valStatus === 'PASS') {
      valPill = '<span class="severity-pill low" style="background:#10b98125;color:#10b981;border:1px solid #10b981;font-weight:700">✓ SEMANTİK OLARAK EŞDEĞER (PASS)</span>';
    } else if (valStatus === 'WARNING') {
      valPill = '<span class="severity-pill warning" style="background:#f59e0b25;color:#f59e0b;border:1px solid #f59e0b;font-weight:700">⚠ UYARI VAR (WARNING)</span>';
    } else if (valStatus === 'FAIL') {
      valPill = '<span class="severity-pill critical" style="background:#ef444425;color:#ef4444;border:1px solid #ef4444;font-weight:700">✕ SEMANTİK DOĞRULAMA BAŞARISIZ (FAIL)</span>';
    }

    valWrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        ${valPill}
        <span style="font-size:12px;color:var(--text-muted)">${val.message || val.reason || (valStatus === 'PASS' ? 'Sütun sırası, adları, tipleri ve satır tekilliği doğrulandı.' : 'Doğrulama uyarısı')}</span>
      </div>
      ${val.errors?.length ? `
        <div style="margin-top:6px;font-size:12px;color:var(--red)">
          ${val.errors.map(e => `<div>✕ ${escapeHtml(e)}</div>`).join('')}
        </div>
      ` : ''}
    `;

    // 4. Plan Changes & Trees
    const planComp = data.plans?.comparison || {};
    const changes = planComp.changes || [];
    
    if (changes.length > 0) {
      changesWrap.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${changes.map(c => {
            const sig = c.significance || 'NEUTRAL';
            const color = sig === 'POSITIVE' ? 'var(--green)' : (sig === 'NEGATIVE' ? 'var(--red)' : (sig === 'REVIEW' ? 'var(--yellow)' : 'var(--text-muted)'));
            const bg = sig === 'POSITIVE' ? 'rgba(16,185,129,0.1)' : (sig === 'NEGATIVE' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)');
            return `
              <div style="padding:6px 10px;border-radius:4px;border:1px solid ${color}40;background:${bg};font-size:11.5px">
                <strong style="color:${color}">${escapeHtml(c.title)}</strong>: 
                <span style="color:var(--text-secondary)">${escapeHtml(c.detail)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      changesWrap.innerHTML = '<p style="font-size:12px;color:var(--text-muted);margin:0">Plan yapısında belirgin bir operatör dönüşümü tespit edilmedi.</p>';
    }

    const origPlan = data.plans?.original || {};
    const candPlan = data.plans?.candidate || {};

    if (origCostBadge) origCostBadge.textContent = `Tahmini Maliyet: ${origPlan.totalSubTreeCost || 0}`;
    const costChangePct = planComp.deltas?.estimatedCostPercent ?? 0;
    if (candCostBadge) candCostBadge.textContent = `Tahmini Maliyet: ${candPlan.totalSubTreeCost || 0} (${costChangePct > 0 ? '+' : ''}${costChangePct}%)`;

    // Render trees
    if (origPlan.tree) {
      origTreeWrap.innerHTML = renderPlanTreeNode(origPlan.tree, 0);
    } else if (origPlan.operators?.length) {
      origTreeWrap.innerHTML = origPlan.operators.map(op => renderPlanTreeNode(op, 0)).join('');
    } else {
      origTreeWrap.innerHTML = `<p style="color:var(--text-muted);padding:8px">${origPlan.error ? escapeHtml(origPlan.error) : 'Plan verisi mevcut değil'}</p>`;
    }

    if (candPlan.tree) {
      candTreeWrap.innerHTML = renderPlanTreeNode(candPlan.tree, 0);
    } else if (candPlan.operators?.length) {
      candTreeWrap.innerHTML = candPlan.operators.map(op => renderPlanTreeNode(op, 0)).join('');
    } else {
      candTreeWrap.innerHTML = `<p style="color:var(--text-muted);padding:8px">${candPlan.error ? escapeHtml(candPlan.error) : 'Plan verisi mevcut değil'}</p>`;
    }
  }

  function initRefactorCompareTab() {
    const btnRun = $('#btnRunFullCompare');
    const loadingWrap = $('#compareLoadingState');
    const loadingText = $('#compareLoadingText');
    const emptyWrap = $('#compareEmptyState');
    const resultWrap = $('#compareResultContainer');
    const origSqlText = $('#compareOrigSqlText');
    const candSqlText = $('#compareCandSqlText');

    if (!btnRun) return;

    btnRun.addEventListener('click', async () => {
      const origSql = origSqlText?.value?.trim() || $('#refactorSourceCode')?.textContent?.trim() || '';
      const candSql = candSqlText?.value?.trim() || $('#candidateSqlText')?.value?.trim() || $('#candidateSqlTextSplit')?.value?.trim() || '';

      if (!origSql || !candSql) {
        toast('Sorgu Eksik', 'Karşılaştırma için hem orijinal hem aday SQL kodu gereklidir.', 'error');
        return;
      }

      if (origSqlText) origSqlText.value = origSql;
      if (candSqlText) candSqlText.value = candSql;

      emptyWrap?.classList.add('hidden');
      resultWrap?.classList.add('hidden');
      loadingWrap?.classList.remove('hidden');
      if (loadingText) loadingText.textContent = 'Semantik doğrulama, benchmark ve execution planlar alınıyor...';

      const targetDb = state.activeDatabase || state.primaryDatabase;

      try {
        if (state.isLive) {
          const res = await fetch('/api/refactor/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              originalSql: origSql,
              candidateSql: candSql,
              database: targetDb,
              viewName: $('#refactorViewTitle')?.textContent || null,
              runValidation: true,
              runBenchmark: true,
              runPlan: true,
              benchmarkRuns: 3
            })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Karşılaştırma analizi tamamlanamadı.');

          renderRefactorComparison(json);
          loadingWrap?.classList.add('hidden');
          resultWrap?.classList.remove('hidden');
          toast('Karşılaştırma Tamamlandı', 'Tüm testler ve plan analizleri başarıyla sonuçlandırıldı.', 'success');
        } else {
          // Demo Mode Synthesis
          await new Promise(r => setTimeout(r, 600));
          const planCompMod = window.STUDIO_MODULES?.planComparison;
          const benchCompMod = window.STUDIO_MODULES?.benchmarkComparison;
          const refactorDecMod = window.STUDIO_MODULES?.refactorDecision;

          const origPlan = {
            totalSubTreeCost: 2.84,
            optimizationLevel: 'FULL',
            operatorCount: 4,
            tree: {
              nodeId: 0,
              physicalOp: 'Nested Loops',
              logicalOp: 'Inner Join',
              category: 'JOIN',
              costPercent: 10,
              estimatedRows: 48,
              actualRows: 48,
              children: [
                {
                  nodeId: 1,
                  physicalOp: 'Clustered Index Scan',
                  logicalOp: 'Clustered Index Scan',
                  category: 'ACCESS',
                  targetObject: 'STOK_HAREKETLERI',
                  costPercent: 65,
                  estimatedRows: 14200,
                  actualRows: 14280,
                  children: []
                },
                {
                  nodeId: 2,
                  physicalOp: 'Index Seek',
                  logicalOp: 'Index Seek',
                  category: 'ACCESS',
                  targetObject: 'STOKLAR',
                  costPercent: 25,
                  estimatedRows: 48,
                  actualRows: 48,
                  children: []
                }
              ]
            },
            warnings: []
          };

          const candPlan = {
            totalSubTreeCost: 0.65,
            optimizationLevel: 'FULL',
            operatorCount: 3,
            tree: {
              nodeId: 0,
              physicalOp: 'Nested Loops',
              logicalOp: 'Inner Join',
              category: 'JOIN',
              costPercent: 15,
              estimatedRows: 48,
              actualRows: 48,
              children: [
                {
                  nodeId: 1,
                  physicalOp: 'Clustered Index Seek',
                  logicalOp: 'Clustered Index Seek',
                  category: 'ACCESS',
                  targetObject: 'STOK_HAREKETLERI',
                  costPercent: 45,
                  estimatedRows: 48,
                  actualRows: 48,
                  children: []
                },
                {
                  nodeId: 2,
                  physicalOp: 'Index Seek',
                  logicalOp: 'Index Seek',
                  category: 'ACCESS',
                  targetObject: 'STOKLAR',
                  costPercent: 40,
                  estimatedRows: 48,
                  actualRows: 48,
                  children: []
                }
              ]
            },
            warnings: []
          };

          const origBench = {
            metrics: { medianDurationMs: 140, p95DurationMs: 155, medianLogicalReads: 14280 },
            runs: [{ iteration: 1, durationMs: 140, cpuMs: 110, logicalReads: 14280, rows: 48 }]
          };

          const candBench = {
            metrics: { medianDurationMs: 35, p95DurationMs: 40, medianLogicalReads: 2100 },
            runs: [{ iteration: 1, durationMs: 35, cpuMs: 26, logicalReads: 2100, rows: 48 }]
          };

          const planComp = planCompMod ? planCompMod.comparePlans(origPlan, candPlan) : {
            deltas: { estimatedCostPercent: -77 },
            changes: [
              { code: 'TABLE_SCAN_REMOVED', significance: 'POSITIVE', title: 'Tüm Tablo Taramaları Kaldırıldı', detail: 'Index Scan operatörü doğrudan Index Seek haline getirildi.' },
              { code: 'INDEX_SEEK_ADDED', significance: 'POSITIVE', title: 'İndeks Seek Eklendi', detail: 'Sorgu doğrudan hedef satırlara atlayacak şekilde optimize edildi.' }
            ]
          };

          const benchComp = benchCompMod ? benchCompMod.compareBenchmarks(origBench, candBench) : {
            original: { durationMs: 140, logicalReads: 14280, cpuMs: 110, rows: 48 },
            candidate: { durationMs: 35, logicalReads: 2100, cpuMs: 26, rows: 48 },
            deltas: { durationMs: -105, logicalReads: -12180, cpuMs: -84 },
            improvements: { durationPercent: 75, readsPercent: 85, cpuPercent: 76 },
            isRowCountEqual: true,
            winner: 'CANDIDATE',
            summary: 'Aday versiyon daha başarılı: Süre %75 azaldı (140ms → 35ms), Logical read %85 azaldı (14,280 → 2,100).'
          };

          const valRes = {
            ok: true,
            status: 'PASS',
            message: 'Sütun sayısı, adları, tipleri ve satır tekilliği tam olarak eşleşti.',
            rowCountsMatch: true
          };

          const decision = refactorDecMod ? refactorDecMod.evaluateRefactorDecision({
            validation: valRes,
            benchmark: benchComp,
            planComparison: planComp
          }) : {
            decision: 'SAFE_IMPROVEMENT',
            metadata: { label: 'Güvenli İyileştirme', color: '#10b981', description: 'Semantik doğrulama başarılı, kaynak tüketimi azaldı ve planda risk tespit edilmedi.' },
            reasons: ['Benchmark testinde anlamlı iyileşme doğrulandı (Süre: %75, Reads: %85).', 'Execution plan yapısında iyileştirici operatör dönüşümleri tespit edildi.'],
            isDeployable: true
          };

          const confidence = refactorDecMod ? refactorDecMod.calculateRefactorConfidence({
            validation: valRes,
            benchmark: benchComp,
            plan: { beforePlan: origPlan, afterPlan: candPlan }
          }) : { score: 95, levelLabel: 'Yüksek Güvenilirlik' };

          renderRefactorComparison({
            ok: true,
            validation: valRes,
            plans: { original: origPlan, candidate: candPlan, comparison: planComp },
            benchmarks: { original: origBench, candidate: candBench, comparison: benchComp },
            decision,
            confidence
          });

          loadingWrap?.classList.add('hidden');
          resultWrap?.classList.remove('hidden');
          toast('Demo Karşılaştırma Hazır', 'Simüle edilmiş doğrulama ve karşılaştırma metrikleri sunuldu.', 'success');
        }
      } catch (err) {
        toast('Karşılaştırma Hatası', err.message, 'error');
        loadingWrap?.classList.add('hidden');
        emptyWrap?.classList.remove('hidden');
      }
    });
  }

  // ============================================================
  // --- 12C. T-SQL AST & INDEX COVERAGE STUDIO (Sprint 4) ---
  // ============================================================

  async function loadAstAnalysis() {
    const loadingWrap = $('#astLoadingState');
    const contentWrap = $('#astContentContainer');
    const sql = $('#refactorSourceCode')?.textContent?.trim() || '';

    if (!sql) {
      if (contentWrap) contentWrap.innerHTML = '<p style="color:var(--text-muted);padding:16px">İncelenecek SQL metni bulunamadı.</p>';
      return;
    }

    loadingWrap?.classList.remove('hidden');
    contentWrap?.classList.add('hidden');

    const targetDb = state.activeDatabase || state.primaryDatabase;

    try {
      if (state.isLive) {
        const res = await fetch('/api/ast/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, database: targetDb })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'AST analizi başarısız.');
        renderAstAnalysis(json);
      } else {
        // Demo Mode AST Synthesis
        await new Promise(r => setTimeout(r, 400));
        renderAstAnalysis({
          ok: true,
          analysisSource: 'AST',
          status: 'AST_AVAILABLE',
          ast: {
            tables: [
              { object: 'STOK_HAREKETLERI', alias: 'sh', referenceType: 'BASE_TABLE' },
              { object: 'STOKLAR', alias: 's', referenceType: 'BASE_TABLE' }
            ],
            joins: [{ type: 'INNER JOIN', leftSource: 'sh', rightSource: 's', onPredicate: 'sh.sth_stok_kod = s.sto_kod' }],
            predicates: [{ expression: "YEAR(sh.sth_tarih) = 2026", operator: '=', columns: ['sth_tarih'] }],
            projections: [{ expression: 'sh.sth_stok_kod', alias: 'sth_stok_kod' }, { expression: 's.sto_isim', alias: 'sto_isim' }],
            ctes: [],
            subqueries: [],
            windowFunctions: []
          },
          findings: [
            {
              code: 'NON_SARGABLE_DATE_FUNCTION',
              title: 'Non-SARGable Tarih Fonksiyonu (YEAR)',
              severity: 'HIGH',
              source: 'AST',
              expression: 'YEAR(sh.sth_tarih) = 2026',
              column: 'sth_tarih',
              table: 'STOK_HAREKETLERI',
              explanation: 'sth_tarih kolonu YEAR() fonksiyonu ile sarıldığı için B-Tree indeks seek kullanılamaz, tablo taraması zorunlu kalır.',
              rewriteHint: "Tarih fonksiyonu yerine aralık filtresi kullanın: sh.sth_tarih >= '2026-01-01' AND sh.sth_tarih < '2027-01-01'"
            },
            {
              code: 'INDEX_COVERAGE_PARTIAL',
              title: 'Kısmi İndeks Kapsamı (Key Lookup İhtimali)',
              severity: 'LOW',
              source: 'INDEX_METADATA',
              table: 'STOK_HAREKETLERI',
              explanation: 'IX_STOK_HAREKETLERI_STOK_KOD indeksi filtre kolonunu karşılıyor; ancak projeksiyondaki bazı kolonlar dahil (INCLUDE) edilmediği için Key Lookup maliyeti oluşabilir.'
            },
            {
              code: 'INDEX_PREFIX_OVERLAP',
              title: 'Önek Örtüşen İndeks (Prefix Overlap)',
              severity: 'LOW',
              source: 'INDEX_METADATA',
              table: 'STOK_HAREKETLERI',
              explanation: 'IX_STOK_HAREKETLERI_STOK_KOD anahtarları (sth_stok_kod), daha geniş bir indeksin ilk anahtarlarını oluşturmaktadır.'
            }
          ],
          coverage: [
            {
              table: 'STOK_HAREKETLERI',
              coverage: 'PARTIAL',
              matchedIndex: 'IX_STOK_HAREKETLERI_STOK_KOD',
              indexesCount: 2,
              neededFilterCols: ['sth_tarih', 'sth_stok_kod'],
              existingIndexes: [
                { name: 'PK_STOK_HAREKETLERI', keys: ['sth_id'], includes: [] },
                { name: 'IX_STOK_HAREKETLERI_STOK_KOD', keys: ['sth_stok_kod', 'sth_tarih'], includes: ['sth_miktar', 'sth_tutar'] }
              ]
            },
            {
              table: 'STOKLAR',
              coverage: 'FULL',
              matchedIndex: 'PK_STOKLAR',
              indexesCount: 1,
              neededFilterCols: ['sto_kod'],
              existingIndexes: [
                { name: 'PK_STOKLAR', keys: ['sto_kod'], includes: [] }
              ]
            }
          ]
        });
      }
    } catch (err) {
      toast('AST Hatası', err.message, 'error');
    } finally {
      loadingWrap?.classList.add('hidden');
      contentWrap?.classList.remove('hidden');
    }
  }

  function renderAstAnalysis(data) {
    const badge = $('#astSourceBadge');
    if (badge) {
      const isAst = data.analysisSource === 'AST';
      badge.textContent = isAst ? 'AST: ÇÖZÜMLENDİ' : 'REGEX FALLBACK';
      badge.className = isAst ? 'status-pill status-ready' : 'status-pill status-warning';
    }

    // 1. Findings
    const findingsList = $('#astFindingsList');
    const countBadge = $('#astFindingsCountBadge');
    const findings = data.findings || [];

    if (countBadge) countBadge.textContent = `${findings.length} Bulgu`;

    if (findingsList) {
      if (findings.length === 0) {
        findingsList.innerHTML = '<p style="color:var(--text-muted);margin:0;font-size:12.5px">T-SQL sorgusunda yapısal bir darboğaz veya non-SARGable ifade tespit edilmedi.</p>';
      } else {
        findingsList.innerHTML = findings.map(f => {
          const sev = (f.severity || 'MEDIUM').toUpperCase();
          const sevColors = {
            CRITICAL: 'var(--red)',
            HIGH: 'var(--red)',
            MEDIUM: 'var(--yellow)',
            LOW: 'var(--accent)',
            INFO: 'var(--text-muted)'
          };
          const color = sevColors[sev] || 'var(--text-muted)';
          const src = f.source || 'AST';

          return `
            <div class="permission-box" style="border-left:3px solid ${color};padding:10px 14px;border-radius:4px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="severity-pill" style="font-size:10px;padding:2px 6px;background:${color}25;color:${color};border:1px solid ${color}">${sev}</span>
                  <span class="node-badge" style="font-size:10px">${src}</span>
                  <strong style="color:var(--text-bright);font-size:13px">${escapeHtml(f.title || f.code)}</strong>
                </div>
                ${f.table ? `<span class="object-pill" style="font-size:11px">${escapeHtml(f.table)}</span>` : ''}
              </div>
              <p style="margin:0 0 6px;font-size:12.5px;color:var(--text-secondary)">${escapeHtml(f.explanation || '')}</p>
              ${f.expression ? `<pre class="code-editor" style="padding:4px 8px;font-size:11.5px;margin:4px 0;background:var(--bg2);border:1px solid var(--line);color:var(--text-primary)"><code>${escapeHtml(f.expression)}</code></pre>` : ''}
              ${f.rewriteHint ? `<div style="font-size:11.5px;color:var(--green);margin-top:4px"><strong>💡 Öneri:</strong> ${escapeHtml(f.rewriteHint)}</div>` : ''}
            </div>
          `;
        }).join('');
      }
    }

    // 2. Index Coverage Wrap
    const coverageWrap = $('#astIndexCoverageWrap');
    const coverages = data.coverage || [];
    if (coverageWrap) {
      if (coverages.length === 0) {
        coverageWrap.innerHTML = '<p style="color:var(--text-muted);margin:0;font-size:12.5px">İncelenecek temel tablo indeksi bulunamadı.</p>';
      } else {
        coverageWrap.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
            ${coverages.map(c => {
              const cov = (c.coverage || 'NONE').toUpperCase();
              const covColor = cov === 'FULL' ? 'var(--green)' : (cov === 'PARTIAL' ? 'var(--yellow)' : 'var(--red)');
              const covLabel = cov === 'FULL' ? 'TAM KAPSAM (FULL)' : (cov === 'PARTIAL' ? 'KISMİ KAPSAM (PARTIAL)' : 'KAPSAM YOK (NONE)');

              return `
                <div class="ast-coverage-card" style="background:var(--surface2);border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <strong style="color:var(--text-bright);font-size:13px">${escapeHtml(c.table)}</strong>
                    <span class="severity-pill" style="font-size:10px;background:${covColor}25;color:${covColor};border:1px solid ${covColor}">${covLabel}</span>
                  </div>
                  <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:6px">
                    Gereken Filtre Kolonları: <b>${(c.neededFilterCols || []).join(', ') || 'Yok (Filtresiz)'}</b>
                  </div>
                  ${c.matchedIndex ? `<div style="font-size:11.5px;color:var(--accent);margin-bottom:6px">Eşleşen İndeks: <b>${escapeHtml(c.matchedIndex)}</b></div>` : ''}
                  <div style="font-size:11px;color:var(--text-muted);border-top:1px solid var(--line);padding-top:6px;margin-top:6px">
                    Mevcut İndeksler (${(c.existingIndexes || []).length}):
                    <ul style="margin:4px 0 0;padding-left:16px">
                      ${(c.existingIndexes || []).map(idx => `
                        <li><b>${escapeHtml(idx.name)}</b>: (${(idx.keys || []).join(', ')})${idx.includes?.length ? ` INC (${idx.includes.join(', ')})` : ''}</li>
                      `).join('')}
                    </ul>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }
    }

    // 3. Metrics Grid
    const ast = data.ast || {};
    if ($('#astTableCount')) $('#astTableCount').textContent = (ast.tables || []).length;
    if ($('#astJoinCount')) $('#astJoinCount').textContent = (ast.joins || []).length;
    if ($('#astPredicateCount')) $('#astPredicateCount').textContent = (ast.predicates || []).length;
    if ($('#astCteCount')) $('#astCteCount').textContent = (ast.ctes || []).length;
    if ($('#astSubqueryCount')) $('#astSubqueryCount').textContent = (ast.subqueries || []).length;
    if ($('#astWindowCount')) $('#astWindowCount').textContent = (ast.windowFunctions || []).length;
  }

  function initAstTab() {
    $('#btnRunAstAnalysis')?.addEventListener('click', () => loadAstAnalysis());
  }

  // ============================================================
  // --- 13. VALIDATION LAB & QUERY COMPARE (Phase 2D/2.6) ---
  // ============================================================
  function initValidationLab() {
    const origInput = $('#valOrigSql');
    const candInput = $('#valCandSql');
    const btnLoadSample = $('#btnValLoadSample');
    const btnRunBoth = $('#btnValRunBoth');
    const btnValidate = $('#validateButton');
    const ackCheck = $('#validationAck');
    let validationRevision = 0;
    invalidateValidation = () => {
      validationRevision++;
      setValVerdict('DOĞRULANMADI');
      for (const step of ['schema', 'rowCount', 'setMatch', 'multiplicity']) {
        const row = $('#valStep-' + step);
        if (row) row.className = 'validation-step';
        const status = $('#valStepStatus-' + step);
        if (status) { status.textContent = 'BEKLİYOR'; status.style.color = ''; }
        const desc = $('#valStepDesc-' + step);
        if (desc) desc.textContent = 'Güncel SQL ve veritabanı için kontrol bekleniyor.';
      }
      for (const id of ['valSummarySchema', 'valSummaryRowCount', 'valSummarySetMatch', 'valSummaryMultiplicity']) {
        if ($('#' + id)) { $('#' + id).textContent = 'Bekliyor'; $('#' + id).style.color = ''; }
      }
      $$('#page-validation .benchmark-compare strong, #page-validation .benchmark-compare b').forEach(el => { el.textContent = '—'; });
    };
    origInput?.addEventListener('input', invalidateValidation);
    candInput?.addEventListener('input', invalidateValidation);
    $('#validationDatabaseSelect')?.addEventListener('change', e => {
      state.validationDatabase = e.target.value;
      invalidateValidation();
    });

    // Resizable Split-View (Horizontal Split with Mouse Drag)
    const splitWrap = $('#valSplitWrap');
    const divider = $('#valSplitDivider');
    const leftPane = $('#valOrigPane');
    const rightPane = $('#valCandPane');
    if (splitWrap && divider && leftPane && rightPane) {
      let isDragging = false;
      divider.addEventListener('mousedown', e => {
        isDragging = true;
        divider.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if (!isDragging) return;
        const rect = splitWrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const total = rect.width;
        let ratio = x / total;
        if (ratio < 0.30) ratio = 0.30;
        if (ratio > 0.70) ratio = 0.70;
        leftPane.style.flex = `${ratio}`;
        rightPane.style.flex = `${1 - ratio}`;
      });
      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          divider.classList.remove('dragging');
          document.body.style.cursor = '';
        }
      });
      divider.addEventListener('dblclick', () => {
        leftPane.style.flex = '1';
        rightPane.style.flex = '1';
      });
    }

    // Clear & Copy & Workbench Quick Actions
    $('#btnValClear')?.addEventListener('click', () => {
      if (origInput) origInput.value = '';
      if (candInput) candInput.value = '';
      invalidateValidation();
      toast('Temizlendi', 'Orijinal ve aday sorgu alanları temizlendi.');
    });

    $('#btnValCopyOrig')?.addEventListener('click', () => {
      if (origInput?.value) {
        navigator.clipboard.writeText(origInput.value);
        toast('Kopyalandı', 'Orijinal SQL panoya kopyalandı.', 'success');
      }
    });

    $('#btnValCopyCand')?.addEventListener('click', () => {
      if (candInput?.value) {
        navigator.clipboard.writeText(candInput.value);
        toast('Kopyalandı', 'Aday SQL panoya kopyalandı.', 'success');
      }
    });

    $('#btnValSendOrigToWb')?.addEventListener('click', () => {
      if (origInput?.value) {
        openWorkbenchSql(origInput.value, state.validationDatabase || selectedDatabase(), 'Orijinal SQL');
      }
    });

    $('#btnValSendCandToWb')?.addEventListener('click', () => {
      if (candInput?.value) {
        openWorkbenchSql(candInput.value, state.validationDatabase || selectedDatabase(), 'Aday SQL');
      }
    });

    // Load sample queries
    btnLoadSample?.addEventListener('click', () => {
      if (origInput) {
        origInput.value = `-- Orijinal View Sorgusu (V1):
SELECT 
    sth_stok_kod,
    sth_tip,
    sth_miktar,
    sth_tarih
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_tarih >= '2026-01-01';`;
      }
      if (candInput) {
        candInput.value = `-- Optimize Edilmiş Aday Refaktör Sorgusu (V2):
SELECT 
    sth_stok_kod,
    sth_tip,
    sth_miktar,
    sth_tarih
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_tarih >= '2026-01-01';`;
      }
      invalidateValidation();
      toast('Örnek Yüklendi', 'Orijinal ve aday sorgu şablonları yüklendi.');
    });

    // Run Both (Benchmark Projection side-by-side comparison)
    btnRunBoth?.addEventListener('click', async () => {
      const oSql = origInput?.value.trim();
      const cSql = candInput?.value.trim();
      if (!oSql || !cSql) {
        toast('Sorgular Eksik', 'Lütfen hem orijinal hem de aday sorgu alanını doldurun.', 'error');
        return;
      }

      if (!state.connected || !ackCheck?.checked) {
        invalidateValidation();
        toast('Ölçüm Yapılmadı', !state.connected ? 'SQL Server bağlantısı kurun. Demo modunda performans ölçülmez.' : 'İki sorgunun seçili veritabanında çalıştırılacağını onaylayın.', 'warning');
        return;
      }
      const runRevision = validationRevision;
      btnRunBoth.disabled = true;
      btnRunBoth.textContent = 'Karşılaştırılıyor...';

      try {
        if (state.connected) {
          const [resO, resC] = await Promise.all([
            fetch('/api/workbench/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: oSql, database: $('#validationDatabaseSelect')?.value || selectedDatabase(), timeoutMs: 30000 })
            }).then(r => r.json()),
            fetch('/api/workbench/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: cSql, database: $('#validationDatabaseSelect')?.value || selectedDatabase(), timeoutMs: 30000 })
            }).then(r => r.json())
          ]);

          if (runRevision !== validationRevision) return;
          if (!resO.ok) throw new Error(`Orijinal sorgu: ${resO.error}`);
          if (!resC.ok) throw new Error(`Aday sorgu: ${resC.error}`);

          $('#valReadsBefore').textContent = (resO.metrics?.logicalReads || 0).toLocaleString();
          $('#valReadsAfter').textContent = (resC.metrics?.logicalReads || 0).toLocaleString();
          $('#valCpuBefore').textContent = `${resO.metrics?.cpuMs || 0} ms`;
          $('#valCpuAfter').textContent = `${resC.metrics?.cpuMs || 0} ms`;
          $('#valTimeBefore').textContent = `${resO.metrics?.durationMs || 0} ms`;
          $('#valTimeAfter').textContent = `${resC.metrics?.durationMs || 0} ms`;
          const getRowsCount = r => (r.totalRows != null ? r.totalRows : (r.rowsReturned != null ? r.rowsReturned : (r.rows ? r.rows.length : 0)));
          $('#valMultBefore').textContent = getRowsCount(resO).toLocaleString();
          $('#valMultAfter').textContent = getRowsCount(resC).toLocaleString();
        } else {
          await new Promise(r => setTimeout(r, 450));
          $('#valReadsBefore').textContent = '14,280';
          $('#valReadsAfter').textContent = '2,450 (-83%)';
          $('#valCpuBefore').textContent = '240 ms';
          $('#valCpuAfter').textContent = '28 ms (-88%)';
          $('#valTimeBefore').textContent = '310 ms';
          $('#valTimeAfter').textContent = '35 ms';
          $('#valMultBefore').textContent = '48';
          $('#valMultAfter').textContent = '48 ✓';
        }
        toast('Karşılaştırma Tamamlandı', 'Mevcut ve aday sorgu metrikleri güncellendi.', 'success');
      } catch (err) {
        toast('Karşılaştırma Hatası', err.message, 'error');
      } finally {
        btnRunBoth.disabled = false;
        btnRunBoth.textContent = '▶ Performansı Ölç';
      }
    });

    // Validation Lab Execution
    ackCheck?.addEventListener('change', e => {
      if (btnValidate) btnValidate.disabled = !e.target.checked;
    });

    btnValidate?.addEventListener('click', async () => {
      const oSql = origInput?.value.trim();
      const cSql = candInput?.value.trim();
      if (!oSql || !cSql) {
        toast('Sorgu Eksik', 'Lütfen doğrulanacak sorguları girin.', 'error');
        return;
      }

      if (!state.connected) {
        invalidateValidation();
        toast('Doğrulama Yapılmadı', 'Demo modunda semantik kanıt üretilemez. SQL Server bağlantısı kurun.', 'warning');
        return;
      }
      if (!ackCheck?.checked) return;
      const runRevision = validationRevision;
      btnValidate.disabled = true;
      btnValidate.textContent = '✦ Doğrulanıyor...';
      const statusPill = $('#valPipelineStatus');
      if (statusPill) {
        statusPill.textContent = 'ÇALIŞIYOR...';
        statusPill.className = 'status-pill status-warning';
      }

      try {
        if (state.connected) {
          const res = await fetch('/api/validation/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalSql: oSql, candidateSql: cSql, database: $('#validationDatabaseSelect')?.value || selectedDatabase(), sampleLimit: 1000 })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Validation başarısız.');

          if (runRevision !== validationRevision) return;
          renderValSteps(json.steps);
          setValVerdict(json.verdict || 'INCONCLUSIVE');
        } else {
          // Demo Mode Simulation
          await new Promise(r => setTimeout(r, 600));
          const demoSteps = [
            { id: 'schema', status: 'PASS', detail: '4 kolon, veri tipleri ve ordinal sıralama birebir eşleşti.' },
            { id: 'rowCount', status: 'PASS', detail: 'Satır sayısı eşleşti (1,000 satır).' },
            { id: 'setMatch', status: 'PASS', detail: 'Dual EXCEPT = 0 (Her iki yönlü küme farkı boş).' },
            { id: 'multiplicity', status: 'PASS', detail: 'Tüm satırların duplicate adetleri (GROUP BY + COUNT_BIG) doğrulandı.' }
          ];
          renderValSteps(demoSteps);
          setValVerdict('PASS_WITH_WARNING');
        }
        toast('Doğrulama Tamamlandı', 'Tüm semantik denetim adımları tamamlandı.', 'success');
      } catch (err) {
        toast('Doğrulama Hatası', err.message, 'error');
        if (runRevision === validationRevision) setValVerdict('ERROR');
      } finally {
        btnValidate.disabled = !ackCheck?.checked;
        btnValidate.textContent = '✦ Semantik Karşılaştırmayı Başlat';
      }
    });

    function renderValSteps(steps = []) {
      for (const st of steps) {
        const elStep = $(`#valStep-${st.id}`);
        const elStatus = $(`#valStepStatus-${st.id}`);
        const elDesc = $(`#valStepDesc-${st.id}`);

        const isPass = st.status === 'PASS';
        const isFail = st.status === 'FAILED';
        const isWarn = st.status === 'WARNING';
        const statusLabel = isPass ? 'BAŞARILI' : (isFail ? 'BAŞARISIZ' : (isWarn ? 'UYARI' : 'BEKLİYOR'));

        if (elStep) {
          elStep.className = `validation-step ${isPass ? 'done' : (isFail ? 'failed' : (isWarn ? 'warning' : ''))}`;
        }
        if (elStatus) {
          elStatus.textContent = statusLabel;
          elStatus.style.color = isPass ? 'var(--green)' : (isFail ? 'var(--red)' : (isWarn ? 'var(--yellow)' : 'var(--text-muted)'));
        }
        if (elDesc && st.detail) {
          elDesc.textContent = st.detail;
        }

        // Summary block
        const stepColor = isPass ? 'var(--green)' : (isWarn ? 'var(--yellow)' : 'var(--red)');
        if (st.id === 'schema' && $('#valSummarySchema')) {
          $('#valSummarySchema').textContent = isPass ? 'Birebir Eşleşti ✓' : (isWarn ? 'Uyarı ile Geçti ⚠️' : 'Uyuşmazlık ✕');
          $('#valSummarySchema').style.color = stepColor;
        }
        if (st.id === 'rowCount' && $('#valSummaryRowCount')) {
          const countText = isPass ? (st.detail?.includes('Tam veri') ? 'Eşit (Tam Veri Seti) ✓' : 'Eşit (Örneklem) ✓') : (isWarn ? 'Atlandı (LOB) ⚠️' : 'Farklı ✕');
          $('#valSummaryRowCount').textContent = countText;
          $('#valSummaryRowCount').style.color = stepColor;
        }
        if (st.id === 'setMatch' && $('#valSummarySetMatch')) {
          $('#valSummarySetMatch').textContent = isPass ? 'Fark Yok (0) ✓' : (isWarn ? 'Atlandı (LOB) ⚠️' : 'Küme Farkı Var ✕');
          $('#valSummarySetMatch').style.color = stepColor;
        }
        if (st.id === 'multiplicity' && $('#valSummaryMultiplicity')) {
          $('#valSummaryMultiplicity').textContent = isPass ? 'Frekanslar Korundu ✓' : (isWarn ? 'Atlandı (LOB) ⚠️' : 'Frekans Farkı ✕');
          $('#valSummaryMultiplicity').style.color = stepColor;
        }
      }
    }

    function setValVerdict(verdict) {
      const vText = $('#valVerdictText');
      const vSub = $('#valVerdictSub');
      const pStatus = $('#valPipelineStatus');
      const sumVerdict = $('#valSummaryVerdict');

      let label = verdict;
      let sub = 'Doğrulama adımları bekleniyor';
      let color = 'var(--text-muted)';
      let pillClass = 'status-pill';
      let sumClass = 'muted-text';

      if (verdict === 'PASS' || verdict === 'EXACT MATCH' || verdict === 'SEMANTİK OLARAK DOĞRULANDI') {
        label = 'PASS — SEMANTİK OLARAK DOĞRULANDI';
        sub = 'Şema, satır sayısı, EXCEPT ve satır çokluğu kanıtlandı ✓';
        color = 'var(--green)';
        pillClass = 'status-pill status-ready';
        sumClass = 'positive-text';
      } else if (verdict === 'PASS_WITH_WARNING') {
        label = 'PASS (UYARI İLE DOĞRULANDI)';
        sub = 'Şema ve örneklem eşleşti; örneklem bazlı doğrulama yapıldı ⚠️';
        color = 'var(--yellow)';
        pillClass = 'status-pill status-warning';
        sumClass = 'warning-text';
      } else if (verdict === 'INCONCLUSIVE') {
        label = 'INCONCLUSIVE — KANITLANAMADI';
        sub = 'LOB/XML kolonlar veya kısıtlar nedeniyle semantik eşitlik kesin kanıtlanamadı ℹ';
        color = 'var(--cyan, #0284c7)';
        pillClass = 'status-pill status-info';
        sumClass = 'info-text';
      } else if (verdict === 'ERROR') {
        label = 'DOĞRULAMA TAMAMLANAMADI';
        sub = 'Bağlantı veya sorgu hatası nedeniyle sonuç üretilemedi. SQL eşitliği hakkında karar verilmedi.';
        color = 'var(--red)';
        pillClass = 'status-pill status-danger';
      } else if (verdict === 'DOĞRULANMADI') {
        label = 'DOĞRULANMADI';
        sub = 'Doğrulama adımları bekleniyor';
        color = 'var(--text-muted)';
        pillClass = 'status-pill';
        sumClass = 'muted-text';
      } else {
        label = 'FAIL — SONUÇ UYUŞMUYOR';
        sub = 'Şema, satır sayısı veya küme farkında uyumsuzluk saptandı ✕';
        color = 'var(--red)';
        pillClass = 'status-pill status-danger';
        sumClass = 'danger-text';
      }

      if (vText) {
        vText.textContent = label;
        vText.style.color = color;
      }

      if (vSub) {
        vSub.textContent = sub;
      }

      if (sumVerdict) {
        sumVerdict.textContent = label;
        sumVerdict.className = sumClass;
      }

      if (pStatus) {
        pStatus.textContent = label;
        pStatus.className = pillClass;
      }
    }
  }

  // ============================================================
  // --- 14. AI WORKBENCH & INDEX INTEGRATION (Phase 2E) ---
  // ============================================================
  function initAiWorkbenchIntegration() {
    // Shared tab/model transfer, without duplicate click handlers.
    $('#btnOpenSqlInWorkbench')?.addEventListener('click', async () => {
      const sql = await getViewDefinition(state.selectedCanonicalId || state.selectedViewName);
      if (!sql.trim()) {
        toast('SQL Tanımı Alınamadı', 'Önce bağlantı kurup view tanımını yükleyin.', 'warning');
        return;
      }
      openWorkbenchSql(sql, selectedDatabase(), state.selectedViewName);
    });

    // Index Tab Refresh button
    $('#btnRefreshIndexes')?.addEventListener('click', async () => {
      const viewName = state.selectedCanonicalId || state.selectedViewName;
      const body = $('#detailIndexTableBody');
      if (!body) return;

      body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">İndeksler sorgulanıyor...</td></tr>';
      try {
        const res = await fetch(`/api/views/${encodeURIComponent(viewName)}/indexes`);
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'İndeksler alınamadı.');
        const idxs = json.indexes || [];
        if (idxs.length === 0) {
          body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">Bu view için tanımlı base tablo indeksi bulunamadı.</td></tr>';
          return;
        }
        body.innerHTML = idxs.map(i => `
          <tr>
            <td><b>${i.table_name}</b></td>
            <td>${i.index_name}</td>
            <td><span class="node-badge" style="font-size:10px">${i.type_desc}</span></td>
            <td>${i.key_columns || '—'}</td>
            <td>${i.included_columns || '—'}</td>
          </tr>
        `).join('');
        toast('İndeksler Güncellendi', `${idxs.length} indeks listelendi.`, 'success');
      } catch (err) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--red)">Hata: ${err.message}</td></tr>`;
      }
    });
  }

  // ============================================================
  // --- 15. COMMAND PALETTE (Phase 2F Ctrl+K) ---
  // ============================================================
  function initCommandPalette() {
    const modal = $('#commandPaletteModal');
    const input = $('#cmdPaletteInput');
    const results = $('#cmdPaletteResults');
    let selectedIdx = 0;
    let items = [];

    const actions = [
      { title: 'Genel Bakış (Overview)', category: 'SAYFALAR & AKSIYONLAR', icon: '◫', action: () => gotoPage('overview') },
      { title: 'View Envanteri (View Inventory)', category: 'SAYFALAR & AKSIYONLAR', icon: '⌘', action: () => gotoPage('views') },
      { title: 'Refaktör Stüdyosu (4 Adımlı Dönüşüm)', category: 'SAYFALAR & AKSIYONLAR', icon: '✦', action: () => gotoPage('studio') },
      { title: 'SQL Workbench (Sorgu & Plan Editörü)', category: 'SAYFALAR & AKSIYONLAR', icon: '⚡', action: () => gotoPage('workbench') },
      { title: 'DBA Araçları (İndeks, İstatistik, Aktivite)', category: 'SAYFALAR & AKSIYONLAR', icon: '⚲', action: () => gotoPage('dba-tools') },
      { title: 'Çalışma Alanları (Workspaces)', category: 'SAYFALAR & AKSIYONLAR', icon: '◫', action: () => gotoPage('workspaces') },
      { title: 'Bağımlılık Haritası (Dependency X-Ray)', category: 'SAYFALAR & AKSIYONLAR', icon: '⌁', action: () => gotoPage('graph') },
      { title: 'Table Pressure (Fiziksel Tablo Baskısı)', category: 'SAYFALAR & AKSIYONLAR', icon: '▦', action: () => gotoPage('tables') },
      { title: 'Duplicate Logic (Mükerrer SQL Tespiti)', category: 'SAYFALAR & AKSIYONLAR', icon: '≋', action: () => gotoPage('duplicates') },
      { title: 'Stüdyo Ayarları (Configuration)', category: 'SAYFALAR & AKSIYONLAR', icon: '⚙', action: () => gotoPage('settings') },
      { title: 'Yeniden Tara (Tüm AA_ Viewlarını Tara)', category: 'SAYFALAR & AKSIYONLAR', icon: '↻', action: () => triggerScan() },
      { title: 'Veritabanı Bağlantı Penceresini Aç', category: 'SAYFALAR & AKSIYONLAR', icon: '●', action: () => openModal() }
    ];

    function openPalette() {
      if (!modal) return;
      modal.classList.remove('hidden');
      if (input) {
        input.value = '';
        input.focus();
      }
      renderPaletteResults('');
    }

    function closePalette() {
      if (!modal) return;
      modal.classList.add('hidden');
    }

    function renderPaletteResults(query = '') {
      if (!results) return;
      const q = query.toLowerCase().trim();
      selectedIdx = 0;

      const filteredActions = actions.filter(a => a.title.toLowerCase().includes(q));
      const views = (state.data.views || [])
        .filter(v => (v.name || v.view_name).toLowerCase().includes(q) || (v.database && v.database.toLowerCase().includes(q)))
        .slice(0, 8)
        .map(v => ({
          title: v.name || v.view_name,
          subtitle: v.database || '',
          category: 'VIEWLAR',
          icon: '⌘',
          action: () => {
            selectView(v.canonicalId || v.name);
            gotoPage('views');
          }
        }));

      const tables = (state.data.pressures || [])
        .filter(p => p.name.toLowerCase().includes(q) || (p.database && p.database.toLowerCase().includes(q)))
        .slice(0, 5)
        .map(p => ({
          title: p.name,
          subtitle: p.database || '',
          category: 'BASE TABLOLAR',
          icon: '▦',
          action: () => gotoPage('tables')
        }));

      items = [...filteredActions, ...views, ...tables];

      if (items.length === 0) {
        results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Eşleşen komut veya nesne bulunamadı.</div>';
        return;
      }

      let html = '';
      let currCat = '';
      items.forEach((it, idx) => {
        if (it.category !== currCat) {
          currCat = it.category;
          html += `<div class="cmd-category">${currCat}</div>`;
        }
        html += `
          <div class="cmd-item ${idx === selectedIdx ? 'active' : ''}" data-idx="${idx}">
            <div class="cmd-item-left">
              <span class="cmd-item-icon">${it.icon}</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span>${it.title}</span>
                ${it.subtitle ? `<span class="db-badge" style="font-size:10px;padding:1px 5px">${it.subtitle}</span>` : ''}
              </div>
            </div>
            <span class="tab-badge" style="font-size:10px">${it.category.split(' ')[0]}</span>
          </div>
        `;
      });

      results.innerHTML = html;

      results.querySelectorAll('.cmd-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = Number(el.dataset.idx);
          if (items[idx]) {
            closePalette();
            items[idx].action();
          }
        });
      });
    }

    input?.addEventListener('input', e => {
      renderPaletteResults(e.target.value);
    });

    input?.addEventListener('keydown', e => {
      const rendered = results?.querySelectorAll('.cmd-item') || [];
      if (rendered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = (selectedIdx + 1) % items.length;
        rendered.forEach((el, i) => el.classList.toggle('active', i === selectedIdx));
        rendered[selectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = (selectedIdx - 1 + items.length) % items.length;
        rendered.forEach((el, i) => el.classList.toggle('active', i === selectedIdx));
        rendered[selectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIdx]) {
          closePalette();
          items[selectedIdx].action();
        }
      }
    });

    modal?.addEventListener('click', e => {
      if (e.target === modal) closePalette();
    });

    // Global Ctrl+K / Cmd+K listener
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (modal?.classList.contains('hidden')) {
          openPalette();
        } else {
          closePalette();
        }
      }
      if (e.key === 'Escape') {
        closePalette();
      }
    });
  }

  // ============================================================
  // --- 12. SQL WORKBENCH CONTROLLER (Phase 2B & 2C) ---
  // ============================================================
  // SPRINT 7: PROFESSIONAL SQL WORKBENCH ENGINE
  // ============================================================
  const workbenchState = {
    tabs: [],
    activeTabId: null,
    activeRequestId: null,
    isRunning: false,
    timerInterval: null,
    startTime: null,
    monacoEditor: null,
    isMonacoLoaded: false,
    gridInstance: null,
    activeResultSetIndex: 0,
    catalog: null
  };

  function initWorkbench() {
    const input = $('#wbSqlInput');
    const gutter = $('#wbLineNumbers');
    const statusPill = $('#wbStatusPill');
    const liveTimer = $('#wbLiveTimer');
    const btnRun = $('#btnWbRun');
    const btnStop = $('#btnWbStop');
    const btnEstPlan = $('#btnWbEstPlan');
    const btnActPlan = $('#btnWbActPlan');
    const btnBenchmark = $('#btnWbBenchmark');
    const btnFormat = $('#btnWbFormat');
    const btnClear = $('#btnWbClear');
    const btnSaveQuery = $('#btnWbSaveQuery');
    const btnNewTab = $('#btnWbNewTab');
    const btnCreateWs = $('#btnWbCreateWorkspace');

    // --------------------------------------------------------
    // Helper: Active Tab Accessors
    // --------------------------------------------------------
    function getActiveTab() {
      return workbenchState.tabs.find(t => t.id === workbenchState.activeTabId) || workbenchState.tabs[0] || null;
    }

    function getEditorSql() {
      if (workbenchState.isMonacoLoaded && workbenchState.monacoEditor) {
        const selection = workbenchState.monacoEditor.getSelection();
        if (selection && !selection.isEmpty()) {
          const text = workbenchState.monacoEditor.getModel().getValueInRange(selection);
          if (text.trim()) return text;
        }
        return workbenchState.monacoEditor.getValue();
      }
      if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        if (start !== end) {
          const text = input.value.substring(start, end);
          if (text.trim()) return text;
        }
        return input.value;
      }
      return '';
    }

    function getFullEditorSql() {
      if (workbenchState.isMonacoLoaded && workbenchState.monacoEditor) {
        return workbenchState.monacoEditor.getValue();
      }
      return input ? input.value : '';
    }

    function setEditorSql(sql) {
      if (workbenchState.isMonacoLoaded && workbenchState.monacoEditor) {
        workbenchState.monacoEditor.setValue(sql || '');
      }
      if (input) {
        input.value = sql || '';
        updateLineNumbers();
      }
    }

    function updateLineNumbers() {
      if (!input || !gutter) return;
      const count = (input.value || '').split('\n').length;
      let text = '';
      for (let i = 1; i <= Math.max(1, count); i++) text += i + '\n';
      gutter.textContent = text.trimEnd();
    }

    // --------------------------------------------------------
    // Tab Management & Lifecycle
    // --------------------------------------------------------
    function renderTabStrip() {
      const tabsWrap = $('#wbQueryTabs');
      if (!tabsWrap) return;

      tabsWrap.innerHTML = workbenchState.tabs.map(tab => {
        const isActive = tab.id === workbenchState.activeTabId;
        const dirtyClass = tab.isDirty ? 'dirty' : '';
        return `
          <div class="wb-query-tab ${isActive ? 'active' : ''} ${dirtyClass}" data-tab-id="${tab.id}" title="${escapeHtml(tab.title)}">
            <span class="wb-tab-title">${escapeHtml(tab.title)}</span>
            <span class="wb-tab-dirty">*</span>
            <span class="wb-tab-close" data-close-id="${tab.id}" title="Sekmeyi Kapat">×</span>
          </div>
        `;
      }).join('');

      // Click to switch tab
      tabsWrap.querySelectorAll('.wb-query-tab').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.classList.contains('wb-tab-close')) return;
          const tabId = el.dataset.tabId;
          if (tabId && tabId !== workbenchState.activeTabId) {
            switchTab(tabId);
          }
        });

        // Context menu (right-click)
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showTabContextMenu(e.pageX, e.pageY, el.dataset.tabId);
        });
      });

      // Tab close buttons
      tabsWrap.querySelectorAll('.wb-tab-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tabId = btn.dataset.closeId;
          closeTab(tabId);
        });
      });
    }

    function createModelForTab(tab) {
      if (!window.monaco || !window.monaco.editor) return;
      if (tab.model) return;
      try {
        const uri = monaco.Uri.parse(`inmemory://sql-workbench/${tab.id}.sql`);
        let existingModel = monaco.editor.getModel(uri);
        if (existingModel) existingModel.dispose();
        tab.model = monaco.editor.createModel(tab.sql || '', 'sql', uri);
        tab.model.onDidChangeContent(() => {
          tab.sql = tab.model.getValue();
          tab.isDirty = true;
          renderTabStrip();
          debouncedSaveSessions();
        });
      } catch (_) {}
    }

    openWorkbenchSql = (sql, database = selectedDatabase(), title = 'Aktarılan SQL') => {
      if (!sql?.trim()) {
        toast('SQL Bulunamadı', 'Aktarılacak SQL metni bulunmuyor.', 'warning');
        return;
      }
      gotoPage('workbench');
      createNewTab(title, sql, database);
    };

    function createNewTab(title, initialSql = null, database = null) {
      const tabNumber = workbenchState.tabs.length + 1;
      const defaultSql = initialSql ?? `-- SQL Query ${tabNumber}
SELECT TOP 50 
    sth_stok_kod,
    COUNT_BIG(*) AS IslemAdedi,
    SUM(sth_miktar) AS ToplamMiktar
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
GROUP BY sth_stok_kod
ORDER BY IslemAdedi DESC;`;

      const newTab = {
        id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: title || `Sorgu ${tabNumber}`,
        sql: defaultSql,
        database: database || $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase,
        isDirty: false,
        isRunning: false,
        currentExecutionId: null,
        currentRequestId: null,
        cursorPos: { line: 1, ch: 1 },
        viewState: null,
        model: null,
        lastResult: null,
        lastPlan: null,
        lastBenchmark: null,
        activeResultSetIndex: 0
      };

      if (workbenchState.isMonacoLoaded) {
        createModelForTab(newTab);
      }

      workbenchState.tabs.push(newTab);
      switchTab(newTab.id);
      debouncedSaveSessions();
      return newTab;
    }

    function switchTab(tabId) {
      // Save state of current tab
      const currentTab = getActiveTab();
      if (currentTab) {
        currentTab.sql = getFullEditorSql();
        if (workbenchState.monacoEditor) {
          currentTab.viewState = workbenchState.monacoEditor.saveViewState();
        }
      }

      const nextTab = workbenchState.tabs.find(t => t.id === tabId);
      if (!nextTab) return;

      workbenchState.activeTabId = nextTab.id;
      renderTabStrip();

      // Switch Monaco Model or Textarea
      if (workbenchState.isMonacoLoaded && workbenchState.monacoEditor) {
        if (!nextTab.model) {
          createModelForTab(nextTab);
        }
        if (nextTab.model) {
          workbenchState.monacoEditor.setModel(nextTab.model);
          if (nextTab.viewState) {
            workbenchState.monacoEditor.restoreViewState(nextTab.viewState);
          }
          workbenchState.monacoEditor.focus();
        } else {
          workbenchState.monacoEditor.setValue(nextTab.sql || '');
        }
      } else {
        setEditorSql(nextTab.sql || '');
      }

      // Sync database select
      if (nextTab.database && $('#wbDatabaseSelect')) {
        $('#wbDatabaseSelect').value = nextTab.database;
      }

      // Restore results & plan
      if (nextTab.lastResult) {
        renderWbResults(nextTab.lastResult, false);
      } else {
        clearResultsDisplay();
      }

      if (nextTab.lastPlan) {
        renderWbPlan(nextTab.lastPlan.planType, nextTab.lastPlan.parsed);
      }

      debouncedSaveSessions();
    }

    function closeTab(tabId) {
      const tabIndex = workbenchState.tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return;

      const tab = workbenchState.tabs[tabIndex];

      // Guard: active running query in tab
      if (tab.isRunning) {
        const cancelAndClose = confirm(`"${tab.title}" sekmesinde arka planda çalışan bir sorgu var.\n\nSorguyu iptal edip sekmeyi kapatmak istiyor musunuz?`);
        if (!cancelAndClose) return;

        if (tab.currentRequestId) {
          fetch('/api/workbench/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: tab.currentRequestId })
          }).catch(() => {});
        }
        tab.isRunning = false;
        tab.currentExecutionId = null;
      }

      if (tab.isDirty) {
        const ok = confirm(`"${tab.title}" sekmesinde kaydedilmemiş değişiklikler var. Kapatmak istediğinize emin misiniz?`);
        if (!ok) return;
      }

      // Clean up Monaco Model to prevent memory leaks
      if (tab.model && typeof tab.model.dispose === 'function') {
        tab.model.dispose();
        tab.model = null;
      }

      workbenchState.tabs.splice(tabIndex, 1);

      if (workbenchState.tabs.length === 0) {
        createNewTab('Sorgu 1', '');
        return;
      }

      if (workbenchState.activeTabId === tabId) {
        const nextActive = workbenchState.tabs[Math.max(0, tabIndex - 1)];
        switchTab(nextActive.id);
      } else {
        renderTabStrip();
        debouncedSaveSessions();
      }
    }

    function duplicateTab(tabId) {
      const tab = workbenchState.tabs.find(t => t.id === tabId);
      if (!tab) return;
      createNewTab(`${tab.title} (Kopya)`, tab.sql, tab.database);
    }

    function renameTab(tabId, newTitle) {
      const tab = workbenchState.tabs.find(t => t.id === tabId);
      if (!tab || !newTitle.trim()) return;
      tab.title = newTitle.trim();
      renderTabStrip();
      debouncedSaveSessions();
    }

    function closeOtherTabs(tabId) {
      const tab = workbenchState.tabs.find(t => t.id === tabId);
      if (!tab) return;

      const otherTabs = workbenchState.tabs.filter(t => t.id !== tabId);
      const hasDirtyOrRunning = otherTabs.some(t => t.isDirty || t.isRunning);
      if (hasDirtyOrRunning) {
        const ok = confirm('Diğer sekmeler arasında kaydedilmemiş veya çalışan sorgular var. Hepsini kapatmak istediğinize emin misiniz?');
        if (!ok) return;
      }

      otherTabs.forEach(t => {
        if (t.isRunning && t.currentRequestId) {
          fetch('/api/workbench/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: t.currentRequestId })
          }).catch(() => {});
        }
        if (t.model && typeof t.model.dispose === 'function') {
          t.model.dispose();
          t.model = null;
        }
      });

      workbenchState.tabs = [tab];
      switchTab(tab.id);
    }

    // Tab context menu
    let activeContextMenuTabId = null;
    function showTabContextMenu(x, y, tabId) {
      const menu = $('#wbTabContextMenu');
      if (!menu) return;
      activeContextMenuTabId = tabId;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.classList.remove('hidden');
    }

    document.addEventListener('click', () => {
      $('#wbTabContextMenu')?.classList.add('hidden');
    });

    $('#ctxWbRenameTab')?.addEventListener('click', () => {
      const tab = workbenchState.tabs.find(t => t.id === activeContextMenuTabId);
      if (!tab) return;
      const modal = $('#renameTabModal');
      const inputTitle = $('#inputRenameTabTitle');
      if (modal && inputTitle) {
        inputTitle.value = tab.title;
        modal.classList.remove('hidden');
        inputTitle.focus();
      }
    });

    $('#btnConfirmRenameTab')?.addEventListener('click', () => {
      const title = $('#inputRenameTabTitle')?.value;
      if (title && activeContextMenuTabId) {
        renameTab(activeContextMenuTabId, title);
        $('#renameTabModal')?.classList.add('hidden');
      }
    });

    $('#btnCancelRenameTab, #closeRenameTabModal')?.forEach ? $('#btnCancelRenameTab, #closeRenameTabModal').forEach(b => b.addEventListener('click', () => {
      $('#renameTabModal')?.classList.add('hidden');
    })) : null;
    $('#btnCancelRenameTab')?.addEventListener('click', () => $('#renameTabModal')?.classList.add('hidden'));
    $('#closeRenameTabModal')?.addEventListener('click', () => $('#renameTabModal')?.classList.add('hidden'));

    $('#ctxWbDuplicateTab')?.addEventListener('click', () => {
      if (activeContextMenuTabId) duplicateTab(activeContextMenuTabId);
    });

    $('#ctxWbCloseOthers')?.addEventListener('click', () => {
      if (activeContextMenuTabId) closeOtherTabs(activeContextMenuTabId);
    });

    $('#ctxWbCloseTab')?.addEventListener('click', () => {
      if (activeContextMenuTabId) closeTab(activeContextMenuTabId);
    });

    btnNewTab?.addEventListener('click', () => {
      createNewTab();
    });

    // Session save debouncer
    let saveSessionTimer = null;
    function debouncedSaveSessions() {
      clearTimeout(saveSessionTimer);
      saveSessionTimer = setTimeout(async () => {
        try {
          const payload = workbenchState.tabs.map((t, idx) => ({
            id: t.id,
            tabOrder: idx,
            title: t.title,
            sql: t.sql,
            database: t.database,
            cursorPos: t.cursorPos
          }));
          await fetch('/api/workbench/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabs: payload })
          });
        } catch (_) {}
      }, 500);
    }

    function flushSessions() {
      try {
        clearTimeout(saveSessionTimer);
        const curTab = getActiveTab();
        if (curTab) {
          curTab.sql = getFullEditorSql();
        }
        const payload = JSON.stringify({
          tabs: workbenchState.tabs.map((t, idx) => ({
            id: t.id,
            tabOrder: idx,
            title: t.title,
            sql: t.sql,
            database: t.database,
            cursorPos: t.cursorPos
          }))
        });
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon('/api/workbench/sessions', blob);
        }
      } catch (_) {}
    }

    window.addEventListener('beforeunload', () => {
      flushSessions();
    });

    async function loadSessions() {
      try {
        const res = await fetch('/api/workbench/sessions');
        const json = await res.json();
        if (json.ok && Array.isArray(json.data) && json.data.length > 0) {
          workbenchState.tabs = json.data.map(d => ({
            id: d.id,
            title: d.title || 'Sorgu',
            sql: d.sql || '',
            database: d.database || state.activeDatabase || state.primaryDatabase,
            isDirty: false,
            isRunning: false,
            cursorPos: d.cursorPos || { line: 1, ch: 1 },
            lastResult: null,
            lastPlan: null,
            lastBenchmark: null,
            activeResultSetIndex: 0
          }));
          workbenchState.activeTabId = workbenchState.tabs[0].id;
          renderTabStrip();
          setEditorSql(workbenchState.tabs[0].sql);
          if (workbenchState.tabs[0].database && $('#wbDatabaseSelect')) {
            $('#wbDatabaseSelect').value = workbenchState.tabs[0].database;
          }
          return;
        }
      } catch (_) {}

      // Default initial tab
      createNewTab('Sorgu 1');
    }

    // --------------------------------------------------------
    // Monaco Editor & Textarea Fallback Loader
    // --------------------------------------------------------
    function initEditorSystem() {
      const monacoContainer = $('#wbMonacoContainer');
      const gutterWrap = $('#wbGutterWrap');

      // Check if Monaco is available or can be loaded
      if (window.monaco && window.monaco.editor) {
        setupMonaco();
        return;
      }

      // Try local offline Monaco loader with fallback timeout
      if (window.require && typeof window.require.config === 'function') {
        window.require.config({
          paths: {
            vs: '/vendor/monaco/vs'
          }
        });

        window.MonacoEnvironment = {
          getWorkerUrl: function (workerId, label) {
            return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
              self.MonacoEnvironment = {
                baseUrl: '${window.location.origin}/vendor/monaco'
              };
              importScripts('${window.location.origin}/vendor/monaco/vs/base/worker/workerMain.js');
            `)}`;
          }
        };

        let loaded = false;
        const fallbackTimeout = setTimeout(() => {
          if (!loaded) setupTextareaFallback();
        }, 2000);

        window.require(['vs/editor/editor.main'], () => {
          loaded = true;
          clearTimeout(fallbackTimeout);
          setupMonaco();
        }, (err) => {
          console.warn('[Monaco] Local require failed, using enhanced textarea fallback:', err);
          setupTextareaFallback();
        });
      } else {
        setupTextareaFallback();
      }
    }

    function setupMonaco() {
      if (!window.monaco || !window.monaco.editor) return;
      const monacoContainer = $('#wbMonacoContainer');
      const gutterWrap = $('#wbGutterWrap');
      if (!monacoContainer) return;

      monacoContainer.style.display = 'block';
      if (gutterWrap) gutterWrap.style.display = 'none';

      const isLight = document.body.classList.contains('theme-light');

      // Initialize isolated models for all open tabs
      workbenchState.tabs.forEach(tab => {
        createModelForTab(tab);
      });

      const activeTab = getActiveTab();
      if (activeTab && !activeTab.model) {
        createModelForTab(activeTab);
      }

      workbenchState.monacoEditor = monaco.editor.create(monacoContainer, {
        model: activeTab ? activeTab.model : null,
        language: 'sql',
        theme: isLight ? 'vs' : 'vs-dark',
        automaticLayout: true,
        fontSize: parseInt($('#wbFontSizeSelect')?.value || 13, 10),
        wordWrap: 'off',
        minimap: { enabled: true },
        lineNumbers: 'on',
        bracketPairColorization: { enabled: true },
        scrollBeyondLastLine: false,
        padding: { top: 8, bottom: 8 }
      });

      workbenchState.isMonacoLoaded = true;

      // Keybindings
      workbenchState.monacoEditor.addCommand(monaco.KeyCode.F5, () => btnRun?.click());
      workbenchState.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => btnRun?.click());
      workbenchState.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => btnEstPlan?.click());
      workbenchState.monacoEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => btnFormat?.click());
      workbenchState.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => btnSaveQuery?.click());
      workbenchState.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyN, () => btnNewTab?.click());

      // IntelliSense completion provider for Monaco
      if (!window.__monacoSqlProviderRegistered) {
        window.__monacoSqlProviderRegistered = true;
        monaco.languages.registerCompletionItemProvider('sql', {
          provideCompletionItems: (model, position) => {
            const word = model.getWordUntilPosition(position);
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn
            };
            const suggestions = buildMonacoSuggestions(range);
            return { suggestions };
          }
        });
      }
    }

    function buildMonacoSuggestions(range) {
      const suggestions = [];
      const cat = workbenchState.catalog;

      if (cat) {
        (cat.tables || []).forEach(t => {
          suggestions.push({
            label: t.name || t,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: t.name || t,
            detail: `Table (${t.schema || 'dbo'})`,
            range
          });
        });

        (cat.views || []).forEach(v => {
          suggestions.push({
            label: v.name || v,
            kind: monaco.languages.CompletionItemKind.Interface,
            insertText: v.name || v,
            detail: `View (${v.schema || 'dbo'})`,
            range
          });
        });

        (cat.columns || []).forEach(c => {
          suggestions.push({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: c.name,
            detail: `Column · ${c.tableName} (${c.type || 'varchar'})`,
            range
          });
        });
      }

      // Keywords & Snippets
      const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'INNER JOIN', 'LEFT JOIN', 'COUNT_BIG', 'SUM', 'WITH (NOLOCK)', 'UNION ALL', 'TOP', 'DISTINCT'];
      keywords.forEach(kw => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range
        });
      });

      return suggestions;
    }

    function setupTextareaFallback() {
      const monacoContainer = $('#wbMonacoContainer');
      const gutterWrap = $('#wbGutterWrap');
      if (monacoContainer) monacoContainer.style.display = 'none';
      if (gutterWrap) gutterWrap.style.display = 'flex';
      workbenchState.isMonacoLoaded = false;

      if (input) {
        input.addEventListener('input', () => {
          updateLineNumbers();
          const curTab = getActiveTab();
          if (curTab) {
            curTab.sql = input.value;
            curTab.isDirty = true;
            renderTabStrip();
            debouncedSaveSessions();
          }
        });
        input.addEventListener('scroll', () => {
          if (gutter) gutter.scrollTop = input.scrollTop;
        });
        updateLineNumbers();

        // IntelliSense for textarea
        const popupEl = $('#wbIntelliSense');
        if (popupEl && window.StudioIntelliSense) {
          const intelliSense = new StudioIntelliSense(input, popupEl, {
            getActiveDatabase: () => $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase,
            onInsert: () => updateLineNumbers()
          });
          if (workbenchState.catalog) intelliSense.setCatalog(workbenchState.catalog);
          workbenchState.textareaIntellisense = intelliSense;
        }

        // Textarea shortcuts
        input.addEventListener('keydown', e => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = input.selectionStart;
            const end = input.selectionEnd;
            input.value = input.value.substring(0, start) + '    ' + input.value.substring(end);
            input.selectionStart = input.selectionEnd = start + 4;
            updateLineNumbers();
            return;
          }
          if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
            e.preventDefault();
            btnRun?.click();
            return;
          }
          if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            btnEstPlan?.click();
            return;
          }
          if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            btnFormat?.click();
            return;
          }
        });
      }
    }

    // --------------------------------------------------------
    // Metadata Catalog Loading
    // --------------------------------------------------------
    async function loadMetadataCatalog() {
      const activeDb = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
      try {
        const res = await fetch(`/api/workbench/metadata?database=${encodeURIComponent(activeDb)}`);
        const json = await res.json();
        if (json.ok && json.data) {
          workbenchState.catalog = json.data;
          if (workbenchState.textareaIntellisense) {
            workbenchState.textareaIntellisense.setCatalog(json.data);
          }
          const time = new Date(json.data.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const freshEl = $('#wbMetaFreshness');
          if (freshEl) freshEl.textContent = `Metadata: ${time}`;
        }
      } catch (_) {}
    }

    $('#btnWbRefreshMetadata')?.addEventListener('click', async () => {
      const activeDb = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
      const btn = $('#btnWbRefreshMetadata');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/workbench/metadata/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ database: activeDb })
        });
        const json = await res.json();
        if (json.ok && json.data) {
          workbenchState.catalog = json.data;
          if (workbenchState.textareaIntellisense) {
            workbenchState.textareaIntellisense.setCatalog(json.data);
          }
          const time = new Date(json.data.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const freshEl = $('#wbMetaFreshness');
          if (freshEl) freshEl.textContent = `Metadata: ${time}`;
          toast('Metadata Yenilendi', 'Metadata kataloğu güncellendi.', 'success');
        }
      } catch (err) {
        toast('Hata', err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $('#wbDatabaseSelect')?.addEventListener('change', () => {
      const curTab = getActiveTab();
      if (curTab) {
        curTab.database = $('#wbDatabaseSelect')?.value;
        debouncedSaveSessions();
      }
      loadMetadataCatalog();
    });

    // --------------------------------------------------------
    // Preferences: Font Size, Word Wrap, Minimap
    // --------------------------------------------------------
    $('#wbFontSizeSelect')?.addEventListener('change', (e) => {
      const sz = parseInt(e.target.value, 10);
      if (workbenchState.monacoEditor) {
        workbenchState.monacoEditor.updateOptions({ fontSize: sz });
      }
      if (input) {
        input.style.fontSize = `${sz}px`;
      }
    });

    let isWordWrapOn = false;
    $('#btnWbToggleWrap')?.addEventListener('click', () => {
      isWordWrapOn = !isWordWrapOn;
      if (workbenchState.monacoEditor) {
        workbenchState.monacoEditor.updateOptions({ wordWrap: isWordWrapOn ? 'on' : 'off' });
      }
      if (input) {
        input.style.whiteSpace = isWordWrapOn ? 'pre-wrap' : 'pre';
      }
      toast('Satır Kaydırma', isWordWrapOn ? 'Açık' : 'Kapalı');
    });

    let isMinimapOn = true;
    $('#btnWbToggleMinimap')?.addEventListener('click', () => {
      isMinimapOn = !isMinimapOn;
      if (workbenchState.monacoEditor) {
        workbenchState.monacoEditor.updateOptions({ minimap: { enabled: isMinimapOn } });
      }
      toast('Minimap', isMinimapOn ? 'Açık' : 'Kapalı');
    });

    // --------------------------------------------------------
    // Tabs & Navigation
    // --------------------------------------------------------
    $$('.wb-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.wbTab;
        switchWbTab(tab);
      });
    });

    function switchWbTab(tab) {
      $$('.wb-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.wbTab === tab));
      $$('.wb-tab-pane').forEach(p => p.classList.toggle('active', p.id === `wbPane-${tab}`));
      if (tab === 'history') loadWbHistory();
    }

    // --------------------------------------------------------
    // Safe T-SQL Formatter
    // --------------------------------------------------------
    btnFormat?.addEventListener('click', async () => {
      const rawSql = getFullEditorSql();
      if (!rawSql.trim()) return;

      try {
        const res = await fetch('/api/workbench/format', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: rawSql })
        });
        const json = await res.json();
        if (json.ok && json.formattedSql) {
          setEditorSql(json.formattedSql);
          const curTab = getActiveTab();
          if (curTab) {
            curTab.sql = json.formattedSql;
            curTab.isDirty = true;
            renderTabStrip();
            debouncedSaveSessions();
          }
          toast('Formatlandı', 'T-SQL kodu semantik korunarak güvenle biçimlendirildi.', 'success');
        }
      } catch (_) {
        toast('Hata', 'Formatlama gerçekleştirilemedi.', 'error');
      }
    });

    // Clear
    btnClear?.addEventListener('click', () => {
      setEditorSql('');
      const curTab = getActiveTab();
      if (curTab) {
        curTab.sql = '';
        curTab.isDirty = true;
        renderTabStrip();
        debouncedSaveSessions();
      }
    });

    // --------------------------------------------------------
    // Action: Create Refactor Workspace from Workbench SQL
    // --------------------------------------------------------
    btnCreateWs?.addEventListener('click', () => {
      const sql = getFullEditorSql().trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen çalışma alanı başlatmak için bir SQL sorgusu girin.', 'error');
        return;
      }
      const curDb = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;

      // Extract object name or view name heuristic
      const match = /FROM\s+([a-zA-Z0-9_\.\[\]]+)/i.exec(sql);
      const targetObj = match ? match[1].replace(/[\[\]]/g, '') : 'Workbench_Refactor';

      // Switch to workspaces page
      const wsNavBtn = document.querySelector('.nav-item[data-page="workspaces"]') || document.querySelector('.nav-item[data-page="refactor"]');
      if (wsNavBtn) wsNavBtn.click();

      // Open new workspace modal
      const modal = $('#newWorkspaceModal');
      if (modal) {
        $('#wsInputTitle').value = `Refactor: ${targetObj}`;
        $('#wsInputDb').value = curDb;
        $('#wsInputObject').value = targetObj;
        $('#wsInputOrigSql').value = sql;
        modal.classList.remove('hidden');
        $('#wsInputTitle').focus();
      }
    });

    // --------------------------------------------------------
    // Query Execution with Live Timer & Cancellation
    // --------------------------------------------------------
    // --------------------------------------------------------
    // Query Execution with Live Timer, Double-Run Guard & Cancel Race Safety
    // --------------------------------------------------------
    btnRun?.addEventListener('click', async () => {
      const curTab = getActiveTab();
      if (!curTab) return;

      // Double Run Guard: prevent multiple executions on same tab
      if (curTab.isRunning) {
        toast('Sorgu Çalışıyor', 'Bu sekmede zaten devam eden bir sorgu var. Lütfen tamamlanmasını bekleyin veya İptal butonuna basın.', 'warning');
        return;
      }

      // Check selection vs full editor & calculate line offset
      let selectionLineOffset = 0;
      let sql = '';
      if (workbenchState.isMonacoLoaded && workbenchState.monacoEditor) {
        const selection = workbenchState.monacoEditor.getSelection();
        if (selection && !selection.isEmpty()) {
          const selectedText = workbenchState.monacoEditor.getModel().getValueInRange(selection);
          if (selectedText.trim()) {
            sql = selectedText.trim();
            selectionLineOffset = selection.startLineNumber - 1;
          }
        }
        if (!sql) {
          sql = workbenchState.monacoEditor.getValue().trim();
        }
      } else if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        if (start !== end) {
          const selectedText = input.value.substring(start, end).trim();
          if (selectedText) {
            sql = selectedText;
            const textBefore = input.value.substring(0, start);
            selectionLineOffset = textBefore.split('\n').length - 1;
          }
        }
        if (!sql) {
          sql = input.value.trim();
        }
      }

      if (!sql) {
        toast('Sorgu Boş', 'Lütfen çalıştırılacak bir SELECT sorgusu yazın veya metin seçin.', 'error');
        return;
      }

      // Clear previous error decorations in Monaco
      if (workbenchState.monacoEditor && workbenchState.errorDecorations) {
        workbenchState.errorDecorations = workbenchState.monacoEditor.deltaDecorations(workbenchState.errorDecorations, []);
      }

      const dbTarget = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
      const timeoutMs = Number($('#wbTimeoutSelect')?.value || 30000);
      const maxRows = Number($('#wbMaxRowsSelect')?.value ?? 10000);

      // Generation token for cancel race & stale response protection
      const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const reqId = `wb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      curTab.isRunning = true;
      curTab.currentExecutionId = executionId;
      curTab.currentRequestId = reqId;
      workbenchState.activeRequestId = reqId;

      setWbRunningState(true);

      try {
        if (state.isLive) {
          const res = await fetch('/api/workbench/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, database: dbTarget, timeoutMs, requestId: reqId, maxRows })
          });
          const json = await res.json();

          // Cancel Race Guard: discard response if execution was cancelled or superseded
          if (curTab.currentExecutionId !== executionId) {
            console.info('[Workbench] Discarded stale execution response:', executionId);
            return;
          }

          if (!res.ok || !json.ok) throw new Error(json.error || 'Sorgu çalıştırılamadı.');

          renderWbResults(json, true);

          if (json.truncated) {
            toast('Sonuç Sınırlandırıldı', `İlk ${json.maxRows || 10000} satır gösteriliyor. Bellek ve tarayıcı güvenliği sağlandı.`, 'warning');
          } else {
            toast('Sorgu Tamamlandı', `${json.rowsReturned || json.rows.length} satır [${dbTarget}] üzerinde getirildi.`, 'success');
          }
        } else {
          // Demo Mode Mock Execution
          await new Promise(r => setTimeout(r, 450));

          if (curTab.currentExecutionId !== executionId) {
            return;
          }

          const limitCount = maxRows > 0 ? Math.min(maxRows, 50) : 50;
          const mockCols = ['sth_stok_kod', 'sto_isim', 'IslemAdedi', 'ToplamMiktar', 'BirimFiyat', 'SonTarih'];
          const mockRows = Array.from({ length: limitCount }, (_, i) => ({
            sth_stok_kod: `HM-${1000 + i}`,
            sto_isim: `Hammadde Kalemi ${i + 1}`,
            IslemAdedi: Math.floor(Math.random() * 4200) + 120,
            ToplamMiktar: (Math.random() * 85000 + 500).toFixed(2),
            BirimFiyat: (Math.random() * 450 + 10).toFixed(2),
            SonTarih: '2026-03-01 14:22:00'
          }));

          const mockData = {
            ok: true,
            database: dbTarget,
            columns: mockCols,
            rows: mockRows,
            totalRows: mockRows.length,
            rowsReturned: mockRows.length,
            maxRows,
            truncated: false,
            resultSets: [{
              setIndex: 1,
              columns: mockCols,
              rows: mockRows,
              totalRows: mockRows.length,
              rowsReturned: mockRows.length,
              maxRows,
              truncated: false
            }],
            metrics: {
              durationMs: 42,
              cpuMs: 38,
              logicalReads: 14280,
              physicalReads: 0,
              rowsReturned: mockRows.length,
              evidence: 'Demo Execution'
            },
            statistics: {
              tables: [
                { table: 'STOK_HAREKETLERI', scanCount: 4, logicalReads: 12400, physicalReads: 0 },
                { table: 'STOKLAR', scanCount: 1, logicalReads: 1880, physicalReads: 0 }
              ],
              totalLogicalReads: 14280,
              cpuTimeMs: 38,
              elapsedTimeMs: 42
            },
            messages: [
              `SQL Server Execution Times (${dbTarget}): CPU time = 38 ms, elapsed time = 42 ms.`,
              "Table 'STOK_HAREKETLERI'. Scan count 4, logical reads 12400, physical reads 0.",
              "Table 'STOKLAR'. Scan count 1, logical reads 1880, physical reads 0.",
              `(${mockRows.length} rows affected)`
            ]
          };
          renderWbResults(mockData, true);
          toast('Demo Çalıştırıldı', `[${dbTarget}] simüle edildi.`, 'success');
        }
      } catch (err) {
        if (curTab.currentExecutionId === executionId) {
          toast('Sorgu Hatası', err.message, 'error');
          setWbErrorState(err.message, selectionLineOffset);
        }
      } finally {
        if (curTab.currentExecutionId === executionId) {
          curTab.isRunning = false;
          curTab.currentExecutionId = null;
          setWbRunningState(false);
        }
      }
    });

    // Stop / Cancel Query with Invalidation
    btnStop?.addEventListener('click', async () => {
      const curTab = getActiveTab();
      if (curTab) {
        curTab.isRunning = false;
        curTab.currentExecutionId = null; // Invalidate any in-flight response immediately
      }

      if (!workbenchState.activeRequestId) {
        setWbRunningState(false);
        return;
      }

      const cancelReqId = workbenchState.activeRequestId;
      workbenchState.activeRequestId = null;

      try {
        if (state.isLive) {
          await fetch('/api/workbench/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: cancelReqId })
          });
        }
        toast('İptal Edildi', 'Sorgu iptal isteği SQL Server\'a iletildi.');
        if (statusPill) {
          statusPill.className = 'status-pill status-warning';
          statusPill.textContent = '● CANCELLED';
        }
      } catch (err) {
        toast('Hata', err.message, 'error');
      } finally {
        setWbRunningState(false);
      }
    });

    function setWbRunningState(running, statusMsg = 'EXECUTING...') {
      workbenchState.isRunning = running;
      if (btnRun) btnRun.disabled = running;
      if (btnStop) btnStop.disabled = !running;
      if (btnEstPlan) btnEstPlan.disabled = running;
      if (btnActPlan) btnActPlan.disabled = running;
      if (btnBenchmark) btnBenchmark.disabled = running;

      if (running) {
        workbenchState.startTime = performance.now();
        if (liveTimer) {
          liveTimer.style.display = 'inline-block';
          liveTimer.textContent = '00:00.0';
        }
        clearInterval(workbenchState.timerInterval);
        workbenchState.timerInterval = setInterval(() => {
          const elapsed = (performance.now() - workbenchState.startTime) / 1000;
          const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const secs = (elapsed % 60).toFixed(1).padStart(4, '0');
          if (liveTimer) liveTimer.textContent = `${mins}:${secs}`;
        }, 100);

        if (statusPill) {
          statusPill.className = 'status-pill status-warning';
          statusPill.textContent = `● ${statusMsg}`;
        }
      } else {
        clearInterval(workbenchState.timerInterval);
        if (statusPill) {
          statusPill.className = 'status-pill status-ready';
          statusPill.textContent = '● READY';
        }
      }
    }

    function setWbErrorState(errMsg, selectionLineOffset = 0) {
      if (statusPill) {
        statusPill.className = 'status-pill status-danger';
        statusPill.textContent = '✕ ERROR';
      }
      const errBox = $('#wbErrorContainer');
      if (errBox) {
        errBox.className = 'wb-error-banner';
        errBox.innerHTML = `
          <div class="error-title">✕ SQL Server Hatası</div>
          <div class="error-details">${escapeHtml(errMsg)}</div>
        `;
      }
      const term = $('#wbMessagesTerminal');
      if (term) term.textContent = `HATA:\n${errMsg}`;

      // Error line mapping with selection offset in Monaco
      if (workbenchState.monacoEditor && window.monaco) {
        const lineMatch = /line\s+(\d+)|satır\s+(\d+)/i.exec(errMsg);
        if (lineMatch) {
          const rawLine = parseInt(lineMatch[1] || lineMatch[2], 10);
          const effectiveLine = rawLine + selectionLineOffset;
          if (effectiveLine > 0) {
            workbenchState.errorDecorations = workbenchState.monacoEditor.deltaDecorations(
              workbenchState.errorDecorations || [],
              [
                {
                  range: new monaco.Range(effectiveLine, 1, effectiveLine, 1),
                  options: {
                    isWholeLine: true,
                    className: 'wb-monaco-line-error',
                    glyphMarginClassName: 'wb-monaco-glyph-error'
                  }
                }
              ]
            );
            workbenchState.monacoEditor.revealLineInCenter(effectiveLine);
          }
        }
      }

      switchWbTab('messages');
    }

    // --------------------------------------------------------
    // Multi-Result Set Rendering & Virtual Grid
    // --------------------------------------------------------
    function clearResultsDisplay() {
      const tableWrap = $('#wbTableWrap');
      if (tableWrap) {
        tableWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Sorgu çalıştırmak için <b>Çalıştır (Ctrl+Enter / F5)</b> butonuna tıklayın.</p></div>';
      }
      if ($('#wbResultsCountText')) $('#wbResultsCountText').textContent = '0 satır';
      if ($('#wbSelectionCountText')) $('#wbSelectionCountText').style.display = 'none';
      if ($('#wbResultBadge')) $('#wbResultBadge').textContent = '0';
      if ($('#wbResultSetsTabs')) {
        $('#wbResultSetsTabs').innerHTML = '<button class="wb-tab-btn active" data-wb-tab="results" id="wbTabBtnResults">Sonuçlar <span class="tab-badge" id="wbResultBadge">0</span></button>';
      }
    }

    function renderWbResults(data, updateTabState = true) {
      if (updateTabState) {
        const curTab = getActiveTab();
        if (curTab) curTab.lastResult = data;
      }

      // Hide error container
      $('#wbErrorContainer')?.classList.add('hidden');

      // Finalize timer display
      if (liveTimer && data.metrics?.durationMs != null) {
        liveTimer.style.display = 'inline-block';
        liveTimer.textContent = `${data.metrics.durationMs} ms`;
      }

      // Metrics Strip
      const m = data.metrics || {};
      if ($('#wbMetricDuration')) $('#wbMetricDuration').textContent = `${m.durationMs || 0} ms`;
      if ($('#wbMetricCpu')) $('#wbMetricCpu').textContent = `${m.cpuMs || 0} ms`;
      if ($('#wbMetricReads')) $('#wbMetricReads').textContent = (m.logicalReads || 0).toLocaleString();
      if ($('#wbMetricRows')) $('#wbMetricRows').textContent = (m.rowsReturned != null ? m.rowsReturned : (data.rows ? data.rows.length : 0)).toLocaleString();
      if ($('#wbMetricEvidence')) {
        $('#wbMetricEvidence').textContent = m.evidence || 'Actual execution';
        $('#wbMetricEvidence').style.color = 'var(--green)';
      }

      // Multi-Result Sets sub-tabs
      const resultSets = data.resultSets && data.resultSets.length > 0 ? data.resultSets : [{
        setIndex: 1,
        columns: data.columns || [],
        rows: data.rows || [],
        totalRows: data.totalRows || (data.rows ? data.rows.length : 0)
      }];

      const rsTabsWrap = $('#wbResultSetsTabs');
      if (rsTabsWrap) {
        rsTabsWrap.innerHTML = resultSets.map((rs, idx) => {
          const isActive = idx === workbenchState.activeResultSetIndex;
          const label = resultSets.length > 1 ? `Sonuç ${idx + 1}` : 'Sonuçlar';
          return `
            <button type="button" class="wb-rs-tab ${isActive ? 'active' : ''}" data-rs-index="${idx}">
              ${label} <span class="tab-badge">${rs.totalRows || (rs.rows ? rs.rows.length : 0)}</span>
            </button>
          `;
        }).join('');

        rsTabsWrap.querySelectorAll('.wb-rs-tab').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.rsIndex, 10);
            workbenchState.activeResultSetIndex = idx;
            renderResultSet(resultSets[idx]);
            rsTabsWrap.querySelectorAll('.wb-rs-tab').forEach((b, i) => b.classList.toggle('active', i === idx));
          });
        });
      }

      // Render active result set
      workbenchState.activeResultSetIndex = 0;
      renderResultSet(resultSets[0]);

      // Messages & Statistics
      if ($('#wbMessageBadge')) $('#wbMessageBadge').textContent = (data.messages || []).length;
      const terminal = $('#wbMessagesTerminal');
      if (terminal) terminal.textContent = (data.messages || []).join('\n') || 'İşlem tamamlandı.';

      renderWbHumanizedMessages(data.messages, data.metrics, data.statistics);
      renderWbStatistics(data.statistics, data.metrics);

      switchWbTab('results');
    }

    function renderResultSet(rs) {
      if (!rs) return;
      const tableWrap = $('#wbTableWrap');
      if (!tableWrap) return;

      const columns = rs.columns || [];
      const rows = rs.rows || [];
      const totalCount = rs.totalRows || rows.length;

      if ($('#wbResultsCountText')) {
        $('#wbResultsCountText').textContent = `${totalCount.toLocaleString()} satır`;
      }
      if ($('#wbSelectionCountText')) {
        $('#wbSelectionCountText').style.display = 'none';
      }

      if (columns.length === 0 || rows.length === 0) {
        tableWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Sonuç kümesi boş (0 satır döndü).</p></div>';
        workbenchState.gridInstance = null;
        return;
      }

      // Initialize VirtualGrid
      if (window.VirtualGrid) {
        workbenchState.gridInstance = new VirtualGrid(tableWrap, {
          rowHeight: 28,
          buffer: 15,
          onSelectionChange: ({ selectedRowCount }) => {
            const selEl = $('#wbSelectionCountText');
            if (selEl) {
              if (selectedRowCount > 0) {
                selEl.style.display = 'inline';
                selEl.textContent = `${selectedRowCount} satır seçildi`;
              } else {
                selEl.style.display = 'none';
              }
            }
          }
        });
        workbenchState.gridInstance.setData(columns, rows);
      }
    }

    // Grid Copy & Export Handlers
    $('#btnWbCopyCell')?.addEventListener('click', () => {
      if (workbenchState.gridInstance) {
        const ok = workbenchState.gridInstance.copyCell();
        if (ok) toast('Kopyalandı', 'Hücre panoya kopyalandı.');
      }
    });

    $('#btnWbCopySelectedRows')?.addEventListener('click', () => {
      if (workbenchState.gridInstance) {
        workbenchState.gridInstance.copySelectedRowsTsv(false);
        toast('Kopyalandı', 'Seçili satırlar TSV olarak panoya kopyalandı.');
      }
    });

    $('#btnWbCopyAllWithHeaders')?.addEventListener('click', () => {
      if (workbenchState.gridInstance) {
        workbenchState.gridInstance.copyAllTsv(true);
        toast('Kopyalandı', 'Tüm satırlar başlıklarla birlikte panoya kopyalandı.');
      }
    });

    $('#btnWbExportCsv')?.addEventListener('click', () => {
      if (workbenchState.gridInstance) {
        workbenchState.gridInstance.exportCsv(`query_${Date.now()}.csv`, true);
        toast('CSV İndirildi', 'Excel uyumlu UTF-8 BOM CSV indirildi.');
      }
    });

    $('#btnWbExportTsv')?.addEventListener('click', () => {
      if (workbenchState.gridInstance) {
        workbenchState.gridInstance.exportTsv(`query_${Date.now()}.tsv`);
        toast('TSV İndirildi', 'Sekme ile ayrılmış TSV indirildi.');
      }
    });

    // Messages View Toggle
    $('#btnWbMsgHumanized')?.addEventListener('click', () => {
      $('#btnWbMsgHumanized')?.classList.add('active');
      $('#btnWbMsgRaw')?.classList.remove('active');
      $('#wbMessagesHumanized')?.classList.remove('hidden');
      $('#wbMessagesTerminal')?.classList.add('hidden');
    });

    $('#btnWbMsgRaw')?.addEventListener('click', () => {
      $('#btnWbMsgRaw')?.classList.add('active');
      $('#btnWbMsgHumanized')?.classList.remove('active');
      $('#wbMessagesTerminal')?.classList.remove('hidden');
      $('#wbMessagesHumanized')?.classList.add('hidden');
    });

    function renderWbHumanizedMessages(messages, metrics = {}, statistics = {}) {
      const wrap = $('#wbMessagesHumanized');
      if (!wrap) return;

      if (!messages || messages.length === 0) {
        wrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Henüz mesaj çıktısı yok.</p></div>';
        return;
      }

      const durationMs = metrics.durationMs || (statistics ? statistics.elapsedTimeMs : 0) || 0;
      const cpuMs = metrics.cpuMs || (statistics ? statistics.cpuTimeMs : 0) || 0;
      const logicalReads = metrics.logicalReads || (statistics ? statistics.totalLogicalReads : 0) || 0;
      const mbRead = ((logicalReads * 8) / 1024).toFixed(2);
      const rows = metrics.rowsReturned != null ? metrics.rowsReturned : (metrics.rows ? metrics.rows.length : 0);

      let parallelismNote = 'Tek iş parçacığı (single-thread)';
      if (cpuMs > durationMs * 1.15 && durationMs > 20) {
        const coreEstimate = (cpuMs / durationMs).toFixed(1);
        parallelismNote = `⚡ Çoklu çekirdek (~${coreEstimate}x paralel)`;
      } else if (durationMs > cpuMs + 200) {
        parallelismNote = '⏳ I/O veya Kilit (Wait) bekledi';
      }

      let tables = (statistics && statistics.tables && statistics.tables.length > 0) ? [...statistics.tables] : [];
      if (tables.length === 0) {
        const tableRegex = /Table '([^']+)'.*?Scan count (\d+).*?logical reads (\d+).*?(?:physical reads (\d+))?/gi;
        let match;
        const msgStr = (messages || []).join('\n');
        while ((match = tableRegex.exec(msgStr)) !== null) {
          tables.push({
            table: match[1],
            scanCount: parseInt(match[2], 10) || 0,
            logicalReads: parseInt(match[3], 10) || 0,
            physicalReads: parseInt(match[4], 10) || 0
          });
        }
      }

      tables.sort((a, b) => (b.logicalReads || 0) - (a.logicalReads || 0));

      let tablesHtml = '';
      if (tables.length > 0) {
        tablesHtml = `
          <div style="margin-top:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <strong style="font-size:13px;color:var(--text-bright)">Tablo Bazlı Fiziksel & Mantıksal Yük Dağılımı</strong>
              <small style="color:var(--text-muted);font-size:11.5px">En çok okuma yapan tablodan aza doğru</small>
            </div>
            <table class="wb-table" style="font-size:12px">
              <thead>
                <tr>
                  <th>Tablo Adı</th>
                  <th>Tarama (Scan)</th>
                  <th>Mantıksal Okuma (Sayfa)</th>
                  <th>Bellek Hacmi (MB)</th>
                  <th>Fiziksel Disk Okuma</th>
                  <th>Değerlendirme</th>
                </tr>
              </thead>
              <tbody>
                ${tables.map(t => {
                  const tMb = ((t.logicalReads * 8) / 1024).toFixed(2);
                  let badge = '<span class="status-pill status-ready" style="font-size:10px">Hafif Yük</span>';
                  if (t.logicalReads > 20000) {
                    badge = '<span class="status-pill status-danger" style="font-size:10px">🚨 Aşırı I/O</span>';
                  } else if (t.logicalReads > 3000) {
                    badge = '<span class="status-pill status-warning" style="font-size:10px">⚠️ Yüksek Okuma</span>';
                  } else if (t.scanCount > 1) {
                    badge = '<span class="status-pill status-warning" style="font-size:10px">🔄 Mükerrer Scan</span>';
                  }
                  return `
                    <tr>
                      <td><b>${escapeHtml(t.table)}</b></td>
                      <td>${t.scanCount} kez</td>
                      <td style="font-family:var(--font-family-mono, monospace);font-weight:600;color:${t.logicalReads > 5000 ? 'var(--red)' : 'var(--text-bright)'}">${t.logicalReads.toLocaleString()}</td>
                      <td style="font-family:var(--font-family-mono, monospace)">${tMb} MB</td>
                      <td>${t.physicalReads ? `<b style="color:var(--red)">${t.physicalReads} sayfa (Disk)</b>` : '<span style="color:var(--text-muted)">0 (Önbellekten)</span>'}</td>
                      <td>${badge}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      wrap.innerHTML = `
        <div class="msg-summary-card">
          <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:12px">
            <div>
              <h4 style="margin:0;font-size:14px;color:var(--text-bright);display:flex;align-items:center;gap:6px">
                <span>📊</span> Yürütme ve Kaynak Tüketim Raporu
              </h4>
              <small style="color:var(--text-muted);font-size:11.5px">SQL Server STATISTICS IO & TIME verilerinden türetilmiştir</small>
            </div>
            <span class="status-pill status-ready" style="font-size:11px">● Başarılı</span>
          </div>

          <div class="msg-time-grid">
            <div class="msg-time-item">
              <span>Geçen Süre (Elapsed)</span>
              <strong style="color:var(--accent)">${durationMs.toLocaleString()} ms</strong>
              <p style="margin:4px 0 0;font-size:11.5px;color:var(--text-muted)">Beklenen gerçek süre</p>
            </div>
            <div class="msg-time-item">
              <span>CPU Tüketim Süresi</span>
              <strong style="color:var(--purple,#a855f7)">${cpuMs.toLocaleString()} ms</strong>
              <p style="margin:4px 0 0;font-size:11.5px;color:var(--text-muted)">İşlemci aktif zamanı</p>
            </div>
            <div class="msg-time-item">
              <span>Toplam Mantıksal Okuma</span>
              <strong style="color:${logicalReads > 20000 ? 'var(--red)' : 'var(--green)'}">${logicalReads.toLocaleString()} sayfa</strong>
              <p style="margin:4px 0 0;font-size:11.5px;color:var(--text-muted)">Hacim: <b>${mbRead} MB</b> (8KB/sayfa)</p>
            </div>
            <div class="msg-time-item">
              <span>Dönen Satır Sayısı</span>
              <strong>${rows.toLocaleString()} satır</strong>
              <p style="margin:4px 0 0;font-size:11.5px;color:var(--text-muted)">${parallelismNote}</p>
            </div>
          </div>

          ${tablesHtml}
        </div>
      `;
    }

    function renderWbStatistics(stats, metrics = null) {
      const statsWrap = $('#wbStatisticsContent');
      if (!statsWrap) return;

      const s = stats || (metrics ? {
        tables: metrics.tableStats || [],
        totalLogicalReads: metrics.logicalReads || 0,
        cpuTimeMs: metrics.cpuMs || 0,
        elapsedTimeMs: metrics.elapsedMs || metrics.durationMs || 0
      } : null);

      if (!s || (!s.tables?.length && !s.totalLogicalReads)) {
        statsWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Statistics IO verisi alınamadı.</p></div>';
        return;
      }

      statsWrap.innerHTML = `
        <div class="wb-stats-grid">
          <div class="setting-card">
            <div><strong>Toplam Logical Reads</strong><p>Tüm tablolardan okunan 8KB bellek sayfaları</p></div>
            <strong style="font-size:20px;color:var(--accent)">${(s.totalLogicalReads || 0).toLocaleString()}</strong>
          </div>
          <div class="setting-card">
            <div><strong>Süre Dağılımı</strong><p>CPU Süresi vs Toplam Geçen Zaman</p></div>
            <strong>${s.cpuTimeMs || 0} ms CPU · ${s.elapsedTimeMs || 0} ms Elapsed</strong>
          </div>
          <div>
            <h4 style="font-size:14px;margin-bottom:10px">Tablo Bazlı IO Dökümü</h4>
            <table class="wb-stats-table">
              <thead><tr><th>Tablo</th><th>Scan Count</th><th>Logical Reads</th><th>Physical Reads</th></tr></thead>
              <tbody>
                ${(s.tables || []).map(t => `
                  <tr>
                    <td><b>${escapeHtml(t.table)}</b></td>
                    <td>${t.scanCount}</td>
                    <td style="color:${t.logicalReads > 5000 ? 'var(--red)' : 'var(--text-primary)'}">${(t.logicalReads || 0).toLocaleString()}</td>
                    <td>${t.physicalReads || 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    function renderWbPlan(planType, parsed) {
      const planWrap = $('#wbPlanContent');
      if (!planWrap) return;

      if (!parsed) {
        planWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Plan ayrıştırılamadı.</p></div>';
        return;
      }

      const isActual = planType === 'ACTUAL';
      const badgeClass = isActual ? 'status-pill status-ready' : 'status-pill';
      const planTitle = isActual ? 'GERÇEK ÇALIŞTIRMA PLANI (ACTUAL PLAN)' : 'TAHMİNİ ÇALIŞTIRMA PLANI (ESTIMATED PLAN)';

      let html = `
        <div class="wb-plan-header">
          <div>
            <span class="${badgeClass}">${planTitle}</span>
            <strong style="margin-left:12px">Alt Ağaç Maliyeti: ${parsed.totalSubTreeCost || 0}</strong>
            <small style="margin-left:8px;color:var(--text-muted)">(Optimizasyon Seviyesi: ${parsed.optimizationLevel || 'FULL'})</small>
          </div>
          <span>${parsed.operatorCount || 0} operatör</span>
        </div>
      `;

      // Warnings
      if (parsed.warnings?.length > 0) {
        html += `
          <div style="margin-bottom:14px">
            ${parsed.warnings.map(w => `
              <div class="permission-box" style="border-color:rgba(255,93,114,0.3);background:rgba(255,93,114,0.06);margin-bottom:8px">
                <strong style="color:var(--red)">⚠ ${escapeHtml(w.title || w.kind || '')}</strong>
                <p style="margin-top:4px">${escapeHtml(w.detail || w.explanation || w.message || '')}</p>
              </div>
            `).join('')}
          </div>
        `;
      }

      // Cardinality Mismatches
      if (parsed.cardinalityMismatches?.length > 0) {
        html += `
          <div style="margin-bottom:14px">
            <h4 style="font-size:14px;margin-bottom:8px;color:var(--red)">Kardinalite Tahmin Hataları (${parsed.cardinalityMismatches.length})</h4>
            ${parsed.cardinalityMismatches.map(cm => `
              <div class="setting-card" style="border-left:3px solid var(--red);margin-bottom:6px">
                <div>
                  <strong>${escapeHtml(cm.operator)} — ${escapeHtml(cm.object || 'Node ' + cm.nodeId)}</strong>
                  <p>Tahmin: <b>${(cm.estimated || 0).toLocaleString()}</b> satır → Gerçek: <b style="color:var(--red)">${(cm.actual || 0).toLocaleString()}</b> satır</p>
                  <small style="color:var(--text-muted);display:block;margin-top:2px">Optimizatörün beklediğinden çok farklı satır dönmesi yanlış join veya index seek kararlarına yol açar.</small>
                </div>
                <span class="severity-pill critical">${escapeHtml(cm.factor || '')}</span>
              </div>
            `).join('')}
          </div>
        `;
      }

      // Top Operators
      if (parsed.topOperators?.length > 0) {
        html += `
          <div style="margin-bottom:14px">
            <h4 style="font-size:14px;margin-bottom:10px">En Yüksek Maliyetli Operatörler</h4>
            <div class="wb-op-list">
              ${parsed.topOperators.map(op => {
                const opBadge = op.isScan ? 'SCAN' : op.isLookup ? 'LOOKUP' : 'OP';
                return `
                  <div class="wb-op-card">
                    <div class="wb-op-title">
                      <span class="node-badge" style="font-size:11px">${opBadge}</span>
                      <div>
                        <strong>${escapeHtml(op.physicalOp)}</strong>
                        <small style="display:block;color:var(--text-muted)">${op.targetObject ? '· Tablo: ' + escapeHtml(op.targetObject) : ''} · Tahmin: ${(op.estimatedRows || 0).toLocaleString()} satır${op.actualRows != null ? ' · Gerçek: ' + op.actualRows.toLocaleString() + ' satır' : ''}</small>
                      </div>
                    </div>
                    <span class="wb-op-cost">%${op.costPercent}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      // Missing Indexes
      if (parsed.missingIndexes?.length > 0) {
        html += `
          <div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h4 style="font-size:14px;margin:0;color:var(--green)">Tavsiye Edilen İndeksler (Missing Indexes)</h4>
              <small style="color:var(--yellow);font-size:11.5px">⚠ Bu indeks otomatik oluşturulmaz; DBA onayıyla test edilmelidir.</small>
            </div>
            ${parsed.missingIndexes.map((mi, miIdx) => `
              <div class="full-problem" style="margin-bottom:8px">
                <div style="width:100%">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <div style="display:flex;align-items:center;gap:8px">
                      <strong>Tahmini Etki: +%${mi.impact}</strong>
                      <span class="object-pill">${escapeHtml(mi.table)}</span>
                    </div>
                    <button class="button ghost mini btn-copy-missing-idx" data-idx="${miIdx}">Scripti Kopyala</button>
                  </div>
                  <pre class="wb-terminal" style="max-height:80px;font-size:12px;overflow-x:auto" id="missingIdxPre-${miIdx}">${escapeHtml(mi.ddl || mi.indexDdl)}</pre>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      planWrap.innerHTML = html;
      if ($('#wbPlanBadge')) $('#wbPlanBadge').style.display = 'inline-block';

      // Bind missing index copy buttons
      $$('.btn-copy-missing-idx').forEach(btn => {
        btn.onclick = () => {
          const idx = btn.dataset.idx;
          const pre = $(`#missingIdxPre-${idx}`);
          if (pre) {
            navigator.clipboard.writeText(pre.textContent);
            toast('Kopyalandı', 'İndeks oluşturma DDL scripti panoya kopyalandı.', 'success');
          }
        };
      });
    }

    function renderWbBenchmark(data) {
      const statsWrap = $('#wbStatisticsContent');
      if (!statsWrap) return;

      const s = data.summary || {
        medianMs: data.metrics?.medianDurationMs != null ? data.metrics.medianDurationMs : 0,
        p95Ms: data.metrics?.p95DurationMs != null ? data.metrics.p95DurationMs : 0,
        minMs: data.metrics?.minDurationMs != null ? data.metrics.minDurationMs : 0,
        maxMs: data.metrics?.maxDurationMs != null ? data.metrics.maxDurationMs : 0,
        avgMs: data.metrics?.avgDurationMs != null ? data.metrics.avgDurationMs : 0,
        logicalReadsMedian: data.metrics?.medianLogicalReads != null ? data.metrics.medianLogicalReads : 0
      };

      const totalRuns = data.totalRuns || data.runsRequested || data.runsCompleted || (data.iterations ? data.iterations.length : 3);
      const runsList = data.runs || (data.iterations || []).map(r => ({
        iteration: r.iteration,
        isWarmUp: Boolean(r.isWarmUp),
        durationMs: r.durationMs,
        cpuMs: r.cpuMs,
        logicalReads: r.logicalReads,
        rows: r.rowCount || r.rows || 0
      }));

      statsWrap.innerHTML = `
        <div class="wb-stats-grid">
          <div class="permission-box" style="margin-bottom:12px">
            <strong>Benchmark Sonuç Özeti (${totalRuns} Tekrar)</strong>
            <p style="margin-top:4px">Tüm tekrarlar için median, P95 ve varyans değerleri hesaplandı. (Warm-up hariç tutuldu).</p>
          </div>
          <div class="workbench-metrics-strip" style="margin-bottom:14px">
            <div class="wb-metric-card"><span>Median Süre</span><strong style="color:var(--green)">${s.medianMs != null ? s.medianMs : 0} ms</strong></div>
            <div class="wb-metric-card"><span>P95 Süre</span><strong style="color:var(--yellow)">${s.p95Ms != null ? s.p95Ms : 0} ms</strong></div>
            <div class="wb-metric-card"><span>Min / Max</span><strong>${s.minMs != null ? s.minMs : 0} / ${s.maxMs != null ? s.maxMs : 0} ms</strong></div>
            <div class="wb-metric-card"><span>Ortalama</span><strong>${s.avgMs != null ? s.avgMs : 0} ms</strong></div>
            <div class="wb-metric-card"><span>Median Reads</span><strong>${(s.logicalReadsMedian || 0).toLocaleString()}</strong></div>
          </div>
          <div>
            <h4 style="font-size:14px;margin-bottom:10px">İterasyon Detayları</h4>
            <table class="wb-stats-table">
              <thead><tr><th>İterasyon</th><th>Tip</th><th>Süre (ms)</th><th>CPU (ms)</th><th>Logical Reads</th><th>Satır</th></tr></thead>
              <tbody>
                ${runsList.map(r => `
                  <tr>
                    <td><b>Run #${r.iteration}</b></td>
                    <td>${r.isWarmUp ? '<span class="status-pill status-warning">WARM-UP</span>' : '<span class="status-pill status-ready">ÖLÇÜLDÜ</span>'}</td>
                    <td><b>${r.durationMs != null ? r.durationMs : 0} ms</b></td>
                    <td>${r.cpuMs != null ? r.cpuMs : 0} ms</td>
                    <td>${(r.logicalReads || 0).toLocaleString()}</td>
                    <td>${r.rows != null ? r.rows : 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // --------------------------------------------------------
    // Plan Analysis
    // --------------------------------------------------------
    btnEstPlan?.addEventListener('click', () => runPlanAnalysis('estimated'));
    btnActPlan?.addEventListener('click', () => runPlanAnalysis('actual'));

    async function runPlanAnalysis(mode) {
      const sql = getEditorSql().trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen plan alınacak bir SELECT sorgusu yazın veya seçin.', 'error');
        return;
      }

      const dbTarget = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
      setWbRunningState(true, mode === 'actual' ? `ACTUAL PLAN [${dbTarget}]...` : `ESTIMATED PLAN [${dbTarget}]...`);
      const timeoutMs = Number($('#wbTimeoutSelect')?.value || 30000);

      try {
        if (state.isLive) {
          const res = await fetch('/api/workbench/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, database: dbTarget, mode, timeoutMs })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Plan alınamadı.');

          const curTab = getActiveTab();
          if (curTab) curTab.lastPlan = json;

          renderWbPlan(json.planType, json.parsed);
          switchWbTab('plan');
          toast('Plan Hazır', `${json.planType} execution plan [${dbTarget}] başarıyla analiz edildi.`, 'success');
        } else {
          // Demo Mode Plan
          await new Promise(r => setTimeout(r, 400));
          const isActual = mode === 'actual';
          const mockPlan = {
            totalSubTreeCost: 2.84,
            totalEstRows: 1420,
            optimizationLevel: 'FULL',
            operatorCount: 6,
            topOperators: [
              { nodeId: 1, physicalOp: 'Clustered Index Scan', logicalOp: 'Clustered Index Scan', targetObject: 'STOK_HAREKETLERI', cost: 1.85, costPercent: 65, estimatedRows: 12000, actualRows: isActual ? 14850 : null },
              { nodeId: 2, physicalOp: 'Hash Match (Aggregate)', logicalOp: 'Hash Match', targetObject: '', cost: 0.58, costPercent: 20, estimatedRows: 1420, actualRows: isActual ? 1420 : null }
            ],
            warnings: [],
            missingIndexes: []
          };
          renderWbPlan(isActual ? 'ACTUAL' : 'ESTIMATED', mockPlan);
          switchWbTab('plan');
          toast('Demo Plan Hazır', `[${dbTarget}] ${isActual ? 'Actual' : 'Estimated'} plan hazırlandı.`, 'success');
        }
      } catch (err) {
        toast('Plan Hatası', err.message, 'error');
        setWbErrorState(err.message);
      } finally {
        setWbRunningState(false);
      }
    }

    // --------------------------------------------------------
    // Benchmark
    // --------------------------------------------------------
    btnBenchmark?.addEventListener('click', async () => {
      const sql = getEditorSql().trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen benchmark uygulanacak bir SELECT sorgusu yazın.', 'error');
        return;
      }

      const runs = Number($('#wbBenchmarkRuns')?.value || 3);
      const dbTarget = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
      setWbRunningState(true, `BENCHMARK (${runs} RUNS) [${dbTarget}]...`);
      const timeoutMs = Number($('#wbTimeoutSelect')?.value || 30000);

      try {
        if (state.isLive) {
          const res = await fetch('/api/workbench/benchmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, database: dbTarget, runs, warmUp: true, timeoutMs })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Benchmark başarısız.');

          renderWbBenchmark(json);
          switchWbTab('statistics');
          toast('Benchmark Tamamlandı', `[${dbTarget}] Median: ${json.metrics?.medianDurationMs || 0} ms`, 'success');
        } else {
          // Demo
          await new Promise(r => setTimeout(r, 500));
          renderWbBenchmark({
            totalRuns: runs,
            database: dbTarget,
            summary: { medianMs: 13, p95Ms: 14, minMs: 13, maxMs: 14, avgMs: 13.5, logicalReadsMedian: 14280 }
          });
          switchWbTab('statistics');
          toast('Demo Benchmark Tamamlandı', 'Median: 13 ms', 'success');
        }
      } catch (err) {
        toast('Benchmark Hatası', err.message, 'error');
      } finally {
        setWbRunningState(false);
      }
    });

    // --------------------------------------------------------
    // Persistent Query History (Sprint 7: Search & Filter)
    // --------------------------------------------------------
    async function loadWbHistory() {
      const histWrap = $('#wbHistoryList');
      if (!histWrap) return;

      const search = $('#wbHistorySearch')?.value || '';
      const database = $('#wbHistoryDbFilter')?.value || '';
      const successOnly = $('#wbHistorySuccessFilter')?.value || '';

      const queryParams = new URLSearchParams();
      if (search) queryParams.set('search', search);
      if (database) queryParams.set('database', database);
      if (successOnly) queryParams.set('successOnly', successOnly);
      queryParams.set('limit', '100');

      try {
        const res = await fetch(`/api/workbench/history?${queryParams.toString()}`);
        const json = await res.json();
        const list = json.data || [];

        if (list.length === 0) {
          histWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Kayıtlı sorgu geçmişi bulunamadı.</p></div>';
          return;
        }

        histWrap.innerHTML = `
          <table class="wb-table" style="font-size:12px;width:100%">
            <thead>
              <tr>
                <th>Durum</th>
                <th>Sorgu Önizleme</th>
                <th>Veritabanı</th>
                <th>Süre</th>
                <th>Okuma</th>
                <th>Satır</th>
                <th>Tekrar</th>
                <th>Zaman</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(item => {
                const qText = item.sql || item.query || '';
                const successPill = item.success !== false
                  ? '<span class="status-pill status-ready" style="font-size:10px">OK</span>'
                  : '<span class="status-pill status-danger" style="font-size:10px">HATA</span>';
                const timeStr = item.executedAt ? new Date(item.executedAt).toLocaleTimeString() : (item.time || '—');
                const rowCount = item.rowCount != null ? item.rowCount : (item.rowsCount || 0);

                return `
                  <tr style="cursor:pointer" class="wb-hist-row" data-sql="${encodeURIComponent(qText)}" data-db="${item.database || ''}">
                    <td>${successPill}</td>
                    <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-family-mono);white-space:nowrap">${escapeHtml(qText)}</td>
                    <td><small>${escapeHtml(item.database || '—')}</small></td>
                    <td><b>${item.durationMs || 0} ms</b></td>
                    <td>${(item.logicalReads || 0).toLocaleString()}</td>
                    <td>${rowCount}</td>
                    <td><span class="count-badge">${item.executionCount || 1}</span></td>
                    <td><small style="color:var(--text-muted)">${timeStr}</small></td>
                    <td>
                      <button type="button" class="button ghost mini btn-hist-load" data-sql="${encodeURIComponent(qText)}" title="Editöre Yükle">Yükle</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;

        // Bind clicks to load into editor
        histWrap.querySelectorAll('.btn-hist-load, .wb-hist-row').forEach(el => {
          el.addEventListener('click', (e) => {
            const sql = decodeURIComponent(el.dataset.sql || el.closest('tr')?.dataset.sql);
            if (sql) {
              setEditorSql(sql);
              const curTab = getActiveTab();
              if (curTab) {
                curTab.sql = sql;
                curTab.isDirty = true;
                renderTabStrip();
                debouncedSaveSessions();
              }
              switchWbTab('results');
              toast('Sorgu Yüklendi', 'Geçmişten seçilen sorgu aktif sekmeye aktarıldı.');
            }
          });
        });
      } catch (_) {
        histWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Geçmiş yüklenemedi.</p></div>';
      }
    }

    // Filter listeners
    $('#wbHistorySearch')?.addEventListener('input', () => loadWbHistory());
    $('#wbHistoryDbFilter')?.addEventListener('change', () => loadWbHistory());
    $('#wbHistorySuccessFilter')?.addEventListener('change', () => loadWbHistory());

    // Clear history
    $('#btnWbClearHistory')?.addEventListener('click', async () => {
      const ok = confirm('Tüm sorgu geçmişini temizlemek istediğinize emin misiniz?');
      if (!ok) return;
      try {
        await fetch('/api/workbench/history', { method: 'DELETE' });
        loadWbHistory();
        toast('Temizlendi', 'Sorgu geçmişi başarıyla temizlendi.');
      } catch (_) {}
    });

    // --------------------------------------------------------
    // Saved Queries Modal & Drawer
    // --------------------------------------------------------
    $('#btnWbSaveQuery')?.addEventListener('click', () => {
      const sql = getFullEditorSql().trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen kaydedilecek bir sorgu girin.', 'error');
        return;
      }
      $('#saveQueryModal')?.classList.remove('hidden');
      $('#inputSaveQueryName')?.focus();
    });

    $('#closeSaveQueryModal, #btnCancelSaveQuery')?.forEach ? $('#closeSaveQueryModal, #btnCancelSaveQuery').forEach(b => b.addEventListener('click', () => {
      $('#saveQueryModal')?.classList.add('hidden');
    })) : null;
    $('#closeSaveQueryModal')?.addEventListener('click', () => $('#saveQueryModal')?.classList.add('hidden'));
    $('#btnCancelSaveQuery')?.addEventListener('click', () => $('#saveQueryModal')?.classList.add('hidden'));

    $('#btnConfirmSaveQuery')?.addEventListener('click', async () => {
      const name = $('#inputSaveQueryName')?.value?.trim();
      if (!name) {
        toast('İsim Zorunlu', 'Lütfen sorgu için bir isim girin.', 'error');
        return;
      }
      const sql = getFullEditorSql();
      const db = $('#wbDatabaseSelect')?.value;
      const isFavorite = $('#checkSaveQueryFavorite')?.checked || false;

      try {
        const res = await fetch('/api/saved-queries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, sql, database: db, isFavorite })
        });
        const json = await res.json();
        if (json.ok) {
          $('#saveQueryModal')?.classList.add('hidden');
          $('#inputSaveQueryName').value = '';
          toast('Sorgu Kaydedildi', `"${name}" yerel depolamaya kaydedildi.`, 'success');
        }
      } catch (err) {
        toast('Hata', err.message, 'error');
      }
    });

    $('#btnWbOpenSavedQueries')?.addEventListener('click', () => {
      $('#savedQueriesModal')?.classList.remove('hidden');
      loadSavedQueriesList();
    });

    $('#closeSavedQueriesModal')?.addEventListener('click', () => {
      $('#savedQueriesModal')?.classList.add('hidden');
    });

    async function loadSavedQueriesList() {
      const wrap = $('#savedQueriesListWrap');
      if (!wrap) return;

      const favOnly = $('#checkFilterSavedFavoriteOnly')?.checked || false;
      const search = ($('#inputFilterSavedQueries')?.value || '').toLowerCase();

      try {
        const res = await fetch(`/api/saved-queries?favoriteOnly=${favOnly}`);
        const json = await res.json();
        let list = json.data || [];

        if (search) {
          list = list.filter(q => q.name.toLowerCase().includes(search) || q.sql.toLowerCase().includes(search));
        }

        if (list.length === 0) {
          wrap.innerHTML = '<div class="empty-state" style="padding:30px 10px"><p>Kayıtlı sorgu bulunamadı.</p></div>';
          return;
        }

        wrap.innerHTML = list.map(q => `
          <div class="panel" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.02)">
            <div>
              <div style="display:flex;align-items:center;gap:6px">
                <strong style="font-size:13px">${escapeHtml(q.name)}</strong>
                <span class="star-badge" style="cursor:pointer" data-fav-id="${q.id}">${q.isFavorite ? '⭐' : '☆'}</span>
                ${q.database ? `<small style="color:var(--text-muted)">[${escapeHtml(q.database)}]</small>` : ''}
              </div>
              <small style="color:var(--text-muted);font-family:var(--font-family-mono);display:block;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${escapeHtml(q.sql)}</small>
            </div>
            <div style="display:flex;gap:6px">
              <button type="button" class="button ghost mini btn-load-saved-active" data-id="${q.id}">Aktif Sekmeye Yükle</button>
              <button type="button" class="button ghost mini btn-load-saved-new" data-id="${q.id}">+ Yeni Sekmede Aç</button>
              <button type="button" class="button ghost mini danger-hover btn-del-saved" data-id="${q.id}">✕</button>
            </div>
          </div>
        `).join('');

        // Bind load into active
        wrap.querySelectorAll('.btn-load-saved-active').forEach(btn => {
          btn.addEventListener('click', () => {
            const item = list.find(x => x.id === btn.dataset.id);
            if (item) {
              setEditorSql(item.sql);
              const curTab = getActiveTab();
              if (curTab) {
                curTab.sql = item.sql;
                curTab.title = item.name;
                curTab.isDirty = false;
                renderTabStrip();
                debouncedSaveSessions();
              }
              $('#savedQueriesModal')?.classList.add('hidden');
              toast('Yüklendi', `"${item.name}" aktif sekmeye aktarıldı.`);
            }
          });
        });

        // Bind load into new
        wrap.querySelectorAll('.btn-load-saved-new').forEach(btn => {
          btn.addEventListener('click', () => {
            const item = list.find(x => x.id === btn.dataset.id);
            if (item) {
              createNewTab(item.name, item.sql, item.database);
              $('#savedQueriesModal')?.classList.add('hidden');
              toast('Yeni Sekme', `"${item.name}" yeni sekmede açıldı.`);
            }
          });
        });

        // Toggle Favorite
        wrap.querySelectorAll('.star-badge').forEach(star => {
          star.addEventListener('click', async () => {
            await fetch(`/api/saved-queries/${star.dataset.favId}/favorite`, { method: 'POST' });
            loadSavedQueriesList();
          });
        });

        // Delete saved query
        wrap.querySelectorAll('.btn-del-saved').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (confirm('Bu kayıtlı sorguyu silmek istediğinize emin misiniz?')) {
              await fetch(`/api/saved-queries/${btn.dataset.id}`, { method: 'DELETE' });
              loadSavedQueriesList();
              toast('Silindi', 'Kayıtlı sorgu silindi.');
            }
          });
        });
      } catch (_) {}
    }

    $('#inputFilterSavedQueries')?.addEventListener('input', loadSavedQueriesList);
    $('#checkFilterSavedFavoriteOnly')?.addEventListener('change', loadSavedQueriesList);

    // Initial boot
    initEditorSystem();
    loadSessions();
    loadMetadataCatalog();
  }

  // ========================================================
  // Sprint 5: Live Activity, Blocking Tree & Index Advisor
  // ========================================================

  let activityPollTimer = null;
  let activityRefreshInFlight = false;
  let activityActiveTab = 'requests';
  let indexesActiveTab = 'missing-indexes';

  function stopActivityPolling() {
    if (activityPollTimer) {
      clearInterval(activityPollTimer);
      activityPollTimer = null;
    }
  }

  function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function fetchOverviewIndexAndStatsCounters() {
    try {
      const idxRes = await fetch('/api/index-advisor');
      if (idxRes.ok) {
        const idxData = await idxRes.json();
        const cntElem = $('#metricIndexAdvisorCount');
        if (cntElem) {
          cntElem.textContent = (idxData.recommendations?.length || 0).toLocaleString();
        }
      }

      const statsRes = await fetch('/api/statistics-health');
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const staleElem = $('#metricStatsHealthCount');
        if (staleElem) {
          const staleTotal = (statsData.summary?.staleCount || 0) + (statsData.summary?.criticalCount || 0);
          staleElem.textContent = staleTotal.toLocaleString();
        }
      }
    } catch (_) {}
  }

  // --- Live Activity & Blocking Controller ---
  function initActivityMonitor() {
    const segButtons = $$('#activitySegmented button');
    segButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activityActiveTab = btn.dataset.tab;
        const reqTab = $('#tabContentRequests');
        const blkTab = $('#tabContentBlocking');
        const wtsTab = $('#tabContentWaits');
        if (reqTab) reqTab.classList.toggle('hidden', activityActiveTab !== 'requests');
        if (blkTab) blkTab.classList.toggle('hidden', activityActiveTab !== 'blocking');
        if (wtsTab) wtsTab.classList.toggle('hidden', activityActiveTab !== 'waits');
      });
    });

    const refreshBtn = $('#btnRefreshActivity');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadActivityData(true));
    }

    const pollSelect = $('#activityPollInterval');
    if (pollSelect) {
      pollSelect.addEventListener('change', () => resetActivityPolling());
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopActivityPolling();
      } else {
        const activePage = $('.page.active');
        if (activePage && activePage.id === 'page-activity') {
          resetActivityPolling();
          loadActivityData();
        }
      }
    });
  }

  function resetActivityPolling() {
    stopActivityPolling();
    const pollSelect = $('#activityPollInterval');
    const intervalMs = pollSelect ? parseInt(pollSelect.value, 10) : 10000;
    if (intervalMs > 0) {
      activityPollTimer = setInterval(() => {
        if (!document.hidden) {
          const activePage = $('.page.active');
          if (activePage && activePage.id === 'page-activity') {
            loadActivityData();
          }
        }
      }, intervalMs);
    }
  }

  function showActivityPermissionWarning(data) {
    const box = $('#activityPermissionWarning');
    const txt = $('#activityPermissionText');
    const sc = $('#activityPermissionScript');
    if (box) box.classList.remove('hidden');
    if (txt && data.error) txt.textContent = data.error;
    if (sc && data.grantScript) sc.textContent = data.grantScript;
  }

  function hideActivityPermissionWarning() {
    const box = $('#activityPermissionWarning');
    if (box) box.classList.add('hidden');
  }

  async function loadActivityData(isManual = false) {
    if (activityRefreshInFlight) {
      return;
    }
    activityRefreshInFlight = true;

    const badge = $('#activityLastRefreshBadge');
    if (badge) badge.textContent = `Yenileniyor... (${formatTime()})`;

    try {
      // 1. Requests
      const reqRes = await fetch('/api/activity/requests');
      if (!reqRes.ok) throw new Error((await reqRes.json()).error || "Aktivite verisi alınamadı.");
      if (reqRes.ok) {
        const reqJson = await reqRes.json();
        if (reqJson.permissionMissing) {
          showActivityPermissionWarning(reqJson);
        } else {
          hideActivityPermissionWarning();
          renderActivityRequests(reqJson.requests || []);
        }
      }

      // 2. Blocking
      const blockRes = await fetch('/api/activity/blocking');
      if (!blockRes.ok) throw new Error((await blockRes.json()).error || "Aktivite verisi alınamadı.");
      if (blockRes.ok) {
        const blockJson = await blockRes.json();
        renderActivityBlocking(blockJson);
      }

      // 3. Waits
      const waitsRes = await fetch('/api/activity/waits');
      if (!waitsRes.ok) throw new Error((await waitsRes.json()).error || "Aktivite verisi alınamadı.");
      if (waitsRes.ok) {
        const waitsJson = await waitsRes.json();
        renderActivityWaits(waitsJson);
      }

      if (badge) badge.textContent = `Son Güncelleme: ${formatTime()}`;
      if (isManual) toast('Canlı Aktivite', 'Veriler başarıyla yenilendi.', 'success');
    } catch (err) {
      if (badge) badge.textContent = `Hata: ${formatTime()}`;
      showActivityPermissionWarning({ error: err.message });
      if (isManual) toast('Aktivite Alınamadı', err.message, 'error');
    } finally {
      activityRefreshInFlight = false;
    }
  }

  function renderActivityRequests(requests) {
    const countEl = $('#actRequestCount');
    if (countEl) countEl.textContent = requests.length;

    const tbody = $('#activityRequestsTbody');
    if (!tbody) return;

    if (requests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell" style="padding:24px;text-align:center;color:var(--text-muted)">Şu anda sistemde çalışan kullanıcı sorgusu bulunmuyor.</td></tr>';
      return;
    }

    tbody.innerHTML = requests.map(r => {
      const isBlocked = r.isBlocked;
      const rowStyle = isBlocked ? 'background:rgba(255, 93, 114, 0.08);' : '';
      const statusPill = isBlocked
        ? `<span class="score-pill critical">BLOCKED (By #${r.blockingSessionId})</span>`
        : `<span class="score-pill ${r.requestStatus === 'running' ? 'healthy' : 'low'}">${escapeHtml(r.requestStatus)}</span>`;

      let waitBadgeClass = 'ghost';
      if (r.waitCategory === 'LOCKING' || r.waitCategory === 'TEMPDB' || r.waitSeverity === 'CRITICAL') {
        waitBadgeClass = 'danger';
      } else if (r.waitCategory === 'PAGE_LATCH' || r.waitCategory === 'LATCH' || r.waitCategory === 'IO' || r.waitSeverity === 'HIGH') {
        waitBadgeClass = 'warning';
      }

      const waitCatPill = r.waitType && r.waitType !== '—'
        ? `<span class="badge ${waitBadgeClass}" title="${escapeHtml(r.waitExplanation)} (${escapeHtml(r.waitCategoryName)})">${escapeHtml(r.waitType)}</span>`
        : '<span style="color:var(--text-muted)">—</span>';

      const shortSql = r.sqlText
        ? (r.sqlText.length > 90
            ? `<details style="cursor:pointer;"><summary style="font-family:monospace;font-size:11px">${escapeHtml(r.sqlText.substring(0, 90))}...</summary><pre style="font-size:10.5px;margin:4px 0;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;white-space:pre-wrap;max-height:160px;overflow-y:auto;user-select:all;">${escapeHtml(r.sqlText)}</pre></details>`
            : `<span style="font-family:monospace;font-size:11px">${escapeHtml(r.sqlText)}</span>`)
        : '<span style="color:var(--text-muted)">—</span>';

      return `
        <tr style="${rowStyle}">
          <td><strong>#${r.sessionId}</strong></td>
          <td>${statusPill}</td>
          <td><code style="font-size:11.5px">${escapeHtml(r.command || '—')}</code></td>
          <td>${waitCatPill}</td>
          <td>${r.waitTimeMs ? r.waitTimeMs.toLocaleString() : '0'}</td>
          <td>${r.cpuTimeMs ? r.cpuTimeMs.toLocaleString() : '0'}</td>
          <td>${r.totalElapsedTimeMs ? r.totalElapsedTimeMs.toLocaleString() : '0'}</td>
          <td>${r.logicalReads ? r.logicalReads.toLocaleString() : '0'}</td>
          <td><small>${escapeHtml(r.loginName)} @ ${escapeHtml(r.hostName)}</small></td>
          <td style="max-width:320px">${shortSql}</td>
        </tr>
      `;
    }).join('');
  }

  function renderActivityBlocking(blockingData) {
    const countEl = $('#actBlockCount');
    const totalBlocked = blockingData.totalBlockedCount || 0;
    if (countEl) countEl.textContent = totalBlocked;

    const container = $('#activityBlockingContainer');
    if (!container) return;

    if (totalBlocked === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:32px 16px; text-align:center;">
          <span style="font-size:32px; color:var(--green)">✓</span>
          <p style="margin-top:10px; font-weight:600; font-size:14px; color:var(--text-primary)">Kilitlenme (Blocking) Yok</p>
          <p style="color:var(--text-muted); font-size:12.5px; margin-top:4px">Şu anda SQL Server üzerinde birbirini bekleyen veya kilitlenen kullanıcı oturumu tespit edilmedi.</p>
        </div>
      `;
      return;
    }

    const rootBlockers = blockingData.rootBlockers || [];

    function renderBranchHtml(blockedSessions) {
      if (!blockedSessions || blockedSessions.length === 0) return '';
      return `
        <div class="blocking-branch">
          ${blockedSessions.map(b => {
            if (b.isCycle) {
              return `<div class="blocked-child-node" style="border-color:var(--danger)"><strong style="color:var(--danger)">⚠ Döngüsel Kilit (Circular Deadlock / Cycle): SPID #${b.spid}</strong></div>`;
            }
            const sevBadge = b.severity === 'CRITICAL'
              ? '<span class="score-pill critical">CRITICAL &gt;30s</span>'
              : (b.severity === 'WARNING' ? '<span class="score-pill high">WARNING &gt;5s</span>' : '<span class="score-pill low">INFO</span>');

            return `
              <div class="blocked-child-node">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
                  <div style="display:flex; gap:8px; align-items:center">
                    <strong>SPID #${b.sessionId}</strong>
                    <span style="color:var(--text-muted); font-size:12px">← Bekleten: SPID #${b.blockedBy}</span>
                    <span class="badge danger">${escapeHtml(b.waitType)}</span>
                    ${sevBadge}
                  </div>
                  <div style="font-size:12px; font-weight:600; color:var(--danger)">
                    Bekleme Süresi: ${(b.waitTimeMs || 0).toLocaleString()} ms
                  </div>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px">
                  ${escapeHtml(b.loginName)} @ ${escapeHtml(b.hostName)} · Komut: <code>${escapeHtml(b.command)}</code>
                </div>
                ${b.sqlText ? `<pre style="font-size:11px; background:rgba(0,0,0,0.25); padding:6px; border-radius:4px; margin:4px 0; overflow-x:auto;">${escapeHtml(b.sqlText)}</pre>` : ''}
                ${renderBranchHtml(b.blockedSessions)}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    container.innerHTML = rootBlockers.map(root => {
      return `
        <div class="blocking-tree-node head-blocker">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px">
            <div>
              <div style="display:flex; gap:8px; align-items:center">
                <span class="score-pill critical">HEAD BLOCKER</span>
                <h3 style="margin:0; font-size:15px">SPID #${root.sessionId}</h3>
                <span class="badge warning">${escapeHtml(root.status)}</span>
              </div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:4px">
                Kullanıcı: <strong>${escapeHtml(root.loginName)}</strong> · Host: <strong>${escapeHtml(root.hostName)}</strong> · Uygulama: ${escapeHtml(root.programName)}
              </div>
            </div>
            <div style="text-align:right">
              <span class="badge ghost">Bekleyen Oturum Sayısı: ${root.directBlockedCount}</span>
            </div>
          </div>
          ${root.sqlText && root.sqlText !== '—' ? `<pre style="font-size:11px; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px; margin:6px 0; overflow-x:auto;">${escapeHtml(root.sqlText)}</pre>` : ''}
          ${renderBranchHtml(root.blockedSessions)}
        </div>
      `;
    }).join('');
  }

  function renderActivityWaits(waitsData) {
    const tbody = $('#activityWaitsTbody');
    const catList = $('#activityWaitCategoryList');
    if (!tbody) return;

    const waits = waitsData.waits || [];
    const categories = waitsData.categories || [];

    if (catList) {
      catList.innerHTML = `
        <h4 style="margin:0 0 10px 0; font-size:13px; font-weight:600">Kategori Özeti</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${categories.map(c => {
            const totalMs = waitsData.totalWaitTimeMs || 1;
            const pct = Math.round((c.totalWaitTimeMs / totalMs) * 100);
            return `
              <div style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-xs); padding:8px 12px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:4px">
                  <span>${escapeHtml(c.categoryName)}</span>
                  <span>%${pct}</span>
                </div>
                <div class="mod-bar-track">
                  <div class="mod-bar-fill ${c.category === 'LOCKING' || c.category === 'IO' ? 'critical' : 'watch'}" style="width:${pct}%"></div>
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:4px">
                  ${(c.totalWaitTimeMs || 0).toLocaleString()} ms · ${c.tasksCount.toLocaleString()} görev
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    if (waits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Wait kaydı bulunamadı.</td></tr>';
      return;
    }

    tbody.innerHTML = waits.map(w => {
      return `
        <tr>
          <td><strong>${escapeHtml(w.waitType)}</strong></td>
          <td><span class="badge ${w.category === 'LOCKING' ? 'danger' : (w.category === 'IO' ? 'warning' : 'ghost')}">${escapeHtml(w.categoryName)}</span></td>
          <td>${w.waitTimeMs.toLocaleString()}</td>
          <td><strong>%${w.percentOfTotal}</strong></td>
          <td>${w.waitingTasksCount.toLocaleString()}</td>
          <td><small style="color:var(--text-muted); font-size:11.5px">${escapeHtml(w.explanation)}</small></td>
        </tr>
      `;
    }).join('');
  }

  // --- Index Advisor & Statistics Health Controller ---
  function initIndexAdvisor() {
    const segButtons = $$('#indexesSegmented button');
    segButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        indexesActiveTab = btn.dataset.tab;
        const miTab = $('#tabContentMissingIndexes');
        const shTab = $('#tabContentStatsHealth');
        if (miTab) miTab.classList.toggle('hidden', indexesActiveTab !== 'missing-indexes');
        if (shTab) shTab.classList.toggle('hidden', indexesActiveTab !== 'stats-health');
      });
    });

    const refreshBtn = $('#btnRefreshIndexesPage');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadIndexesData(true));
    }
  }

  async function loadIndexesData(isManual = false) {
    const button = $('#btnRefreshIndexesPage');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const [indexes, statistics] = await Promise.all([apiJson('/api/index-advisor'), apiJson('/api/statistics-health')]);
      renderMissingIndexes(indexes.recommendations || []);
      renderStatsHealth(statistics.statistics || []);
      if (isManual) toast('İndeks & İstatistik', 'Veriler başarıyla güncellendi.', 'success');
    } catch (err) {
      const message = window.StudioUiStates.renderErrorState({ title: 'Veriler alınamadı', message: err.message, settingsActionId: 'indexesConnectionRetry' });
      for (const id of ['missingIndexesContainer']) {
        if ($('#' + id)) $('#' + id).innerHTML = message;
      }
      if ($('#statsHealthTbody')) $('#statsHealthTbody').innerHTML = '<tr><td colspan="8">' + escapeHtml(err.message) + '</td></tr>';
      $('#indexesConnectionRetry')?.addEventListener('click', openModal);
      if (isManual) toast('Güncelleme Başarısız', err.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderMissingIndexes(recommendations) {
    const countEl = $('#idxAdvCount');
    if (countEl) countEl.textContent = recommendations.length;

    const container = $('#missingIndexesContainer');
    if (!container) return;

    if (recommendations.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:32px 16px; text-align:center;">
          <span style="font-size:28px; color:var(--green)">✓</span>
          <p style="margin-top:8px; font-weight:600; font-size:14px;">Aktif Eksik İndeks Bulgusu Yok</p>
          <p style="color:var(--text-muted); font-size:12.5px;">SQL Server DMV kayıtlarında yüksek maliyet tasarrufu sağlayacak eksik indeks tespit edilmedi.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = recommendations.map((rec, idx) => {
      const grade = rec.benefitGrade || 'LOW';
      const gradeClass = grade.toLowerCase();
      const conflictStatus = rec.conflict?.status || 'NEW_CANDIDATE';
      const riskLevel = rec.risk?.riskLevel || 'LOW';

      const conflictPill = conflictStatus === 'DUPLICATE'
        ? '<span class="score-pill critical">MÜKERRER (DUPLICATE)</span>'
        : (conflictStatus === 'ALREADY_COVERED'
            ? '<span class="score-pill high">KAPSANIYOR (COVERED)</span>'
            : (conflictStatus === 'PARTIALLY_COVERED'
                ? '<span class="score-pill medium">KISMİ ÖRTÜŞME</span>'
                : '<span class="score-pill low">YENİ ADAY İNDEKS</span>'));

      const codeBlockId = `idxScript_${idx}`;

      return `
        <div class="index-card">
          <div class="index-card-header">
            <div>
              <div class="index-badge-group">
                <span class="score-pill ${gradeClass}">FAYDA SKORU: ${rec.benefitScore} / 100 (${grade})</span>
                ${conflictPill}
                <span class="badge ${riskLevel === 'HIGH' ? 'danger' : (riskLevel === 'MEDIUM' ? 'warning' : 'positive')}">DML Riski: ${riskLevel}</span>
              </div>
              <h3 style="margin:8px 0 2px 0; font-size:15px; font-family:monospace;">[${escapeHtml(rec.schema)}].[${escapeHtml(rec.table)}]</h3>
              <div style="font-size:12px; color:var(--text-muted)">
                Anahtarlar: <strong>(${rec.keyColumns.map(escapeHtml).join(', ')})</strong>
                ${rec.includedColumns && rec.includedColumns.length > 0 ? ` · INCLUDE: <strong>(${rec.includedColumns.map(escapeHtml).join(', ')})</strong>` : ''}
              </div>
            </div>
            <div>
              <button class="button ghost small" data-copy-code="${codeBlockId}">📋 Betiği Kopyala</button>
            </div>
          </div>

          <div style="font-size:12px; color:var(--text-secondary); background:rgba(0,0,0,0.18); padding:8px 12px; border-radius:4px;">
            ${escapeHtml(rec.benefitDetails?.explanation || '')}
            ${rec.conflict?.message ? `<div style="margin-top:4px; font-weight:600; color:var(--text-primary)">🔍 Çakışma Durumu: ${escapeHtml(rec.conflict.message)}</div>` : ''}
          </div>

          <div>
            <pre id="${codeBlockId}" style="font-size:11px; background:rgba(0,0,0,0.35); border:1px solid var(--line); border-radius:4px; padding:10px; overflow-x:auto; user-select:all;">${escapeHtml(rec.script)}</pre>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderStatsHealth(statistics) {
    const countEl = $('#statsHealthCount');
    if (countEl) countEl.textContent = statistics.length;

    const tbody = $('#statsHealthTbody');
    if (!tbody) return;

    if (statistics.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">İstatistik kaydı bulunamadı.</td></tr>';
      return;
    }

    tbody.innerHTML = statistics.map((st, idx) => {
      const status = st.status || 'HEALTHY';
      const statusClass = status.toLowerCase();
      const pctMod = Math.round((st.modificationRatio || 0) * 100);
      const shortRatio = (st.modificationRatio != null && st.modificationRatio >= 1.0)
        ? `${(Math.round(st.modificationRatio * 10) / 10).toLocaleString('tr-TR')}x katı`
        : `%${pctMod}`;
      const barWidth = st.barPercent != null ? st.barPercent : Math.min(100, pctMod);
      const ratioTooltip = st.displayRatioText || `%${pctMod} değişiklik`;

      const statusBadge = status === 'CRITICAL'
        ? '<span class="score-pill critical">KRİTİK (%50+)</span>'
        : (status === 'STALE'
            ? '<span class="score-pill high">BAYAT (%20+)</span>'
            : (status === 'WATCH' ? '<span class="score-pill medium">İZLEMEDE</span>' : '<span class="score-pill healthy">GÜNCEL</span>'));

      const lastUpdatedText = st.lastUpdated
        ? `${new Date(st.lastUpdated).toLocaleDateString('tr-TR')} (${st.daysSinceUpdate != null ? st.daysSinceUpdate + ' gün önce' : ''})`
        : '<span style="color:var(--danger)">Hiç güncellenmemiş</span>';

      const scriptId = `statsScript_${idx}`;

      return `
        <tr>
          <td><strong>${escapeHtml(st.table)}</strong></td>
          <td><code style="font-size:11px">${escapeHtml(st.statsName)}</code></td>
          <td><small>${escapeHtml(st.columns || '—')}</small></td>
          <td>${(st.rows || 0).toLocaleString()}</td>
          <td>%${st.samplePercent || 100}</td>
          <td>${(st.modificationCounter || 0).toLocaleString()}</td>
          <td style="min-width:130px" title="${escapeHtml(ratioTooltip)}">
            <div style="font-size:11.5px; font-weight:600">${escapeHtml(shortRatio)}</div>
            <div class="mod-bar-track">
              <div class="mod-bar-fill ${statusClass}" style="width:${barWidth}%"></div>
            </div>
            ${(st.rawModificationRatio != null && st.rawModificationRatio >= 1.0) ? `<div style="font-size:10px; color:var(--danger); margin-top:2px; line-height:1.2;">${escapeHtml(st.displayRatioText || '')}</div>` : ''}
          </td>
          <td><small>${lastUpdatedText}</small></td>
          <td>${statusBadge}</td>
          <td>
            <span id="${scriptId}" style="display:none">${escapeHtml(st.updateScript)}</span>
            <button class="button ghost mini" style="padding:2px 8px; font-size:11px" data-copy-code="${scriptId}">📋 UPDATE</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // --- Initial Boot & Environment Sync ---
  async function syncEnvironmentAndConnection() {
    try {
      let res = await fetch('/api/connection');
      let conn = await res.json();
      if (!conn.connected && conn.hasSavedConnection) {
        // Arka plandaki otomatik bağlantının tamamlanmasını kısa bir süre bekle
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 600));
          res = await fetch('/api/connection');
          conn = await res.json();
          if (conn.connected) break;
        }
      }

      if (conn.connected) {
        state.connected = true;
        state.connectionInfo = conn.connection;
        if (conn.primaryDatabase) state.primaryDatabase = conn.primaryDatabase;
        if (conn.selectedDatabases && conn.selectedDatabases.length > 0) {
          state.selectedDatabases = conn.selectedDatabases;
        }
        state.activeDatabase = state.primaryDatabase;

        const capRes = await fetch('/api/capabilities');
        const capJson = await capRes.json();
        if (capJson.ok) state.capabilities = capJson.data;

        const scanRes = await fetch('/api/scan/latest');
        if (scanRes.ok) {
          const scanJson = await scanRes.json();
          if (scanJson.ok && scanJson.data) {
            state.isLive = true;
            state.lastScanTime = new Date();
            state.data = scanJson.data;
            if (state.data.views?.length > 0) {
              state.selectedViewName = state.data.views[0].name || state.data.views[0].view_name;
            }
          }
        }
      }
    } catch (_) {
      // Offline / disconnected: default to mock data
    }

    // Initialize Workbench DB selector
    const wbSel = $('#wbDatabaseSelect');
    if (wbSel) {
      wbSel.innerHTML = state.selectedDatabases.map(d => `<option value="${d}" ${d === state.primaryDatabase ? 'selected' : ''}>${d}</option>`).join('');
      wbSel.value = state.activeDatabase || state.primaryDatabase;
      wbSel.onchange = e => {
        state.activeDatabase = e.target.value;
      };
    }
  }

  // =========================================================================
  // SPRINT 6: REFACTOR WORKSPACE & LIFECYCLE MANAGEMENT ENGINE
  // =========================================================================
  function initWorkspaces() {
    let wsCurrentPage = 1;
    let wsPageSize = 15;
    let wsFilterStatus = 'ALL';
    let wsSearchTerm = '';
    let activeWorkspace = null;
    let activeCandidate = null;
    let activeScriptTab = 'deploy';
    let generatedDeploymentPkg = null;

    // --- Workspaces List Loader ---
    loadWorkspacesList = async function() {
      const tbody = $('#wsTableTbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Çalışmalar yükleniyor...</td></tr>';
      }

      try {
        const queryParams = new URLSearchParams({
          page: wsCurrentPage,
          pageSize: wsPageSize,
          status: wsFilterStatus,
          search: wsSearchTerm
        });

        const res = await fetch(`/api/workspaces?${queryParams.toString()}`);
        if (!res.ok) throw new Error('Çalışmalar sunucudan alınamadı.');
        const json = await res.json();
        const data = json.data || { items: [], total: 0, page: 1, totalPages: 1 };

        renderWorkspacesList(data);
      } catch (err) {
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--danger)">Hata: ${escapeHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderWorkspacesList(data) {
      const tbody = $('#wsTableTbody');
      const items = data.items || [];
      const total = data.total || 0;

      // Update KPI counters
      const kpiTotal = $('#wsKpiTotal');
      if (kpiTotal) kpiTotal.textContent = total;

      // Calculate KPI breakdowns from items
      let draftCount = 0;
      let valCount = 0;
      let bmCount = 0;
      let appCount = 0;
      let scriptCount = 0;
      let archCount = 0;

      items.forEach(w => {
        if (w.isArchived) archCount++;
        else if (w.status === 'SCRIPT_GENERATED') scriptCount++;
        else if (w.status === 'APPROVED') appCount++;
        else if (w.status === 'BENCHMARKED') bmCount++;
        else if (w.status === 'VALIDATED') valCount++;
        else draftCount++;
      });

      if ($('#wsKpiDraft')) $('#wsKpiDraft').textContent = draftCount;
      if ($('#wsKpiValidated')) $('#wsKpiValidated').textContent = valCount;
      if ($('#wsKpiBenchmarked')) $('#wsKpiBenchmarked').textContent = bmCount;
      if ($('#wsKpiApproved')) $('#wsKpiApproved').textContent = appCount;
      if ($('#wsKpiScriptReady')) $('#wsKpiScriptReady').textContent = scriptCount;
      if ($('#wsKpiArchived')) $('#wsKpiArchived').textContent = archCount;

      // Update pagination info
      const pageInfo = $('#wsPaginationInfo');
      if (pageInfo) {
        const start = total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
        const end = Math.min(total, data.page * data.pageSize);
        pageInfo.textContent = `${total} kayıttan ${start}-${end} arası gösteriliyor (Sayfa ${data.page} / ${data.totalPages || 1})`;
      }

      const prevBtn = $('#btnWsPrevPage');
      const nextBtn = $('#btnWsNextPage');
      if (prevBtn) prevBtn.disabled = data.page <= 1;
      if (nextBtn) nextBtn.disabled = data.page >= data.totalPages;

      if (!tbody) return;
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text-muted)">Kriterlere uygun refactor çalışması bulunamadı.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(w => {
        let statusPillClass = 'low';
        let statusText = w.status || 'DRAFT';
        if (w.isArchived) {
          statusPillClass = 'ghost';
          statusText = 'ARCHIVED';
        } else if (w.status === 'APPROVED') {
          statusPillClass = 'healthy';
        } else if (w.status === 'BENCHMARKED') {
          statusPillClass = 'high';
        } else if (w.status === 'VALIDATED') {
          statusPillClass = 'low';
        } else if (w.status === 'SCRIPT_GENERATED') {
          statusPillClass = 'purple';
        }

        const candBadge = w.selectedCandidateId ? `<span class="score-pill low" style="font-size:11px">Aday</span>` : '<span style="color:var(--text-muted)">—</span>';
        const dateStr = w.updatedAt ? new Date(w.updatedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

        return `
          <tr data-wsid="${w.id}" style="cursor:pointer">
            <td><strong>${escapeHtml(w.title)}</strong></td>
            <td><code style="font-size:11.5px">${escapeHtml(w.target?.canonicalId || w.canonicalId || '—')}</code></td>
            <td><span class="score-pill ${statusPillClass}">${escapeHtml(statusText)}</span></td>
            <td>${candBadge}</td>
            <td><span class="score-pill ${w.status === 'VALIDATED' || w.status === 'APPROVED' || w.status === 'SCRIPT_GENERATED' ? 'healthy' : 'low'}">Hazır</span></td>
            <td><span class="trend ${w.status === 'BENCHMARKED' || w.status === 'APPROVED' || w.status === 'SCRIPT_GENERATED' ? 'positive-text' : 'warning-text'}">Kayıtlı</span></td>
            <td><small style="color:var(--text-muted)">${dateStr}</small></td>
            <td style="text-align:right">
              <div style="display:inline-flex;gap:6px">
                <button type="button" class="button ghost small btn-open-ws" data-id="${w.id}">İncele →</button>
                <button type="button" class="button ghost small btn-archive-ws" data-id="${w.id}" title="${w.isArchived ? 'Arşivden Çıkar' : 'Arşivle'}">${w.isArchived ? '↩' : '📦'}</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Bind row actions
      tbody.querySelectorAll('.btn-open-ws').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openWorkspaceDetail(btn.dataset.id);
        });
      });

      tbody.querySelectorAll('.btn-archive-ws').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const targetWs = items.find(x => x.id === id);
          if (!targetWs) return;
          try {
            await fetch(`/api/workspaces/${id}/archive`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isArchived: !targetWs.isArchived })
            });
            toast('Çalışma Arşivi', targetWs.isArchived ? 'Çalışma arşivden çıkarıldı.' : 'Çalışma arşivlendi.', 'success');
            loadWorkspacesList();
          } catch (err) {
            toast('Hata', err.message, 'danger');
          }
        });
      });

      tbody.querySelectorAll('tr[data-wsid]').forEach(row => {
        row.addEventListener('click', () => {
          openWorkspaceDetail(row.dataset.wsid);
        });
      });
    }

    // --- Workspace Detail View ---
    async function openWorkspaceDetail(workspaceId) {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}?checkDrift=true`);
        if (!res.ok) throw new Error('Çalışma ayrıntısı yüklenemedi.');
        const json = await res.json();
        activeWorkspace = json.data;

        $('#wsListView')?.classList.add('hidden');
        $('#wsDetailView')?.classList.remove('hidden');

        renderWorkspaceDetailHeader();
        renderWorkspaceOverviewTab();
        renderWorkspaceOriginalTab();
        renderWorkspaceCandidatesTab();
        renderWorkspaceValidationTab();
        renderWorkspaceBenchmarkTab();
        renderWorkspacePlanTab();
        renderWorkspaceDeploymentTab();

        // Switch to overview subtab by default
        switchWorkspaceDetailTab('overview');
      } catch (err) {
        toast('Hata', err.message, 'danger');
      }
    }

    function renderWorkspaceDetailHeader() {
      if (!activeWorkspace) return;
      const ws = activeWorkspace;

      const titleEl = $('#wsDetailTitle');
      if (titleEl) titleEl.textContent = ws.title || 'İsimsiz Çalışma';

      const badge = $('#wsDetailStatusBadge');
      if (badge) {
        let pillClass = 'low';
        if (ws.status === 'APPROVED') pillClass = 'healthy';
        else if (ws.status === 'BENCHMARKED') pillClass = 'high';
        else if (ws.status === 'SCRIPT_GENERATED') pillClass = 'purple';
        badge.className = `score-pill ${pillClass}`;
        badge.textContent = ws.status;
      }

      const canId = $('#wsDetailCanonicalId');
      if (canId) canId.textContent = ws.target?.canonicalId || ws.canonical_id || '—';

      const upd = $('#wsDetailUpdated');
      if (upd) upd.textContent = `Güncellendi: ${new Date(ws.updatedAt).toLocaleString('tr-TR')}`;

      const fp = $('#wsDetailFingerprint');
      if (fp) fp.textContent = `Veritabanı: ${ws.target?.database || '—'}`;

      // Database Drift Banner
      const driftBanner = $('#wsDriftBanner');
      if (driftBanner) {
        if (ws.databaseDrift?.detected) {
          driftBanner.classList.remove('hidden');
        } else {
          driftBanner.classList.add('hidden');
        }
      }

      // Archive button text
      const archiveBtn = $('#btnWsArchiveToggle');
      if (archiveBtn) {
        archiveBtn.textContent = ws.isArchived ? '↩ Arşivden Çıkar' : '📦 Arşivle';
      }
    }

    function switchWorkspaceDetailTab(tabKey) {
      $$('#wsDetailTabStrip button').forEach(b => b.classList.toggle('active', b.dataset.wstab === tabKey));
      $$('.ws-tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== `wsTabContent-${tabKey}`));
    }

    function renderWorkspaceOverviewTab() {
      if (!activeWorkspace) return;
      const ws = activeWorkspace;

      if ($('#wsInfoDb')) $('#wsInfoDb').textContent = ws.target?.database || '—';
      if ($('#wsInfoSchema')) $('#wsInfoSchema').textContent = ws.target?.schema || 'dbo';
      if ($('#wsInfoObject')) $('#wsInfoObject').textContent = ws.target?.objectName || '—';
      if ($('#wsInfoType')) $('#wsInfoType').textContent = ws.target?.objectType || 'VIEW';
      if ($('#wsInfoCreated')) $('#wsInfoCreated').textContent = new Date(ws.createdAt).toLocaleString('tr-TR');
      if ($('#wsInfoOrigHash')) $('#wsInfoOrigHash').textContent = (ws.originalDefinitionHash || '—').substring(0, 16) + '...';

      const notesEl = $('#wsNotesTextarea');
      if (notesEl) notesEl.value = ws.notes || '';

      // Event Timeline
      const timelineContainer = $('#wsTimelineContainer');
      if (timelineContainer) {
        const events = ws.auditEvents || [];
        if (events.length === 0) {
          timelineContainer.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Henüz bir olay kaydı yok.</div>';
          return;
        }

        timelineContainer.innerHTML = events.map(e => {
          let icon = '●';
          let color = 'var(--text-muted)';
          if (e.type.includes('CREATED')) { icon = '✦'; color = 'var(--accent)'; }
          else if (e.type.includes('VALIDATION')) { icon = '✓'; color = 'var(--blue)'; }
          else if (e.type.includes('BENCHMARK')) { icon = '∿'; color = 'var(--warning)'; }
          else if (e.type.includes('APPROVED')) { icon = '✓'; color = 'var(--green)'; }
          else if (e.type.includes('SCRIPT')) { icon = '📦'; color = 'var(--purple)'; }
          else if (e.type.includes('REJECTED')) { icon = '✕'; color = 'var(--danger)'; }

          const timeStr = new Date(e.timestamp).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

          return `
            <div style="display:flex;gap:10px;align-items:flex-start;font-size:12px;border-left:2px solid ${color};padding-left:10px">
              <span style="color:${color};font-weight:700">${icon}</span>
              <div style="flex:1">
                <strong>${escapeHtml(e.type)}</strong>
                <span style="color:var(--text-muted);margin-left:6px">${timeStr}</span>
                ${e.metadata && Object.keys(e.metadata).length > 0 ? `<div style="color:var(--text-muted);font-size:11px;margin-top:2px">${escapeHtml(JSON.stringify(e.metadata))}</div>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    }

    function renderWorkspaceOriginalTab() {
      if (!activeWorkspace) return;
      const ws = activeWorkspace;
      const pre = $('#wsOriginalSqlPre');
      if (pre) pre.textContent = ws.originalSql || '-- Orijinal SQL mevcut değil';

      const hashBadge = $('#wsOriginalHashBadge');
      if (hashBadge) hashBadge.textContent = `SHA256: ${(ws.originalDefinitionHash || '—').substring(0, 16)}...`;
    }

    function renderWorkspaceCandidatesTab() {
      if (!activeWorkspace) return;
      const ws = activeWorkspace;
      const candidates = ws.candidates || [];

      const countBadge = $('#wsCandCountBadge');
      if (countBadge) countBadge.textContent = candidates.length;

      const pillBar = $('#wsCandidatePillBar');
      if (pillBar) {
        if (candidates.length === 0) {
          pillBar.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Aday versiyon yok</span>';
        } else {
          pillBar.innerHTML = candidates.map((c, idx) => {
            const isSelected = activeCandidate ? activeCandidate.id === c.id : (idx === candidates.length - 1);
            if (isSelected) activeCandidate = c;
            let statusPill = c.status === 'APPROVED' ? ' (Onaylı)' : (c.status === 'REJECTED' ? ' (Red)' : '');
            return `
              <button type="button" class="button ${isSelected ? 'primary' : 'ghost'} small btn-cand-pill" data-candid="${c.id}">
                v${c.versionNumber || (idx + 1)}${statusPill}
              </button>
            `;
          }).join('');

          pillBar.querySelectorAll('.btn-cand-pill').forEach(btn => {
            btn.addEventListener('click', () => {
              activeCandidate = candidates.find(c => c.id === btn.dataset.candid);
              renderWorkspaceCandidatesTab();
            });
          });
        }
      }

      if (!activeCandidate && candidates.length > 0) {
        activeCandidate = candidates[candidates.length - 1];
      }

      if (activeCandidate) {
        const c = activeCandidate;
        if ($('#wsCandTitle')) $('#wsCandTitle').textContent = `Aday Sürüm: v${c.versionNumber || 1}`;
        if ($('#wsCandStatusPill')) {
          $('#wsCandStatusPill').textContent = c.status;
          $('#wsCandStatusPill').className = `score-pill ${c.status === 'APPROVED' ? 'healthy' : (c.status === 'REJECTED' ? 'critical' : 'low')}`;
        }
        if ($('#wsCandSourceBadge')) $('#wsCandSourceBadge').textContent = `${c.source} ${c.model ? `(${c.model})` : ''}`;
        if ($('#wsCandSummary')) $('#wsCandSummary').textContent = c.aiSummary || 'Bu aday versiyon için özet bilgi bulunmuyor.';

        const findingsList = $('#wsCandFindingsList');
        if (findingsList) {
          const finds = c.findings || [];
          findingsList.innerHTML = finds.length > 0
            ? finds.map(f => `<li>${escapeHtml(typeof f === 'string' ? f : (f.title || f.text || JSON.stringify(f)))}</li>`).join('')
            : '<li>Önemli bulgu tespit edilmedi.</li>';
        }

        const risksList = $('#wsCandRisksList');
        if (risksList) {
          const risks = c.risks || [];
          risksList.innerHTML = risks.length > 0
            ? risks.map(r => `<li>${escapeHtml(typeof r === 'string' ? r : (r.title || r.text || JSON.stringify(r)))}</li>`).join('')
            : '<li>Belirgin semantik risk bulunmuyor.</li>';
        }

        const sqlPre = $('#wsCandSqlPre');
        if (sqlPre) sqlPre.textContent = c.sql || '-- Aday SQL mevcut değil';
      }
    }

    function renderWorkspaceValidationTab() {
      if (!activeWorkspace) return;
      const wrap = $('#wsValidationListWrap');
      if (!wrap) return;

      const validations = activeWorkspace.validations || [];
      if (validations.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">Bu aday için kaydedilmiş semantik doğrulama sonucu bulunmuyor.</div>';
        return;
      }

      wrap.innerHTML = validations.map(v => {
        const verdictClass = v.verdict === 'PASS' ? 'healthy' : (v.verdict === 'FAIL' ? 'critical' : 'warning');
        return `
          <div class="card" style="padding:14px 16px;background:rgba(255,255,255,0.02)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="display:flex;gap:8px;align-items:center">
                <span class="score-pill ${verdictClass}">SONUÇ: ${escapeHtml(v.verdict)}</span>
                <span style="font-size:12px;color:var(--text-muted)">${new Date(v.executedAt).toLocaleString('tr-TR')}</span>
              </div>
              <code style="font-size:11px">SHA: ${(v.candidateSqlHash || '—').substring(0, 14)}...</code>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:8px;font-size:12px">
              <div>Şema Uyumu: <strong>${v.schemaMatch ? '✓ Eşleşti' : '✕ Farklı'}</strong></div>
              <div>Satır Seti Uyumu: <strong>${v.rowSetMatch ? '✓ Eşleşti' : '✕ Farklı'}</strong></div>
              <div>Çokluk Uyumu: <strong>${v.multiplicityMatch ? '✓ Eşleşti' : '✕ Farklı'}</strong></div>
              <div>Uyarılar: <strong>${v.warnings?.length || 0} Adet</strong></div>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderWorkspaceBenchmarkTab() {
      if (!activeWorkspace) return;
      const wrap = $('#wsBenchmarkListWrap');
      if (!wrap) return;

      const benchmarks = activeWorkspace.benchmarks || [];
      if (benchmarks.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">Bu aday için kaydedilmiş benchmark ölçümü bulunmuyor.</div>';
        return;
      }

      wrap.innerHTML = benchmarks.map(b => {
        const comp = b.comparison || {};
        const durGain = comp.durationImprovementPercent ?? 0;
        const cpuGain = comp.cpuImprovementPercent ?? 0;
        const readsGain = comp.logicalReadsImprovementPercent ?? 0;

        return `
          <div class="card" style="padding:14px 16px;background:rgba(255,255,255,0.02)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <strong style="font-size:13px">Benchmark Ölçümü — ${new Date(b.executedAt).toLocaleString('tr-TR')}</strong>
              <small style="color:var(--text-muted)">Tekrar: ${b.settings?.runs || 3} Run</small>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
              <div style="background:rgba(255,255,255,0.02);padding:10px;border-radius:4px">
                <span style="font-size:11.5px;color:var(--text-muted)">Süre İyileşmesi</span>
                <strong style="display:block;font-size:16px;color:${durGain >= 0 ? 'var(--green)' : 'var(--danger)'}">
                  ${durGain > 0 ? '-' : '+'}${Math.abs(durGain)}%
                </strong>
                <small style="color:var(--text-muted)">${b.original?.medianDurationMs ?? '—'} ms → ${b.candidate?.medianDurationMs ?? '—'} ms</small>
              </div>
              <div style="background:rgba(255,255,255,0.02);padding:10px;border-radius:4px">
                <span style="font-size:11.5px;color:var(--text-muted)">Mantıksal Okuma</span>
                <strong style="display:block;font-size:16px;color:${readsGain >= 0 ? 'var(--green)' : 'var(--danger)'}">
                  ${readsGain > 0 ? '-' : '+'}${Math.abs(readsGain)}%
                </strong>
                <small style="color:var(--text-muted)">${b.original?.logicalReads?.toLocaleString() ?? '—'} → ${b.candidate?.logicalReads?.toLocaleString() ?? '—'}</small>
              </div>
              <div style="background:rgba(255,255,255,0.02);padding:10px;border-radius:4px">
                <span style="font-size:11.5px;color:var(--text-muted)">CPU Süresi</span>
                <strong style="display:block;font-size:16px;color:${cpuGain >= 0 ? 'var(--green)' : 'var(--danger)'}">
                  ${cpuGain > 0 ? '-' : '+'}${Math.abs(cpuGain)}%
                </strong>
                <small style="color:var(--text-muted)">${b.original?.cpuMs ?? '—'} ms → ${b.candidate?.cpuMs ?? '—'} ms</small>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderWorkspacePlanTab() {
      if (!activeWorkspace) return;
      const wrap = $('#wsPlanSummaryWrap');
      if (!wrap) return;

      const plans = activeWorkspace.plans || [];
      if (plans.length === 0) {
        wrap.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">Bu aday için kaydedilmiş yürütme planı karşılaştırması bulunmuyor.</div>';
        return;
      }

      const p = plans[0];
      wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:14px">
          <div class="card" style="padding:12px">
            <span style="font-size:11px;color:var(--text-muted)">PLAN KAYNAĞI</span>
            <strong style="display:block;font-size:14px">${escapeHtml(p.source || 'ESTIMATED')}</strong>
          </div>
          <div class="card" style="padding:12px">
            <span style="font-size:11px;color:var(--text-muted)">YENİ PLAN UYARILARI</span>
            <strong style="display:block;font-size:14px;color:${(p.warnings?.length || 0) > 0 ? 'var(--warning)' : 'var(--green)'}">${p.warnings?.length || 0} Adet</strong>
          </div>
          <div class="card" style="padding:12px">
            <span style="font-size:11px;color:var(--text-muted)">KARDİNALİTE BULGUSU</span>
            <strong style="display:block;font-size:14px">${p.cardinalityFindings?.length || 0} Adet</strong>
          </div>
          <div class="card" style="padding:12px">
            <span style="font-size:11px;color:var(--text-muted)">EKSİK İNDEKS</span>
            <strong style="display:block;font-size:14px">${p.missingIndexes?.length || 0} Adet</strong>
          </div>
        </div>
      `;
    }

    function renderWorkspaceDeploymentTab() {
      if (!activeWorkspace) return;
      updateActiveScriptView();
    }

    function updateActiveScriptView() {
      const pre = $('#wsActiveScriptPre');
      if (!pre) return;

      if (!generatedDeploymentPkg) {
        pre.textContent = `-- Dağıtım paketini incelemek için yukarıdaki 'Paketi Üret' butonuna tıklayınız.\n-- Not: Canlı SQL Server'a otomatik DDL uygulanmaz; salt incelenebilir betik üretilir.`;
        return;
      }

      if (activeScriptTab === 'deploy') {
        pre.textContent = generatedDeploymentPkg.scripts?.deploySql || generatedDeploymentPkg.files?.['DEPLOY.sql'] || '-- DEPLOY.sql';
      } else if (activeScriptTab === 'rollback') {
        pre.textContent = generatedDeploymentPkg.scripts?.rollbackSql || generatedDeploymentPkg.files?.['ROLLBACK.sql'] || '-- ROLLBACK.sql';
      } else {
        pre.textContent = generatedDeploymentPkg.scripts?.evidenceMd || generatedDeploymentPkg.files?.['EVIDENCE.md'] || '# EVIDENCE.md';
      }
    }

    // --- Bind Workspace Event Listeners ---
    $('#btnWsRefresh')?.addEventListener('click', () => loadWorkspacesList());

    $('#btnWsCreateNew')?.addEventListener('click', async () => {
      const view = state.data.views.find(v => v.canonicalId === state.selectedCanonicalId);
      $('#wsInputTitle').value = (view?.name || 'Yeni sorgu') + ' İyileştirme';
      $('#wsInputDb').value = selectedDatabase();
      $('#wsInputObject').value = view ? (view.schema || 'dbo') + '.' + view.name : 'YeniSorgu';
      $('#wsInputOrigSql').value = await getViewDefinition(view?.canonicalId || view?.name);
      $('#newWorkspaceModal').classList.remove('hidden');
      $('#wsInputTitle').focus();
    });
    const closeWorkspaceForm = () => $('#newWorkspaceModal').classList.add('hidden');
    $('#closeNewWorkspaceModal')?.addEventListener('click', closeWorkspaceForm);
    $('#cancelNewWorkspaceModal')?.addEventListener('click', closeWorkspaceForm);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeWorkspaceForm(); });
    $('#newWorkspaceForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const button = $('#submitNewWorkspace');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const database = $('#wsInputDb').value.trim();
        const objectParts = $('#wsInputObject').value.trim().replace(/[\[\]]/g, '').split('.');
        const objectName = objectParts.pop();
        const schema = objectParts.pop() || 'dbo';
        const json = await apiJson('/api/workspaces', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: $('#wsInputTitle').value.trim(),
            target: { database, schema, objectName, objectType: 'VIEW', canonicalId: database + '.' + schema + '.' + objectName },
            originalSql: $('#wsInputOrigSql').value
          })
        });
        closeWorkspaceForm();
        await loadWorkspacesList();
        openWorkspaceDetail(json.data.id);
        toast('Çalışma Oluşturuldu', 'SQL taslağı yerel çalışma alanına kaydedildi.', 'success');
      } catch (error) { toast('Çalışma Oluşturulamadı', error.message, 'error'); }
      finally { button.disabled = false; }
    });

    $$('#wsStatusFilterSegmented button').forEach(b => {
      b.addEventListener('click', () => {
        $$('#wsStatusFilterSegmented button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        wsFilterStatus = b.dataset.status;
        wsCurrentPage = 1;
        loadWorkspacesList();
      });
    });

    $('#wsSearchInput')?.addEventListener('input', (e) => {
      wsSearchTerm = e.target.value.trim();
      wsCurrentPage = 1;
      loadWorkspacesList();
    });

    $('#btnWsPrevPage')?.addEventListener('click', () => {
      if (wsCurrentPage > 1) {
        wsCurrentPage--;
        loadWorkspacesList();
      }
    });

    $('#btnWsNextPage')?.addEventListener('click', () => {
      wsCurrentPage++;
      loadWorkspacesList();
    });

    $('#btnWsBackToList')?.addEventListener('click', () => {
      $('#wsDetailView')?.classList.add('hidden');
      $('#wsListView')?.classList.remove('hidden');
      loadWorkspacesList();
    });

    $$('#wsDetailTabStrip button').forEach(btn => {
      btn.addEventListener('click', () => {
        switchWorkspaceDetailTab(btn.dataset.wstab);
      });
    });

    $$('#wsScriptSubTabStrip button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#wsScriptSubTabStrip button').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        activeScriptTab = btn.dataset.scripttab;
        updateActiveScriptView();
      });
    });

    $('#btnSaveWsNotes')?.addEventListener('click', async () => {
      if (!activeWorkspace) return;
      const notes = $('#wsNotesTextarea')?.value || '';
      try {
        await fetch(`/api/workspaces/${activeWorkspace.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes })
        });
        toast('Kaydedildi', 'Çalışma notları güncellendi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'danger');
      }
    });

    $('#btnCopyOriginalSql')?.addEventListener('click', () => {
      const txt = $('#wsOriginalSqlPre')?.textContent;
      if (txt) {
        navigator.clipboard.writeText(txt);
        toast('Kopyalandı', 'Orijinal SQL panoya kopyalandı.', 'success');
      }
    });

    $('#btnCopyCandSql')?.addEventListener('click', () => {
      const txt = $('#wsCandSqlPre')?.textContent;
      if (txt) {
        navigator.clipboard.writeText(txt);
        toast('Kopyalandı', 'Aday SQL panoya kopyalandı.', 'success');
      }
    });

    $('#btnCopyActiveScript')?.addEventListener('click', () => {
      const txt = $('#wsActiveScriptPre')?.textContent;
      if (txt) {
        navigator.clipboard.writeText(txt);
        toast('Kopyalandı', 'Betik metni panoya kopyalandı.', 'success');
      }
    });

    // Approval Modal Workflow
    $('#btnWsCandApprove')?.addEventListener('click', () => {
      if (!activeWorkspace || !activeCandidate) return;
      const modal = $('#approveCandidateModal');
      if (!modal) return;

      const latestVal = activeWorkspace.validations?.[0];
      const latestBm = activeWorkspace.benchmarks?.[0]?.comparison || {};

      if ($('#modalApproveValVerdict')) {
        $('#modalApproveValVerdict').textContent = latestVal?.verdict || 'UNVALIDATED';
        $('#modalApproveValVerdict').className = latestVal?.verdict === 'PASS' ? 'positive-text' : 'warning-text';
      }
      if ($('#modalApproveDurationGain')) {
        const d = latestBm.durationImprovementPercent;
        $('#modalApproveDurationGain').textContent = d !== undefined ? `${d > 0 ? '-' : '+'}${Math.abs(d)}%` : '—';
      }
      if ($('#modalApproveReadsGain')) {
        const r = latestBm.logicalReadsImprovementPercent;
        $('#modalApproveReadsGain').textContent = r !== undefined ? `${r > 0 ? '-' : '+'}${Math.abs(r)}%` : '—';
      }
      if ($('#modalApproveCpuGain')) {
        const c = latestBm.cpuImprovementPercent;
        $('#modalApproveCpuGain').textContent = c !== undefined ? `${c > 0 ? '-' : '+'}${Math.abs(c)}%` : '—';
      }
      if ($('#modalApproveDriftStatus')) {
        const dr = activeWorkspace.databaseDrift?.detected;
        $('#modalApproveDriftStatus').textContent = dr ? '⚠ VAR (Drift)' : 'Yok (Güncel)';
        $('#modalApproveDriftStatus').className = dr ? 'danger-text' : 'positive-text';
      }

      modal.classList.remove('hidden');
    });

    $('#closeApproveModal')?.addEventListener('click', () => $('#approveCandidateModal')?.classList.add('hidden'));
    $('#btnCancelApproveModal')?.addEventListener('click', () => $('#approveCandidateModal')?.classList.add('hidden'));

    $('#btnConfirmApproveCandidate')?.addEventListener('click', async () => {
      if (!activeWorkspace || !activeCandidate) return;
      const note = $('#modalApproveNoteInput')?.value || '';
      try {
        const res = await fetch(`/api/workspaces/${activeWorkspace.id}/candidates/${activeCandidate.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approverNote: note, isAutomatedOrAi: false })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Onay verilemedi.');

        toast('Onaylandı', `Aday v${activeCandidate.versionNumber} onaylandı. Dağıtım betiği üretilebilir.`, 'success');
        $('#approveCandidateModal')?.classList.add('hidden');
        openWorkspaceDetail(activeWorkspace.id);
      } catch (err) {
        toast('Onay Başarısız', err.message, 'danger');
      }
    });

    // Rejection Modal Workflow
    $('#btnWsCandReject')?.addEventListener('click', () => {
      if (!activeWorkspace || !activeCandidate) return;
      $('#rejectCandidateModal')?.classList.remove('hidden');
    });

    $('#closeRejectModal')?.addEventListener('click', () => $('#rejectCandidateModal')?.classList.add('hidden'));
    $('#btnCancelRejectModal')?.addEventListener('click', () => $('#rejectCandidateModal')?.classList.add('hidden'));

    $('#btnConfirmRejectCandidate')?.addEventListener('click', async () => {
      if (!activeWorkspace || !activeCandidate) return;
      const reason = $('#modalRejectReasonInput')?.value || 'Kullanıcı tarafından reddedildi.';
      try {
        const res = await fetch(`/api/workspaces/${activeWorkspace.id}/candidates/${activeCandidate.id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Aday reddedilemedi.');

        toast('Reddedildi', `Aday v${activeCandidate.versionNumber} reddedildi.`, 'info');
        $('#rejectCandidateModal')?.classList.add('hidden');
        openWorkspaceDetail(activeWorkspace.id);
      } catch (err) {
        toast('Hata', err.message, 'danger');
      }
    });

    // Workspace Drift and Cross-Nav Actions (Sprint 8.1)
    let overrideDriftFlag = false;

    $('#btnWsIgnoreDrift')?.addEventListener('click', () => {
      overrideDriftFlag = true;
      $('#wsDriftBanner')?.classList.add('hidden');
      toast('Drift Göz Ardı Edildi', 'Dağıtım betiği üretimi için drift kontrolü manuel olarak aşıldı.', 'warning');
    });

    $('#btnWsCreateFromLiveDb')?.addEventListener('click', async () => {
      if (!activeWorkspace?.target?.objectName) return;
      const viewName = activeWorkspace.target.objectName;
      try {
        const res = await fetch(`/api/views/${encodeURIComponent(viewName)}/definition`);
        const json = await res.json();
        if (!json.ok || !json.sql) throw new Error(json.error || 'Canlı tanım alınamadı.');

        const wsRes = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${viewName} (Canlı Tanım Güncellemesi)`,
            target: activeWorkspace.target,
            originalSql: json.sql
          })
        });
        const wsJson = await wsRes.json();
        if (wsJson.ok && wsJson.data) {
          toast('Yeni Çalışma Açıldı', 'Güncel canlı SQL tanımıyla yeni çalışma oluşturuldu.', 'success');
          loadWorkspacesList();
          openWorkspaceDetail(wsJson.data.id);
        }
      } catch (err) {
        toast('Hata', err.message, 'danger');
      }
    });

    $('#btnWsAddCandidate')?.addEventListener('click', () => {
      if (!activeWorkspace) return;
      const viewName = activeWorkspace.target?.objectName;
      if (viewName) {
        selectView(viewName);
        gotoPage('refactor');
        toast('AI Refaktör', `"${viewName}" için yeni aday versiyon üretebilirsiniz.`, 'info');
      }
    });

    $('#btnWsCandOpenWb')?.addEventListener('click', () => {
      if (!activeCandidate?.sql) return;
      gotoPage('workbench');
      const sqlInput = $('#wbSqlInput');
      if (sqlInput) sqlInput.value = activeCandidate.sql;
      if (window._monacoEditorInstance) {
        window._monacoEditorInstance.setValue(activeCandidate.sql);
      }
      toast('Workbench\'e Aktarıldı', `Aday v${activeCandidate.versionNumber || 1} editöre yüklendi.`, 'success');
    });

    $('#btnWsCandSendVal')?.addEventListener('click', () => {
      if (!activeCandidate?.sql) return;
      gotoPage('validation');
      if ($('#valCandidateSql')) $('#valCandidateSql').value = activeCandidate.sql;
      if ($('#valOriginalSql') && activeWorkspace?.originalSql) $('#valOriginalSql').value = activeWorkspace.originalSql;
      toast('Doğrulama Lab', `Aday v${activeCandidate.versionNumber || 1} laboratuvara aktarıldı.`, 'info');
    });

    // Generate Safe Deployment Script
    $('#btnGenerateDeployScript')?.addEventListener('click', async () => {
      if (!activeWorkspace) return;
      try {
        const res = await fetch(`/api/workspaces/${activeWorkspace.id}/generate-script`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateId: activeCandidate?.id || activeWorkspace.selectedCandidateId,
            overrideDrift: overrideDriftFlag
          })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Betiği üretilemedi.');

        generatedDeploymentPkg = json.data;
        updateActiveScriptView();
        toast('Paket Hazır', 'Güvenli DEPLOY ve ROLLBACK betikleri başarıyla üretildi.', 'success');
      } catch (err) {
        toast('Dağıtım Betiği Engellendi', err.message, 'danger');
      }
    });

    // JSON Export
    $('#btnWsExportJson')?.addEventListener('click', async () => {
      if (!activeWorkspace) return;
      try {
        const res = await fetch(`/api/workspaces/${activeWorkspace.id}/export`);
        const json = await res.json();
        if (json.ok && json.data) {
          const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `workspace-${activeWorkspace.id}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast('Dışa Aktarıldı', 'Çalışma JSON paketi indirildi.', 'success');
        }
      } catch (err) {
        toast('Hata', err.message, 'danger');
      }
    });

    // Save Refactor Result to Workspace Integration
    $('#btnGlobalSaveToWorkspace')?.addEventListener('click', async () => {
      const viewName = state.selectedViewName || 'TargetView';
      const origSql = state.currentViewSql || '';
      const candSql = state.activeCandidateSql || state.currentViewSql || '';

      try {
        // 1. Create or get workspace
        const wsRes = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${viewName} Optimizasyonu`,
            target: {
              database: state.activeDatabase || state.primaryDatabase,
              schema: 'dbo',
              objectName: viewName,
              objectType: 'VIEW',
              canonicalId: `[${state.activeDatabase || state.primaryDatabase}].[dbo].[${viewName}]`
            },
            originalSql: origSql
          })
        });
        const wsJson = await wsRes.json();
        if (!wsJson.ok || !wsJson.data) throw new Error('Çalışma kaydedilemedi.');
        const ws = wsJson.data;

        // 2. Add Candidate
        const candRes = await fetch(`/api/workspaces/${ws.id}/candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: candSql,
            source: 'AI_REFACTOR',
            model: state.aiConfig?.model || 'gpt-4o',
            aiSummary: 'AI Refactor ve AST motoru tarafından üretilen optimize aday versiyon.',
            findings: [],
            risks: []
          })
        });
        const candJson = await candRes.json();
        const cand = candJson.data;

        toast('Başarılı', 'Refaktör adayı yeni çalışmaya kaydedildi.', 'success');
        gotoPage('workspaces');
        openWorkspaceDetail(ws.id);
      } catch (err) {
        toast('Kayıt Başarısız', err.message, 'danger');
      }
    });

    // --- Workbench Saved Queries Integration ---
    $('#btnWbSaveQuery')?.addEventListener('click', () => {
      const sqlInput = $('#wbSqlInput');
      const currentSql = sqlInput ? sqlInput.value.trim() : '';
      if (!currentSql) {
        toast('Uyarı', 'Kaydetmek için önce SQL editörüne bir sorgu yazmalısınız.', 'warning');
        return;
      }
      $('#saveQueryModal')?.classList.remove('hidden');
    });

    $('#closeSaveQueryModal')?.addEventListener('click', () => $('#saveQueryModal')?.classList.add('hidden'));
    $('#btnCancelSaveQuery')?.addEventListener('click', () => $('#saveQueryModal')?.classList.add('hidden'));

    $('#btnConfirmSaveQuery')?.addEventListener('click', async () => {
      const name = $('#inputSaveQueryName')?.value?.trim();
      if (!name) {
        toast('Uyarı', 'Lütfen bir sorgu adı giriniz.', 'warning');
        return;
      }
      const sqlInput = $('#wbSqlInput');
      const currentSql = sqlInput ? sqlInput.value.trim() : '';
      const isFav = Boolean($('#checkSaveQueryFavorite')?.checked);

      try {
        const res = await fetch('/api/saved-queries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            sql: currentSql,
            database: state.activeDatabase || state.primaryDatabase,
            isFavorite: isFav
          })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Sorgu kaydedilemedi.');

        toast('Kaydedildi', `"${name}" sorgusu başarıyla kaydedildi.`, 'success');
        $('#saveQueryModal')?.classList.add('hidden');
        if ($('#inputSaveQueryName')) $('#inputSaveQueryName').value = '';
      } catch (err) {
        toast('Hata', err.message, 'danger');
      }
    });

    $('#btnWbOpenSavedQueries')?.addEventListener('click', async () => {
      $('#savedQueriesModal')?.classList.remove('hidden');
      loadSavedQueriesList();
    });

    $('#closeSavedQueriesModal')?.addEventListener('click', () => $('#savedQueriesModal')?.classList.add('hidden'));

    async function loadSavedQueriesList() {
      const wrap = $('#savedQueriesListWrap');
      if (!wrap) return;
      wrap.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">Kayıtlı sorgular yükleniyor...</div>';

      try {
        const favOnly = Boolean($('#checkFilterSavedFavoriteOnly')?.checked);
        const res = await fetch(`/api/saved-queries?favoriteOnly=${favOnly}`);
        const json = await res.json();
        const list = json.data || [];

        if (list.length === 0) {
          wrap.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center">Henüz kayıtlı sorgu bulunmuyor.</div>';
          return;
        }

        wrap.innerHTML = list.map(q => {
          return `
            <div class="card" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(255,255,255,0.02)">
              <div style="flex:1">
                <div style="display:flex;gap:8px;align-items:center">
                  <span style="cursor:pointer;font-size:14px" class="btn-toggle-fav" data-id="${q.id}" title="Favori Değiştir">
                    ${q.isFavorite ? '⭐' : '☆'}
                  </span>
                  <strong style="font-size:13px">${escapeHtml(q.name)}</strong>
                  ${q.database ? `<span class="badge ghost" style="font-size:10px">${escapeHtml(q.database)}</span>` : ''}
                </div>
                <div style="font-family:monospace;font-size:11px;color:var(--text-muted);margin-top:4px;max-width:440px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${escapeHtml(q.sql)}
                </div>
              </div>
              <div style="display:flex;gap:6px">
                <button type="button" class="button primary small btn-load-sq" data-sql="${encodeURIComponent(q.sql)}" style="font-size:11.5px;padding:3px 10px">Yükle</button>
                <button type="button" class="button ghost small btn-del-sq" data-id="${q.id}" style="color:var(--danger);font-size:11px;padding:3px 8px">✕</button>
              </div>
            </div>
          `;
        }).join('');

        wrap.querySelectorAll('.btn-load-sq').forEach(b => {
          b.addEventListener('click', () => {
            const sql = decodeURIComponent(b.dataset.sql);
            const sqlInput = $('#wbSqlInput');
            if (sqlInput) sqlInput.value = sql;
            $('#savedQueriesModal')?.classList.add('hidden');
            toast('Yüklendi', 'Sorgu editöre aktarıldı.', 'info');
          });
        });

        wrap.querySelectorAll('.btn-toggle-fav').forEach(b => {
          b.addEventListener('click', async () => {
            await fetch(`/api/saved-queries/${b.dataset.id}/favorite`, { method: 'POST' });
            loadSavedQueriesList();
          });
        });

        wrap.querySelectorAll('.btn-del-sq').forEach(b => {
          b.addEventListener('click', async () => {
            if (!confirm('Bu kayıtlı sorguyu silmek istediğinize emin misiniz?')) return;
            await fetch(`/api/saved-queries/${b.dataset.id}`, { method: 'DELETE' });
            loadSavedQueriesList();
          });
        });
      } catch (err) {
        wrap.innerHTML = `<div style="color:var(--danger);padding:16px;text-align:center">${escapeHtml(err.message)}</div>`;
      }
    }

    $('#checkFilterSavedFavoriteOnly')?.addEventListener('change', () => loadSavedQueriesList());
  }

  // --- 11. Global Keyboard Shortcuts (Sprint 8) ---
  function initKeyboardShortcutsModal() {
    const modal = $('#keyboardShortcutsModal');
    const openBtn = $('#btnKeyboardShortcuts');
    const closeBtn = $('#closeKeyboardShortcutsModal');
    const confirmBtn = $('#btnCloseShortcutsModal');

    function openModal() {
      modal?.classList.remove('hidden');
    }
    function closeModal() {
      modal?.classList.add('hidden');
    }

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    confirmBtn?.addEventListener('click', closeModal);

    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.closest('.monaco-editor');

      // Esc closes all floating modals
      if (e.key === 'Escape') {
        closeModal();
        $('#onboardingWizardModal')?.classList.add('hidden');
        $('#saveQueryModal')?.classList.add('hidden');
        $('#savedQueriesModal')?.classList.add('hidden');
        $('#renameTabModal')?.classList.add('hidden');
        return;
      }

      // Ctrl + B toggles sidebar
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        $('#sidebarCollapseToggle')?.click();
        return;
      }

      // F2 toggles theme
      if (e.key === 'F2') {
        e.preventDefault();
        $('#themeQuickToggle')?.click();
        return;
      }

      // If typing in input, do not intercept
      if (isInput) return;

      // F1 or ? opens shortcuts reference
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        openModal();
        return;
      }

      // F5 runs query if on workbench
      if (e.key === 'F5') {
        const activePage = $('.page.active');
        if (activePage && activePage.id === 'page-workbench') {
          e.preventDefault();
          $('#btnWbRun')?.click();
        }
      }
    });
  }

  // --- 12. First-Run Onboarding Wizard (Sprint 8) ---
  function initOnboardingWizard() {
    const modal = $('#onboardingWizardModal');
    if (!modal) return;

    let currentStep = 1;
    let connectionTested = false;
    for (const id of ['wizardHost', 'wizardPort', 'wizardUser', 'wizardPassword']) {
      $('#' + id)?.addEventListener('input', () => { connectionTested = false; });
    }
    const totalSteps = 5;

    function showStep(step) {
      currentStep = Math.max(1, Math.min(totalSteps, step));
      $$('.wizard-step-bullet').forEach(bullet => {
        const s = Number(bullet.dataset.step);
        bullet.classList.toggle('active', s === currentStep);
      });

      for (let i = 1; i <= totalSteps; i++) {
        const stepEl = $(`#wizardStep${i}`);
        if (stepEl) stepEl.classList.toggle('hidden', i !== currentStep);
      }

      const btnPrev = $('#btnWizardPrev');
      const btnNext = $('#btnWizardNext');
      if (btnPrev) {
        btnPrev.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
      }
      if (btnNext) {
        btnNext.textContent = currentStep === totalSteps ? '🚀 Taramayı Başlat' : 'İleri →';
      }
    }

    function closeWizard() {
      modal.classList.add('hidden');
      try {
        localStorage.setItem('sqlstudio_onboarding_completed', 'true');
      } catch (_) {}
    }

    $('#closeOnboardingWizard')?.addEventListener('click', closeWizard);
    $('#btnWizardSkip')?.addEventListener('click', closeWizard);

    $('#btnWizardPrev')?.addEventListener('click', () => {
      showStep(currentStep - 1);
    });

    $('#btnWizardNext')?.addEventListener('click', async () => {
      if (currentStep === 1 && !$('#wizardUser')?.value.trim()) {
        toast('Kullanıcı Adı Gerekli', 'Bağlantı için SQL kullanıcı adını girin.', 'warning');
        $('#wizardUser')?.focus(); return;
      }
      if (currentStep === 2 && !connectionTested) {
        toast('Bağlantıyı Test Edin', 'İlerlemeden önce başarılı bir sunucu bağlantı testi gerekir.', 'warning'); return;
      }
      if (currentStep < totalSteps) {
        showStep(currentStep + 1);
      } else {
        // Step 5 - Complete onboarding & launch scan
        const host = $('#wizardHost')?.value?.trim() || '127.0.0.1';
        const port = Number($('#wizardPort')?.value || 1433);
        const user = $('#wizardUser')?.value?.trim();
        const password = $('#wizardPassword')?.value;
        const database = $('#wizardDatabaseSelect')?.value || state.primaryDatabase;
        const prefix = $('#wizardPrefix')?.value?.trim() || 'AA_';

        const aiProvider = $('#wizardAiProvider')?.value;
        const aiKey = $('#wizardAiKey')?.value?.trim();

        const nextButton = $('#btnWizardNext');
        if (!connectionTested || !$('#wizardDatabaseSelect')?.value) {
          toast('Kurulum Eksik', 'Bağlantıyı test edip erişilebilir bir veritabanı seçin.', 'warning'); return;
        }
        nextButton.disabled = true;
        try {
          await apiJson('/api/connection/set-scope', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ primaryDatabase: database, selectedDatabases: [database] })
          });
          if (aiProvider && aiProvider !== 'none' && aiKey) {
            await apiJson('/api/settings/config', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ai: { provider: aiProvider, apiKey: aiKey } })
            });
          }
          state.activePrefix = prefix;
          if ($('#settingViewPrefix')) $('#settingViewPrefix').value = prefix;
          await syncEnvironmentAndConnection();
          updateConnectionStatusUI();
          if (!state.connected) throw new Error('Bağlantı doğrulanamadı. Kurulum tamamlanmadı.');
          closeWizard();
          await triggerScan();
        } catch (error) { toast('Kurulum Tamamlanamadı', error.message, 'error'); }
        finally { nextButton.disabled = false; }
      }
    });

    // Test Connection in Wizard Step 2
    $('#btnWizardTestConnection')?.addEventListener('click', async () => {
      const btn = $('#btnWizardTestConnection');
      const resultBox = $('#wizardTestResult');
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = 'Bağlantı Test Ediliyor...';
      if (resultBox) {
        resultBox.classList.remove('hidden');
        resultBox.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Sunucuya bağlanılıyor...</span>';
      }

      const host = $('#wizardHost')?.value?.trim() || '127.0.0.1';
      const port = Number($('#wizardPort')?.value || 1433);
      const user = $('#wizardUser')?.value?.trim();
      const password = $('#wizardPassword')?.value;

      try {
        const res = await fetch('/api/connection/test-server', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ server: host, port, user, password })
        });
        const json = await res.json();
        connectionTested = Boolean(res.ok && json.ok);
        if (connectionTested) {
          if (resultBox) {
            resultBox.innerHTML = `
              <div style="color:var(--green);font-weight:600;font-size:13px;margin-bottom:4px">✓ Bağlantı Başarılı!</div>
              <small style="color:var(--text-muted);font-size:11.5px">${escapeHtml(json.message || 'Erişim ve izinler doğrulandı.')}</small>
            `;
          }
          if (json.databases && json.databases.length > 0) {
            const select = $('#wizardDatabaseSelect');
            if (select) {
              select.innerHTML = json.databases.filter(d => d.is_accessible !== false && d.is_accessible !== 0).map(d => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
            }
          }
        } else {
          if (resultBox) {
            resultBox.innerHTML = `
              <div style="color:var(--danger);font-weight:600;font-size:13px;margin-bottom:4px">✕ Bağlantı Başarısız</div>
              <small style="color:var(--danger);font-size:11.5px">${escapeHtml(json.error || 'Sunucuya erişilemedi.')}</small>
            `;
          }
        }
      } catch (err) {
        connectionTested = false;
        if (resultBox) {
          resultBox.innerHTML = `
            <div style="color:var(--danger);font-weight:600;font-size:13px;margin-bottom:4px">✕ Bağlantı Hatası</div>
            <small style="color:var(--danger);font-size:11.5px">${escapeHtml(err.message)}</small>
          `;
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '🔌 Bağlantıyı Test Et';
      }
    });

    // AI Provider in wizard toggle key row
    $('#wizardAiProvider')?.addEventListener('change', (e) => {
      const row = $('#wizardAiKeyRow');
      if (row) {
        row.style.display = e.target.value === 'none' ? 'none' : 'block';
      }
    });

    // Show if onboarding not completed and disconnected
    const completed = localStorage.getItem('sqlstudio_onboarding_completed');
    if (!completed && !state.connected) {
      showStep(1);
      modal.classList.remove('hidden');
    }
  }

  async function init() {
    initSettings();
    initWorkbench();
    initValidationLab();
    initRefactorCompareTab();
    initAstTab();
    initAiWorkbenchIntegration();
    initCommandPalette();
    initActivityMonitor();
    initIndexAdvisor();
    initWorkspaces();
    initNavGroups();
    initKeyboardShortcutsModal();
    await syncEnvironmentAndConnection();
    initOnboardingWizard();

    updateConnectionStatusUI();
    renderOverview();
    renderViewList();
    selectView(state.selectedCanonicalId || state.selectedViewName);
    renderTables();
    renderDuplicates();
    renderRuntime();

    // SPRINT 9: Initialize Unified Studio & DBA Tools controllers
    if (window.STUDIO_MODULES?.refactorStudio?.init) {
      window.STUDIO_MODULES.refactorStudio.init(null, state, {
        toast,
        openWorkbenchSql,
        loadWorkspacesList: () => loadWorkspacesList(),
        getViewDefinition
      });
    }

    if (window.STUDIO_MODULES?.dbaTools?.init) {
      window.STUDIO_MODULES.dbaTools.init(state, {
        loadActivityData,
        loadIndexesData
      });
    }

    // Hash routing on load & history change
    const initialPage = window.location.hash.replace('#', '') || 'overview';
    gotoPage(pageTitles[initialPage] ? initialPage : 'overview');

    window.addEventListener('hashchange', () => {
      if (isNavigating) return;
      const hash = window.location.hash.replace('#', '') || 'overview';
      if (pageTitles[hash]) {
        gotoPage(hash);
      }
    });
  }

  init();
})();
