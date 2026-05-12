'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const inv = require('../services/propertyInventoryService');

test('normalizeInventoryCode: A0470 → LUX-A0470', () => {
  assert.equal(inv.normalizeInventoryCode('a0470'), 'LUX-A0470');
  assert.equal(inv.normalizeInventoryCode('LUX-A0470'), 'LUX-A0470');
});

test('buildPublicPropertyUrl solo luxetty.com desde slug', () => {
  assert.equal(
    inv.buildPublicPropertyUrl({ slug: 'casa-en-mitras-poniente-en-venta' }),
    'https://luxetty.com/propiedad/casa-en-mitras-poniente-en-venta'
  );
});

test('buildPublicPropertyUrl rechaza URL de Supabase Storage como slug', () => {
  assert.equal(
    inv.buildPublicPropertyUrl({
      slug: 'https://xyz.supabase.co/storage/v1/object/public/x/y.jpg',
    }),
    null
  );
});

test('findPropertyByCode con mock Supabase', async () => {
  const row = {
    id: 'p-1',
    listing_id: 'LUX-A0470',
    slug: 'casa-test',
    operation_type: 'sale',
    price: 1_000_000,
    neighborhood: 'Mitras',
    title: 'Casa',
  };
  const db = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
    },
  };
  const out = await inv.findPropertyByCode(db, 'A0470', console);
  assert.equal(out.propertyId, 'p-1');
  assert.equal(out.normalized?.code, 'LUX-A0470');
  assert.equal(out.normalized?.public_url, 'https://luxetty.com/propiedad/casa-test');
});

test('propertyOperationLabel venta y renta', () => {
  assert.match(inv.propertyOperationLabel({ operation_type: 'sale' }), /venta/);
  assert.match(inv.propertyOperationLabel({ operation_type: 'rent' }), /renta/);
});

test('pushPropertyHistory mantiene máximo 5', () => {
  const prev = {
    property_history: [{ code: 'LUX-A0001', interested_property_id: '1', at: 't' }],
    property_context_by_code: {},
  };
  const patch = inv.pushPropertyHistory(prev, { code: 'LUX-A0470', interested_property_id: 'x' });
  assert.equal(patch.property_history.length, 2);
  assert.equal(patch.property_history[0].code, 'LUX-A0470');
});
