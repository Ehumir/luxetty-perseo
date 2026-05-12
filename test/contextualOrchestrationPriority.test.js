'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const { mergeContextualSignals, substituteForbiddenGenericDemandReply, replyDemandsUnknownBudgetOrZone } = require('../conversation/contextualMemoryResolver');
const { mergeSignalsWithMulti, extractMultiSignals } = require('../conversation/multiSignalExtractor');
const { _private: idx } = require('../index');

function advance(prev, text) {
  const parsed = mergeSignalsWithMulti(parseMessageSignals(text, prev, { media: { type: 'text' } }), extractMultiSignals(text, prev));
  const changeType = detectStateChange(prev, parsed);
  let next = buildNextState(prev, parsed, changeType);
  Object.assign(next, mergeContextualSignals(parsed, prev, next, text));
  return { next, parsed };
}

test('Dame opciones con contexto completo: no repregunta presupuesto ni zona', () => {
  const state = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    location_text: 'Cumbres',
    budget_max: 8_000_000,
    bedrooms: 3,
  });
  const wrong = idx.buildConsultiveFallbackReply({
    text: 'Dame opciones',
    signals: { lead_flow: 'demand', location_text: 'Cumbres' },
    aiState: state,
    contact: null,
    waProfileName: null,
  });
  assert.doesNotMatch(wrong, /presupuesto aproximado/i);
  assert.match(wrong, /Cumbres/);
  assert.match(wrong, /8/);
  assert.match(wrong, /3\s+rec/i);
});

test('replyDemandsUnknownBudgetOrZone detecta plantilla con presupuesto ya conocido', () => {
  const bad =
    'Claro, te ayudo a buscar casa en Cumbres. Para registrarte bien, ¿me compartes tu nombre? Y dime también tu presupuesto aproximado.';
  assert.equal(
    replyDemandsUnknownBudgetOrZone(bad, {
      lead_flow: 'demand',
      location_text: 'Cumbres',
      budget_max: 8_000_000,
    }),
    true
  );
});

test('substitute reemplaza respuesta redundante aunque no sea snippet genérico clásico', () => {
  const state = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    location_text: 'Cumbres',
    budget_max: 8_000_000,
    bedrooms: 3,
  });
  const wrong =
    'Claro, te ayudo a buscar casa en Cumbres. Para registrarte bien, ¿me compartes tu nombre? Y dime también tu presupuesto aproximado.';
  const sub = substituteForbiddenGenericDemandReply(wrong, {
    text: 'Dame opciones',
    aiState: state,
    hasValidName: false,
    matchedProperties: [],
  });
  assert.doesNotMatch(String(sub.messages), /presupuesto aproximado/i);
  assert.match(String(sub.messages), /Cumbres/);
});

test('full_name en contacto: enforce no vuelve a pedir nombre', () => {
  const contact = { first_name: 'Ana', last_name: 'López' };
  const out = idx.enforceNameCapture('Listo, reviso opciones.', {
    contact,
    aiState: { lead_flow: 'demand', location_text: 'Cumbres', budget_max: 8_000_000 },
    waProfileName: null,
    recentOutboundTexts: [],
    userInboundText: 'Dame opciones',
    leadFlow: 'demand',
  });
  assert.equal(out.applied, false);
});

test('simulación: Hola Cumbres → Jorge, 8 millones → recámaras → estado', () => {
  let s = normalizeAiState(getDefaultAiState());
  s = advance(s, 'Hola, busco casa en Cumbres').next;
  s = advance(s, 'Jorge, 8 millones').next;
  assert.equal(s.full_name, 'Jorge');
  assert.equal(s.budget_max, 8_000_000);
  assert.equal(s.location_text, 'Cumbres');
  s = advance(s, 'que tenga 3 recámaras').next;
  assert.equal(s.bedrooms, 3);
});
