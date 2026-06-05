'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../conversation/leadEntryPointRouter');

test('classifyEntryPoint: property ad A0470', () => {
  const m = router.classifyEntryPoint('Hola, me interesa la propiedad A0470', {});
  assert.equal(m.entry_type, 'property_ad');
  assert.equal(m.property_code, 'LUX-A0470');
});

test('classifyEntryPoint: seller capture Cumbres', () => {
  const t =
    'Hola, quiero saber cómo podrían ayudarme a vender mi casa en Cumbres';
  const m = router.classifyEntryPoint(t, {});
  assert.equal(m.entry_type, 'seller_capture_ad');
  assert.equal(m.lead_flow, 'offer');
  assert.match(m.location_text || '', /Cumbres/i);
});

test('classifyEntryPoint: San Pedro y Sur', () => {
  const a = router.classifyEntryPoint(
    'Hola, quiero saber cómo podrían ayudarme a vender mi casa en San Pedro',
    {}
  );
  assert.equal(a.entry_type, 'seller_capture_ad');
  assert.match(a.location_text || '', /San Pedro/i);

  const b = router.classifyEntryPoint(
    'Hola, quiero saber cómo podrían ayudarme a vender mi casa en el SUR',
    {}
  );
  assert.equal(b.entry_type, 'seller_capture_ad');
  assert.equal(b.location_text, 'Sur');
});

test('offer follow-up: En Cumbres', () => {
  const m = router.classifyEntryPoint('En Cumbres', { lead_flow: 'offer' });
  assert.equal(m.entry_type, 'seller_capture_ad');
  assert.equal(m.location_text, 'Cumbres');
});

test('buildAssistantIdentityReply', () => {
  const r = router.buildAssistantIdentityReply();
  assert.match(r, /asistente de Luxetty/i);
  assert.match(r, /nombre/i);
});

test('classifyEntryPoint: visit landing', () => {
  const m = router.classifyEntryPoint(
    'Hola, me gustaría agendar una visita a la propiedad LUX-A0473 — Casa test ($1).',
    {}
  );
  assert.equal(m.entry_type, 'property_ad');
});

test('classifyEntryPoint: advisor landing', () => {
  const m = router.classifyEntryPoint(
    'Hola Jorge, vi la propiedad LUX-A0473 — Casa test ($1) y me gustaría platicar contigo.',
    {}
  );
  assert.equal(m.entry_type, 'property_ad');
});

test('classifyEntryPoint: share landing', () => {
  const m = router.classifyEntryPoint(
    'Te comparto esta propiedad de Luxetty (LUX-A0473):\n\nCasa test\n$1',
    {}
  );
  assert.equal(m.entry_type, 'property_ad');
});

test('classifyEntryPoint: comparativa landing', () => {
  const m = router.classifyEntryPoint(
    'Hola, me gustaría recibir información comparativa sobre LUX-A0473 — Casa test y opciones similares.',
    {}
  );
  assert.equal(m.entry_type, 'property_ad');
});

test('classifyEntryPoint: vendida similar landing', () => {
  const m = router.classifyEntryPoint(
    'Hola, vi la propiedad LUX-A0473 "Casa test" que ya fue vendida. ¿Tienen opciones similares?',
    {}
  );
  assert.equal(m.entry_type, 'property_ad');
});

test('applyEntryClassificationToSignals: landing sin código', () => {
  const signals = router.applyEntryClassificationToSignals(
    {},
    'Hola, me gustaría recibir información sobre Casa test y opciones relacionadas.',
    {}
  );
  assert.equal(signals.property_landing_reference, true);
});
