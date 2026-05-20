'use strict';

const { buildCrmIdempotencyKey } = require('../crm/crmExecuteFoundation');
const { areCrmRuntimeTablesAvailable, isArgosOrDryContext, probeTableDetailed } = require('./runtimeTableProbe');
const { isCrmRuntimePersistentEnabled } = require('../../../config/perseoM401Flags');
const { computeCrmBackoffMs } = require('./crmWorkerPoisoning');

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
      next_attempt_at: Date.now(),
      last_error_signature: null,
      error_repeat_count: 0,
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

  async markFailed(job, reason, lastError, poisonMeta = null) {
    if (poisonMeta?.action === 'freeze') {
      job.status = 'frozen';
      job.freeze_reason = poisonMeta.alert_reason || reason;
      job.last_error = lastError;
      await this.appendLog({
        phase: 'frozen',
        job_id: job.id,
        reason,
        alert_reason: poisonMeta.alert_reason,
      });
      return { dead_letter: false, frozen: true, retry: false };
    }

    job.attempts = poisonMeta?.attempts ?? (job.attempts || 0) + 1;
    job.last_error_signature = poisonMeta?.last_error_signature ?? job.last_error_signature;
    job.error_repeat_count = poisonMeta?.error_repeat_count ?? job.error_repeat_count;
    job.last_error = lastError;

    if (poisonMeta?.action === 'dead_letter' || job.attempts >= (job.max_attempts || 3)) {
      job.status = 'dead_letter';
      this.bucket.deadLetters.push({
        outbox_id: job.id,
        reason: poisonMeta?.reason || reason,
        last_error: lastError,
        at: new Date().toISOString(),
      });
      await this.appendLog({ phase: 'dead_letter', job_id: job.id, reason, last_error: lastError });
      return { dead_letter: true };
    }

    const backoffMs = poisonMeta?.backoff_ms ?? computeCrmBackoffMs(job.attempts);
    job.status = 'failed';
    job.next_attempt_at = Date.now() + backoffMs;
    await this.appendLog({
      phase: 'retry_scheduled',
      job_id: job.id,
      attempt: job.attempts,
      backoff_ms: backoffMs,
    });
    return { dead_letter: false, retry: true };
  }

  async claimJobs({ batchSize = 5, workerId = 'worker', lockTtlSec = 120 }) {
    const now = Date.now();
    const claimed = [];
    const pending = this.bucket.outbox
      .filter((j) => {
        if (!['pending', 'failed'].includes(j.status)) return false;
        if (j.status === 'frozen' || j.status === 'dead_letter') return false;
        const nextAt = Number(j.next_attempt_at || 0);
        if (nextAt > now) return false;
        if (j.locked_at && j.lock_expires_at > now && j.locked_by !== workerId) return false;
        return true;
      })
      .slice(0, batchSize);

    for (const job of pending) {
      job.status = 'processing';
      job.locked_at = now;
      job.locked_by = workerId;
      job.lock_expires_at = now + lockTtlSec * 1000;
      claimed.push(job);
    }
    return claimed;
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

  async markFailed(jobRow, reason, lastError, poisonMeta = null) {
    const attempts = poisonMeta?.attempts ?? (jobRow.attempts || 0) + 1;

    if (poisonMeta?.action === 'freeze') {
      await this.supabase
        .from('crm_outbox')
        .update({
          status: 'failed',
          last_error: lastError,
          attempts,
          locked_at: null,
          locked_by: null,
        })
        .eq('id', jobRow.id);
      await this.appendLog({
        outbox_id: jobRow.id,
        phase: 'frozen',
        reason,
        alert_reason: poisonMeta.alert_reason,
      });
      return { dead_letter: false, frozen: true };
    }

    if (poisonMeta?.action === 'dead_letter' || attempts >= (jobRow.max_attempts || 3)) {
      await this.supabase.from('crm_dead_letters').insert({
        outbox_id: jobRow.id,
        conversation_id: this.conversationId,
        reason: poisonMeta?.reason || reason,
        payload_snapshot: jobRow.payload || {},
        last_error: lastError,
      });
      await this.supabase
        .from('crm_outbox')
        .update({ status: 'dead_letter', last_error: lastError, attempts })
        .eq('id', jobRow.id);
      return { dead_letter: true };
    }

    const backoffMs = poisonMeta?.backoff_ms ?? computeCrmBackoffMs(attempts);
    const nextAt = new Date(Date.now() + backoffMs).toISOString();
    await this.supabase
      .from('crm_outbox')
      .update({
        status: 'failed',
        attempts,
        last_error: lastError,
        scheduled_at: nextAt,
        locked_at: null,
        locked_by: null,
      })
      .eq('id', jobRow.id);
    return { dead_letter: false, retry: true };
  }

  async claimJobs({ batchSize = 5, workerId = 'worker', lockTtlSec = 120 }) {
    const now = new Date().toISOString();
    const lockExpires = new Date(Date.now() + lockTtlSec * 1000).toISOString();
    const { data: candidates, error } = await this.supabase
      .from('crm_outbox')
      .select('*')
      .in('status', ['pending', 'failed'])
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(batchSize);
    if (error || !candidates?.length) return [];

    const claimed = [];
    for (const row of candidates) {
      const { data: updated, error: upErr } = await this.supabase
        .from('crm_outbox')
        .update({
          status: 'processing',
          locked_at: now,
          locked_by: workerId,
          lock_expires_at: lockExpires,
        })
        .eq('id', row.id)
        .in('status', ['pending', 'failed'])
        .select('*')
        .maybeSingle();
      if (!upErr && updated) claimed.push(updated);
    }
    return claimed;
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
    return {
      store: null,
      mode: 'disabled',
      memoryFallbackReason: 'PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED_not_true',
    };
  }
  if (isArgosOrDryContext(ctx)) {
    const reason = process.env.PERSEO_ARGOS_ENABLED === 'true' ? 'PERSEO_ARGOS_ENABLED' : 'argos_context';
    return {
      store: new MemoryCrmRuntimeStore(conversationId),
      mode: 'memory_argos',
      memoryFallbackReason: reason,
    };
  }
  if (!supabase?.from) {
    return {
      store: new MemoryCrmRuntimeStore(conversationId),
      mode: 'memory',
      memoryFallbackReason: 'no_supabase_client',
    };
  }
  const dbOk = await areCrmRuntimeTablesAvailable(supabase, ctx);
  if (dbOk) {
    return {
      store: new DbCrmRuntimeStore(supabase, conversationId),
      mode: 'db',
      memoryFallbackReason: null,
    };
  }
  const probe = await probeTableDetailed(supabase, 'crm_outbox');
  return {
    store: new MemoryCrmRuntimeStore(conversationId),
    mode: 'memory',
    memoryFallbackReason: probe.exists ? 'crm_probe_inconsistent' : `crm_outbox_unavailable:${probe.error}`,
  };
}

module.exports = {
  MemoryCrmRuntimeStore,
  DbCrmRuntimeStore,
  resolveCrmRuntimeStore,
  resetMemoryCrmRuntimeStore,
  buildCrmIdempotencyKey,
};
