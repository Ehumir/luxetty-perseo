'use strict';

const { isCrmReplayEnabled } = require('../../../config/perseoM403Flags');
const { v3Log } = require('../core/v3Logger');

/**
 * Safe CRM outbox replay — dry-run only unless explicitly approved.
 * @param {object} store
 * @param {{ dryRun?: boolean, jobIds?: string[] }} opts
 */
async function replayOutboxJobs(store, opts = {}) {
  if (!isCrmReplayEnabled() && !opts.force) {
    return { skipped: true, reason: 'crm_replay_disabled' };
  }
  const dryRun = opts.dryRun !== false;
  const jobs = [];

  if (store.bucket?.outbox) {
    const targets = store.bucket.outbox.filter((j) => {
      if (opts.jobIds?.length) return opts.jobIds.includes(j.id);
      return j.status === 'dead_letter' || j.status === 'failed';
    });
    for (const job of targets) {
      jobs.push({
        id: job.id,
        conversation_id: job.conversation_id,
        idempotency_key: job.idempotency_key,
        status: job.status,
        would_replay: true,
        dry_run: dryRun,
      });
      if (!dryRun) {
        job.status = 'pending';
        job.attempts = 0;
        job.next_attempt_at = Date.now();
        job.last_error = null;
      }
    }
  }

  v3Log('crm_replay', { count: jobs.length, dry_run: dryRun });
  return { dry_run: dryRun, replayed: dryRun ? 0 : jobs.length, jobs };
}

module.exports = {
  replayOutboxJobs,
};
