'use strict';

const { CONVERSATION_STAGES, ALL_STAGES, IDENTITY_STATES } = require('../types/constants');

/**
 * Transiciones deterministas mínimas (F1). Sin OpenAI.
 * @param {string} currentStage
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {import('../types/conversationState').ConversationState} state
 * @returns {string}
 */
function resolveNextStage(currentStage, decision, state) {
  const cur = ALL_STAGES.has(currentStage) ? currentStage : CONVERSATION_STAGES.NEW;

  if (decision.shouldEscalateHuman) return CONVERSATION_STAGES.HUMAN_ESCALATION;

  if (cur === CONVERSATION_STAGES.NEW) {
    return CONVERSATION_STAGES.UNDERSTANDING;
  }

  if (cur === CONVERSATION_STAGES.UNDERSTANDING) {
    if (state.leadFlow === 'offer' || state.leadFlow === 'demand') {
      if (decision.shouldAskName || state.identityState === IDENTITY_STATES.UNKNOWN) return CONVERSATION_STAGES.IDENTITY_PENDING;
      return CONVERSATION_STAGES.QUALIFYING;
    }
    return CONVERSATION_STAGES.UNDERSTANDING;
  }

  if (cur === CONVERSATION_STAGES.IDENTITY_PENDING) {
    if (state.collectedFields && state.collectedFields.fullName) return CONVERSATION_STAGES.QUALIFYING;
    return CONVERSATION_STAGES.IDENTITY_PENDING;
  }

  if (cur === CONVERSATION_STAGES.QUALIFYING) {
    if (state.locationText && state.expectedPrice != null && Number.isFinite(state.expectedPrice)) {
      return CONVERSATION_STAGES.READY_FOR_CRM;
    }
    if (state.activeProperty && (state.activeProperty.listingCode || state.activeProperty.id)) {
      return CONVERSATION_STAGES.PROPERTY_CONTEXT;
    }
    return CONVERSATION_STAGES.QUALIFYING;
  }

  if (cur === CONVERSATION_STAGES.PROPERTY_CONTEXT) {
    return CONVERSATION_STAGES.QUALIFYING;
  }

  if (decision.nextSuggestedStage && ALL_STAGES.has(decision.nextSuggestedStage)) {
    return decision.nextSuggestedStage;
  }

  return cur;
}

module.exports = {
  resolveNextStage,
};
