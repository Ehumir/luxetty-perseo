'use strict';

const { CONVERSATION_GOALS } = require('../types/constants');

/** @typedef {'sellOffer'|'buyDemand'|'rentOffer'|'rentDemand'} QualificationFlowKey */

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @returns {QualificationFlowKey|null}
 */
function resolveQualificationFlowKey(state) {
  const goal = state.conversationGoal;
  if (goal === CONVERSATION_GOALS.SELL_PROPERTY) return 'sellOffer';
  if (goal === CONVERSATION_GOALS.RENT_OUT_PROPERTY) return 'rentOffer';
  if (goal === CONVERSATION_GOALS.BUY_PROPERTY) return 'buyDemand';
  if (goal === CONVERSATION_GOALS.RENT_PROPERTY) {
    return state.leadFlow === 'offer' ? 'rentOffer' : 'rentDemand';
  }
  if (state.leadFlow === 'offer' && state.operationType === 'sale') return 'sellOffer';
  if (state.leadFlow === 'offer' && state.operationType === 'rent') return 'rentOffer';
  if (state.leadFlow === 'demand' && state.operationType === 'rent') return 'rentDemand';
  if (state.leadFlow === 'demand') return 'buyDemand';
  return null;
}

module.exports = {
  resolveQualificationFlowKey,
};
