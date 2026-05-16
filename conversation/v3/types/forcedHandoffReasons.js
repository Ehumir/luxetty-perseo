'use strict';

/** @enum {string} Razones auditables de fallback forzado (F3.3B). */
const FORCED_HANDOFF_REASONS = Object.freeze({
  INTENT_UNKNOWN: 'intent_unknown',
  RULE_GUARD_VIOLATION: 'rule_guard_violation',
  LOOP_EXHAUSTED: 'loop_exhausted',
  FRUSTRATION_HIGH: 'frustration_high',
  MEDIA_UNSUPPORTED: 'media_unsupported',
  LEGAL_ESCALATION: 'legal_escalation',
  RUNTIME_ERROR: 'runtime_error',
  USER_REQUESTS_HUMAN: 'user_requests_human',
  OUT_OF_CATALOG: 'out_of_catalog',
});

const ALL_FORCED_HANDOFF_REASONS = new Set(Object.values(FORCED_HANDOFF_REASONS));

const HUMAN_ESCALATION_REASONS = new Set([
  FORCED_HANDOFF_REASONS.FRUSTRATION_HIGH,
  FORCED_HANDOFF_REASONS.LEGAL_ESCALATION,
]);

module.exports = {
  FORCED_HANDOFF_REASONS,
  ALL_FORCED_HANDOFF_REASONS,
  HUMAN_ESCALATION_REASONS,
};
