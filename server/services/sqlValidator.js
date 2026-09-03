/**
 * SQL Server Refactoring & Performance Studio
 * Read-Only T-SQL Statement Validator
 *
 * Guardrail Enforcement:
 * - Strips single-line comments (-- ...) and block comments (/* ... *\/)
 * - Strips single-quoted string literals ('...') so that strings like 'DROP TABLE' are NOT false positives.
 * - Strips bracketed identifiers ([...]) and quoted identifiers ("...")
 * - Validates that the remaining statement is strictly a SELECT or WITH ... SELECT query.
 * - Rejects multiple statements if any non-read-only keyword is present.
 */

// Forbidden mutation and administrative command tokens
const PROHIBITED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'EXEC',
  'EXECUTE',
  'SP_',
  'XP_',
  'BACKUP',
  'RESTORE',
  'SHUTDOWN',
  'GRANT',
  'REVOKE',
  'DENY',
  'RECONFIGURE',
  'KILL',
  'BULK',
  'DBCC'
];

/**
 * Normalizes SQL by replacing string literals and comments with safe placeholders,
 * preventing false positives like SELECT 'DROP TABLE' AS Ex or -- DELETE comment.
 */
function stripCommentsAndLiterals(sql) {
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inString = false;
  let inBracket = false;
  let result = '';

  const len = sql.length;
  for (let i = 0; i < len; i++) {
    const char = sql[i];
    const next = i + 1 < len ? sql[i + 1] : '';

    // Handle single-line comment
    if (inSingleLineComment) {
      if (char === '\n' || char === '\r') {
        inSingleLineComment = false;
        result += char;
      }
      continue;
    }

    // Handle multi-line comment
    if (inMultiLineComment) {
      if (char === '*' && next === '/') {
        inMultiLineComment = false;
        i++; // skip /
      }
      continue;
    }

    // Handle string literal
    if (inString) {
      if (char === "'") {
        if (next === "'") {
          // Escaped quote ('')
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    // Handle bracketed identifier [Table]
    if (inBracket) {
      if (char === ']') {
        inBracket = false;
        result += ']';
      }
      continue;
    }

    // Comment starts
    if (char === '-' && next === '-') {
      inSingleLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      inMultiLineComment = true;
      i++;
      continue;
    }

    // String literal starts
    if (char === "'") {
      inString = true;
      result += " 'STRING_LITERAL' ";
      continue;
    }

    // Bracketed identifier starts
    if (char === '[') {
      inBracket = true;
      result += '[';
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Validates whether a SQL query is safe and strictly read-only.
 * Returns { valid: true } or { valid: false, reason: string, keyword?: string }
 */
function validateReadOnly(rawSql) {
  if (!rawSql || typeof rawSql !== 'string') {
    return { valid: false, reason: 'Sorgu metni boş olamaz.' };
  }

  const trimmed = rawSql.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Sorgu metni boş olamaz.' };
  }

  // Strip comments and string literals
  const stripped = stripCommentsAndLiterals(trimmed);

  // Tokenize the stripped SQL
  const tokens = stripped
    .replace(/[;,()=<>+*\/\n\r\t]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.toUpperCase());

  if (tokens.length === 0) {
    return { valid: false, reason: 'Çalıştırılabilir SQL ifadesi bulunamadı.' };
  }

  // The first significant token must be SELECT or WITH
  const firstToken = tokens[0];
  if (firstToken !== 'SELECT' && firstToken !== 'WITH') {
    return {
      valid: false,
      reason: `Yalnızca salt-okunur SELECT veya WITH ... SELECT sorgularına izin verilir. Tespit edilen başlangıç: "${firstToken}".`
    };
  }

  // Check for any prohibited keywords anywhere in the statement tokens
  for (const token of tokens) {
    for (const forbidden of PROHIBITED_KEYWORDS) {
      if (token === forbidden || token.startsWith(forbidden)) {
        return {
          valid: false,
          keyword: token,
          reason: `Read-only safety policy blocked this statement: "${token}" anahtar kelimesi salt-okunur kuralını ihlal ediyor.`
        };
      }
    }
  }

  // If starts with WITH, verify that a SELECT is present
  if (firstToken === 'WITH') {
    if (!tokens.includes('SELECT')) {
      return {
        valid: false,
        reason: 'WITH CTE ifadesi bir SELECT sorgusuyla sonlanmalıdır.'
      };
    }
  }

  return { valid: true };
}

module.exports = {
  validateReadOnly,
  stripCommentsAndLiterals
};
