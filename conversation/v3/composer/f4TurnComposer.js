'use strict';

const { mergeConversationState } = require('../types/conversationState');
const { tryComposePostHandoffTurn } = require('./postHandoffComposer');
const { tryComposeObjectionTurn } = require('./objectionComposer');
const {
  classifyObjection,
  isHandoffFlowActive,
  isPositiveHandoffAck,
} = require('../interpreter/objectionClassifier');
const { FORCED_HANDOFF_REASONS } = require('../types/forcedHandoffReasons');
const { V3_INTENT } = require('../types/constants');
const { isHumanityDeferHandoffKind } = require('./humanityHandoffComposer');

/**
 * Turnos F4 antes de fallback forzado o F3 (post-cierre, objeciones consultivas).
 * @param {{
 *   state: import('../types/conversationState').ConversationState,
 *   decision: import('../types/conversationDecision').ConversationDecision,
 *   text: string,
 * }} input
 * @returns {{ composed: object, state: object, responseSource: string }|null}
 */
function tryComposeF4EarlyTurn(input) {
  const state = input.state;
  const text = String(input.text || '');
  const decision = input.decision || {};

  const post = tryComposePostHandoffTurn(state, text);
  if (post) {
    const next = mergeConversationState(state, {
      lastAssistantReply: post.responseText,
      lastAssistantQuestion: null,
      awaitingField: post.awaitingField,
      lastComposerIntent: 'f4_post_close_ack',
    });
    return { composed: post, state: next, responseSource: 'v3_core_f4' };
  }

  const objection = tryComposeObjectionTurn(state, text);
  if (objection) {
    const kind = classifyObjection(text, state);
    /** @type {Partial<import('../types/conversationState').ConversationState>} */
    const objectionPatch = {
      lastAssistantReply: objection.responseText,
      lastAssistantQuestion: objection.followUpQuestion,
      awaitingField: objection.awaitingField,
      lastComposerIntent: `f4_objection|${kind}`,
    };
    if (kind === 'sell_valuation_unknown') {
      objectionPatch.priceUnknown = true;
      objectionPatch.valuationRequested = true;
      objectionPatch.collectedFields = {
        ...(state.collectedFields || {}),
        valuationRequested: true,
      };
    }
    const next = mergeConversationState(state, objectionPatch);
    return { composed: objection, state: next, responseSource: 'v3_core_f4' };
  }

  return null;
}

/**
 * @param {{
 *   state: import('../types/conversationState').ConversationState,
 *   decision: object,
 *   text: string,
 *   handoffOut: { action: string },
 * }} input
 */
function tryComposeF4PlannerTurn(input) {
  const { state, decision, text, handoffOut } = input;
  if (handoffOut.action === 'CONSENT_ACCEPTED' || handoffOut.action === 'HANDOFF_COMPLETE') {
    return null;
  }
  const kind = classifyObjection(text, state);
  if (isHumanityDeferHandoffKind(kind)) {
    const humanity = tryComposeF4EarlyTurn({ state, decision, text });
    if (humanity) return humanity;
  }
  if (handoffOut.action === 'OFFER_HANDOFF') {
    return null;
  }
  return tryComposeF4EarlyTurn({ state, decision, text });
}

/**
 * @param {string|null} forcedReason
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
function shouldSuppressForcedHandoff(forcedReason, state, decision, text) {
  if (!forcedReason) return false;
  if (
    isHandoffFlowActive(state) &&
    (forcedReason === FORCED_HANDOFF_REASONS.INTENT_UNKNOWN ||
      forcedReason === FORCED_HANDOFF_REASONS.OUT_OF_CATALOG)
  ) {
    return true;
  }
  if (isHandoffFlowActive(state) && text && isPositiveHandoffAck(text)) {
    return true;
  }
  if (decision.detectedIntent === V3_INTENT.ADVISOR_CONSENT_CAPTURE && isHandoffFlowActive(state)) {
    return true;
  }
  if (
    state.qualificationComplete &&
    (forcedReason === FORCED_HANDOFF_REASONS.INTENT_UNKNOWN ||
      forcedReason === FORCED_HANDOFF_REASONS.OUT_OF_CATALOG)
  ) {
    return true;
  }
  if (
    state.qualificationComplete &&
    (decision.detectedIntent === V3_INTENT.BUYER_BUDGET ||
      decision.detectedIntent === V3_INTENT.IDENTITY_CAPTURE ||
      decision.detectedIntent === V3_INTENT.BEDROOMS_CAPTURE)
  ) {
    return true;
  }
  return false;
}

module.exports = {
  tryComposeF4EarlyTurn,
  tryComposeF4PlannerTurn,
  shouldSuppressForcedHandoff,
};
