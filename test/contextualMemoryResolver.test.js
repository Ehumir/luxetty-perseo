'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveContextualFollowUp,
  hasOperationalContext,
  isGenericFallbackForbidden,
  buildContextualDemandReply,
  mergeContextualSignals,
  substituteForbiddenGenericDemandReply,
  isGenericConsultiveReply,
} = require('../conversation/contextualMemoryResolver');

test('hasOperationalContext detecta lead_flow, zona, presupuesto y recámaras', () => {
  assert.equal(hasOperationalContext({}), false);
  assert.equal(hasOperationalContext({ lead_flow: 'demand' }), true);
  assert.equal(hasOperationalContext({ location_text: 'Cumbres' }), true);
  assert.equal(hasOperationalContext({ budget_max: 8_000_000 }), true);
  assert.equal(hasOperationalContext({ bedrooms: 3 }), true);
  assert.equal(hasOperationalContext({ must_have_features: ['patio'] }), true);
});

test('mergeContextualSignals: 8 millones con demanda y zona previa → budget_max', () => {
  const prev = { lead_flow: 'demand', location_text: 'Cumbres', operation_type: 'sale' };
  const patch = mergeContextualSignals({}, prev, { ...prev }, '8 millones');
  assert.equal(patch.budget_max, 8_000_000);
});

test('mergeContextualSignals: 5 mdp', () => {
  const prev = { lead_flow: 'demand', location_text: 'Cumbres' };
  const patch = mergeContextualSignals({}, prev, { ...prev }, '5 mdp');
  assert.equal(patch.budget_max, 5_000_000);
});

test('mergeContextualSignals: 3 cuartos / recámaras', () => {
  const prev = { lead_flow: 'demand', location_text: 'Cumbres', budget_max: 8_000_000 };
  let patch = mergeContextualSignals({}, prev, { ...prev }, 'que tenga 3 recámaras');
  assert.equal(patch.bedrooms, 3);
  patch = mergeContextualSignals({}, prev, { ...prev }, '3 cuartos');
  assert.equal(patch.bedrooms, 3);
});

test('mergeContextualSignals: patio y alberca en must_have_features', () => {
  const prev = { lead_flow: 'demand', location_text: 'X', must_have_features: [] };
  const patch = mergeContextualSignals({}, prev, { ...prev }, 'con patio y alberca');
  assert.ok(patch.must_have_features.includes('patio'));
  assert.ok(patch.must_have_features.includes('alberca'));
});

test('resolveContextualFollowUp reconoce solicitud de opciones con contexto', () => {
  const st = { lead_flow: 'demand', location_text: 'Cumbres', budget_max: 8_000_000 };
  const r = resolveContextualFollowUp('¿Tienes opciones?', st, []);
  assert.equal(r.type, 'options_request');
});

test('isGenericFallbackForbidden bloquea plantilla cuando hay contexto', () => {
  const st = { lead_flow: 'demand', location_text: 'Cumbres' };
  assert.equal(isGenericFallbackForbidden(st, 'ok'), true);
});

test('substituteForbiddenGenericDemandReply reemplaza frase prohibida', () => {
  const st = { lead_flow: 'demand', location_text: 'Cumbres', budget_max: 8_000_000, operation_type: 'sale' };
  const bad = 'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.';
  const sub = substituteForbiddenGenericDemandReply(bad, {
    text: 'sigue',
    aiState: st,
    hasValidName: false,
    matchedProperties: [],
  });
  assert.ok(!isGenericConsultiveReply(Array.isArray(sub.messages) ? sub.messages.join(' ') : sub.messages));
  assert.match(String(sub.messages), /Cumbres/);
  assert.match(String(sub.messages), /8/);
});

test('buildContextualDemandReply con propiedades mockeadas lista máximo 3 códigos', () => {
  const props = [
    { listing_id: 'LUX-A0001', id: '1' },
    { listing_id: 'LUX-A0002', id: '2' },
    { listing_id: 'LUX-A0003', id: '3' },
    { listing_id: 'LUX-A0004', id: '4' },
  ];
  const text = buildContextualDemandReply({
    aiState: { lead_flow: 'demand', location_text: 'Cumbres', budget_max: 8_000_000 },
    text: 'opciones',
    hasValidName: true,
    matchedProperties: props,
  });
  const lux = (text.match(/LUX-A\d+/g) || []).length;
  assert.ok(lux <= 3);
});
