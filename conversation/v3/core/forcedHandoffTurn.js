'use strict';

const { mergeConversationState, createInitialConversationState } = require('../types/conversationState');
const { V3_INTENT } = require('../types/constants');
const { forceHandoff } = require('../planner/handoffPlanner');
const { composeForcedHandoffFallback } = require('../composer/forcedHandoffComposer');
const { v3Log } = require('./v3Logger');

/**
 * Ejecuta pipeline mínimo F3.3B (sin CRM write, sin legacy).
 * @param {{
 *   state: import('../types/conversationState').ConversationState,
 *   decision?: import('../types/conversationDecision').ConversationDecision,
 *   reason: string,
 * }} input
 */
function runForcedHandoffTurn(input) {
  const state = input.state;
  const decision = input.decision || { detectedIntent: V3_INTENT.UNKNOWN, confidence: 0 };
  const reason = String(input.reason || 'intent_unknown');

  const handoffOut = forceHandoff(state, { reason, decision });
  let next = mergeConversationState(state, handoffOut.patch);
  const composed = composeForcedHandoffFallback(next, reason);

  if (composed.awaitingField !== undefined && composed.awaitingField !== null) {
    next = mergeConversationState(next, { awaitingField: composed.awaitingField });
  } else if (handoffOut.action === 'FORCE_HANDOFF_READY') {
    next = mergeConversationState(next, { awaitingField: null });
  }

  next = mergeConversationState(next, {
    lastAssistantReply: composed.responseText,
    lastAssistantQuestion: null,
    lastComposerIntent: `forced_handoff|${reason}`,
    lastUserText: state.lastUserText,
  });

  v3Log('forced_handoff', {
    conversation_id: next.conversationId,
    reason,
    handoff_action: handoffOut.action,
    stage: next.conversationStage,
    unhandled_reason: next.unhandledReason,
  });

  return {
    state: next,
    composed,
    replyText: composed.responseText,
    handoffOut,
    responseSource: 'v3_forced_handoff_f33b',
  };
}

/**
 * @param {{ conversationId: string, phone?: string|null, reason: string, legacyHydration?: object|null }} input
 */
function buildForcedHandoffFromSession(input) {
  const { getSession, setSession } = require('./sessionStore');
  const conversationId = String(input.conversationId || '');
  let state =
    getSession(conversationId) ||
    createInitialConversationState({
      conversationId,
      phone: input.phone != null ? String(input.phone) : null,
    });

  const h = input.legacyHydration && typeof input.legacyHydration === 'object' ? input.legacyHydration : null;
  if (h) {
    const hyd = {};
    if (h.propertyListingCode) hyd.propertyListingCode = String(h.propertyListingCode).trim();
    if (h.locationText) hyd.locationText = String(h.locationText).trim();
    if (h.activeProperty?.id) hyd.activeProperty = h.activeProperty;
    if (Object.keys(hyd).length) state = mergeConversationState(state, hyd);
  }

  const out = runForcedHandoffTurn({ state, reason: input.reason });
  setSession(conversationId, out.state);
  return out;
}

module.exports = {
  runForcedHandoffTurn,
  buildForcedHandoffFromSession,
};
