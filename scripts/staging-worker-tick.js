#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Single CRM worker tick against staging DB (Railway-equivalent logic).
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-worker-tick.js [--json]
 */

require('dotenv').config();

process.env.PERSEO_CRM_WORKER_PROCESS_ENABLED = 'true';
process.env.PERSEO_CRM_WORKER_ASYNC_ENABLED = 'true';
process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED = 'true';
process.env.PERSEO_CRM_DURABILITY_ENABLED = 'true';
process.env.PERSEO_V3_CRM_EXECUTE = 'false';
process.env.PERSEO_ARGOS_ENABLED = 'false';

const { supabase } = require('../services/supabaseService');
const { resetRuntimeTableProbeCache } = require('../conversation/v3/runtime/runtimeTableProbe');
const { runCrmOutboxWorkerBatch, defaultWorkerId } = require('../conversation/v3/runtime/crmOutboxWorker');
const { executeV3CrmIfEligible } = require('../conversation/v3/crm/crmExecutor');
const { parseArgs, assertStagingSafe, printResult, exitCode } = require('./staging/stagingLib');

async function main() {
  const args = parseArgs();
  assertStagingSafe(args);
  resetRuntimeTableProbeCache();

  const workerId = defaultWorkerId();
  const batch = await runCrmOutboxWorkerBatch({
    supabase,
    executeCore: (input) => executeV3CrmIfEligible(input),
    workerId,
    crmDryRun: process.env.PERSEO_V3_CRM_EXECUTE !== 'true',
  });

  const { data: hb } = await supabase
    .from('crm_worker_heartbeats')
    .select('worker_id, last_seen_at, metadata')
    .eq('worker_id', workerId)
    .maybeSingle();

  const { count: pending } = await supabase
    .from('crm_outbox')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'processing', 'failed']);

  const { count: dlq } = await supabase
    .from('crm_dead_letters')
    .select('*', { count: 'exact', head: true });

  const result = {
    ok: true,
    details: {
      worker_id: workerId,
      batch,
      heartbeat_db: hb || null,
      outbox_pending_or_processing: pending,
      dead_letter_count: dlq,
      note: 'Run on Railway with same env for production-path parity',
    },
  };

  printResult('staging-worker-tick', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
