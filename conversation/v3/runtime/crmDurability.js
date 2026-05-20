'use strict';

const { v3Log } = require('../core/v3Logger');
const {
  isCrmDurabilityEnabled,
  isCrmReconciliationEnabled,
  getRetryStormThresholdPerMinute,
  getStuckJobThresholdMs,
} = require('../../../config/perseoM403Flags');
const { recordMetric } = require('./observability/runtimeMetricsCollector');
const { computeCrmBackoffMs } = require('./crmWorkerPoisoning');

/** @type {{ retries: number[], lastMinute: number }} */
const retryStorm = { retries: [], lastMinute: 0 };

function resetCrmDurabilityState() {
  retryStorm.retries = [];
  retryStorm.lastMinute = 0;
}

function recordRetryAttempt() {
  if (!isCrmDurabilityEnabled()) return { storm: false };
  const now = Date.now();
  retryStorm.retries = retryStorm.retries.filter((t) => now - t < 60_000);
  retryStorm.retries.push(now);
  recordMetric('retry', { count: 1 });
  const threshold = getRetryStormThresholdPerMinute();
  const storm = retryStorm.retries.length >= threshold;
  if (storm) {
    v3Log('crm_retry_storm', { count: retryStorm.retries.length, threshold });
  }
  return { storm, count: retryStorm.retries.length };
}

/**
 * Reclaim jobs stuck in processing (orphan locks).
 * @param {import('./crmRuntimeStore').MemoryCrmRuntimeStore|object} store
 */
async function recoverStuckJobs(store, ctx = {}) {
  if (!isCrmDurabilityEnabled()) return { recovered: 0 };
  const thresholdMs = getStuckJobThresholdMs();
  const now = Date.now();

  if (store.bucket?.outbox) {
    let recovered = 0;
    for (const job of store.bucket.outbox) {
      if (job.status !== 'processing') continue;
      const lockedAt = Number(job.locked_at || 0);
      const expires = Number(job.lock_expires_at || 0);
      if (expires < now || now - lockedAt > thresholdMs) {
        job.status = 'failed';
        job.locked_at = null;
        job.locked_by = null;
        job.lock_expires_at = null;
        job.next_attempt_at = now + computeCrmBackoffMs((job.attempts || 0) + 1);
        await store.appendLog({
          outbox_id: job.id,
          phase: 'stuck_recovery',
          reason: 'orphan_lock_reclaimed',
        });
        recovered += 1;
      }
    }
    if (recovered > 0) {
      recordMetric('queue_snapshot', {
        worker_id: ctx.workerId,
        pending: store.bucket.outbox.filter((j) => j.status === 'pending').length,
        processing: store.bucket.outbox.filter((j) => j.status === 'processing').length,
      });
    }
    return { recovered };
  }

  if (store.supabase?.from) {
    const staleBefore = new Date(now - thresholdMs).toISOString();
    const { data, error } = await store.supabase
      .from('crm_outbox')
      .update({
        status: 'failed',
        locked_at: null,
        locked_by: null,
        lock_expires_at: null,
        last_error: 'stuck_recovery',
      })
      .eq('status', 'processing')
      .lt('locked_at', staleBefore)
      .select('id');
    if (error) return { recovered: 0, error: error.message };
    return { recovered: data?.length || 0 };
  }

  return { recovered: 0 };
}

/**
 * Dry-run reconciliation report (no CRM writes).
 */
async function reconcileCrmOutbox(store, ctx = {}) {
  if (!isCrmReconciliationEnabled() && !ctx.force) {
    return { skipped: true, reason: 'reconciliation_disabled' };
  }

  const report = {
    at: new Date().toISOString(),
    pending: 0,
    processing: 0,
    failed: 0,
    dead_letter: 0,
    frozen: 0,
    idempotency_completed: 0,
    anomalies: [],
  };

  if (store.bucket?.outbox) {
    for (const job of store.bucket.outbox) {
      if (job.status === 'pending') report.pending += 1;
      if (job.status === 'processing') report.processing += 1;
      if (job.status === 'failed') report.failed += 1;
      if (job.status === 'dead_letter') report.dead_letter += 1;
      if (job.status === 'frozen') report.frozen += 1;
    }
    report.idempotency_completed = store.bucket.idempotency?.size || 0;
    if (report.processing > 0) {
      report.anomalies.push({ type: 'stuck_processing', count: report.processing });
    }
    return report;
  }

  return { ...report, skipped: true, reason: 'no_store_data' };
}

async function persistWorkerHeartbeatToDb(supabase, payload) {
  if (!supabase?.from || !payload?.worker_id) return { persisted: false, reason: 'no_client' };
  try {
    const { error } = await supabase.from('crm_worker_heartbeats').upsert({
      worker_id: String(payload.worker_id),
      last_seen_at: new Date().toISOString(),
      metadata: {
        claimed: payload.claimed ?? null,
        processed: payload.processed ?? null,
        latency_ms: payload.latency_ms ?? null,
        starved: payload.starved ?? null,
      },
    });
    if (error) {
      v3Log('crm_worker_heartbeat_db_failed', { error: error.message });
      return { persisted: false, error: error.message };
    }
    return { persisted: true };
  } catch (err) {
    return { persisted: false, error: String(err?.message || err) };
  }
}

async function recordWorkerHeartbeat(payload, ctx = {}) {
  recordMetric('worker_heartbeat', payload);
  v3Log('crm_worker_heartbeat', payload);
  if (ctx.supabase) {
    return persistWorkerHeartbeatToDb(ctx.supabase, payload);
  }
  return { persisted: false, reason: 'no_supabase' };
}

function buildDlqExportSnapshot(store) {
  if (store.bucket?.deadLetters) {
    return {
      count: store.bucket.deadLetters.length,
      items: store.bucket.deadLetters.slice(-50),
    };
  }
  return { count: 0, items: [] };
}

module.exports = {
  resetCrmDurabilityState,
  recordRetryAttempt,
  recoverStuckJobs,
  reconcileCrmOutbox,
  recordWorkerHeartbeat,
  persistWorkerHeartbeatToDb,
  buildDlqExportSnapshot,
};
