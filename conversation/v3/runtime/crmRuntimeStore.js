'use strict';

const { buildCrmIdempotencyKey } = require('../crm/crmExecuteFoundation');
const { areCrmRuntimeTablesAvailable, isArgosOrDryContext } = require('./runtimeTableProbe');
const { isCrmRuntimePersistentEnabled } = require('../../../config/perseoM401Flags');

/** @type {Map<string, object>} */
const memoryGlobal = new Map();

function memoryKey(conversationId) {
  return String(conversationId || 'global');
}

function getMemoryBucket(conversationId) {
  const k = memoryKey(conversationId);
  if (!memoryGlobal.has(k)) {
    memoryGlobal.set(k, {
      outbox: [],
      audit: [],
      idempotency: new Set(),
      deadLetters: [],
    });
  }
  return memoryGlobal.get(k);
}

function resetMemoryCrmRuntimeStore(conversationId) {
  if (conversationId) memoryGlobal.delete(memoryKey(conversationId));
  else memoryGlobal.clear();
}

class MemoryCrmRuntimeStore {
  constructor(conversationId) {
    this.conversationId = conversationId;
    this.bucket = getMemoryBucket(conversationId);
  }

  async enqueue({ payload, idempotencyKey }) {
    if (this.bucket.idempotency.has(idempotencyKey)) {
      return { enqueued: false, reason: 'idempotency_completed', idempotency_key: idempotencyKey };
    }
    const pending = this.bucket.outbox.find(
      (j) => j.idempotency_key === idempotencyKey && j.status === 'pending',
    );
    if (pending) {
      return { enqueued: false, reason: 'collision', idempotency_key: idempotencyKey, outbox_id: pending.id };
    }
    const job = {
      id: `mem_${Date.now()}_${this.bucket.outbox.length}`,
      conversation_id: this.conversationId,
      idempotency_key: idempotencyKey,
      payload: payload || {},
      status: 'pending',
      attempts: 0,
      max_attempts: 3,
    };
    this.bucket.outbox.push(job);
    await this.appendLog({ phase: 'enqueue', job_id: job.id, idempotency_key: idempotencyKey });
    return { enqueued: true, outbox_id: job.id, idempotency_key: idempotencyKey, job };
  }

  async appendLog(entry) {
    const row = { at: new Date().toISOString(), conversation_id: this.conversationId, ...entry };
    this.bucket.audit.push(row);
    return row;
  }

  async markCompleted(idempotencyKey, outboxId, resultSnapshot) {
    this.bucket.idempotency.add(idempotencyKey);
    const job = this.bucket.outbox.find((j) => j.id === outboxId);
    if (job) job.status = 'completed';
    await this.appendLog({ phase: 'idempotency_complete', idempotency_key: idempotencyKey, outbox_id: outboxId });
    return { completed: true, result_snapshot: resultSnapshot || {} };
  }

  async markFailed(job, reason, lastError) {
    job.attempts = (job.attempts || 0) + 1;
    if (job.attempts >= (job.max_attempts || 3)) {
      job.status = 'dead_letter';
      this.bucket.deadLetters.push({
        outbox_id: job.id,
        reason,
        last_error: lastError,
        at: new Date().toISOString(),
      });
      await this.appendLog({ phase: 'dead_letter', job_id: job.id, reason, last_error: lastError });
      return { dead_letter: true };
    }
    job.status = 'failed';
    await this.appendLog({ phase: 'retry_scheduled', job_id: job.id, attempt: job.attempts });
    return { dead_letter: false, retry: true };
  }

  getMode() {
    return 'memory';
  }
}

class DbCrmRuntimeStore {
  constructor(supabase, conversationId) {
    this.supabase = supabase;
    this.conversationId = conversationId;
  }

  async enqueue({ payload, idempotencyKey }) {
    const row = {
      conversation_id: this.conversationId,
      idempotency_key: idempotencyKey,
      payload: payload || {},
      status: 'pending',
      attempts: 0,
      max_attempts: 3,
      scheduled_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase.from('crm_outbox').insert(row).select('id').maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return { enqueued: false, reason: 'collision', idempotency_key: idempotencyKey };
      }
      throw error;
    }
    await this.appendLog({ outbox_id: data.id, phase: 'enqueue', idempotency_key: idempotencyKey });
    return { enqueued: true, outbox_id: data.id, idempotency_key: idempotencyKey };
  }

  async appendLog({ outbox_id, phase, ...metadata }) {
    return this.supabase.from('crm_execution_logs').insert({
      outbox_id: outbox_id || null,
      conversation_id: this.conversationId,
      phase,
      metadata,
    });
  }

  async markCompleted(idempotencyKey, outboxId, resultSnapshot) {
    await this.supabase.from('crm_idempotency_keys').insert({
      conversation_id: this.conversationId,
      idempotency_key: idempotencyKey,
      outbox_id: outboxId,
      result_snapshot: resultSnapshot || {},
    });
    await this.supabase
      .from('crm_outbox')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', outboxId);
    return { completed: true };
  }

  async markFailed(jobRow, reason, lastError) {
    const attempts = (jobRow.attempts || 0) + 1;
    if (attempts >= (jobRow.max_attempts || 3)) {
      await this.supabase.from('crm_dead_letters').insert({
        outbox_id: jobRow.id,
        conversation_id: this.conversationId,
        reason,
        payload_snapshot: jobRow.payload || {},
        last_error: lastError,
      });
      await this.supabase
        .from('crm_outbox')
        .update({ status: 'dead_letter', last_error: lastError, attempts })
        .eq('id', jobRow.id);
      return { dead_letter: true };
    }
    await this.supabase
      .from('crm_outbox')
      .update({ status: 'failed', attempts, last_error: lastError })
      .eq('id', jobRow.id);
    return { dead_letter: false, retry: true };
  }

  getMode() {
    return 'db';
  }
}

/**
 * @param {object} supabase
 * @param {string} conversationId
 * @param {{ argosMode?: boolean, crmDryRun?: boolean }} ctx
 */
async function resolveCrmRuntimeStore(supabase, conversationId, ctx = {}) {
  if (!isCrmRuntimePersistentEnabled()) {
    return { store: null, mode: 'disabled' };
  }
  if (isArgosOrDryContext(ctx)) {
    return { store: new MemoryCrmRuntimeStore(conversationId), mode: 'memory_argos' };
  }
  const dbOk = await areCrmRuntimeTablesAvailable(supabase, ctx);
  if (dbOk) {
    return { store: new DbCrmRuntimeStore(supabase, conversationId), mode: 'db' };
  }
  return { store: new MemoryCrmRuntimeStore(conversationId), mode: 'memory' };
}

module.exports = {
  MemoryCrmRuntimeStore,
  DbCrmRuntimeStore,
  resolveCrmRuntimeStore,
  resetMemoryCrmRuntimeStore,
  buildCrmIdempotencyKey,
};
