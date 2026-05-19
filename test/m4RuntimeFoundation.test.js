'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { resetMemoryCrmRuntimeStore, MemoryCrmRuntimeStore } = require('../conversation/v3/runtime/crmRuntimeStore');
const { runUnderstandingRuntime } = require('../conversation/v3/runtime/understandingRuntime');
const { runResilienceRuntime } = require('../conversation/v3/runtime/resilienceRuntime');
const {
  recordOperationalEvent,
  resetMemoryTelemetry,
} = require('../conversation/v3/runtime/waTelemetry');
const { classifyCorpusRecord, suggestScenarioCandidates } = require('../corpus/learningRuntime');
const { applyPolicyRuntimeOverlay } = require('../conversation/v3/policy/policyRuntime');
const { resetRuntimeTableProbeCache } = require('../conversation/v3/runtime/runtimeTableProbe');

describe('M4 runtime foundation', () => {
  beforeEach(() => {
    resetMemoryCrmRuntimeStore();
    resetMemoryTelemetry();
    resetRuntimeTableProbeCache();
    delete process.env.PERSEO_UNDERSTANDING_RUNTIME_ENABLED;
    delete process.env.PERSEO_RESILIENCE_RUNTIME_ENABLED;
    delete process.env.PERSEO_WA_TELEMETRY_ENABLED;
    delete process.env.PERSEO_POLICY_RUNTIME_ENABLED;
  });

  it('memory CRM store enqueue and idempotency', async () => {
    const store = new MemoryCrmRuntimeStore('conv-1');
    const r1 = await store.enqueue({ payload: {}, idempotencyKey: 'k1' });
    assert.equal(r1.enqueued, true);
    await store.markCompleted('k1', r1.outbox_id, {});
    const r2 = await store.enqueue({ payload: {}, idempotencyKey: 'k1' });
    assert.equal(r2.enqueued, false);
  });

  it('understanding runtime OFF is no-op', () => {
    assert.equal(runUnderstandingRuntime({ state: {}, inboundText: 'Hola' }), null);
  });

  it('understanding runtime fuses messages when ON', () => {
    process.env.PERSEO_UNDERSTANDING_RUNTIME_ENABLED = 'true';
    const out = runUnderstandingRuntime({
      state: { conversationId: 'c1' },
      inboundText: 'Hola',
      recentMessages: ['Hola', 'Soy Jorge', 'Cumbres'],
    });
    assert.ok(out.patch.understanding.fused_turn.fused_text.includes('Jorge'));
  });

  it('resilience runtime detects confusion', () => {
    process.env.PERSEO_RESILIENCE_RUNTIME_ENABLED = 'true';
    const out = runResilienceRuntime({
      state: { lastAssistantReply: '¿En qué zona buscas?' },
      text: 'No entiendo',
      replyText: '¿En qué zona buscas?',
    });
    assert.equal(out.metrics.confusion_detected, true);
    assert.ok(['clarify', 'handoff', 'rephrase'].includes(out.recovery_plan.action));
  });

  it('telemetry memory mode without DB', () => {
    process.env.PERSEO_WA_TELEMETRY_ENABLED = 'true';
    const r = recordOperationalEvent(null, { conversation_id: 'c1' }, null, { argosMode: true });
    assert.equal(r.recorded, true);
    assert.equal(r.mode, 'memory_argos');
  });

  it('learning suggest does not auto-promote', () => {
    const c = classifyCorpusRecord({ user_message: 'necesito asesor', assistant_message: '' });
    const s = suggestScenarioCandidates({ corpus_id: 'X' }, c);
    assert.equal(s.promoted, false);
    assert.equal(s.requires_review, true);
  });

  it('policy runtime overlay when enabled', () => {
    process.env.PERSEO_POLICY_RUNTIME_ENABLED = 'true';
    const o = applyPolicyRuntimeOverlay({ language: 'es', zone: 'Cumbres' });
    assert.equal(o.applied, true);
  });
});
