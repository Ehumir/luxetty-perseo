/*
 * Smoke test for outbound link splitting.
 *
 * Run:
 *   node scripts/smoke-outbound-links.js
 */

const { normalizeOutboundMessages } = require('../utils/helpers');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const plain = normalizeOutboundMessages('Hola, en que te ayudo?');
  assert(Array.isArray(plain) && plain.length === 1, 'Expected single outbound for plain text');
  assert(plain[0] === 'Hola, en que te ayudo?', 'Expected unchanged plain message');

  const withLuxettyLink = normalizeOutboundMessages(
    'Claro, te comparto la propiedad. Tambien puedo ayudarte con disponibilidad. https://luxetty.com/propiedad/slug-de-la-propiedad'
  );
  assert(withLuxettyLink.length === 2, 'Expected two messages when text includes luxetty link');
  assert(withLuxettyLink[0].includes('Claro, te comparto la propiedad'), 'Expected text in first message');
  assert(withLuxettyLink[1] === 'https://luxetty.com/propiedad/slug-de-la-propiedad', 'Expected URL-only second message');

  const arrayInput = normalizeOutboundMessages([
    'Primero te comparto contexto.',
    'Ver galeria: https://luxetty.com/propiedad/otro-slug',
  ]);
  assert(arrayInput.length === 3, 'Expected array input to keep order and split URL');
  assert(arrayInput[2] === 'https://luxetty.com/propiedad/otro-slug', 'Expected URL-only item in array mode');

  console.log('PASS outbound link split smoke');
}

main();
