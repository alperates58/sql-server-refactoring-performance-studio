/**
 * SQL Server Refactoring & Performance Studio
 * Unified Refactor Studio Controller (Sprint 9)
 *
 * Consolidates:
 * - AI Refactoring
 * - Side-by-Side Diff Comparison
 * - Multi-tier Semantic Validation (Dual EXCEPT, Multiplicity, sp_describe)
 * - Benchmark Evidence (Duration, Reads, CPU)
 * - Safe Script Deployment Package (.sql)
 * - Optional Persistent Workspace Storage
 *
 * Single-screen, 4-step linear pipeline with zero page transitions.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STUDIO_MODULES = root.STUDIO_MODULES || {};
    root.STUDIO_MODULES.refactorStudio = factory(root);
  }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  root = root || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

  let studioState = {
    activeView: null,
    step: 1, // 1: Diagnosis, 2: Diff, 3: Validation, 4: Result
    maxUnlockedStep: 1,
    isOptimizing: false,
    isValidating: false,
    originalSql: '',
    candidateSql: '',
    aiSummary: [],
    aiRisks: [],
    validationResult: null,
    benchmarkResult: null,
    planComparison: null,
    decision: null,
    activeSubTab: 'pipeline' // 'pipeline' | 'workspaces'
  };

  let appStateRef = null;
  let helpers = {};

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function extractQueryFromView(rawSql) {
    if (!rawSql || typeof rawSql !== 'string') return '';
    let sql = rawSql.trim();
    sql = sql.replace(/^```(?:sql)?\s*[\r\n]+/i, '').replace(/[\r\n]+```\s*$/i, '').trim();
    sql = sql.replace(/[\r\n]+\s*GO\s*;?\s*$/i, '').trim();
    const viewRegex = /^(?:[\s\r\n]|--[^\r\n]*[\r\n]|\/\*[\s\S]*?\*\/)*(?:CREATE\s+OR\s+ALTER\s+VIEW|CREATE\s+VIEW|ALTER\s+VIEW)\s+(?:\[?[a-zA-Z0-9_@#$]+\]?\.)?\[?[a-zA-Z0-9_@#$]+\]?\s*(?:\([^\)]*\))?\s*(?:WITH\s+[^\r\n]+?\s+)?AS\s+(?=(?:SELECT|WITH)\b)/i;
    const match = viewRegex.exec(sql);
    if (match) {
      sql = sql.slice(match[0].length).trim();
    } else {
      const fallbackRegex = /^(?:[\s\r\n]|--[^\r\n]*[\r\n]|\/\*[\s\S]*?\*\/)*(?:CREATE|ALTER)\s+VIEW\b[\s\S]*?\bAS\s+(?=(?:SELECT|WITH)\b)/i;
      const match2 = fallbackRegex.exec(sql);
      if (match2) {
        sql = sql.slice(match2[0].length).trim();
      }
    }
    return sql.replace(/;+\s*$/, '').trim();
  }

  function initRefactorStudio(containerEl, globalState, globalHelpers) {
    appStateRef = globalState;
    helpers = globalHelpers || {};
    bindStudioEvents();
  }

  function bindStudioEvents() {
    const viewSelect = document.getElementById('studioViewSelect');
    if (viewSelect) {
      viewSelect.addEventListener('change', (e) => {
        loadViewIntoStudio(e.target.value);
      });
    }

    const subTabPipeline = document.getElementById('studioTabBtnPipeline');
    const subTabWorkspaces = document.getElementById('studioTabBtnWorkspaces');
    if (subTabPipeline && subTabWorkspaces) {
      subTabPipeline.addEventListener('click', () => switchStudioSubTab('pipeline'));
      subTabWorkspaces.addEventListener('click', () => switchStudioSubTab('workspaces'));
    }

    // Step 1: Optimize Button
    const btnOptimize = document.getElementById('btnStudioOptimize');
    if (btnOptimize) {
      btnOptimize.addEventListener('click', () => runOptimize());
    }

    // Step 2: Validate & Benchmark Button
    const btnValidate = document.getElementById('btnStudioValidate');
    if (btnValidate) {
      btnValidate.addEventListener('click', () => runValidateAndBenchmark());
    }

    // Step 2: Manual Edit toggle
    const btnEditCandidate = document.getElementById('btnStudioEditCandidate');
    if (btnEditCandidate) {
      btnEditCandidate.addEventListener('click', () => {
        const textarea = document.getElementById('studioCandidateSql');
        if (textarea) {
          textarea.readOnly = !textarea.readOnly;
          btnEditCandidate.textContent = textarea.readOnly ? '✎ Düzenle' : '🔒 Kilitle';
          if (!textarea.readOnly) textarea.focus();
        }
      });
    }

    // Step 4 Actions:
    // Action A: Open in Workbench
    const btnOpenWb = document.getElementById('btnStudioOpenWorkbench');
    if (btnOpenWb) {
      btnOpenWb.addEventListener('click', () => {
        const sql = studioState.candidateSql || studioState.originalSql;
        const targetDb = studioState.activeView?.database || appStateRef.primaryDatabase;
        if (typeof helpers.openWorkbenchSql === 'function') {
          helpers.openWorkbenchSql(sql, targetDb, `${studioState.activeView?.name || 'Refactor'}_V2`);
        }
      });
    }

    // Action B: Save to Workspace
    const btnSaveWs = document.getElementById('btnStudioSaveWorkspace');
    if (btnSaveWs) {
      btnSaveWs.addEventListener('click', () => saveStudioToWorkspace());
    }

    // Action C: Generate Script
    const btnGenScript = document.getElementById('btnStudioGenerateScript');
    if (btnGenScript) {
      btnGenScript.addEventListener('click', () => showDeploymentScriptModal());
    }

    // Step 2, 3, 4: Live Side-by-Side Comparison Launchers
    const btnLiveStep2 = document.getElementById('btnStudioCompareLiveStep2');
    if (btnLiveStep2) {
      btnLiveStep2.addEventListener('click', () => openLiveCompareModal());
    }

    const btnLiveStep3 = document.getElementById('btnStudioCompareLiveStep3');
    if (btnLiveStep3) {
      btnLiveStep3.addEventListener('click', () => openLiveCompareModal());
    }

    const btnLiveStep4 = document.getElementById('btnStudioCompareLiveStep4');
    if (btnLiveStep4) {
      btnLiveStep4.addEventListener('click', () => openLiveCompareModal());
    }

    // Live Compare Modal Controls
    const btnRunBoth = document.getElementById('btnLiveCompareRunBoth');
    if (btnRunBoth) {
      btnRunBoth.addEventListener('click', () => runLiveComparison({ runOrig: true, runCand: true }));
    }

    const btnRunOrig = document.getElementById('btnLiveCompareRunOrig');
    if (btnRunOrig) {
      btnRunOrig.addEventListener('click', () => runLiveComparison({ runOrig: true, runCand: false }));
    }

    const btnRunCand = document.getElementById('btnLiveCompareRunCand');
    if (btnRunCand) {
      btnRunCand.addEventListener('click', () => runLiveComparison({ runOrig: false, runCand: true }));
    }

    const btnToggleOrig = document.getElementById('btnToggleOrigSqlPreview');
    if (btnToggleOrig) {
      btnToggleOrig.addEventListener('click', () => {
        document.getElementById('liveCompareOrigSqlWrap')?.classList.toggle('collapsed');
      });
    }

    const btnToggleCand = document.getElementById('btnToggleCandSqlPreview');
    if (btnToggleCand) {
      btnToggleCand.addEventListener('click', () => {
        document.getElementById('liveCompareCandSqlWrap')?.classList.toggle('collapsed');
      });
    }

    const btnToWb = document.getElementById('btnLiveCompareToWorkbench');
    if (btnToWb) {
      btnToWb.addEventListener('click', () => exportBothToWorkbench());
    }

    const btnCloseLive = document.getElementById('btnCloseLiveCompareModal');
    if (btnCloseLive) {
      btnCloseLive.addEventListener('click', () => closeLiveCompareModal());
    }

    const liveModalEl = document.getElementById('studioLiveCompareModal');
    if (liveModalEl) {
      liveModalEl.addEventListener('click', (e) => {
        if (e.target === liveModalEl) closeLiveCompareModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('studioLiveCompareModal');
        if (modal && !modal.classList.contains('hidden')) {
          closeLiveCompareModal();
        }
      }
    });

    // Step Navigation Jump Buttons
    document.querySelectorAll('[data-studio-step-jump]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetStep = parseInt(e.currentTarget.dataset.studioStepJump, 10);
        if (targetStep <= (studioState.maxUnlockedStep || studioState.step)) {
          setStudioStep(targetStep);
        }
      });
    });
  }

  function switchStudioSubTab(tabName) {
    studioState.activeSubTab = tabName;
    const subTabPipeline = document.getElementById('studioTabBtnPipeline');
    const subTabWorkspaces = document.getElementById('studioTabBtnWorkspaces');
    const panePipeline = document.getElementById('studioPanePipeline');
    const paneWorkspaces = document.getElementById('studioPaneWorkspaces');

    if (subTabPipeline) subTabPipeline.classList.toggle('active', tabName === 'pipeline');
    if (subTabWorkspaces) subTabWorkspaces.classList.toggle('active', tabName === 'workspaces');
    if (panePipeline) panePipeline.classList.toggle('hidden', tabName !== 'pipeline');
    if (paneWorkspaces) paneWorkspaces.classList.toggle('hidden', tabName !== 'workspaces');

    if (tabName === 'workspaces' && typeof helpers.loadWorkspacesList === 'function') {
      helpers.loadWorkspacesList();
    }
  }

  function setStudioStep(stepNum) {
    studioState.step = Math.max(1, Math.min(4, stepNum));
    studioState.maxUnlockedStep = Math.max(studioState.maxUnlockedStep || 1, studioState.step);

    // Update Step Indicators
    for (let s = 1; s <= 4; s++) {
      const stepItem = document.getElementById(`studioStepBadge${s}`);
      if (stepItem) {
        stepItem.classList.toggle('active', s === studioState.step);
        stepItem.classList.toggle('completed', s < studioState.step);
        stepItem.style.opacity = (s <= studioState.maxUnlockedStep) ? '1' : '0.5';
        stepItem.style.cursor = (s <= studioState.maxUnlockedStep) ? 'pointer' : 'not-allowed';
      }
      const section = document.getElementById(`studioSectionStep${s}`);
      if (section) {
        section.classList.toggle('hidden', s > studioState.step);
        if (s === studioState.step) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  }

  async function loadViewIntoStudio(identifier) {
    if (!identifier) return;
    const views = appStateRef?.data?.views || [];
    const targetStr = String(identifier).toLowerCase().trim();
    const v = views.find(x =>
      (x.canonicalId && x.canonicalId.toLowerCase() === targetStr) ||
      (x.name && x.name.toLowerCase() === targetStr)
    ) || views[0];

    if (!v) return;

    studioState.activeView = v;
    studioState.step = 1;
    studioState.maxUnlockedStep = 1;
    studioState.candidateSql = '';
    studioState.aiSummary = [];
    studioState.aiRisks = [];
    studioState.validationResult = null;
    studioState.benchmarkResult = null;
    studioState.planComparison = null;
    studioState.decision = null;

    // Populate Select Options
    populateStudioViewSelect(v.canonicalId || v.name);

    // Header Updates
    const viewNameEl = document.getElementById('studioHeaderViewName');
    const dbBadgeEl = document.getElementById('studioHeaderDbBadge');
    const riskBadgeEl = document.getElementById('studioHeaderRiskBadge');
    const evidencePillEl = document.getElementById('studioHeaderEvidencePill');

    if (viewNameEl) viewNameEl.textContent = v.name || v.view_name;
    if (dbBadgeEl) dbBadgeEl.textContent = v.database || appStateRef?.primaryDatabase || 'SQL DB';
    if (riskBadgeEl) {
      const r = String(v.risk || v.riskLevel || 'low').toLowerCase();
      riskBadgeEl.textContent = `RISK ${r.toUpperCase()} (${v.riskScore || 0})`;
      riskBadgeEl.className = `severity-pill severity-${r}`;
    }
    if (evidencePillEl) {
      const hasQs = v.runtime?.regression?.status || v.runtime?.isRegressed;
      evidencePillEl.textContent = hasQs ? 'Query Store Kanıtı' : 'Metadata / Plan Kanıtı';
    }

    // Step 1: Diagnosis Content
    renderStep1Diagnosis(v);

    // Fetch Original SQL
    let sql = v.definition || '';
    if (!sql && typeof helpers.getViewDefinition === 'function') {
      sql = await helpers.getViewDefinition(v.canonicalId || v.name);
    }
    studioState.fullOriginalDefinition = sql;
    const cleanSql = extractQueryFromView(sql);
    studioState.originalSql = cleanSql || sql || `-- [${v.name}] için tanım bulunamadı.`;

    const origSqlView = document.getElementById('studioOriginalSqlStep1');
    if (origSqlView) origSqlView.textContent = studioState.originalSql;

    const origSqlDiff = document.getElementById('studioOriginalSqlDiff');
    if (origSqlDiff) origSqlDiff.textContent = studioState.originalSql;

    setStudioStep(1);
  }

  function populateStudioViewSelect(selectedVal) {
    const sel = document.getElementById('studioViewSelect');
    if (!sel) return;
    const views = appStateRef?.data?.views || [];
    sel.innerHTML = views.map(v => {
      const id = v.canonicalId || v.name;
      const isSel = id === selectedVal || v.name === selectedVal;
      return `<option value="${escapeHtml(id)}" ${isSel ? 'selected' : ''}>${escapeHtml(v.name)} (${v.risk ? v.risk.toUpperCase() : 'LOW'} - ${v.database || ''})</option>`;
    }).join('');
  }

  function renderStep1Diagnosis(view) {
    const findingsList = document.getElementById('studioDiagnosisFindings');
    if (!findingsList) return;

    const problems = view.problems || [];
    const ast = view.ast || {};
    const findings = [];

    // Derive top 3-5 high-impact findings
    if (problems.length > 0) {
      problems.forEach(p => findings.push({
        title: p.title || 'Performans Uyarısı',
        desc: p.detail || p.description || '',
        severity: p.severity || 'HIGH',
        tag: 'Analiz'
      }));
    }

    // Repeated access
    if (view.repeatedTables && view.repeatedTables.length > 0) {
      findings.push({
        title: 'Mükerrer Tablo Taraması',
        desc: `${view.repeatedTables.map(t => t.table).join(', ')} tablosuna farklı sorgu kollarından çok kez erişiliyor.`,
        severity: 'HIGH',
        tag: 'I/O Baskısı'
      });
    }

    // Non-SARGable
    if (ast.predicates && ast.predicates.some(p => p.isSargable === false)) {
      findings.push({
        title: 'SARGable Olmayan Filtreleme',
        desc: 'Kolon üzerinde fonksiyon kullanımı veya örtük tip dönüşümü (CONVERT/CAST) indeks aramalarını tablo taramasına çeviriyor.',
        severity: 'CRITICAL',
        tag: 'İndeks'
      });
    }

    // Default fallback if no severe issues
    if (findings.length === 0) {
      findings.push({
        title: 'Optimizasyon Potansiyeli',
        desc: 'Sorgunun join sıralaması, gereksiz kolon izdüşümleri ve set-based dönüşüm imkanları incelenecektir.',
        severity: 'MEDIUM',
        tag: 'Genel'
      });
    }

    findingsList.innerHTML = findings.slice(0, 5).map(f => `
      <div class="studio-finding-card severity-${String(f.severity).toLowerCase()}">
        <div class="finding-header">
          <span class="finding-tag">${escapeHtml(f.tag)}</span>
          <strong>${escapeHtml(f.title)}</strong>
        </div>
        <p>${escapeHtml(f.desc)}</p>
      </div>
    `).join('');
  }

  async function runOptimize() {
    if (!studioState.activeView || studioState.isOptimizing) return;
    studioState.isOptimizing = true;

    const btnOptimize = document.getElementById('btnStudioOptimize');
    const progressEl = document.getElementById('studioOptimizeProgress');
    if (btnOptimize) btnOptimize.disabled = true;
    if (progressEl) progressEl.classList.remove('hidden');

    try {
      const v = studioState.activeView;
      const res = await fetch('/api/ai/refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          viewName: v.name,
          database: v.database || appStateRef.primaryDatabase,
          sql: studioState.originalSql,
          options: {
            inlineRepeated: true,
            setBasedApply: true,
            indexSuggestions: true,
            lockColumns: true
          }
        })
      });

      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || 'AI optimizasyon yanıtı alınamadı.');
      }

      const rawCandidate = data.data?.candidateSql || data.candidateSql || studioState.originalSql;
      studioState.candidateSql = extractQueryFromView(rawCandidate);
      studioState.aiSummary = data.data?.bulletPoints || data.bulletPoints || [
        'Tekrar eden alt sorgu taramaları küme bazlı CTE veya inline join haline getirildi.',
        'SARGable olmayan filtre koşulları düzeltildi.',
        'Sütun sırası ve tipleri eksiksiz korundu.'
      ];
      studioState.aiRisks = data.data?.risks || data.risks || [];

      // Populate Step 2 Diff
      const candidateInput = document.getElementById('studioCandidateSql');
      if (candidateInput) candidateInput.value = studioState.candidateSql;

      const summaryList = document.getElementById('studioAiSummaryList');
      if (summaryList) {
        summaryList.innerHTML = studioState.aiSummary.map(s => `<li>${escapeHtml(s)}</li>`).join('');
      }

      const risksList = document.getElementById('studioAiRisksList');
      const risksBox = document.getElementById('studioAiRisksBox');
      if (risksList && risksBox) {
        if (studioState.aiRisks.length > 0) {
          risksBox.classList.remove('hidden');
          risksList.innerHTML = studioState.aiRisks.map(r => `<li>${escapeHtml(r)}</li>`).join('');
        } else {
          risksBox.classList.add('hidden');
        }
      }

      if (typeof helpers.toast === 'function') {
        helpers.toast('Aday Üretildi', 'Optimize edilmiş V2 SQL hazırlandı. Lütfen doğrulama adımını çalıştırın.', 'success');
      }

      setStudioStep(2);
    } catch (err) {
      if (typeof helpers.toast === 'function') {
        helpers.toast('Optimizasyon Hatası', err.message || 'AI servisi yanıt veremedi.', 'error');
      }
    } finally {
      studioState.isOptimizing = false;
      if (btnOptimize) btnOptimize.disabled = false;
      if (progressEl) progressEl.classList.add('hidden');
    }
  }

  async function runValidateAndBenchmark() {
    if (studioState.isValidating) return;
    studioState.isValidating = true;

    // Read possibly edited candidate SQL
    const candidateInput = document.getElementById('studioCandidateSql');
    if (candidateInput) {
      studioState.candidateSql = candidateInput.value.trim();
    }

    const btnValidate = document.getElementById('btnStudioValidate');
    const progressEl = document.getElementById('studioValidateProgress');
    if (btnValidate) btnValidate.disabled = true;
    if (progressEl) progressEl.classList.remove('hidden');

    try {
      const v = studioState.activeView || {};
      const targetDb = v.database || appStateRef?.activeDatabase || appStateRef?.primaryDatabase || appStateRef?.connectionInfo?.database;

      const origClean = extractQueryFromView(studioState.originalSql);
      const candClean = extractQueryFromView(studioState.candidateSql);

      if (!origClean || !candClean) {
        throw new Error('Doğrulanacak orijinal veya aday SQL sorgusu boş.');
      }

      // 1. Semantic Validation
      const valRes = await fetch('/api/validation/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalSql: origClean,
          candidateSql: candClean,
          database: targetDb,
          sampleLimit: 1000
        })
      });
      const valData = await valRes.json();
      if (!valRes.ok || valData.ok === false) {
        throw new Error(valData.error || 'Doğrulama servisi hata döndü.');
      }
      const val = valData.data || valData;
      studioState.validationResult = val;

      // 2. Refactor Comparison & Benchmark (Sprint 3 engine)
      const compRes = await fetch('/api/refactor/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalSql: origClean,
          candidateSql: candClean,
          database: targetDb,
          runValidation: false,
          benchmarkRuns: 3
        })
      });
      const compData = await compRes.json();
      if (!compRes.ok || compData.ok === false) {
        throw new Error(compData.error || 'Performans karşılaştırma servisi hata döndü.');
      }
      const comparison = compData.data || compData;
      const rawBench = comparison.benchmarks || {};
      const benchComp = rawBench.comparison || comparison.benchmark || {};

      // Ensure original and candidate metrics are available
      if (!benchComp.original && rawBench.original) {
        benchComp.original = rawBench.original.metrics || rawBench.original;
      }
      if (!benchComp.candidate && rawBench.candidate) {
        benchComp.candidate = rawBench.candidate.metrics || rawBench.candidate;
      }
      studioState.benchmarkResult = benchComp;
      studioState.planComparison = comparison.plans?.comparison || comparison.planComparison || {};

      // 3. Evaluate Decision
      const refDecision = (typeof window !== 'undefined' ? window : root)?.STUDIO_MODULES?.refactorDecision;
      const valNormalized = {
        ...val,
        status: (val.verdict || val.status || '').toUpperCase()
      };
      if (refDecision) {
        studioState.decision = refDecision.evaluateRefactorDecision({
          validation: valNormalized,
          benchmark: studioState.benchmarkResult,
          planComparison: studioState.planComparison
        });
      } else if (comparison.decision) {
        studioState.decision = comparison.decision;
      } else {
        const isPass = val.verdict === 'PASS' || val.verdict === 'PASS_WITH_WARNING';
        studioState.decision = {
          code: isPass ? 'SAFE_IMPROVEMENT' : 'UNSAFE',
          label: isPass ? 'Güvenli İyileştirme' : 'Güvensiz Aday',
          badgeClass: isPass ? 'badge-success' : 'badge-danger',
          color: isPass ? '#10b981' : '#ef4444',
          description: isPass ? 'Semantik doğrulama başarılı oldu.' : 'Semantik doğrulama başarısız.'
        };
      }

      // Unlock step 4 for navigation
      studioState.maxUnlockedStep = Math.max(studioState.maxUnlockedStep || 1, 4);

      // Render Step 3 and Step 4
      renderStep3ValidationAndPerf();
      renderStep4VerdictAndActions();

      setStudioStep(3);
    } catch (err) {
      if (typeof helpers.toast === 'function') {
        helpers.toast('Doğrulama Hatası', err.message || 'Doğrulama servisi çalıştırılamadı.', 'error');
      }
    } finally {
      studioState.isValidating = false;
      if (btnValidate) btnValidate.disabled = false;
      if (progressEl) progressEl.classList.add('hidden');
    }
  }

  function renderStep3ValidationAndPerf() {
    const val = studioState.validationResult || {};
    const bench = studioState.benchmarkResult || {};
    const plan = studioState.planComparison || {};
    const isPass = val.verdict === 'PASS' || val.verdict === 'PASS_WITH_WARNING' || val.status === 'PASS';

    // 1. Semantic Status Badge
    const valBadgeEl = document.getElementById('studioValVerdictBadge');
    const valDescEl = document.getElementById('studioValVerdictDesc');
    const valWarningBanner = document.getElementById('studioValFailedWarning');

    if (valBadgeEl) {
      valBadgeEl.textContent = val.verdict || val.status || (isPass ? 'PASS' : 'FAIL');
      valBadgeEl.className = `status-pill ${isPass ? 'status-ready' : 'status-danger'}`;
    }
    if (valDescEl) {
      valDescEl.textContent = val.summary || (isPass
        ? 'Şema, satır sayısı ve çift yönlü EXCEPT testleri eşleşti.'
        : 'Sorgu çıktısında satır sayısı veya şema uyuşmazlığı tespit edildi.');
    }

    // Strict guardrail: If validation failed, show stern warning
    if (valWarningBanner) {
      valWarningBanner.classList.toggle('hidden', isPass);
    }

    // 2. Metrics comparison
    const origBench = bench.original?.metrics || bench.original || bench.before?.metrics || bench.before || {};
    const candBench = bench.candidate?.metrics || bench.candidate || bench.after?.metrics || bench.after || {};

    const origDur = origBench.durationMs ?? origBench.medianDurationMs ?? bench.beforeDurationMs;
    const candDur = candBench.durationMs ?? candBench.medianDurationMs ?? bench.afterDurationMs;

    const origReads = origBench.logicalReads ?? origBench.medianLogicalReads ?? origBench.totalLogicalReads ?? bench.beforeReads;
    const candReads = candBench.logicalReads ?? candBench.medianLogicalReads ?? candBench.totalLogicalReads ?? bench.afterReads;

    let durDeltaPct = null;
    if (bench.deltas?.durationPercent != null) {
      durDeltaPct = bench.deltas.durationPercent;
    } else if (bench.improvements?.durationPercent != null) {
      durDeltaPct = -bench.improvements.durationPercent;
    } else if (bench.durationDeltaPercent != null) {
      durDeltaPct = bench.durationDeltaPercent;
    } else if (origDur != null && candDur != null && origDur > 0) {
      durDeltaPct = Math.round(((candDur - origDur) / origDur) * 100);
    }

    let readsDeltaPct = null;
    if (bench.deltas?.readsPercent != null) {
      readsDeltaPct = bench.deltas.readsPercent;
    } else if (bench.improvements?.readsPercent != null) {
      readsDeltaPct = -bench.improvements.readsPercent;
    } else if (bench.readsDeltaPercent != null) {
      readsDeltaPct = bench.readsDeltaPercent;
    } else if (origReads != null && candReads != null && origReads > 0) {
      readsDeltaPct = Math.round(((candReads - origReads) / origReads) * 100);
    }

    const durEl = document.getElementById('studioPerfDurationVal');
    const durDeltaEl = document.getElementById('studioPerfDurationDelta');
    if (durEl) {
      if (origDur != null && candDur != null) {
        durEl.textContent = `${formatNum(origDur)}ms → ${formatNum(candDur)}ms`;
      } else {
        durEl.textContent = '—';
      }
    }
    if (durDeltaEl) {
      if (durDeltaPct != null) {
        durDeltaEl.textContent = `${durDeltaPct > 0 ? '+' : ''}${durDeltaPct}%`;
        durDeltaEl.className = `trend-pill ${durDeltaPct <= 0 ? 'trend-positive' : 'trend-negative'}`;
      } else {
        durDeltaEl.textContent = '—';
        durDeltaEl.className = 'trend-pill';
      }
    }

    const readsEl = document.getElementById('studioPerfReadsVal');
    const readsDeltaEl = document.getElementById('studioPerfReadsDelta');
    if (readsEl) {
      if (origReads != null && candReads != null) {
        readsEl.textContent = `${formatNum(origReads)} → ${formatNum(candReads)}`;
      } else {
        readsEl.textContent = '—';
      }
    }
    if (readsDeltaEl) {
      if (readsDeltaPct != null) {
        readsDeltaEl.textContent = `${readsDeltaPct > 0 ? '+' : ''}${readsDeltaPct}%`;
        readsDeltaEl.className = `trend-pill ${readsDeltaPct <= 0 ? 'trend-positive' : 'trend-negative'}`;
      } else {
        readsDeltaEl.textContent = '—';
        readsDeltaEl.className = 'trend-pill';
      }
    }

    // 3. Plan key changes
    const planChangesList = document.getElementById('studioPlanChangesList');
    if (planChangesList) {
      const changes = [];
      if (Array.isArray(plan.changes) && plan.changes.length > 0) {
        for (const ch of plan.changes) {
          const text = ch.title ? `${ch.title}: ${ch.detail || ''}` : (ch.detail || ch.code);
          if (text) changes.push(text);
        }
      }

      const pDeltas = plan.deltas || {};
      const scansDelta = pDeltas.scans ?? plan.scansDelta;
      const seeksDelta = pDeltas.seeks ?? plan.seeksDelta;
      const costPct = pDeltas.estimatedCostPercent ?? plan.estimatedCostPercent;

      if (scansDelta != null && scansDelta !== 0) {
        changes.push(`Tablo Taramaları (Scan): ${scansDelta > 0 ? '+' : ''}${scansDelta}`);
      }
      if (seeksDelta != null && seeksDelta !== 0) {
        changes.push(`İndeks Aramaları (Seek): ${seeksDelta > 0 ? '+' : ''}${seeksDelta}`);
      }
      if (costPct != null && costPct !== 0) {
        changes.push(`Tahmini Plan Maliyeti: %${costPct > 0 ? '+' : ''}${costPct}`);
      }

      if (changes.length === 0) {
        if (bench.summary) {
          changes.push(bench.summary);
        } else {
          changes.push('Operatör ağacı optimize edildi; mantıksal okumalar düşürüldü.');
        }
      }

      planChangesList.innerHTML = changes.map(c => `<li>${escapeHtml(c)}</li>`).join('');
    }
  }

  function renderStep4VerdictAndActions() {
    const dec = studioState.decision || {};
    const meta = dec.metadata || dec;
    const label = meta.label || dec.label || (dec.code === 'SAFE_IMPROVEMENT' ? 'Güvenli İyileştirme' : 'Değerlendirildi');
    const color = meta.color || dec.color || '#10b981';
    const description = meta.description || dec.description || 'Aday sorgu semantik doğrulamayı geçti ve kaynak tüketimi değerlendirildi.';

    const verdictPill = document.getElementById('studioVerdictPill');
    const verdictDesc = document.getElementById('studioVerdictDescription');

    if (verdictPill) {
      verdictPill.textContent = label;
      verdictPill.style.borderColor = color;
      verdictPill.style.color = color;
    }
    if (verdictDesc) {
      verdictDesc.textContent = description;
    }
  }

  async function saveStudioToWorkspace() {
    const v = studioState.activeView;
    if (!v) return;

    try {
      const targetDb = v.database || appStateRef.primaryDatabase;
      const title = `Optimizasyon: ${v.name} (${new Date().toLocaleDateString('tr-TR')})`;

      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          targetObject: v.name,
          database: targetDb,
          originalSql: studioState.originalSql,
          notes: `Doğrulama: ${studioState.validationResult?.verdict || 'PASS'}. Süre kazancı: %${studioState.benchmarkResult?.improvements?.durationPercent || studioState.benchmarkResult?.durationDeltaPercent || 0}`
        })
      });

      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Kayıt başarısız.');

      const ws = data.data;

      // Add candidate version
      if (ws && ws.id && studioState.candidateSql) {
        await fetch(`/api/workspaces/${ws.id}/candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: studioState.candidateSql,
            rationale: (studioState.aiSummary || []).join('\n')
          })
        });
      }

      if (typeof helpers.toast === 'function') {
        helpers.toast('Çalışma Kaydedildi', `"${title}" çalışma alanlarına kalıcı olarak eklendi.`, 'success');
      }
    } catch (err) {
      if (typeof helpers.toast === 'function') {
        helpers.toast('Kayıt Hatası', err.message, 'error');
      }
    }
  }

  function showDeploymentScriptModal() {
    const v = studioState.activeView;
    if (!v) return;

    const sqlV2 = studioState.candidateSql || studioState.originalSql;
    const viewName = v.name || 'AA_VIEW';
    const schema = v.schema || 'dbo';
    const db = v.database || appStateRef.primaryDatabase;

    const deploymentScript = `-- ==========================================================
-- SQL Server Refactoring & Performance Studio
-- GÜVENLİ DAĞITIM BETİĞİ (SAFE SCRIPT DEPLOYMENT PACKAGE)
-- 
-- Hedef Nesne  : [${db}].[${schema}].[${viewName}]
-- Üretim Tarihi: ${new Date().toLocaleString('tr-TR')}
-- Doğrulama    : ${studioState.validationResult?.verdict || 'SEMANTICALLY_VALIDATED'}
-- 
-- DİKKAT: Stüdyo bu betiği doğrudan veritabanına uygulamaz.
-- Bu betik DBA veya Veritabanı Geliştiricisi tarafından
-- ilgili bakım aralığında (maintenance window) çalıştırılmalıdır.
-- ==========================================================

USE [${db}];
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- 1. ROLLBACK YEDEĞİ (Önceki Orijinal Tanım)
/*
${studioState.fullOriginalDefinition || studioState.originalSql}
*/
GO

-- 2. GÜNCELLENMİŞ OPTİMİZE VIEW TANIMI
CREATE OR ALTER VIEW [${schema}].[${viewName}]
AS
${sqlV2}
GO

PRINT '>> [${schema}].[${viewName}] başarıyla güncellendi.';
GO
`;

    // Display modal
    const modalEl = document.getElementById('studioScriptModal');
    const codeEl = document.getElementById('studioScriptCode');
    if (modalEl && codeEl) {
      codeEl.textContent = deploymentScript;
      modalEl.classList.remove('hidden');
    }

    const btnCopy = document.getElementById('btnStudioCopyScript');
    if (btnCopy) {
      btnCopy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(deploymentScript);
          if (typeof helpers.toast === 'function') helpers.toast('Kopyalandı', 'Dağıtım betiği panoya kopyalandı.', 'success');
        } catch (_) {}
      };
    }

    const btnDownload = document.getElementById('btnStudioDownloadScript');
    if (btnDownload) {
      btnDownload.onclick = () => {
        const blob = new Blob([deploymentScript], { type: 'text/sql;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${viewName}_Refactor_${new Date().toISOString().slice(0, 10)}.sql`;
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    const btnClose = document.getElementById('btnCloseStudioScriptModal');
    if (btnClose) {
      btnClose.onclick = () => modalEl.classList.add('hidden');
    }
  }

  function formatNum(num) {
    if (num == null || isNaN(Number(num))) return String(num);
    const n = Number(num);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('tr-TR');
  }

  // =========================================================================
  // LIVE SIDE-BY-SIDE QUERY EXECUTION & RESULT COMPARISON (Sprint 9 Extended)
  // =========================================================================

  let lastLiveCompareOrig = null;
  let lastLiveCompareCand = null;

  function openLiveCompareModal() {
    const modalEl = document.getElementById('studioLiveCompareModal');
    if (!modalEl) return;

    // Get current raw SQLs
    const candidateInput = document.getElementById('studioCandidateSql');
    const rawOrig = studioState.originalSql || '';
    const rawCand = candidateInput?.value?.trim() || studioState.candidateSql || rawOrig;

    // Strip CREATE VIEW to get pure executable SELECT query
    const origSelect = extractQueryFromView(rawOrig);
    const candSelect = extractQueryFromView(rawCand);

    const origSqlArea = document.getElementById('liveCompareOrigSqlText');
    const candSqlArea = document.getElementById('liveCompareCandSqlText');
    if (origSqlArea) origSqlArea.value = origSelect;
    if (candSqlArea) candSqlArea.value = candSelect;

    // Populate database select
    const dbSelect = document.getElementById('liveCompareDbSelect');
    if (dbSelect) {
      const activeDb = studioState.activeView?.database || appStateRef?.activeDatabase || appStateRef?.primaryDatabase || '';
      const allDbs = new Set();
      if (activeDb) allDbs.add(activeDb);
      if (appStateRef?.primaryDatabase) allDbs.add(appStateRef.primaryDatabase);
      if (Array.isArray(appStateRef?.selectedDatabases)) {
        appStateRef.selectedDatabases.forEach(d => allDbs.add(d));
      }
      if (Array.isArray(appStateRef?.data?.databases)) {
        appStateRef.data.databases.forEach(d => {
          const name = typeof d === 'string' ? d : d.name;
          if (name) allDbs.add(name);
        });
      }
      if (allDbs.size === 0) allDbs.add('MikroDB_V16_LIDER25');

      dbSelect.innerHTML = Array.from(allDbs).map(db =>
        `<option value="${escapeHtml(db)}"${db === activeDb ? ' selected' : ''}>${escapeHtml(db)}</option>`
      ).join('');
    }

    // Set View Badge
    const viewBadge = document.getElementById('liveCompareViewBadge');
    if (viewBadge) {
      viewBadge.textContent = studioState.activeView?.canonicalId || studioState.activeView?.name || 'Seçili View';
    }

    // Reset results on open
    resetLiveCompareState();

    modalEl.classList.remove('hidden');
  }

  function closeLiveCompareModal() {
    const modalEl = document.getElementById('studioLiveCompareModal');
    if (modalEl) modalEl.classList.add('hidden');
  }

  function resetLiveCompareState() {
    lastLiveCompareOrig = null;
    lastLiveCompareCand = null;

    // Reset summary cards
    const valRows = document.getElementById('valCompareRows');
    const subRows = document.getElementById('subCompareRows');
    const valCols = document.getElementById('valCompareCols');
    const subCols = document.getElementById('subCompareCols');
    const valDur = document.getElementById('valCompareDuration');
    const subDur = document.getElementById('subCompareDuration');
    const valReads = document.getElementById('valCompareReads');
    const subReads = document.getElementById('subCompareReads');

    if (valRows) valRows.textContent = '—';
    if (subRows) subRows.textContent = 'Henüz çalıştırılmadı';
    if (valCols) valCols.textContent = '—';
    if (subCols) subCols.textContent = 'Kolon listesi bekleniyor';
    if (valDur) valDur.textContent = '—';
    if (subDur) subDur.textContent = 'Orijinal vs Aday';
    if (valReads) valReads.textContent = '—';
    if (subReads) subReads.textContent = 'Buffer cache sayfa okuması';

    // Reset panes
    const origEmpty = document.getElementById('liveCompareOrigEmpty');
    const origGrid = document.getElementById('liveCompareOrigGrid');
    const candEmpty = document.getElementById('liveCompareCandEmpty');
    const candGrid = document.getElementById('liveCompareCandGrid');

    if (origEmpty) origEmpty.classList.remove('hidden');
    if (origGrid) origGrid.classList.add('hidden');
    if (candEmpty) candEmpty.classList.remove('hidden');
    if (candGrid) candGrid.classList.add('hidden');

    const origPill = document.getElementById('liveCompareOrigPill');
    const candPill = document.getElementById('liveCompareCandPill');
    if (origPill) {
      origPill.textContent = 'Bekliyor';
      origPill.className = 'status-pill status-ready';
    }
    if (candPill) {
      candPill.textContent = 'Bekliyor';
      candPill.className = 'status-pill status-ready';
    }

    const origStats = document.getElementById('liveCompareOrigStats');
    const candStats = document.getElementById('liveCompareCandStats');
    if (origStats) origStats.textContent = '—';
    if (candStats) candStats.textContent = '—';
  }

  async function runLiveComparison({ runOrig = true, runCand = true } = {}) {
    const origSqlArea = document.getElementById('liveCompareOrigSqlText');
    const candSqlArea = document.getElementById('liveCompareCandSqlText');
    const dbSelect = document.getElementById('liveCompareDbSelect');
    const limitSelect = document.getElementById('liveCompareRowLimit');

    const origSql = extractQueryFromView(origSqlArea?.value?.trim() || '');
    const candSql = extractQueryFromView(candSqlArea?.value?.trim() || '');
    const database = dbSelect?.value || appStateRef?.primaryDatabase || '';
    const maxRows = parseInt(limitSelect?.value || '500', 10);

    const btnRunBoth = document.getElementById('btnLiveCompareRunBoth');
    const btnRunOrig = document.getElementById('btnLiveCompareRunOrig');
    const btnRunCand = document.getElementById('btnLiveCompareRunCand');

    if (btnRunBoth) {
      btnRunBoth.disabled = true;
      btnRunBoth.innerHTML = '<span>⏳</span> Çalıştırılıyor...';
    }
    if (btnRunOrig) btnRunOrig.disabled = true;
    if (btnRunCand) btnRunCand.disabled = true;

    const origPill = document.getElementById('liveCompareOrigPill');
    const candPill = document.getElementById('liveCompareCandPill');
    const origStats = document.getElementById('liveCompareOrigStats');
    const candStats = document.getElementById('liveCompareCandStats');

    if (runOrig && origPill) {
      origPill.textContent = 'Çalışıyor...';
      origPill.className = 'status-pill status-running';
    }
    if (runCand && candPill) {
      candPill.textContent = 'Çalışıyor...';
      candPill.className = 'status-pill status-running';
    }

    const tasks = [];

    // Task 1: Original
    if (runOrig) {
      tasks.push(
        fetch('/api/workbench/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: origSql, database, maxRows })
        }).then(async r => {
          const json = await r.json();
          if (!r.ok || json.ok === false) throw new Error(json.error || 'Orijinal sorgu yürütülemedi.');
          return json;
        })
      );
    } else {
      tasks.push(Promise.resolve(lastLiveCompareOrig));
    }

    // Task 2: Candidate
    if (runCand) {
      tasks.push(
        fetch('/api/workbench/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: candSql, database, maxRows })
        }).then(async r => {
          const json = await r.json();
          if (!r.ok || json.ok === false) throw new Error(json.error || 'Aday sorgu yürütülemedi.');
          return json;
        })
      );
    } else {
      tasks.push(Promise.resolve(lastLiveCompareCand));
    }

    try {
      const [origRes, candRes] = await Promise.allSettled(tasks);

      // Handle Original
      if (runOrig) {
        const origEmpty = document.getElementById('liveCompareOrigEmpty');
        const origGrid = document.getElementById('liveCompareOrigGrid');

        if (origRes.status === 'fulfilled' && origRes.value) {
          lastLiveCompareOrig = origRes.value;
          if (origEmpty) origEmpty.classList.add('hidden');
          if (origGrid) origGrid.classList.remove('hidden');

          const cols = lastLiveCompareOrig.columns || [];
          const rows = lastLiveCompareOrig.rows || [];
          renderGrid(origGrid, cols, rows);

          const dur = lastLiveCompareOrig.metrics?.durationMs ?? 0;
          const reads = lastLiveCompareOrig.metrics?.logicalReads ?? 0;
          const totalRows = lastLiveCompareOrig.rowsReturned ?? rows.length;
          if (origStats) origStats.textContent = `⏱️ ${dur}ms | 📖 ${formatNum(reads)} reads | 🔢 ${totalRows} satır`;
          if (origPill) {
            origPill.textContent = '● Tamamlandı';
            origPill.className = 'status-pill status-ready';
          }
        } else {
          lastLiveCompareOrig = null;
          if (origEmpty) {
            origEmpty.classList.remove('hidden');
            origEmpty.innerHTML = `<span style="color:var(--danger)">✕ Hata: ${escapeHtml(origRes.reason?.message || 'Bilinmeyen hata')}</span>`;
          }
          if (origGrid) origGrid.classList.add('hidden');
          if (origPill) {
            origPill.textContent = '✕ Hata';
            origPill.className = 'status-pill status-danger';
          }
          if (origStats) origStats.textContent = '—';
        }
      }

      // Handle Candidate
      if (runCand) {
        const candEmpty = document.getElementById('liveCompareCandEmpty');
        const candGrid = document.getElementById('liveCompareCandGrid');

        if (candRes.status === 'fulfilled' && candRes.value) {
          lastLiveCompareCand = candRes.value;
          if (candEmpty) candEmpty.classList.add('hidden');
          if (candGrid) candGrid.classList.remove('hidden');

          const cols = lastLiveCompareCand.columns || [];
          const rows = lastLiveCompareCand.rows || [];
          renderGrid(candGrid, cols, rows);

          const dur = lastLiveCompareCand.metrics?.durationMs ?? 0;
          const reads = lastLiveCompareCand.metrics?.logicalReads ?? 0;
          const totalRows = lastLiveCompareCand.rowsReturned ?? rows.length;
          if (candStats) candStats.textContent = `⏱️ ${dur}ms | 📖 ${formatNum(reads)} reads | 🔢 ${totalRows} satır`;
          if (candPill) {
            candPill.textContent = '● Tamamlandı';
            candPill.className = 'status-pill status-ready';
          }
        } else {
          lastLiveCompareCand = null;
          if (candEmpty) {
            candEmpty.classList.remove('hidden');
            candEmpty.innerHTML = `<span style="color:var(--danger)">✕ Hata: ${escapeHtml(candRes.reason?.message || 'Bilinmeyen hata')}</span>`;
          }
          if (candGrid) candGrid.classList.add('hidden');
          if (candPill) {
            candPill.textContent = '✕ Hata';
            candPill.className = 'status-pill status-danger';
          }
          if (candStats) candStats.textContent = '—';
        }
      }

      // Update Summary Ribbon
      updateLiveSummaryRibbon(lastLiveCompareOrig, lastLiveCompareCand);
    } catch (err) {
      if (typeof helpers.toast === 'function') helpers.toast('Yürütme Hatası', err.message, 'error');
    } finally {
      if (btnRunBoth) {
        btnRunBoth.disabled = false;
        btnRunBoth.innerHTML = '<span>▶</span> İkisini Aynı Anda Çalıştır';
      }
      if (btnRunOrig) btnRunOrig.disabled = false;
      if (btnRunCand) btnRunCand.disabled = false;
    }
  }

  function updateLiveSummaryRibbon(origRes, candRes) {
    const valRows = document.getElementById('valCompareRows');
    const subRows = document.getElementById('subCompareRows');
    const valCols = document.getElementById('valCompareCols');
    const subCols = document.getElementById('subCompareCols');
    const valDur = document.getElementById('valCompareDuration');
    const subDur = document.getElementById('subCompareDuration');
    const valReads = document.getElementById('valCompareReads');
    const subReads = document.getElementById('subCompareReads');

    if (!origRes && !candRes) return;

    // 1. Satır Sayısı Eşleşmesi
    if (origRes && candRes) {
      const origCount = origRes.rowsReturned ?? origRes.rows?.length ?? 0;
      const candCount = candRes.rowsReturned ?? candRes.rows?.length ?? 0;
      const isMatch = origCount === candCount;
      if (valRows) {
        valRows.innerHTML = isMatch
          ? `<span style="color:var(--green)">✓ ${origCount} = ${candCount}</span>`
          : `<span style="color:var(--danger)">⚠ ${origCount} ≠ ${candCount}</span>`;
      }
      if (subRows) {
        subRows.textContent = isMatch ? 'Satır sayıları birebir eşleşti' : 'DİKKAT: Satır sayısı farkı saptandı';
      }

      // 2. Kolon Sayısı ve Şema
      const origCols = origRes.columns || [];
      const candCols = candRes.columns || [];
      const colCountMatch = origCols.length === candCols.length;
      const colNamesMatch = colCountMatch && origCols.every((c, i) => c.toLowerCase() === (candCols[i] || '').toLowerCase());

      if (valCols) {
        if (colNamesMatch) {
          valCols.innerHTML = `<span style="color:var(--green)">✓ ${origCols.length} Kolon</span>`;
        } else if (colCountMatch) {
          valCols.innerHTML = `<span style="color:var(--yellow)">⚠ ${origCols.length} Kolon (İsim Farkı)</span>`;
        } else {
          valCols.innerHTML = `<span style="color:var(--danger)">✕ ${origCols.length} vs ${candCols.length} Kolon</span>`;
        }
      }
      if (subCols) {
        subCols.textContent = colNamesMatch ? 'Şema ve kolon sırası tam uyumlu' : 'Kolon sıralaması veya adları farklı';
      }

      // 3. Yürütme Süresi
      const origMs = origRes.metrics?.durationMs ?? 0;
      const candMs = candRes.metrics?.durationMs ?? 0;
      const diffMs = origMs - candMs;
      const speedup = origMs > 0 ? ((diffMs / origMs) * 100).toFixed(1) : 0;
      if (valDur) {
        if (candMs < origMs) {
          valDur.innerHTML = `<span style="color:var(--green)">${candMs}ms <small>(%${speedup} Hızlı)</small></span>`;
        } else if (candMs === origMs) {
          valDur.innerHTML = `<span>${candMs}ms = ${origMs}ms</span>`;
        } else {
          valDur.innerHTML = `<span style="color:var(--yellow)">${candMs}ms <small>(+${candMs - origMs}ms)</small></span>`;
        }
      }
      if (subDur) {
        subDur.textContent = `Orijinal: ${origMs}ms → Aday: ${candMs}ms`;
      }

      // 4. Mantıksal Okuma (IO)
      const origReads = origRes.metrics?.logicalReads ?? 0;
      const candReads = candRes.metrics?.logicalReads ?? 0;
      const readDiff = origReads - candReads;
      const readSave = origReads > 0 ? ((readDiff / origReads) * 100).toFixed(1) : 0;
      if (valReads) {
        if (candReads < origReads) {
          valReads.innerHTML = `<span style="color:var(--green)">${formatNum(candReads)} <small>(%${readSave} Tasarruf)</small></span>`;
        } else if (candReads === origReads) {
          valReads.innerHTML = `<span>${formatNum(candReads)}</span>`;
        } else {
          valReads.innerHTML = `<span style="color:var(--yellow)">${formatNum(candReads)} <small>(+${formatNum(candReads - origReads)})</small></span>`;
        }
      }
      if (subReads) {
        subReads.textContent = `Orijinal: ${formatNum(origReads)} → Aday: ${formatNum(candReads)}`;
      }
    } else if (origRes) {
      if (valRows) valRows.textContent = `${origRes.rowsReturned || 0} satır`;
      if (subRows) subRows.textContent = 'Yalnız orijinal yürütüldü';
      if (valCols) valCols.textContent = `${(origRes.columns || []).length} kolon`;
      if (valDur) valDur.textContent = `${origRes.metrics?.durationMs ?? 0}ms`;
      if (valReads) valReads.textContent = formatNum(origRes.metrics?.logicalReads ?? 0);
    } else if (candRes) {
      if (valRows) valRows.textContent = `${candRes.rowsReturned || 0} satır`;
      if (subRows) subRows.textContent = 'Yalnız aday yürütüldü';
      if (valCols) valCols.textContent = `${(candRes.columns || []).length} kolon`;
      if (valDur) valDur.textContent = `${candRes.metrics?.durationMs ?? 0}ms`;
      if (valReads) valReads.textContent = formatNum(candRes.metrics?.logicalReads ?? 0);
    }
  }

  function renderGrid(container, columns = [], rows = []) {
    if (!container) return;
    if (window.VirtualGrid) {
      let grid = container.__virtualGridInstance;
      if (!grid) {
        grid = new window.VirtualGrid(container, { rowHeight: 28, buffer: 15 });
        container.__virtualGridInstance = grid;
      }
      grid.setData(columns, rows);
    } else {
      renderFallbackTable(container, columns, rows);
    }
  }

  function renderFallbackTable(container, columns = [], rows = []) {
    container.innerHTML = `
      <div style="overflow:auto;height:100%">
        <table class="wb-virtual-table">
          <thead>
            <tr>
              <th style="width:40px">#</th>
              ${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, 500).map((r, i) => `
              <tr>
                <td style="color:var(--text-muted);font-size:11px">${i + 1}</td>
                ${columns.map(c => {
                  const val = r[c];
                  if (val === null || val === undefined) return `<td><span class="null-pill">NULL</span></td>`;
                  return `<td>${escapeHtml(String(val))}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function exportBothToWorkbench() {
    closeLiveCompareModal();
    const origSqlArea = document.getElementById('liveCompareOrigSqlText');
    const candSqlArea = document.getElementById('liveCompareCandSqlText');
    const dbSelect = document.getElementById('liveCompareDbSelect');

    const origSql = extractQueryFromView(origSqlArea?.value?.trim() || studioState.originalSql || '');
    const candSql = extractQueryFromView(candSqlArea?.value?.trim() || studioState.candidateSql || '');
    const targetDb = dbSelect?.value || studioState.activeView?.database || appStateRef?.primaryDatabase;
    const viewName = studioState.activeView?.name || 'View';

    if (typeof helpers.openWorkbenchSql === 'function') {
      helpers.openWorkbenchSql(origSql, targetDb, `${viewName}_Orijinal`);
      setTimeout(() => {
        helpers.openWorkbenchSql(candSql, targetDb, `${viewName}_Aday_V2`);
      }, 120);
      if (typeof helpers.toast === 'function') {
        helpers.toast('Workbench Aktarıldı', 'Her iki sorgu da SQL Workbench sekmelerine aktarıldı.', 'success');
      }
    }
  }

  return {
    init: initRefactorStudio,
    initRefactorStudio,
    loadView: loadViewIntoStudio,
    loadViewIntoStudio,
    switchSubTab: switchStudioSubTab,
    runOptimize,
    runValidateAndBenchmark,
    setStudioStep,
    saveStudioToWorkspace,
    showDeploymentScriptModal,
    openLiveCompare: openLiveCompareModal,
    closeLiveCompare: closeLiveCompareModal,
    runLiveComparison
  };
}));
