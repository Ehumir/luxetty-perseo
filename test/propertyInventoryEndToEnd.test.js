'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const psf = require('../conversation/propertySpecificFlow');
const inv = require('../services/propertyInventoryService');

const baseAi = {
  property_code: 'LUX-A0470',
  direct_property_code: 'LUX-A0470',
  direct_property_reference: true,
  property_specific_intent: true,
};

const mockProperty = {
  id: 'id-1',
  listing_id: 'LUX-A0470',
  slug: 'casa-en-mitras-poniente-en-venta',
  operation_type: 'sale',
  price: 3_250_000,
  neighborhood: 'Mitras Poniente',
  bedrooms: 3,
  bathrooms: 2,
};

test('intro con operación, precio, link luxetty y pide nombre si no hay full_name en estado', () => {
  const out = psf.buildPropertyIntroReply({
    property: mockProperty,
    aiState: baseAi,
    contact: null,
    waProfileName: null,
    hasRegisteredName: false,
  });
  assert.match(out, /LUX-A0470/);
  assert.match(out, /venta/i);
  assert.match(out, /luxetty\.com\/propiedad\/casa-en-mitras-poniente-en-venta/);
  assert.match(out, /precio registrado/i);
  assert.match(out, /nombre/i);
});

test('precio incluye operación venta', () => {
  const out = psf.buildPropertyPriceReply({
    property: mockProperty,
    aiState: baseAi,
    hasRegisteredName: true,
  });
  assert.match(out, /3[., ]?250/);
  assert.match(out, /venta/i);
});

test('name_complaint pide nombre sin CTA genérico', () => {
  const out = psf.buildPropertySpecificReply({
    intent: { type: 'name_complaint' },
    property: mockProperty,
    aiState: baseAi,
    hasValidName: false,
  });
  assert.match(out, /disculpa/i);
  assert.match(out, /nombre/i);
  assert.doesNotMatch(out, new RegExp(psf.GENERIC_CTA_PHRASE, 'i'));
});

test('ask_link devuelve URL luxetty', () => {
  const out = psf.buildPropertySpecificReply({
    intent: { type: 'ask_link' },
    property: mockProperty,
    aiState: baseAi,
    hasValidName: true,
  });
  assert.match(out, /luxetty\.com\/propiedad\//);
});

test('getPropertyPublicFacts sin inventar link sin slug', () => {
  const f = inv.getPropertyPublicFacts({ ...mockProperty, slug: '' });
  assert.equal(f.public_url, null);
});
