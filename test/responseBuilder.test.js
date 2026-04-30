const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPropertyInterestReply,
  buildPropertyPriceReply,
} = require('../conversation/responseBuilder');

test('buildPropertyInterestReply returns the short property microcommitment reply', () => {
  const reply = buildPropertyInterestReply({
    listing_id: 'LUX-A0470',
    title: 'CASA EN MITRAS PONIENTE EN VENTA',
    price: 2500000,
    neighborhood: 'Mitras Poniente',
    slug: 'casa-en-mitras-poniente-en-venta',
  });

  assert.equal(
    reply,
    `Hola 👋
Sí, claro. La propiedad LUX-A0470 en Mitras Poniente está en $2,500,000 MXN.

Te dejo aquí fotos y detalles 👉 https://luxetty.com/propiedad/casa-en-mitras-poniente-en-venta

¿Te gustaría agendar una visita o que un asesor te apoye con más detalles de esta propiedad?`
  );
});

test('buildPropertyInterestReply does not invent price when price is missing', () => {
  const reply = buildPropertyInterestReply({
    listing_id: 'LUX-A0462',
    price: null,
    zone: 'San Pedro',
    slug: 'departamento-en-san-pedro',
  });

  assert.match(reply, /te puedo compartir los detalles disponibles/);
  assert.doesNotMatch(reply, /\$0|\$NaN/);
  assert.match(reply, /https:\/\/luxetty\.com\/propiedad\/departamento-en-san-pedro/);
});

test('buildPropertyInterestReply does not invent a link when slug is missing', () => {
  const reply = buildPropertyInterestReply({
    listing_id: 'LUX-A0462',
    price: 4500000,
    municipality: 'Monterrey',
    slug: null,
  });

  assert.match(reply, /asesor revise la información pública/);
  assert.doesNotMatch(reply, /https:\/\/luxetty\.com\/propiedad\//);
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
