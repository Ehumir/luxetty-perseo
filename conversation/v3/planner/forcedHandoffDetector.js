'use strict';

const { normalizeText } = require('../../../utils/text');
const {
  V3_INTENT,
  FRUSTRATION_STATES,
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
} = require('../types/constants');
const { FORCED_HANDOFF_REASONS } = require('../types/forcedHandoffReasons');
const {
  isBotIdentityQuestion,
  isExplicitHumanRequest,
  isHandoffFlowActive,
  isPositiveHandoffAck,
} = require('../interpreter/objectionClassifier');

const LOOP_RISK_THRESHOLD = 3;
const UNKNOWN_STREAK_THRESHOLD = 3;

/**
 * @param {string} text
 */
function isMediaUnsupportedSignal(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  return (
    /\[?\s*(audio|imagen|image|video|documento|sticker|nota\s+de\s+voz)\s*\]?/i.test(t) ||
    /no\s+puedo\s+(escuchar|ver|abrir)\s+(el|la|tu|este)/i.test(t) ||
    /mand[eé]\s+un(a)?\s+(audio|imagen|foto|video|documento)/i.test(t)
  );
}

/**
 * @param {string} text
 */
function isLegalEscalationSignal(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  return (
    /\b(herencia|intestad|divorcio|demanda|litigio|usufructo|notario|escritura\s+p[uú]blica)\b/i.test(t) ||
    (/\b(abogado|legal|juzgado)\b/i.test(t) && /\b(propiedad|casa|terreno|venta|compra)\b/i.test(t))
  );
}

/**
 * @param {string} text
 */
function isUserRequestsHumanSignal(text, decision) {
  if (decision.detectedIntent === V3_INTENT.PROPERTY_HUMAN_HANDOFF_REQUEST) return true;
  if (decision.shouldEscalateHuman) return true;
  if (isExplicitHumanRequest(text)) return true;
  if (isBotIdentityQuestion(text)) return true;
  return false;
}

/**
 * @param {{
 *   state: import('../types/conversationState').ConversationState,
 *   decision: import('../types/conversationDecision').ConversationDecision,
 *   text: string,
 *   frustration?: { isFrustrated: boolean, level: string },
 *   guard?: { allowed: boolean },
 *   explicitReason?: string|null,
 * }} input
 * @returns {string|null}
 */
function detectForcedHandoffReason(input) {
  const state = input.state || {};
  const decision = input.decision || {};
  const text = String(input.text || '');
  const guard = input.guard;

  if (input.explicitReason && String(input.explicitReason).trim()) {
    return String(input.explicitReason).trim();
  }

  if (isHandoffFlowActive(state) && isPositiveHandoffAck(text)) {
    return null;
  }
  if (isHandoffFlowActive(state) && decision.detectedIntent === V3_INTENT.ADVISOR_CONSENT_CAPTURE) {
    return null;
  }
  if (
    isHandoffFlowActive(state) &&
    state.conversationGoal &&
    decision.detectedIntent === V3_INTENT.UNKNOWN &&
    (Number(state.unknownIntentStreak) || 0) < UNKNOWN_STREAK_THRESHOLD
  ) {
    return null;
  }

  if (isMediaUnsupportedSignal(text)) {
    return FORCED_HANDOFF_REASONS.MEDIA_UNSUPPORTED;
  }

  if (isUserRequestsHumanSignal(text, decision)) {
    if (
      state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY &&
      decision.detectedIntent === V3_INTENT.PROPERTY_HUMAN_HANDOFF_REQUEST
    ) {
      return null;
    }
    return FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN;
  }

  if (isLegalEscalationSignal(text)) {
    return FORCED_HANDOFF_REASONS.LEGAL_ESCALATION;
  }

  const fr = input.frustration;
  if (fr && (fr.isFrustrated || fr.level === FRUSTRATION_STATES.ELEVATED)) {
    const loopHigh = (Number(state.loopRiskScore) || 0) >= 2;
    const stuck = (Number(state.unknownIntentStreak) || 0) >= 2;
    if (loopHigh || stuck || (guard && guard.allowed === false)) {
      return FORCED_HANDOFF_REASONS.FRUSTRATION_HIGH;
    }
    return null;
  }

  if (guard && guard.allowed === false) {
    return FORCED_HANDOFF_REASONS.RULE_GUARD_VIOLATION;
  }

  if ((Number(state.loopRiskScore) || 0) >= LOOP_RISK_THRESHOLD) {
    return FORCED_HANDOFF_REASONS.LOOP_EXHAUSTED;
  }

  const unknownStreak = Number(state.unknownIntentStreak) || 0;
  if (
    decision.detectedIntent === V3_INTENT.UNKNOWN &&
    unknownStreak >= UNKNOWN_STREAK_THRESHOLD &&
    !state.conversationGoal
  ) {
    return FORCED_HANDOFF_REASONS.OUT_OF_CATALOG;
  }

  if (
    state.conversationStage === CONVERSATION_STAGES.UNDERSTANDING &&
    !state.conversationGoal &&
    unknownStreak >= UNKNOWN_STREAK_THRESHOLD
  ) {
    return FORCED_HANDOFF_REASONS.OUT_OF_CATALOG;
  }

  if (
    decision.detectedIntent === V3_INTENT.UNKNOWN &&
    decision.confidence === 0 &&
    unknownStreak >= 2
  ) {
    return FORCED_HANDOFF_REASONS.INTENT_UNKNOWN;
  }

  return null;
}

module.exports = {
  detectForcedHandoffReason,
  isMediaUnsupportedSignal,
  isLegalEscalationSignal,
  isUserRequestsHumanSignal,
  LOOP_RISK_THRESHOLD,
  UNKNOWN_STREAK_THRESHOLD,
};
