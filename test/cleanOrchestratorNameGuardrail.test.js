'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../index');

function ctx(overrides = {}) {
  return {
    contact: null,
    aiState: {},
    waProfileName: null,
    recentOutboundTexts: [],
    userInboundText: '',
    leadFlow: null,
    ...overrides,
  };
}

test('1) "Hola" debe pedir nombre si no hay nombre válido', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: 'Hola',
    signals: {},
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: 'Hola' }));
  assert.match(String(out.reply), /nombre/i);
});

test('2) "Info" debe pedir nombre si no hay nombre válido', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: 'Info',
    signals: {},
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: 'Info' }));
  assert.match(String(out.reply), /nombre/i);
});

test('3) "Me interesa" debe pedir nombre si no hay nombre válido', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: 'Me interesa',
    signals: {},
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: 'Me interesa' }));
  assert.match(String(out.reply), /nombre/i);
});

test('4) "Precio" debe pedir nombre si no hay nombre válido', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: 'Precio',
    signals: {},
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: 'Precio' }));
  assert.match(String(out.reply), /nombre/i);
});

test('5) "Quiero vender mi casa" debe pedir nombre y zona', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: 'Quiero vender mi casa',
    signals: { lead_flow: 'offer' },
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: 'Quiero vender mi casa', leadFlow: 'offer' }));
  assert.match(String(out.reply), /nombre/i);
  assert.match(String(out.reply), /zona/i);
});

test('6) "Busco casa en Cumbres" debe pedir nombre (y puede orientar)', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: 'Busco casa en Cumbres',
    signals: { lead_flow: 'demand', location_text: 'Cumbres' },
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: 'Busco casa en Cumbres', leadFlow: 'demand' }));
  assert.match(String(out.reply), /Cumbres/i);
  assert.match(String(out.reply), /nombre/i);
});

test('7) "¿Sigue disponible?" debe pedir nombre si no existe nombre', () => {
  const baseReply = _private.buildConsultiveFallbackReply({
    text: '¿Sigue disponible?',
    signals: {},
    aiState: {},
  });
  const out = _private.enforceNameCapture(baseReply, ctx({ userInboundText: '¿Sigue disponible?' }));
  assert.match(String(out.reply), /nombre/i);
});

test('8) Si contact.full_name existe, NO debe pedir nombre', () => {
  const contact = { first_name: 'Carlos', last_name: 'Pérez' };
  const out = _private.enforceNameCapture('Hola, claro. Te puedo ayudar.', ctx({ contact, aiState: { full_name: null } }));
  assert.doesNotMatch(String(out.reply), /nombre/i);
});

test('9) Si último outbound ya pidió nombre y usuario responde otra cosa sin nombre, debe insistir natural', () => {
  const aiState = { awaiting_field: 'full_name', full_name: null };
  const base = 'Claro, te ayudo con eso.';
  const out = _private.enforceNameCapture(base, ctx({
    aiState,
    userInboundText: 'Precio',
    recentOutboundTexts: ['Para registrarte bien, ¿me compartes tu nombre?'],
  }));
  assert.match(String(out.reply), /nombre/i);
  assert.match(String(out.reply), /orientarte|registrarte/i);
});

test('10) Si usuario da nombre ("Soy Roberto"), no debe volver a pedir nombre en ese turno', () => {
  const aiState = { full_name: 'Roberto' };
  const out = _private.enforceNameCapture('Gracias, Roberto. ¿Qué presupuesto tienes?', ctx({ aiState, userInboundText: 'Soy Roberto' }));
  assert.doesNotMatch(String(out.reply), /nombre/i);
});

