'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickOpeningVariant,
  replySignature,
  isGlobalIntentMenu,
  applyGeneralReplyAntiRepetition,
  shouldSuppressGlobalIntentMenu,
} = require('../conversation/v3/composer/openingVariantPicker');
const { CONVERSATION_GOALS, CONVERSATION_STAGES } = require('../conversation/v3/types/constants');

describe('openingVariantPicker', () => {
  it('pickOpeningVariant avoids previous signature', () => {
    const state = {
      conversationId: 'c1',
      lastAssistantReplySignature: replySignature('Hola, soy el asesor IA de Luxetty.'),
    };
    const a = 'Hola, soy el asesor IA de Luxetty. Con gusto te ayudo.';
    const b = 'Hola, qué gusto saludarte. Soy el asesor IA de Luxetty.';
    const picked = pickOpeningVariant(state, [a, b]);
    assert.notEqual(replySignature(picked), state.lastAssistantReplySignature);
  });

  it('applyGeneralReplyAntiRepetition replaces identical global menu', () => {
    const menu =
      'Hola, soy el asesor IA de Luxetty. Con gusto te ayudo. ¿Buscas vender, poner en renta, comprar o rentar una propiedad?';
    const state = {
      conversationId: 'c2',
      leadFlow: 'demand',
      conversationGoalLocked: true,
      lastAssistantReply: menu,
      lastAssistantReplySignature: replySignature(menu),
    };
    const out = applyGeneralReplyAntiRepetition({ state, replyText: menu });
    assert.equal(out.replaced, true);
    assert.notEqual(replySignature(out.text), replySignature(menu));
  });

  it('shouldSuppressGlobalIntentMenu when rent demand locked', () => {
    const state = {
      leadFlow: 'demand',
      operationType: 'rent',
      conversationGoal: CONVERSATION_GOALS.RENT_PROPERTY,
      conversationGoalLocked: true,
      conversationStage: CONVERSATION_STAGES.UNDERSTANDING,
    };
    assert.equal(shouldSuppressGlobalIntentMenu(state), true);
  });
});
