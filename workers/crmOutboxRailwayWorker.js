#!/usr/bin/env node
'use strict';

/**
 * M4-02 — Dedicated Railway worker process (NOT the HTTP webhook).
 *
 * Start command (Railway service):
 *   node workers/crmOutboxRailwayWorker.js
 *
 * Required env:
 *   PERSEO_CRM_WORKER_PROCESS_ENABLED=true
 *   PERSEO_CRM_WORKER_ASYNC_ENABLED=true
 *   PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Polling: PERSEO_CRM_WORKER_POLL_MS (default 5000)
 * Lock TTL: PERSEO_CRM_WORKER_LOCK_TTL_SEC (default 120)
 * Restart safety: stale locks expire; SKIP LOCKED on reclaim.
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');
const { executeV3CrmIfEligible } = require('../conversation/v3/crm/crmExecutor');
const {
  runCrmOutboxWorkerBatch,
  shouldStartRailwayWorkerLoop,
  defaultWorkerId,
} = require('../conversation/v3/runtime/crmOutboxWorker');
const { getCrmWorkerPollMs } = require('../config/perseoM402Flags');
const { v3Log } = require('../conversation/v3/core/v3Logger');

const workerId = defaultWorkerId();
let stopping = false;

function logEvent(type, payload) {
  v3Log(type, { worker_id: workerId, ...payload });
}

async function tick() {
  if (stopping) return;
  try {
    const batch = await runCrmOutboxWorkerBatch({
      supabase,
      executeCore: (input) => executeV3CrmIfEligible(input),
      workerId,
      crmDryRun: process.env.PERSEO_V3_CRM_EXECUTE !== 'true',
      logEvent,
    });
    if (batch.claimed > 0) {
      logEvent('crm_worker_tick', { claimed: batch.claimed, processed: batch.processed });
    }
  } catch (err) {
    logEvent('crm_worker_tick_error', { error: String(err?.message || err) });
  }
}

function main() {
  if (!shouldStartRailwayWorkerLoop()) {
    console.error(
      '[crm-worker] Refusing to start: set PERSEO_CRM_WORKER_PROCESS_ENABLED=true, PERSEO_CRM_WORKER_ASYNC_ENABLED=true, PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true',
    );
    process.exit(1);
  }

  const pollMs = getCrmWorkerPollMs();
  console.log(`[crm-worker] starting worker_id=${workerId} poll_ms=${pollMs}`);

  const interval = setInterval(() => {
    void tick();
  }, pollMs);

  void tick();

  const shutdown = () => {
    stopping = true;
    clearInterval(interval);
    console.log('[crm-worker] shutdown');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
