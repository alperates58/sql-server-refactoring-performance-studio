/**
 * SQL Server Refactoring & Performance Studio
 * Sprint 8: Product UX, Formatters, UI States, Settings & Release Readiness Tests
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Target Modules
const StudioFormatters = require('../public/assets/js/modules/formatters');
const StudioUiStates = require('../public/assets/js/modules/uiStates');
const settingsService = require('../server/services/settingsService');
const { redactSensitiveSql, hasSensitiveKeywords } = require('../server/services/workspaceStorage');
const { validateReadOnly } = require('../server/services/sqlValidator');
const pkg = require('../package.json');

describe('Sprint 8 & 8.1: Product UX Polish & Release Candidate Test Suite', () => {

  // =========================================================================
  // 1. FORMATTERS (Turkish Locale & Ergonomic Units)
  // =========================================================================
  describe('StudioFormatters - Number & Unit Standards', () => {
    it('formatNumber formats integers with thousands separators', () => {
      assert.strictEqual(StudioFormatters.formatNumber(1234567), '1.234.567');
      assert.strictEqual(StudioFormatters.formatNumber(42), '42');
      assert.strictEqual(StudioFormatters.formatNumber(0), '0');
    });

    it('formatNumber handles decimal digits and precision', () => {
      const formatted = StudioFormatters.formatNumber(1234.5678, 2);
      assert.strictEqual(formatted, '1.234,57');
    });

    it('formatCompactNumber compresses large values with Turkish multipliers', () => {
      assert.strictEqual(StudioFormatters.formatCompactNumber(450), '450');
      assert.strictEqual(StudioFormatters.formatCompactNumber(12400), '12,4 B');
      assert.strictEqual(StudioFormatters.formatCompactNumber(1850000), '1,9 Mn');
      assert.strictEqual(StudioFormatters.formatCompactNumber(4100000000), '4,1 Mr');
      assert.strictEqual(StudioFormatters.formatCompactNumber(null), '0');
    });

    it('formatDuration formats execution times ergonomically', () => {
      assert.strictEqual(StudioFormatters.formatDuration(0), '< 1 ms');
      assert.strictEqual(StudioFormatters.formatDuration(0.4), '< 1 ms');
      assert.strictEqual(StudioFormatters.formatDuration(420), '420 ms');
      assert.strictEqual(StudioFormatters.formatDuration(2340), '2,34 sn');
      assert.strictEqual(StudioFormatters.formatDuration(135000), '2 dk 15 sn');
      assert.strictEqual(StudioFormatters.formatDuration(3660000), '1 sa 1 dk');
      assert.strictEqual(StudioFormatters.formatDuration(-1), '0 ms');
    });

    it('formatBytes converts bytes into human-readable computer storage units', () => {
      assert.strictEqual(StudioFormatters.formatBytes(0), '0 B');
      assert.strictEqual(StudioFormatters.formatBytes(1024), '1 KB');
      assert.strictEqual(StudioFormatters.formatBytes(1048576), '1 MB');
      assert.strictEqual(StudioFormatters.formatBytes(1073741824), '1 GB');
      assert.strictEqual(StudioFormatters.formatBytes(5242880), '5 MB');
    });

    it('formatDate formats ISO dates and timestamps into tr-TR standard', () => {
      const d = new Date(2026, 8, 11, 14, 30, 0); // 11 Sep 2026
      const str = StudioFormatters.formatDate(d, false);
      assert.ok(str.includes('11.09.2026') || str.includes('11/09/2026'));
      assert.strictEqual(StudioFormatters.formatDate(null), '-');
    });

    it('formatRelativeTime produces natural Turkish elapsed time strings', () => {
      const now = Date.now();
      assert.strictEqual(StudioFormatters.formatRelativeTime(now - 10000), 'az önce');
      assert.strictEqual(StudioFormatters.formatRelativeTime(now - 180000), '3 dk önce');
      assert.strictEqual(StudioFormatters.formatRelativeTime(now - 7200000), '2 saat önce');
      assert.strictEqual(StudioFormatters.formatRelativeTime(now - 172800000), '2 gün önce');
      assert.strictEqual(StudioFormatters.formatRelativeTime(null), '-');
    });
  });

  // =========================================================================
  // 2. UI STATES & BADGES
  // =========================================================================
  describe('StudioUiStates - Badges, Empty, Loading, and Error State Generators', () => {
    it('renderSeverityBadge outputs consistent semantic classes and labels', () => {
      const crit = StudioUiStates.renderSeverityBadge('CRITICAL');
      assert.ok(crit.includes('severity-pill critical'));
      assert.ok(crit.includes('KRİTİK'));

      const high = StudioUiStates.renderSeverityBadge('high');
      assert.ok(high.includes('severity-pill high'));
      assert.ok(high.includes('YÜKSEK'));

      const unknown = StudioUiStates.renderSeverityBadge('xyz');
      assert.ok(unknown.includes('severity-pill low'));
    });

    it('renderStatusBadge renders validation status badges correctly', () => {
      const passBadge = StudioUiStates.renderStatusBadge('PASS');
      assert.ok(passBadge.includes('badge-status-pass'));
      assert.ok(passBadge.includes('BAŞARILI'));

      const warnBadge = StudioUiStates.renderStatusBadge('PASS_WITH_WARNING');
      assert.ok(warnBadge.includes('badge-status-warning'));
      assert.ok(warnBadge.includes('UYARI'));

      const failBadge = StudioUiStates.renderStatusBadge('FAIL');
      assert.ok(failBadge.includes('badge-status-fail'));
      assert.ok(failBadge.includes('BAŞARISIZ'));
    });

    it('renderStatusBadge renders workspace lifecycle badges correctly', () => {
      const draft = StudioUiStates.renderStatusBadge('DRAFT');
      assert.ok(draft.includes('TASLAK'));

      const approved = StudioUiStates.renderStatusBadge('APPROVED');
      assert.ok(approved.includes('ONAYLANDI'));

      const rejected = StudioUiStates.renderStatusBadge('REJECTED');
      assert.ok(rejected.includes('REDDEDİLDİ'));
    });

    it('renderEmptyState produces structured empty state container with icon and action', () => {
      const html = StudioUiStates.renderEmptyState({
        title: 'Sonuç Bulunamadı',
        description: 'Arama kriterlerinize uyan kayıt yok.',
        actionText: 'Filtreleri Temizle',
        actionId: 'btnResetFilter',
        icon: '🔍'
      });
      assert.ok(html.includes('studio-empty-state'));
      assert.ok(html.includes('Sonuç Bulunamadı'));
      assert.ok(html.includes('Arama kriterlerinize uyan kayıt yok.'));
      assert.ok(html.includes('btnResetFilter'));
      assert.ok(html.includes('🔍'));
    });

    it('renderLoadingState produces accessible skeleton animation container', () => {
      const html = StudioUiStates.renderLoadingState({ text: 'Kataloglar Taranıyor...', rows: 3 });
      assert.ok(html.includes('studio-loading-state'));
      assert.ok(html.includes('Kataloglar Taranıyor...'));
      assert.ok(html.includes('studio-loading-spinner'));
      assert.strictEqual((html.match(/studio-skeleton-bar/g) || []).length, 3);
    });

    it('renderErrorState renders alert card with optional collapsible details and action', () => {
      const html = StudioUiStates.renderErrorState({
        title: 'Bağlantı Hatası',
        message: 'SQL Server zaman aşımına uğradı.',
        technicalDetails: 'ETIMEDOUT at TCPConnectWrap.afterConnect',
        retryId: 'btnRetryConn',
        retryText: 'Yeniden Dene'
      });
      assert.ok(html.includes('studio-error-state'));
      assert.ok(html.includes('Bağlantı Hatası'));
      assert.ok(html.includes('SQL Server zaman aşımına uğradı.'));
      assert.ok(html.includes('ETIMEDOUT'));
      assert.ok(html.includes('btnRetryConn'));
    });

    it('TERMINOLOGY dictionary maintains defined SQL Server concepts', () => {
      assert.ok(StudioUiStates.TERMINOLOGY.CTE.title.includes('Common Table Expression'));
      assert.ok(StudioUiStates.TERMINOLOGY.SARGABLE.title.includes('SARGable'));
      assert.ok(StudioUiStates.TERMINOLOGY.LOGICAL_READS.description.includes('8 KB'));
      assert.ok(StudioUiStates.TERMINOLOGY.QUERY_STORE.title.includes('Query Store'));
      assert.ok(StudioUiStates.TERMINOLOGY.WORKSPACES.title.includes('Refactor Çalışma Alanı'));
    });
  });

  // =========================================================================
  // 3. SETTINGS SERVICE & WORKBENCH CONFIGURATION
  // =========================================================================
  describe('SettingsService - Workbench Bounds & Diagnostics Export', () => {
    it('clamps workbench maxRows within valid range [100, 50000]', () => {
      const lowResult = settingsService.saveWorkbenchConfig({ maxRows: 10 });
      assert.strictEqual(lowResult.workbench.maxRows, 100);

      const highResult = settingsService.saveWorkbenchConfig({ maxRows: 1000000 });
      assert.strictEqual(highResult.workbench.maxRows, 50000);

      const validResult = settingsService.saveWorkbenchConfig({ maxRows: 5000 });
      assert.strictEqual(validResult.workbench.maxRows, 5000);
    });

    it('clamps workbench historyRetention within valid range [1000, 50000]', () => {
      const lowRetention = settingsService.saveWorkbenchConfig({ historyRetention: 200 });
      assert.strictEqual(lowRetention.workbench.historyRetention, 1000);

      const highRetention = settingsService.saveWorkbenchConfig({ historyRetention: 999999 });
      assert.strictEqual(highRetention.workbench.historyRetention, 50000);

      const normalRetention = settingsService.saveWorkbenchConfig({ historyRetention: 15000 });
      assert.strictEqual(normalRetention.workbench.historyRetention, 15000);
    });

    it('validates and applies wordWrap and minimap preferences', () => {
      const res1 = settingsService.saveWorkbenchConfig({ minimap: false, wordWrap: 'on' });
      assert.strictEqual(res1.workbench.minimap, false);
      assert.strictEqual(res1.workbench.wordWrap, 'on');

      const res2 = settingsService.saveWorkbenchConfig({ wordWrap: 'invalid_mode' });
      assert.strictEqual(res2.workbench.wordWrap, 'off');
    });

    it('exportDiagnostics returns comprehensive system overview with zero secret leakage', () => {
      const diag = settingsService.exportDiagnostics({
        testContext: 'Release Readiness Verification',
        capabilities: {
          productVersion: '16.0.4135.4',
          edition: 'Enterprise Edition',
          queryStore: { active: true }
        }
      });

      assert.ok(diag.exportTimestamp);
      assert.strictEqual(diag.app.name, 'SQL Server Refactoring & Performance Studio');
      assert.strictEqual(diag.app.version, '0.8.0-beta');
      assert.strictEqual(diag.app.mode, 'READ ONLY (ZERO MUTATION)');

      // System sanity
      assert.ok(diag.system.nodeVersion);
      assert.ok(diag.system.platform);
      assert.ok(diag.system.memory);
      assert.ok(diag.system.uptimeSeconds >= 0);

      // Security verification: Absolute zero plaintext secrets
      const jsonStr = JSON.stringify(diag);
      assert.strictEqual(jsonStr.includes('dbPassword'), false, 'dbPassword MUST NOT be present in diagnostics export');
      assert.strictEqual(jsonStr.includes('apiKey:'), false, 'Plaintext apiKey MUST NOT be present in diagnostics export');
      assert.strictEqual(diag.settingsSummary.ai.hasApiKey !== undefined, true);
      assert.strictEqual(diag.settingsSummary.database.password, undefined);
    });
  });

  // =========================================================================
  // 4. NAVIGATION, DOM & INFORMATION ARCHITECTURE INTEGRITY
  // =========================================================================
  describe('Information Architecture & Navigation Integrity', () => {
    const htmlPath = path.join(__dirname, '../public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    it('index.html defines all required collapsible navigation groups', () => {
      const requiredGroups = ['genel', 'analiz', 'optimizasyon', 'araclar', 'sistem'];
      requiredGroups.forEach(group => {
        assert.ok(
          htmlContent.includes(`data-group="${group}"`),
          `Sidebar missing required nav group: ${group}`
        );
      });
    });

    it('index.html contains breadcrumbs, global connection badges and shortcut modal', () => {
      assert.ok(htmlContent.includes('id="topbarBreadcrumbs"'), 'Missing topbar breadcrumbs element');
      assert.ok(htmlContent.includes('id="globalConnectionBadge"'), 'Missing global connection badge');
      assert.ok(htmlContent.includes('id="globalReadOnlyBadge"'), 'Missing global read-only badge');
      assert.ok(htmlContent.includes('id="keyboardShortcutsModal"'), 'Missing keyboard shortcuts modal');
      assert.ok(htmlContent.includes('id="onboardingWizardModal"'), 'Missing onboarding wizard modal');
      assert.ok(htmlContent.includes('id="scanProgressModal"'), 'Missing scan progress modal');
    });

    it('all registered pages exist as actual section elements in index.html', () => {
      const pages = [
        'overview', 'views', 'graph', 'runtime', 'refactor',
        'validation', 'workbench', 'tables', 'duplicates',
        'settings', 'activity', 'indexes', 'workspaces'
      ];
      pages.forEach(p => {
        assert.ok(
          htmlContent.includes(`id="page-${p}"`),
          `Section element for page "${p}" is missing in index.html`
        );
      });
    });

    it('settings page contains all 8 required tabs', () => {
      const tabs = ['connection', 'ai', 'scoring', 'runtime', 'workbench', 'safety', 'appearance', 'diagnostics'];
      tabs.forEach(tab => {
        assert.ok(
          htmlContent.includes(`data-settings-tab="${tab}"`),
          `Settings tab button for "${tab}" is missing in index.html`
        );
        assert.ok(
          htmlContent.includes(`id="settings-panel-${tab}"`),
          `Settings panel container for "${tab}" is missing in index.html`
        );
      });
    });
  });

  // =========================================================================
  // 5. SPRINT 8.1 - RELEASE CANDIDATE VERIFICATION & HONEST PROGRESS
  // =========================================================================
  describe('Sprint 8.1 - Release Candidate Verification & Honest Progress', () => {
    const htmlPath = path.join(__dirname, '../public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const appJsPath = path.join(__dirname, '../public/assets/js/app.js');
    const appJsContent = fs.readFileSync(appJsPath, 'utf8');

    it('single source of truth for version matches 0.8.0-beta', () => {
      assert.strictEqual(pkg.version, '0.8.0-beta');
      const diag = settingsService.exportDiagnostics();
      assert.strictEqual(diag.app.version, pkg.version);
    });

    it('redactSensitiveSql scrubs passwords, API keys and secrets from query text', () => {
      const sql1 = "SELECT * FROM Users WHERE password = 'mySecretPassword123' AND active = 1;";
      assert.strictEqual(
        redactSensitiveSql(sql1),
        "SELECT * FROM Users WHERE password = '***REDACTED***' AND active = 1;"
      );

      const sql2 = "EXEC sp_configure 'pwd', 'SuperSecretPass';";
      assert.strictEqual(
        redactSensitiveSql(sql2),
        "EXEC sp_configure 'pwd', '***REDACTED***';"
      );

      const sql3 = "SELECT * FROM ExternalApi WHERE Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      assert.strictEqual(
        redactSensitiveSql(sql3),
        "SELECT * FROM ExternalApi WHERE Bearer ***REDACTED***"
      );

      const sql4 = "SET @key = 'apiKey = secret_token_xyz';";
      assert.ok(redactSensitiveSql(sql4).includes('***REDACTED***'));
    });

    it('hasSensitiveKeywords correctly identifies sensitive credentials', () => {
      assert.strictEqual(hasSensitiveKeywords("SELECT * FROM dbo.T WHERE password = '123'"), true);
      assert.strictEqual(hasSensitiveKeywords("SELECT * FROM dbo.T WHERE pwd = 'abc'"), true);
      assert.strictEqual(hasSensitiveKeywords("SELECT * FROM dbo.T WHERE apiKey = 'key123'"), true);
      assert.strictEqual(hasSensitiveKeywords("SELECT * FROM dbo.T WHERE secret = 'val'"), true);
      assert.strictEqual(hasSensitiveKeywords("SELECT id, name FROM dbo.Users WHERE status = 1"), false);
    });

    it('scan progress modal has honest indeterminate progress bar and dismiss capability', () => {
      assert.ok(htmlContent.includes('id="scanProgressModal"'), 'Missing scanProgressModal');
      assert.ok(htmlContent.includes('class="scan-progress-track"'), 'Missing scan-progress-track');
      assert.ok(htmlContent.includes('class="scan-progress-indeterminate-bar"'), 'Missing scan-progress-indeterminate-bar');
      assert.ok(htmlContent.includes('id="btnDismissScanModal"'), 'Missing btnDismissScanModal dismiss button');
      assert.ok(htmlContent.includes('id="closeScanProgressModal"'), 'Missing closeScanProgressModal close button');
      
      const modalStart = htmlContent.indexOf('id="scanProgressModal"');
      const modalEnd = htmlContent.indexOf('<!-- ONBOARDING WIZARD', modalStart);
      const modalChunk = htmlContent.substring(modalStart, modalEnd !== -1 ? modalEnd : modalStart + 1500);
      assert.strictEqual(modalChunk.includes('25%'), false, 'Scan modal must not contain hardcoded 25%');
      assert.strictEqual(modalChunk.includes('50%'), false, 'Scan modal must not contain hardcoded 50%');
      assert.strictEqual(modalChunk.includes('85%'), false, 'Scan modal must not contain hardcoded 85%');
    });

    it('all newly bound action buttons are registered and have click listeners in app.js', () => {
      const requiredButtons = [
        'refreshFeedBtn',
        'refreshInventoryBtn',
        'btnExportRegression',
        'btnWsCreateFromLiveDb',
        'btnWsIgnoreDrift',
        'btnWsAddCandidate',
        'btnWsCandOpenWb',
        'btnWsCandSendVal'
      ];
      requiredButtons.forEach(btnId => {
        assert.ok(
          htmlContent.includes(`id="${btnId}"`),
          `Button with ID "${btnId}" must exist in index.html`
        );
        assert.ok(
          appJsContent.includes(`'#${btnId}'`),
          `Button with ID "${btnId}" must have a handler in app.js`
        );
      });
    });

    it('sqlValidator strictly blocks all mutation statements (Zero Mutation invariant)', () => {
      const mutations = [
        "DROP TABLE Users;",
        "ALTER TABLE Orders ADD col INT;",
        "INSERT INTO AuditLog (msg) VALUES ('test');",
        "UPDATE Settings SET val = 1;",
        "DELETE FROM Sessions;",
        "TRUNCATE TABLE Cache;",
        "EXEC sp_executesql N'SELECT 1';",
        "XP_CMDSHELL 'dir';"
      ];
      mutations.forEach(sql => {
        const res = validateReadOnly(sql);
        assert.strictEqual(res.valid, false, `Mutation statement should have been blocked: ${sql}`);
      });

      const validQueries = [
        "SELECT 1 AS Test;",
        "SELECT * FROM sys.views WHERE name LIKE 'AA_%';",
        "WITH Cte AS (SELECT id, name FROM dbo.Users) SELECT * FROM Cte;"
      ];
      validQueries.forEach(sql => {
        const res = validateReadOnly(sql);
        assert.strictEqual(res.valid, true, `Valid read-only query was incorrectly blocked: ${sql}`);
      });
    });

    it('theme variables ensure WCAG contrast across dark and light modes', () => {
      const cssPath = path.join(__dirname, '../public/assets/css/app.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      assert.ok(cssContent.includes('[data-theme="dark"]'), 'Missing dark theme definition');
      assert.ok(cssContent.includes('[data-theme="light"]'), 'Missing light theme definition');
      assert.ok(cssContent.includes('--bg-canvas'), 'Missing --bg-canvas variable');
      assert.ok(cssContent.includes('--text-primary'), 'Missing --text-primary variable');
      assert.ok(cssContent.includes('--border-subtle'), 'Missing --border-subtle variable');
    });

    it('no secret persistence in localStorage, sessionStorage, or diagnostics exports', () => {
      assert.strictEqual(
        /localStorage\.setItem\s*\(\s*['"][^'"]*(?:password|token|secret|apiKey)[^'"]*['"]/i.test(appJsContent),
        false,
        'app.js must not store secrets in localStorage'
      );
      assert.strictEqual(
        /sessionStorage\.setItem\s*\(\s*['"][^'"]*(?:password|token|secret|apiKey)[^'"]*['"]/i.test(appJsContent),
        false,
        'app.js must not store secrets in sessionStorage'
      );
    });
  });

});

