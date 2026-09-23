/**
 * SQL Server Refactoring & Performance Studio
 * Overview Page Redesign & Guardrails Test Suite (Desktop Database Tool Direction)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Overview Redesign & UX Guardrails Test Suite', () => {

  // =========================================================================
  // 1. Safe Health & Risk Extraction (Guards against [object Object])
  // =========================================================================
  describe('Safe Data Extraction & Serialization Guardrails', () => {
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

    it('extracts numeric health score from object correctly without [object Object]', () => {
      const viewWithObjectHealth = {
        name: 'AA_TEST_VIEW',
        health: { score: 87, band: 'B' },
        healthScore: { score: 87, band: 'B' }
      };
      const score = getSafeHealthScore(viewWithObjectHealth);
      assert.strictEqual(score, 87);
      assert.strictEqual(typeof score, 'number');
      assert.doesNotMatch(String(score), /\[object Object\]/);
    });

    it('extracts primitive number health score correctly', () => {
      const viewWithNumberHealth = {
        name: 'AA_TEST_VIEW_2',
        healthScore: 92
      };
      assert.strictEqual(getSafeHealthScore(viewWithNumberHealth), 92);
    });

    it('extracts numeric risk score from object correctly', () => {
      const viewWithObjectRisk = {
        name: 'AA_TEST_VIEW_3',
        riskScore: { score: 88, level: 'CRITICAL' }
      };
      assert.strictEqual(getSafeRiskScore(viewWithObjectRisk), 88);
    });

    it('determines risk category safely without throwing', () => {
      assert.strictEqual(getSafeRiskCategory({ riskCategory: 'CRITICAL' }), 'critical');
      assert.strictEqual(getSafeRiskCategory({ riskScore: 75 }), 'critical');
      assert.strictEqual(getSafeRiskCategory({ riskScore: 50 }), 'high');
      assert.strictEqual(getSafeRiskCategory({ riskScore: 30 }), 'medium');
      assert.strictEqual(getSafeRiskCategory({ riskScore: 10 }), 'low');
      assert.strictEqual(getSafeRiskCategory(null), 'low');
    });
  });

  // =========================================================================
  // 2. Deterministic Primary Finding Priority
  // =========================================================================
  describe('Deterministic Primary Finding Extraction', () => {
    function getPrimaryFinding(v) {
      if (!v) return { title: 'Standart İnceleme', detail: 'Kural ihlali tespit edilmedi', severity: 'low' };

      // 1. Active critical regression (Priority 1)
      if (v.runtime?.regression?.isRegressed || v.isRegressed) {
        const regInfo = v.runtime?.regression;
        const ratioStr = regInfo?.ratio ? ` (${regInfo.ratio})` : '';
        return {
          title: 'Performans Regresyonu',
          detail: regInfo?.reason || `Son 24 saatte süre anomalisi tespit edildi${ratioStr}`,
          severity: 'critical'
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
          return {
            title: top.title || top.name || 'Analiz Uyarısı',
            detail: top.detail || 'Sorgu planında performans riski tespit edildi.',
            severity: (top.severity || 'high').toLowerCase()
          };
        } else if (typeof top === 'string') {
          return {
            title: top,
            detail: 'Sorgu planında yapısal uyarı.',
            severity: 'high'
          };
        }
      }

      // 3. Repeated Base Table Access (Priority 3)
      if ((v.repeatedBaseTableCount || 0) > 0 || (v.repeatedBaseTables && v.repeatedBaseTables.length > 0)) {
        const count = v.repeatedBaseTableCount || v.repeatedBaseTables.length;
        return {
          title: 'Mükerrer Temel Tablo Erişimi',
          detail: `Temel tablolara ${count} farklı mantıksal yoldan mükerrer erişim`,
          severity: 'high'
        };
      }

      // 4. Heavy Logical Reads (Priority 4)
      if (v.reads && (v.reads.includes('M') || v.reads.includes('B'))) {
        return {
          title: 'Yüksek Mantıksal Okuma Baskısı',
          detail: `${v.reads} mantıksal okuma hacmi kaydedildi`,
          severity: 'high'
        };
      }

      // 5. Deep Dependency Hierarchy (Priority 5)
      if ((v.depth || 1) > 3) {
        return {
          title: 'Derin Bağımlılık Ağacı',
          detail: `${v.depth} seviyeli derin nesne bağımlılığı`,
          severity: 'medium'
        };
      }

      return {
        title: 'Normal Çalışma',
        detail: 'Kritik kural ihlali tespit edilmedi',
        severity: 'low'
      };
    }

    it('prioritizes active performance regression above other signals', () => {
      const view = {
        name: 'AA_REGRESSED_VIEW',
        isRegressed: true,
        runtime: { regression: { isRegressed: true, severity: 'KRİTİK', ratio: '+300%' } },
        repeatedBaseTableCount: 4,
        depth: 6
      };
      const finding = getPrimaryFinding(view);
      assert.strictEqual(finding.title, 'Performans Regresyonu');
      assert.strictEqual(finding.severity, 'critical');
    });

    it('prioritizes critical static problems when regression is absent', () => {
      const view = {
        name: 'AA_PROBLEM_VIEW',
        problems: [
          { title: 'Mükerrer Temel Tablo Erişimi', severity: 'CRITICAL', detail: '4 koldan erişim' }
        ],
        depth: 5
      };
      const finding = getPrimaryFinding(view);
      assert.strictEqual(finding.title, 'Mükerrer Temel Tablo Erişimi');
      assert.strictEqual(finding.severity, 'critical');
    });

    it('identifies heavy logical read pressure', () => {
      const view = {
        name: 'AA_HEAVY_READ_VIEW',
        reads: '169.4M',
        depth: 2
      };
      const finding = getPrimaryFinding(view);
      assert.strictEqual(finding.title, 'Yüksek Mantıksal Okuma Baskısı');
      assert.strictEqual(finding.severity, 'high');
    });

    it('identifies deep dependency hierarchies', () => {
      const view = {
        name: 'AA_DEEP_VIEW',
        depth: 6
      };
      const finding = getPrimaryFinding(view);
      assert.strictEqual(finding.title, 'Derin Bağımlılık Ağacı');
      assert.strictEqual(finding.severity, 'medium');
    });
  });

  // =========================================================================
  // 3. Desktop Database Tool DOM Structure & Invariants
  // =========================================================================
  describe('Desktop Database Tool DOM Structure & Layout Invariants', () => {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    it('contains single horizontal compact status strip with all 6 indicators and DB health', () => {
      assert.ok(html.includes('class="overview-status-strip"'), 'Missing overview-status-strip');
      assert.ok(html.includes('id="stripTotalViews"'), 'Missing stripTotalViews');
      assert.ok(html.includes('id="metricCritical"'), 'Missing metricCritical');
      assert.ok(html.includes('id="metricRegressions"'), 'Missing metricRegressions');
      assert.ok(html.includes('id="metricIndexAdvisorCount"'), 'Missing metricIndexAdvisorCount');
      assert.ok(html.includes('id="metricStatsHealthCount"'), 'Missing metricStatsHealthCount');
      assert.ok(html.includes('id="metricDuplicates"'), 'Missing metricDuplicates');
      assert.ok(html.includes('id="overviewDbHealth"'), 'Missing overviewDbHealth');
      assert.ok(html.includes('id="overviewHealthStatus"'), 'Missing overviewHealthStatus');
    });

    it('does NOT contain marketing hero banner or oversized gauge circles in overview', () => {
      const overviewMatch = html.match(/<section class="page active" id="page-overview">([\s\S]*?)<\/section>/);
      assert.ok(overviewMatch, 'page-overview section not found');
      const overviewContent = overviewMatch[1];
      assert.ok(!overviewContent.includes('hero-headline'), 'hero-headline should be removed');
      assert.ok(!overviewContent.includes('orbitTrackValue'), 'orbit svg gauge should be replaced with compact health');
    });

    it('contains Dense DB Table with accurate headers and tbody hook', () => {
      assert.ok(html.includes('class="dense-db-table"'), 'Missing dense-db-table');
      assert.ok(html.includes('id="overviewRiskTableBody"'), 'Missing overviewRiskTableBody');
      assert.ok(html.includes('id="overviewSortSegmented"'), 'Missing overviewSortSegmented');
    });

    it('contains Dense Table Pressure list and Important Findings feed', () => {
      assert.ok(html.includes('id="pressureList"'), 'Missing pressureList');
      assert.ok(html.includes('id="overviewFeed"'), 'Missing overviewFeed');
      assert.ok(html.includes('id="btnViewAllPressures"'), 'Missing btnViewAllPressures');
      assert.ok(html.includes('id="refreshFeedBtn"'), 'Missing refreshFeedBtn');
    });

    it('contains compact Query Store / Plan Cache timeseries strip', () => {
      assert.ok(html.includes('id="overviewChartWrap"'), 'Missing overviewChartWrap');
      assert.ok(html.includes('id="overviewRegressionPill"'), 'Missing overviewRegressionPill');
    });
  });
});
