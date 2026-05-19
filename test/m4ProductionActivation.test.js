'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { resetMemoryCrmRuntimeStore, MemoryCrmRuntimeStore } = require('../conversation/v3/runtime/crmRuntimeStore');
const { evaluateJobPoisoning, computeCrmBackoffMs } = require('../conversation/v3/runtime/crmWorkerPoisoning');
const { runCrmOutboxWorkerOnce } = require('../conversation/v3/runtime/crmOutboxWorker');
const { withTimeout } = require('../services/inboundMediaV3Bridge');
const { getMediaTimeoutMs } = require('../config/perseoM402Flags');
const {
  enqueueScenarioCandidate,
  listPendingReview,
  scoreScenarioCandidate,
  resetReviewQueue,
} = require('../corpus/learningReviewQueue');
const { suggestScenarioCandidates } = require('../corpus/learningRuntime');

describe('M4-02 production activation', () => {
  beforeEach(() => {
    resetMemoryCrmRuntimeStore();
    resetReviewQueue();
    delete process.env.PERSEO_CRM_WORKER_ASYNC_ENABLED;
    delete process.env.PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED;
  });

  it('poisoning freezes after repeated same error', () => {
    const job = { attempts: 1, max_attempts: 5, last_error_signature: 'err_x', error_repeat_count: 1 };
    const p = evaluateJobPoisoning(job, 'err_x');
    assert.equal(p.action, 'freeze');
  });

  it('backoff increases by attempt', () => {
    assert.equal(computeCrmBackoffMs(1), 0);
    assert.ok(computeCrmBackoffMs(3) >= 30_000);
  });

  it('memory worker claims pending job', async () => {
    process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED = 'true';
    const store = new MemoryCrmRuntimeStore('conv-w');
    const enq = await store.enqueue({ payload: {}, idempotencyKey: 'k-w' });
    assert.equal(enq.enqueued, true);
    const claimed = await store.claimJobs({ batchSize: 1, workerId: 't' });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].status, 'processing');
  });

  it('media timeouts match M4-02 spec', () => {
    assert.equal(getMediaTimeoutMs('audio'), 12000);
    assert.equal(getMediaTimeoutMs('image'), 15000);
    assert.equal(getMediaTimeoutMs('document'), 8000);
  });

  it('withTimeout resolves gracefully', async () => {
    const r = await withTimeout(
      new Promise((resolve) => setTimeout(() => resolve('ok'), 20)),
      50,
      'test',
    );
    assert.equal(r.timed_out, false);
    assert.equal(r.value, 'ok');
  });

  it('learning review queue requires human review', () => {
    const c = suggestScenarioCandidates({ corpus_id: 'X1' }, { primary: 'policy' });
    const row = enqueueScenarioCandidate(c, { confidence: c.confidence });
    assert.equal(row.requires_review, true);
    assert.ok(listPendingReview().length >= 1);
  });

  it('scoreScenarioCandidate bounded', () => {
    const s = scoreScenarioCandidate({}, { primary: 'crm' });
    assert.ok(s <= 0.95);
    assert.ok(s >= 0.5);
  });
});
