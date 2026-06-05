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

test('extractPropertyTitleHint: similar sin LUX', () => {
  const hint = inv.extractPropertyTitleHint(
    'Hola, me gustaría recibir información sobre Terreno en Privada Renacimiento y opciones relacionadas.'
  );
  assert.match(hint || '', /privada renacimiento/i);
});

test('extractPropertyTitleHint: vendida con comillas', () => {
  const hint = inv.extractPropertyTitleHint(
    'Hola, vi la propiedad "Casa en Cumbres" que ya fue vendida. ¿Tienen opciones similares?'
  );
  assert.equal(hint, 'Casa en Cumbres');
});

test('shouldAttemptLoosePropertyResolution: visita landing', () => {
  assert.equal(
    inv.shouldAttemptLoosePropertyResolution(
      'Hola, me gustaría agendar una visita a la propiedad LUX-A0473 — Casa test ($1).'
    ),
    true
  );
});

test('tokenOverlapScore: match alto', () => {
  const score = inv.tokenOverlapScore(
    'Terreno en Privada Renacimiento',
    'Terreno en Privada Renacimiento · 1,680 m²'
  );
  assert.ok(score >= 0.45);
});

test('resolveDisambiguationPick: ordinal y código', () => {
  const candidates = [
    { id: '1', code: 'LUX-A0001', title: 'A' },
    { id: '2', code: 'LUX-A0002', title: 'B' },
  ];
  assert.equal(inv.resolveDisambiguationPick('la opción 2', candidates)?.id, '2');
  assert.equal(inv.resolveDisambiguationPick('LUX-A0001', candidates)?.id, '1');
});

test('buildPropertyDisambiguationReply lista opciones', () => {
  const reply = inv.buildPropertyDisambiguationReply([
    { code: 'LUX-A0001', title: 'Casa A', location_label: 'Cumbres', price_label: '$1M' },
  ]);
  assert.match(reply, /LUX-A0001/);
  assert.match(reply, /Responde con el número/i);
});

test('resolveInboundPropertyReference: slug en URL', async () => {
  const row = {
    id: 'p-slug',
    listing_id: 'LUX-A0999',
    slug: 'casa-en-cumbres-en-venta',
    title: 'Casa en Cumbres',
    operation_type: 'sale',
    price: 5000000,
    neighborhood: 'Cumbres',
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
        ilike() {
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
  const out = await inv.resolveInboundPropertyReference(
    db,
    { text: 'Mira https://luxetty.com/propiedad/casa-en-cumbres-en-venta' },
    console
  );
  assert.equal(out.status, 'found');
  assert.equal(out.propertyId, 'p-slug');
});
