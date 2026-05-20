'use strict';

const { v3Log } = require('../core/v3Logger');
const { getSession, setSession } = require('../core/sessionStore');
const { mergeConversationState } = require('../types/conversationState');
const { isCrmRuntimePersistentEnabled } = require('../../../config/perseoM401Flags');
const {
  isCrmWorkerAsyncEnabled,
  isCrmWorkerProcessEnabled,
  getCrmWorkerBatchSize,
  getCrmWorkerLockTtlSec,
} = require('../../../config/perseoM402Flags');
const { resolveCrmRuntimeStore, MemoryCrmRuntimeStore } = require('./crmRuntimeStore');
const { evaluateJobPoisoning } = require('./crmWorkerPoisoning');
const { recordOperationalEvent } = require('./waTelemetry');
const { isArgosOrDryContext } = require('./runtimeTableProbe');
const {
  recordRetryAttempt,
  recoverStuckJobs,
  recordWorkerHeartbeat,
} = require('./crmDurability');
const { isCrmDurabilityEnabled } = require('../../../config/perseoM403Flags');
const { recordMetric } = require('./observability/runtimeMetricsCollector');
const { checkWorkerStarvation } = require('./runtimeSafety');

function defaultWorkerId() {
  return (
    process.env.PERSEO_CRM_WORKER_ID ||
    `worker_${process.pid}_${String(process.env.RAILWAY_REPLICA_ID || 'local').slice(0, 12)}`
  );
}

/**
 * Process one outbox job using in-memory session state.
 * @param {object} job
 * @param {Function} executeCore
 * @param {object} store
 * @param {{ argosMode?: boolean, crmDryRun?: boolean, supabase?: object, logEvent?: Function }} ctx
 */
async function processCrmOutboxJob(job, executeCore, store, ctx = {}) {
  const conversationId = job.conversation_id;
  const state = getSession(conversationId);
  if (!state) {
    const poison = evaluateJobPoisoning(job, 'missing_session_state');
    const fail = await store.markFailed(job, poison.reason, 'missing_session_state', poison);
    return { ok: false, reason: 'missing_session_state', poison };
  }

  const input = {
    v3State: state,
    conversationRow: { id: conversationId },
    supabase: ctx.supabase || null,
    argosMode: ctx.argosMode === true,
    crmDryRun: ctx.crmDryRun !== false,
    phone: state.phone || job.payload?.phone || null,
    logEvent: ctx.logEvent,
  };

  await store.appendLog({ outbox_id: job.id, phase: 'worker_attempt', attempt: job.attempts });

  try {
    const result = await executeCore(input);
    if (result?.executed) {
      await store.markCompleted(job.idempotency_key, job.id, {
        executed: true,
        lead_id: result.v3State?.crmLeadId || null,
      });
      const next = mergeConversationState(state, {
        crmQueueStatus: 'completed',
        crmRuntimeMode: store.getMode(),
        crmWorkerProcessed: true,
      });
      setSession(conversationId, next);
      recordOperationalEvent(ctx.supabase, {
        conversation_id: conversationId,
        crm_execution_result: { executed: true, worker: true },
        metadata: { worker_id: ctx.workerId },
      }, ctx.logEvent, ctx);
      return { ok: true, executed: true, result };
    }
    if (result?.skipped) {
      await store.appendLog({ outbox_id: job.id, phase: 'worker_skipped', reason: result.reason });
      setSession(
        conversationId,
        mergeConversationState(state, {
          crmQueueStatus: 'skipped',
          crmWorkerProcessed: true,
        }),
      );
      return { ok: true, skipped: true, result };
    }
    throw new Error(result?.reason || 'crm_not_executed');
    } catch (err) {
    const msg = String(err?.message || err);
    const storm = recordRetryAttempt();
    if (storm.storm) {
      await store.appendLog({ outbox_id: job.id, phase: 'retry_storm_pause', count: storm.count });
    }
    const poison = evaluateJobPoisoning(job, msg);
    const fail = await store.markFailed(job, poison.reason, msg, poison);
    if (fail.frozen) {
      setSession(
        conversationId,
        mergeConversationState(state, {
          crmQueueStatus: 'frozen',
          crmFreezeReason: poison.alert_reason,
        }),
      );
    } else if (fail.dead_letter) {
      setSession(
        conversationId,
        mergeConversationState(state, {
          crmQueueStatus: 'dead_letter',
          crmExecutionStatus: 'failed',
        }),
      );
    }
    recordOperationalEvent(ctx.supabase, {
      conversation_id: conversationId,
      crm_execution_result: {
        executed: false,
        dead_letter: !!fail.dead_letter,
        frozen: !!fail.frozen,
        reason: poison.reason,
      },
      fallback_reason: poison.alert_reason,
      metadata: { worker_id: ctx.workerId, last_error: msg },
    }, ctx.logEvent, ctx);
    return { ok: false, error: msg, poison, fail };
  }
}

/**
 * Claim and process a batch of CRM outbox jobs.
 */
async function runCrmOutboxWorkerBatch(options = {}) {
  const workerStart = Date.now();
  if (!isCrmRuntimePersistentEnabled() && !options.forceMemory) {
    return { processed: 0, skipped: true, reason: 'crm_runtime_disabled' };
  }

  const ctx = {
    argosMode: options.argosMode === true,
    crmDryRun: options.crmDryRun !== false,
    supabase: options.supabase || null,
    logEvent: options.logEvent,
    workerId: options.workerId || defaultWorkerId(),
  };

  const batchSize = options.batchSize || getCrmWorkerBatchSize();
  const lockTtlSec = options.lockTtlSec || getCrmWorkerLockTtlSec();

  let store = options.store || null;
  if (!store) {
    const resolved = await resolveCrmRuntimeStore(ctx.supabase, options.conversationId || 'worker', ctx);
    store = resolved.store;
  }
  if (!store) {
    return { processed: 0, skipped: true, reason: 'no_store' };
  }

  if (isCrmDurabilityEnabled()) {
    await recoverStuckJobs(store, { workerId: ctx.workerId });
  }

  const jobs = await store.claimJobs({
    batchSize,
    workerId: ctx.workerId,
    lockTtlSec,
  });

  const executeCore = options.executeCore;
  if (typeof executeCore !== 'function') {
    return { processed: 0, error: 'missing_execute_core' };
  }

  let processed = 0;
  const results = [];
  for (const job of jobs) {
    const r = await processCrmOutboxJob(job, executeCore, store, ctx);
    results.push({ job_id: job.id, ...r });
    processed += 1;
  }

  const workerMs = Date.now() - workerStart;
  recordMetric('worker_latency', { ms: workerMs });
  const starvation = checkWorkerStarvation(processed, jobs.length, batchSize);
  await recordWorkerHeartbeat(
    {
      worker_id: ctx.workerId,
      claimed: jobs.length,
      processed,
      latency_ms: workerMs,
      starved: starvation.starved,
    },
    { supabase: ctx.supabase },
  );

  v3Log('crm_worker_batch', {
    worker_id: ctx.workerId,
    claimed: jobs.length,
    processed,
    mode: store.getMode(),
    latency_ms: workerMs,
  });

  return {
    processed,
    claimed: jobs.length,
    results,
    mode: store.getMode(),
    worker_latency_ms: workerMs,
    starvation,
  };
}

async function runCrmOutboxWorkerOnce(options = {}) {
  return runCrmOutboxWorkerBatch({ ...options, batchSize: options.batchSize || getCrmWorkerBatchSize() });
}

/**
 * Drain all pending jobs in memory store (ARGOS deterministic).
 */
async function drainMemoryOutboxForConversation(conversationId, executeCore, ctx = {}) {
  const store = new MemoryCrmRuntimeStore(conversationId);
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const batch = await runCrmOutboxWorkerBatch({
      ...ctx,
      store,
      conversationId,
      executeCore,
      batchSize: 5,
    });
    if (!batch.claimed) break;
    total += batch.processed || 0;
  }
  return { drained: total };
}

function shouldStartRailwayWorkerLoop() {
  return isCrmWorkerProcessEnabled() && isCrmWorkerAsyncEnabled() && isCrmRuntimePersistentEnabled();
}

module.exports = {
  defaultWorkerId,
  processCrmOutboxJob,
  runCrmOutboxWorkerBatch,
  runCrmOutboxWorkerOnce,
  drainMemoryOutboxForConversation,
  shouldStartRailwayWorkerLoop,
};
