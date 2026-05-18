'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateMustNotReply } = require('../argos/mustNotValidator');

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
});
