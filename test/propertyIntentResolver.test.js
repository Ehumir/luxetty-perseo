'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const pr = require('../conversation/propertyIntentResolver');

test('normalizePropertyCode: LUX-A0461', () => {
  assert.equal(pr.normalizePropertyCode('lux-a0461'), 'LUX-A0461');
  assert.equal(pr.normalizePropertyCode('A0461'), 'LUX-A0461');
  assert.equal(pr.normalizePropertyCode('a0461'), 'LUX-A0461');
});

test('extractPropertyCode: variantes', () => {
  assert.equal(pr.extractPropertyCode('Me interesa la propiedad LUX-A0461'), 'LUX-A0461');
  assert.equal(pr.extractPropertyCode('código A0461'), 'LUX-A0461');
  assert.equal(pr.extractPropertyCode('la A0461'), 'LUX-A0461');
  assert.equal(pr.extractPropertyCode('propiedad 461'), 'LUX-A0461');
  assert.equal(pr.extractPropertyCode('casa A0461'), 'LUX-A0461');
});

test('resolvePropertyIntent activa property_specific_intent', () => {
  const patch = pr.resolvePropertyIntent('quiero la LUX-B0123', {});
  assert.equal(patch.property_code, 'LUX-B0123');
  assert.equal(patch.property_specific_intent, true);
  assert.equal(patch.direct_property_reference, true);
});

test('resolvePropertyIntent: salir de modo propiedad', () => {
  const prev = {
    property_code: 'LUX-A0461',
    property_specific_intent: true,
    direct_property_reference: true,
  };
  const patch = pr.resolvePropertyIntent('Ya no esa, mejor busco casa en Cumbres', prev);
  assert.equal(patch.__clearPropertyIntent, true);
  assert.equal(patch.property_code, null);
  assert.equal(patch.property_specific_intent, false);
});

test('isPropertySpecificConversation', () => {
  assert.equal(pr.isPropertySpecificConversation({ property_code: 'LUX-A0001', property_specific_intent: true }), true);
  assert.equal(pr.isPropertySpecificConversation({ lead_flow: 'demand' }), false);
});

test('buildPropertyModeReply: precio solo si hay dato', () => {
  const ai = { property_code: 'LUX-A0461', property_specific_intent: true, direct_property_reference: true };
  const withPrice = pr.buildPropertyModeReply({
    text: '¿Cuál es el precio?',
    aiState: ai,
    propertyRow: { id: '1', listing_id: 'LUX-A0461', price: 5_500_000 },
    hasValidName: true,
  });
  assert.match(withPrice, /5[., ]?500/);

  const noPrice = pr.buildPropertyModeReply({
    text: '¿Cuál es el precio?',
    aiState: ai,
    propertyRow: { id: '1', listing_id: 'LUX-A0461' },
    hasValidName: true,
  });
  assert.match(noPrice, /no tengo un precio/i);
});

test('buildPropertyModeReply: disponibilidad sin inventar', () => {
  const ai = { property_code: 'LUX-A0461', property_specific_intent: true, direct_property_reference: true };
  const out = pr.buildPropertyModeReply({
    text: '¿Sigue disponible?',
    aiState: ai,
    propertyRow: { id: '1', listing_id: 'LUX-A0461', price: 1 },
    hasValidName: true,
  });
  assert.match(out, /disponibilidad|asesor|sistema/i);
  assert.doesNotMatch(out, /s[ií] est[aá] disponible/i);
});
