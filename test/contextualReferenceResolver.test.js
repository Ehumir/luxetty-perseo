'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ctx = require('../conversation/contextualReferenceResolver');

test('resolveContextualPropertyCode: esa + está en → historial', () => {
  const r = ctx.resolveContextualPropertyCode({
    text: '¿Esa está en Cumbres?',
    aiState: {
      property_history: [{ code: 'LUX-A0462', interested_property_id: 'p1', at: 't' }],
      current_property_code: 'LUX-A0462',
    },
    recentMessages: [],
  });
  assert.equal(r.propertyCode, 'LUX-A0462');
  assert.equal(r.referenceType, 'deictic_property');
});

test('buildPropertySignalsFromResolution activa modo propiedad', () => {
  const sig = ctx.buildPropertySignalsFromResolution({
    propertyCode: 'LUX-A0462',
    referenceType: 'deictic_property',
  });
  assert.equal(sig.property_code, 'LUX-A0462');
  assert.equal(sig.property_specific_intent, true);
});

test('no resuelve si ya hay código explícito en texto', () => {
  const r = ctx.resolveContextualPropertyCode({
    text: 'Me interesa LUX-A0461',
    aiState: { property_history: [{ code: 'LUX-A0462' }] },
    recentMessages: [],
  });
  assert.equal(r.propertyCode, null);
});
