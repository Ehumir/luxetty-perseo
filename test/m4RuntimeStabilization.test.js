'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { resetRuntimeMetrics, recordMetric, buildRuntimeHealthSnapshot } = require('../conversation/v3/runtime/observability/runtimeMetricsCollector');
const { validateInboundMedia } = require('../conversation/v3/runtime/mediaHardening');
const { checkFloodProtection, resetRuntimeSafetyState } = require('../conversation/v3/runtime/runtimeSafety');
const { recoverStuckJobs, reconcileCrmOutbox, resetCrmDurabilityState } = require('../conversation/v3/runtime/crmDurability');
const { MemoryCrmRuntimeStore } = require('../conversation/v3/runtime/crmRuntimeStore');
const { replayOutboxJobs } = require('../conversation/v3/runtime/crmReplay');
const { runReplayPackById } = require('../argos/replay/replayEngine');

describe('M4-03 runtime stabilization', () => {
  beforeEach(() => {
    resetRuntimeMetrics();
    resetRuntimeSafetyState();
    resetCrmDurabilityState();
    delete process.env.PERSEO_RUNTIME_OBSERVABILITY_ENABLED;
    delete process.env.PERSEO_MEDIA_HARDENING_ENABLED;
    delete process.env.PERSEO_RUNTIME_SAFETY_ENABLED;
    delete process.env.PERSEO_CRM_DURABILITY_ENABLED;
    delete process.env.PERSEO_REPLAY_ENGINE_ENABLED;
  });

  it('observability records metrics when enabled', () => {
    process.env.PERSEO_RUNTIME_OBSERVABILITY_ENABLED = 'true';
    recordMetric('webhook_latency', { ms: 120 });
    recordMetric('retry', { count: 2 });
    const snap = buildRuntimeHealthSnapshot();
    assert.equal(snap.retry_count, 2);
    assert.ok(snap.webhook_latency_p95 >= 120);
  });

  it('media hardening rejects oversized payload', () => {
    process.env.PERSEO_MEDIA_HARDENING_ENABLED = 'true';
    const v = validateInboundMedia({ kind: 'image', byte_size: 20_000_000 }, { force: true });
    assert.equal(v.ok, false);
    assert.equal(v.reject_reason, 'payload_too_large');
  });

  it('flood protection blocks burst', () => {
    process.env.PERSEO_RUNTIME_SAFETY_ENABLED = 'true';
    let last = null;
    for (let i = 0; i < 12; i += 1) {
      last = checkFloodProtection('conv-flood');
    }
    assert.equal(last.allowed, false);
  });

  it('recover stuck processing jobs in memory store', async () => {
    process.env.PERSEO_CRM_DURABILITY_ENABLED = 'true';
    const store = new MemoryCrmRuntimeStore('c1');
    await store.enqueue({ payload: {}, idempotencyKey: 'k1' });
    const [job] = await store.claimJobs({ batchSize: 1, workerId: 'w1' });
    job.locked_at = Date.now() - 400_000;
    job.lock_expires_at = Date.now() - 1000;
    const r = await recoverStuckJobs(store);
    assert.ok(r.recovered >= 1);
  });

  it('reconcile outbox dry-run', async () => {
    process.env.PERSEO_CRM_RECONCILIATION_ENABLED = 'true';
    const store = new MemoryCrmRuntimeStore('c2');
    await store.enqueue({ payload: {}, idempotencyKey: 'k2' });
    const report = await reconcileCrmOutbox(store);
    assert.equal(report.pending, 1);
  });

  it('crm replay dry-run does not mutate', async () => {
    process.env.PERSEO_CRM_REPLAY_ENABLED = 'true';
    const store = new MemoryCrmRuntimeStore('c3');
    const enq = await store.enqueue({ payload: {}, idempotencyKey: 'k3' });
    const job = store.bucket.outbox.find((j) => j.id === enq.outbox_id);
    job.status = 'dead_letter';
    const r = await replayOutboxJobs(store);
    assert.equal(r.dry_run, true);
    assert.equal(job.status, 'dead_letter');
  });

  it('replay pack runs deterministically', async () => {
    process.env.PERSEO_REPLAY_ENGINE_ENABLED = 'true';
    const r = await runReplayPackById('RPACK_001', { force: true });
    assert.equal(r.ok, true);
    assert.equal(r.turns, 3);
  });
});
