const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPropertyInterestReply,
  buildPropertyPriceReply,
  buildDemandReply,
  buildOfferReply,
} = require('../conversation/responseBuilder');

test('buildPropertyInterestReply: un solo mensaje natural con código, zona y liga', () => {
  const reply = buildPropertyInterestReply(
    {
      id: 'p1',
      listing_id: 'LUX-A0453',
      neighborhood: 'Montemorelos',
      slug: 'casa-en-montemorelos-a0453',
    },
    { property_code: 'LUX-A0453', direct_property_reference: true, property_specific_intent: true }
  );

  assert.equal(typeof reply, 'string');
  assert.match(reply, /asistente de Luxetty|luxetty\.com\/propiedad/i);
  assert.match(reply, /nombre|asesor|disponibilidad/i);
  assert.doesNotMatch(reply, /te gustaría que te comparta detalles/i);
});

test('buildPropertyInterestReply soporta listing_id LUX-A0453 y mantiene URL en el mismo texto', () => {
  const reply = buildPropertyInterestReply(
    {
      id: 'p1',
      listing_id: 'LUX-A0453',
      city: 'Montemorelos',
      slug: 'casa-en-montemorelos-lux-a0453',
    },
    { property_code: 'LUX-A0453', direct_property_reference: true, property_specific_intent: true }
  );

  assert.equal(typeof reply, 'string');
  assert.match(reply, /LUX-A0453/);
  assert.match(reply, /https:\/\/luxetty\.com\/propiedad\/casa-en-montemorelos-lux-a0453/);
});

test('buildPropertyInterestReply con nombre conocido no vuelve a pedir nombre', () => {
  const reply = buildPropertyInterestReply(
    {
      id: 'p1',
      listing_id: 'LUX-A0462',
      municipality: 'Monterrey',
      slug: 'casa-en-monterrey-a0462',
    },
    {
      property_code: 'LUX-A0462',
      direct_property_reference: true,
      property_specific_intent: true,
      full_name: 'Mariana Ruiz',
    }
  );

  assert.equal(typeof reply, 'string');
  assert.doesNotMatch(reply, /me compartes tu nombre/i);
});

test('buildPropertyInterestReply con awaiting_field full_name evita repetir la misma pregunta de nombre', () => {
  const reply = buildPropertyInterestReply(
    {
      id: 'p1',
      listing_id: 'LUX-A0462',
      municipality: 'Monterrey',
      slug: 'casa-en-monterrey-a0462',
    },
    {
      property_code: 'LUX-A0462',
      direct_property_reference: true,
      property_specific_intent: true,
      full_name: null,
      awaiting_field: 'full_name',
    }
  );

  assert.equal(typeof reply, 'string');
  assert.doesNotMatch(reply, /¿me compartes tu nombre\?/i);
  assert.match(reply, /compárteme solo tu nombre/i);
});

test('buildDemandReply con propiedad directa devuelve un string coherente y enlace', () => {
  const state = {
    lead_flow: 'demand',
    direct_property_reference: true,
    property_code: 'LUX-A0453',
    asks_property_details: true,
    full_name: null,
  };

  const properties = [
    {
      id: 'p1',
      listing_id: 'LUX-A0453',
      neighborhood: 'Montemorelos',
      slug: 'casa-en-montemorelos-lux-a0453',
    },
  ];

  const reply = buildDemandReply(state, 'minor_update', properties, 'direct_property_code');
  assert.equal(typeof reply, 'string');
  assert.match(reply, /https:\/\/luxetty\.com\/propiedad\/casa-en-montemorelos-lux-a0453/);
  assert.match(reply, /nombre/i);
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

test('buildPropertyPriceReply: precio real con disclaimer de asesor', () => {
  const replyNamed = buildPropertyPriceReply(
    { id: 'p1', listing_id: 'LUX-A0470', price: 2500000 },
    { property_code: 'LUX-A0470', full_name: 'Jorge Pérez' }
  );

  assert.match(replyNamed, /El precio registrado de LUX-A0470/i);
  assert.match(replyNamed, /2[., ]?500[., ]?000|2,500,000/i);
  assert.match(replyNamed, /asesor/i);

  const replyNoName = buildPropertyPriceReply({ id: 'p1', listing_id: 'LUX-A0470', price: 2500000 }, { property_code: 'LUX-A0470' });
  assert.match(replyNoName, /2,500,000|2\.500\.000/i);
  assert.match(replyNoName, /nombre/i);
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
