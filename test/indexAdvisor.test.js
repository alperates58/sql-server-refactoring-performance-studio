const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateBenefitScore,
  detectIndexConflicts,
  assessIndexWriteRisk,
  generateCreateIndexScript,
  getMissingIndexesFromPlan,
  DMV_DISCLAIMER
} = require('../server/services/indexAdvisor');

describe('Index Advisor Engine Tests (Sprint 5)', () => {
  describe('Benefit Score Calculation & Explainability', () => {
    it('returns score 0 and LOW grade when there are no user seeks or scans', () => {
      const res = calculateBenefitScore({
        userSeeks: 0,
        userScans: 0,
        avgTotalUserCost: 50,
        avgUserImpact: 80
      });
      assert.equal(res.benefitScore, 0);
      assert.equal(res.benefitGrade, 'LOW');
      assert.equal(res.rawBenefit, 0);
      assert.equal(res.factors.totalAccesses, 0);
    });

    it('calculates raw benefit and normalized score 0-100 accurately for moderate usage', () => {
      const res = calculateBenefitScore({
        userSeeks: 150,
        userScans: 10,
        avgTotalUserCost: 25.5,
        avgUserImpact: 75
      });
      // rawBenefit = 160 * 25.5 * 0.75 = 3060
      assert.equal(res.rawBenefit, 3060);
      assert.ok(res.benefitScore > 50 && res.benefitScore <= 80);
      assert.equal(res.benefitGrade, 'HIGH');
      assert.equal(res.formula, '(userSeeks + userScans) * avgTotalUserCost * (avgUserImpact / 100)');
      assert.ok(res.explanation.includes('160'));
    });

    it('assigns CRITICAL grade to high impact, high frequency queries', () => {
      const res = calculateBenefitScore({
        userSeeks: 5000,
        userScans: 200,
        avgTotalUserCost: 80,
        avgUserImpact: 95
      });
      // rawBenefit = 5200 * 80 * 0.95 = 395,200
      assert.ok(res.rawBenefit > 100000);
      assert.ok(res.benefitScore >= 80);
      assert.equal(res.benefitGrade, 'CRITICAL');
    });

    it('caps maximum normalized benefit score strictly at 100', () => {
      const res = calculateBenefitScore({
        userSeeks: 1000000,
        userScans: 500000,
        avgTotalUserCost: 9999,
        avgUserImpact: 99
      });
      assert.equal(res.benefitScore, 100);
      assert.equal(res.benefitGrade, 'CRITICAL');
    });

    it('safely handles null, undefined, or string inputs', () => {
      const res = calculateBenefitScore({
        userSeeks: '100',
        userScans: null,
        avgTotalUserCost: undefined,
        avgUserImpact: '50'
      });
      assert.equal(typeof res.benefitScore, 'number');
      assert.equal(res.rawBenefit, 0); // cost was undefined (0)
      assert.equal(res.benefitGrade, 'LOW');
    });

    it('strictly preserves sorting across synthetic dataset [0, 1, 10, 100, 1K, 10K, 100K, 1M] without sticking to 100', () => {
      const accessCounts = [0, 1, 10, 100, 1000, 10000, 100000, 1000000];
      const scores = accessCounts.map(count => {
        return calculateBenefitScore({
          userSeeks: count,
          userScans: 0,
          avgTotalUserCost: 10,
          avgUserImpact: 10
        }).benefitScore;
      });

      // Assert strictly monotonic increase
      for (let i = 0; i < scores.length - 1; i++) {
        assert.ok(scores[i] < scores[i + 1], `Score at index ${i} (${scores[i]}) should be < score at ${i+1} (${scores[i+1]})`);
      }

      // Assert 1M access does not prematurely clamp to 100
      assert.ok(scores[scores.length - 1] < 100, 'Score for 1M access should be < 100 to allow room for larger workloads');
      assert.ok(scores[scores.length - 1] >= 80, 'Score for 1M access should be in CRITICAL range (>= 80)');
    });
  });

  describe('Existing Index Conflict & Overlap Detection', () => {
    const existingIndexes = [
      {
        name: 'PK_STOKLAR',
        keyColumns: ['sto_kod'],
        includedColumns: [],
        isClustered: true
      },
      {
        name: 'IX_STOK_HAREKETLERI_KOD_TARIH',
        keyColumns: ['sth_stok_kod', 'sth_tarih'],
        includedColumns: ['sth_miktar', 'sth_tutar']
      },
      {
        name: 'IX_CARI_UNVAN',
        keyColumns: ['cari_unvan'],
        includedColumns: ['cari_kod', 'cari_bakiye']
      },
      {
        name: 'IX_DISABLED_TEST',
        keyColumns: ['dis_kod'],
        includedColumns: [],
        isDisabled: true
      }
    ];

    it('detects CLUSTERED_KEY_COVERAGE when candidate matches clustered index prefix', () => {
      const candidate = {
        keyColumns: ['sto_kod'],
        includedColumns: []
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'CLUSTERED_KEY_COVERAGE');
      assert.equal(res.matchedIndex, 'PK_STOKLAR');
      assert.ok(res.message.includes('Clustered'));
    });

    it('detects DISABLED_INDEX_OVERLAP when matching existing index is disabled', () => {
      const candidate = {
        keyColumns: ['dis_kod'],
        includedColumns: ['dis_detay']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'DISABLED_INDEX_OVERLAP');
      assert.equal(res.matchedIndex, 'IX_DISABLED_TEST');
      assert.ok(res.message.includes('devre dışı'));
    });

    it('detects INCLUDE_EXPANSION_CANDIDATE when candidate keys match existing prefix but lacks include columns', () => {
      const candidate = {
        keyColumns: ['sth_stok_kod', 'sth_tarih'],
        includedColumns: ['sth_miktar', 'sth_tutar', 'sth_yeni_kolon']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'INCLUDE_EXPANSION_CANDIDATE');
      assert.equal(res.matchedIndex, 'IX_STOK_HAREKETLERI_KOD_TARIH');
      assert.ok(res.message.includes('konsolide'));
    });

    it('detects DUPLICATE when candidate index matches existing keys and includes exactly', () => {
      const candidate = {
        keyColumns: ['sth_stok_kod', 'sth_tarih'],
        includedColumns: ['sth_miktar', 'sth_tutar']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'DUPLICATE');
      assert.equal(res.matchedIndex, 'IX_STOK_HAREKETLERI_KOD_TARIH');
      assert.ok(res.message.includes('birebir aynı'));
    });

    it('detects ALREADY_COVERED when existing index has candidate keys as prefix and covers all includes', () => {
      const candidate = {
        keyColumns: ['sth_stok_kod'],
        includedColumns: ['sth_tarih', 'sth_miktar']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'ALREADY_COVERED');
      assert.equal(res.matchedIndex, 'IX_STOK_HAREKETLERI_KOD_TARIH');
    });

    it('detects PARTIALLY_COVERED when 1st leading key matches but differs in secondary keys or includes', () => {
      const candidate = {
        keyColumns: ['sth_stok_kod', 'sth_depo_no'],
        includedColumns: ['sth_fiyat']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'PARTIALLY_COVERED');
      assert.equal(res.matchedIndex, 'IX_STOK_HAREKETLERI_KOD_TARIH');
      assert.ok(res.message.includes('konsolide'));
    });

    it('detects OVERLAPPING when candidate shares subset of columns', () => {
      const candidate = {
        keyColumns: ['sth_tarih', 'sth_stok_kod'], // Reverse order
        includedColumns: ['sth_aciklama']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'OVERLAPPING');
      assert.equal(res.matchedIndex, 'IX_STOK_HAREKETLERI_KOD_TARIH');
    });

    it('classifies as NEW_CANDIDATE when table has no matching or overlapping indexes', () => {
      const candidate = {
        keyColumns: ['sth_belge_no', 'sth_evrak_tipi'],
        includedColumns: ['sth_tutar']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'NEW_CANDIDATE');
      assert.equal(res.matchedIndex, null);
    });

    it('handles case-insensitivity and bracket formatting in column names', () => {
      const candidate = {
        keyColumns: ['[STH_STOK_KOD]', '[STH_TARIH]'],
        includedColumns: ['[STH_MIKTAR]', '[STH_TUTAR]']
      };
      const res = detectIndexConflicts(candidate, existingIndexes);
      assert.equal(res.status, 'DUPLICATE');
    });
  });

  describe('Index Write Overhead & Risk Assessment', () => {
    it('returns LOW risk when index has few keys, few includes, and table has few indexes', () => {
      const res = assessIndexWriteRisk({
        keyColumns: ['col1', 'col2'],
        includedColumns: ['col3'],
        existingIndexCount: 2
      });
      assert.equal(res.riskLevel, 'LOW');
      assert.equal(res.riskFactors.length, 0);
    });

    it('flags WIDE_KEYS when key column count exceeds 3', () => {
      const res = assessIndexWriteRisk({
        keyColumns: ['c1', 'c2', 'c3', 'c4'],
        includedColumns: [],
        existingIndexCount: 2
      });
      assert.equal(res.riskLevel, 'MEDIUM');
      const wideKeyWarn = res.riskFactors.find(r => r.code === 'WIDE_KEYS');
      assert.ok(wideKeyWarn);
      assert.ok(wideKeyWarn.text.includes('4 adet'));
    });

    it('flags WIDE_INCLUDES when include column count exceeds 5', () => {
      const res = assessIndexWriteRisk({
        keyColumns: ['c1'],
        includedColumns: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'],
        existingIndexCount: 1
      });
      assert.equal(res.riskLevel, 'MEDIUM');
      const wideIncWarn = res.riskFactors.find(r => r.code === 'WIDE_INCLUDES');
      assert.ok(wideIncWarn);
    });

    it('flags INDEX_SATURATION and assigns HIGH risk when table already has 5 or more indexes', () => {
      const res = assessIndexWriteRisk({
        keyColumns: ['c1', 'c2'],
        includedColumns: ['i1'],
        existingIndexCount: 7
      });
      assert.equal(res.riskLevel, 'HIGH');
      const satWarn = res.riskFactors.find(r => r.code === 'INDEX_SATURATION');
      assert.ok(satWarn);
      assert.ok(satWarn.text.includes('7 indeks'));
    });
  });

  describe('CREATE NONCLUSTERED INDEX Script Generation', () => {
    it('generates standard bracket-quoted nonclustered index script with includes', () => {
      const res = generateCreateIndexScript({
        schema: 'dbo',
        table: 'STOK_HAREKETLERI',
        keyColumns: ['sth_stok_kod', 'sth_tarih'],
        includedColumns: ['sth_miktar', 'sth_tutar']
      });

      assert.equal(res.isReadOnlySafe, true);
      assert.equal(res.autoExecuted, false);
      assert.ok(res.script.includes('CREATE NONCLUSTERED INDEX [IX_STOK_HAREKETLERI_sth_stok_kod_sth_tarih]'));
      assert.ok(res.script.includes('ON [dbo].[STOK_HAREKETLERI] ([sth_stok_kod], [sth_tarih])'));
      assert.ok(res.script.includes('INCLUDE ([sth_miktar], [sth_tutar]);'));
      assert.ok(res.script.includes('[GÜVENLİK KURALI]'));
    });

    it('omits INCLUDE clause when no included columns are provided', () => {
      const res = generateCreateIndexScript({
        schema: 'sales',
        table: 'Orders',
        keyColumns: ['CustomerId', 'OrderDate'],
        includedColumns: []
      });

      assert.ok(res.script.includes('ON [sales].[Orders] ([CustomerId], [OrderDate]);'));
      assert.ok(!res.script.includes('INCLUDE'));
    });

    it('includes WHERE clause for filtered indexes when definition provided', () => {
      const res = generateCreateIndexScript({
        schema: 'dbo',
        table: 'Invoices',
        keyColumns: ['InvoiceDate'],
        includedColumns: ['TotalAmount'],
        filterDefinition: '[IsCancelled] = 0'
      });

      assert.ok(res.script.includes('WHERE [IsCancelled] = 0;'));
    });

    it('safely truncates long index names to stay within SQL Server 128 character identifier limit', () => {
      const res = generateCreateIndexScript({
        schema: 'dbo',
        table: 'VERY_LONG_TABLE_NAME_THAT_EXCEEDS_NORMAL_STANDARDS_FOR_TESTING',
        keyColumns: ['long_column_name_number_one', 'long_column_name_number_two', 'long_column_name_number_three'],
        includedColumns: []
      });

      assert.ok(res.indexName.length <= 128);
      assert.ok(res.script.includes(`[${res.indexName}]`));
    });
  });

  describe('Execution Plan Missing Index Extraction', () => {
    it('extracts missing index from parsed execution plan', () => {
      const mockParsedPlan = {
        totalSubTreeCost: 45.2,
        missingIndexes: [
          {
            impact: '82.5',
            table: '[dbo].[SIPARISLER]',
            equalityColumns: ['sip_musteri_kod'],
            inequalityColumns: ['sip_tarih'],
            includeColumns: ['sip_tutar', 'sip_durum']
          }
        ]
      };

      const recs = getMissingIndexesFromPlan(mockParsedPlan);
      assert.equal(recs.length, 1);
      assert.equal(recs[0].source, 'EXECUTION_PLAN');
      assert.equal(recs[0].table, 'SIPARISLER');
      assert.deepEqual(recs[0].keyColumns, ['sip_musteri_kod', 'sip_tarih']);
      assert.deepEqual(recs[0].includedColumns, ['sip_tutar', 'sip_durum']);
      assert.ok(recs[0].benefitScore > 0);
      assert.ok(recs[0].script.includes('CREATE NONCLUSTERED INDEX'));
    });
  });

  describe('DMV Ephemerality Disclaimer', () => {
    it('exports standard restart disclaimer for missing index DMVs', () => {
      assert.ok(DMV_DISCLAIMER.includes('son yeniden başlatıldığından beri'));
    });
  });
});
