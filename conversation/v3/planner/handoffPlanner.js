'use strict';

const {
  CONVERSATION_STAGES,
  ADVISOR_CONTACT_CONSENT,
  V3_INTENT,
  CONVERSATION_GOALS,
} = require('../types/constants');
const { HUMAN_ESCALATION_REASONS } = require('../types/forcedHandoffReasons');
const { classifyObjection } = require('../interpreter/objectionClassifier');
const { isHumanityDeferHandoffKind } = require('../composer/humanityHandoffComposer');

/**
 * @typedef {'CONTINUE_QUALIFICATION'|'OFFER_HANDOFF'|'CONSENT_ACCEPTED'|'CONSENT_DECLINED'|'HANDOFF_COMPLETE'|'PROPERTY_QA_ENTRY'|'PROPERTY_QA_CONTINUE'|'FORCE_HANDOFF'|'FORCE_HANDOFF_READY'|'FORCE_HANDOFF_ESCALATION'} HandoffAction
 */

/**
 * F3.3B — canalización obligatoria cuando V3 no puede continuar de forma segura.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {{ reason: string, decision?: import('../types/conversationDecision').ConversationDecision }} input
 */
function forceHandoff(state, input) {
  const reason = String(input.reason || 'intent_unknown').trim();
  const decision = input.decision || {};

  /** @type {Partial<import('../types/conversationState').ConversationState>} */
  const patch = {
    unhandledReason: reason,
    handoffReason: reason,
    lastOfferType: 'HANDOFF_PROPERTY',
  };

  if (state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.DECLINED) {
    patch.awaitingField = null;
    patch.handoffStage = CONVERSATION_STAGES.HUMAN_ESCALATION;
    patch.conversationStage = CONVERSATION_STAGES.HUMAN_ESCALATION;
    patch.frustrationState = state.frustrationState;
    return { patch, action: /** @type {HandoffAction} */ ('FORCE_HANDOFF_ESCALATION') };
  }

  if (state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.ACCEPTED) {
    patch.awaitingField = null;
    patch.handoffStage = CONVERSATION_STAGES.HANDOFF_READY;
    patch.conversationStage = CONVERSATION_STAGES.HANDOFF_READY;
    return { patch, action: /** @type {HandoffAction} */ ('FORCE_HANDOFF_READY') };
  }

  if (HUMAN_ESCALATION_REASONS.has(reason)) {
    patch.awaitingField = null;
    patch.handoffStage = CONVERSATION_STAGES.HUMAN_ESCALATION;
    patch.conversationStage = CONVERSATION_STAGES.HUMAN_ESCALATION;
    patch.advisorContactConsent = ADVISOR_CONTACT_CONSENT.REQUESTED;
    return { patch, action: /** @type {HandoffAction} */ ('FORCE_HANDOFF_ESCALATION') };
  }

  patch.advisorContactConsent = ADVISOR_CONTACT_CONSENT.REQUESTED;
  patch.handoffStage = CONVERSATION_STAGES.HANDOFF_PENDING;
  patch.conversationStage = CONVERSATION_STAGES.HANDOFF_PENDING;
  patch.awaitingField =
    reason === 'user_requests_human' || reason === 'runtime_error'
      ? null
      : 'advisor_contact_consent';

  if (decision.shouldEscalateHuman) {
    patch.handoffStage = CONVERSATION_STAGES.HUMAN_ESCALATION;
    patch.conversationStage = CONVERSATION_STAGES.HUMAN_ESCALATION;
  }

  return { patch, action: /** @type {HandoffAction} */ ('FORCE_HANDOFF') };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} _text
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {ReturnType<typeof import('./qualificationPlanner').evaluateQualification>} plannerOut
 */
function processHandoff(state, text, decision, plannerOut) {
  /** @type {Partial<import('../types/conversationState').ConversationState>} */
  const patch = {};
  let action = /** @type {HandoffAction} */ ('CONTINUE_QUALIFICATION');

  const humanityKind = classifyObjection(text, state);
  if (isHumanityDeferHandoffKind(humanityKind)) {
    return { patch, action };
  }

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

  const consentUnknown =
    state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.UNKNOWN || !state.advisorContactConsent;

  /** F3.3A — PROPERTY_INQUIRY: primero modo Q&A; handoff solo con intención fuerte o cierre suave tras ayuda. */
  if (state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY && consentUnknown) {
    if (decision.detectedIntent === V3_INTENT.PROPERTY_FACT_QUESTION) {
      action = 'PROPERTY_QA_CONTINUE';
      return { patch, action };
    }
    if (decision.detectedIntent === V3_INTENT.IDENTITY_CAPTURE) {
      patch.propertySubMode = 'PROPERTY_QA';
      patch.propertyQaUserTurnCount = 0;
      patch.propertyQaAnswerCount = 0;
      patch.awaitingField = null;
      patch.handoffStage = CONVERSATION_STAGES.PROPERTY_CONTEXT;
      patch.conversationStage = CONVERSATION_STAGES.PROPERTY_CONTEXT;
      patch.lastOfferType = null;
      patch.loopRiskScore = 0;
      action = 'PROPERTY_QA_ENTRY';
      return { patch, action };
    }
    if (decision.detectedIntent === V3_INTENT.PROPERTY_HUMAN_HANDOFF_REQUEST) {
      patch.propertySubMode = 'HANDOFF_OFFERED';
      patch.advisorContactConsent = ADVISOR_CONTACT_CONSENT.REQUESTED;
      patch.awaitingField = 'advisor_contact_consent';
      patch.handoffStage = CONVERSATION_STAGES.HANDOFF_PENDING;
      patch.conversationStage = CONVERSATION_STAGES.HANDOFF_PENDING;
      patch.lastOfferType = 'HANDOFF_PROPERTY';
      action = 'OFFER_HANDOFF';
      return { patch, action };
    }
    if (state.propertySubMode === 'PROPERTY_QA') {
      if (decision.detectedIntent === V3_INTENT.PROPERTY_FACT_QUESTION) {
        action = 'PROPERTY_QA_CONTINUE';
        return { patch, action };
      }
      if (decision.detectedIntent === V3_INTENT.PROPERTY_QA_SOFT_CLOSE && (state.propertyQaAnswerCount || 0) >= 1) {
        patch.propertySubMode = 'HANDOFF_OFFERED';
        patch.advisorContactConsent = ADVISOR_CONTACT_CONSENT.REQUESTED;
        patch.awaitingField = 'advisor_contact_consent';
        patch.handoffStage = CONVERSATION_STAGES.HANDOFF_PENDING;
        patch.conversationStage = CONVERSATION_STAGES.HANDOFF_PENDING;
        patch.lastOfferType = 'HANDOFF_PROPERTY';
        action = 'OFFER_HANDOFF';
        return { patch, action };
      }
      action = 'PROPERTY_QA_CONTINUE';
      return { patch, action };
    }
  }

  if (consentUnknown) {
    patch.advisorContactConsent = ADVISOR_CONTACT_CONSENT.REQUESTED;
    patch.awaitingField = 'advisor_contact_consent';
    patch.handoffStage = CONVERSATION_STAGES.HANDOFF_PENDING;
    patch.conversationStage = CONVERSATION_STAGES.HANDOFF_PENDING;
    patch.lastOfferType = 'HANDOFF_PROPERTY';
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
  forceHandoff,
};
