'use strict';

const { CONVERSATION_STAGES, ALL_STAGES, IDENTITY_STATES, CONVERSATION_GOALS } = require('../types/constants');

/**
 * F2 — transiciones hasta PROPERTY_CONTEXT (sin saltar a CRM).
 */
function resolveNextStage(currentStage, decision, state) {
  const cur = ALL_STAGES.has(currentStage) ? currentStage : CONVERSATION_STAGES.NEW;

  if (decision.shouldEscalateHuman) return CONVERSATION_STAGES.HUMAN_ESCALATION;

  if (cur === CONVERSATION_STAGES.NEW) {
    return CONVERSATION_STAGES.UNDERSTANDING;
  }

  if (cur === CONVERSATION_STAGES.UNDERSTANDING) {
    if (state.conversationGoal || state.leadFlow) {
      if (
        !state.collectedFields?.fullName &&
        (decision.shouldAskName || state.identityState === IDENTITY_STATES.UNKNOWN)
      ) {
        return CONVERSATION_STAGES.IDENTITY_PENDING;
      }
      return CONVERSATION_STAGES.QUALIFYING;
    }
    return CONVERSATION_STAGES.UNDERSTANDING;
  }

  if (cur === CONVERSATION_STAGES.IDENTITY_PENDING) {
    if (state.collectedFields?.fullName) return CONVERSATION_STAGES.QUALIFYING;
    return CONVERSATION_STAGES.IDENTITY_PENDING;
  }

  if (cur === CONVERSATION_STAGES.QUALIFYING) {
    const sell = state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY;
    const buy = state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY;
    if (sell && state.locationText && state.expectedPrice != null) {
      return CONVERSATION_STAGES.PROPERTY_CONTEXT;
    }
    if (buy && state.locationText && state.budget != null && state.bedrooms != null) {
      return CONVERSATION_STAGES.PROPERTY_CONTEXT;
    }
    if (buy && state.locationText && state.budget != null) {
      return CONVERSATION_STAGES.QUALIFYING;
    }
    return CONVERSATION_STAGES.QUALIFYING;
  }

  if (cur === CONVERSATION_STAGES.PROPERTY_CONTEXT) {
    if (state.occupancyStatus || state.collectedFields?.occupancyStatus) {
      return CONVERSATION_STAGES.READY_FOR_CRM;
    }
    return CONVERSATION_STAGES.PROPERTY_CONTEXT;
  }

  if (cur === CONVERSATION_STAGES.READY_FOR_CRM) {
    return CONVERSATION_STAGES.READY_FOR_CRM;
  }

  if (decision.nextSuggestedStage && ALL_STAGES.has(decision.nextSuggestedStage)) {
    return decision.nextSuggestedStage;
  }

  return cur;
}

module.exports = {
  resolveNextStage,
};
