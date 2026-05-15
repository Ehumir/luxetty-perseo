'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { processV3Turn, clearV3Session, CONVERSATION_GOALS } = require('../conversation/v3');
const { shouldAcceptAsIdentityName } = require('../conversation/v3/interpreter/nameHeuristics');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const { CONVERSATION_STAGES } = require('../conversation/v3/types/constants');

describe('V3-F2.2 name protection', () => {
  it('no sobrescribe Jorge con Nada ni ya te dije', () => {
    const state = createInitialConversationState({});
    state.conversationGoal = CONVERSATION_GOALS.SELL_PROPERTY;
    state.conversationGoalLocked = true;
    state.collectedFields = { fullName: 'Jorge' };
    state.conversationStage = CONVERSATION_STAGES.PROPERTY_CONTEXT;

    assert.equal(shouldAcceptAsIdentityName(state, 'Nada'), false);
    assert.equal(shouldAcceptAsIdentityName(state, 'ya te dije'), false);
    assert.equal(shouldAcceptAsIdentityName(state, 'Jorge', { explicitNameMatch: true }), false);
  });
});

describe('V3-F2.2 venta frustración sin loop', () => {
  it('guion completo + pushback mantiene Jorge y avanza', () => {
    const cid = 'f22-sell-pushback';
    clearV3Session(cid);
    const script = [
      'Hola',
      'Quiero vender mi casa',
      'Jorge',
      'No, está en San Pedro',
      '15 millones',
      'Ya te dije que es casa',
      'Nada, ¿por qué preguntas eso?',
      'Nada',
    ];
    let last;
    for (const text of script) {
      last = processV3Turn({ conversationId: cid, phone: '521', text });
      assert.ok(last.ok, text);
    }
    const s = last.state;
    assert.equal(s.collectedFields.fullName, 'Jorge');
    assert.equal(s.propertyType || s.collectedFields.propertyType, 'house');
    assert.equal(s.locationText, 'San Pedro');
    assert.equal(s.expectedPrice, 15_000_000);
    assert.match(String(last.reply), /Jorge/i);
    assert.doesNotMatch(String(last.reply), /Claro, Nada/i);
    assert.doesNotMatch(String(last.reply), /precio esperado de venta\?/i);
  });
});
