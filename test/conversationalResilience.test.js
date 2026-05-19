'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractMultiQuestions,
  parseLongStorySlots,
  resolveAmbiguousReference,
} = require('../conversation/v3/resilience/conversationalResilience');

describe('conversationalResilience', () => {
  it('extracts multiple questions', () => {
    const q = extractMultiQuestions('¿Tienen en Cumbres? ¿Cuánto piden? ¿Visita?');
    assert.ok(q.length >= 2);
  });

  it('parses long story slots', () => {
    const { patch } = parseLongStorySlots('Busco comprar\nAna\nCumbres\n3 millones');
    assert.equal(patch.collectedFields?.fullName, 'Ana');
    assert.equal(patch.locationText, 'Cumbres');
    assert.equal(patch.budget, 3000000);
  });

  it('resolves esa casa with active listing', () => {
    const r = resolveAmbiguousReference(
      { propertyListingCode: 'LUX-A0453' },
      '¿Cuánto cuesta esa casa?',
    );
    assert.equal(r.resolved, true);
    assert.equal(r.patch.propertyListingCode, 'LUX-A0453');
  });
});
