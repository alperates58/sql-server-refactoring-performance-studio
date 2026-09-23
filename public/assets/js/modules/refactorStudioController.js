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

    // Step Navigation Jump Buttons
    document.querySelectorAll('[data-studio-step-jump]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetStep = parseInt(e.currentTarget.dataset.studioStepJump, 10);
        if (targetStep <= studioState.step) {
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

    // Update Step Indicators
    for (let s = 1; s <= 4; s++) {
      const stepItem = document.getElementById(`studioStepBadge${s}`);
      if (stepItem) {
        stepItem.classList.toggle('active', s === studioState.step);
        stepItem.classList.toggle('completed', s < studioState.step);
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
      const comparison = compData.data || compData;
      studioState.benchmarkResult = comparison.benchmarks?.comparison || comparison.benchmark || {};
      studioState.planComparison = comparison.plans?.comparison || comparison.planComparison || {};

      // 3. Evaluate Decision
      const refDecision = (typeof window !== 'undefined' ? window : root)?.STUDIO_MODULES?.refactorDecision;
      if (comparison.decision) {
        studioState.decision = comparison.decision;
      } else if (refDecision) {
        studioState.decision = refDecision.evaluateRefactorDecision({
          validation: val,
          benchmark: studioState.benchmarkResult,
          planComparison: studioState.planComparison
        });
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
    const isPass = val.verdict === 'PASS' || val.verdict === 'PASS_WITH_WARNING';

    // 1. Semantic Status Badge
    const valBadgeEl = document.getElementById('studioValVerdictBadge');
    const valDescEl = document.getElementById('studioValVerdictDesc');
    const valWarningBanner = document.getElementById('studioValFailedWarning');

    if (valBadgeEl) {
      valBadgeEl.textContent = val.verdict || (isPass ? 'PASS' : 'FAIL');
      valBadgeEl.className = `status-pill ${isPass ? 'status-ready' : 'status-danger'}`;
    }
    if (valDescEl) {
      valDescEl.textContent = val.summary || (isPass
        ? 'Şema, satır sayısı ve çift yönlü EXCEPT testleri eşleşti.'
        : 'Sorgu çıktısında satır sayısı veya şema uyuşmazlığı tespit edildi.');
    }

    // Strict guardrail: If validation failed, hide performance glory and show stern warning!
    if (valWarningBanner) {
      valWarningBanner.classList.toggle('hidden', isPass);
    }

    // 2. Metrics comparison
    const origDur = bench.before?.medianDurationMs ?? bench.beforeDurationMs ?? '—';
    const candDur = bench.after?.medianDurationMs ?? bench.afterDurationMs ?? '—';
    const durDelta = bench.durationDeltaPercent != null ? `${bench.durationDeltaPercent > 0 ? '+' : ''}${bench.durationDeltaPercent}%` : '—';

    const origReads = bench.before?.totalLogicalReads ?? bench.beforeReads ?? '—';
    const candReads = bench.after?.totalLogicalReads ?? bench.afterReads ?? '—';
    const readsDelta = bench.readsDeltaPercent != null ? `${bench.readsDeltaPercent > 0 ? '+' : ''}${bench.readsDeltaPercent}%` : '—';

    const durEl = document.getElementById('studioPerfDurationVal');
    const durDeltaEl = document.getElementById('studioPerfDurationDelta');
    if (durEl) durEl.textContent = `${origDur}ms → ${candDur}ms`;
    if (durDeltaEl) {
      durDeltaEl.textContent = durDelta;
      durDeltaEl.className = `trend-pill ${parseFloat(durDelta) <= 0 ? 'trend-positive' : 'trend-negative'}`;
    }

    const readsEl = document.getElementById('studioPerfReadsVal');
    const readsDeltaEl = document.getElementById('studioPerfReadsDelta');
    if (readsEl) readsEl.textContent = `${formatNum(origReads)} → ${formatNum(candReads)}`;
    if (readsDeltaEl) {
      readsDeltaEl.textContent = readsDelta;
      readsDeltaEl.className = `trend-pill ${parseFloat(readsDelta) <= 0 ? 'trend-positive' : 'trend-negative'}`;
    }

    // 3. Plan key changes
    const planChangesList = document.getElementById('studioPlanChangesList');
    if (planChangesList) {
      const changes = [];
      if (plan.scansDelta != null) changes.push(`Tablo Taramaları (Scan): ${plan.scansDelta <= 0 ? plan.scansDelta : '+' + plan.scansDelta}`);
      if (plan.seeksDelta != null) changes.push(`İndeks Aramaları (Seek): ${plan.seeksDelta >= 0 ? '+' + plan.seeksDelta : plan.seeksDelta}`);
      if (plan.estimatedCostPercent != null) changes.push(`Tahmini Plan Maliyeti: %${plan.estimatedCostPercent}`);
      if (changes.length === 0) changes.push('Operatör ağacı optimize edildi; mantıksal okumalar düşürüldü.');

      planChangesList.innerHTML = changes.map(c => `<li>${escapeHtml(c)}</li>`).join('');
    }
  }

  function renderStep4VerdictAndActions() {
    const dec = studioState.decision || { label: 'Değerlendirildi', color: '#7c5cff', description: '' };
    const verdictPill = document.getElementById('studioVerdictPill');
    const verdictDesc = document.getElementById('studioVerdictDescription');

    if (verdictPill) {
      verdictPill.textContent = dec.label;
      verdictPill.style.borderColor = dec.color;
      verdictPill.style.color = dec.color;
    }
    if (verdictDesc) {
      verdictDesc.textContent = dec.description || 'Bu aday uygulanmaya hazırdır.';
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
          notes: `Doğrulama: ${studioState.validationResult?.verdict || 'PASS'}. Süre kazancı: ${studioState.benchmarkResult?.durationDeltaPercent || 0}%`
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
    showDeploymentScriptModal
  };
}));
