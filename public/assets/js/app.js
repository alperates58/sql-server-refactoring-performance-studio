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
    overview: ['SQL SAĞLIK KONTROL MERKEZİ', 'Genel Bakış'],
    views: ['VIEW ENVANTERİ', 'View Envanteri'],
    graph: ['BAĞIMLILIK HARİTASI & X-RAY', 'Bağımlılık Haritası'],
    runtime: ['PERFORMANS VE ÇALIŞMA ZAMANI', 'Çalışma Zamanı ve Regresyon'],
    refactor: ['AI DESTEKLİ İYİLEŞTİRME', 'AI Refaktör'],
    validation: ['SEMANTİK DOĞRULAMA STÜDYOSU', 'Doğrulama Laboratuvarı'],
    workbench: ['SQL GELİŞTİRME VE TEST', 'SQL Çalışma Alanı'],
    tables: ['TEMEL TABLO BASKI ANALİZİ', 'Tablo Baskısı'],
    duplicates: ['MÜKERRER MANTIK VE FINGERPRINT', 'Mükerrer Mantık'],
    settings: ['SİSTEM VE BAĞLANTI AYARLARI', 'Ayarlar']
  };

  // Central Application State
  const state = {
    connected: false,
    connectionInfo: null,
    capabilities: null,
    isLive: false,
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

  function gotoPage(name) {
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    if (pageTitles[name]) {
      const eb = $('#pageEyebrow');
      const pt = $('#pageTitle');
      if (eb) eb.textContent = pageTitles[name][0];
      if (pt) pt.textContent = pageTitles[name][1];
    }
    const main = $('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'graph') {
      renderGraph();
    }
  }

  // Bind Navigation
  $$('.nav-item[data-page]').forEach(b => b.addEventListener('click', () => gotoPage(b.dataset.page)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => gotoPage(b.dataset.goto)));

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
      if (srvInfo) srvInfo.innerHTML = `<span style="color:var(--green);font-weight:700">LIVE</span> · ${serverInst}`;
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
      if (topbarScanLabel) topbarScanLabel.textContent = 'SON TARAMA';
      if (topbarScanTime) topbarScanTime.textContent = state.lastScanTime ? formatTime(state.lastScanTime) : 'Bağlandı';
      if (topbarScanAgo) topbarScanAgo.textContent = dbLabel;

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
    } else {
      // Disconnected / Demo Mode
      if (light) {
        light.style.background = 'var(--yellow)';
        light.style.boxShadow = '0 0 8px rgba(247,200,106,0.4)';
      }
      if (dbName) dbName.textContent = 'Demo Veri Kümesi';
      if (srvInfo) srvInfo.textContent = 'Çevrimdışı · Salt-Okunur';
      if (connBtn) connBtn.textContent = 'Bağlantı';
      if (settingsDb) settingsDb.textContent = 'Demo Veri Kümesi';
      if (settingsHost) settingsHost.textContent = 'Demo veri kümesi aktif · SQL sunucusuna bağlanılmadı';
      if (settingsPill) {
        settingsPill.textContent = '○ DEMO MODU (ÇEVRİMDISI)';
        settingsPill.style.color = 'var(--yellow)';
        settingsPill.style.borderColor = 'rgba(247,200,106,0.2)';
        settingsPill.style.background = 'rgba(247,200,106,0.06)';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Bağlan & Test Et';
      if (capRow) capRow.style.display = 'none';

      if (topbarScanLabel) topbarScanLabel.textContent = 'MOD';
      if (topbarScanTime) topbarScanTime.textContent = 'Demo Veri Kümesi';
      if (topbarScanAgo) topbarScanAgo.textContent = 'Çevrimdışı';
    }
  }

  // --- 2. Overview Page ---
  function renderOverview() {
    const m = state.data.metrics || {};
    const views = state.data.views || [];

    const heroKicker = $('#heroKickerText');
    if (heroKicker) {
      heroKicker.textContent = state.isLive
        ? `${state.connectionInfo?.database || 'SQL'} Canlı · Read-only Denetim Modu`
        : 'Demo Veritabanı · Read-only Denetim Modu';
    }
    const heroHeadline = $('#heroHeadline');
    if (heroHeadline) {
      heroHeadline.innerHTML = `<span>${views.length}</span> view içinden <em>gerçek darboğazı</em> bul.`;
    }

    // Health Orbit
    const healthVal = m.averageHealth != null ? m.averageHealth : 72;
    const orbitHealth = $('#overviewDbHealth');
    if (orbitHealth) orbitHealth.textContent = healthVal;

    const orbitTrack = $('#orbitTrackValue');
    if (orbitTrack) {
      const maxOffset = 452;
      const offset = maxOffset - (maxOffset * (healthVal / 100));
      orbitTrack.setAttribute('stroke-dashoffset', Math.max(0, offset));
    }

    const healthChip = $('#overviewHealthChip');
    if (healthChip) {
      if (healthVal < 50) {
        healthChip.className = 'orbit-chip chip-danger';
        healthChip.textContent = '↓ Kritik Seviye';
      } else if (healthVal < 75) {
        healthChip.className = 'orbit-chip chip-danger';
        healthChip.textContent = '↓ İyileştirme Gerek';
      } else {
        healthChip.className = 'orbit-chip chip-danger';
        healthChip.style.color = 'var(--green)';
        healthChip.style.borderColor = 'rgba(67,217,156,0.3)';
        healthChip.style.background = 'rgba(67,217,156,0.1)';
        healthChip.textContent = '✓ Sağlıklı';
      }
    }

    // Metric Cards
    if ($('#metricCritical')) $('#metricCritical').textContent = m.criticalViews || 0;
    if ($('#metricEdges')) $('#metricEdges').textContent = (m.totalEdges || 0).toLocaleString();
    if ($('#metricRepeated')) $('#metricRepeated').textContent = (m.repeatedAccessPatterns || 0).toLocaleString();
    if ($('#metricRegressions')) $('#metricRegressions').textContent = m.activeRegressions != null ? m.activeRegressions : 0;
    if ($('#metricDuplicates')) $('#metricDuplicates').textContent = m.duplicateCandidates != null ? m.duplicateCandidates : 0;

    // Priority List Sorting
    const sortMode = state.currentSort || 'risk';
    let sortedViews = [...views];
    if (sortMode === 'reads') {
      sortedViews.sort((a, b) => (b.tables || 0) - (a.tables || 0));
    } else if (sortMode === 'regression') {
      sortedViews.sort((a, b) => (b.depth || 0) - (a.depth || 0));
    } else {
      sortedViews.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
    }

    const riskList = $('#overviewRiskList');
    if (riskList) {
      riskList.innerHTML = sortedViews.slice(0, 5).map(v => {
        const depCount = v.dependentCount != null ? v.dependentCount : (Array.isArray(v.dependents) ? v.dependents.length : (v.dependents || 0));
        const healthScore = v.health != null ? v.health : (v.healthScore != null ? v.healthScore : 60);
        const riskLevel = v.risk || v.riskLevel || v.riskCategory || 'low';
        const riskScore = v.riskScore != null ? v.riskScore : 0;
        const viewName = v.name || v.view_name;

        return `
          <div class="risk-row" data-view="${viewName}">
            <i class="risk-level-bar ${severityClass(riskLevel)}"></i>
            <div class="risk-name">
              <strong>${viewName}</strong>
              <small>${v.schema_name || 'dbo'} · depth ${v.depth || 1} · ${depCount} dependents</small>
            </div>
            <div class="health-number ${severityClass(riskLevel)}">${healthScore}</div>
            <div class="risk-cell"><small>Risk</small><strong>${riskScore}</strong></div>
            <div class="risk-cell"><small>24h Reads</small><strong>${v.reads || '—'}</strong></div>
            <div class="risk-cell"><small>Median</small><strong>${v.median || '—'}</strong></div>
          </div>
        `;
      }).join('');

      $$('.risk-row').forEach(r => r.addEventListener('click', () => {
        selectView(r.dataset.view);
        gotoPage('views');
      }));
    }

    // Pressure List Top 5
    const pressures = state.data.pressures || [];
    const pressureList = $('#pressureList');
    if (pressureList) {
      pressureList.innerHTML = pressures.slice(0, 5).map(p => `
        <div class="pressure-item">
          <strong>${p.name}</strong><span>${p.score}/100</span>
          <div class="pressure-bar"><i style="width:${p.score}%"></i></div>
          <div class="pressure-meta"><span>${p.refs} view</span><span>${p.paths} path · ${p.critical || 0} critical</span></div>
        </div>
      `).join('') || '<div class="empty-state"><p>Base tablo baskısı tespit edilmedi.</p></div>';
    }

    // Feed items from findings
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
      if (topProblems.length > 0) {
        feed.innerHTML = topProblems.map(p => `
          <div class="feed-item">
            <span class="feed-icon ${p.severity === 'CRITICAL' ? 'danger' : p.severity === 'HIGH' ? 'warning' : 'info'}">${p.symbol || '!'}</span>
            <div>
              <strong>${p.title}</strong>
              <p>${p.detail}</p>
              <small>${p.viewName} · Ceza: -${p.penalty}</small>
            </div>
          </div>
        `).join('');
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

  // --- 3. View Inventory & Detail Pane ---
  function renderViewList(search = '') {
    const q = search.toLocaleLowerCase('tr').trim();
    const views = state.data.views || [];
    const filter = state.currentRiskFilter;
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

      // Avoid re-rendering if options and values are identical
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
        renderViewList($('#viewSearch')?.value || '');
      };
    }

    const rows = views.filter(v => {
      const vRisk = String(v.risk || v.riskLevel || '').toLowerCase();
      const matchesRisk = filter === 'all' || vRisk === filter;
      const vName = String(v.name || v.view_name || '').toLocaleLowerCase('tr');
      const matchesSearch = !q || vName.includes(q) || (v.database && v.database.toLowerCase().includes(q));
      const matchesDb = dbFilter === 'all' || (v.database && v.database.toLowerCase() === dbFilter.toLowerCase());
      return matchesRisk && matchesSearch && matchesDb;
    });

    const criticalCount = views.filter(v => String(v.risk || v.riskLevel).toLowerCase() === 'critical').length;
    const highCount = views.filter(v => String(v.risk || v.riskLevel).toLowerCase() === 'high').length;

    if ($('#countAll')) $('#countAll').textContent = views.length;
    if ($('#countCritical')) $('#countCritical').textContent = criticalCount;
    if ($('#countHigh')) $('#countHigh').textContent = highCount;
    if ($('#inventoryTitle')) $('#inventoryTitle').textContent = `${views.length} View`;
    const navBadge = $('.nav-badge');
    if (navBadge) navBadge.textContent = views.length;

    const list = $('#viewList');
    if (!list) return;

    if (rows.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Aramaya veya seçili veritabanına uygun view bulunamadı.</p></div>';
      return;
    }

    list.innerHTML = rows.map(v => {
      const name = v.name || v.view_name;
      const canonical = v.canonicalId || name;
      const isActive = canonical === state.selectedCanonicalId || name === state.selectedViewName;
      const risk = v.risk || v.riskLevel || 'low';
      return `
        <div class="view-row ${isActive ? 'active' : ''}" data-view="${name}" data-canonical="${canonical}">
          <span class="risk-dot ${severityClass(risk)}"></span>
          <div style="flex:1;min-width:0">
            <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;font-size:13px;line-height:1.35;margin-bottom:3px" title="${name}">${name}</strong>
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted)">
              ${v.database ? `<span class="db-badge" style="font-size:9.5px;padding:1px 5px;margin:0">${v.database}</span>` : ''}
              <small style="font-size:11px">Risk ${v.riskScore || 0} · ${v.reads || '—'} reads</small>
            </div>
          </div>
          <span class="view-health">${v.health || v.healthScore || 60}</span>
        </div>
      `;
    }).join('');

    $$('.view-row').forEach(r => {
      r.addEventListener('click', () => selectView(r.dataset.canonical || r.dataset.view));
    });
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
    return `-- View SQL Tanımı (${identifier}):\nSELECT *\nFROM dbo.[${identifier.split('.').pop()}] WITH (NOLOCK)\nWHERE 1 = 1;`;
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
    });

    if ($('#detailViewName')) $('#detailViewName').textContent = name;
    if ($('#detailViewMeta')) $('#detailViewMeta').textContent = `${v.database || ''} · ${v.schema_name || 'dbo'} · modify ${v.modified || 'Bilinmiyor'}`;
    if ($('#detailHealth')) $('#detailHealth').textContent = v.health || v.healthScore || 60;
    const riskLabel = $('#detailRisk');
    if (riskLabel) {
      const rLevel = String(v.riskLevel || v.risk || 'LOW').toUpperCase();
      riskLabel.className = `${severityClass(rLevel)}-text`;
      riskLabel.textContent = `${rLevel} · ${v.riskScore || 0}`;
    }

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
    if ($('#statReads')) $('#statReads').textContent = v.reads || '—';
    if ($('#statMedian')) $('#statMedian').textContent = v.median || '—';

    // Risk Breakdown Bars
    const barsContainer = $('#riskBars');
    if (barsContainer) {
      const riskBars = v.riskBars || MOCK.riskBars;
      barsContainer.innerHTML = riskBars.map(r => `
        <div class="risk-bar-row">
          <span>${r.label}</span>
          <div class="risk-bar-track"><i style="width:${Math.min(100, r.value)}%"></i></div>
          <b>−${r.penalty}</b>
        </div>
      `).join('');
    }

    // Problems
    const problems = v.problems || MOCK.problems;
    const tabProblemCount = $('#tabProblemCount');
    if (tabProblemCount) tabProblemCount.textContent = problems.length;
    const topProblemCountText = $('#topProblemCountText');
    if (topProblemCountText) topProblemCountText.textContent = `${problems.length} bulgu`;

    const topProblems = $('#topProblems');
    if (topProblems) {
      topProblems.innerHTML = problems.slice(0, 4).map(p => `
        <div class="problem-item">
          <span class="problem-symbol">${p.symbol || '!'}</span>
          <div>
            <strong>${p.title}</strong>
            <small>${p.detail}</small>
          </div>
          <b>−${p.penalty}</b>
        </div>
      `).join('') || '<p style="font-size:12px;color:var(--text-muted);margin:8px 0">Bulgu tespit edilmedi.</p>';
    }

    const fullProblems = $('#fullProblemList');
    if (fullProblems) {
      fullProblems.innerHTML = problems.map(p => {
        const sevClass = severityClass(p.severity);
        const sevLabel = (window.uiText?.severity[p.severity]?.label) || p.severity;
        const why = p.why || (window.uiText?.findings[p.code]?.why) || 'SQL Server bu işlem sırasında fazladan I/O ve CPU tüketebilir; sorgu planı verimsiz operatörler içerebilir.';
        const recommendation = p.recommendation || 'İlgili view veya alt sorguları gözden geçirin, execution planı analiz edin ve gereksiz tablo tekrarlarını kaldırın.';

        return `
          <article class="structured-problem-card">
            <div class="spc-head">
              <div>
                <span class="severity-pill ${sevClass}" style="margin-bottom:6px">${sevLabel}</span>
                <h4 class="spc-title">${p.title}</h4>
              </div>
              <b style="color:var(--red);font-size:14px">−${p.penalty || 10} Puan</b>
            </div>
            <p class="spc-desc">${p.detail}</p>

            <div class="spc-section why">
              <strong>Neden Önemli?</strong>
              <p>${why}</p>
            </div>

            <div class="spc-section">
              <strong>Ne Yapılabilir? (Öneri)</strong>
              <p>${recommendation}</p>
            </div>

            <div class="spc-evidence">
              <span><b>Kanıt:</b> ${p.evidence || 'Statik Bağımlılık Grafiği'}</span>
              <span>•</span>
              <span class="connected-pill" style="font-size:11px;color:var(--yellow);border-color:rgba(247,200,106,0.3)">${p.evidenceGrade || 'Grade D (Heuristik)'}</span>
            </div>

            <div class="spc-actions">
              <button class="button ghost mini btn-spc-graph" data-view="${name}">⌁ Bağımlılık Haritasını Aç</button>
              <button class="button ghost mini btn-spc-sql" data-view="${name}">⚡ SQL'i Gör</button>
              <button class="button primary mini btn-spc-ai" data-view="${name}">✦ AI ile İncele</button>
            </div>
          </article>
        `;
      }).join('') || '<div class="empty-state"><p>Tebrikler! Bu view üzerinde riskli pattern saptanmadı.</p></div>';

      // Bind structured problem card action buttons
      $$('.btn-spc-graph').forEach(b => {
        b.onclick = () => {
          gotoPage('graph');
          const gi = $('#graphSearchInput');
          if (gi) { gi.value = b.dataset.view; renderGraph(); }
        };
      });
      $$('.btn-spc-sql').forEach(b => {
        b.onclick = () => {
          $(`.detail-tabs button[data-detail-tab="sql"]`)?.click();
        };
      });
      $$('.btn-spc-ai').forEach(b => {
        b.onclick = () => {
          gotoPage('refactor');
        };
      });
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
      const totalReads = v.reads || (rt ? (rt.totalReads > 1e6 ? `${(rt.totalReads / 1e6).toFixed(1)}M` : rt.totalReads.toLocaleString()) : '0');
      const avgDuration = v.median || (rt ? `${rt.avgDurationMs || 0} ms` : '—');
      const execCount = rt ? (rt.executionCount || rt.count || 1) : 0;
      const evidenceGrade = rt?.evidenceGrade || 'B';
      const evidenceSource = rt?.source || 'Query Store / DMV Plan Cache';

      runtimeTab.innerHTML = `
        <div style="padding:12px 0">
          <div class="setting-card" style="margin-bottom:14px;border:1px solid #293042;background:rgba(18,22,32,0.96);padding:16px;border-radius:10px">
            <div style="flex:1">
              <strong style="font-size:14px;display:block;margin-bottom:4px">Runtime Attribution & Kanıt Derecesi</strong>
              <p style="font-size:12.5px;color:var(--text-muted);margin:0;line-height:1.45">
                View bağımsız derlenen bir nesne değildir. Bu view'i içeren çağıran sorgular üzerinden toplam <b>${totalReads}</b> mantıksal okuma (logical reads) tespit edilmiştir.
              </p>
            </div>
            <span class="connected-pill" style="font-size:11px;color:var(--yellow);border-color:rgba(247,200,106,0.3);background:rgba(247,200,106,0.08);padding:4px 10px;border-radius:6px">
              GRADE ${evidenceGrade} (${evidenceSource})
            </span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:18px">
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
              <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Mantıksal Okuma (Reads)</span>
              <strong style="font-size:18px;color:var(--text-primary)">${totalReads}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
              <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Ortalama Yürütme Süresi</span>
              <strong style="font-size:18px;color:var(--text-primary)">${avgDuration}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
              <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Tahmini Yürütme Sıklığı</span>
              <strong style="font-size:18px;color:var(--text-primary)">${execCount > 0 ? `~${execCount} çalıştırma` : '—'}</strong>
            </div>
            <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
              <span style="font-size:11.5px;color:var(--text-muted);display:block;margin-bottom:4px">Plan Regresyon Durumu</span>
              <strong style="font-size:15px;color:${rt?.isRegressed ? 'var(--red)' : 'var(--green)'}">
                ${rt?.isRegressed ? '⚠ Regresyon Tespit Edildi' : '✓ Stabil'}
              </strong>
            </div>
          </div>

          <div>
            <h4 style="font-size:13.5px;margin-bottom:8px">İlişkili Çağıran Sorgular (Correlated Queries)</h4>
            <div style="background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:8px;padding:12px">
              <code style="font-size:12px;color:var(--purple-light);display:block;margin-bottom:6px">
                SELECT * FROM dbo.[${name}]
              </code>
              <small style="color:var(--text-muted);font-size:11px">
                Query Store plan hash ve sys.dm_exec_query_stats önbelleğindeki correlated sorgu metinleri analiz edilmiştir.
              </small>
            </div>
          </div>
        </div>
      `;
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

  // Filter Chips in Views
  $$('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentRiskFilter = btn.dataset.risk;
      $$('.filter-chip').forEach(b => b.classList.toggle('active', b === btn));
      renderViewList($('#viewSearch')?.value || '');
    });
  });

  const viewSearchInput = $('#viewSearch');
  if (viewSearchInput) {
    viewSearchInput.addEventListener('input', e => renderViewList(e.target.value));
  }

  // Detail Tabs Switcher
  $$('.detail-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      $$('.detail-tabs button').forEach(x => x.classList.toggle('active', x === b));
      $$('.detail-tab').forEach(t => t.classList.toggle('active', t.id === `detail-tab-${b.dataset.detailTab}`));
    });
  });

  $$('[data-detail-tab-jump]').forEach(b => {
    b.addEventListener('click', () => {
      const tabBtn = $(`.detail-tabs button[data-detail-tab="${b.dataset.detailTabJump}"]`);
      if (tabBtn) tabBtn.click();
    });
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

          const elem = $(`#gnode_${node.id}`);
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
        <div style="padding:7px 12px;font-size:11px;color:var(--text-muted);background:rgba(0,0,0,0.25);border-top:1px solid #202636;text-align:center">
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
            <div style="padding:6px 10px;background:var(--surface2);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12.5px;font-weight:600">AA_URETIM_MALZEME_PLANLAMA</span>
              <small style="color:var(--red);font-weight:700">4 Rota</small>
            </div>
            <div style="padding:6px 10px;background:var(--surface2);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12.5px;font-weight:600">AA_ISEMRI_MALZEME_DURUMLARI</span>
              <small style="color:var(--red);font-weight:700">2 Rota</small>
            </div>
            <div style="padding:6px 10px;background:var(--surface2);border-radius:var(--radius-xs);display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12.5px;font-weight:600">AA_STOK_HAREKET_OZET</span>
              <small style="color:var(--yellow);font-weight:700">1 Rota</small>
            </div>
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
        gotoPage('workbench');
        const wbInput = $('#wbSqlInput');
        if (wbInput) {
          wbInput.value = `SELECT TOP 50 *\nFROM [${p.database || 'MikroDB'}].[dbo].[${p.name}] WITH (NOLOCK);`;
        }
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
        gotoPage('refactor');
      };
    });
  }

  // --- 7. Runtime & Regression Page ---
  function renderRuntime() {
    const table = $('#regressionTable');
    if (!table) return;
    const regs = state.data.regressions || [];

    table.innerHTML = `
      <div class="reg-row header">
        <span>Nesne / Çağıran Sorgu</span>
        <span>Önceki Süre</span>
        <span>Güncel Süre</span>
        <span>Fark (Değişim)</span>
        <span>Mantıksal Okuma</span>
        <span>Kanıt Derecesi</span>
      </div>
      ${regs.map(r => `
        <div class="reg-row">
          <div>
            <strong>${r.name}</strong>
            <small>${r.note || 'Query Store ile eşleştirildi'}</small>
          </div>
          <span>${r.before}</span>
          <span>${r.now}</span>
          <span class="delta-up">${r.delta}</span>
          <span>${r.reads}</span>
          <span class="connected-pill" style="font-size:11px;color:var(--yellow);border-color:rgba(247,200,106,0.25)">${r.evidence || 'Grade A'}</span>
        </div>
      `).join('')}
    `;
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

    // 4. AI Provider Test Connection
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
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'AI bağlantısı kurulamadı.');

        toast('AI Bağlantısı Başarılı', `${json.data.model} modeliyle iletişim doğrulandı.`, 'success');
      } catch (err) {
        toast('AI Bağlantı Hatası', err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });

    // 5. Reset Scoring Defaults
    $('#btnResetScoring')?.addEventListener('click', () => {
      $('#weightRuntime').value = 35;
      $('#weightRegression').value = 25;
      $('#weightRepeated').value = 15;
      $('#weightDepth').value = 10;
      $('#weightSargable').value = 10;
      $('#weightBlast').value = 5;
      toast('Varsayılanlar Yüklendi', 'Önerilen docs/03-SCORING.md ağırlıkları geri yüklendi.');
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
        await fetch('/api/settings/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scoring: weights })
        });
        toast('Ağırlıklar Kaydedildi', 'Puanlama modeli başarıyla güncellendi.', 'success');
      } catch (err) {
        toast('Hata', err.message, 'error');
      }
    });

    // 7. Appearance Controls (Theme, Density, Font Scale, Grid, Animations)
    const savedTheme = localStorage.getItem('sql-studio-theme') || localStorage.getItem('sql_studio_theme') || 'dark';
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

    document.body.classList.remove('theme-light', 'theme-midnight');
    if (effectiveTheme === 'light') {
      document.body.classList.add('theme-light');
    } else if (effectiveTheme === 'midnight') {
      document.body.classList.add('theme-midnight');
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

  // --- 9. Scan Coordination ---
  async function triggerScan() {
    const btn = $('#scanButton');
    const oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>↻</span> Taranıyor...';

    try {
      if (!state.connected) {
        toast('Demo Taraması', 'Aktif SQL bağlantısı yok; mock veri seti yenilendi.', '');
        await new Promise(r => setTimeout(r, 600));
        state.isLive = false;
        state.lastScanTime = new Date();
        state.data.views = MOCK.views;
        state.data.pressures = MOCK.pressures;
        state.data.duplicates = MOCK.duplicates;
        state.data.regressions = MOCK.regressions;
      } else {
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
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }

  $('#scanButton')?.addEventListener('click', triggerScan);

  // --- 10. Modal & Connection Lifecycle ---
  const modal = $('#connectionModal');
  function openModal() { modal?.classList.remove('hidden'); }
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

  // --- 11. AI Refactor Demo Runner ---
  $('#runRefactor')?.addEventListener('click', () => {
    const btn = $('#runRefactor');
    const progress = $('#aiProgress');
    const panel = $('#candidatePanel');
    const bar = progress?.querySelector('i');
    const head = progress?.querySelector('.progress-head span');
    const pct = progress?.querySelector('.progress-head b');

    if (!btn || !progress || !panel) return;

    btn.disabled = true;
    progress.classList.remove('hidden');
    panel.classList.add('hidden');

    const stages = [
      [18, 'Dependency context hazırlanıyor...'],
      [38, 'Index ve statistics metadata ekleniyor...'],
      [57, 'Plan findings normalize ediliyor...'],
      [76, 'AI candidate üretiliyor...'],
      [92, 'Semantic guardrail kontrolleri hazırlanıyor...'],
      [100, 'Candidate V2 hazır']
    ];
    let ix = 0;

    const timer = setInterval(() => {
      if (ix >= stages.length) {
        clearInterval(timer);
        setTimeout(() => {
          panel.classList.remove('hidden');
          btn.disabled = false;
          toast('Candidate V2 Hazır', 'Henüz doğrulanmadı (UNVALIDATED). Deploy edilmez.', 'success');
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
        return;
      }
      const [n, msg] = stages[ix++];
      if (bar) bar.style.width = `${n}%`;
      if (pct) pct.textContent = `${n}%`;
      if (head) head.textContent = msg;
    }, 450);
  });

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
      setValVerdict('DOĞRULANMADI');
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
        const wbInput = $('#wbSqlInput');
        if (wbInput) wbInput.value = origInput.value;
        gotoPage('workbench');
      }
    });

    $('#btnValSendCandToWb')?.addEventListener('click', () => {
      if (candInput?.value) {
        const wbInput = $('#wbSqlInput');
        if (wbInput) wbInput.value = candInput.value;
        gotoPage('workbench');
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
      setValVerdict('DOĞRULANMADI');
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

      btnRunBoth.disabled = true;
      btnRunBoth.textContent = 'Karşılaştırılıyor...';

      try {
        if (state.isLive) {
          const [resO, resC] = await Promise.all([
            fetch('/api/workbench/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: oSql, timeoutMs: 30000 })
            }).then(r => r.json()),
            fetch('/api/workbench/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: cSql, timeoutMs: 30000 })
            }).then(r => r.json())
          ]);

          if (!resO.ok) throw new Error(`Orijinal sorgu: ${resO.error}`);
          if (!resC.ok) throw new Error(`Aday sorgu: ${resC.error}`);

          $('#valReadsBefore').textContent = (resO.metrics.logicalReads || 0).toLocaleString();
          $('#valReadsAfter').textContent = (resC.metrics.logicalReads || 0).toLocaleString();
          $('#valCpuBefore').textContent = `${resO.metrics.cpuMs || 0} ms`;
          $('#valCpuAfter').textContent = `${resC.metrics.cpuMs || 0} ms`;
          $('#valTimeBefore').textContent = `${resO.metrics.durationMs || 0} ms`;
          $('#valTimeAfter').textContent = `${resC.metrics.durationMs || 0} ms`;
          $('#valMultBefore').textContent = (resO.rowsReturned || 0).toLocaleString();
          $('#valMultAfter').textContent = (resC.rowsReturned || 0).toLocaleString();
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
        btnRunBoth.textContent = '▶ Doğrula';
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

      btnValidate.disabled = true;
      btnValidate.textContent = '✦ Doğrulanıyor...';
      const statusPill = $('#valPipelineStatus');
      if (statusPill) {
        statusPill.textContent = 'ÇALIŞIYOR...';
        statusPill.className = 'status-pill status-warning';
      }

      try {
        if (state.isLive) {
          const res = await fetch('/api/validation/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ originalSql: oSql, candidateSql: cSql, sampleLimit: 1000 })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Validation başarısız.');

          renderValSteps(json.steps);
          setValVerdict(json.verdict === 'EXACT MATCH' ? 'SEMANTİK OLARAK DOĞRULANDI' : 'SONUÇ UYUŞMUYOR');
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
          setValVerdict('SEMANTİK OLARAK DOĞRULANDI');
        }
        toast('Doğrulama Tamamlandı', 'Tüm semantik denetim adımları başarıyla tamamlandı.', 'success');
      } catch (err) {
        toast('Doğrulama Hatası', err.message, 'error');
        setValVerdict('SONUÇ UYUŞMUYOR');
      } finally {
        btnValidate.disabled = false;
        btnValidate.textContent = '✦ Validation Lab Doğrulamasını Başlat';
      }
    });

    function renderValSteps(steps = []) {
      for (const st of steps) {
        const elStep = $(`#valStep-${st.id}`);
        const elStatus = $(`#valStepStatus-${st.id}`);
        const elDesc = $(`#valStepDesc-${st.id}`);

        const isPass = st.status === 'PASS';
        const isFail = st.status === 'FAILED';
        const statusLabel = isPass ? 'BAŞARILI' : (isFail ? 'BAŞARISIZ' : 'BEKLİYOR');

        if (elStep) {
          elStep.className = `validation-step ${isPass ? 'done' : (isFail ? 'failed' : '')}`;
        }
        if (elStatus) {
          elStatus.textContent = statusLabel;
          elStatus.style.color = isPass ? 'var(--green)' : (isFail ? 'var(--red)' : 'var(--yellow)');
        }
        if (elDesc && st.detail) {
          elDesc.textContent = st.detail;
        }

        // Summary block
        if (st.id === 'schema' && $('#valSummarySchema')) {
          $('#valSummarySchema').textContent = isPass ? 'Birebir Eşleşti ✓' : 'Uyuşmazlık ✕';
          $('#valSummarySchema').style.color = isPass ? 'var(--green)' : 'var(--red)';
        }
        if (st.id === 'rowCount' && $('#valSummaryRowCount')) {
          $('#valSummaryRowCount').textContent = isPass ? 'Eşit (1,000) ✓' : 'Farklı ✕';
          $('#valSummaryRowCount').style.color = isPass ? 'var(--green)' : 'var(--red)';
        }
        if (st.id === 'setMatch' && $('#valSummarySetMatch')) {
          $('#valSummarySetMatch').textContent = isPass ? 'Fark Yok (0) ✓' : 'Küme Farkı Var ✕';
          $('#valSummarySetMatch').style.color = isPass ? 'var(--green)' : 'var(--red)';
        }
        if (st.id === 'multiplicity' && $('#valSummaryMultiplicity')) {
          $('#valSummaryMultiplicity').textContent = isPass ? 'Frekanslar Korundu ✓' : 'Frekans Farkı ✕';
          $('#valSummaryMultiplicity').style.color = isPass ? 'var(--green)' : 'var(--red)';
        }
      }
    }

    function setValVerdict(verdict) {
      const vText = $('#valVerdictText');
      const vSub = $('#valVerdictSub');
      const pStatus = $('#valPipelineStatus');
      const sumVerdict = $('#valSummaryVerdict');

      if (vText) {
        vText.textContent = verdict;
        if (verdict === 'SEMANTİK OLARAK DOĞRULANDI') {
          vText.style.color = 'var(--green)';
        } else if (verdict === 'DOĞRULANMADI') {
          vText.style.color = 'var(--yellow)';
        } else {
          vText.style.color = 'var(--red)';
        }
      }

      if (vSub) {
        if (verdict === 'SEMANTİK OLARAK DOĞRULANDI') {
          vSub.textContent = 'Şema, satır sayısı, EXCEPT ve satır çokluğu kanıtlandı ✓';
        } else if (verdict === 'DOĞRULANMADI') {
          vSub.textContent = 'Doğrulama adımları bekleniyor';
        } else {
          vSub.textContent = 'Sonuç veya şema uyuşmazlığı saptandı ✕';
        }
      }

      if (sumVerdict) {
        sumVerdict.textContent = verdict;
        sumVerdict.className = verdict === 'SEMANTİK OLARAK DOĞRULANDI' ? 'positive-text' : (verdict === 'DOĞRULANMADI' ? 'warning-text' : 'danger-text');
      }

      if (pStatus) {
        pStatus.textContent = verdict;
        if (verdict === 'SEMANTİK OLARAK DOĞRULANDI') {
          pStatus.className = 'status-pill status-ready';
        } else if (verdict === 'DOĞRULANMADI') {
          pStatus.className = 'status-pill';
        } else {
          pStatus.className = 'status-pill status-danger';
        }
      }
    }
  }

  // ============================================================
  // --- 14. AI WORKBENCH & INDEX INTEGRATION (Phase 2E) ---
  // ============================================================
  function initAiWorkbenchIntegration() {
    // Candidate panel -> Open in Workbench
    $('#btnOpenCandidateInWorkbench')?.addEventListener('click', () => {
      const sql = $('#candidateSqlText')?.value || '';
      if (sql) {
        const wbInput = $('#wbSqlInput');
        if (wbInput) {
          wbInput.value = sql;
          const count = sql.split('\n').length;
          let lineStr = '';
          for (let i = 1; i <= Math.max(1, count); i++) lineStr += i + '\n';
          if ($('#wbLineNumbers')) $('#wbLineNumbers').textContent = lineStr.trimEnd();
        }
        gotoPage('workbench');
        toast('Workbench Hazır', 'AI refactor adayı editöre aktarıldı.');
      }
    });

    // View Detail SQL tab -> Open in Workbench
    $('#btnOpenSqlInWorkbench')?.addEventListener('click', () => {
      const sql = $('#sqlCode')?.textContent || '';
      if (sql) {
        const wbInput = $('#wbSqlInput');
        if (wbInput) {
          wbInput.value = sql;
          const count = sql.split('\n').length;
          let lineStr = '';
          for (let i = 1; i <= Math.max(1, count); i++) lineStr += i + '\n';
          if ($('#wbLineNumbers')) $('#wbLineNumbers').textContent = lineStr.trimEnd();
        }
        gotoPage('workbench');
        toast('Workbench Hazır', 'View tanımı editöre aktarıldı.');
      }
    });

    // Candidate panel -> Send to Validation Lab
    $$('[data-detail-tab-jump="validation"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const origSql = $('#sqlCode')?.textContent || '';
        const candSql = $('#candidateSqlText')?.value || '';
        if ($('#valOrigSql') && origSql) $('#valOrigSql').value = origSql;
        if ($('#valCandSql') && candSql) $('#valCandSql').value = candSql;
        gotoPage('validation');
        toast('Validation Lab', 'Sorgular karşılaştırma ekranına aktarıldı.');
      });
    });

    // Index Tab Refresh button
    $('#btnRefreshIndexes')?.addEventListener('click', async () => {
      const viewName = state.selectedViewName;
      const body = $('#detailIndexTableBody');
      if (!body) return;

      body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">İndeksler sorgulanıyor...</td></tr>';
      try {
        const res = await fetch(`/api/views/${encodeURIComponent(viewName)}/indexes`);
        const json = await res.json();
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
      { title: 'Bağımlılık Haritası (Dependency X-Ray)', category: 'SAYFALAR & AKSIYONLAR', icon: '⌁', action: () => gotoPage('graph') },
      { title: 'Runtime & Regresyon Analizi', category: 'SAYFALAR & AKSIYONLAR', icon: '∿', action: () => gotoPage('runtime') },
      { title: 'AI Refactoring Danışmanı', category: 'SAYFALAR & AKSIYONLAR', icon: '✦', action: () => gotoPage('refactor') },
      { title: 'Validation Lab (Semantik Kanıt)', category: 'SAYFALAR & AKSIYONLAR', icon: '✓', action: () => gotoPage('validation') },
      { title: 'SQL Workbench (Sorgu & Plan Editörü)', category: 'SAYFALAR & AKSIYONLAR', icon: '⚡', action: () => gotoPage('workbench') },
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
  const workbenchState = {
    activeRequestId: null,
    isRunning: false,
    lastResult: null,
    lastPlan: null
  };

  function initWorkbench() {
    const input = $('#wbSqlInput');
    const gutter = $('#wbLineNumbers');
    const statusPill = $('#wbStatusPill');
    const btnRun = $('#btnWbRun');
    const btnStop = $('#btnWbStop');
    const btnEstPlan = $('#btnWbEstPlan');
    const btnActPlan = $('#btnWbActPlan');
    const btnBenchmark = $('#btnWbBenchmark');
    const btnFormat = $('#btnWbFormat');
    const btnClear = $('#btnWbClear');

    function updateLineNumbers() {
      if (!input || !gutter) return;
      const count = (input.value || '').split('\n').length;
      let text = '';
      for (let i = 1; i <= Math.max(1, count); i++) text += i + '\n';
      gutter.textContent = text.trimEnd();
    }

    if (input) {
      input.addEventListener('input', updateLineNumbers);
      input.addEventListener('scroll', () => {
        if (gutter) gutter.scrollTop = input.scrollTop;
      });
      // Initial line count
      updateLineNumbers();

      // Initialize Schema-Aware IntelliSense Engine
      const popupEl = $('#wbIntelliSense');
      let intelliSense = null;
      if (input && popupEl && window.StudioIntelliSense) {
        intelliSense = new StudioIntelliSense(input, popupEl, {
          getActiveDatabase: () => $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase,
          onInsert: () => updateLineNumbers()
        });
      }

      async function loadMetadataCatalog() {
        const activeDb = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
        try {
          const res = await fetch(`/api/workbench/metadata?database=${encodeURIComponent(activeDb)}`);
          const json = await res.json();
          if (json.ok && json.data) {
            if (intelliSense) intelliSense.setCatalog(json.data);
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
            if (intelliSense) intelliSense.setCatalog(json.data);
            const time = new Date(json.data.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const freshEl = $('#wbMetaFreshness');
            if (freshEl) freshEl.textContent = `Metadata: ${time}`;
            toast('Metadata Yenilendi', `Metadata kataloğu güncellendi (${json.data.views.length} view, ${json.data.tables.length} tablo).`, 'success');
          }
        } catch (err) {
          toast('Hata', err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      $('#wbDatabaseSelect')?.addEventListener('change', () => {
        loadMetadataCatalog();
      });

      loadMetadataCatalog();
      window.refreshWorkbenchMetadata = loadMetadataCatalog;

      // Keyboard shortcuts in editor
      input.addEventListener('keydown', e => {
        // Tab key indent
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = input.value.substring(0, start) + '    ' + input.value.substring(end);
          input.selectionStart = input.selectionEnd = start + 4;
          updateLineNumbers();
          return;
        }
        // Ctrl+Enter or F5 -> Run
        if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
          e.preventDefault();
          btnRun?.click();
          return;
        }
        // Ctrl+L -> Estimated Plan
        if (e.ctrlKey && e.key.toLowerCase() === 'l') {
          e.preventDefault();
          btnEstPlan?.click();
          return;
        }
      });
    }

    // Tabs Switcher
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

    // Clear Button
    btnClear?.addEventListener('click', () => {
      if (input) {
        input.value = '';
        updateLineNumbers();
        input.focus();
      }
    });

    // Format SQL
    btnFormat?.addEventListener('click', () => {
      if (!input || !input.value.trim()) return;
      let sql = input.value;
      const keywords = [
        'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING',
        'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
        'OUTER APPLY', 'CROSS APPLY', 'UNION ALL', 'UNION', 'WITH', 'AS',
        'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
      ];
      keywords.forEach(kw => {
        const re = new RegExp(`\\b${kw}\\b`, 'gi');
        sql = sql.replace(re, kw);
      });
      // Add newline before major clauses
      ['FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LEFT JOIN', 'INNER JOIN', 'OUTER APPLY'].forEach(kw => {
        const re = new RegExp(`\\s+${kw}\\s+`, 'g');
        sql = sql.replace(re, `\n${kw} `);
      });
      input.value = sql.trim();
      updateLineNumbers();
      toast('Formatlandı', 'SQL sorgusu biçimlendirildi.');
    });

    // 1. RUN QUERY
    btnRun?.addEventListener('click', async () => {
      const sql = input?.value.trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen çalıştırılacak bir SELECT sorgusu yazın.', 'error');
        return;
      }

      const dbTarget = $('#wbDatabaseSelect')?.value || state.activeDatabase || state.primaryDatabase;
      const timeoutMs = Number($('#wbTimeoutSelect')?.value || 30000);
      const reqId = 'wb_' + Date.now();
      workbenchState.activeRequestId = reqId;
      workbenchState.isRunning = true;

      setWbRunningState(true);
      const startTime = performance.now();

      try {
        if (state.isLive) {
          const res = await fetch('/api/workbench/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, database: dbTarget, timeoutMs, requestId: reqId })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Sorgu çalıştırılamadı.');

          renderWbResults(json);
          toast('Sorgu Tamamlandı', `${json.rowsReturned || json.rows.length} satır [${dbTarget}] üzerinde ${json.metrics.durationMs} ms içinde getirildi.`, 'success');
        } else {
          // Demo Mode Mock Execution
          await new Promise(r => setTimeout(r, 450));
          const mockCols = ['sth_stok_kod', 'sto_isim', 'IslemAdedi', 'ToplamMiktar', 'BirimFiyat', 'SonTarih'];
          const mockRows = Array.from({ length: 48 }, (_, i) => ({
            sth_stok_kod: `HM-${1000 + i}`,
            sto_isim: `Hammadde Kalemi ${i + 1}`,
            IslemAdedi: Math.floor(Math.random() * 4200) + 120,
            ToplamMiktar: (Math.random() * 85000 + 500).toFixed(2),
            BirimFiyat: (Math.random() * 450 + 10).toFixed(2),
            SonTarih: '2026-03-01 14:22:00'
          }));

          const mockData = {
            metrics: {
              durationMs: Math.round(performance.now() - startTime),
              cpuMs: 240,
              logicalReads: 14280,
              physicalReads: 0,
              rowsReturned: mockRows.length,
              evidence: 'Demo Execution'
            },
            columns: mockCols,
            rows: mockRows,
            totalRows: mockRows.length,
            statistics: {
              tables: [
                { table: 'STOK_HAREKETLERI', scanCount: 4, logicalReads: 12400, physicalReads: 0 },
                { table: 'STOKLAR', scanCount: 1, logicalReads: 1880, physicalReads: 0 }
              ],
              totalLogicalReads: 14280,
              cpuTimeMs: 240,
              elapsedTimeMs: Math.round(performance.now() - startTime)
            },
            messages: [
              `SQL Server Execution Times (${dbTarget}): CPU time = 240 ms, elapsed time = 310 ms.`,
              "Table 'STOK_HAREKETLERI'. Scan count 4, logical reads 12400, physical reads 0.",
              "Table 'STOKLAR'. Scan count 1, logical reads 1880, physical reads 0.",
              `(${mockRows.length} rows affected)`
            ]
          };
          renderWbResults(mockData);
          toast('Demo Çalıştırıldı', `[${dbTarget}] simüle edildi.`, 'success');
        }
      } catch (err) {
        toast('Sorgu Hatası', err.message, 'error');
        setWbErrorState(err.message);
      } finally {
        setWbRunningState(false);
      }
    });

    // 2. STOP QUERY
    btnStop?.addEventListener('click', async () => {
      if (!workbenchState.activeRequestId) return;
      try {
        if (state.isLive) {
          await fetch('/api/workbench/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: workbenchState.activeRequestId })
          });
        }
        toast('İptal Edildi', 'Sorgu iptal isteği gönderildi.');
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

    // 3. ESTIMATED PLAN
    btnEstPlan?.addEventListener('click', async () => {
      await runPlanAnalysis('estimated');
    });

    // 4. ACTUAL PLAN
    btnActPlan?.addEventListener('click', async () => {
      await runPlanAnalysis('actual');
    });

    async function runPlanAnalysis(mode) {
      const sql = input?.value.trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen plan alınacak bir SELECT sorgusu yazın.', 'error');
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

          renderWbPlan(json.planType, json.parsed);
          switchWbTab('plan');
          toast('Plan Hazır', `${json.planType} execution plan [${dbTarget}] başarıyla analiz edildi.`, 'success');
        } else {
          // Demo Mode Plan Synthesis
          await new Promise(r => setTimeout(r, 400));
          const isActual = mode === 'actual';
          const mockPlan = {
            totalSubTreeCost: 2.84,
            totalEstRows: 1420,
            optimizationLevel: 'FULL',
            operatorCount: 6,
            topOperators: [
              { nodeId: 1, physicalOp: 'Clustered Index Scan', logicalOp: 'Clustered Index Scan', targetObject: 'STOK_HAREKETLERI', cost: 1.85, costPercent: 65, estimatedRows: 12000, actualRows: isActual ? 14850 : null },
              { nodeId: 2, physicalOp: 'Hash Match (Aggregate)', logicalOp: 'Hash Match', targetObject: '', cost: 0.58, costPercent: 20, estimatedRows: 1420, actualRows: isActual ? 1420 : null },
              { nodeId: 3, physicalOp: 'Index Seek', logicalOp: 'Index Seek', targetObject: 'STOKLAR', cost: 0.28, costPercent: 10, estimatedRows: 1420, actualRows: isActual ? 1420 : null }
            ],
            operators: [],
            warnings: [
              { type: 'MISSING_STATS', title: 'Stale Statistics', severity: 'HIGH', detail: 'STOK_HAREKETLERI tablosunda son istatistik güncellemesinden bu yana yüksek oranda veri değişimi tespit edildi.' }
            ],
            missingIndexes: [
              {
                impact: 88,
                table: 'dbo.STOK_HAREKETLERI',
                indexDdl: 'CREATE NONCLUSTERED INDEX [IX_STOK_HAREKETLERI_sth_stok_kod] ON [dbo].[STOK_HAREKETLERI] ([sth_stok_kod]) INCLUDE ([sth_miktar], [sth_tarih]);'
              }
            ],
            cardinalityMismatches: isActual ? [
              { nodeId: 1, operator: 'Clustered Index Scan', object: 'STOK_HAREKETLERI', estimated: 1200, actual: 14850, factor: '12x Under-estimated', severity: 'CRITICAL' }
            ] : []
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

    // 5. BENCHMARK
    btnBenchmark?.addEventListener('click', async () => {
      const sql = input?.value.trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen benchmark uygulanacak bir SELECT sorgusu yazın.', 'error');
        return;
      }

      const runs = Number($('#wbRunsSelect')?.value || 3);
      if (runs > 3) {
        const ok = confirm(`UYARI: Bu işlem veritabanı üzerinde sorguyu arka arkaya ${runs} kez yürütecektir. Devam etmek istiyor musunuz?`);
        if (!ok) return;
      }

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
          // Demo Mode Benchmark Simulation
          await new Promise(r => setTimeout(r, 600));
          const demoRuns = [
            { iteration: 1, isWarmUp: true, durationMs: 42, cpuMs: 38, logicalReads: 14280, rows: 48 },
            { iteration: 2, isWarmUp: false, durationMs: 14, cpuMs: 12, logicalReads: 14280, rows: 48 },
            { iteration: 3, isWarmUp: false, durationMs: 13, cpuMs: 11, logicalReads: 14280, rows: 48 }
          ];
          renderWbBenchmark({
            totalRuns: runs,
            database: dbTarget,
            warmUpIncluded: false,
            summary: {
              medianMs: 13,
              p95Ms: 14,
              minMs: 13,
              maxMs: 14,
              avgMs: 13.5,
              logicalReadsMedian: 14280,
              cpuMedianMs: 11.5
            },
            runs: demoRuns
          });
          switchWbTab('statistics');
          toast('Demo Benchmark Tamamlandı', 'Median: 13 ms · P95: 14 ms', 'success');
        }
      } catch (err) {
        toast('Benchmark Hatası', err.message, 'error');
      } finally {
        setWbRunningState(false);
      }
    });

    // 6. COPY TABLE & EXPORT CSV
    $('#btnWbCopyTable')?.addEventListener('click', () => {
      if (!workbenchState.lastResult || !workbenchState.lastResult.rows?.length) {
        toast('Kopyalanacak Veri Yok', 'Önce bir sorgu çalıştırın.');
        return;
      }
      const cols = workbenchState.lastResult.columns;
      const rows = workbenchState.lastResult.rows;
      const tsv = [cols.join('\t'), ...rows.map(r => cols.map(c => r[c] != null ? r[c] : '').join('\t'))].join('\n');
      navigator.clipboard.writeText(tsv).then(() => {
        toast('Tablo Kopyalandı', 'Sonuç tablosu panoya kopyalandı (TSV).', 'success');
      });
    });

    $('#btnWbExportCsv')?.addEventListener('click', () => {
      if (!workbenchState.lastResult || !workbenchState.lastResult.rows?.length) {
        toast('Dışa Aktarılacak Veri Yok', 'Önce bir sorgu çalıştırın.');
        return;
      }
      const cols = workbenchState.lastResult.columns;
      const rows = workbenchState.lastResult.rows;
      const csvLines = [
        cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','),
        ...rows.map(r => cols.map(c => `"${String(r[c] != null ? r[c] : '').replace(/"/g, '""')}"`).join(','))
      ];
      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_result_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast('CSV İndirildi', 'Sonuç tablosu CSV olarak kaydedildi.', 'success');
    });

    function setWbRunningState(running, statusMsg = 'EXECUTING...') {
      workbenchState.isRunning = running;
      if (btnRun) btnRun.disabled = running;
      if (btnStop) btnStop.disabled = !running;
      if (btnEstPlan) btnEstPlan.disabled = running;
      if (btnActPlan) btnActPlan.disabled = running;
      if (btnBenchmark) btnBenchmark.disabled = running;

      if (statusPill) {
        if (running) {
          statusPill.className = 'status-pill status-warning';
          statusPill.textContent = `● ${statusMsg}`;
        } else {
          statusPill.className = 'status-pill status-ready';
          statusPill.textContent = '● READY';
        }
      }
    }

    function setWbErrorState(errMsg) {
      if (statusPill) {
        statusPill.className = 'status-pill status-danger';
        statusPill.textContent = '✕ ERROR';
      }
      const term = $('#wbMessagesTerminal');
      if (term) term.textContent = `HATA:\n${errMsg}`;
      switchWbTab('messages');
    }

    function renderWbResults(data) {
      workbenchState.lastResult = data;

      // Metrics Strip
      const m = data.metrics || {};
      if ($('#wbMetricDuration')) $('#wbMetricDuration').textContent = `${m.durationMs || 0} ms`;
      if ($('#wbMetricCpu')) $('#wbMetricCpu').textContent = `${m.cpuMs || 0} ms`;
      if ($('#wbMetricReads')) $('#wbMetricReads').textContent = (m.logicalReads || 0).toLocaleString();
      if ($('#wbMetricRows')) $('#wbMetricRows').textContent = (m.rowsReturned != null ? m.rowsReturned : data.rows.length).toLocaleString();
      if ($('#wbMetricEvidence')) {
        $('#wbMetricEvidence').textContent = m.evidence || 'Actual execution';
        $('#wbMetricEvidence').style.color = 'var(--green)';
      }

      // Tab badges
      const rowsCount = data.totalRows != null ? data.totalRows : data.rows.length;
      if ($('#wbResultBadge')) $('#wbResultBadge').textContent = rowsCount;
      if ($('#wbResultsCountText')) $('#wbResultsCountText').textContent = `${rowsCount} satır`;
      if ($('#wbMessageBadge')) $('#wbMessageBadge').textContent = (data.messages || []).length;

      // Render Table Grid
      const tableWrap = $('#wbTableWrap');
      if (tableWrap) {
        if (!data.columns || data.columns.length === 0 || !data.rows || data.rows.length === 0) {
          tableWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Sonuç kümesi boş (0 satır döndü).</p></div>';
        } else {
          const headerHtml = `<tr><th class="row-num">#</th>${data.columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
          const rowsHtml = data.rows.map((row, idx) => `
            <tr>
              <td class="row-num">${idx + 1}</td>
              ${data.columns.map(c => `<td>${row[c] !== null && row[c] !== undefined ? row[c] : '<span style="color:var(--text-disabled)">NULL</span>'}</td>`).join('')}
            </tr>
          `).join('');

          tableWrap.innerHTML = `<table class="wb-table"><thead>${headerHtml}</thead><tbody>${rowsHtml}</tbody></table>`;
        }
      }

      // Render Messages Terminal
      const terminal = $('#wbMessagesTerminal');
      if (terminal) {
        terminal.textContent = (data.messages || []).join('\n') || 'İşlem tamamlandı.';
      }

      // Render Statistics IO / Time
      renderWbStatistics(data.statistics);

      switchWbTab('results');
    }

    function renderWbStatistics(stats) {
      const statsWrap = $('#wbStatisticsContent');
      if (!statsWrap) return;
      if (!stats || (!stats.tables?.length && !stats.totalLogicalReads)) {
        statsWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Statistics IO verisi alınamadı.</p></div>';
        return;
      }

      statsWrap.innerHTML = `
        <div class="wb-stats-grid">
          <div class="setting-card">
            <div><strong>Toplam Logical Reads</strong><p>Tüm tablolardan okunan 8KB bellek sayfaları</p></div>
            <strong style="font-size:20px;color:var(--accent)">${(stats.totalLogicalReads || 0).toLocaleString()}</strong>
          </div>
          <div class="setting-card">
            <div><strong>Süre Dağılımı</strong><p>CPU Süresi vs Toplam Geçen Zaman</p></div>
            <strong>${stats.cpuTimeMs || 0} ms CPU · ${stats.elapsedTimeMs || 0} ms Elapsed</strong>
          </div>
          <div>
            <h4 style="font-size:14px;margin-bottom:10px">Tablo Bazlı IO Dökümü</h4>
            <table class="wb-stats-table">
              <thead><tr><th>Tablo</th><th>Scan Count</th><th>Logical Reads</th><th>Physical Reads</th></tr></thead>
              <tbody>
                ${(stats.tables || []).map(t => `
                  <tr>
                    <td><b>${t.table}</b></td>
                    <td>${t.scanCount}</td>
                    <td style="color:${t.logicalReads > 5000 ? 'var(--red)' : 'var(--text-primary)'}">${t.logicalReads.toLocaleString()}</td>
                    <td>${t.physicalReads}</td>
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
                <strong style="color:var(--red)">⚠ ${w.title}</strong>
                <p style="margin-top:4px">${w.detail}</p>
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
                  <strong>${cm.operator} — ${cm.object || 'Node ' + cm.nodeId}</strong>
                  <p>Tahmin: <b>${cm.estimated.toLocaleString()}</b> satır → Gerçek: <b style="color:var(--red)">${cm.actual.toLocaleString()}</b> satır</p>
                  <small style="color:var(--text-muted);display:block;margin-top:2px">Optimizatörün beklediğinden çok farklı satır dönmesi yanlış join veya index seek kararlarına yol açar.</small>
                </div>
                <span class="severity-pill critical">${cm.factor}</span>
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
                const opInfo = (window.uiText?.operators && window.uiText.operators[op.physicalOp]);
                const opNameTr = opInfo ? opInfo.tr : op.physicalOp;
                const opBadge = opInfo ? opInfo.icon : (op.isScan ? 'SCAN' : op.isLookup ? 'LOOKUP' : 'OP');

                return `
                  <div class="wb-op-card">
                    <div class="wb-op-title">
                      <span class="node-badge" style="font-size:11px">${opBadge}</span>
                      <div>
                        <strong>${opNameTr}</strong>
                        <small style="display:block;color:var(--text-muted)">(${op.physicalOp}) ${op.targetObject ? '· Tablo: ' + op.targetObject : ''} · Tahmin: ${op.estimatedRows.toLocaleString()} satır${op.actualRows != null ? ' · Gerçek: ' + op.actualRows.toLocaleString() + ' satır' : ''}</small>
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
                      <span class="object-pill">${mi.table}</span>
                    </div>
                    <button class="button ghost mini btn-copy-missing-idx" data-idx="${miIdx}">Scripti Kopyala</button>
                  </div>
                  <pre class="wb-terminal" style="max-height:80px;font-size:12px;overflow-x:auto" id="missingIdxPre-${miIdx}">${mi.indexDdl}</pre>
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

      const s = data.summary || {};
      statsWrap.innerHTML = `
        <div class="wb-stats-grid">
          <div class="permission-box" style="margin-bottom:12px">
            <strong>Benchmark Sonuç Özeti (${data.totalRuns} Tekrar)</strong>
            <p style="margin-top:4px">Tüm tekrarlar için median, P95 ve varyans değerleri hesaplandı. (Warm-up hariç tutuldu).</p>
          </div>
          <div class="workbench-metrics-strip" style="margin-bottom:14px">
            <div class="wb-metric-card"><span>Median Süre</span><strong style="color:var(--green)">${s.medianMs} ms</strong></div>
            <div class="wb-metric-card"><span>P95 Süre</span><strong style="color:var(--yellow)">${s.p95Ms} ms</strong></div>
            <div class="wb-metric-card"><span>Min / Max</span><strong>${s.minMs} / ${s.maxMs} ms</strong></div>
            <div class="wb-metric-card"><span>Ortalama</span><strong>${s.avgMs} ms</strong></div>
            <div class="wb-metric-card"><span>Median Reads</span><strong>${(s.logicalReadsMedian || 0).toLocaleString()}</strong></div>
          </div>
          <div>
            <h4 style="font-size:14px;margin-bottom:10px">İterasyon Detayları</h4>
            <table class="wb-stats-table">
              <thead><tr><th>İterasyon</th><th>Tip</th><th>Süre (ms)</th><th>CPU (ms)</th><th>Logical Reads</th><th>Satır</th></tr></thead>
              <tbody>
                ${(data.runs || []).map(r => `
                  <tr>
                    <td><b>Run #${r.iteration}</b></td>
                    <td>${r.isWarmUp ? '<span class="status-pill status-warning">WARM-UP</span>' : '<span class="status-pill status-ready">MEASURED</span>'}</td>
                    <td><b>${r.durationMs} ms</b></td>
                    <td>${r.cpuMs} ms</td>
                    <td>${(r.logicalReads || 0).toLocaleString()}</td>
                    <td>${r.rows || 0}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    async function loadWbHistory() {
      const histWrap = $('#wbHistoryList');
      if (!histWrap) return;

      try {
        const res = await fetch('/api/workbench/history');
        const json = await res.json();
        const list = json.data || [];

        if (list.length === 0) {
          histWrap.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Bu oturumda henüz çalıştırılan sorgu bulunmuyor.</p></div>';
          return;
        }

        histWrap.innerHTML = list.map(item => `
          <div class="wb-history-item" data-query="${encodeURIComponent(item.query)}">
            <div>
              <strong style="font-family:var(--font-family-mono);font-size:13px">${item.query}</strong>
              <small style="display:block;color:var(--text-muted);margin-top:4px">${item.durationMs} ms · ${item.logicalReads || 0} reads · ${item.rowsCount} satır · ${new Date(item.timestamp).toLocaleTimeString()}</small>
            </div>
            <button class="button ghost small">Yükle</button>
          </div>
        `).join('');

        histWrap.querySelectorAll('.wb-history-item').forEach(el => {
          el.addEventListener('click', () => {
            const q = decodeURIComponent(el.dataset.query);
            if (input) {
              input.value = q;
              updateLineNumbers();
              switchWbTab('results');
              toast('Sorgu Yüklendi', 'Seçilen sorgu editöre aktarıldı.');
            }
          });
        });
      } catch (_) {
        // Fallback
      }
    }
  }

  // --- Initial Boot ---
  async function init() {
    initSettings();
    initWorkbench();
    initValidationLab();
    initAiWorkbenchIntegration();
    initCommandPalette();

    try {
      const res = await fetch('/api/connection');
      const conn = await res.json();
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

    updateConnectionStatusUI();
    renderOverview();
    renderViewList();
    selectView(state.selectedCanonicalId || state.selectedViewName);
    renderTables();
    renderDuplicates();
    renderRuntime();
  }

  init();
})();
