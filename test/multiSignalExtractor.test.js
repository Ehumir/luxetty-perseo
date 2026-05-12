'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractMultiSignals, mergeSignalsWithMulti, isLikelyPersonGivenName } = require('../conversation/multiSignalExtractor');
const { getDefaultAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');

test('Jorge, 8 millones → nombre + presupuesto', () => {
  const out = extractMultiSignals('Jorge, 8 millones', {});
  assert.equal(out.full_name, 'Jorge');
  assert.equal(out.budget_max, 8_000_000);
});

test('Soy Jorge y busco casa en Cumbres → merge con parser incluye zona', () => {
  const prev = getDefaultAiState();
  const parsed = mergeSignalsWithMulti(
    parseMessageSignals('Soy Jorge y busco casa en Cumbres', prev, { media: { type: 'text' } }),
    extractMultiSignals('Soy Jorge y busco casa en Cumbres', prev)
  );
  assert.equal(parsed.full_name, 'Jorge');
  assert.equal(parsed.location_text, 'Cumbres');
  assert.equal(parsed.lead_flow, 'demand');
});

test('Quiero casa de 8 millones con 3 recámaras → presupuesto + recámaras', () => {
  const out = extractMultiSignals('Quiero casa de 8 millones con 3 recámaras', {});
  assert.equal(out.budget_max, 8_000_000);
  assert.equal(out.bedrooms, 3);
});

test('Habla Jorge', () => {
  const out = extractMultiSignals('Habla Jorge', {});
  assert.equal(out.full_name, 'Jorge');
});

test('Jorge y quiero vender mi casa → offer', () => {
  const out = extractMultiSignals('Jorge y quiero vender mi casa', {});
  assert.equal(out.full_name, 'Jorge');
  assert.equal(out.lead_flow, 'offer');
});

test('no confunde Cumbres con nombre', () => {
  assert.equal(isLikelyPersonGivenName('Cumbres'), false);
  assert.equal(isLikelyPersonGivenName('8 millones'), false);
});

test('mergeSignalsWithMulti rellena full_name si el parser no lo trae', () => {
  const base = { lead_flow: 'demand', budget_max: 8_000_000, full_name: null };
  const multi = extractMultiSignals('Jorge, 8 millones', {});
  const merged = mergeSignalsWithMulti(base, multi);
  assert.equal(merged.full_name, 'Jorge');
  assert.equal(merged.budget_max, 8_000_000);
});
