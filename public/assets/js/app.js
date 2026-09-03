/**
 * SQL Server Refactoring & Performance Studio
 * Frontend Application Controller (Vanilla JS)
 *
 * Maintains seamless hybrid operation:
 * - Live Mode: connected to real SQL Server, queries /api endpoints.
 * - Demo Mode: fallback to window.STUDIO_MOCK with full UI interactivity.
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
    graphZoom: 1,
    graphDirection: 'both',
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

  // --- UI Update Modules ---

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

    if (state.connected && state.connectionInfo) {
      if (light) {
        light.style.background = 'var(--green)';
        light.style.boxShadow = '0 0 10px rgba(67,217,156,0.65)';
      }
      if (dbName) dbName.textContent = state.connectionInfo.database;
      if (srvInfo) srvInfo.textContent = `${state.connectionInfo.server} · SQL Server`;
      if (connBtn) connBtn.textContent = `● ${state.connectionInfo.database}`;
      if (settingsDb) settingsDb.textContent = state.connectionInfo.database;
      if (settingsHost) settingsHost.textContent = `${state.connectionInfo.server}:${state.connectionInfo.port} (Kullanıcı: ${state.connectionInfo.user})`;
      if (settingsPill) {
        settingsPill.textContent = '● CONNECTED';
        settingsPill.style.color = 'var(--green)';
        settingsPill.style.borderColor = 'rgba(67,217,156,0.2)';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
      if (submitBtn) submitBtn.textContent = 'Yeniden Bağlan';

      if (state.capabilities && capRow) {
        capRow.style.display = 'flex';
        $('#settingsVersionText').textContent = state.capabilities.friendlyVersion || state.capabilities.productVersion;
        $('#settingsCompatText').textContent = `${state.capabilities.friendlyCompat || 'Compat'} · Collation: ${state.capabilities.collation || 'Default'}`;
        $('#settingsEditionPill').textContent = (state.capabilities.edition || 'SQL Server').toUpperCase();

        const qsPill = $('#settingsQsPill');
        if (qsPill) {
          if (state.capabilities.queryStore?.active) {
            qsPill.textContent = `● QUERY STORE ${state.capabilities.queryStore.state}`;
            qsPill.style.color = 'var(--green)';
            qsPill.style.borderColor = 'rgba(67,217,156,0.25)';
          } else {
            qsPill.textContent = '○ QUERY STORE OFF';
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
      if (light) {
        light.style.background = 'var(--yellow)';
        light.style.boxShadow = '0 0 8px rgba(247,200,106,0.4)';
      }
      if (dbName) dbName.textContent = 'Demo Modu';
      if (srvInfo) srvInfo.textContent = 'SQL Server · Mock Dataset';
      if (connBtn) connBtn.textContent = 'Bağlantı';
      if (settingsDb) settingsDb.textContent = 'Demo Modu';
      if (settingsHost) settingsHost.textContent = 'Mock dataset aktif · SQL bağlantısı yok';
      if (settingsPill) {
        settingsPill.textContent = '○ DEMO MODE';
        settingsPill.style.color = 'var(--yellow)';
        settingsPill.style.borderColor = 'rgba(247,200,106,0.2)';
      }
      if (disconnectBtn) disconnectBtn.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Bağlan & Test Et';
      if (capRow) capRow.style.display = 'none';
    }
  }

  // --- 1. Overview Page ---
  function renderOverview() {
    const m = state.data.metrics || {};
    const views = state.data.views || [];

    // Hero Kicker and Headline
    const heroKicker = $('#heroKickerText');
    if (heroKicker) {
      heroKicker.textContent = state.isLive
        ? `${state.connectionInfo?.database || 'SQL'} canlı · Read-only denetim modu`
        : 'Demo Veritabanı · Read-only denetim modu';
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
        healthChip.style.borderColor = 'rgba(67,217,156,0.2)';
        healthChip.style.background = 'rgba(67,217,156,0.08)';
        healthChip.textContent = '✓ Sağlıklı';
      }
    }

    // Metric Cards
    if ($('#metricCritical')) $('#metricCritical').textContent = m.criticalViews || 0;
    if ($('#metricEdges')) $('#metricEdges').textContent = (m.totalEdges || 0).toLocaleString();
    if ($('#metricRepeated')) $('#metricRepeated').textContent = (m.repeatedAccessPatterns || 0).toLocaleString();
    if ($('#metricRegressions')) $('#metricRegressions').textContent = m.activeRegressions != null ? m.activeRegressions : 0;
    if ($('#metricDuplicates')) $('#metricDuplicates').textContent = m.duplicateCandidates != null ? m.duplicateCandidates : 0;

    // Regressions Pill
    const regPill = $('#overviewRegressionPill');
    if (regPill) {
      if (state.capabilities?.queryStore?.active) {
        regPill.innerHTML = '<span></span> Query Store Canlı';
      } else {
        regPill.innerHTML = '<span></span> Plan Cache (Volatile)';
      }
    }

    // Risk Priority List
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

    // Feed items from real scan findings
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

  // --- 2. Views Inventory & Detail Pane ---
  function renderViewList(search = '') {
    const q = search.toLocaleLowerCase('tr').trim();
    const views = state.data.views || [];
    const filter = state.currentRiskFilter;

    // Filter by risk and search query
    const rows = views.filter(v => {
      const vRisk = String(v.risk || v.riskLevel || '').toLowerCase();
      const matchesRisk = filter === 'all' || vRisk === filter;
      const vName = String(v.name || v.view_name || '').toLocaleLowerCase('tr');
      const matchesSearch = !q || vName.includes(q);
      return matchesRisk && matchesSearch;
    });

    // Update filter counts
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

    // Highlight row in list
    $$('.view-row').forEach(r => r.classList.toggle('active', r.dataset.view === name));

    // Update Detail Hero
    if ($('#detailViewName')) $('#detailViewName').textContent = name;
    if ($('#detailViewMeta')) $('#detailViewMeta').textContent = `${v.schema_name || 'dbo'} · modify ${v.modified || 'Bilinmiyor'}`;
    if ($('#detailHealth')) $('#detailHealth').textContent = v.health;
    const riskLabel = $('#detailRisk');
    if (riskLabel) {
      const rLevel = String(v.riskLevel || v.risk || 'LOW').toUpperCase();
      riskLabel.className = `${severityClass(rLevel)}-text`;
      riskLabel.textContent = `${rLevel} · ${v.riskScore || 0}`;
    }

    // Update Stat Strip
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

    // Render Risk Breakdown Bars
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

    // Render Top Problems & Full Problems
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
      `).join('') || '<p style="font-size:8px;color:var(--subtle);margin:8px 0">Bulgu tespit edilmedi.</p>';
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

    // Render Impact Chain (Blast Radius)
    const impactChain = $('#impactChain');
    if (impactChain) {
      const callers = v.upstreamViews || ['AA_GENEL_PLAN', 'AA_PLANLAMA_EKRANI'];
      if (callers.length > 0) {
        const chainItems = callers.slice(0, 3).map(c => `<span>${c}</span><i>→</i>`).join('');
        impactChain.innerHTML = `${chainItems}<b>${name}</b><i>→</i><span>${v.dependents || 0} dependent</span>`;
      } else {
        impactChain.innerHTML = `<b>${name}</b><i>→</i><span>Doğrudan çağıran üst view bulunamadı (Kök veya bağımsız)</span>`;
      }
    }

    // Render Dependencies Tab Content
    const depsTab = $('#dependenciesContent');
    if (depsTab) {
      const baseTables = v.baseTables || ['STOKLAR', 'STOK_HAREKETLERI', 'ISEMIRLERI'];
      const repeated = (v.repeatedBaseTables || []).map(r => r.tableName);
      depsTab.innerHTML = `
        <div style="padding:10px 0">
          <h4 style="font-size:11px;margin-bottom:8px">Doğrudan ve Dolaylı Erişilen Base Tablolar (${baseTables.length})</h4>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px">
            ${baseTables.map(t => {
              const isRep = repeated.includes(t);
              return `<span class="object-pill" style="${isRep ? 'border-color:rgba(255,93,114,0.4);color:var(--red);background:rgba(255,93,114,0.08)' : ''}">${t} ${isRep ? '⇄ REPEATED' : ''}</span>`;
            }).join('') || '<p style="font-size:9px;color:var(--subtle)">Base tablo bulunamadı.</p>'}
          </div>
          <button class="button primary small" data-goto="graph">⌁ Bağımlılık Haritasında Gör</button>
        </div>
      `;
      const btn = depsTab.querySelector('[data-goto="graph"]');
      if (btn) btn.addEventListener('click', () => gotoPage('graph'));
    }

    // Update SQL Tab (Lazy Loading if live)
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

    // Update Graph search input to match selected view
    const graphSearch = $('#graphSearchInput');
    if (graphSearch) graphSearch.value = name;
  }

  // Filter chips in View Inventory
  $$('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentRiskFilter = btn.dataset.risk;
      $$('.filter-chip').forEach(b => b.classList.toggle('active', b === btn));
      renderViewList($('#viewSearch')?.value || '');
    });
  });

  // Search input in View Inventory
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

  // Copy SQL Button
  const copyBtn = $('#copySqlBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = $('#sqlCode')?.textContent || '';
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          toast('Kopyalandı', 'View kaynak kodu panoya kopyalandı.', 'success');
        });
      }
    });
  }

  // --- 3. Dependency Graph Page ---
  function renderGraph() {
    const targetName = state.selectedViewName;
    const views = state.data.views || [];
    const targetView = views.find(v => (v.name || v.view_name) === targetName) || views[0];
    if (!targetView) return;

    const nodesWrap = $('#graphNodesContainer');
    const edgeLines = $('#graphEdgeLines');
    if (!nodesWrap || !edgeLines) return;

    // Upstream callers (callers of this view)
    const upstream = targetView.upstreamViews || ['AA_GENEL_PLAN', 'AA_PLANLAMA_EKRANI'];
    // Downstream base tables and repeated tables
    const baseTables = targetView.baseTables || ['STOK_HAREKETLERI', 'STOKLAR', 'ISEMIRLERI'];
    const repeated = (targetView.repeatedBaseTables || []).map(r => r.tableName);

    // Build visual positions
    const nodes = [];
    const edges = [];

    // Center: Target View
    nodes.push({
      id: 'target',
      name: targetView.name || targetView.view_name,
      type: 'TARGET',
      badge: 'VIEW',
      left: 50,
      top: 48,
      isTarget: true,
      health: targetView.health,
      risk: targetView.risk || targetView.riskLevel || 'CRITICAL',
      riskScore: targetView.riskScore || 92
    });

    // Left side: Upstream views
    const upCount = Math.min(4, upstream.length);
    upstream.slice(0, upCount).forEach((upName, idx) => {
      const topPct = 25 + idx * 22;
      const nodeId = `up_${idx}`;
      nodes.push({
        id: nodeId,
        name: upName,
        type: 'UPSTREAM',
        badge: 'VIEW',
        left: 25,
        top: topPct,
        health: 65 - idx * 5,
        risk: 'HIGH'
      });
      // Edge from upstream to target
      edges.push({
        from: { x: 330, y: (topPct / 100) * 680 },
        to: { x: 520, y: 326 }
      });
    });

    // Right side: Base tables and functions
    const tableCount = Math.min(5, baseTables.length);
    baseTables.slice(0, tableCount).forEach((tName, idx) => {
      const isHot = repeated.includes(tName);
      const topPct = 18 + idx * 16;
      const nodeId = `tbl_${idx}`;
      nodes.push({
        id: nodeId,
        name: tName,
        type: 'TABLE',
        badge: 'TABLE',
        isHot,
        left: 80,
        top: topPct,
        paths: isHot ? 4 : 1
      });
      // Edge from target to table
      edges.push({
        from: { x: 680, y: 326 },
        to: { x: 880, y: (topPct / 100) * 680 }
      });
    });

    // Draw SVG Edges
    edgeLines.innerHTML = edges.map(e => {
      const midX = (e.from.x + e.to.x) / 2;
      return `<path d="M${e.from.x} ${e.from.y} C${midX} ${e.from.y}, ${midX} ${e.to.y}, ${e.to.x} ${e.to.y}"/>`;
    }).join('');

    // Draw DOM Nodes
    nodesWrap.innerHTML = nodes.map(n => {
      let nodeClass = 'graph-node';
      if (n.isTarget) nodeClass += ' target-node';
      else if (n.type === 'TABLE') nodeClass += ` table-node ${n.isHot ? 'hot' : ''}`;
      else nodeClass += ' view-node';

      return `
        <div class="${nodeClass}" style="left:${n.left}%;top:${n.top}%" data-node-name="${n.name}" data-node-type="${n.type}">
          <span class="node-badge">${n.badge}</span>
          <strong>${n.name}</strong>
          <small>${n.isTarget ? `Health ${n.health} · ${n.risk}` : n.isHot ? '4 access paths' : n.type === 'TABLE' ? 'Base Table' : `Health ${n.health}`}</small>
        </div>
      `;
    }).join('');

    // Attach click events to nodes
    nodesWrap.querySelectorAll('.graph-node').forEach(elem => {
      elem.addEventListener('click', () => {
        const nodeName = elem.dataset.nodeName;
        const nodeType = elem.dataset.nodeType;
        updateInspector(nodeName, nodeType, targetView);
      });
    });

    // Default inspector to target or hot table
    const hotTable = baseTables.find(t => repeated.includes(t)) || baseTables[0] || targetView.name;
    updateInspector(hotTable, 'TABLE', targetView);
  }

  function updateInspector(nodeName, nodeType, currentView) {
    const insp = $('#graphInspector');
    if (!insp) return;

    if ($('#inspectorNodeName')) $('#inspectorNodeName').textContent = nodeName;
    if ($('#inspectorNodeType')) $('#inspectorNodeType').textContent = nodeType === 'TABLE' ? 'BASE TABLE' : 'VIEW';

    const p = (state.data.pressures || []).find(x => x.name === nodeName);
    const refsCount = p ? p.refs : (currentView.dependents || 12);
    const pathsCount = p ? p.paths : (currentView.depth || 4);
    const criticalCount = p ? p.critical : 8;

    if ($('#inspectorMetricRefs')) $('#inspectorMetricRefs').textContent = refsCount;
    if ($('#inspectorMetricPaths')) $('#inspectorMetricPaths').textContent = pathsCount;
    if ($('#inspectorMetricCritical')) $('#inspectorMetricCritical').textContent = criticalCount;

    const warnBox = $('#inspectorWarningBox');
    if (warnBox) {
      const isRepeated = (currentView.repeatedBaseTables || []).some(r => r.tableName === nodeName);
      if (isRepeated || nodeName === 'STOK_HAREKETLERI') {
        warnBox.style.display = 'block';
        if ($('#inspectorWarningText')) {
          $('#inspectorWarningText').textContent = `Hedef graph içinde çoklu dependency dalı üzerinden erişiliyor (CTE physical materialization sağlamaz).`;
        }
      } else {
        warnBox.style.display = 'none';
      }
    }

    const actionBtn = $('#inspectorActionBtn');
    if (actionBtn) {
      if (nodeType === 'TABLE') {
        actionBtn.textContent = 'Pressure Map\'i Aç';
        actionBtn.onclick = () => gotoPage('tables');
      } else {
        actionBtn.textContent = 'View Detayına Git';
        actionBtn.onclick = () => {
          selectView(nodeName);
          gotoPage('views');
        };
      }
    }
  }

  // Graph Search Input
  const graphSearchInput = $('#graphSearchInput');
  if (graphSearchInput) {
    graphSearchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        const found = (state.data.views || []).find(v => (v.name || v.view_name).toLowerCase().includes(val.toLowerCase()));
        if (found) {
          selectView(found.name || found.view_name);
          renderGraph();
        } else {
          toast('Bulunamadı', `"${val}" adına uygun view bulunamadı.`);
        }
      }
    });
  }

  // Graph Zoom controls
  $('#graphZoomIn')?.addEventListener('click', () => {
    state.graphZoom = Math.min(1.8, state.graphZoom + 0.15);
    applyGraphZoom();
  });
  $('#graphZoomOut')?.addEventListener('click', () => {
    state.graphZoom = Math.max(0.6, state.graphZoom - 0.15);
    applyGraphZoom();
  });
  $('#graphResetZoom')?.addEventListener('click', () => {
    state.graphZoom = 1;
    applyGraphZoom();
  });

  function applyGraphZoom() {
    const stage = $('#graphStage');
    const nodes = $('#graphNodesContainer');
    const svg = $('#graphSvg');
    if (nodes) nodes.style.transform = `scale(${state.graphZoom})`;
    if (nodes) nodes.style.transformOrigin = 'center center';
    if (svg) svg.style.transform = `scale(${state.graphZoom})`;
    if (svg) svg.style.transformOrigin = 'center center';
  }

  // --- 4. Table Pressure Page ---
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
        <div class="pressure-bar" style="margin-top:12px"><i style="width:${p.score}%"></i></div>
        <div class="pressure-stats">
          <div><span>AA Views</span><strong>${p.refs}</strong></div>
          <div><span>Critical</span><strong>${p.critical || 0}</strong></div>
          <div><span>Repeat</span><strong>${p.repeated || 0}</strong></div>
        </div>
      </article>
    `).join('') || '<div class="empty-state"><p>Tablo baskı analizi verisi yok.</p></div>';
  }

  // --- 5. Duplicate Logic Page ---
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
        <p style="font-size:8px;color:#697285;margin:12px 0 0">Temel fark: <b style="color:#aeb5c4">${d.diff}</b></p>
      </article>
    `).join('') || '<div class="empty-state"><p>Mükerrer SQL gövdesi bulunamadı.</p></div>';
  }

  // --- 6. Runtime & Regression Page ---
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

  // --- 7. Settings Page ---
  function renderSettings() {
    const prefixInput = $('#settingViewPrefix');
    if (prefixInput) {
      prefixInput.value = state.activePrefix;
      prefixInput.onchange = e => {
        state.activePrefix = e.target.value.trim() || 'AA_';
        toast('Önek güncellendi', `Yeni önek: "${state.activePrefix}". Taramayı başlatmak için "Yeniden Tara"ya tıklayın.`);
      };
    }
    updateConnectionStatusUI();
  }

  // --- 8. Scan Coordination ---
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
        state.data = json.data;
        if (state.data.views?.length > 0) {
          state.selectedViewName = state.data.views[0].name || state.data.views[0].view_name;
        }

        toast('Tarama Tamamlandı', `${json.data.views.length} view ve ${json.data.dependencies.length} dependency başarıyla analiz edildi.`, 'success');
      }

      // Update timestamp
      const scanTime = $('#scanMetaTime');
      if (scanTime) scanTime.textContent = formatTime();
      const scanAgo = $('#scanMetaAgo');
      if (scanAgo) scanAgo.textContent = 'az önce';

      // Re-render active views
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

  // --- 9. Modal & Connection Lifecycle ---
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
      state.data.views = MOCK.views;
      state.data.pressures = MOCK.pressures;
      state.data.duplicates = MOCK.duplicates;
      state.data.regressions = MOCK.regressions;

      updateConnectionStatusUI();
      renderOverview();
      renderViewList();
      selectView(MOCK.views[0].name);
      closeModal();
      toast('Bağlantı Kapatıldı', 'Demo moduna geri dönüldü.', '');
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

      // Fetch capabilities
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
      // Auto trigger initial scan
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

  // --- 10. AI Refactor Demo Runner ---
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

  // Validation Ack & Run
  $('#validationAck')?.addEventListener('change', e => {
    const btn = $('#validateButton');
    if (btn) btn.disabled = !e.target.checked;
  });
  $('#validateButton')?.addEventListener('click', () => {
    toast('Validation Lab (Demo)', 'Kontrollü ortamda EXCEPT iki yönlü karşılaştırma ve SET STATISTICS IO benchmark aşaması simüle edildi.', 'success');
  });

  // Global Keybindings (Cmd/Ctrl+K, Esc)
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      gotoPage('views');
      setTimeout(() => $('#viewSearch')?.focus(), 50);
    }
    if (e.key === 'Escape') closeModal();
  });

  // --- Initial Boot ---
  async function init() {
    try {
      const res = await fetch('/api/connection');
      const conn = await res.json();
      if (conn.connected) {
        state.connected = true;
        state.connectionInfo = conn.connection;
        const capRes = await fetch('/api/capabilities');
        const capJson = await capRes.json();
        if (capJson.ok) state.capabilities = capJson.data;

        // Check if a scan is already available
        const scanRes = await fetch('/api/scan/latest');
        if (scanRes.ok) {
          const scanJson = await scanRes.json();
          if (scanJson.ok && scanJson.data) {
            state.isLive = true;
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
    renderSettings();
  }

  init();
})();
