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
    overview: ['SQL HEALTH COMMAND CENTER', 'Genel Bakış'],
    views: ['VIEW INVENTORY', 'View Envanteri'],
    graph: ['DEPENDENCY X-RAY', 'Bağımlılık Haritası'],
    runtime: ['QUERY STORE & PLAN INTELLIGENCE', 'Runtime & Regresyon'],
    refactor: ['AI ASSISTED REFACTORING', 'AI Refactor'],
    validation: ['SEMANTIC & PERFORMANCE PROOF', 'Validation Lab'],
    workbench: ['SQL WORKBENCH & QUERY LAB', 'SQL Workbench'],
    tables: ['BASE TABLE ANALYTICS', 'Table Pressure'],
    duplicates: ['SQL FINGERPRINTING', 'Duplicate Logic'],
    settings: ['STUDIO CONFIGURATION', 'Ayarlar']
  };

  // Central Application State
  const state = {
    connected: false,
    connectionInfo: null,
    capabilities: null,
    isLive: false,
    activePrefix: 'AA_',
    currentRiskFilter: 'all',
    currentSort: 'risk',
    selectedViewName: MOCK.views[0]?.name || '',
    lastScanTime: null,
    data: {
      views: MOCK.views,
      pressures: MOCK.pressures,
      duplicates: MOCK.duplicates,
      regressions: MOCK.regressions,
      dependencies: [],
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

    if (state.connected && state.connectionInfo) {
      const serverInst = `${state.connectionInfo.server}${state.connectionInfo.port && state.connectionInfo.port != 1433 ? ':' + state.connectionInfo.port : ''}`;
      
      // Sidebar Footer
      if (light) {
        light.style.background = 'var(--green)';
        light.style.boxShadow = '0 0 12px rgba(67,217,156,0.8)';
      }
      if (dbName) dbName.textContent = state.connectionInfo.database;
      if (srvInfo) srvInfo.innerHTML = `<span style="color:var(--green);font-weight:700">LIVE</span> · ${serverInst}`;
      if (connBtn) connBtn.textContent = `● ${state.connectionInfo.database}`;

      // Settings Status Cards
      if (settingsDb) settingsDb.textContent = state.connectionInfo.database;
      if (settingsHost) settingsHost.textContent = `${serverInst} (Kullanıcı: ${state.connectionInfo.user || 'sa'})`;
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
      if (topbarScanAgo) topbarScanAgo.textContent = state.connectionInfo.database;

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
      if (dbName) dbName.textContent = 'Demo Mode';
      if (srvInfo) srvInfo.textContent = 'Mock Dataset · Bağlantı yok';
      if (connBtn) connBtn.textContent = 'Bağlantı';
      if (settingsDb) settingsDb.textContent = 'Demo Modu';
      if (settingsHost) settingsHost.textContent = 'Mock dataset aktif · SQL bağlantısı kurulmadı';
      if (settingsPill) {
        settingsPill.textContent = '○ DEMO MODE';
        settingsPill.style.color = 'var(--yellow)';
        settingsPill.style.borderColor = 'rgba(247,200,106,0.2)';
        settingsPill.style.background = 'rgba(247,200,106,0.06)';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Bağlan & Test Et';
      if (capRow) capRow.style.display = 'none';

      if (topbarScanLabel) topbarScanLabel.textContent = 'MOD';
      if (topbarScanTime) topbarScanTime.textContent = 'Demo Dataset';
      if (topbarScanAgo) topbarScanAgo.textContent = 'Offline';
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
      riskList.innerHTML = sortedViews.slice(0, 5).map(v => `
        <div class="risk-row" data-view="${v.name || v.view_name}">
          <i class="risk-level-bar ${severityClass(v.risk || v.riskLevel)}"></i>
          <div class="risk-name">
            <strong>${v.name || v.view_name}</strong>
            <small>${v.schema_name || 'dbo'} · depth ${v.depth || 1} · ${v.dependents || 0} dependents</small>
          </div>
          <div class="health-number ${severityClass(v.risk || v.riskLevel)}">${v.health}</div>
          <div class="risk-cell"><small>Risk</small><strong>${v.riskScore || 0}</strong></div>
          <div class="risk-cell"><small>24h Reads</small><strong>${v.reads || '—'}</strong></div>
          <div class="risk-cell"><small>Median</small><strong>${v.median || '—'}</strong></div>
        </div>
      `).join('');

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

    const rows = views.filter(v => {
      const vRisk = String(v.risk || v.riskLevel || '').toLowerCase();
      const matchesRisk = filter === 'all' || vRisk === filter;
      const vName = String(v.name || v.view_name || '').toLocaleLowerCase('tr');
      const matchesSearch = !q || vName.includes(q);
      return matchesRisk && matchesSearch;
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
      list.innerHTML = '<div class="empty-state" style="padding:40px 10px"><p>Aramaya uygun view bulunamadı.</p></div>';
      return;
    }

    list.innerHTML = rows.map(v => {
      const name = v.name || v.view_name;
      const isActive = name === state.selectedViewName;
      const risk = v.risk || v.riskLevel || 'low';
      return `
        <div class="view-row ${isActive ? 'active' : ''}" data-view="${name}">
          <span class="risk-dot ${severityClass(risk)}"></span>
          <div>
            <strong>${name}</strong>
            <small>Risk ${v.riskScore || 0} · ${v.reads || '—'} reads</small>
          </div>
          <span class="view-health">${v.health}</span>
        </div>
      `;
    }).join('');

    $$('.view-row').forEach(r => {
      r.addEventListener('click', () => selectView(r.dataset.view));
    });
  }

  async function selectView(viewName) {
    const views = state.data.views || [];
    const v = views.find(x => (x.name || x.view_name) === viewName) || views[0];
    if (!v) return;

    const name = v.name || v.view_name;
    state.selectedViewName = name;

    $$('.view-row').forEach(r => r.classList.toggle('active', r.dataset.view === name));

    if ($('#detailViewName')) $('#detailViewName').textContent = name;
    if ($('#detailViewMeta')) $('#detailViewMeta').textContent = `${v.schema_name || 'dbo'} · modify ${v.modified || 'Bilinmiyor'}`;
    if ($('#detailHealth')) $('#detailHealth').textContent = v.health;
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
    if ($('#statDependents')) $('#statDependents').textContent = v.dependents || 0;
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
      fullProblems.innerHTML = problems.map(p => `
        <div class="full-problem">
          <span class="problem-symbol">${p.symbol || '!'}</span>
          <div>
            <h4>${p.title}</h4>
            <p>${p.detail}</p>
          </div>
          <span class="severity-pill ${severityClass(p.severity)}">${p.severity}</span>
        </div>
      `).join('') || '<div class="empty-state"><p>Tebrikler! Bu view üzerinde riskli pattern saptanmadı.</p></div>';
    }

    // Dependencies Tab Content
    const depsTab = $('#dependenciesContent');
    if (depsTab) {
      const baseTables = v.baseTables || ['STOKLAR', 'STOK_HAREKETLERI', 'ISEMIRLERI'];
      const repeated = (v.repeatedBaseTables || []).map(r => r.tableName);
      depsTab.innerHTML = `
        <div style="padding:10px 0">
          <h4 style="font-size:14px;margin-bottom:12px">Doğrudan ve Dolaylı Erişilen Base Tablolar (${baseTables.length})</h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
            ${baseTables.map(t => {
              const isRep = repeated.includes(t);
              return `<span class="object-pill" style="${isRep ? 'border-color:rgba(255,93,114,0.45);color:var(--red);background:rgba(255,93,114,0.1)' : ''}">${t} ${isRep ? '⇄ REPEATED' : ''}</span>`;
            }).join('') || '<p style="font-size:13px;color:var(--text-muted)">Base tablo bulunamadı.</p>'}
          </div>
          <button class="button primary small" data-goto="graph">⌁ Bağımlılık Haritasında Gör</button>
        </div>
      `;
      const btn = depsTab.querySelector('[data-goto="graph"]');
      if (btn) btn.addEventListener('click', () => gotoPage('graph'));
    }

    // Lazy SQL Loading
    const sqlCode = $('#sqlCode');
    const sqlToolbarName = $('#sqlToolbarName');
    if (sqlToolbarName) sqlToolbarName.textContent = `${v.schema_name || 'dbo'}.${name}.sql`;

    if (sqlCode) {
      if (state.isLive) {
        sqlCode.textContent = '-- SQL tanımı getiriliyor...';
        try {
          const res = await fetch(`/api/views/${encodeURIComponent(name)}/source`);
          const json = await res.json();
          if (json.ok && json.sql) {
            sqlCode.textContent = json.sql;
          } else {
            sqlCode.textContent = `-- Tanım alınamadı: ${json.error || 'Bilinmeyen hata'}`;
          }
        } catch (err) {
          sqlCode.textContent = `-- Hata: ${err.message}`;
        }
      } else {
        sqlCode.textContent = MOCK.sql;
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
    const targetName = state.selectedViewName;
    const views = state.data.views || [];
    const targetView = views.find(v => (v.name || v.view_name) === targetName) || views[0];
    if (!targetView) return;

    const viewport = $('#graphViewport');
    const nodesWrap = $('#graphNodesContainer');
    const edgeLines = $('#graphEdgeLines');
    if (!viewport || !nodesWrap || !edgeLines) return;

    let subGraphData = null;
    if (state.isLive) {
      try {
        const depth = $('#graphDepthSelect')?.value || '2';
        const direction = $('#graphDirectionSelect')?.value || 'both';
        const res = await fetch(`/api/views/${encodeURIComponent(targetView.name || targetView.view_name)}/graph?depth=${depth}&direction=${direction}`);
        const json = await res.json();
        if (json.ok && json.graph) {
          subGraphData = json.graph;
        }
      } catch (_) {
        // Fallback to local synthesis
      }
    }

    // If live API returned data, use it; otherwise build from targetView metadata
    const upstream = subGraphData?.nodes?.filter(n => n.type === 'UPSTREAM_VIEW').map(n => n.name) || targetView.upstreamViews || ['AA_GENEL_PLAN', 'AA_PLANLAMA_EKRANI'];
    const baseTables = subGraphData?.nodes?.filter(n => n.type === 'TABLE').map(n => n.name) || targetView.baseTables || ['STOK_HAREKETLERI', 'STOKLAR', 'ISEMIRLERI'];
    const repeated = (targetView.repeatedBaseTables || []).map(r => r.tableName);

    // Coordinate System: 2400 x 1600 Virtual Canvas
    // Target Node centered at (1200, 800)
    const centerX = 1200;
    const centerY = 800;

    const nodes = [];
    const edges = [];

    // 1. Target Node
    const targetNode = {
      id: 'target',
      name: targetView.name || targetView.view_name,
      type: 'TARGET',
      badge: 'VIEW',
      x: centerX,
      y: centerY,
      isTarget: true,
      health: targetView.health,
      risk: targetView.risk || targetView.riskLevel || 'CRITICAL',
      riskScore: targetView.riskScore || 92
    };
    nodes.push(targetNode);

    // 2. Upstream Nodes (Column on Left at X = 700)
    const upCount = Math.min(6, upstream.length);
    const upStartY = centerY - ((upCount - 1) * 130) / 2;
    upstream.slice(0, upCount).forEach((name, idx) => {
      const nodeY = upStartY + idx * 130;
      const node = {
        id: `up_${idx}`,
        name,
        type: 'UPSTREAM',
        badge: 'VIEW',
        x: 650,
        y: nodeY,
        health: 65 - idx * 4,
        risk: 'HIGH'
      };
      nodes.push(node);
      edges.push({
        fromNode: node,
        toNode: targetNode,
        type: 'upstream'
      });
    });

    // 3. Downstream Base Tables & Functions (Column on Right at X = 1750)
    const tableCount = Math.min(8, baseTables.length);
    const tableStartY = centerY - ((tableCount - 1) * 120) / 2;
    baseTables.slice(0, tableCount).forEach((name, idx) => {
      const isHot = repeated.includes(name) || name === 'STOK_HAREKETLERI';
      const nodeY = tableStartY + idx * 120;
      const node = {
        id: `tbl_${idx}`,
        name,
        type: 'TABLE',
        badge: 'TABLE',
        isHot,
        x: 1750,
        y: nodeY,
        paths: isHot ? 4 : 1
      };
      nodes.push(node);
      edges.push({
        fromNode: targetNode,
        toNode: node,
        type: 'downstream',
        isHot
      });
    });

    graphState.nodes = nodes;
    graphState.edges = edges;
    graphState.selectedNodeId = 'target';

    // Render Nodes & Edges
    renderGraphEdges();
    renderGraphNodes();

    // Center Graph Viewport Initially
    graphCenterSelected();

    // Set default inspector to target or hot table
    const hotTbl = baseTables.find(t => repeated.includes(t)) || baseTables[0] || targetView.name;
    updateInspector(hotTbl, 'TABLE', targetView);
  }

  function renderGraphEdges() {
    const edgeLines = $('#graphEdgeLines');
    if (!edgeLines) return;

    edgeLines.innerHTML = graphState.edges.map(e => {
      const x1 = e.fromNode.x + 95; // From right edge of fromNode
      const y1 = e.fromNode.y;
      const x2 = e.toNode.x - 95;   // To left edge of toNode
      const y2 = e.toNode.y;
      const midX = (x1 + x2) / 2;

      const pathClass = e.isHot ? 'hot-edge' : '';
      return `<path d="M${x1} ${y1} C${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" class="${pathClass}" data-from="${e.fromNode.name}" data-to="${e.toNode.name}"></path>`;
    }).join('');
  }

  function renderGraphNodes() {
    const nodesWrap = $('#graphNodesContainer');
    if (!nodesWrap) return;

    nodesWrap.innerHTML = graphState.nodes.map(n => {
      let nodeClass = 'graph-node';
      if (n.isTarget) nodeClass += ' target-node';
      else if (n.type === 'TABLE') nodeClass += ` table-node ${n.isHot ? 'hot' : ''}`;
      else nodeClass += ' view-node';

      if (n.id === graphState.selectedNodeId) nodeClass += ' active-node';

      return `
        <div class="${nodeClass}" id="gnode_${n.id}" style="left:${n.x}px;top:${n.y}px" data-node-id="${n.id}" data-node-name="${n.name}" data-node-type="${n.type}">
          <span class="node-badge">${n.badge}</span>
          <strong>${n.name}</strong>
          <small>${n.isTarget ? `Health ${n.health} · ${n.risk}` : n.isHot ? '4 access paths' : n.type === 'TABLE' ? 'Base Table' : `Health ${n.health}`}</small>
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
        updateInspector(node.name, node.type, currentView);
      });
    });
  }

  function updateInspector(nodeName, nodeType, currentView) {
    const insp = $('#graphInspector');
    if (!insp) return;

    if ($('#inspectorNodeName')) $('#inspectorNodeName').textContent = nodeName;
    if ($('#inspectorNodeType')) $('#inspectorNodeType').textContent = nodeType === 'TABLE' ? 'BASE TABLE' : 'VIEW';

    const p = (state.data.pressures || []).find(x => x.name === nodeName);
    const refsCount = p ? p.refs : (currentView.dependents || 14);
    const pathsCount = p ? p.paths : (currentView.depth || 3);
    const criticalCount = p ? p.critical : 6;

    if ($('#inspectorMetricRefs')) $('#inspectorMetricRefs').textContent = refsCount;
    if ($('#inspectorMetricPaths')) $('#inspectorMetricPaths').textContent = pathsCount;
    if ($('#inspectorMetricCritical')) $('#inspectorMetricCritical').textContent = criticalCount;

    const warnBox = $('#inspectorWarningBox');
    if (warnBox) {
      const isRepeated = (currentView.repeatedBaseTables || []).some(r => r.tableName === nodeName);
      if (isRepeated || nodeName === 'STOK_HAREKETLERI') {
        warnBox.style.display = 'block';
      } else {
        warnBox.style.display = 'none';
      }
    }

    // Inspector Action Buttons
    const btnView = $('#btnInspOpenView');
    const btnSql = $('#btnInspOpenSql');
    const btnPressure = $('#btnInspOpenPressure');

    if (btnView) {
      btnView.style.display = nodeType === 'TABLE' ? 'none' : 'block';
      btnView.onclick = () => {
        selectView(nodeName);
        gotoPage('views');
      };
    }
    if (btnSql) {
      btnSql.style.display = nodeType === 'TABLE' ? 'none' : 'block';
      btnSql.onclick = () => {
        selectView(nodeName);
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

  // Graph Depth & Direction Dropdown Changes
  $('#graphDepthSelect')?.addEventListener('change', () => renderGraph());
  $('#graphDirectionSelect')?.addEventListener('change', () => renderGraph());

  // --- Graph Live Autocomplete Search ---
  const graphSearchInput = $('#graphSearchInput');
  const graphDropdown = $('#graphSearchDropdown');

  function getSearchCandidates(query = '') {
    const q = query.toLowerCase();
    const views = (state.data.views || []).map(v => ({ name: v.name || v.view_name, type: 'VIEW' }));
    const tables = (state.data.pressures || []).map(p => ({ name: p.name, type: 'TABLE' }));
    const functions = [{ name: 'fn_DepodakiMiktar', type: 'FUNCTION' }];

    const all = [...views, ...tables, ...functions];
    return all.filter(item => item.name.toLowerCase().includes(q)).slice(0, 8);
  }

  function renderSearchDropdown(items) {
    if (!graphDropdown) return;
    if (items.length === 0) {
      graphDropdown.classList.add('hidden');
      return;
    }

    graphDropdown.innerHTML = items.map((item, idx) => `
      <div class="autocomplete-item ${idx === graphState.searchIndex ? 'active' : ''}" data-index="${idx}" data-name="${item.name}">
        <span class="item-name">${item.name}</span>
        <span class="node-badge" style="font-size:10px">${item.type}</span>
      </div>
    `).join('');

    graphDropdown.classList.remove('hidden');

    graphDropdown.querySelectorAll('.autocomplete-item').forEach(el => {
      el.addEventListener('click', () => {
        chooseSearchResult(el.dataset.name);
      });
    });
  }

  function chooseSearchResult(name) {
    if (!name) return;
    if (graphSearchInput) graphSearchInput.value = name;
    if (graphDropdown) graphDropdown.classList.add('hidden');
    selectView(name);
    renderGraph();
  }

  if (graphSearchInput && graphDropdown) {
    graphSearchInput.addEventListener('input', e => {
      const q = e.target.value.trim();
      graphState.searchIndex = -1;
      if (q.length > 0) {
        const candidates = getSearchCandidates(q);
        renderSearchDropdown(candidates);
      } else {
        graphDropdown.classList.add('hidden');
      }
    });

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
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        graphState.searchIndex = (graphState.searchIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('active', i === graphState.searchIndex));
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
    const grid = $('#tablePressureGrid');
    if (!grid) return;
    const pressures = state.data.pressures || [];

    grid.innerHTML = pressures.map((p, i) => `
      <article class="pressure-card ${i === 0 ? 'hot' : ''}">
        <div class="pressure-card-head">
          <div>
            <span class="panel-kicker">BASE TABLE</span>
            <h3>${p.name}</h3>
            <small>${p.repeated || 0} repeated access pattern</small>
          </div>
          <span class="severity-pill ${p.score > 80 ? 'critical' : 'warning'}">${p.score} RISK</span>
        </div>
        <div class="big">${p.paths}</div>
        <small>dependency paths</small>
        <div class="pressure-bar" style="margin-top:14px"><i style="width:${p.score}%"></i></div>
        <div class="pressure-stats">
          <div><span>AA Views</span><strong>${p.refs}</strong></div>
          <div><span>Critical</span><strong>${p.critical || 0}</strong></div>
          <div><span>Repeat</span><strong>${p.repeated || 0}</strong></div>
        </div>
      </article>
    `).join('') || '<div class="empty-state"><p>Tablo baskı analizi verisi yok.</p></div>';
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
            <span class="panel-kicker">POSSIBLE DUPLICATE</span>
            <h3>SQL fingerprint match</h3>
          </div>
          <span class="similarity">${d.similarity}%</span>
        </div>
        <div class="dup-pair">
          <div class="dup-view">${d.a}</div>
          <div class="dup-view">${d.b}</div>
        </div>
        <div class="dup-meta">
          ${(d.common || []).map(x => `<span>${x}</span>`).join('')}
        </div>
        <p style="font-size:12.5px;color:var(--text-muted);margin:14px 0 0">Temel fark: <b style="color:var(--text-secondary)">${d.diff}</b></p>
      </article>
    `).join('') || '<div class="empty-state"><p>Mükerrer SQL gövdesi bulunamadı.</p></div>';
  }

  // --- 7. Runtime & Regression Page ---
  function renderRuntime() {
    const table = $('#regressionTable');
    if (!table) return;
    const regs = state.data.regressions || [];

    table.innerHTML = `
      <div class="reg-row header">
        <span>Object / Calling Query</span>
        <span>Before</span>
        <span>Current</span>
        <span>Delta</span>
        <span>Logical Reads</span>
        <span>Evidence</span>
      </div>
      ${regs.map(r => `
        <div class="reg-row">
          <div>
            <strong>${r.name}</strong>
            <small>${r.note || 'Query Store correlated'}</small>
          </div>
          <span>${r.before}</span>
          <span>${r.now}</span>
          <span class="delta-up">${r.delta}</span>
          <span>${r.reads}</span>
          <span>${r.evidence}</span>
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
    const savedTheme = localStorage.getItem('sql_studio_theme') || 'dark';
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
    document.body.classList.toggle('theme-midnight', theme === 'midnight');
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

  // Connect & Test Form Submission
  $('#connectionForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const statusText = $('#connectionTestStatus');
    const submitBtn = $('#connectSubmitBtn');

    if (statusText) {
      statusText.className = 'connection-test';
      statusText.textContent = 'SQL Server\'a bağlanılıyor...';
    }
    if (submitBtn) submitBtn.disabled = true;

    const payload = {
      server: fd.get('server'),
      port: fd.get('port'),
      database: fd.get('database'),
      user: fd.get('user'),
      password: fd.get('password'),
      encrypt: fd.get('encrypt') === 'on',
      trustServerCertificate: fd.get('trustServerCertificate') === 'on'
    };

    try {
      const res = await fetch('/api/connection/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Bağlantı hatası.');

      state.connected = true;
      state.connectionInfo = json.connection;

      const capRes = await fetch('/api/capabilities');
      const capJson = await capRes.json();
      if (capJson.ok) {
        state.capabilities = capJson.data;
      }

      if (statusText) {
        statusText.classList.add('success');
        statusText.textContent = `✓ Bağlandı: ${json.server.databaseName}`;
      }

      updateConnectionStatusUI();
      toast('Bağlantı Başarılı', `${json.server.databaseName} veritabanına bağlanıldı. Otomatik tarama başlatılıyor...`, 'success');

      closeModal();
      setTimeout(() => triggerScan(), 400);
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
  // --- 13. VALIDATION LAB & QUERY COMPARE (Phase 2D) ---
  // ============================================================
  function initValidationLab() {
    const origInput = $('#valOrigSql');
    const candInput = $('#valCandSql');
    const btnLoadSample = $('#btnValLoadSample');
    const btnRunBoth = $('#btnValRunBoth');
    const btnValidate = $('#validateButton');
    const ackCheck = $('#validationAck');

    // Load sample queries
    btnLoadSample?.addEventListener('click', () => {
      if (origInput) {
        origInput.value = `-- Original View Query:
SELECT 
    sth_stok_kod,
    sth_tip,
    sth_miktar,
    sth_tarih
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_tarih >= '2026-01-01';`;
      }
      if (candInput) {
        candInput.value = `-- Refactored Candidate Query:
SELECT 
    sth_stok_kod,
    sth_tip,
    sth_miktar,
    sth_tarih
FROM dbo.STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_tarih >= '2026-01-01';`;
      }
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
        btnRunBoth.textContent = 'İki Sorguyu Karşılaştır';
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
          setValVerdict(json.verdict);
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
          setValVerdict('EXACT MATCH');
        }
        toast('Validation Tamamlandı', 'Tüm semantik denetim adımları tamamlandı.', 'success');
      } catch (err) {
        toast('Validation Hatası', err.message, 'error');
        if (statusPill) {
          statusPill.textContent = 'HATA';
          statusPill.className = 'status-pill status-danger';
        }
      } finally {
        btnValidate.disabled = false;
        btnValidate.textContent = '✦ Validation Lab\'ı Başlat';
      }
    });

    function renderValSteps(steps = []) {
      for (const st of steps) {
        const elStep = $(`#valStep-${st.id}`);
        const elStatus = $(`#valStepStatus-${st.id}`);
        const elDesc = $(`#valStepDesc-${st.id}`);

        if (elStep) {
          elStep.className = `validation-step ${st.status === 'PASS' ? 'done' : st.status === 'FAILED' ? 'failed' : ''}`;
        }
        if (elStatus) {
          elStatus.textContent = st.status;
          elStatus.style.color = st.status === 'PASS' ? 'var(--green)' : st.status === 'FAILED' ? 'var(--red)' : 'var(--yellow)';
        }
        if (elDesc && st.detail) {
          elDesc.textContent = st.detail;
        }
      }
    }

    function setValVerdict(verdict) {
      const vText = $('#valVerdictText');
      const vSub = $('#valVerdictSub');
      const pStatus = $('#valPipelineStatus');

      if (vText) vText.textContent = verdict;
      if (vSub) vSub.textContent = verdict === 'EXACT MATCH' ? 'Semantically Validated ✓' : 'Notice / Action required';

      if (pStatus) {
        pStatus.textContent = verdict;
        if (verdict === 'EXACT MATCH') {
          pStatus.className = 'status-pill status-ready';
        } else if (verdict.includes('PARTIALLY')) {
          pStatus.className = 'status-pill status-warning';
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
        .filter(v => (v.name || v.view_name).toLowerCase().includes(q))
        .slice(0, 8)
        .map(v => ({
          title: v.name || v.view_name,
          category: 'VIEWLAR',
          icon: '⌘',
          action: () => {
            selectView(v.name || v.view_name);
            gotoPage('views');
          }
        }));

      const tables = (state.data.pressures || [])
        .filter(p => p.name.toLowerCase().includes(q))
        .slice(0, 5)
        .map(p => ({
          title: p.name,
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
              <span>${it.title}</span>
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
            body: JSON.stringify({ sql, timeoutMs, requestId: reqId })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Sorgu çalıştırılamadı.');

          renderWbResults(json);
          toast('Sorgu Tamamlandı', `${json.rowsReturned || json.rows.length} satır ${json.metrics.durationMs} ms içinde getirildi.`, 'success');
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
              "SQL Server Execution Times: CPU time = 240 ms, elapsed time = 310 ms.",
              "Table 'STOK_HAREKETLERI'. Scan count 4, logical reads 12400, physical reads 0.",
              "Table 'STOKLAR'. Scan count 1, logical reads 1880, physical reads 0.",
              `(${mockRows.length} rows affected)`
            ]
          };
          renderWbResults(mockData);
          toast('Demo Çalıştırıldı', 'Demo veri seti üzerinde sorgu simüle edildi.', 'success');
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

      setWbRunningState(true, mode === 'actual' ? 'ACTUAL PLAN ALINIYOR...' : 'ESTIMATED PLAN DERLENİYOR...');
      const timeoutMs = Number($('#wbTimeoutSelect')?.value || 30000);

      try {
        if (state.isLive) {
          const res = await fetch('/api/workbench/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, mode, timeoutMs })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Plan alınamadı.');

          renderWbPlan(json.planType, json.parsed);
          switchWbTab('plan');
          toast('Plan Hazır', `${json.planType} execution plan başarıyla analiz edildi.`, 'success');
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
          toast('Demo Plan Hazır', `${isActual ? 'Actual' : 'Estimated'} plan hazırlandı.`, 'success');
        }
      } catch (err) {
        toast('Plan Hatası', err.message, 'error');
      } finally {
        setWbRunningState(false);
      }
    }

    // 5. BENCHMARK
    btnBenchmark?.addEventListener('click', async () => {
      const sql = input?.value.trim();
      if (!sql) {
        toast('Sorgu Boş', 'Lütfen benchmark yapılacak bir SELECT sorgusu yazın.', 'error');
        return;
      }

      const runs = Number($('#wbBenchmarkRuns')?.value || 3);
      if (runs > 3) {
        const ok = confirm(`Bu işlem bağlı veritabanı üzerinde sorguyu ${runs} kez arka arkaya çalıştıracaktır.\n\nDevam etmek istiyor musunuz?`);
        if (!ok) return;
      }

      setWbRunningState(true, `BENCHMARK (${runs} RUNS)...`);
      const timeoutMs = Number($('#wbTimeoutSelect')?.value || 30000);

      try {
        if (state.isLive) {
          const res = await fetch('/api/workbench/benchmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, runs, warmUp: true, timeoutMs })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || 'Benchmark başarısız.');

          renderWbBenchmark(json);
          switchWbTab('statistics');
          toast('Benchmark Tamamlandı', `Median: ${json.summary.medianMs} ms · P95: ${json.summary.p95Ms} ms`, 'success');
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

      let html = `
        <div class="wb-plan-header">
          <div>
            <span class="${badgeClass}">${planType} PLAN</span>
            <strong style="margin-left:10px">SubTree Cost: ${parsed.totalSubTreeCost || 0}</strong>
            <small style="margin-left:8px;color:var(--text-muted)">(Opt Level: ${parsed.optimizationLevel || 'FULL'})</small>
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
            <h4 style="font-size:14px;margin-bottom:8px;color:var(--red)">Cardinality Estimation Hataları (${parsed.cardinalityMismatches.length})</h4>
            ${parsed.cardinalityMismatches.map(cm => `
              <div class="setting-card" style="border-left:3px solid var(--red)">
                <div>
                  <strong>${cm.operator} — ${cm.object || 'Node ' + cm.nodeId}</strong>
                  <p>Tahmin: <b>${cm.estimated.toLocaleString()}</b> satır → Gerçek: <b style="color:var(--red)">${cm.actual.toLocaleString()}</b> satır</p>
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
              ${parsed.topOperators.map(op => `
                <div class="wb-op-card">
                  <div class="wb-op-title">
                    <span class="node-badge" style="font-size:11px">${op.isScan ? 'SCAN' : op.isLookup ? 'LOOKUP' : 'OP'}</span>
                    <div>
                      <strong>${op.physicalOp}</strong>
                      <small style="display:block;color:var(--text-muted)">${op.targetObject ? 'Tablo: ' + op.targetObject : ''} · Est Rows: ${op.estimatedRows.toLocaleString()}${op.actualRows != null ? ' · Actual: ' + op.actualRows.toLocaleString() : ''}</small>
                    </div>
                  </div>
                  <span class="wb-op-cost">%${op.costPercent}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Missing Indexes
      if (parsed.missingIndexes?.length > 0) {
        html += `
          <div>
            <h4 style="font-size:14px;margin-bottom:8px;color:var(--green)">Tavsiye Edilen Missing Indexes</h4>
            ${parsed.missingIndexes.map(mi => `
              <div class="full-problem" style="margin-bottom:8px">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <strong>Etki: +%${mi.impact}</strong>
                    <span class="object-pill">${mi.table}</span>
                  </div>
                  <pre class="wb-terminal" style="max-height:80px;font-size:12px">${mi.indexDdl}</pre>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }

      planWrap.innerHTML = html;
      if ($('#wbPlanBadge')) $('#wbPlanBadge').style.display = 'inline-block';
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

    updateConnectionStatusUI();
    renderOverview();
    renderViewList();
    selectView(state.selectedViewName);
    renderTables();
    renderDuplicates();
    renderRuntime();
  }

  init();
})();
