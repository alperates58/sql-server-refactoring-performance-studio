/**
 * SQL Server Refactoring & Performance Studio
 * T-SQL AST Parser Adapter (Sprint 4)
 *
 * Dedicated, resilient T-SQL parser supporting:
 * - CTEs and recursive CTEs
 * - 2-part, 3-part, 4-part names with bracketed/quoted identifiers
 * - INNER, LEFT, RIGHT, FULL, CROSS JOIN, CROSS APPLY, OUTER APPLY
 * - Window functions (OVER PARTITION BY / ORDER BY)
 * - CASE WHEN expressions
 * - Table hints (WITH NOLOCK)
 * - SELECT * vs COUNT(*) disambiguation
 * - Subqueries (Scalar, Correlated, EXISTS, IN)
 * - Set operations (UNION, UNION ALL)
 */

const { createCanonicalAst } = require('../canonicalModel');

function cleanIdentifier(id) {
  if (!id) return '';
  let str = id.trim();
  // Strip brackets [ ]
  if (str.startsWith('[') && str.endsWith(']')) {
    str = str.slice(1, -1);
  }
  // Strip double quotes " "
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.slice(1, -1);
  }
  return str.trim();
}

/**
 * Normalizes multi-part object names: [db].[schema].[table]
 */
function parseQualifiedObjectName(raw) {
  if (!raw) return { database: null, schema: null, object: '', raw: '' };
  
  const rawStr = raw.trim();
  // Match bracketed or unbracketed parts separated by dots
  const parts = [];
  const regex = /(?:\[([^\]]+)\]|"([^"]+)"|([^\s.()]+))/g;
  let match;
  while ((match = regex.exec(rawStr)) !== null) {
    const val = match[1] || match[2] || match[3];
    if (val) parts.push(val);
  }

  if (parts.length >= 3) {
    return {
      database: parts[parts.length - 3],
      schema: parts[parts.length - 2],
      object: parts[parts.length - 1],
      raw: rawStr
    };
  } else if (parts.length === 2) {
    return {
      database: null,
      schema: parts[0],
      object: parts[1],
      raw: rawStr
    };
  } else if (parts.length === 1) {
    return {
      database: null,
      schema: null,
      object: parts[0],
      raw: rawStr
    };
  }

  return { database: null, schema: null, object: rawStr, raw: rawStr };
}

/**
 * Tokenize T-SQL while preserving string literals and comments
 */
function tokenizeTsql(sql) {
  const tokens = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // 1. Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // 2. Line Comment --
    if (ch === '-' && sql[i + 1] === '-') {
      const start = i;
      while (i < len && sql[i] !== '\n') i++;
      tokens.push({ type: 'COMMENT', value: sql.slice(start, i) });
      continue;
    }

    // 3. Block Comment /* ... */
    if (ch === '/' && sql[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(sql[i - 1] === '*' && ch === '/')) {
        i++;
      }
      tokens.push({ type: 'COMMENT', value: sql.slice(start, i) });
      continue;
    }

    // 4. String Literal '...' or N'...'
    if (ch === '\'' || (ch === 'N' && sql[i + 1] === '\'')) {
      const isUnicode = ch === 'N';
      if (isUnicode) i++;
      const start = i;
      i++; // skip opening quote
      while (i < len) {
        if (sql[i] === '\'') {
          if (sql[i + 1] === '\'') {
            i += 2; // escaped quote ''
          } else {
            i++; // closing quote
            break;
          }
        } else {
          i++;
        }
      }
      tokens.push({ type: 'STRING', value: sql.slice(start, i) });
      continue;
    }

    // 5. Bracketed Identifier [ ... ]
    if (ch === '[') {
      const start = i;
      i++;
      while (i < len && sql[i] !== ']') i++;
      if (i < len) i++; // skip ']'
      tokens.push({ type: 'BRACKET_ID', value: sql.slice(start, i) });
      continue;
    }

    // 6. Quoted Identifier " ... "
    if (ch === '"') {
      const start = i;
      i++;
      while (i < len && sql[i] !== '"') i++;
      if (i < len) i++;
      tokens.push({ type: 'QUOTED_ID', value: sql.slice(start, i) });
      continue;
    }

    // 7. Operators and Punctuators
    if ('(),;.=<>!+-*/%'.includes(ch)) {
      // 2-char operators: <=, >=, <>, !=
      const twoChar = sql.slice(i, i + 2);
      if (['<=', '>=', '<>', '!='].includes(twoChar)) {
        tokens.push({ type: 'OPERATOR', value: twoChar });
        i += 2;
        continue;
      }
      tokens.push({ type: 'PUNCTUATOR', value: ch });
      i++;
      continue;
    }

    // 8. Word or Number
    const start = i;
    while (i < len && !/[\s(),;.=<>!+\-*/%[\]'"]/.test(sql[i])) {
      i++;
    }
    const word = sql.slice(start, i);
    const upper = word.toUpperCase();

    tokens.push({
      type: /^[0-9]+(?:\.[0-9]+)?$/.test(word) ? 'NUMBER' : 'WORD',
      value: word,
      upper
    });
  }

  return tokens;
}

/**
 * Strips comments from SQL text while preserving exact string literals
 */
function stripComments(sql = '') {
  let inString = false;
  let inBlockComment = false;
  let inLineComment = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (!inString && !inBlockComment && !inLineComment) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '\'') {
        inString = true;
        result += ch;
        continue;
      }
      result += ch;
    } else if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        result += '\n';
      }
    } else if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
    } else if (inString) {
      result += ch;
      if (ch === '\'') {
        if (next === '\'') {
          result += next;
          i++;
        } else {
          inString = false;
        }
      }
    }
  }

  return result;
}

/**
 * Extracts CTEs: WITH name [(cols)] AS ( ... )
 */
function extractCtes(cleanSql) {
  const ctes = [];
  // Match WITH ... AS ( ... )
  const withRegex = /\bWITH\s+([a-zA-Z0-9_#\[\]]+)\s*(?:\([^)]+\))?\s+AS\s*\(/gi;
  let match;
  let searchPos = 0;

  // Verify WITH is at start of query (not a table hint like WITH (NOLOCK))
  const trimmed = cleanSql.trim();
  if (!trimmed.toUpperCase().startsWith('WITH')) {
    return ctes;
  }

  while ((match = withRegex.exec(cleanSql)) !== null) {
    const cteName = cleanIdentifier(match[1]);
    const openParenIdx = withRegex.lastIndex - 1;
    
    // Find matching closing paren
    let depth = 1;
    let idx = openParenIdx + 1;
    while (idx < cleanSql.length && depth > 0) {
      if (cleanSql[idx] === '(') depth++;
      else if (cleanSql[idx] === ')') depth--;
      idx++;
    }

    const cteBody = cleanSql.substring(openParenIdx + 1, idx - 1);
    const isRecursive = new RegExp(`\\b${cteName}\\b`, 'i').test(cteBody);

    ctes.push({
      name: cteName,
      isRecursive,
      sql: cteBody.trim()
    });

    // Check if next is a comma for chained CTEs
    const rest = cleanSql.slice(idx).trim();
    if (rest.startsWith(',')) {
      withRegex.lastIndex = idx + 1;
    } else {
      break;
    }
  }

  return ctes;
}

/**
 * Parses expressions in WHERE / ON / HAVING
 */
function parsePredicates(sqlSection, clauseType = 'WHERE') {
  if (!sqlSection) return [];
  const predicates = [];
  
  // Split conditions by top-level AND / OR (ignoring parentheses)
  let depth = 0;
  let lastIdx = 0;
  const parts = [];

  for (let i = 0; i < sqlSection.length; i++) {
    const ch = sqlSection[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) {
      const rest = sqlSection.slice(i);
      const andMatch = rest.match(/^\s+AND\s+/i);
      const orMatch = rest.match(/^\s+OR\s+/i);

      if (andMatch) {
        parts.push({ text: sqlSection.slice(lastIdx, i).trim(), logicalOp: 'AND' });
        i += andMatch[0].length - 1;
        lastIdx = i + 1;
      } else if (orMatch) {
        parts.push({ text: sqlSection.slice(lastIdx, i).trim(), logicalOp: 'OR' });
        i += orMatch[0].length - 1;
        lastIdx = i + 1;
      }
    }
  }
  if (lastIdx < sqlSection.length) {
    parts.push({ text: sqlSection.slice(lastIdx).trim(), logicalOp: null });
  }

  // Operator regex
  const opRegex = /(=|<>|!=|<=|>=|<|>|\bLIKE\b|\bNOT\s+LIKE\b|\bIN\b|\bNOT\s+IN\b|\bIS\s+NULL\b|\bIS\s+NOT\s+NULL\b|\bBETWEEN\b)/i;

  for (const part of parts) {
    const exprText = part.text;
    if (!exprText) continue;

    const opMatch = exprText.match(opRegex);
    const operator = opMatch ? opMatch[1].toUpperCase() : 'UNKNOWN';
    let leftExpr = '';
    let rightExpr = '';

    if (opMatch) {
      leftExpr = exprText.substring(0, opMatch.index).trim();
      rightExpr = exprText.substring(opMatch.index + opMatch[0].length).trim();
    } else {
      leftExpr = exprText;
    }

    // Extract column references (e.g. t.col, [col], col)
    const colMatches = exprText.match(/(?:[a-zA-Z0-9_#\[\]]+\.)?[a-zA-Z0-9_#\[\]]+/g) || [];
    const columns = colMatches
      .filter(c => !/^\d+(?:\.\d+)?$/.test(c))
      .filter(c => !/^(AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|NULL|IS|CASE|WHEN|THEN|ELSE|END|YEAR|MONTH|DAY|CONVERT|CAST|ISNULL|COALESCE|DATEADD|DATEDIFF|LEFT|RIGHT|SUBSTRING|UPPER|LOWER)$/i.test(c))
      .map(cleanIdentifier);

    // Extract functions called in leftExpression
    const funcRegex = /\b([a-zA-Z0-9_]+)\s*\(/g;
    const functions = [];
    let fMatch;
    while ((fMatch = funcRegex.exec(leftExpr)) !== null) {
      functions.push(fMatch[1].toUpperCase());
    }

    predicates.push({
      clause: clauseType,
      logicalOp: part.logicalOp,
      expression: exprText,
      leftExpression: leftExpr,
      operator,
      rightExpression: rightExpr,
      columns,
      functions
    });
  }

  return predicates;
}

/**
 * Parses projections (SELECT ...)
 */
function parseProjections(selectSection) {
  const projections = [];
  if (!selectSection) return projections;

  // Split projections by top-level commas
  let depth = 0;
  let lastIdx = 0;
  const items = [];

  for (let i = 0; i < selectSection.length; i++) {
    const ch = selectSection[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      items.push(selectSection.slice(lastIdx, i).trim());
      lastIdx = i + 1;
    }
  }
  if (lastIdx < selectSection.length) {
    items.push(selectSection.slice(lastIdx).trim());
  }

  for (const rawItem of items) {
    if (!rawItem) continue;

    // Check for SELECT * or table.*
    if (rawItem === '*') {
      projections.push({
        expression: '*',
        alias: '*',
        isWildcard: true,
        tableAlias: null
      });
      continue;
    }

    const tableWildcard = rawItem.match(/^([a-zA-Z0-9_#\[\]]+)\.\*$/);
    if (tableWildcard) {
      projections.push({
        expression: rawItem,
        alias: '*',
        isWildcard: true,
        tableAlias: cleanIdentifier(tableWildcard[1])
      });
      continue;
    }

    // Check for alias: expression AS alias or alias = expression
    let expr = rawItem;
    let alias = '';

    const eqMatch = rawItem.match(/^([a-zA-Z0-9_#\[\]]+)\s*=\s*([\s\S]+)$/);
    const asMatch = rawItem.match(/([\s\S]+?)\s+AS\s+([a-zA-Z0-9_#\[\]]+)$/i);

    if (eqMatch) {
      alias = cleanIdentifier(eqMatch[1]);
      expr = eqMatch[2].trim();
    } else if (asMatch) {
      alias = cleanIdentifier(asMatch[2]);
      expr = asMatch[1].trim();
    } else {
      // Unaliased column: e.g. t.col -> alias col
      const colOnly = rawItem.match(/(?:\.|\b)([a-zA-Z0-9_#\[\]]+)$/);
      alias = colOnly ? cleanIdentifier(colOnly[1]) : rawItem;
    }

    projections.push({
      expression: expr,
      alias,
      isWildcard: false,
      hasWindowFunction: /\bOVER\s*\(/i.test(expr),
      hasCase: /\bCASE\b/i.test(expr),
      hasScalarSubquery: /^\s*\(\s*SELECT\b/i.test(expr)
    });
  }

  return projections;
}

function findTopLevelKeyword(sql, keyword, startPos = 0) {
  let depth = 0;
  let inString = false;
  const kwLen = keyword.length;
  const upperSql = sql.toUpperCase();
  const targetKw = keyword.toUpperCase();

  for (let i = startPos; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '\'') {
      if (sql[i + 1] === '\'') {
        i++;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;

    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      const isStartWord = i === 0 || /[\s(),;]/.test(sql[i - 1]);
      if (isStartWord && upperSql.startsWith(targetKw, i)) {
        const nextCharPos = i + kwLen;
        const isEndWord = nextCharPos >= sql.length || /[\s(),;]/.test(sql[nextCharPos]);
        if (isEndWord) {
          return i;
        }
      }
    }
  }
  return -1;
}

function findFirstTopLevelKeyword(sql, keywords = [], startPos = 0) {
  let earliestIdx = -1;
  let matchedKw = null;
  for (const kw of keywords) {
    const idx = findTopLevelKeyword(sql, kw, startPos);
    if (idx >= 0 && (earliestIdx === -1 || idx < earliestIdx)) {
      earliestIdx = idx;
      matchedKw = kw;
    }
  }
  return { index: earliestIdx, keyword: matchedKw };
}

function findTopLevelJoins(fromSection) {
  const joinTypes = [
    'INNER JOIN',
    'LEFT OUTER JOIN',
    'LEFT JOIN',
    'RIGHT OUTER JOIN',
    'RIGHT JOIN',
    'FULL OUTER JOIN',
    'FULL JOIN',
    'CROSS JOIN',
    'CROSS APPLY',
    'OUTER APPLY',
    'JOIN'
  ];

  const results = [];
  let depth = 0;
  let inString = false;
  const upper = fromSection.toUpperCase();

  for (let i = 0; i < fromSection.length; i++) {
    const ch = fromSection[i];
    if (ch === '\'') {
      if (fromSection[i + 1] === '\'') i++;
      else inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      const isStart = i === 0 || /[\s(),;]/.test(fromSection[i - 1]);
      if (isStart) {
        for (const jt of joinTypes) {
          if (upper.startsWith(jt, i)) {
            const nextPos = i + jt.length;
            const isEnd = nextPos >= fromSection.length || /[\s(),;]/.test(fromSection[nextPos]);
            if (isEnd) {
              results.push({
                type: jt === 'JOIN' ? 'INNER JOIN' : jt.replace(/\s+OUTER\s+/, ' ').replace(/\s+/, ' '),
                start: i,
                end: nextPos
              });
              i = nextPos - 1;
              break;
            }
          }
        }
      }
    }
  }
  return results;
}

/**
 * Main parse function
 */
function parseTsql(sql = '') {
  if (!sql || typeof sql !== 'string') {
    return createCanonicalAst({ status: 'AST_FAILED', parseErrors: ['Boş veya geçersiz SQL metni.'] });
  }

  const clean = stripComments(sql).trim();
  if (!clean) {
    return createCanonicalAst({ status: 'AST_FAILED', parseErrors: ['Yorumlar temizlendikten sonra SQL boş kaldı.'] });
  }

  try {
    const ctes = extractCtes(clean);

    // Identify main query (after CTEs if present)
    let mainSql = clean;
    if (ctes.length > 0) {
      // Find the end of the last CTE definition
      const lastCte = ctes[ctes.length - 1];
      const lastCteIdx = clean.indexOf(lastCte.sql);
      if (lastCteIdx >= 0) {
        const afterCte = clean.indexOf(')', lastCteIdx + lastCte.sql.length);
        if (afterCte >= 0) {
          mainSql = clean.slice(afterCte + 1).trim();
        }
      }
    }

    // Check Set Operations: UNION / UNION ALL
    const unions = [];
    const unionMatches = mainSql.matchAll(/\bUNION(?:\s+(ALL))?\b/gi);
    for (const u of unionMatches) {
      unions.push({
        type: u[1] ? 'UNION ALL' : 'UNION',
        isDistinct: !Boolean(u[1])
      });
    }

    // SELECT Distinct & Top
    const hasDistinct = /\bSELECT\s+(?:TOP\s+\(?\d+\)?\s+(?:PERCENT\s+)?(?:WITH\s+TIES\s+)?)?DISTINCT\b/i.test(mainSql);
    const topMatch = mainSql.match(/\bSELECT\s+(?:DISTINCT\s+)?TOP\s+\(?(\d+)\)?(?:\s+PERCENT)?/i);
    const hasTop = Boolean(topMatch);
    const topCount = topMatch ? parseInt(topMatch[1], 10) : null;

    // Extract Projections (between SELECT and outer FROM)
    let selectSection = '';
    const selectIdx = findTopLevelKeyword(mainSql, 'SELECT');
    const fromIdx = findTopLevelKeyword(mainSql, 'FROM', selectIdx >= 0 ? selectIdx + 6 : 0);

    if (selectIdx >= 0 && fromIdx > selectIdx) {
      let rawSel = mainSql.substring(selectIdx + 6, fromIdx).trim();
      rawSel = rawSel.replace(/^DISTINCT\s+/i, '');
      rawSel = rawSel.replace(/^TOP\s+\(?\d+\)?(?:\s+PERCENT)?(?:\s+WITH\s+TIES)?\s+/i, '');
      selectSection = rawSel;
    }

    const projections = parseProjections(selectSection);
    const hasWildcardSelect = projections.some(p => p.isWildcard);

    // Extract Tables & Joins
    const tables = [];
    const joins = [];

    // Match FROM clause
    if (fromIdx >= 0) {
      const afterFrom = mainSql.slice(fromIdx + 4).trim();
      
      // Stop at outer WHERE, GROUP BY, HAVING, ORDER BY, UNION
      const endMatch = findFirstTopLevelKeyword(afterFrom, ['WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'UNION']);
      let clauseEnd = endMatch.index >= 0 ? endMatch.index : afterFrom.length;

      const fromSection = afterFrom.slice(0, clauseEnd).trim();

      // Parse FROM source and subsequent JOINs (at depth 0)
      const joinIndices = findTopLevelJoins(fromSection);

      // First table
      const firstTableText = joinIndices.length > 0 
        ? fromSection.slice(0, joinIndices[0].start).trim() 
        : fromSection.trim();

      if (firstTableText) {
        const tObj = parseTableExpression(firstTableText, ctes);
        if (tObj) tables.push(tObj);
      }

      // Parse JOIN entries
      for (let j = 0; j < joinIndices.length; j++) {
        const cur = joinIndices[j];
        const nextStart = j + 1 < joinIndices.length ? joinIndices[j + 1].start : fromSection.length;
        const joinBody = fromSection.slice(cur.end, nextStart).trim();

        // Split target table and ON clause at depth 0
        let targetPart = joinBody;
        let onPart = '';

        const onIdx = findTopLevelKeyword(joinBody, 'ON');
        if (onIdx >= 0) {
          targetPart = joinBody.slice(0, onIdx).trim();
          onPart = joinBody.slice(onIdx + 2).trim();
        }

        const rightTable = parseTableExpression(targetPart, ctes);
        if (rightTable) {
          tables.push(rightTable);
        }

        const onPredicates = onPart ? parsePredicates(onPart, 'ON') : [];
        const involvedColumns = [];
        for (const p of onPredicates) {
          for (const col of p.columns) {
            if (!involvedColumns.includes(col)) involvedColumns.push(col);
          }
        }

        joins.push({
          type: cur.type,
          leftSource: tables[0]?.alias || tables[0]?.object || 'PRIMARY',
          rightSource: rightTable?.alias || rightTable?.object || 'JOIN_TARGET',
          table: rightTable,
          onPredicate: onPart,
          predicates: onPredicates,
          involvedColumns,
          hasNoPredicate: !onPart && !cur.type.includes('APPLY') && cur.type !== 'CROSS JOIN'
        });
      }
    }

    // WHERE clause (at depth 0)
    let predicates = [];
    const whereIdx = findTopLevelKeyword(mainSql, 'WHERE');
    if (whereIdx >= 0) {
      const afterWhere = mainSql.slice(whereIdx + 5).trim();
      const whereEndMatch = findFirstTopLevelKeyword(afterWhere, ['GROUP BY', 'HAVING', 'ORDER BY', 'UNION']);
      let whereEnd = whereEndMatch.index >= 0 ? whereEndMatch.index : afterWhere.length;
      const whereSection = afterWhere.slice(0, whereEnd).trim();
      predicates = parsePredicates(whereSection, 'WHERE');
    }

    // Window Functions (OVER clause)
    const windowFunctions = [];
    const overRegex = /\b([a-zA-Z0-9_]+)\s*\([^)]*\)\s*OVER\s*\(([^)]*)\)/gi;
    let wMatch;
    while ((wMatch = overRegex.exec(clean)) !== null) {
      const funcName = wMatch[1].toUpperCase();
      const overContent = wMatch[2].trim();
      
      const partMatch = overContent.match(/PARTITION\s+BY\s+([\s\S]*?)(?:\s+ORDER\s+BY|$)/i);
      const orderMatch = overContent.match(/ORDER\s+BY\s+([^)]+)/i);

      windowFunctions.push({
        function: funcName,
        partitionBy: partMatch ? partMatch[1].trim() : null,
        orderBy: orderMatch ? orderMatch[1].trim() : null,
        raw: wMatch[0]
      });
    }

    // Subqueries
    const subqueries = [];
    const selectSubqRegex = /\(\s*SELECT\b/gi;
    let sMatch;
    while ((sMatch = selectSubqRegex.exec(clean)) !== null) {
      const openParenIdx = sMatch.index;
      let depth = 1;
      let idx = openParenIdx + 1;
      while (idx < clean.length && depth > 0) {
        if (clean[idx] === '(') depth++;
        else if (clean[idx] === ')') depth--;
        idx++;
      }
      const subqBody = clean.substring(openParenIdx + 1, idx - 1).trim();
      const before = clean.substring(Math.max(0, openParenIdx - 25), openParenIdx).trim();
      const isExists = /\bEXISTS\s*$/i.test(before);
      const isIn = /\b(?:NOT\s+)?IN\s*$/i.test(before);
      
      // Check correlation: references outer table alias
      let isCorrelated = false;
      for (const t of tables) {
        if (t.alias && new RegExp(`\\b${t.alias}\\.`, 'i').test(subqBody)) {
          isCorrelated = true;
          break;
        }
      }

      subqueries.push({
        type: isExists ? 'EXISTS' : (isIn ? 'IN' : 'SCALAR_SUBQUERY'),
        isCorrelated,
        sql: subqBody
      });

      selectSubqRegex.lastIndex = idx;
    }

    return createCanonicalAst({
      analysisSource: 'AST',
      status: 'AST_AVAILABLE',
      tables,
      joins,
      predicates,
      projections,
      ctes,
      subqueries,
      windowFunctions,
      unions,
      hasWildcardSelect,
      hasDistinct,
      hasTop,
      topCount
    });

  } catch (err) {
    return createCanonicalAst({
      analysisSource: 'AST',
      status: 'AST_PARTIAL',
      parseErrors: [err.message]
    });
  }
}

/**
 * Parses table expression (e.g. [dbo].[STOK_HAREKETLERI] AS sh WITH (NOLOCK))
 */
function parseTableExpression(text = '', ctes = []) {
  if (!text) return null;

  // Extract table hint if any: WITH (NOLOCK)
  let cleaned = text;
  let hint = null;
  const hintMatch = text.match(/\bWITH\s*\(([^)]+)\)/i);
  if (hintMatch) {
    hint = hintMatch[1].trim();
    cleaned = text.replace(hintMatch[0], ' ');
  }

  // Derived table: (SELECT ...) AS alias
  if (cleaned.startsWith('(')) {
    const asMatch = cleaned.match(/\)\s*(?:AS\s+)?([a-zA-Z0-9_#\[\]]+)$/i);
    const alias = asMatch ? cleanIdentifier(asMatch[1]) : 'derived_tbl';
    return {
      referenceType: 'DERIVED_TABLE',
      database: null,
      schema: null,
      object: alias,
      alias,
      hint
    };
  }

  // Regular object: [db].[schema].[table] [AS] [alias]
  const tokens = cleaned.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  const objNamePart = tokens[0];
  const qObj = parseQualifiedObjectName(objNamePart);

  let alias = null;
  if (tokens.length >= 3 && tokens[1].toUpperCase() === 'AS') {
    alias = cleanIdentifier(tokens[2]);
  } else if (tokens.length >= 2 && tokens[1].toUpperCase() !== 'AS') {
    alias = cleanIdentifier(tokens[1]);
  }

  // Check if this object is a CTE reference
  const isCte = ctes.some(c => c.name.toLowerCase() === qObj.object.toLowerCase());
  const referenceType = isCte ? 'CTE_REFERENCE' : (qObj.object.startsWith('#') ? 'TEMP_TABLE' : 'BASE_TABLE');

  return {
    referenceType,
    database: qObj.database,
    schema: qObj.schema || 'dbo',
    object: qObj.object,
    alias: alias || qObj.object,
    hint
  };
}

module.exports = {
  parseTsql,
  cleanIdentifier,
  parseQualifiedObjectName,
  stripComments
};
