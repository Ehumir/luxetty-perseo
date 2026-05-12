'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const guard = require('../conversation/nameFirstGuardrail');

test('evaluateInboundTurn: identidad', () => {
  const r = guard.evaluateInboundTurn({
    text: '¿Cómo te llamas?',
    previousAiState: {},
    nextAiState: { full_name: null, awaiting_field: null },
    contact: null,
    waProfileName: null,
    recentMessages: [],
    propertyRow: null,
    entryMeta: { entry_type: 'unknown' },
  });
  assert.equal(r.handled, true);
  assert.match(String(r.reply || ''), /asistente de Luxetty/i);
});

test('evaluateInboundTurn: captura de nombre tras awaiting_field', () => {
  const r = guard.evaluateInboundTurn({
    text: 'Jorge',
    previousAiState: { awaiting_field: 'full_name', full_name: null, entry_point_last: { entry_type: 'property_ad' } },
    nextAiState: {
      awaiting_field: 'full_name',
      full_name: 'Jorge',
      property_code: 'LUX-A0470',
      direct_property_code: 'LUX-A0470',
      property_specific_intent: true,
      direct_property_reference: true,
    },
    contact: null,
    waProfileName: null,
    recentMessages: [{ direction: 'inbound', message_text: 'hola' }],
    propertyRow: { id: 'p1' },
    entryMeta: { entry_type: 'unknown' },
  });
  assert.equal(r.handled, true);
  assert.match(String(r.reply || ''), /Gracias/i);
  assert.match(String(r.reply || ''), /Jorge/i);
});
