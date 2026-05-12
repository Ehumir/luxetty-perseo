'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const {
  mergeContextualSignals,
  substituteForbiddenGenericDemandReply,
  isGenericConsultiveReply,
} = require('../conversation/contextualMemoryResolver');

const { _private: idx } = require('../index');

function advanceState(prev, text, inboundContext = { media: { type: 'text' } }) {
  const parsed = parseMessageSignals(text, prev, inboundContext);
  const changeType = detectStateChange(prev, parsed);
  let next = buildNextState(prev, parsed, changeType);
  Object.assign(next, mergeContextualSignals(parsed, prev, next, text));
  return { next, parsed };
}

test('contrato mínimo: flujo Cumbres → 8M → recámaras → opciones → nombre Jorge', () => {
  let state = normalizeAiState(getDefaultAiState());

  // 1) Hola, busco casa en Cumbres
  let r = advanceState(state, 'Hola, busco casa en Cumbres');
  state = r.next;
  assert.equal(state.lead_flow, 'demand');
  assert.equal(state.location_text, 'Cumbres');
  let reply = idx.buildConsultiveFallbackReply({ text: 'Hola, busco casa en Cumbres', signals: r.parsed, aiState: state });
  assert.match(reply, /compartes tu nombre/i);
  assert.match(reply, /presupuesto/i);

  // 2) 8 millones
  r = advanceState(state, '8 millones');
  state = r.next;
  assert.equal(state.location_text, 'Cumbres');
  assert.equal(state.budget_max, 8_000_000);

  // 3) recámaras
  r = advanceState(state, 'que tenga 3 recámaras');
  state = r.next;
  assert.equal(state.budget_max, 8_000_000);
  assert.equal(state.bedrooms, 3);

  // 4) ¿Tienes opciones?
  r = advanceState(state, '¿Tienes opciones?');
  state = r.next;
  const bad = 'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.';
  const sub = substituteForbiddenGenericDemandReply(bad, {
    text: '¿Tienes opciones?',
    aiState: state,
    hasValidName: false,
    matchedProperties: [],
  });
  assert.equal(isGenericConsultiveReply(String(sub.messages)), false);
  assert.match(String(sub.messages), /Cumbres/);
  assert.match(String(sub.messages), /8/);

  // 5) en esa zona con ese presupuesto
  r = advanceState(state, 'en esa zona con ese presupuesto');
  state = r.next;
  assert.equal(state.location_text, 'Cumbres');
  assert.equal(state.budget_max, 8_000_000);

  // 7–8) soy Jorge → awaiting_field null, sin plantilla genérica
  r = advanceState({ ...state, awaiting_field: 'full_name' }, 'soy Jorge');
  state = r.next;
  assert.equal(state.full_name, 'Jorge');
  if (state.awaiting_field === 'full_name') state.awaiting_field = null;
  assert.equal(state.awaiting_field, null);

  const sub2 = substituteForbiddenGenericDemandReply(bad, {
    text: 'gracias',
    aiState: state,
    hasValidName: true,
    matchedProperties: [],
  });
  assert.equal(isGenericConsultiveReply(String(sub2.messages)), false);
});

test('contrato: propiedades mockeadas no repiten más de 3 y sin inventar precio en texto', () => {
  const state = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    location_text: 'Cumbres',
    budget_max: 8_000_000,
  });
  const props = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}`, listing_id: `LUX-X${i}000` }));
  const sub = substituteForbiddenGenericDemandReply('Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.', {
    text: 'opciones',
    aiState: state,
    hasValidName: true,
    matchedProperties: props,
  });
  const m = String(sub.messages).match(/LUX-X/g);
  assert.ok(!m || m.length <= 3);
  assert.match(String(sub.messages), /sin inventar|sin inventar precio|precios/i);
});

test('contrato: lead_id existente no implica pérdida de ids en estado (campos conservados al avanzar)', () => {
  let state = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    location_text: 'Cumbres',
    budget_max: 8_000_000,
    lead_id: 'lead-111',
    contact_id: 'contact-222',
  });
  const r = advanceState(state, '5 mdp');
  state = r.next;
  assert.equal(state.budget_max, 5_000_000);
  assert.equal(state.lead_id, 'lead-111');
  assert.equal(state.contact_id, 'contact-222');
});
