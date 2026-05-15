'use strict';

const { CONVERSATION_GOALS } = require('../types/constants');

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @returns {Partial<import('../types/conversationState').ConversationState>}
 */
function applyGoalOwnership(state, patch, decision) {
  const out = { ...patch };

  if (decision.detectedIntent === 'SELL_PROPERTY' || out.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
    out.conversationGoal = CONVERSATION_GOALS.SELL_PROPERTY;
    out.conversationGoalLocked = true;
    out.goalConfidence = Math.max(state.goalConfidence || 0, decision.confidence || 0.85);
    out.leadFlow = 'offer';
    out.operationType = 'sale';
  }

  if (decision.detectedIntent === 'BUY_PROPERTY' || out.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    if (!state.conversationGoalLocked || decision.explicitFlowSwitch) {
      out.conversationGoal = CONVERSATION_GOALS.BUY_PROPERTY;
      out.conversationGoalLocked = true;
      out.goalConfidence = Math.max(state.goalConfidence || 0, decision.confidence || 0.8);
      out.leadFlow = 'demand';
      out.operationType = 'sale';
    }
  }

  if (decision.detectedIntent === 'RENT_PROPERTY') {
    if (!state.conversationGoalLocked || decision.explicitFlowSwitch) {
      out.conversationGoal = CONVERSATION_GOALS.RENT_PROPERTY;
      out.conversationGoalLocked = true;
      out.goalConfidence = Math.max(state.goalConfidence || 0, decision.confidence || 0.8);
      out.leadFlow = 'demand';
      out.operationType = 'rent';
    }
  }

  if (state.conversationGoalLocked && !decision.explicitFlowSwitch) {
    if (state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY) {
      out.leadFlow = 'offer';
      out.operationType = 'sale';
      if (out.budget != null) {
        out.expectedPrice = out.expectedPrice ?? out.budget;
        out.budget = null;
      }
    }
    if (state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
      out.leadFlow = 'demand';
      out.operationType = 'sale';
    }
    if (state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY) {
      out.leadFlow = 'demand';
      out.operationType = 'rent';
    }
  }

  return out;
}

module.exports = {
  applyGoalOwnership,
};
