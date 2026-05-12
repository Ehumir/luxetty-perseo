'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const { mergeSignalsWithMulti, extractMultiSignals } = require('../conversation/multiSignalExtractor');
const propertyIntentResolver = require('../conversation/propertyIntentResolver');
const inv = require('../services/propertyInventoryService');

function advance(prev, text) {
  const parsed = mergeSignalsWithMulti(
    parseMessageSignals(text, prev, { media: { type: 'text' } }),
    extractMultiSignals(text, prev)
  );
  Object.assign(parsed, propertyIntentResolver.resolvePropertyIntent(text, prev));
  const changeType = detectStateChange(prev, parsed);
  return buildNextState(prev, parsed, changeType);
}

test('cambiar de A0470 a A0461 actualiza property_code', () => {
  let s = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    property_code: 'LUX-A0470',
    direct_property_reference: true,
    property_specific_intent: true,
  });
  s = advance(s, 'Ahora dime de la propiedad A0461');
  assert.equal(s.property_code, 'LUX-A0461');
});

test('property_history acumula entradas con pushPropertyHistory', () => {
  let s = normalizeAiState({
    ...getDefaultAiState(),
    property_history: [],
    property_context_by_code: {},
  });
  Object.assign(s, inv.pushPropertyHistory(s, { code: 'LUX-A0470', interested_property_id: 'p1' }));
  Object.assign(s, inv.pushPropertyHistory(s, { code: 'LUX-A0461', interested_property_id: 'p2' }));
  assert.equal(s.property_history[0].code, 'LUX-A0461');
  assert.ok(s.property_history.length <= 5);
});

test('resolvePropertyIntent: la primera usa historial', () => {
  const prev = normalizeAiState({
    ...getDefaultAiState(),
    property_code: 'LUX-A0453',
    direct_property_reference: true,
    property_specific_intent: true,
    property_history: [
      { code: 'LUX-A0453', interested_property_id: '3', at: 't2' },
      { code: 'LUX-A0470', interested_property_id: '1', at: 't0' },
    ],
  });
  const patch = propertyIntentResolver.resolvePropertyIntent('¿Cuál era el precio de la primera?', prev);
  assert.equal(patch.property_code, 'LUX-A0470');
});
