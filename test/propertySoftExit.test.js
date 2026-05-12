'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const { mergeSignalsWithMulti, extractMultiSignals } = require('../conversation/multiSignalExtractor');
const propertyIntentResolver = require('../conversation/propertyIntentResolver');
const contextualReferenceResolver = require('../conversation/contextualReferenceResolver');
const conversationalStateMachine = require('../conversation/conversationalStateMachine');

function advance(prev, text) {
  const parsed = mergeSignalsWithMulti(
    parseMessageSignals(text, prev, { media: { type: 'text' } }),
    extractMultiSignals(text, prev)
  );
  Object.assign(parsed, propertyIntentResolver.resolvePropertyIntent(text, prev));
  const ctxResolved = contextualReferenceResolver.resolveContextualPropertyCode({ text, aiState: prev, recentMessages: [] });
  if (ctxResolved.propertyCode && !parsed.property_code) {
    Object.assign(parsed, contextualReferenceResolver.buildPropertySignalsFromResolution(ctxResolved));
  }
  Object.assign(parsed, conversationalStateMachine.computeSignalPatch({ text, prevAiState: prev, parsedSignals: parsed }));
  Object.assign(parsed, conversationalStateMachine.applySellerLocationStickyPatch({ text, prevAiState: prev, parsedSignals: parsed }));
  return buildNextState(prev, parsed, detectStateChange(prev, parsed));
}

test('tras pivot inventario: buyer_search y sin property_specific', () => {
  let s = normalizeAiState({
    ...getDefaultAiState(),
    property_code: 'LUX-A0470',
    property_specific_intent: true,
    direct_property_reference: true,
    lead_flow: 'demand',
    property_history: [{ code: 'LUX-A0470', at: 't' }],
  });
  s = advance(s, '¿Tienen algo en Cumbres?');
  assert.equal(s.active_playbook, 'buyer_search');
  assert.equal(s.property_specific_intent, false);
  assert.ok(s.property_code === 'LUX-A0470' || s.current_property_code === 'LUX-A0470');
});
