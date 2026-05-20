'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('v3GateTelemetry', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351,5218119086196';
    process.env.RAILWAY_SERVICE_NAME = 'luxetty-perseo-qa';
    process.env.SUPABASE_URL = 'https://pjoxytwsvbeoivppczdx.supabase.co';
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    delete require.cache[require.resolve('../conversation/v3/core/v3GateTelemetry')];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('buildV3PrimaryGatePayload — gate blocked → legacy', () => {
    const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');
    const { buildV3PrimaryGatePayload } = require('../conversation/v3/core/v3GateTelemetry');
    process.env.PERSEO_V3_ENABLED = 'false';
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    const { evaluateV3PrimaryGate: eval2 } = require('../config/perseoV3Flags');
    const gate = eval2({ phone: '5218181877351' });
    const payload = buildV3PrimaryGatePayload({ gate, handled: false });
    assert.equal(payload.event, 'v3_primary_gate');
    assert.equal(payload.normalized_from, '5218181877351');
    assert.equal(payload.perseo_v3_enabled, false);
    assert.equal(payload.selected_pipeline, 'legacy');
    assert.equal(payload.handled, false);
    assert.equal(payload.block_reason, 'v3_disabled');
    assert.equal(payload.railway_service, 'luxetty-perseo-qa');
    assert.equal(payload.supabase_project_ref, 'pjoxytwsvbeoivppczdx');
  });

  it('buildV3PrimaryGatePayload — gate ok + handled → v3', () => {
    const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');
    const { buildV3PrimaryGatePayload } = require('../conversation/v3/core/v3GateTelemetry');
    const gate = evaluateV3PrimaryGate({ phone: '5218181877351' });
    const payload = buildV3PrimaryGatePayload({
      gate,
      handled: true,
      resultExtras: { responseSource: 'v3_core_f3_1' },
    });
    assert.equal(payload.is_qa_allowed, true);
    assert.equal(payload.allowlist_count, 2);
    assert.equal(payload.selected_pipeline, 'v3');
    assert.equal(payload.handled, true);
    assert.equal(payload.response_source, 'v3_core_f3_1');
    assert.match(payload.deployment_hint, /supabase_ref:pjoxytwsvbeoivppczdx/);
  });

  it('persistV3PrimaryGateEvent — calls saveConversationEvent', async () => {
    const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');
    const { persistV3PrimaryGateEvent } = require('../conversation/v3/core/v3GateTelemetry');
    const gate = evaluateV3PrimaryGate({ phone: '5218181877351' });
    const calls = [];
    await persistV3PrimaryGateEvent(
      {
        conversationId: 'conv-test',
        saveConversationEvent: async (cid, type, payload) => {
          calls.push({ cid, type, payload });
        },
      },
      gate,
      false,
      { blockReason: 'v3_disabled' },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'v3_primary_gate');
    assert.equal(calls[0].payload.event, 'v3_primary_gate');
    assert.equal(calls[0].payload.selected_pipeline, 'legacy');
  });
});
