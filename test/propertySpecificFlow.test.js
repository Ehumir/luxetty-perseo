'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const psf = require('../conversation/propertySpecificFlow');

const baseAi = {
  property_code: 'LUX-A0470',
  direct_property_code: 'LUX-A0470',
  direct_property_reference: true,
  property_specific_intent: true,
};

const sampleProperty = {
  id: 'prop-1',
  listing_id: 'LUX-A0470',
  neighborhood: 'Mitras Poniente',
  operation_type: 'sale',
  property_type: 'house',
  title: 'Casa en Mitras',
  price: 3_200_000,
  bedrooms: 3,
  bathrooms: 2,
  terrain_m2: 180,
  construction_m2: 220,
  slug: 'casa-en-mitras-poniente-en-venta',
};

test('classifyPropertyFollowUp: detalles y precio', () => {
  assert.equal(psf.classifyPropertyFollowUp('Sí, dame detalles', baseAi, []).type, 'ask_details');
  assert.equal(psf.classifyPropertyFollowUp('Dame más información de la casa', baseAi, []).type, 'ask_details');
  assert.equal(psf.classifyPropertyFollowUp('¿Qué precio tiene la casa?', baseAi, []).type, 'ask_price');
  assert.equal(psf.classifyPropertyFollowUp('¿Cuánto cuesta?', baseAi, []).type, 'ask_price');
});

test('classifyPropertyFollowUp: ubicación, disponibilidad, visita, fotos, frustración', () => {
  assert.equal(psf.classifyPropertyFollowUp('¿Dónde está?', baseAi, []).type, 'ask_location');
  assert.equal(psf.classifyPropertyFollowUp('ubicación', baseAi, []).type, 'ask_location');
  assert.equal(psf.classifyPropertyFollowUp('¿Sigue disponible?', baseAi, []).type, 'ask_availability');
  assert.equal(psf.classifyPropertyFollowUp('¿Está disponible?', baseAi, []).type, 'ask_availability');
  assert.equal(psf.classifyPropertyFollowUp('Quiero verla', baseAi, []).type, 'ask_visit');
  assert.equal(psf.classifyPropertyFollowUp('puedo verla mañana', baseAi, []).type, 'ask_visit');
  assert.equal(psf.classifyPropertyFollowUp('mándame fotos', baseAi, []).type, 'ask_photos');
  assert.equal(psf.classifyPropertyFollowUp('no me estás entendiendo', baseAi, []).type, 'frustration_recovery');
});

test('buildPropertyIntroReply: código, zona, link y sin inventar URL', () => {
  const withSlug = psf.buildPropertyIntroReply({
    property: sampleProperty,
    aiState: baseAi,
    contact: null,
    waProfileName: null,
  });
  assert.match(withSlug, /LUX-A0470/);
  assert.match(withSlug, /Mitras Poniente/i);
  assert.match(withSlug, /asistente de Luxetty/i);
  assert.doesNotMatch(withSlug, /te gustaría que te comparta detalles/i);

  const noSlug = psf.buildPropertyIntroReply({
    property: { ...sampleProperty, slug: '' },
    aiState: baseAi,
    contact: null,
    waProfileName: null,
  });
  assert.doesNotMatch(noSlug, /https:\/\/luxetty\.com\/propiedad\/[a-z0-9-]+/i);
  assert.match(noSlug, /no tengo un enlace público verificado/i);
});

test('buildPropertyDetailsReply: solo datos presentes', () => {
  const out = psf.buildPropertyDetailsReply({
    property: sampleProperty,
    aiState: { ...baseAi, full_name: 'Jorge López' },
    contact: null,
    waProfileName: null,
  });
  assert.match(out, /Jorge/);
  assert.match(out, /LUX-A0470/);
  assert.match(out, /Recámaras: 3/);
  assert.match(out, /https:\/\/luxetty\.com\/propiedad\//);
});

test('buildPropertyPriceReply: precio con disclaimer', () => {
  const out = psf.buildPropertyPriceReply({
    property: sampleProperty,
    aiState: baseAi,
    contact: null,
    waProfileName: null,
  });
  assert.match(out, /El precio registrado de LUX-A0470/i);
  assert.match(out, /asesor/i);
});

test('buildPropertyAvailabilityReply: no afirma disponibilidad absoluta', () => {
  const out = psf.buildPropertyAvailabilityReply({
    property: sampleProperty,
    aiState: baseAi,
    contact: null,
    waProfileName: null,
  });
  assert.doesNotMatch(out, /sí,? está disponible/i);
  assert.match(out, /asesor|validarlo/i);
});

test('buildPropertyVisitReply incluye pregunta de día y nombre si falta', () => {
  const noName = psf.buildPropertyVisitReply({
    property: sampleProperty,
    aiState: baseAi,
    contact: null,
    waProfileName: null,
  });
  assert.match(noName, /visita a LUX-A0470/i);
  assert.match(noName, /horario/i);
  assert.match(noName, /nombre/i);

  const named = psf.buildPropertyVisitReply({
    property: sampleProperty,
    aiState: { ...baseAi, full_name: 'Jorge' },
    contact: null,
    waProfileName: null,
  });
  assert.doesNotMatch(named, /compartes tu nombre/i);
});

test('frustration_recovery con pending price responde precio sin repetir CTA genérico', () => {
  const out = psf.buildPropertySpecificReply({
    intent: { type: 'frustration_recovery' },
    property: sampleProperty,
    aiState: { ...baseAi, property_pending_user_question: 'price' },
    contact: null,
    waProfileName: null,
    text: '¿No estás entendiendo nada?',
    recentMessages: [],
  });
  assert.match(out, /precio registrado|LUX-A0470/i);
  assert.doesNotMatch(out, new RegExp(psf.GENERIC_CTA_PHRASE, 'i'));
});
