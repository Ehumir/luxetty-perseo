'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAutomatedReplyPolicy,
  PERSEO_REASON_CODES,
  normalizePerseoAiControlFromRow,
} = require('../conversation/perseoGatekeeper');

afterEach(() => {
  delete process.env.PERSEO_POLICY_V2_ENABLED;
});

test('normalizePerseoAiControlFromRow — default sin ai_state', () => {
  const n = normalizePerseoAiControlFromRow(null);
  assert.equal(n.attention_mode, 'perseo');
  assert.equal(n.ai_paused, false);
});

test('normalizePerseoAiControlFromRow — human en ai_control', () => {
  const n = normalizePerseoAiControlFromRow({
    ai_state: { ai_control: { attention_mode: 'human' } },
  });
  assert.equal(n.attention_mode, 'human');
  assert.equal(n.ai_paused, true);
});

test('resolveAutomatedReplyPolicy — V2 off: conversación normal permite IA', async () => {
  process.env.PERSEO_POLICY_V2_ENABLED = 'false';
  const p = await resolveAutomatedReplyPolicy({
    supabase: null,
    conversationRow: { ai_state: {} },
    from: '5210000000000',
  });
  assert.equal(p.policyResolution, 'ok');
  assert.equal(p.allowAutomatedReply, true);
  assert.equal(p.reason_code, PERSEO_REASON_CODES.AUTOMATION_ALLOWED);
});

test('resolveAutomatedReplyPolicy — V2 off: atención humana conversación bloquea IA', async () => {
  process.env.PERSEO_POLICY_V2_ENABLED = 'false';
  const p = await resolveAutomatedReplyPolicy({
    supabase: null,
    conversationRow: { ai_state: { ai_control: { attention_mode: 'human' } } },
    from: '5210000000000',
  });
  assert.equal(p.allowAutomatedReply, false);
  assert.equal(p.reason_code, PERSEO_REASON_CODES.CONVERSATION_HUMAN_ATTENTION);
});

test('resolveAutomatedReplyPolicy — V2 on: fila global human_only bloquea', async () => {
  process.env.PERSEO_POLICY_V2_ENABLED = 'true';
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: { human_only_global: true, automation_enabled: true }, error: null };
        },
      };
    },
  };
  const p = await resolveAutomatedReplyPolicy({
    supabase,
    conversationRow: { ai_state: {} },
    from: '5210000000000',
  });
  assert.equal(p.policyResolution, 'ok');
  assert.equal(p.allowAutomatedReply, false);
  assert.equal(p.reason_code, PERSEO_REASON_CODES.HUMAN_ONLY_GLOBAL_ACTIVE);
});

test('resolveAutomatedReplyPolicy — V2 on: error Supabase → fail-closed', async () => {
  process.env.PERSEO_POLICY_V2_ENABLED = 'true';
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: { message: 'network' } };
        },
      };
    },
  };
  const p = await resolveAutomatedReplyPolicy({
    supabase,
    conversationRow: { ai_state: {} },
    from: '5210000000000',
  });
  assert.equal(p.policyResolution, 'error');
  assert.equal(p.allowAutomatedReply, false);
  assert.equal(p.reason_code, PERSEO_REASON_CODES.POLICY_SETTINGS_READ_FAILED);
});
