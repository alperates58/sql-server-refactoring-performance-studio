/**
 * SQL Server Refactoring & Performance Studio
 * High-Performance Virtualized Results Grid (Sprint 7)
 *
 * Capabilities:
 * - DOM Virtualization (smoothly handles 1k, 10k, 50k rows with ~50 DOM nodes)
 * - Sticky headers with 3-state column sorting (Default -> ASC -> DESC)
 * - Cell & Row selection (single / range)
 * - TSV Clipboard export (Cell, Selected rows, All with headers)
 * - UTF-8 BOM CSV export for Microsoft Excel compatibility
 * - Semantic rendering of NULLs, numbers, and dates
 */

(function (global) {
  'use strict';

  class VirtualGrid {
    constructor(container, options = {}) {
      this.container = container;
      this.rowHeight = options.rowHeight || 28;
      this.buffer = options.buffer || 15;
      this.maxMemoryDisplay = options.maxMemoryDisplay || 10000;

      this.rawRows = [];
      this.displayRows = [];
      this.columns = [];
      this.sortColumn = null;
      this.sortDirection = null; // 'asc' | 'desc' | null

      this.selectedCell = null; // { rowIdx, colName }
      this.selectedRowIndices = new Set();
      this.lastSelectedRowIdx = null;

      this.onSelectionChange = options.onSelectionChange || (() => {});

      this.initDom();
      this.bindScroll();
    }

    initDom() {
      this.container.innerHTML = '';
      this.container.className = 'wb-virtual-grid-container';

      // Outer wrapper
      this.viewport = document.createElement('div');
      this.viewport.className = 'wb-grid-viewport';
      this.viewport.style.position = 'relative';
      this.viewport.style.minWidth = '100%';

      // Height spacer for virtual scroll
      this.spacer = document.createElement('div');
      this.spacer.className = 'wb-grid-spacer';
      this.spacer.style.position = 'absolute';
      this.spacer.style.top = '0';
      this.spacer.style.left = '0';
      this.spacer.style.width = '1px';
      this.spacer.style.pointerEvents = 'none';

      // Table element
      this.table = document.createElement('table');
      this.table.className = 'wb-virtual-table';
      this.table.style.position = 'relative';

      // thead
      this.thead = document.createElement('thead');
      this.table.appendChild(this.thead);

      // tbody
      this.tbody = document.createElement('tbody');
      this.table.appendChild(this.tbody);

      this.viewport.appendChild(this.spacer);
      this.viewport.appendChild(this.table);
      this.container.appendChild(this.viewport);
    }

    bindScroll() {
      let ticking = false;
      this.container.addEventListener('scroll', () => {
        if (!ticking) {
          window.requestAnimationFrame(() => {
            this.renderVisibleRows();
            ticking = false;
          });
          ticking = true;
        }
      });
    }

    setData(columns = [], rows = []) {
      this.columns = [...columns];
      this.rawRows = [...rows];
      this.sortColumn = null;
      this.sortDirection = null;
      this.selectedCell = null;
      this.selectedRowIndices.clear();
      this.lastSelectedRowIdx = null;

      this.applySortAndFilter();
      this.renderHeader();
      this.updateHeight();
      this.container.scrollTop = 0;
      this.renderVisibleRows();
      this.notifySelection();
    }

    applySortAndFilter() {
      if (!this.sortColumn || !this.sortDirection) {
        this.displayRows = [...this.rawRows];
        return;
      }

      const col = this.sortColumn;
      const dir = this.sortDirection === 'asc' ? 1 : -1;

      this.displayRows = [...this.rawRows].sort((a, b) => {
        const valA = a[col];
        const valB = b[col];

        if (valA === null || valA === undefined) return 1; // nulls last
        if (valB === null || valB === undefined) return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * dir;
        }

        const strA = String(valA);
        const strB = String(valB);
        return strA.localeCompare(strB, 'tr', { numeric: true }) * dir;
      });
    }

    renderHeader() {
      this.thead.innerHTML = '';
      const headerRow = document.createElement('tr');

      // Row number index header
      const thIdx = document.createElement('th');
      thIdx.textContent = '#';
      thIdx.style.width = '45px';
      thIdx.style.textAlign = 'center';
      headerRow.appendChild(thIdx);

      this.columns.forEach(col => {
        const th = document.createElement('th');
        let label = col;
        if (this.sortColumn === col) {
          label += this.sortDirection === 'asc' ? ' ▲' : ' ▼';
        }
        th.textContent = label;
        th.title = `Sıralamak için tıkla: ${col}`;
        th.addEventListener('click', () => this.handleHeaderClick(col));
        headerRow.appendChild(th);
      });

      this.thead.appendChild(headerRow);
    }

    handleHeaderClick(col) {
      if (this.sortColumn !== col) {
        this.sortColumn = col;
        this.sortDirection = 'asc';
      } else if (this.sortDirection === 'asc') {
        this.sortDirection = 'desc';
      } else {
        this.sortColumn = null;
        this.sortDirection = null;
      }

      this.applySortAndFilter();
      this.renderHeader();
      this.renderVisibleRows();
    }

    updateHeight() {
      const totalHeight = this.displayRows.length * this.rowHeight;
      this.spacer.style.height = `${Math.max(1, totalHeight)}px`;
    }

    renderVisibleRows() {
      const totalRows = this.displayRows.length;
      if (totalRows === 0) {
        this.tbody.innerHTML = '';
        return;
      }

      const scrollTop = this.container.scrollTop;
      const viewHeight = this.container.clientHeight || 380;

      let startIdx = Math.floor(scrollTop / this.rowHeight) - this.buffer;
      let endIdx = Math.ceil((scrollTop + viewHeight) / this.rowHeight) + this.buffer;

      startIdx = Math.max(0, startIdx);
      endIdx = Math.min(totalRows, endIdx);

      const topOffset = startIdx * this.rowHeight;
      this.tbody.style.transform = `translateY(${topOffset}px)`;

      const fragment = document.createDocumentFragment();

      for (let i = startIdx; i < endIdx; i++) {
        const rowData = this.displayRows[i];
        const tr = document.createElement('tr');
        tr.style.height = `${this.rowHeight}px`;

        if (this.selectedRowIndices.has(i)) {
          tr.classList.add('selected');
        }

        // Row number cell
        const tdIdx = document.createElement('td');
        tdIdx.textContent = String(i + 1);
        tdIdx.style.textAlign = 'center';
        tdIdx.style.color = 'var(--text-muted)';
        tdIdx.style.userSelect = 'none';
        tr.appendChild(tdIdx);

        // Data cells
        this.columns.forEach(col => {
          const td = document.createElement('td');
          const val = rowData[col];

          if (val === null || val === undefined) {
            const badge = document.createElement('span');
            badge.className = 'null-badge';
            badge.textContent = 'NULL';
            td.appendChild(badge);
          } else if (typeof val === 'boolean') {
            td.textContent = val ? 'TRUE' : 'FALSE';
            td.style.color = val ? '#10b981' : '#f87171';
          } else if (typeof val === 'number') {
            td.textContent = String(val);
            td.style.textAlign = 'right';
          } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val)) {
            // ISO date
            td.textContent = val.replace('T', ' ').replace('Z', '').substring(0, 19);
          } else {
            td.textContent = String(val);
          }

          if (this.selectedCell && this.selectedCell.rowIdx === i && this.selectedCell.colName === col) {
            td.classList.add('cell-selected');
          }

          td.addEventListener('click', (e) => this.handleCellClick(e, i, col));
          tr.appendChild(td);
        });

        fragment.appendChild(tr);
      }

      this.tbody.innerHTML = '';
      this.tbody.appendChild(fragment);
    }

    handleCellClick(e, rowIdx, colName) {
      this.selectedCell = { rowIdx, colName };

      if (e.shiftKey && this.lastSelectedRowIdx !== null) {
        // Multi-row range selection
        const start = Math.min(this.lastSelectedRowIdx, rowIdx);
        const end = Math.max(this.lastSelectedRowIdx, rowIdx);
        this.selectedRowIndices.clear();
        for (let r = start; r <= end; r++) {
          this.selectedRowIndices.add(r);
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Toggle row selection
        if (this.selectedRowIndices.has(rowIdx)) {
          this.selectedRowIndices.delete(rowIdx);
        } else {
          this.selectedRowIndices.add(rowIdx);
        }
        this.lastSelectedRowIdx = rowIdx;
      } else {
        // Single row selection
        this.selectedRowIndices.clear();
        this.selectedRowIndices.add(rowIdx);
        this.lastSelectedRowIdx = rowIdx;
      }

      this.renderVisibleRows();
      this.notifySelection();
    }

    notifySelection() {
      const count = this.selectedRowIndices.size;
      this.onSelectionChange({
        selectedRowCount: count,
        selectedCell: this.selectedCell
      });
    }

    copyCell() {
      if (!this.selectedCell) return false;
      const { rowIdx, colName } = this.selectedCell;
      const row = this.displayRows[rowIdx];
      if (!row) return false;
      const val = row[colName] ?? '';
      navigator.clipboard.writeText(String(val));
      return true;
    }

    copySelectedRowsTsv(includeHeaders = false) {
      const rowsToCopy = this.selectedRowIndices.size > 0
        ? Array.from(this.selectedRowIndices).sort((a, b) => a - b).map(idx => this.displayRows[idx])
        : this.displayRows;

      return this.copyRowsAsTsv(rowsToCopy, includeHeaders);
    }

    copyAllTsv(includeHeaders = true) {
      return this.copyRowsAsTsv(this.displayRows, includeHeaders);
    }

    copyRowsAsTsv(rows, includeHeaders) {
      const lines = [];
      if (includeHeaders && this.columns.length > 0) {
        lines.push(this.columns.join('\t'));
      }

      rows.forEach(r => {
        const line = this.columns.map(c => {
          const val = r[c];
          if (val === null || val === undefined) return '';
          return String(val).replace(/[\r\n\t]/g, ' ');
        }).join('\t');
        lines.push(line);
      });

      const tsvContent = lines.join('\n');
      navigator.clipboard.writeText(tsvContent);
      return tsvContent;
    }

    exportCsv(filename = 'query_results.csv', withBom = true) {
      if (this.columns.length === 0 || this.displayRows.length === 0) return false;

      const lines = [];
      // Header
      lines.push(this.columns.map(c => this.escapeCsv(c)).join(','));

      // Rows
      this.displayRows.forEach(row => {
        const rowArr = this.columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          return this.escapeCsv(val);
        });
        lines.push(rowArr.join(','));
      });

      let csvText = lines.join('\r\n');
      if (withBom) {
        csvText = '\uFEFF' + csvText;
      }

      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      this.triggerDownload(blob, filename);
      return true;
    }

    exportTsv(filename = 'query_results.tsv') {
      if (this.columns.length === 0 || this.displayRows.length === 0) return false;

      const lines = [];
      lines.push(this.columns.join('\t'));
      this.displayRows.forEach(row => {
        lines.push(this.columns.map(c => {
          const v = row[c];
          return v === null || v === undefined ? '' : String(v).replace(/[\r\n\t]/g, ' ');
        }).join('\t'));
      });

      const tsvText = '\uFEFF' + lines.join('\r\n');
      const blob = new Blob([tsvText], { type: 'text/tab-separated-values;charset=utf-8;' });
      this.triggerDownload(blob, filename);
      return true;
    }

    escapeCsv(val, sanitizeFormulas = true) {
      if (val === null || val === undefined) return '';
      let str = String(val);

      // Protect against CSV Formula Injection in Excel (=, +, -, @, \t, \r)
      if (sanitizeFormulas && /^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }

      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    triggerDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VirtualGrid };
  } else {
    global.VirtualGrid = VirtualGrid;
  }
})(typeof window !== 'undefined' ? window : globalThis);
