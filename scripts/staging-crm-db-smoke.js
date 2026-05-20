#!/usr/bin/env node
'use strict';

/**
 * M4-04 — CRM outbox integration against staging Supabase (enqueue → worker → complete).
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-crm-db-smoke.js [--json]
 */

require('dotenv').config();

process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED = 'true';
process.env.PERSEO_CRM_DURABILITY_ENABLED = 'true';
process.env.PERSEO_CRM_WORKER_ASYNC_ENABLED = 'true';
process.env.PERSEO_V3_CRM_EXECUTE = 'false';
process.env.PERSEO_ARGOS_ENABLED = 'false';

const { randomUUID } = require('crypto');

const { supabase } = require('../services/supabaseService');
const { parseArgs, assertStagingSafe, printResult, exitCode } = require('./staging/stagingLib');
const { resolveCrmRuntimeStore } = require('../conversation/v3/runtime/crmRuntimeStore');
const { runCrmOutboxWorkerBatch } = require('../conversation/v3/runtime/crmOutboxWorker');
const { setSession, resetSession } = require('../conversation/v3/core/sessionStore');
const { persistWorkerHeartbeatToDb } = require('../conversation/v3/runtime/crmDurability');

async function main() {
  const args = parseArgs();
  assertStagingSafe(args);

  const conversationId = randomUUID();
  const idempotencyKey = `staging-db-smoke-${Date.now()}`;

  resetSession(conversationId, { phone: '+5200000000888' });

  const { store, mode } = await resolveCrmRuntimeStore(supabase, conversationId, {
    crmDryRun: false,
    argosMode: false,
  });
  if (!store || mode !== 'db') {
    const result = {
      ok: false,
      details: { error: 'expected_db_store', mode },
    };
    printResult('staging-crm-db-smoke', result, args.json);
    exitCode(result);
    return;
  }

  const enq = await store.enqueue({
    payload: { smoke: true, conversationId },
    idempotencyKey,
  });

  const workerId = `staging-db-smoke-${process.pid}`;
  await persistWorkerHeartbeatToDb(supabase, { worker_id: workerId, claimed: 0, processed: 0 });

  const batch = await runCrmOutboxWorkerBatch({
    supabase,
    store,
    conversationId,
    workerId,
    crmDryRun: true,
    executeCore: async (input) => ({
      executed: true,
      v3State: input.v3State,
    }),
  });

  const { data: hb } = await supabase
    .from('crm_worker_heartbeats')
    .select('worker_id, last_seen_at, metadata')
    .eq('worker_id', workerId)
    .maybeSingle();

  const { count: outboxPending } = await supabase
    .from('crm_outbox')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending');

  const { count: idemCount } = await supabase
    .from('crm_idempotency_keys')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  const ok =
    enq.enqueued === true &&
    batch.claimed >= 1 &&
    batch.processed >= 1 &&
    (outboxPending ?? 1) === 0 &&
    (idemCount ?? 0) >= 1 &&
    !!hb?.worker_id;

  const result = {
    ok,
    details: {
      conversation_id: conversationId,
      mode,
      enqueue: enq,
      worker_batch: {
        claimed: batch.claimed,
        processed: batch.processed,
        mode: batch.mode,
      },
      heartbeat_db: hb,
      outbox_pending_after: outboxPending,
      idempotency_rows: idemCount,
    },
  };

  printResult('staging-crm-db-smoke', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
