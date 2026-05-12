'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyEntryClassificationToSignals } = require('../conversation/leadEntryPointRouter');
const { parseMessageSignals } = require('../conversation/parsers');
const { getDefaultAiState } = require('../conversation/aiState');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const propertyIntentResolver = require('../conversation/propertyIntentResolver');

test('pauta propiedad fuerza flags y lead_flow no queda en offer', () => {
  const prev = getDefaultAiState();
  const text = 'Hola, me interesa la propiedad A0462';
  let sig = parseMessageSignals(text, prev, {});
  Object.assign(sig, propertyIntentResolver.resolvePropertyIntent(text, prev));
  sig = applyEntryClassificationToSignals(sig, text, prev);
  const ct = detectStateChange(prev, sig);
  const next = buildNextState(prev, sig, ct);
  assert.equal(next.property_code, 'LUX-A0462');
  assert.equal(next.property_specific_intent, true);
  assert.equal(next.lead_flow, 'demand');
});
