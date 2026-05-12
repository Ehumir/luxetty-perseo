'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../conversation/leadEntryPointRouter');

test('primer copy propiedad incluye presentación y nombre', () => {
  const entry = router.classifyEntryPoint('Hola, me interesa la propiedad A0470', {});
  const property = {
    id: 'p1',
    listing_id: 'LUX-A0470',
    neighborhood: 'Mitras Poniente',
    operation_type: 'sale',
    price: 2_500_000,
    slug: 'casa-en-mitras-poniente-en-venta',
  };
  const r = router.buildInitialEntryReply({
    entry,
    property,
    aiState: { property_code: 'LUX-A0470', location_text: 'Mitras Poniente' },
  });
  assert.match(r, /asistente de Luxetty/i);
  assert.match(r, /LUX-A0470/i);
  assert.match(r, /Mitras Poniente/i);
  assert.match(r, /compartes tu nombre/i);
  assert.match(r, /luxetty\.com\/propiedad\//i);
  assert.doesNotMatch(r, /te gustaría que te comparta detalles/i);
});
