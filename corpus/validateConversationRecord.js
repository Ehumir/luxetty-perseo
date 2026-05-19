'use strict';

const {
  RECORD_SCHEMA_VERSION,
  VALID_ROLES,
  PROMOTION_STATUSES,
  SOURCE_FORMATS,
} = require('./constants');
const { computeOutcomeHash } = require('./outcomeHash');

/**
 * @typedef {object} ValidationIssue
 * @property {'error'|'warning'} level
 * @property {string} code
 * @property {string} message
 * @property {string} [path]
 */

/**
 * @param {unknown} record
 * @param {{ computeHash?: boolean }} [opts]
 * @returns {{ ok: boolean, issues: ValidationIssue[], record?: object, outcome_hash?: string }}
 */
function validateConversationRecord(record, opts = {}) {
  const issues = [];
  const computeHash = opts.computeHash !== false;

  if (!record || typeof record !== 'object') {
    return {
      ok: false,
      issues: [{ level: 'error', code: 'not_object', message: 'Record must be an object' }],
    };
  }

  const r = /** @type {Record<string, unknown>} */ (record);

  if (r.record_schema_version !== RECORD_SCHEMA_VERSION) {
    issues.push({
      level: 'error',
      code: 'invalid_schema_version',
      message: `record_schema_version must be "${RECORD_SCHEMA_VERSION}"`,
      path: 'record_schema_version',
    });
  }

  if (typeof r.corpus_id !== 'string' || !r.corpus_id.trim()) {
    issues.push({
      level: 'error',
      code: 'missing_corpus_id',
      message: 'corpus_id is required',
      path: 'corpus_id',
    });
  }

  const source = r.source;
  if (!source || typeof source !== 'object') {
    issues.push({
      level: 'error',
      code: 'missing_source',
      message: 'source object is required',
      path: 'source',
    });
  } else {
    const s = /** @type {Record<string, unknown>} */ (source);
    if (typeof s.format !== 'string' || !SOURCE_FORMATS.has(s.format)) {
      issues.push({
        level: 'error',
        code: 'invalid_source_format',
        message: `source.format must be one of: ${[...SOURCE_FORMATS].join(', ')}`,
        path: 'source.format',
      });
    }
    if (typeof s.file !== 'string' || !s.file.trim()) {
      issues.push({
        level: 'error',
        code: 'missing_source_file',
        message: 'source.file is required',
        path: 'source.file',
      });
    }
    if (s.imported_at != null && typeof s.imported_at !== 'string') {
      issues.push({
        level: 'error',
        code: 'invalid_imported_at',
        message: 'source.imported_at must be ISO-8601 string when present',
        path: 'source.imported_at',
      });
    }
  }

  if (!r.metadata || typeof r.metadata !== 'object') {
    issues.push({
      level: 'error',
      code: 'missing_metadata',
      message: 'metadata object is required',
      path: 'metadata',
    });
  }

  if (!Array.isArray(r.turns) || r.turns.length === 0) {
    issues.push({
      level: 'error',
      code: 'missing_turns',
      message: 'turns must be a non-empty array',
      path: 'turns',
    });
  } else {
    r.turns.forEach((turn, i) => {
      if (!turn || typeof turn !== 'object') {
        issues.push({
          level: 'error',
          code: 'invalid_turn',
          message: `turn[${i}] must be an object`,
          path: `turns[${i}]`,
        });
        return;
      }
      const t = /** @type {Record<string, unknown>} */ (turn);
      if (typeof t.index !== 'number' || t.index !== i) {
        issues.push({
          level: 'error',
          code: 'invalid_turn_index',
          message: `turn[${i}].index must be ${i}`,
          path: `turns[${i}].index`,
        });
      }
      if (typeof t.role !== 'string' || !VALID_ROLES.has(t.role)) {
        issues.push({
          level: 'error',
          code: 'invalid_turn_role',
          message: `turn[${i}].role must be one of: ${[...VALID_ROLES].join(', ')}`,
          path: `turns[${i}].role`,
        });
      }
      if (typeof t.text !== 'string' || !t.text.trim()) {
        issues.push({
          level: 'error',
          code: 'invalid_turn_text',
          message: `turn[${i}].text must be non-empty string`,
          path: `turns[${i}].text`,
        });
      }
      if (t.attachments != null && !Array.isArray(t.attachments)) {
        issues.push({
          level: 'error',
          code: 'invalid_attachments',
          message: `turn[${i}].attachments must be an array`,
          path: `turns[${i}].attachments`,
        });
      }
    });
  }

  if (!r.labels || typeof r.labels !== 'object') {
    issues.push({
      level: 'error',
      code: 'missing_labels',
      message: 'labels object is required',
      path: 'labels',
    });
  }

  const promotion = r.promotion;
  if (!promotion || typeof promotion !== 'object') {
    issues.push({
      level: 'error',
      code: 'missing_promotion',
      message: 'promotion object is required',
      path: 'promotion',
    });
  } else {
    const p = /** @type {Record<string, unknown>} */ (promotion);
    if (typeof p.status !== 'string' || !PROMOTION_STATUSES.has(p.status)) {
      issues.push({
        level: 'error',
        code: 'invalid_promotion_status',
        message: `promotion.status must be one of: ${[...PROMOTION_STATUSES].join(', ')}`,
        path: 'promotion.status',
      });
    }
    if (p.status === 'promoted' && (p.promoted_scenario == null || p.promoted_scenario === '')) {
      issues.push({
        level: 'warning',
        code: 'promoted_without_scenario',
        message: 'promotion.status=promoted should set promoted_scenario',
        path: 'promotion.promoted_scenario',
      });
    }
    if (p.status === 'auto_promoted') {
      issues.push({
        level: 'error',
        code: 'auto_promote_forbidden',
        message: 'auto_promoted is forbidden; promotion must be manual',
        path: 'promotion.status',
      });
    }
  }

  if (r.attachments != null && !Array.isArray(r.attachments)) {
    issues.push({
      level: 'error',
      code: 'invalid_record_attachments',
      message: 'attachments must be an array when present',
      path: 'attachments',
    });
  }

  if (r.risk_tags != null && !Array.isArray(r.risk_tags)) {
    issues.push({
      level: 'error',
      code: 'invalid_risk_tags',
      message: 'risk_tags must be an array when present',
      path: 'risk_tags',
    });
  }

  if (r.policy_tags != null && !Array.isArray(r.policy_tags)) {
    issues.push({
      level: 'error',
      code: 'invalid_policy_tags',
      message: 'policy_tags must be an array when present',
      path: 'policy_tags',
    });
  }

  const hasErrors = issues.some((i) => i.level === 'error');
  let outcome_hash;
  if (!hasErrors && computeHash) {
    outcome_hash = computeOutcomeHash(/** @type {object} */ (record));
    if (r.outcome_hash && r.outcome_hash !== outcome_hash) {
      issues.push({
        level: 'warning',
        code: 'outcome_hash_mismatch',
        message: `outcome_hash mismatch: expected ${outcome_hash}, got ${r.outcome_hash}`,
        path: 'outcome_hash',
      });
    }
  }

  return {
    ok: !hasErrors,
    issues,
    record: hasErrors ? undefined : record,
    outcome_hash,
  };
}

module.exports = {
  validateConversationRecord,
  PROMOTION_STATUSES,
  VALID_ROLES,
};
