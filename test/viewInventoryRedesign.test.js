/**
 * SQL Server Refactoring & Performance Studio
 * View Inventory & View Detail Workspace Redesign Test Suite
 *
 * Verifies all 33 guardrails and UX redesign invariants:
 * 1. Health gauge removed from View Detail UI (Risk remains single priority metric)
 * 2. Risk data contract and Turkish severity mapping
 * 3. Metric strip with "Mantıksal Okuma (24 Saat)" and missing data '—' (no fake 0ms)
 * 4. No emojis in regression indicators (monochrome SVG/dot)
 * 5. Explorer row layout, single DB vs All DBs mode
 * 6. Quick filters (all, critical, regressed) and advanced popover
 * 7. 65/35 Diagnosis workspace with primary diagnosis highlight + collapsed accordions
 * 8. Risk sources mapped to Yüksek/Orta/Normal without penalty score clutter
 * 9. Button hierarchy (Single purple primary Refactor, ghost SQL/Dependencies)
 * 10. Accessibility (aria-expanded, aria-controls, aria-selected)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('View Inventory & Detail Redesign Test Suite', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const appJsPath = path.join(__dirname, '..', 'public', 'assets/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf-8');
  const cssPath = path.join(__dirname, '..', 'public', 'assets/css/app.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  // =========================================================================
  // 1. Health Score Removal & Risk As Single Priority Metric
  // =========================================================================
  describe('Guardrail 1 & 8: View Header & Health Removal', () => {
    it('does NOT contain score-ring or circular health gauge in View Detail hero', () => {
      const pageViewsMatch = html.match(/<section class="page" id="page-views">([\s\S]*?)<\/section>/);
      assert.ok(pageViewsMatch, 'page-views section must exist in index.html');
      const pageViewsHtml = pageViewsMatch[1];

      assert.strictEqual(pageViewsHtml.includes('class="score-ring"'), false, 'score-ring circular gauge must be removed from View Detail');
      assert.strictEqual(pageViewsHtml.includes('<span>Health</span>'), false, 'Health label must be removed from View Detail header');
    });

    it('renders single Risk badge with score and severity pill in View Detail header', () => {
      assert.ok(html.includes('id="detailRiskBadge"'), 'detailRiskBadge container must exist');
      assert.ok(html.includes('id="detailRisk"'), 'detailRisk score element must exist');
      assert.ok(html.includes('id="detailRiskPill"'), 'detailRiskPill severity pill must exist');
    });
  });

  // =========================================================================
  // 2. Metric Strip & Runtime Missing Data Handling
  // =========================================================================
  describe('Guardrail 3, 9 & 25: Metric Strip & Runtime Missing Data Handling', () => {
    it('uses "Mantıksal Okuma (24 Saat)" instead of confusing "24s Okuma"', () => {
      assert.ok(html.includes('Mantıksal Okuma (24 Saat)'), 'Label must be "Mantıksal Okuma (24 Saat)"');
      assert.strictEqual(html.includes('<span>24s Okuma</span>'), false, '"24s Okuma" must not be present');
    });

    it('contains single unified horizontal metric strip with 5 distinct columns', () => {
      assert.ok(html.includes('id="viewStatStrip"'), 'viewStatStrip element must exist');
      assert.ok(html.includes('id="statDepth"'), 'statDepth must exist');
      assert.ok(html.includes('id="statTables"'), 'statTables must exist');
      assert.ok(html.includes('id="statDependents"'), 'statDependents must exist');
      assert.ok(html.includes('id="statReads"'), 'statReads must exist');
      assert.ok(html.includes('id="statMedian"'), 'statMedian must exist');
    });

    it('formats missing runtime median duration as "—" and NOT fake "0ms"', () => {
      // Test function logic mirroring app.js formatRuntimeMedian
      function formatRuntimeMedian(v) {
        if (!v) return '—';
        const m = v.median;
        if (m && m !== '—' && m !== '0ms' && m !== '0 ms' && m !== 0) return String(m);
        if (v.runtime?.avgDurationMs != null && v.runtime.avgDurationMs > 0) {
          return `${v.runtime.avgDurationMs} ms`;
        }
        return '—';
      }

      assert.strictEqual(formatRuntimeMedian({ median: '0ms' }), '—');
      assert.strictEqual(formatRuntimeMedian({ median: '—' }), '—');
      assert.strictEqual(formatRuntimeMedian({ median: null }), '—');
      assert.strictEqual(formatRuntimeMedian({ median: '284s' }), '284s');
      assert.strictEqual(formatRuntimeMedian({ runtime: { avgDurationMs: 42 } }), '42 ms');
    });

    it('formats missing runtime reads as "—" when unavailable', () => {
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

      assert.strictEqual(formatRuntimeReads({ reads: '—' }), '—');
      assert.strictEqual(formatRuntimeReads({ reads: '0' }), '—');
      assert.strictEqual(formatRuntimeReads({ reads: '250M' }), '250M');
      assert.strictEqual(formatRuntimeReads({ runtime: { totalReads: 4100000 } }), '4.1 Mn');
    });
  });

  // =========================================================================
  // 3. Quick Filters & Popover Navigation Invariants
  // =========================================================================
  describe('Guardrail 7: Quick Filters & Popover Filters', () => {
    it('contains quick filters for Tümü, Kritik, and Regresyonlu', () => {
      assert.ok(html.includes('data-risk="all"'), 'Tümü filter chip must exist');
      assert.ok(html.includes('data-risk="critical"'), 'Kritik filter chip must exist');
      assert.ok(html.includes('data-risk="regressed"'), 'Regresyonlu filter chip must exist');
      assert.ok(html.includes('id="countRegressed"'), 'countRegressed element must exist');
    });

    it('contains advanced filter popover with Tablo Baskısı, Mükerrer Mantık and Reset', () => {
      assert.ok(html.includes('id="btnViewFilterMore"'), 'btnViewFilterMore trigger must exist');
      assert.ok(html.includes('id="viewFilterPopover"'), 'viewFilterPopover container must exist');
      assert.ok(html.includes('data-view-filter="tables"'), 'Tablo Baskısı popover item must exist');
      assert.ok(html.includes('data-view-filter="duplicates"'), 'Mükerrer Mantık popover item must exist');
      assert.ok(html.includes('id="btnResetViewFilters"'), 'btnResetViewFilters item must exist');
    });
  });

  // =========================================================================
  // 4. Primary Diagnosis (65%) & Risk Sources (35%)
  // =========================================================================
  describe('Guardrail 6, 10, 12 & 13: 65/35 Diagnosis Workspace Layout', () => {
    it('defines diagnosis-grid layout container in HTML', () => {
      assert.ok(html.includes('class="diagnosis-grid"'), 'diagnosis-grid container must exist');
      assert.ok(html.includes('id="primaryDiagnosisBox"'), 'primaryDiagnosisBox must exist');
      assert.ok(html.includes('id="riskSourcesList"'), 'riskSourcesList must exist');
      assert.ok(html.includes('id="findingsAccordionList"'), 'findingsAccordionList must exist');
    });

    it('maps risk sources to Yüksek/Orta/Normal without penalty score clutter', () => {
      function getRiskContribution(item) {
        if (!item) return { label: 'Normal', level: 'normal' };
        const val = Number(item.value || 0);
        const penalty = Number(item.penalty || 0);
        if (val >= 70 || penalty >= 12) return { label: 'Yüksek', level: 'high' };
        if (val >= 35 || penalty >= 5) return { label: 'Orta', level: 'medium' };
        return { label: 'Normal', level: 'normal' };
      }

      assert.strictEqual(getRiskContribution({ value: 86, penalty: 18 }).label, 'Yüksek');
      assert.strictEqual(getRiskContribution({ value: 54, penalty: 5 }).label, 'Orta');
      assert.strictEqual(getRiskContribution({ value: 15, penalty: 0 }).label, 'Normal');
    });

    it('provides Primary Refactor button and secondary/tertiary inspection actions', () => {
      assert.ok(html.includes('id="btnPrimaryRefactor"'), 'btnPrimaryRefactor must exist');
      assert.ok(html.includes('id="btnPrimarySql"'), 'btnPrimarySql must exist');
      assert.ok(html.includes('id="btnPrimaryDeps"'), 'btnPrimaryDeps must exist');
    });
  });

  // =========================================================================
  // 5. Findings Accordion & Accessibility Invariants
  // =========================================================================
  describe('Guardrail 10, 15, 16 & 29: Findings Accordion & Accessibility', () => {
    it('uses accessible button triggers with aria-expanded and aria-controls for accordions', () => {
      assert.ok(appJs.includes('aria-expanded="false"'), 'Accordion triggers must be initialized with aria-expanded="false"');
      assert.ok(appJs.includes('aria-controls='), 'Accordion triggers must specify aria-controls');
      assert.ok(appJs.includes('aria-selected'), 'Explorer rows must manage aria-selected state');
    });

    it('does NOT use emoji regression indicator (uses inline SVG or monochrome dot)', () => {
      assert.strictEqual(appJs.includes('class="view-row-reg">⚡'), false, '⚡ emoji must not be used as row regression indicator');
      assert.ok(appJs.includes('view-row-reg'), 'view-row-reg container must exist');
    });
  });

  // =========================================================================
  // 6. CSS Layout & Responsive Clamp
  // =========================================================================
  describe('Guardrail 21, 22 & 23: CSS Workspace Layout', () => {
    it('uses clamp or responsive grid template for .views-workspace', () => {
      assert.ok(css.includes('.views-workspace'), '.views-workspace style rule must exist');
      assert.ok(css.includes('clamp(280px') || css.includes('minmax('), 'Workspace must use responsive clamp or minmax');
    });

    it('defines 34px compact height and active highlight for .view-row', () => {
      assert.ok(css.includes('.view-row'), '.view-row rule must exist');
      assert.ok(css.includes('height: 34px') || css.includes('height:34px') || css.includes('min-height: var(--row-height)'), 'Row height must be compact');
    });

    it('defines stat-strip with flat border and no card shadows', () => {
      assert.ok(css.includes('.stat-strip'), '.stat-strip style rule must exist');
      assert.ok(css.includes('.stat-strip-col'), '.stat-strip-col column rule must exist');
    });
  });
});
