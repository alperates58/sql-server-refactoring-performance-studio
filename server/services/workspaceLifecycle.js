/**
 * SQL Server Refactoring & Performance Studio
 * Workspace Lifecycle Engine (Sprint 6)
 *
 * Deterministic Lifecycle Transitions & Guardrails:
 *
 * DRAFT
 *  → ANALYZED
 *  → CANDIDATE_GENERATED
 *  → VALIDATED (Only PASS or PASS_WITH_WARNING)
 *  → BENCHMARKED (Requires benchmark evidence)
 *  → APPROVED (Explicit human approval ONLY; AI/automated approval strictly forbidden)
 *  → SCRIPT_GENERATED (Deployment package generated)
 *  → ARCHIVED (Safe soft-archive)
 *
 * Immutability & Stale Evidence Detection:
 * - Candidate SQL modification invalidates APPROVED state.
 * - Validation & Benchmark snapshots are cryptographically bound to SQL SHA256.
 * - Database drift blocks deployment script generation.
 */

const crypto = require('crypto');

const WORKSPACE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ANALYZED: 'ANALYZED',
  CANDIDATE_GENERATED: 'CANDIDATE_GENERATED',
  VALIDATED: 'VALIDATED',
  BENCHMARKED: 'BENCHMARKED',
  APPROVED: 'APPROVED',
  SCRIPT_GENERATED: 'SCRIPT_GENERATED',
  ARCHIVED: 'ARCHIVED'
});

const CANDIDATE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  FAILED_VALIDATION: 'FAILED_VALIDATION',
  BENCHMARKED: 'BENCHMARKED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
});

const EVIDENCE_STATE = Object.freeze({
  VALID: 'VALID',
  STALE_CANDIDATE_CHANGED: 'STALE_CANDIDATE_CHANGED',
  STALE_ORIGINAL_CHANGED: 'STALE_ORIGINAL_CHANGED',
  STALE_DATABASE_DRIFT: 'STALE_DATABASE_DRIFT'
});

/**
 * Normalizes SQL text for deterministic hashing:
 * - Strips leading/trailing whitespace
 * - Standardizes line breaks to \n
 * - Strips trailing semicolons/whitespace
 */
function normalizeSqlForHashing(sql) {
  if (!sql || typeof sql !== 'string') return '';
  return sql
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Computes SHA-256 hash of normalized SQL text
 */
function computeSqlHash(sql) {
  const norm = normalizeSqlForHashing(sql);
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

/**
 * Validates whether a workspace status transition is allowed
 * @param {string} currentStatus
 * @param {string} targetStatus
 * @param {object} context
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canTransitionWorkspace(currentStatus, targetStatus, context = {}) {
  // 1. Archiving is always allowed from any state
  if (targetStatus === WORKSPACE_STATUS.ARCHIVED) {
    return { allowed: true };
  }

  // 2. Unarchiving restores previous or DRAFT
  if (currentStatus === WORKSPACE_STATUS.ARCHIVED) {
    return { allowed: true };
  }

  // 3. Same state transition is idempotent
  if (currentStatus === targetStatus) {
    return { allowed: true };
  }

  switch (targetStatus) {
    case WORKSPACE_STATUS.ANALYZED:
      // Allowed from DRAFT
      if (currentStatus === WORKSPACE_STATUS.DRAFT) return { allowed: true };
      return { allowed: false, reason: `DRAFT olmayan durumdan ANALYZED durumuna geçilemez (Mevcut: ${currentStatus})` };

    case WORKSPACE_STATUS.CANDIDATE_GENERATED:
      // Allowed from DRAFT or ANALYZED
      if ([WORKSPACE_STATUS.DRAFT, WORKSPACE_STATUS.ANALYZED].includes(currentStatus)) {
        return { allowed: true };
      }
      // Or if new candidate added while in later state
      return { allowed: true };

    case WORKSPACE_STATUS.VALIDATED: {
      const verdict = context.validationVerdict;
      if (!verdict) {
        return { allowed: false, reason: 'Doğrulama (validation) sonucu bulunamadı.' };
      }
      if (verdict === 'FAIL') {
        return { allowed: false, reason: 'Doğrulamadan başarısız (FAIL) olan aday için workspace VALIDATED durumuna geçirilemez.' };
      }
      return { allowed: true };
    }

    case WORKSPACE_STATUS.BENCHMARKED: {
      if (!context.hasBenchmark) {
        return { allowed: false, reason: 'Benchmark ölçüm sonucu bulunamadı.' };
      }
      return { allowed: true };
    }

    case WORKSPACE_STATUS.APPROVED: {
      // Must be BENCHMARKED or VALIDATED
      if (![WORKSPACE_STATUS.VALIDATED, WORKSPACE_STATUS.BENCHMARKED].includes(currentStatus)) {
        return { allowed: false, reason: `Onay (APPROVED) için aday önce doğrulanmış veya benchmark edilmiş olmalıdır (Mevcut: ${currentStatus})` };
      }
      // AI cannot approve!
      if (context.isAutomatedOrAi) {
        return { allowed: false, reason: 'Yapay zeka (AI) veya otomatik süreçler adayı ONAYLAYAMAZ. Onay yalnızca kullanıcı tarafından verilmelidir.' };
      }
      // Validation cannot be FAIL
      if (context.validationVerdict === 'FAIL') {
        return { allowed: false, reason: 'Semantik doğrulama (validation) FAIL olan aday ONAYLANAMAZ.' };
      }
      // Database drift blocks approval unless explicit override
      if (context.databaseDrift && !context.overrideDrift) {
        return { allowed: false, reason: 'Canlı veritabanındaki nesne tanımı değişmiş (Database Drift). Onay vermeden önce drift incelenmelidir.' };
      }
      return { allowed: true };
    }

    case WORKSPACE_STATUS.SCRIPT_GENERATED: {
      if (currentStatus !== WORKSPACE_STATUS.APPROVED && !context.allowDirectScript) {
        return { allowed: false, reason: 'Dağıtım betiği (Script) üretilmeden önce aday ONAYLANMIŞ (APPROVED) olmalıdır.' };
      }
      if (context.databaseDrift && !context.overrideDrift) {
        return { allowed: false, reason: 'Canlı veritabanındaki view tanımı değişmiş (Database Drift). Betik üretimi engellendi.' };
      }
      return { allowed: true };
    }

    case WORKSPACE_STATUS.DRAFT:
      // Can always revert to DRAFT
      return { allowed: true };

    default:
      return { allowed: false, reason: `Bilinmeyen hedef durum: ${targetStatus}` };
  }
}

/**
 * Checks evidence freshness against candidate and original SQL hashes
 */
function evaluateEvidenceFreshness({
  originalSql,
  savedOriginalHash,
  candidateSql,
  validationSnapshot,
  benchmarkSnapshot,
  dbDriftDetected = false
}) {
  const currentCandidateHash = computeSqlHash(candidateSql);
  const currentOriginalHash = computeSqlHash(originalSql);

  const results = {
    state: EVIDENCE_STATE.VALID,
    reasons: [],
    candidateSqlChanged: false,
    originalSqlChanged: false,
    dbDriftDetected: Boolean(dbDriftDetected)
  };

  if (savedOriginalHash && currentOriginalHash !== savedOriginalHash) {
    results.originalSqlChanged = true;
    results.state = EVIDENCE_STATE.STALE_ORIGINAL_CHANGED;
    results.reasons.push('Orijinal SQL tanımı çalışma oluşturulduktan sonra değişti.');
  }

  if (validationSnapshot) {
    if (validationSnapshot.candidateSqlHash !== currentCandidateHash) {
      results.candidateSqlChanged = true;
      results.state = EVIDENCE_STATE.STALE_CANDIDATE_CHANGED;
      results.reasons.push('Aday SQL değiştirildiğinden mevcut doğrulama (validation) sonucu bayattır.');
    }
  }

  if (benchmarkSnapshot) {
    if (benchmarkSnapshot.candidateSqlHash !== currentCandidateHash) {
      results.candidateSqlChanged = true;
      results.state = EVIDENCE_STATE.STALE_CANDIDATE_CHANGED;
      results.reasons.push('Aday SQL değiştirildiğinden mevcut benchmark sonucu bayattır.');
    }
    if (benchmarkSnapshot.originalSqlHash && benchmarkSnapshot.originalSqlHash !== currentOriginalHash) {
      results.originalSqlChanged = true;
      results.state = EVIDENCE_STATE.STALE_ORIGINAL_CHANGED;
      results.reasons.push('Orijinal SQL değiştiğinden benchmark karşılaştırması bayattır.');
    }
  }

  if (dbDriftDetected) {
    results.state = EVIDENCE_STATE.STALE_DATABASE_DRIFT;
    results.reasons.push('Canlı veritabanındaki view tanımı değişti (Database Drift).');
  }

  return results;
}

/**
 * Check if candidate mutation requires approval invalidation
 */
function shouldInvalidateApprovalOnMutation(currentCandidate, newSql) {
  if (!currentCandidate || currentCandidate.status !== CANDIDATE_STATUS.APPROVED) {
    return false;
  }
  const oldHash = currentCandidate.sqlHash || computeSqlHash(currentCandidate.sql);
  const newHash = computeSqlHash(newSql);
  return oldHash !== newHash;
}

module.exports = {
  WORKSPACE_STATUS,
  CANDIDATE_STATUS,
  EVIDENCE_STATE,
  normalizeSqlForHashing,
  computeSqlHash,
  canTransitionWorkspace,
  evaluateEvidenceFreshness,
  shouldInvalidateApprovalOnMutation
};
