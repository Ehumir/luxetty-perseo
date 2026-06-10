'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseMoneyAmount } = require('../conversation/v3/interpreter/moneyParser');
const { isPhoneLikeText } = require('../utils/phoneMoneyGuard');
const { createEmptyDecision } = require('../conversation/v3/types/conversationDecision');
const { CONVERSATION_GOALS } = require('../conversation/v3/types/constants');
const { tryResolveAwaitingFieldCapture } = require('../conversation/v3/interpreter/awaitingFieldCapture');
const { extractMaxPrice } = require('../conversation/parsers');

describe('phoneMoneyGuard — parseMoneyAmount', () => {
  for (const phone of [
    '8110225732',
    '81 1022 5732',
    '+52 811 022 5732',
    '5218110225732',
    '528110225732',
    '(81) 1022-5732',
  ]) {
    it(`rejects phone "${phone}" as budget`, () => {
      assert.equal(parseMoneyAmount(phone), null);
      assert.equal(isPhoneLikeText(phone), true);
    });
  }

  for (const [input, expected] of [
    ['25 mil', 25_000],
    ['25000', 25_000],
    ['$25,000', 25_000],
    ['presupuesto 8 millones', 8_000_000],
  ]) {
    it(`still parses budget "${input}" => ${expected}`, () => {
      assert.equal(parseMoneyAmount(input), expected);
    });
  }
});

describe('phoneMoneyGuard — extractMaxPrice legacy', () => {
  it('rejects 10-digit phone in legacy parser', () => {
    assert.equal(extractMaxPrice('8110225732'), null);
  });

  it('rejects phone digits inside Meta Lead Form payload', () => {
    const text = [
      '¿tienes_decisión_sobre_la_venta_o_renta_de_la_propiedad?: Sí',
      'número_de_teléfono: +5218120021798',
      'nombre_completo: Addy Pava',
      '¿en_qué_colonia_se_encuentra?: Cumbres 4 sector',
      '¿qué_te_gustaría_hacer?: Valorar primero Para rentar',
    ].join('\n');
    assert.equal(extractMaxPrice(text), null);
  });
});

describe('v3AwaitingFieldCapture — phone while awaiting name', () => {
  it('does not capture budget when awaiting full_name and user sends phone', () => {
    const state = {
      conversationGoalLocked: true,
      conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
      leadFlow: 'demand',
      awaitingField: 'full_name',
      budget: null,
    };
    const patch = {};
    const decision = createEmptyDecision();
    const out = tryResolveAwaitingFieldCapture(
      state,
      '8110225732',
      '8110225732',
      patch,
      decision,
    );
    assert.equal(out?.patch?.budget, undefined);
  });

  it('captures budget when awaiting budget field', () => {
    const state = {
      conversationGoalLocked: true,
      conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
      leadFlow: 'demand',
      awaitingField: 'budget',
      budget: null,
    };
    const patch = {};
    const decision = createEmptyDecision();
    const out = tryResolveAwaitingFieldCapture(state, '25 mil', '25 mil', patch, decision);
    assert.ok(out);
    assert.equal(out.patch.budget, 25_000);
  });
});
