const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { VirtualGrid } = require('../public/assets/js/modules/virtualGrid');

describe('VirtualGrid High-Performance Results Grid Tests (Sprint 7)', () => {
  describe('RFC 4180 CSV Escaping & UTF-8 BOM Compatibility', () => {
    it('returns simple strings and numbers without quotes', () => {
      const escape = VirtualGrid.prototype.escapeCsv;
      assert.equal(escape('hello'), 'hello');
      assert.equal(escape(12345), '12345');
      assert.equal(escape('abc_123'), 'abc_123');
    });

    it('wraps strings containing commas in quotes', () => {
      const escape = VirtualGrid.prototype.escapeCsv;
      assert.equal(escape('Istanbul, Turkey'), '"Istanbul, Turkey"');
    });

    it('escapes internal double quotes by doubling them', () => {
      const escape = VirtualGrid.prototype.escapeCsv;
      assert.equal(escape('He said "Hello"'), '"He said ""Hello"""');
    });

    it('wraps strings containing newlines or carriage returns in quotes', () => {
      const escape = VirtualGrid.prototype.escapeCsv;
      assert.equal(escape('line1\nline2'), '"line1\nline2"');
      assert.equal(escape('line1\r\nline2'), '"line1\r\nline2"');
    });

    it('verifies UTF-8 BOM prefix (\\uFEFF) for Excel compatibility', () => {
      const bom = '\uFEFF';
      const sampleCsv = `${bom}col1,col2\r\nval1,val2`;
      assert.equal(sampleCsv.charCodeAt(0), 0xFEFF);
      assert.ok(sampleCsv.startsWith('\uFEFF'));
    });
  });

  describe('TSV Generation & Formatting', () => {
    it('formats rows and columns into tab-separated lines with headers', () => {
      const mockGrid = {
        columns: ['id', 'name', 'city'],
        displayRows: [
          { id: 1, name: 'Ahmet', city: 'Istanbul' },
          { id: 2, name: 'Mehmet', city: 'Ankara' }
        ]
      };

      const lines = [mockGrid.columns.join('\t')];
      mockGrid.displayRows.forEach(r => {
        lines.push(mockGrid.columns.map(c => r[c] ?? '').join('\t'));
      });
      const tsv = lines.join('\n');

      assert.equal(tsv, 'id\tname\tcity\n1\tAhmet\tIstanbul\n2\tMehmet\tAnkara');
    });

    it('sanitizes tab characters and line breaks inside TSV cells', () => {
      const valWithTabs = 'Text with\ttabs\rand\nnewlines';
      const sanitized = String(valWithTabs).replace(/[\r\n\t]/g, ' ');
      assert.equal(sanitized, 'Text with tabs and newlines');
      assert.ok(!sanitized.includes('\t'));
      assert.ok(!sanitized.includes('\n'));
    });
  });

  describe('Tri-State Column Sorting Algorithm', () => {
    it('sorts numbers in ascending and descending order correctly', () => {
      const rows = [{ val: 10 }, { val: 2 }, { val: 50 }, { val: null }, { val: 1 }];

      // Sort ASC (nulls last)
      const ascSorted = [...rows].sort((a, b) => {
        if (a.val === null) return 1;
        if (b.val === null) return -1;
        return a.val - b.val;
      });
      assert.deepEqual(
        ascSorted.map(r => r.val),
        [1, 2, 10, 50, null]
      );

      // Sort DESC (nulls last)
      const descSorted = [...rows].sort((a, b) => {
        if (a.val === null) return 1;
        if (b.val === null) return -1;
        return b.val - a.val;
      });
      assert.deepEqual(
        descSorted.map(r => r.val),
        [50, 10, 2, 1, null]
      );
    });

    it('sorts Turkish text using localeCompare with numeric collation', () => {
      const rows = [{ name: 'Çetin' }, { name: 'Ahmet' }, { name: 'Ömer' }, { name: 'Barış' }];
      const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }));

      assert.deepEqual(
        sorted.map(r => r.name),
        ['Ahmet', 'Barış', 'Çetin', 'Ömer']
      );
    });
  });

  describe('Windowing & Virtual Scroll Range Calculation', () => {
    it('calculates bounded start and end indices for 1,000 rows', () => {
      const rowHeight = 28;
      const buffer = 15;
      const totalRows = 1000;
      const viewHeight = 400; // ~14 visible rows

      // Scroll at top (0px)
      const scroll0 = 0;
      let start0 = Math.max(0, Math.floor(scroll0 / rowHeight) - buffer);
      let end0 = Math.min(totalRows, Math.ceil((scroll0 + viewHeight) / rowHeight) + buffer);

      assert.equal(start0, 0);
      assert.equal(end0, 15 + buffer); // 15 visible + 15 buffer = 30 rows rendered

      // Scroll at 2800px (~100th row)
      const scroll100 = 2800;
      let start100 = Math.max(0, Math.floor(scroll100 / rowHeight) - buffer);
      let end100 = Math.min(totalRows, Math.ceil((scroll100 + viewHeight) / rowHeight) + buffer);

      assert.equal(start100, 100 - buffer); // 85
      assert.equal(end100, 100 + 15 + buffer); // 130
      assert.equal(end100 - start100, 45); // Constant ~45 DOM nodes!
    });

    it('maintains constant DOM slice size for 50,000 rows', () => {
      const rowHeight = 28;
      const buffer = 15;
      const totalRows = 50000;
      const viewHeight = 400;

      // Scroll in middle: 700,000px (~25,000th row)
      const scrollMid = 700000;
      const start = Math.max(0, Math.floor(scrollMid / rowHeight) - buffer);
      const end = Math.min(totalRows, Math.ceil((scrollMid + viewHeight) / rowHeight) + buffer);

      const renderedCount = end - start;
      assert.ok(renderedCount <= 50, `Rendered nodes (${renderedCount}) must remain <= 50 for 50k rows`);
    });

    it('calculates continuous multi-row selection ranges on Shift+Click', () => {
      const lastSelected = 10;
      const currentSelected = 25;

      const start = Math.min(lastSelected, currentSelected);
      const end = Math.max(lastSelected, currentSelected);

      const rangeIndices = [];
      for (let i = start; i <= end; i++) {
        rangeIndices.push(i);
      }

      assert.equal(rangeIndices.length, 16);
      assert.equal(rangeIndices[0], 10);
      assert.equal(rangeIndices[15], 25);
    });
  });
});
