const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPropertyInterestReply,
  buildPropertyPriceReply,
  buildDemandReply,
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
  assert.match(reply[0], /Con gusto\. Te comparto la liga de la propiedad A0453 en Montemorelos\./);
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
