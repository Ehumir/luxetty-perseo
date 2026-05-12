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
  const ctxResolved = contextualReferenceResolver.resolveContextualPropertyCode({
    text,
    aiState: prev,
    recentMessages: [],
  });
  if (ctxResolved.propertyCode && !parsed.property_code) {
    Object.assign(parsed, contextualReferenceResolver.buildPropertySignalsFromResolution(ctxResolved));
  }
  Object.assign(parsed, conversationalStateMachine.computeSignalPatch({ text, prevAiState: prev, parsedSignals: parsed }));
  Object.assign(parsed, conversationalStateMachine.applySellerLocationStickyPatch({ text, prevAiState: prev, parsedSignals: parsed }));
  return buildNextState(prev, parsed, detectStateChange(prev, parsed));
}

test('property_specific → buyer_search sin borrar historial', () => {
  let s = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    property_code: 'LUX-A0462',
    property_specific_intent: true,
    direct_property_reference: true,
    property_history: [{ code: 'LUX-A0462', interested_property_id: 'id1', at: 't' }],
    current_property_code: 'LUX-A0462',
  });
  s = advance(s, '¿Tienes algo en Cumbres?');
  assert.equal(s.property_specific_intent, false);
  assert.equal(s.active_playbook, 'buyer_search');
  assert.ok(Array.isArray(s.property_history) && s.property_history.length >= 1);
});

test('buyer_search → property_specific con código', () => {
  let s = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    active_playbook: 'buyer_search',
    location_text: 'Cumbres',
  });
  s = advance(s, 'Me interesa A0462');
  assert.equal(s.property_code, 'LUX-A0462');
  assert.equal(s.property_specific_intent, true);
  assert.equal(s.active_playbook, 'property_specific');
});

test('buyer_search → seller_capture', () => {
  let s = normalizeAiState({
    ...getDefaultAiState(),
    lead_flow: 'demand',
    active_playbook: 'buyer_search',
  });
  s = advance(s, 'También quiero vender mi casa');
  assert.equal(s.lead_flow, 'offer');
  assert.equal(s.active_playbook, 'seller_capture');
});
