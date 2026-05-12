'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDefaultAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const { buildAdvisorResponseDraftContext } = require('../conversation/advisorDraftContext');
const { shouldUseAdvisorForRealEstateTurn } = require('../conversation/realEstateAdvisorReply');
const {
  fallbackRouteDecision,
  validateRouteDecision,
  evaluateRouteWithOpenAI,
  shouldSkipOpenAIRouteEvaluator,
  getAdvisorFailureFallbackReply,
} = require('../conversation/routeEvaluator');

test('fallbackRouteDecision: Hola busco casa en Cumbres → demand_initial', () => {
  const prev = getDefaultAiState();
  const text = 'Hola, busco casa en Cumbres';
  const sig = parseMessageSignals(text, prev, {});
  const d = fallbackRouteDecision({ text, previousAiState: prev, incomingSignals: sig, inboundContext: {} });
  assert.equal(d.route, 'demand_initial');
  assert.equal(d.intent, 'buy');
  assert.equal(d.lead_flow, 'demand');
  assert.equal(d.operation_type, 'sale');
  assert.equal(d.location_text, 'Cumbres');
  assert.equal(d.should_use_advisor_reply, true);
  assert.equal(d.response_goal, 'qualify_demand_and_capture_name');
});

test('fallbackRouteDecision: Jorge con awaiting full_name → demand_followup + candidato', () => {
  const prev = { ...getDefaultAiState(), lead_flow: 'demand', awaiting_field: 'full_name', operation_type: 'sale' };
  const text = 'Jorge';
  const sig = parseMessageSignals(text, prev, {});
  const d = fallbackRouteDecision({ text, previousAiState: prev, incomingSignals: sig, inboundContext: {} });
  assert.equal(d.route, 'demand_followup');
  assert.equal(d.person_name_candidate, 'Jorge');
  assert.equal(d.should_create_or_update_contact, true);
  assert.equal(d.should_use_advisor_reply, true);
});

test('fallbackRouteDecision: Mía en flujo venta → offer_followup', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'offer',
    operation_type: 'sale',
    awaiting_field: 'owner_relation',
    owner_relation: null,
  };
  const text = 'Mía';
  const sig = parseMessageSignals(text, prev, {});
  const d = fallbackRouteDecision({ text, previousAiState: prev, incomingSignals: sig, inboundContext: {} });
  assert.equal(d.route, 'offer_followup');
  assert.equal(d.lead_flow, 'offer');
  assert.equal(d.should_use_advisor_reply, true);
  assert.match(d.notes, /ownership/i);
});

test('fallbackRouteDecision: A0470 → property_interest', () => {
  const prev = getDefaultAiState();
  const text = 'A0470';
  const sig = parseMessageSignals(text, prev, {});
  const d = fallbackRouteDecision({ text, previousAiState: prev, incomingSignals: sig, inboundContext: {} });
  assert.equal(d.route, 'property_interest');
  assert.ok(d.property_code);
  assert.equal(d.should_use_advisor_reply, true);
});

test('fallbackRouteDecision: precio con propiedad activa → property_followup', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    operation_type: 'sale',
    property_code: 'LUX-A0470',
    direct_property_reference: true,
  };
  const text = '¿Cuál es el precio?';
  const sig = parseMessageSignals(text, prev, {});
  const d = fallbackRouteDecision({ text, previousAiState: prev, incomingSignals: sig, inboundContext: {} });
  assert.equal(d.route, 'property_followup');
  assert.equal(d.response_goal, 'price_followup');
  assert.equal(d.should_use_advisor_reply, true);
  assert.ok(d.forbidden_claims.some((x) => /no inventar precio/i.test(x)));
});

test('shouldSkipOpenAIRouteEvaluator: !reset no pasa por OpenAI evaluator', () => {
  assert.equal(
    shouldSkipOpenAIRouteEvaluator({
      text: '!reset',
      messageType: 'text',
      inboundContext: {},
    }),
    true
  );
});

test('evaluateRouteWithOpenAI: fallo OpenAI → fallback demand_initial sin publicación en advisor fallback', async () => {
  const prev = getDefaultAiState();
  const text = 'Hola, busco casa en Cumbres';
  const sig = parseMessageSignals(text, prev, {});
  const badClient = {
    chat: {
      completions: {
        create: async () => {
          throw new Error('simulated_openai_down');
        },
      },
    },
  };
  const d = await evaluateRouteWithOpenAI(
    { text, previousAiState: prev, incomingSignals: sig, inboundContext: {} },
    { openaiClient: badClient }
  );
  assert.equal(d.route, 'demand_initial');
  const fb = getAdvisorFailureFallbackReply(d);
  assert.match(fb, /casa/i);
  assert.match(fb, /Cumbres/i);
  assert.match(fb, /nombre/i);
  assert.doesNotMatch(fb, /publicaci[oó]n|liga|disponibilidad al momento/i);
});

test('integración: draft + advisor gate con route_evaluator_decision (post-reset)', () => {
  const prev = getDefaultAiState();
  const text = 'Hola, busco casa en Cumbres';
  const sig = parseMessageSignals(text, prev, {});
  const changeType = detectStateChange(prev, sig);
  const next = buildNextState(prev, sig, changeType);
  const decision = fallbackRouteDecision({ text, previousAiState: prev, incomingSignals: sig, inboundContext: {} });
  const mergedSig = { ...sig, route_evaluator_decision: decision };
  const draft = buildAdvisorResponseDraftContext({
    user_message: text,
    ai_state: next,
    signals: mergedSig,
    contact: null,
    suggested_properties: [],
    recent_db_messages: [],
  });
  assert.equal(draft.response_goal, 'qualify_demand_and_capture_name');
  assert.equal(draft.metadata.route_evaluator_route, 'demand_initial');

  const route = shouldUseAdvisorForRealEstateTurn({
    ai_state: next,
    signals: mergedSig,
    contact: null,
    user_message: text,
    suggested_properties: [],
    campaign_context: null,
    media_context: {},
    recent_db_messages: [],
    route_evaluator_decision: decision,
  });
  assert.equal(route.use, true);
});

test('validateRouteDecision: ignora CRM peligroso del modelo', () => {
  const raw = {
    route: 'demand_initial',
    intent: 'buy',
    confidence: 1,
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
    property_code: null,
    person_name_candidate: null,
    missing_fields: [],
    should_use_advisor_reply: true,
    should_use_programmed_reply: false,
    programmed_route_reason: null,
    should_create_or_update_contact: true,
    should_create_or_update_lead: true,
    response_goal: 'qualify_demand_and_capture_name',
    advisor_mode: 'demand_active',
    safety_flags: [],
    forbidden_claims: [],
    notes: 'model_says_crm',
  };
  const v = validateRouteDecision(raw, {
    text: 'Hola',
    previousAiState: getDefaultAiState(),
    incomingSignals: parseMessageSignals('Hola', getDefaultAiState(), {}),
    contact: null,
  });
  assert.equal(v.should_create_or_update_lead, false);
  assert.equal(v.should_create_or_update_contact, false);
});
