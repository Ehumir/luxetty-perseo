'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyEntryClassificationToSignals } = require('../conversation/leadEntryPointRouter');
const { parseMessageSignals, extractPossibleName } = require('../conversation/parsers');
const { getDefaultAiState } = require('../conversation/aiState');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const propertyIntentResolver = require('../conversation/propertyIntentResolver');
const nameFirstGuardrail = require('../conversation/nameFirstGuardrail');

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

test('turno 2 solo nombre: full_name en estado y guardrail corta sin repetir pregunta de nombre', () => {
  const text1 = 'Hola, me interesa la propiedad A0470';
  const prev0 = getDefaultAiState();
  let sig1 = parseMessageSignals(text1, prev0, {});
  Object.assign(sig1, propertyIntentResolver.resolvePropertyIntent(text1, prev0));
  sig1 = applyEntryClassificationToSignals(sig1, text1, prev0);
  const ct1 = detectStateChange(prev0, sig1);
  let stateAfterAd = buildNextState(prev0, sig1, ct1);
  const introPatch = {
    awaiting_field: 'full_name',
    pending_name_capture: true,
    entry_point_last: {
      entry_type: 'property_ad',
      lead_flow: 'demand',
      property_code: 'LUX-A0470',
      location_text: null,
    },
    property_intro_shown_for_code: 'LUX-A0470',
  };
  Object.assign(stateAfterAd, introPatch);

  const text2 = 'Jorge';
  const extracted = extractPossibleName(text2, stateAfterAd, stateAfterAd.owner_relation);
  assert.equal(extracted, 'Jorge');
  let sig2 = parseMessageSignals(text2, stateAfterAd, {});
  Object.assign(sig2, propertyIntentResolver.resolvePropertyIntent(text2, stateAfterAd));
  sig2 = applyEntryClassificationToSignals(sig2, text2, stateAfterAd);
  if (extracted) sig2.full_name = extracted;
  const ct2 = detectStateChange(stateAfterAd, sig2);
  const nextAfterName = buildNextState(stateAfterAd, sig2, ct2);

  const r = nameFirstGuardrail.evaluateInboundTurn({
    text: text2,
    previousAiState: stateAfterAd,
    nextAiState: nextAfterName,
    contact: null,
    waProfileName: 'Jorge',
    recentMessages: [{ direction: 'inbound', message_text: text1 }],
    propertyRow: null,
    entryMeta: sig2.__entry_point_meta,
  });
  assert.equal(r.handled, true);
  assert.doesNotMatch(String(r.reply || ''), /compartes tu nombre/i);
  assert.match(String(r.reply || ''), /Gracias,\s*Jorge/i);
  assert.equal(nextAfterName.full_name, 'Jorge');
  const patch = r.statePatch || {};
  assert.equal(patch.pending_name_capture, false);
  assert.equal(patch.awaiting_field, null);
});
