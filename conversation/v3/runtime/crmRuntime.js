'use strict';

const { mergeConversationState } = require('../types/conversationState');
const { isCrmRuntimePersistentEnabled } = require('../../../config/perseoM401Flags');
const { isCrmExecuteFoundationEnabled } = require('../../../config/perseoM302Flags');
const { executeV3CrmWithFoundation } = require('../crm/crmExecuteFoundation');
const { buildCrmIdempotencyKey } = require('../crm/crmExecuteFoundation');
const { resolveCrmRuntimeStore } = require('./crmRuntimeStore');
const { v3Log } = require('../core/v3Logger');

const MAX_RETRIES = 2;

/**
 * M4 CRM runtime — persistent abstraction with memory/DB fallback.
 * Never performs CRM table writes; delegates to executeCore (gated).
 */
async function executeV3CrmWithRuntime(input, executeCore) {
  if (!isCrmRuntimePersistentEnabled()) {
    if (isCrmExecuteFoundationEnabled()) {
      return executeV3CrmWithFoundation(input, executeCore);
    }
    return executeCore(input);
  }

  const state = input.v3State || {};
  const conversationId = state.conversationId || input.conversationRow?.id;
  const ctx = {
    argosMode: input.argosMode === true,
    crmDryRun: input.crmDryRun !== false,
  };

  const { store, mode } = await resolveCrmRuntimeStore(input.supabase, conversationId, ctx);
  if (!store) {
    return executeCore(input);
  }

  const payloadPreview = state.crmPayloadPreview || null;
  const idempotencyKey = buildCrmIdempotencyKey(state, payloadPreview);

  const enqueueResult = await store.enqueue({ payload: payloadPreview, idempotencyKey });
  if (!enqueueResult.enqueued) {
    const reason = enqueueResult.reason || 'not_enqueued';
    v3Log('crm_runtime_skip', { conversation_id: conversationId, reason, mode });
    return {
      v3State: mergeConversationState(state, {
        crmQueueStatus: reason === 'collision' ? 'collision_blocked' : 'skipped',
        crmRuntimeMode: mode,
      }),
      executed: false,
      skipped: true,
      reason: `runtime_${reason}`,
    };
  }

  const job = enqueueResult.job || { id: enqueueResult.outbox_id, attempts: 0, max_attempts: 3 };
  let lastResult = null;
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    job.attempts = attempt + 1;
    await store.appendLog({
      outbox_id: job.id,
      phase: 'attempt',
      attempt: job.attempts,
      mode,
    });

    try {
      lastResult = await executeCore(input);
      if (lastResult?.executed) {
        await store.markCompleted(idempotencyKey, job.id, {
          executed: true,
          lead_id: lastResult.v3State?.crmLeadId || null,
        });
        return {
          ...lastResult,
          v3State: mergeConversationState(lastResult.v3State || state, {
            crmQueueStatus: 'completed',
            crmRuntimeMode: mode,
            crmIdempotencyKey: idempotencyKey,
          }),
        };
      }
      if (lastResult?.skipped) {
        await store.appendLog({ outbox_id: job.id, phase: 'skipped', reason: lastResult.reason });
        return {
          ...lastResult,
          v3State: mergeConversationState(lastResult.v3State || state, {
            crmQueueStatus: 'skipped',
            crmRuntimeMode: mode,
          }),
        };
      }
      if (lastResult?.failed) throw new Error(lastResult.reason || 'crm_failed');
    } catch (err) {
      const fail = await store.markFailed(job, 'execute_error', String(err?.message || err));
      if (fail.dead_letter) {
        return {
          v3State: mergeConversationState(state, {
            crmQueueStatus: 'dead_letter',
            crmRuntimeMode: mode,
            crmExecutionStatus: 'failed',
          }),
          executed: false,
          failed: true,
          reason: 'runtime_dead_letter',
        };
      }
    }
    attempt += 1;
  }

  return (
    lastResult || {
      v3State: mergeConversationState(state, { crmRuntimeMode: mode }),
      executed: false,
      skipped: true,
      reason: 'runtime_exhausted',
    }
  );
}

module.exports = {
  executeV3CrmWithRuntime,
};
