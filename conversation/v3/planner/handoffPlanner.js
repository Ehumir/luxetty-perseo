'use strict';

const {
  CONVERSATION_STAGES,
  ADVISOR_CONTACT_CONSENT,
  V3_INTENT,
} = require('../types/constants');

/**
 * @typedef {'CONTINUE_QUALIFICATION'|'OFFER_HANDOFF'|'CONSENT_ACCEPTED'|'CONSENT_DECLINED'|'HANDOFF_COMPLETE'} HandoffAction
 */

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {ReturnType<typeof import('./qualificationPlanner').evaluateQualification>} plannerOut
 */
function processHandoff(state, _text, decision, plannerOut) {
  /** @type {Partial<import('../types/conversationState').ConversationState>} */
  const patch = {};
  let action = /** @type {HandoffAction} */ ('CONTINUE_QUALIFICATION');

  if (decision.detectedIntent === V3_INTENT.ADVISOR_CONSENT_CAPTURE) {
    const consent = state.advisorContactConsent;
    if (consent === ADVISOR_CONTACT_CONSENT.ACCEPTED) {
      patch.awaitingField = null;
      patch.handoffStage = CONVERSATION_STAGES.HANDOFF_READY;
      patch.conversationStage = CONVERSATION_STAGES.HANDOFF_READY;
      action = 'CONSENT_ACCEPTED';
      return { patch, action };
    }
    if (consent === ADVISOR_CONTACT_CONSENT.DECLINED) {
      patch.awaitingField = null;
      patch.handoffStage = CONVERSATION_STAGES.QUALIFICATION_COMPLETE;
      patch.conversationStage = CONVERSATION_STAGES.QUALIFICATION_COMPLETE;
      action = 'CONSENT_DECLINED';
      return { patch, action };
    }
  }

  if (state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.ACCEPTED) {
    patch.handoffStage = CONVERSATION_STAGES.HANDOFF_READY;
    patch.conversationStage = CONVERSATION_STAGES.HANDOFF_READY;
    action = 'HANDOFF_COMPLETE';
    return { patch, action };
  }

  if (!plannerOut.qualificationComplete) {
    return { patch, action };
  }

  patch.qualificationComplete = true;

  if (state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.DECLINED) {
    patch.conversationStage = CONVERSATION_STAGES.QUALIFICATION_COMPLETE;
    patch.handoffStage = CONVERSATION_STAGES.QUALIFICATION_COMPLETE;
    return { patch, action };
  }

  if (
    state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.UNKNOWN ||
    !state.advisorContactConsent
  ) {
    patch.advisorContactConsent = ADVISOR_CONTACT_CONSENT.REQUESTED;
    patch.awaitingField = 'advisor_contact_consent';
    patch.handoffStage = CONVERSATION_STAGES.HANDOFF_PENDING;
    patch.conversationStage = CONVERSATION_STAGES.HANDOFF_PENDING;
    action = 'OFFER_HANDOFF';
    return { patch, action };
  }

  if (state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.REQUESTED) {
    patch.handoffStage = CONVERSATION_STAGES.HANDOFF_PENDING;
    patch.conversationStage = CONVERSATION_STAGES.HANDOFF_PENDING;
    action = 'OFFER_HANDOFF';
    return { patch, action };
  }

  patch.conversationStage = CONVERSATION_STAGES.QUALIFICATION_COMPLETE;
  patch.handoffStage = CONVERSATION_STAGES.QUALIFICATION_COMPLETE;
  return { patch, action };
}

module.exports = {
  processHandoff,
};
