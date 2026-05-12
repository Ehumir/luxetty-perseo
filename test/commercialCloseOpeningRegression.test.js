'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const {
  detectCommercialCloseSignal,
  detectOpeningCommercialIntent,
  evaluateCommercialCloseDecision,
} = require('../conversation/inboundReliability');
const { interceptQaCommand } = require('../conversation/qaCommands');

const offerSellerState = {
  lead_flow: 'offer',
  operation_type: 'sale',
  last_clear_intent: 'sell_property',
  intent_type: 'supply',
};

test('B1) !reset no clasifica como unclear_non_real_estate (parser)', () => {
  const sig = parseMessageSignals('!reset', getDefaultAiState(), {});
  assert.equal(sig.unclear_non_real_estate, false);
  assert.equal(sig.wrong_context, false);
  assert.equal(sig.inbound_business_category, 'real_estate_client');
});

test('B2) interceptQaCommand !reset sin allowlist: no handled, isQaCommand true', async () => {
  const original = process.env.QA_ALLOWED_WHATSAPP_NUMBERS;
  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = '';

  const result = await interceptQaCommand({
    text: '!reset',
    from: '5218999999999',
    conversationId: 'conv-x',
    conversationRow: { id: 'conv-x', ai_state: getDefaultAiState() },
    supabase: {},
    conversations: new Map(),
    sendReplyFn: async () => {},
    saveEventFn: async () => {},
    saveStateFn: async () => {
      assert.fail('saveStateFn no debe llamarse cuando QA está denegado');
    },
    getDefaultState: getDefaultAiState,
    nowIso: () => new Date().toISOString(),
    metaMessageId: 'mid-1',
    logger: { log() {} },
  });

  assert.equal(result.handled, false);
  assert.equal(result.isQaCommand, true);
  assert.equal(result.reason, 'qa_command_unauthorized');

  process.env.QA_ALLOWED_WHATSAPP_NUMBERS = original || '';
});

test('C1) detectCommercialCloseSignal: apertura venta NO es cierre', () => {
  assert.equal(detectCommercialCloseSignal('Quiero vender mi casa en Cumbres.'), false);
  assert.equal(detectCommercialCloseSignal('quiero valuar mi departamento'), false);
  assert.equal(detectCommercialCloseSignal('quiero más información'), false);
});

test('C2) evaluateCommercialCloseDecision: venta inicial NO cierra comercial', () => {
  const decision = evaluateCommercialCloseDecision({
    text: 'Quiero vender mi casa en Cumbres.',
    state: offerSellerState,
    hasPropertyContext: false,
  });
  assert.equal(decision.shouldClose, false);
  assert.equal(decision.reason, 'opening_commercial_intent_not_close');
});

test('D) valuación / duda de precio: NO cierre comercial', () => {
  const t = 'Quiero vender pero no sé cuánto vale';
  assert.equal(detectOpeningCommercialIntent(t), true);
  const decision = evaluateCommercialCloseDecision({
    text: t,
    state: offerSellerState,
    hasPropertyContext: false,
  });
  assert.equal(decision.shouldClose, false);
});

test('E1) pedido explícito de asesor: sí es señal de cierre con contexto oferta', () => {
  assert.equal(detectCommercialCloseSignal('Quiero hablar con un asesor'), true);
  const decision = evaluateCommercialCloseDecision({
    text: 'Quiero hablar con un asesor',
    state: offerSellerState,
    hasPropertyContext: false,
  });
  assert.equal(decision.shouldClose, true);
});

test('E2) que me contacten con contexto demand sigue cerrando', () => {
  const decision = evaluateCommercialCloseDecision({
    text: 'que me contacten',
    state: { lead_flow: 'demand', property_code: 'LUX-A0001' },
    hasPropertyContext: true,
  });
  assert.equal(decision.shouldClose, true);
});

test('F) burst consolidado (varias burbujas): mantiene offer y acumula slots', () => {
  const combined =
    'Quiero vender mi casa\nEstá en Cumbres\nTiene 3 recámaras\nMi precio ideal seria 5.2 millones';

  let state = getDefaultAiState();
  const sig = parseMessageSignals(combined, state, {});
  const change = detectStateChange(state, sig);
  state = buildNextState(state, sig, change);

  assert.equal(state.lead_flow, 'offer');
  assert.equal(state.operation_type, 'sale');
  assert.ok(state.location_text || state.zone);
  assert.equal(state.bedrooms, 3);
  assert.ok(state.budget_max != null || state.expected_price != null || state.asking_price != null);

  const closeDecision = evaluateCommercialCloseDecision({
    text: combined,
    state,
    hasPropertyContext: false,
  });
  assert.equal(closeDecision.shouldClose, false);
});
