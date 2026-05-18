'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateMustNotReply, replySignature } = require('../argos/mustNotValidator');

describe('argosMustNotValidator', () => {
  it('flags invent_price when amount not in facts', () => {
    const violations = validateMustNotReply({
      replyText: 'La propiedad cuesta 12 millones de pesos.',
      must_not: { invent_price: true },
      facts: { knownPrices: [5000000] },
    });
    assert.ok(violations.some((v) => v.constraint === 'must_not.invent_price'));
  });

  it('allows honest uncertainty without price claim', () => {
    const violations = validateMustNotReply({
      replyText: 'No puedo confirmar el precio sin validar en inventario.',
      must_not: { invent_price: true },
      facts: { knownPrices: [] },
    });
    assert.equal(violations.length, 0);
  });

  it('flags repeated_phrase when signature matches previous turn', () => {
    const reply = 'Hola, soy el asesor IA de Luxetty. Con gusto te ayudo.';
    const violations = validateMustNotReply({
      replyText: reply,
      must_not: { repeated_phrase: true },
      facts: { previousReplySignature: replySignature(reply) },
    });
    assert.ok(violations.some((v) => v.constraint === 'must_not.repeated_phrase'));
  });

  it('flags flow_restart when sticky rent and global menu', () => {
    const violations = validateMustNotReply({
      replyText:
        '¿Buscas vender, poner en renta, comprar o rentar una propiedad?',
      must_not: { flow_restart: true },
      facts: { suppressGlobalMenu: true },
    });
    assert.ok(violations.some((v) => v.constraint === 'must_not.flow_restart'));
  });
});
