'use strict';

const DEFAULT_MAX_ATTEMPTS = 3;
const POISON_REPEAT_THRESHOLD = 2;

/**
 * Exponential backoff for CRM outbox retries (ms).
 * @param {number} attempts
 */
function computeCrmBackoffMs(attempts) {
  const a = Math.max(1, Number(attempts) || 1);
  if (a === 1) return 0;
  if (a === 2) return 30_000;
  return 120_000;
}

/**
 * Job poisoning: same error signature repeated → freeze (no infinite retries).
 * @param {object} job
 * @param {string} lastError
 */
function evaluateJobPoisoning(job, lastError) {
  const err = String(lastError || '').slice(0, 500);
  const prev = String(job.last_error_signature || '');
  const repeat = prev && prev === err ? (job.error_repeat_count || 0) + 1 : 1;
  const attempts = (job.attempts || 0) + 1;
  const maxAttempts = job.max_attempts || DEFAULT_MAX_ATTEMPTS;

  if (attempts >= maxAttempts) {
    return {
      action: 'dead_letter',
      reason: 'max_attempts_exceeded',
      attempts,
      error_repeat_count: repeat,
      last_error_signature: err,
      alert_reason: 'crm_outbox_max_attempts',
    };
  }

  if (repeat >= POISON_REPEAT_THRESHOLD) {
    return {
      action: 'freeze',
      reason: 'poisoned_repeated_error',
      attempts,
      error_repeat_count: repeat,
      last_error_signature: err,
      alert_reason: 'crm_outbox_poisoned',
    };
  }

  return {
    action: 'retry',
    reason: 'transient_failure',
    attempts,
    error_repeat_count: repeat,
    last_error_signature: err,
    backoff_ms: computeCrmBackoffMs(attempts),
  };
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  POISON_REPEAT_THRESHOLD,
  computeCrmBackoffMs,
  evaluateJobPoisoning,
};
