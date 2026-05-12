'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const {
  mergeContextualSignals,
  substituteForbiddenGenericDemandReply,
  isGenericFallbackForbidden,
  isGenericConsultiveReply,
} = require('../conversation/contextualMemoryResolver');
const { mergeSignalsWithMulti, extractMultiSignals } = require('../conversation/multiSignalExtractor');
const propertyIntentResolver = require('../conversation/propertyIntentResolver');
const { _private: idx } = require('../index');

function advanceWebhookLike(prev, text) {
  const parsed = mergeSignalsWithMulti(
    parseMessageSignals(text, prev, { media: { type: 'text' } }),
    extractMultiSignals(text, prev)
  );
  Object.assign(parsed, propertyIntentResolver.resolvePropertyIntent(text, prev));
  const changeType = detectStateChange(prev, parsed);
  let next = buildNextState(prev, parsed, changeType);
  Object.assign(next, mergeContextualSignals(parsed, prev, next, text));
  return { next, parsed };
}

test('pipeline: código persiste en ai_state', () => {
  const prev = normalizeAiState(getDefaultAiState());
  const { next } = advanceWebhookLike(prev, 'Me interesa la propiedad LUX-A0461');
  assert.equal(next.property_code, 'LUX-A0461');
  assert.equal(next.direct_property_reference, true);
  assert.equal(next.property_specific_intent, true);
});

test('pipeline: follow-up sin código mantiene property_code', () => {
  const prev = normalizeAiState({
    ...getDefaultAiState(),
    property_code: 'LUX-A0461',
    direct_property_reference: true,
    property_specific_intent: true,
    lead_flow: 'demand',
  });
  const { next } = advanceWebhookLike(prev, '¿Cuál es el precio?');
  assert.equal(next.property_code, 'LUX-A0461');
  assert.equal(next.property_specific_intent, true);
});

test('pipeline: no fuerza plantilla genérica de demanda cuando hay propiedad', () => {
  const state = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    property_code: 'LUX-A0461',
    direct_property_reference: true,
    property_specific_intent: true,
  });
  const generic = 'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.';
  assert.equal(isGenericFallbackForbidden(state, 'hola'), true);
  assert.equal(isGenericConsultiveReply(generic), true);
  const sub = substituteForbiddenGenericDemandReply(generic, {
    text: 'ok',
    aiState: state,
    hasValidName: true,
    matchedProperties: [],
    resolvedPropertyRow: null,
    recentMessages: [],
    contact: null,
    waProfileName: null,
  });
  assert.match(String(sub.messages), /LUX-A0461/);
  assert.doesNotMatch(String(sub.messages), /Dime un poco más de lo que buscas y te oriento/i);
});

test('pipeline: salir de property mode conserva lead_flow demand', () => {
  const prev = normalizeAiState({
    ...getDefaultAiState(),
    property_code: 'LUX-A0461',
    property_specific_intent: true,
    direct_property_reference: true,
    lead_flow: 'demand',
    full_name: 'Laura',
    contact_id: 'c1',
  });
  const { next } = advanceWebhookLike(prev, 'Ya no esa, mejor busco casa en Cumbres');
  assert.equal(next.property_specific_intent, false);
  assert.equal(next.property_code, null);
  assert.ok(next.lead_flow === 'demand' || next.lead_flow === null);
});

test('buildConsultiveFallbackReply: intro propiedad encontrada', () => {
  const state = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    property_code: 'LUX-A0461',
    direct_property_reference: true,
    property_specific_intent: true,
  });
  const row = { id: 'p1', listing_id: 'LUX-A0461', price: 3_000_000, slug: 'casa-lux-a0461' };
  const reply = idx.buildConsultiveFallbackReply({
    text: 'Me interesa',
    signals: { lead_flow: 'demand' },
    aiState: state,
    contact: null,
    waProfileName: null,
    resolvedPropertyRow: row,
    recentMessages: [],
  });
  assert.match(reply, /LUX-A0461/);
  assert.match(reply, /ubicación|visita|detalles|precio|disponibilidad|liga|luxetty\.com/i);
});
