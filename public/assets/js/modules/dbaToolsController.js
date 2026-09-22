/**
 * SQL Server Refactoring & Performance Studio
 * DBA Tools Controller (Sprint 9)
 *
 * Unifies:
 * 1. Index Advisor (Missing Indexes, Conflict Engine, DML Risk)
 * 2. Statistics Health (Stale Statistics, Modification Counters, Correlation)
 * 3. Live Activity & Blocking (sys.dm_exec_requests, Hierarchical Blocking Tree, Wait Stats)
 *
 * Single unified center with clean tab switching and graceful permission degradation.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.STUDIO_MODULES = root.STUDIO_MODULES || {};
    root.STUDIO_MODULES.dbaTools = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let activeTab = 'indexes'; // 'indexes' | 'stats' | 'activity'
  let activityPollingTimer = null;
  let inFlight = false;
  let appStateRef = null;
  let helpers = {};

  function initDbaTools(globalState, globalHelpers) {
    appStateRef = globalState;
    helpers = globalHelpers || {};
    bindEvents();
  }

  function bindEvents() {
    document.querySelectorAll('.dba-subtab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.dbaTab;
        if (tab) switchDbaTab(tab);
      });
    });

    const refreshBtn = document.getElementById('btnDbaRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => refreshActiveDbaTab());
    }
  }

  function switchDbaTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.dba-subtab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.dbaTab === tabName);
    });

    const paneIndexes = document.getElementById('dbaPaneIndexes');
    const paneStats = document.getElementById('dbaPaneStats');
    const paneActivity = document.getElementById('dbaPaneActivity');

    if (paneIndexes) paneIndexes.classList.toggle('hidden', tabName !== 'indexes');
    if (paneStats) paneStats.classList.toggle('hidden', tabName !== 'stats');
    if (paneActivity) paneActivity.classList.toggle('hidden', tabName !== 'activity');

    if (tabName === 'activity') {
      startActivityPolling();
      if (typeof helpers.loadActivityData === 'function') helpers.loadActivityData();
    } else {
      stopActivityPolling();
      if (typeof helpers.loadIndexesData === 'function') helpers.loadIndexesData();
    }
  }

  function refreshActiveDbaTab() {
    if (activeTab === 'activity') {
      if (typeof helpers.loadActivityData === 'function') helpers.loadActivityData(true);
    } else {
      if (typeof helpers.loadIndexesData === 'function') helpers.loadIndexesData(true);
    }
  }

  function startActivityPolling() {
    stopActivityPolling();
    const intervalSelect = document.getElementById('activityPollInterval');
    const intervalMs = intervalSelect ? parseInt(intervalSelect.value, 10) : 10000;
    if (intervalMs > 0) {
      activityPollingTimer = setInterval(() => {
        if (!document.hidden && activeTab === 'activity') {
          if (typeof helpers.loadActivityData === 'function') helpers.loadActivityData();
        }
      }, intervalMs);
    }
  }

  function stopActivityPolling() {
    if (activityPollingTimer) {
      clearInterval(activityPollingTimer);
      activityPollingTimer = null;
    }
  }

  return {
    init: initDbaTools,
    initDbaTools,
    switchTab: switchDbaTab,
    switchDbaTab,
    refresh: refreshActiveDbaTab,
    startActivityPolling,
    stopActivityPolling,
    getActiveTab: () => activeTab
  };
}));
