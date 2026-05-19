#!/usr/bin/env node
'use strict';

/**
 * M4-04 — CRM worker smoke (memory + optional DB probe).
 * Usage: node scripts/staging-crm-worker-smoke.js [--json]
 */

require('dotenv').config();

process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED = 'true';
process.env.PERSEO_CRM_DURABILITY_ENABLED = 'true';
process.env.PERSEO_CRM_WORKER_ASYNC_ENABLED = 'true';

const { parseArgs, assertStagingSafe, printResult, exitCode } = require('./staging/stagingLib');
const { MemoryCrmRuntimeStore, resetMemoryCrmRuntimeStore } = require('../conversation/v3/runtime/crmRuntimeStore');
const { runCrmOutboxWorkerBatch } = require('../conversation/v3/runtime/crmOutboxWorker');
const { recoverStuckJobs, reconcileCrmOutbox, recordWorkerHeartbeat } = require('../conversation/v3/runtime/crmDurability');
const { setSession } = require('../conversation/v3/core/sessionStore');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');

async function memorySmoke() {
  const convId = 'staging-smoke-worker';
  resetMemoryCrmRuntimeStore(convId);
  const store = new MemoryCrmRuntimeStore(convId);
  setSession(convId, createInitialConversationState({ conversationId: convId, phone: '+5200000000999' }));

  const enq = await store.enqueue({ payload: { test: true }, idempotencyKey: 'staging-smoke-k1' });
  const stuck = await recoverStuckJobs(store, { workerId: 'staging-smoke' });
  const batch = await runCrmOutboxWorkerBatch({
    store,
    conversationId: convId,
    argosMode: true,
    crmDryRun: true,
    executeCore: async (input) => ({ executed: true, v3State: input.v3State }),
    workerId: 'staging-smoke',
  });
  const recon = await reconcileCrmOutbox(store, { force: true });
  recordWorkerHeartbeat({ worker_id: 'staging-smoke', claimed: batch.claimed, processed: batch.processed });

  return {
    enqueued: enq.enqueued,
    claimed: batch.claimed,
    processed: batch.processed,
    stuck_recovered: stuck.recovered,
    reconcile: recon,
  };
}

async function main() {
  const args = parseArgs();
  assertStagingSafe(args);

  const memory = await memorySmoke();
  const ok =
    memory.enqueued === true &&
    memory.claimed >= 1 &&
    memory.processed >= 1;

  const result = {
    ok,
    details: { memory, mode: args.dryRun ? 'dry-run' : 'local-memory' },
  };

  printResult('staging-crm-worker-smoke', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
