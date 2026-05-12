'use strict';

/**
 * Sprint 1 — QA orchestrator (!reset, !state, !close, !leadcheck) + números oficiales.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const { interceptQaCommand } = require('../conversation/qaCommands');
const {
  parseSprint1StrictCommand,
  isSprint1QaTesterPhone,
  processSprint1QaInbound,
  REPLY_RESET,
  REPLY_CLOSE,
} = require('../conversation/qaSprint1Commands');

function buildMockSaveEvent(log) {
  return async (convId, type, payload) => {
    log.push({ convId, type, payload });
  };
}

function buildMockSaveState(holder) {
  return async (_id, next) => {
    Object.assign(holder, next);
  };
}

function buildMockSendReply(log) {
  return async (_to, messages) => {
    log.push({ messages });
  };
}

function advance(prev, text) {
  const p = parseMessageSignals(text, prev, { media: { type: 'text' } });
  return buildNextState(prev, p, detectStateChange(prev, p));
}

test('S1 parse: !reset / !state / variantes espacio y mayúsculas', () => {
  assert.equal(parseSprint1StrictCommand('  !reset  '), 'reset');
  assert.equal(parseSprint1StrictCommand('!RESET'), 'reset');
  assert.equal(parseSprint1StrictCommand('!state'), 'state');
  assert.equal(parseSprint1StrictCommand('!leadcheck'), 'leadcheck');
  assert.equal(parseSprint1StrictCommand('!reset extra'), null);
});

test('S1 allowlist: números oficiales y variantes MX', () => {
  assert.equal(isSprint1QaTesterPhone('8181877351'), true);
  assert.equal(isSprint1QaTesterPhone('+52 1 81 8187 7351'), true);
  assert.equal(isSprint1QaTesterPhone('5218181877351'), true);
  assert.equal(isSprint1QaTesterPhone('528181877351'), true);
  assert.equal(isSprint1QaTesterPhone('5218119086196'), true);
  assert.equal(isSprint1QaTesterPhone('5218111111111'), false);
});

test('S1 !reset limpia ai_state (getDefaultAiState)', async () => {
  const events = [];
  const state = {};
  const conv = {
    id: 'c1',
    contact_id: 'ct1',
    lead_id: 'ld1',
    ai_state: { lead_flow: 'demand', full_name: 'Ana', location_text: 'Centro', budget_max: 1 },
  };
  const r = await processSprint1QaInbound({
    text: '!reset',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: conv,
    metaMessageId: 'm1',
    supabase: {},
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: buildMockSaveEvent(events),
    saveStateFn: buildMockSaveState(state),
    updateConversationFn: null,
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  assert.equal(r.handled, true);
  assert.equal(state.lead_flow, null);
  assert.equal(state.full_name, null);
  assert.ok(events.some((e) => e.type === 'qa_reset_executed'));
});

test('S1 !reset no crea contacto ni lead (solo estado + evento)', async () => {
  const fromCalls = [];
  const supabase = {
    from(table) {
      fromCalls.push(table);
      return { select() { return this; }, insert() { return this; }, eq() { return this; } };
    },
  };
  const events = [];
  const state = {};
  await processSprint1QaInbound({
    text: '!reset',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: { id: 'c1', ai_state: {} },
    metaMessageId: 'm1',
    supabase,
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: buildMockSaveEvent(events),
    saveStateFn: buildMockSaveState(state),
    updateConversationFn: null,
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  assert.ok(!fromCalls.includes('contacts'));
  assert.ok(!fromCalls.includes('leads'));
});

test('S1 !reset respuesta exacta', async () => {
  const r = await processSprint1QaInbound({
    text: '!reset',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: { id: 'c1', ai_state: {} },
    metaMessageId: null,
    supabase: {},
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: async () => {},
    saveStateFn: async () => {},
    updateConversationFn: null,
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  assert.deepEqual(r.messages, [REPLY_RESET]);
});

test('S1 después de !reset, "Hola, busco casa en Cumbres" no arrastra contexto previo', async () => {
  const stateHolder = {};
  await processSprint1QaInbound({
    text: '!reset',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: {
      id: 'c1',
      ai_state: { lead_flow: 'demand', location_text: 'Mitras', full_name: 'Pepe', budget_max: 9 },
    },
    metaMessageId: 'm1',
    supabase: {},
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: async () => {},
    saveStateFn: buildMockSaveState(stateHolder),
    updateConversationFn: null,
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  let s = { ...stateHolder };
  s = advance(s, 'Hola, busco casa en Cumbres');
  assert.equal(s.location_text, 'Cumbres');
  assert.notEqual(s.location_text, 'Mitras');
});

test('S1 !state resumen seguro (sin exponer claves arbitrarias)', async () => {
  const events = [];
  const out = await processSprint1QaInbound({
    text: '!state',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: {
      id: 'c1',
      contact_id: 'cid',
      lead_id: 'lid',
      ai_state: { lead_flow: 'demand', full_name: 'Rosa', secret_token: 'x' },
    },
    metaMessageId: null,
    supabase: {},
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: buildMockSaveEvent(events),
    saveStateFn: async () => {},
    updateConversationFn: null,
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  assert.equal(out.handled, true);
  const msg = out.messages[0];
  assert.match(msg, /lead_flow:/);
  assert.match(msg, /contact_id:/);
  assert.doesNotMatch(msg, /secret_token/);
  assert.ok(events.some((e) => e.type === 'qa_state_viewed'));
});

test('S1 !close sin inserts en contacts/leads', async () => {
  const fromCalls = [];
  const supabase = {
    from(table) {
      fromCalls.push(table);
      return {
        update() {
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  await processSprint1QaInbound({
    text: '!close',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: { id: 'c1', ai_state: { lead_flow: 'demand' } },
    metaMessageId: null,
    supabase,
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: async () => {},
    saveStateFn: async () => {},
    updateConversationFn: async () => {},
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  assert.ok(!fromCalls.includes('contacts'));
  assert.ok(!fromCalls.includes('leads'));
});

test('S1 !leadcheck solo lectura de leads', async () => {
  const fromCalls = [];
  const supabase = {
    from(table) {
      fromCalls.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: { lead_type: 'demand', assigned_agent_profile_id: 'ag1' }, error: null }),
      };
    },
  };
  const r = await processSprint1QaInbound({
    text: '!leadcheck',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: { id: 'c1', contact_id: 'x', lead_id: 'y', ai_state: {} },
    metaMessageId: null,
    supabase,
    getDefaultAiState,
    normalizeAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    saveEventFn: async () => {},
    saveStateFn: async () => {},
    updateConversationFn: null,
    conversations: null,
    isQaExecutionAllowed: () => true,
  });
  assert.equal(r.handled, true);
  assert.match(r.messages[0], /contacto vinculado: sí/);
  assert.ok(!fromCalls.includes('contacts'));
  assert.ok(fromCalls.includes('leads'));
});

test('S1 intercept: no autorizado → qa_command_unauthorized', async () => {
  const events = [];
  const r = await interceptQaCommand({
    text: '!reset',
    from: '5218999999999',
    conversationId: 'c1',
    conversationRow: { id: 'c1', ai_state: {} },
    supabase: {},
    conversations: new Map(),
    sendReplyFn: async () => assert.fail('no reply'),
    saveEventFn: buildMockSaveEvent(events),
    saveStateFn: async () => assert.fail('no state'),
    getDefaultState: getDefaultAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    metaMessageId: 'm1',
    logger: { log() {} },
  });
  assert.equal(r.handled, false);
  assert.equal(r.reason, 'qa_command_unauthorized');
  assert.ok(events.some((e) => e.type === 'qa_command_unauthorized'));
});

test('S1 intercept !close respuesta exacta', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '5218181877351';
  const reply = [];
  await interceptQaCommand({
    text: '!close',
    from: '5218181877351',
    conversationId: 'c1',
    conversationRow: { id: 'c1', ai_state: {} },
    supabase: {
      from() {
        return { update() { return this; }, eq: async () => ({ error: null }) };
      },
    },
    conversations: new Map(),
    sendReplyFn: buildMockSendReply(reply),
    saveEventFn: async () => {},
    saveStateFn: async () => {},
    getDefaultState: getDefaultAiState,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    metaMessageId: 'm1',
    logger: { log() {} },
    updateConversationFn: async () => {},
  });
  assert.equal(String(reply[0].messages), REPLY_CLOSE);
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('S1 index.js: QA Sprint1 antes de processConversationTurnV2', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const iSprint = src.indexOf('processSprint1QaInbound');
  const iV2 = src.indexOf('processConversationTurnV2');
  assert.ok(iSprint > 0 && iV2 > 0);
  assert.ok(iSprint < iV2);
});
