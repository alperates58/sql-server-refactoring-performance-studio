/**
 * SQL Server Refactoring & Performance Studio
 * SQL Workbench Schema-Aware IntelliSense Engine (Vanilla JS)
 *
 * Implements:
 * - Offline-first, in-memory metadata completion (0 DB hits on keystroke)
 * - Context-aware ranking (FROM/JOIN -> Tables/Views, WHERE/SELECT -> Columns/Funcs)
 * - Alias member completion (FROM STOKLAR s -> s. -> sto_kod, sto_isim)
 * - Schema and cross-database member completion (dbo. -> dbo objects, RAPOR_DB.dbo. -> RAPOR_DB objects)
 * - Active Database Priority ranking
 * - 3-Part name insertion for cross-database objects
 * - Fuzzy & multi-token prefix matching with highlight
 * - Caret coordinate projection
 * - Snippets (sel, selw, cte, join, case)
 * - Keyboard navigation (Arrows, Tab, Enter, Esc, Ctrl+Space)
 * - Bracket matching & line comment toggle (Ctrl+/)
 */

class StudioIntelliSense {
  constructor(textarea, popupElement, options = {}) {
    this.textarea = textarea;
    this.popup = popupElement;
    this.getActiveDatabase = options.getActiveDatabase || (() => 'MikroDB_V16_LIDER25');
    this.onInsert = options.onInsert || (() => {});

    this.catalog = null;
    this.isOpen = false;
    this.items = [];
    this.selectedIndex = 0;
    this.currentQuery = '';
    this.tokenRange = { start: 0, end: 0 };
    this.context = 'DEFAULT';

    this.initMirror();
    this.bindEvents();
  }

  setCatalog(catalogData) {
    this.catalog = catalogData;
  }

  initMirror() {
    this.mirror = document.createElement('div');
    this.mirror.className = 'intellisense-caret-mirror';
    document.body.appendChild(this.mirror);
  }

  bindEvents() {
    this.textarea.addEventListener('input', () => this.handleTyping());
    this.textarea.addEventListener('keydown', e => this.handleKeyDown(e));
    this.textarea.addEventListener('scroll', () => {
      if (this.isOpen) this.updatePosition();
    });
    this.textarea.addEventListener('click', () => {
      this.close();
      this.checkBracketMatching();
    });
    this.textarea.addEventListener('keyup', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        this.checkBracketMatching();
      }
    });

    document.addEventListener('click', e => {
      if (!this.popup.contains(e.target) && e.target !== this.textarea) {
        this.close();
      }
    });
  }

  handleKeyDown(e) {
    // 1. Force open: Ctrl+Space
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      this.triggerAutocomplete(true);
      return;
    }

    // 2. Line Comment Toggle: Ctrl+/
    if (e.ctrlKey && (e.key === '/' || e.key === '.')) {
      e.preventDefault();
      this.toggleLineComment();
      return;
    }

    // 3. Tab Indent / Outdent
    if (e.key === 'Tab' && !this.isOpen) {
      e.preventDefault();
      if (e.shiftKey) {
        this.outdentSelection();
      } else {
        this.indentSelection();
      }
      return;
    }

    // 4. Popup Navigation when Open
    if (this.isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
        this.renderList();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
        this.renderList();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (this.items.length > 0) {
          e.preventDefault();
          this.commitSelected();
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
    }
  }

  handleTyping() {
    this.checkBracketMatching();
    // Debounced autocomplete trigger
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.triggerAutocomplete(false);
    }, 40);
  }

  triggerAutocomplete(isForced = false) {
    if (!this.catalog) return;

    const pos = this.textarea.selectionStart;
    const text = this.textarea.value;
    const textBefore = text.slice(0, pos);

    // Extract current token / expression before cursor
    // Handles: word, alias.member, schema.member, db.schema.member
    const match = /(?:([a-zA-Z0-9_\[\]]+)\.)?(?:([a-zA-Z0-9_\[\]]+)\.)?([a-zA-Z0-9_#$]*)$/.exec(textBefore);
    if (!match && !isForced) {
      this.close();
      return;
    }

    const rawPart1 = match ? match[1] : null; // DB or Schema or Alias
    const rawPart2 = match ? match[2] : null; // Schema or empty
    const rawWord = match ? match[3] : '';    // Current typing token

    // Clean brackets: [RAPOR_DB] -> RAPOR_DB
    const clean = str => str ? str.replace(/[\[\]]/g, '') : null;
    const part1 = clean(rawPart1);
    const part2 = clean(rawPart2);
    const word = rawWord.toLowerCase();

    // Trigger length check: open if forced, after a dot, or word has at least 1 character
    const isAfterDot = textBefore.endsWith('.');
    if (!isForced && !isAfterDot && word.length < 1) {
      this.close();
      return;
    }

    this.tokenRange = {
      start: pos - rawWord.length,
      end: pos
    };

    // Analyze query context & alias map
    const contextInfo = this.analyzeContext(textBefore, part1, part2);
    this.currentQuery = word;

    // Generate completion candidates
    this.items = this.generateCandidates(word, contextInfo);

    if (this.items.length === 0) {
      this.close();
      return;
    }

    this.selectedIndex = 0;
    this.open();
  }

  /**
   * Graceful context analyzer:
   * Extracts aliases (FROM Table t, JOIN Table AS t) and identifies active clause
   */
  analyzeContext(textBefore, part1, part2) {
    const activeDb = this.getActiveDatabase();
    const result = {
      clause: 'DEFAULT',
      aliasTarget: null,
      schemaTarget: null,
      databaseTarget: null,
      aliases: new Map() // alias.toLowerCase() -> { table, database, schema }
    };

    try {
      // 1. Parse table aliases from query text (simple regex, zero failure risk)
      const aliasRegex = /(?:FROM|JOIN)\s+(?:\[?([a-zA-Z0-9_]+)\]?\.)?(?:\[?([a-zA-Z0-9_]+)\]?\.)?\[?([a-zA-Z0-9_]+)\]?(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?/gi;
      let m;
      while ((m = aliasRegex.exec(textBefore)) !== null) {
        const p1 = clean(m[1]);
        const p2 = clean(m[2]);
        const tbl = clean(m[3]);
        const alias = clean(m[4]);

        let dbName = activeDb;
        let sch = 'dbo';
        let tableName = tbl;

        if (p2) {
          dbName = p1;
          sch = p2;
        } else if (p1) {
          sch = p1;
        }

        if (alias && tbl) {
          result.aliases.set(alias.toLowerCase(), {
            table: tableName,
            database: dbName,
            schema: sch
          });
        } else if (tbl) {
          result.aliases.set(tbl.toLowerCase(), {
            table: tableName,
            database: dbName,
            schema: sch
          });
        }
      }
    } catch (_) {
      // Gracefully degrade: continue without aliases
    }

    function clean(s) {
      return s ? s.replace(/[\[\]]/g, '') : null;
    }

    // 2. Member completion checks (dot syntax)
    if (part1 && part2) {
      // e.g. RAPOR_DB.dbo.
      result.databaseTarget = part1;
      result.schemaTarget = part2;
      result.clause = 'DB_SCHEMA_MEMBER';
      return result;
    }

    if (part1 && !part2) {
      // Could be DB. or Schema. or Alias.
      if (this.catalog.databases.some(d => d.toLowerCase() === part1.toLowerCase())) {
        result.databaseTarget = part1;
        result.clause = 'DB_MEMBER';
        return result;
      }
      if (this.catalog.schemas.some(s => s.toLowerCase() === part1.toLowerCase())) {
        result.schemaTarget = part1;
        result.clause = 'SCHEMA_MEMBER';
        return result;
      }
      if (result.aliases.has(part1.toLowerCase())) {
        result.aliasTarget = result.aliases.get(part1.toLowerCase());
        result.clause = 'ALIAS_MEMBER';
        return result;
      }
    }

    // 3. Clause detection from preceding keywords
    const upper = textBefore.toUpperCase();
    const lastFrom = upper.lastIndexOf('FROM');
    const lastJoin = upper.lastIndexOf('JOIN');
    const lastWhere = upper.lastIndexOf('WHERE');
    const lastSelect = upper.lastIndexOf('SELECT');
    const lastGroup = upper.lastIndexOf('GROUP BY');
    const lastOrder = upper.lastIndexOf('ORDER BY');
    const lastOn = upper.lastIndexOf('ON');

    const maxKeywordPos = Math.max(lastFrom, lastJoin, lastWhere, lastSelect, lastGroup, lastOrder, lastOn);

    if (maxKeywordPos !== -1) {
      if (maxKeywordPos === lastFrom || maxKeywordPos === lastJoin) {
        result.clause = 'FROM_OR_JOIN';
      } else if (maxKeywordPos === lastWhere || maxKeywordPos === lastOn) {
        result.clause = 'PREDICATE';
      } else if (maxKeywordPos === lastSelect) {
        result.clause = 'SELECT_LIST';
      } else if (maxKeywordPos === lastGroup || maxKeywordPos === lastOrder) {
        result.clause = 'GROUP_OR_ORDER';
      }
    }

    return result;
  }

  /**
   * Generate candidates with strict Active Database Priority
   */
  generateCandidates(query, contextInfo) {
    const activeDb = this.getActiveDatabase();
    const results = [];

    // Helper matcher
    const scoreItem = (text, type, dbName) => {
      const lower = text.toLowerCase();
      if (!query) return 100;
      if (lower === query) return 1000;
      if (lower.startsWith(query)) return 800 - (lower.length - query.length);

      // Token boundary match (e.g. "ure malz" matches "AA_URETIM_MALZEME_PLANLAMA")
      const parts = query.split(/[\s_]+/);
      if (parts.length > 1) {
        const allMatch = parts.every(p => lower.includes(p));
        if (allMatch) return 500;
      }

      // Substring match
      const subIdx = lower.indexOf(query);
      if (subIdx >= 0) return 400 - subIdx;

      return -1;
    };

    // Case A: Alias member completion (s. -> sto_kod, sto_isim)
    if (contextInfo.clause === 'ALIAS_MEMBER' && contextInfo.aliasTarget) {
      const targetTable = contextInfo.aliasTarget.table.toLowerCase();
      const targetDb = (contextInfo.aliasTarget.database || activeDb).toLowerCase();

      // Find matching table or view columns in catalog
      const tbl = this.catalog.tables.find(t => t.name.toLowerCase() === targetTable && t.database.toLowerCase() === targetDb)
        || this.catalog.views.find(v => v.name.toLowerCase() === targetTable && v.database.toLowerCase() === targetDb);

      if (tbl && tbl.columns) {
        for (const col of tbl.columns) {
          const score = scoreItem(col.name, 'COLUMN', targetDb);
          if (score > 0) {
            results.push({
              name: col.name,
              insertText: col.name,
              type: 'COLUMN',
              badge: 'COL',
              detail: `${col.dataType} · ${col.nullable ? 'null' : 'not null'}`,
              database: targetDb,
              score: score + 500
            });
          }
        }
        return this.finalizeResults(results, activeDb);
      }
    }

    // Case B: Schema member completion (dbo. -> tables and views in dbo)
    if (contextInfo.clause === 'SCHEMA_MEMBER' || contextInfo.clause === 'DB_SCHEMA_MEMBER') {
      const targetDb = (contextInfo.databaseTarget || activeDb).toLowerCase();
      const targetSchema = (contextInfo.schemaTarget || 'dbo').toLowerCase();

      // Tables
      for (const t of this.catalog.tables || []) {
        if (t.database.toLowerCase() === targetDb && t.schema.toLowerCase() === targetSchema) {
          const score = scoreItem(t.name, 'TABLE', t.database);
          if (score > 0) {
            results.push({
              name: t.name,
              insertText: t.name,
              type: 'TABLE',
              badge: 'TBL',
              detail: `TABLE · ${t.database}.${t.schema} (${(t.columns || []).length} cols)`,
              database: t.database,
              score: score + (t.database.toLowerCase() === activeDb.toLowerCase() ? 200 : 0)
            });
          }
        }
      }

      // Views
      for (const v of this.catalog.views || []) {
        if (v.database.toLowerCase() === targetDb && (v.schema || 'dbo').toLowerCase() === targetSchema) {
          const score = scoreItem(v.name, 'VIEW', v.database);
          if (score > 0) {
            results.push({
              name: v.name,
              insertText: v.name,
              type: 'VIEW',
              badge: 'VIEW',
              detail: `VIEW · ${v.database}.${v.schema || 'dbo'} · Health: ${v.health}`,
              database: v.database,
              score: score + (v.database.toLowerCase() === activeDb.toLowerCase() ? 200 : 0)
            });
          }
        }
      }
      return this.finalizeResults(results, activeDb);
    }

    // Case C: Database member completion (RAPOR_DB. -> schemas)
    if (contextInfo.clause === 'DB_MEMBER') {
      for (const s of this.catalog.schemas || ['dbo']) {
        results.push({
          name: `${s}.`,
          insertText: `${s}.`,
          type: 'SCHEMA',
          badge: 'SCH',
          detail: `SCHEMA · ${contextInfo.databaseTarget}.${s}`,
          database: contextInfo.databaseTarget,
          score: 800
        });
      }
      return this.finalizeResults(results, activeDb);
    }

    // Case D: General Autocomplete (Ranked by Clause Context & Active DB)
    const isTableFirst = contextInfo.clause === 'FROM_OR_JOIN';
    const isColumnFirst = contextInfo.clause === 'PREDICATE' || contextInfo.clause === 'SELECT_LIST' || contextInfo.clause === 'GROUP_OR_ORDER';

    // 1. Views
    for (const v of this.catalog.views || []) {
      const score = scoreItem(v.name, 'VIEW', v.database);
      if (score > 0) {
        const isCurrentDb = v.database.toLowerCase() === activeDb.toLowerCase();
        // Guardrail 1: Active Database Priority
        const dbBonus = isCurrentDb ? 250 : 0;
        const clauseBonus = isTableFirst ? 300 : 0;

        // Guardrail: Cross-database 3-part name insertion
        const insertText = isCurrentDb ? v.name : `[${v.database}].[${v.schema || 'dbo'}].[${v.name}]`;

        results.push({
          name: v.name,
          insertText,
          type: 'VIEW',
          badge: 'VIEW',
          detail: `VIEW · ${v.database}.${v.schema || 'dbo'} · Health: ${v.health}`,
          database: v.database,
          score: score + dbBonus + clauseBonus
        });
      }
    }

    // 2. Base Tables
    for (const t of this.catalog.tables || []) {
      const score = scoreItem(t.name, 'TABLE', t.database);
      if (score > 0) {
        const isCurrentDb = t.database.toLowerCase() === activeDb.toLowerCase();
        const dbBonus = isCurrentDb ? 250 : 0;
        const clauseBonus = isTableFirst ? 300 : 0;
        const insertText = isCurrentDb ? t.name : `[${t.database}].[${t.schema || 'dbo'}].[${t.name}]`;

        results.push({
          name: t.name,
          insertText,
          type: 'TABLE',
          badge: 'TBL',
          detail: `TABLE · ${t.database}.${t.schema} (${(t.columns || []).length} cols)`,
          database: t.database,
          score: score + dbBonus + clauseBonus
        });
      }
    }

    // 3. Synonyms
    for (const syn of this.catalog.synonyms || []) {
      const score = scoreItem(syn.name, 'SYNONYM', syn.database);
      if (score > 0) {
        const isCurrentDb = syn.database.toLowerCase() === activeDb.toLowerCase();
        results.push({
          name: syn.name,
          insertText: isCurrentDb ? syn.name : `[${syn.database}].[${syn.schema || 'dbo'}].[${syn.name}]`,
          type: 'SYNONYM',
          badge: 'SYN',
          detail: `SYNONYM → ${syn.targetCanonicalId}`,
          database: syn.database,
          score: score + (isCurrentDb ? 200 : 0) + (isTableFirst ? 200 : 0)
        });
      }
    }

    // 4. Columns (if in column-friendly clause or typed > 2 chars)
    if (isColumnFirst || query.length >= 2) {
      const activeTables = this.catalog.tables.filter(t => t.database.toLowerCase() === activeDb.toLowerCase());
      for (const t of activeTables) {
        for (const col of t.columns || []) {
          const score = scoreItem(col.name, 'COLUMN', activeDb);
          if (score > 0) {
            results.push({
              name: col.name,
              insertText: col.name,
              type: 'COLUMN',
              badge: 'COL',
              detail: `${t.name}.${col.name} (${col.dataType})`,
              database: activeDb,
              score: score + (isColumnFirst ? 250 : -50)
            });
          }
        }
      }
    }

    // 5. Functions
    for (const f of this.catalog.functions || []) {
      const score = scoreItem(f.name, 'FUNCTION', null);
      if (score > 0) {
        results.push({
          name: f.name,
          insertText: `${f.name}()`,
          type: 'FUNCTION',
          badge: 'FN',
          detail: f.detail,
          database: null,
          score: score + (isColumnFirst ? 150 : 0)
        });
      }
    }

    // 6. Keywords
    if (!isTableFirst) {
      for (const kw of this.catalog.keywords || []) {
        const score = scoreItem(kw, 'KEYWORD', null);
        if (score > 0) {
          const isPrefix = kw.toLowerCase().startsWith(query);
          results.push({
            name: kw,
            insertText: kw,
            type: 'KEYWORD',
            badge: 'KW',
            detail: 'SQL Keyword',
            database: null,
            score: score + (isPrefix ? 150 : 0)
          });
        }
      }
    }

    // 7. Snippets (User Requirement 26: Available on selection, never forced above keyword)
    for (const snip of this.catalog.snippets || []) {
      if (snip.prefix.startsWith(query)) {
        results.push({
          name: snip.label,
          insertText: snip.body,
          type: 'SNIPPET',
          badge: 'SNP',
          detail: snip.description,
          database: null,
          score: 650
        });
      }
    }

    return this.finalizeResults(results, activeDb);
  }

  finalizeResults(results, activeDb) {
    // Sort by score descending, then active DB priority, then alphabetical
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aIsActive = (a.database || '').toLowerCase() === activeDb.toLowerCase();
      const bIsActive = (b.database || '').toLowerCase() === activeDb.toLowerCase();
      if (aIsActive && !bIsActive) return -1;
      if (!aIsActive && bIsActive) return 1;
      return a.name.localeCompare(b.name);
    });

    // Deduplicate and bound to max 50 items
    const seen = new Set();
    const bounded = [];
    for (const it of results) {
      const key = `${it.type}:${it.database || ''}:${it.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        bounded.push(it);
        if (bounded.length >= 50) break;
      }
    }
    return bounded;
  }

  renderList() {
    if (!this.popup) return;
    const activeDb = this.getActiveDatabase();

    this.popup.innerHTML = this.items.map((item, idx) => {
      const isSelected = idx === this.selectedIndex;
      const isCrossDb = item.database && item.database.toLowerCase() !== activeDb.toLowerCase();

      // Highlight matched characters
      let displayName = item.name;
      if (this.currentQuery) {
        const qIdx = displayName.toLowerCase().indexOf(this.currentQuery.toLowerCase());
        if (qIdx >= 0) {
          const before = displayName.slice(0, qIdx);
          const match = displayName.slice(qIdx, qIdx + this.currentQuery.length);
          const after = displayName.slice(qIdx + this.currentQuery.length);
          displayName = `${escapeHtml(before)}<b class="match-hl">${escapeHtml(match)}</b>${escapeHtml(after)}`;
        } else {
          displayName = escapeHtml(displayName);
        }
      } else {
        displayName = escapeHtml(displayName);
      }

      return `
        <div class="intellisense-item ${isSelected ? 'active' : ''}" data-idx="${idx}">
          <span class="intellisense-badge badge-${item.type.toLowerCase()}">${item.badge}</span>
          <div class="intellisense-info">
            <div class="intellisense-name">
              <span>${displayName}</span>
              ${isCrossDb ? `<span class="db-badge" style="font-size:10px;padding:1px 5px">${item.database}</span>` : ''}
            </div>
            <small class="intellisense-detail">${escapeHtml(item.detail || '')}</small>
          </div>
        </div>
      `;
    }).join('');

    // Wire mouse click / hover
    const itemElements = this.popup.querySelectorAll('.intellisense-item');
    itemElements.forEach((el, idx) => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        this.selectedIndex = idx;
        this.commitSelected();
      });
      el.addEventListener('mouseenter', () => {
        this.selectedIndex = idx;
        itemElements.forEach((x, i) => x.classList.toggle('active', i === idx));
      });
    });

    // Ensure selected element is scrolled into view
    const activeEl = itemElements[this.selectedIndex];
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  commitSelected() {
    const item = this.items[this.selectedIndex];
    if (!item) return;

    const val = this.textarea.value;
    const before = val.slice(0, this.tokenRange.start);
    const after = val.slice(this.tokenRange.end);

    const insertText = item.insertText;
    this.textarea.value = before + insertText + after;

    // Set cursor right after inserted text
    let newCursorPos = before.length + insertText.length;
    // If function with (), place cursor inside: COUNT(|)
    if (insertText.endsWith('()')) {
      newCursorPos -= 1;
    }

    this.textarea.selectionStart = newCursorPos;
    this.textarea.selectionEnd = newCursorPos;
    this.textarea.focus();

    this.close();
    this.onInsert(item);
  }

  updatePosition() {
    const coords = this.getCaretCoordinates();
    const editorRect = this.textarea.getBoundingClientRect();

    // Position relative to textarea container
    let top = coords.top + 22;
    let left = coords.left;

    // Boundary constraints
    const maxLeft = this.textarea.clientWidth - 320;
    if (left > maxLeft) left = Math.max(10, maxLeft);

    this.popup.style.top = `${top}px`;
    this.popup.style.left = `${left}px`;
  }

  getCaretCoordinates() {
    const pos = this.textarea.selectionStart;
    const style = window.getComputedStyle(this.textarea);

    this.mirror.style.width = `${this.textarea.clientWidth}px`;
    this.mirror.style.font = style.font;
    this.mirror.style.fontSize = style.fontSize;
    this.mirror.style.fontFamily = style.fontFamily;
    this.mirror.style.lineHeight = style.lineHeight;
    this.mirror.style.padding = style.padding;
    this.mirror.style.boxSizing = style.boxSizing;
    this.mirror.style.whiteSpace = 'pre-wrap';
    this.mirror.style.wordWrap = 'break-word';

    const textBefore = this.textarea.value.slice(0, pos);
    this.mirror.textContent = textBefore;

    const span = document.createElement('span');
    span.textContent = '|';
    this.mirror.appendChild(span);

    const spanLeft = span.offsetLeft;
    const spanTop = span.offsetTop - this.textarea.scrollTop;

    return {
      left: spanLeft,
      top: spanTop
    };
  }

  open() {
    this.isOpen = true;
    this.popup.classList.remove('hidden');
    this.updatePosition();
    this.renderList();
  }

  close() {
    this.isOpen = false;
    this.popup.classList.add('hidden');
    this.items = [];
    this.selectedIndex = 0;
  }

  checkBracketMatching() {
    const pos = this.textarea.selectionStart;
    const text = this.textarea.value;
    const prevChar = text[pos - 1];
    const nextChar = text[pos];

    const pairs = { '(': ')', '[': ']' };
    const revPairs = { ')': '(', ']': '[' };

    // Simple visual bracket indicator in status
    const statusPill = document.getElementById('wbStatusPill');
    if (pairs[prevChar] || revPairs[prevChar] || pairs[nextChar] || revPairs[nextChar]) {
      // Bracket active
      this.textarea.classList.add('bracket-active');
    } else {
      this.textarea.classList.remove('bracket-active');
    }
  }

  toggleLineComment() {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const val = this.textarea.value;

    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;

    const lines = val.slice(lineStart, lineEnd).split('\n');
    const allCommented = lines.every(l => l.trimStart().startsWith('--'));

    const toggled = lines.map(l => {
      if (allCommented) {
        return l.replace(/^(\s*)--\s?/, '$1');
      } else {
        return l.replace(/^(\s*)/, '$1-- ');
      }
    }).join('\n');

    this.textarea.value = val.slice(0, lineStart) + toggled + val.slice(lineEnd);
    this.textarea.selectionStart = lineStart;
    this.textarea.selectionEnd = lineStart + toggled.length;
  }

  indentSelection() {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const val = this.textarea.value;

    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;

    const lines = val.slice(lineStart, lineEnd).split('\n');
    const indented = lines.map(l => '    ' + l).join('\n');

    this.textarea.value = val.slice(0, lineStart) + indented + val.slice(lineEnd);
    this.textarea.selectionStart = start + 4;
    this.textarea.selectionEnd = end + (lines.length * 4);
  }

  outdentSelection() {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const val = this.textarea.value;

    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;

    const lines = val.slice(lineStart, lineEnd).split('\n');
    let removedChars = 0;
    const outdented = lines.map(l => {
      const match = /^ {1,4}/.exec(l);
      if (match) {
        removedChars += match[0].length;
        return l.slice(match[0].length);
      }
      return l;
    }).join('\n');

    this.textarea.value = val.slice(0, lineStart) + outdented + val.slice(lineEnd);
    this.textarea.selectionStart = Math.max(lineStart, start - 4);
    this.textarea.selectionEnd = Math.max(lineStart, end - removedChars);
  }
}

// Global Export
window.StudioIntelliSense = StudioIntelliSense;
