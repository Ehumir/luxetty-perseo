'use strict';

const { createInitialConversationState } = require('../types/conversationState');
const { interpretUserMessage } = require('../interpreter/minimalInterpreter');
const { applyV3StateTransition } = require('../state/stateManager');
const { composeHumanReplyText, composeHumanResponse } = require('../composer/humanComposer');
const { getSession, setSession, resetSession } = require('./sessionStore');
const { v3Log } = require('./v3Logger');
const { detectFrustration } = require('../interpreter/frustrationDetector');
const { isV3HandoffEnabled } = require('../../../config/perseoV3Flags');
const { runF3Pipeline } = require('./f3Pipeline');

/**
 * @param {{ conversationId: string, phone?: string|null, text: string, reset?: boolean }} input
 */
function processV3Turn(input) {
  const conversationId = String(input.conversationId || '');
  const text = String(input.text || '');
  const phone = input.phone != null ? String(input.phone) : null;

  if (input.reset) {
    const st0 = resetSession(conversationId, { phone });
    return {
      ok: true,
      reply: 'Listo, reiniciamos la conversación. ¿Qué necesitas revisar ahora?',
      state: st0,
      responseSource: 'v3_reset',
    };
  }

  let state = getSession(conversationId);
  if (!state) {
    state = createInitialConversationState({ conversationId, phone });
    setSession(conversationId, state);
  }

  const fr = detectFrustration(text);
  if (fr.isFrustrated) {
    v3Log('frustration_detected', { conversation_id: conversationId, level: fr.level });
  }

  const { patch, decision } = interpretUserMessage(state, text);
  v3Log('interpreter_decision', {
    conversation_id: conversationId,
    intent: decision.detectedIntent,
    confidence: decision.confidence,
    explicit_flow_switch: decision.explicitFlowSwitch,
  });

  const { state: nextState, guard } = applyV3StateTransition(state, patch, decision);
  if (!guard.allowed) {
    return {
      ok: false,
      reply: null,
      state: nextState,
      guard,
      responseSource: 'v3_rule_blocked',
      fallbackToLegacy: true,
    };
  }

  let finalState;
  let replyText;
  let responseSource = 'v3_core_f2';

  if (isV3HandoffEnabled()) {
    const f3 = runF3Pipeline({ state: nextState, decision, text });
    finalState = f3.state;
    replyText = f3.replyText;
    responseSource = 'v3_core_f3_1';
    v3Log('f3_planner', {
      conversation_id: conversationId,
      flow: f3.plannerOut?.flowKey,
      missing_slots: f3.plannerOut?.missingSlots,
      handoff_action: f3.handoffOut?.action,
      qualification_complete: finalState.qualificationComplete,
      advisor_contact_consent: finalState.advisorContactConsent,
    });
  } else {
    const composed = composeHumanResponse({ state: nextState, decision, context: {} });
    replyText = composeHumanReplyText({ state: nextState, decision, context: {} });
    const questionFromReply = (() => {
      const matches = String(replyText || '').match(/¿[^?]+\?/g);
      return matches && matches.length ? matches[matches.length - 1] : null;
    })();
    finalState = {
      ...nextState,
      lastAssistantReply: replyText,
      lastAssistantQuestion: composed.followUpQuestion || questionFromReply,
      awaitingField:
        composed.awaitingField !== undefined ? composed.awaitingField : nextState.awaitingField,
    };
  }

  setSession(conversationId, finalState);

  v3Log('composer_output', {
    conversation_id: conversationId,
    stage: finalState.conversationStage,
    goal: finalState.conversationGoal,
    reply_length: replyText.length,
    response_source: responseSource,
  });

  return {
    ok: true,
    reply: replyText,
    state: finalState,
    decision,
    guard,
    responseSource,
    fallbackToLegacy: false,
  };
}

module.exports = {
  processV3Turn,
};
