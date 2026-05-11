const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPropertyInterestReply,
  buildPropertyPriceReply,
  buildDemandReply,
  buildOfferReply,
} = require('../conversation/responseBuilder');

test('buildPropertyInterestReply returns sequenced commercial messages for A0453', () => {
  const reply = buildPropertyInterestReply(
    {
      listing_id: 'A0453',
      neighborhood: 'Montemorelos',
      slug: 'casa-en-montemorelos-a0453',
    },
    {}
  );

  assert.ok(Array.isArray(reply));
  assert.equal(reply.length, 3);
  assert.match(reply[0], /(Claro|Perfecto|Listo).+liga de la propiedad A0453 en Montemorelos\./);
  assert.equal(reply[1], 'https://luxetty.com/propiedad/casa-en-montemorelos-a0453');
  assert.match(reply[2], /me compartes tu nombre/i);
});

test('buildPropertyInterestReply supports LUX-A0453 code and keeps link separated', () => {
  const reply = buildPropertyInterestReply(
    {
      listing_id: 'LUX-A0453',
      city: 'Montemorelos',
      slug: 'casa-en-montemorelos-lux-a0453',
    },
    {}
  );

  assert.ok(Array.isArray(reply));
  assert.equal(reply[1], 'https://luxetty.com/propiedad/casa-en-montemorelos-lux-a0453');
  assert.match(reply[0], /LUX-A0453/);
});

test('buildPropertyInterestReply varía apertura para pauta en respuestas sucesivas', () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.01;
    const first = buildPropertyInterestReply(
      { listing_id: 'LUX-A0470', neighborhood: 'Mitras Poniente', slug: 'casa-en-mitras-poniente-en-venta' },
      {}
    );
    Math.random = () => 0.95;
    const second = buildPropertyInterestReply(
      { listing_id: 'LUX-A0470', neighborhood: 'Mitras Poniente', slug: 'casa-en-mitras-poniente-en-venta' },
      {}
    );
    assert.notEqual(first[0], second[0]);
  } finally {
    Math.random = originalRandom;
  }
});

test('buildPropertyInterestReply with known name does not ask name again and asks contact authorization', () => {
  const reply = buildPropertyInterestReply(
    {
      listing_id: 'LUX-A0462',
      municipality: 'Monterrey',
      slug: 'casa-en-monterrey-a0462',
    },
    { full_name: 'Mariana Ruiz' }
  );

  assert.ok(Array.isArray(reply));
  assert.doesNotMatch(reply[2], /me compartes tu nombre/i);
  assert.match(reply[2], /Si me autorizas/i);
  assert.match(reply[2], /te contacte/i);
});

test('buildPropertyInterestReply evita repetir pregunta de nombre si ya se pidió', () => {
  const reply = buildPropertyInterestReply(
    {
      listing_id: 'LUX-A0462',
      municipality: 'Monterrey',
      slug: 'casa-en-monterrey-a0462',
    },
    { full_name: null, awaiting_field: 'full_name' }
  );

  assert.ok(Array.isArray(reply));
  assert.doesNotMatch(reply[2], /¿me compartes tu nombre\?/i);
  assert.match(reply[2], /compárteme solo tu nombre/i);
});

test('buildDemandReply with context of direct property keeps commercial sequence and asks name when unknown', () => {
  const state = {
    lead_flow: 'demand',
    direct_property_reference: true,
    property_code: 'LUX-A0453',
    asks_property_details: true,
    full_name: null,
  };

  const properties = [
    {
      listing_id: 'LUX-A0453',
      neighborhood: 'Montemorelos',
      slug: 'casa-en-montemorelos-lux-a0453',
    },
  ];

  const reply = buildDemandReply(state, 'minor_update', properties, 'direct_property_code');
  assert.ok(Array.isArray(reply));
  assert.equal(reply[1], 'https://luxetty.com/propiedad/casa-en-montemorelos-lux-a0453');
  assert.match(reply[2], /me compartes tu nombre/i);
});

test('buildDemandReply for missing property does not invent details and offers search or advisor escalation', () => {
  const state = {
    lead_flow: 'demand',
    direct_property_reference: true,
    property_code: 'LUX-A0453',
  };

  const reply = buildDemandReply(state, 'minor_update', [], 'direct_property_code');
  assert.equal(typeof reply, 'string');
  assert.match(reply, /No encontré una propiedad activa con el ID LUX-A0453/);
  assert.match(reply, /ampliar la búsqueda por zona/i);
  assert.match(reply, /asesor de Luxetty/i);
});

test('buildPropertyPriceReply answers price directly after initial interest', () => {
  const reply = buildPropertyPriceReply({
    listing_id: 'LUX-A0470',
    price: 2500000,
  });

  assert.equal(
    reply,
    `La propiedad LUX-A0470 está en $2,500,000 MXN.

¿Quieres verla esta semana?`
  );
});

test('lead vendedor pregunta cuanto cobras recibe objecion consultiva + pregunta base', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
    },
    'append_info',
    {
      signals: {
        asks_commission: true,
      },
    }
  );

  assert.match(reply, /comisión se maneja como un porcentaje sobre el precio final de venta/i);
  assert.match(reply, /¿La propiedad ya está publicada o apenas estás evaluando vender\?/i);
});

test('propietaria con credito hipotecario reconoce saldo y continua calificacion', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Mitras Poniente',
      property_type: 'house',
      terrain_m2: 120,
      construction_m2: 220,
      bedrooms: 2,
      bathrooms: 2,
      occupancy_status: 'occupied',
      floors_count: 2,
      garage_spaces: 1,
      has_terrace_patio: true,
      legal_deeded: true,
      has_mortgage: true,
      mortgage_balance_text: null,
    },
    'append_info'
  );

  assert.match(reply, /revisar el saldo del crédito/i);
});

test('si ya dijo zona y tipo no debe repetir esas preguntas', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Guadalupe',
      property_type: 'house',
    },
    'append_info'
  );

  assert.doesNotMatch(reply, /¿En qué zona o colonia/i);
  assert.doesNotMatch(reply, /¿Es casa, departamento, terreno o local\?/i);
  assert.match(reply, /m² de terreno y construcción/i);
});

test('precio esperado no se valida como correcto, se orienta con comparables', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Monterrey',
      property_type: 'house',
      terrain_m2: 200,
      construction_m2: 300,
      bedrooms: 3,
      bathrooms: 3,
      occupancy_status: 'occupied',
      floors_count: 2,
      garage_spaces: 2,
      has_terrace_patio: true,
      legal_deeded: true,
      has_mortgage: false,
      works_with_realtor: false,
      exclusivity_type: 'open',
      expected_price: 5300000,
      sale_motivation: 'cambiarme de zona',
      urgency_level: 'medium',
    },
    'append_info'
  );

  assert.match(reply, /cierres reales/i);
  assert.match(reply, /absorción/i);
  assert.match(reply, /visita rápida de 20 minutos/i);
});

test('si acepta visita avanza a confirmacion de contacto y canalizacion', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Monterrey',
      property_type: 'house',
      terrain_m2: 200,
      construction_m2: 300,
      bedrooms: 3,
      bathrooms: 3,
      occupancy_status: 'occupied',
      floors_count: 2,
      garage_spaces: 2,
      has_terrace_patio: true,
      legal_deeded: true,
      has_mortgage: false,
      works_with_realtor: false,
      exclusivity_type: 'open',
      expected_price: 5300000,
      sale_motivation: 'liquidez',
      urgency_level: 'high',
      accepted_visit: true,
      full_name: 'Laura Diaz',
      contact_preference: null,
    },
    'append_info'
  );

  assert.match(reply, /prefieres que te contacten por WhatsApp o por llamada/i);
});
