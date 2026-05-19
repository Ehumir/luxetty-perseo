'use strict';

const { mergeConversationState } = require('../types/conversationState');
const { isCrmExecuteFoundationEnabled } = require('../../../config/perseoM302Flags');
const { v3Log } = require('../core/v3Logger');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 0;

/** @type {Map<string, { jobs: object[], audit: object[], completedKeys: Set<string> }>} */
const queuesByConversation = new Map();

function buildCrmIdempotencyKey(state, payload) {
  const cid = String(state.conversationId || 'unknown');
  const contact = String(state.crmContactId || payload?.contact_id || 'no_contact');
  const prop = String(
    state.propertyListingCode || payload?.property_listing_code || state.activeProperty?.id || 'no_prop',
  );
  const intent = String(payload?.intent || state.conversationGoal || 'unknown');
  return `${cid}:${contact}:${prop}:${intent}`.toLowerCase();
}

function getQueue(conversationId) {
  const key = String(conversationId || 'global');
  if (!queuesByConversation.has(key)) {
    queuesByConversation.set(key, { jobs: [], audit: [], completedKeys: new Set() });
  }
  return queuesByConversation.get(key);
}

function appendAudit(conversationId, entry, logEvent) {
  const q = getQueue(conversationId);
  const row = { at: new Date().toISOString(), ...entry };
  q.audit.push(row);
  v3Log('crm_foundation_audit', { conversation_id: conversationId, ...entry });
  if (typeof logEvent === 'function') {
    logEvent('crm_foundation_audit', { conversation_id: conversationId, ...entry });
  }
  return row;
}

function hasCollision(conversationId, idempotencyKey) {
  const q = getQueue(conversationId);
  if (q.completedKeys.has(idempotencyKey)) return true;
  return q.jobs.some((j) => j.idempotency_key === idempotencyKey && j.status === 'pending');
}

function reconcileCrmState(state) {
  const complete = state.crmExecutionCompleted === true;
  const hasLead = !!state.crmLeadId;
  const hasContact = !!state.crmContactId;
  if (complete && !hasLead) {
    return { consistent: false, reason: 'completed_without_lead' };
  }
  if (hasLead && !hasContact) {
    return { consistent: false, reason: 'lead_without_contact' };
  }
  return { consistent: true, reason: complete ? 'ok' : 'in_progress' };
}

async function sleep(ms) {
  if (!ms) return;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Wraps core CRM execute with queue, retry, audit, idempotency, collision guard.
 * Dry-run / gate skips remain inside core executor.
 *
 * @param {object} input
 * @param {Function} executeCore — executeV3CrmIfEligible implementation
 */
async function executeV3CrmWithFoundation(input, executeCore) {
  if (!isCrmExecuteFoundationEnabled()) {
    return executeCore(input);
  }

  const state = input.v3State || {};
  const conversationId = state.conversationId || input.conversationRow?.id;
  const payloadPreview = state.crmPayloadPreview || null;
  const idempotencyKey = buildCrmIdempotencyKey(state, payloadPreview);

  const reconciliation = reconcileCrmState(state);
  appendAudit(conversationId, { phase: 'reconcile', ...reconciliation, idempotency_key: idempotencyKey }, input.logEvent);

  if (state.crmExecutionCompleted && reconciliation.consistent) {
    appendAudit(conversationId, { phase: 'skip', reason: 'already_completed', idempotency_key: idempotencyKey }, input.logEvent);
    return { v3State: state, executed: false, skipped: true, reason: 'foundation_already_completed' };
  }

  if (hasCollision(conversationId, idempotencyKey)) {
    appendAudit(conversationId, { phase: 'collision', idempotency_key: idempotencyKey }, input.logEvent);
    return {
      v3State: { ...state, crmQueueStatus: 'collision_blocked' },
      executed: false,
      skipped: true,
      reason: 'foundation_collision',
    };
  }

  const q = getQueue(conversationId);
  const job = {
    id: `${Date.now()}_${q.jobs.length}`,
    idempotency_key: idempotencyKey,
    status: 'pending',
    attempts: 0,
  };
  q.jobs.push(job);
  appendAudit(conversationId, { phase: 'enqueue', job_id: job.id, idempotency_key: idempotencyKey }, input.logEvent);

  let lastResult = null;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    job.attempts = attempt + 1;
    appendAudit(conversationId, { phase: 'attempt', job_id: job.id, attempt: job.attempts }, input.logEvent);
    try {
      lastResult = await executeCore(input);
      if (lastResult?.executed || lastResult?.skipped) {
        job.status = lastResult.executed ? 'completed' : 'skipped';
        if (lastResult.executed) q.completedKeys.add(idempotencyKey);
        appendAudit(
          conversationId,
          {
            phase: 'done',
            job_id: job.id,
            executed: !!lastResult.executed,
            skipped: !!lastResult.skipped,
            reason: lastResult.reason || null,
          },
          input.logEvent,
        );
        const nextState = mergeConversationState(lastResult.v3State || state, {
          crmQueueStatus: job.status,
          crmIdempotencyKey: idempotencyKey,
        });
        return { ...lastResult, v3State: nextState };
      }
      if (lastResult?.failed) throw new Error(lastResult.reason || 'crm_failed');
    } catch (err) {
      appendAudit(
        conversationId,
        { phase: 'error', job_id: job.id, attempt: job.attempts, message: String(err?.message || err) },
        input.logEvent,
      );
      if (attempt >= MAX_RETRIES) {
        job.status = 'failed';
        return {
          v3State: mergeConversationState(state, {
            crmQueueStatus: 'failed',
            crmExecutionStatus: 'failed',
            crmExecutionError: String(err?.message || err),
          }),
          executed: false,
          failed: true,
          reason: 'foundation_retries_exhausted',
        };
      }
      await sleep(RETRY_DELAY_MS);
    }
    attempt += 1;
  }

  return lastResult || { v3State: state, executed: false, skipped: true, reason: 'foundation_noop' };
}

function resetCrmFoundationQueue(conversationId) {
  if (conversationId) queuesByConversation.delete(String(conversationId));
  else queuesByConversation.clear();
}

module.exports = {
  buildCrmIdempotencyKey,
  reconcileCrmState,
  executeV3CrmWithFoundation,
  resetCrmFoundationQueue,
  appendAudit,
  getQueue,
};
