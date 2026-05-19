'use strict';

const { createInitialConversationState, mergeConversationState } = require('../types/conversationState');
const { interpretUserMessage } = require('../interpreter/minimalInterpreter');
const { applyV3StateTransition } = require('../state/stateManager');
const { composeHumanReplyText, composeHumanResponse } = require('../composer/humanComposer');
const { getSession, setSession, resetSession } = require('./sessionStore');
const { v3Log } = require('./v3Logger');
const { detectFrustration } = require('../interpreter/frustrationDetector');
const { isV3HandoffEnabled } = require('../../../config/perseoV3Flags');
const { runF3Pipeline } = require('./f3Pipeline');
const { detectForcedHandoffReason } = require('../planner/forcedHandoffDetector');
const { runForcedHandoffTurn } = require('./forcedHandoffTurn');
const { V3_INTENT } = require('../types/constants');
const { tryComposeF4EarlyTurn, shouldSuppressForcedHandoff } = require('../composer/f4TurnComposer');
const { replySignature } = require('../composer/openingVariantPicker');
const { isHandoffFlowActive } = require('../interpreter/objectionClassifier');
const {
  runPolicyCrossLayer,
  shouldShortCircuitPolicy,
  buildPolicyShortCircuitReply,
} = require('./policyCrossTurn');
const { isPolicyEngineEnabled } = require('../../../config/perseoM2Flags');

/**
 * @param {{
 *   conversationId: string,
 *   phone?: string|null,
 *   text: string,
 *   reset?: boolean,
 *   campaignHeadline?: string|null,
 *   legacyHydration?: {
 *     propertyListingCode?: string|null,
 *     locationText?: string|null,
 *     campaignHeadline?: string|null,
 *     activeProperty?: import('../types/conversationState').ConversationState['activeProperty'],
 *   }|null,
 *   logEvent?: Function,
 * }} input
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

  const h = input.legacyHydration && typeof input.legacyHydration === 'object' ? input.legacyHydration : null;

  /**
   * Inventario resuelto en `index.js` antes de V3; debe mezclarse en cada turno
   * para que PROPERTY_QA lea precio/zona/enlace reales (`activeProperty`).
   */
  function applyLegacyHydrationToSession(base) {
    if (!h) return base;
    const hyd = {};
    if (h.propertyListingCode) hyd.propertyListingCode = String(h.propertyListingCode).trim();
    if (h.locationText) hyd.locationText = String(h.locationText).trim();
    if (h.campaignHeadline) hyd.campaignHeadline = String(h.campaignHeadline).slice(0, 400);
    if (h.activeProperty && typeof h.activeProperty === 'object' && h.activeProperty.id) {
      hyd.activeProperty = h.activeProperty;
    }
    if (!Object.keys(hyd).length) return base;
    return mergeConversationState(base, hyd);
  }

  let state = getSession(conversationId);
  if (!state) {
    state = createInitialConversationState({ conversationId, phone });
    state = applyLegacyHydrationToSession(state);
    setSession(conversationId, state);
  } else {
    const merged = applyLegacyHydrationToSession(state);
    if (merged !== state) {
      state = merged;
      setSession(conversationId, state);
      v3Log('v3_inventory_hydration', {
        conversation_id: conversationId,
        has_active_property: !!(h && h.activeProperty && h.activeProperty.id),
        property_code: state.propertyListingCode || null,
      });
    }
  }

  const fr = detectFrustration(text);
  if (fr.isFrustrated) {
    v3Log('frustration_detected', { conversation_id: conversationId, level: fr.level });
  }

  const headline =
    input.campaignHeadline != null && String(input.campaignHeadline).trim()
      ? String(input.campaignHeadline).slice(0, 400)
      : state.campaignHeadline || null;

  const { patch, decision } = interpretUserMessage(state, text, { campaignHeadline: headline });
  v3Log('interpreter_decision', {
    conversation_id: conversationId,
    intent: decision.detectedIntent,
    confidence: decision.confidence,
    explicit_flow_switch: decision.explicitFlowSwitch,
  });

  const policyCrossLayer = runPolicyCrossLayer({
    state,
    decision,
    text,
    logEvent: input.logEvent,
  });
  let patchMerged = patch;
  if (policyCrossLayer?.patchFromSegments) {
    const segPatch = policyCrossLayer.patchFromSegments;
    patchMerged = {
      ...patch,
      ...segPatch,
      collectedFields: {
        ...(patch.collectedFields || {}),
        ...(segPatch.collectedFields || {}),
      },
    };
  }

  let unknownStreak = 0;
  if (decision.detectedIntent === V3_INTENT.ADVISOR_CONSENT_CAPTURE || isHandoffFlowActive(state)) {
    unknownStreak = 0;
  } else if (decision.detectedIntent === V3_INTENT.UNKNOWN) {
    unknownStreak = (Number(state.unknownIntentStreak) || 0) + 1;
  }
  const patchWithStreak = {
    ...patchMerged,
    unknownIntentStreak: unknownStreak,
    lastUserText: text,
  };

  const { state: nextState, guard } = applyV3StateTransition(state, patchWithStreak, decision);

  if (policyCrossLayer && shouldShortCircuitPolicy({ layer: policyCrossLayer, state: nextState, text })) {
    const policyReply = buildPolicyShortCircuitReply({
      layer: policyCrossLayer,
      state: nextState,
    });
    if (policyReply) {
      const policyState = {
        ...nextState,
        lastPolicyDecision: policyCrossLayer.policyResult?.decision || null,
        lastPolicyRuleId: policyCrossLayer.policyResult?.rule_id || null,
        lastSegments: policyCrossLayer.segments || null,
        lastResponsePlan: policyCrossLayer.responsePlan || null,
        lastAssistantReply: policyReply,
        lastAssistantReplySignature: replySignature(policyReply),
      };
      setSession(conversationId, policyState);
      return {
        ok: true,
        reply: policyReply,
        state: policyState,
        decision,
        guard,
        responseSource: 'v3_policy_cross',
        fallbackToLegacy: false,
        policyCrossLayer,
      };
    }
  }

  const f4Early = tryComposeF4EarlyTurn({ state: nextState, decision, text });
  if (f4Early && decision.detectedIntent !== V3_INTENT.ADVISOR_CONSENT_CAPTURE) {
    setSession(conversationId, f4Early.state);
    return {
      ok: true,
      reply: f4Early.composed.responseText,
      state: f4Early.state,
      decision,
      guard,
      responseSource: f4Early.responseSource,
      fallbackToLegacy: false,
    };
  }

  let forcedReason = detectForcedHandoffReason({
    state: nextState,
    decision,
    text,
    frustration: fr,
    guard,
  });

  if (shouldSuppressForcedHandoff(forcedReason, nextState, decision, text)) {
    forcedReason = null;
  }

  if (forcedReason) {
    const forced = runForcedHandoffTurn({ state: nextState, decision, reason: forcedReason, userText: text });
    setSession(conversationId, forced.state);
    v3Log('forced_handoff_applied', {
      conversation_id: conversationId,
      reason: forcedReason,
      stage: forced.state.conversationStage,
    });
    return {
      ok: true,
      reply: forced.replyText,
      state: forced.state,
      decision,
      guard,
      responseSource: forced.responseSource,
      fallbackToLegacy: false,
      forcedHandoffReason: forcedReason,
    };
  }

  if (!guard.allowed) {
    const forced = runForcedHandoffTurn({
      state: nextState,
      decision,
      reason: 'rule_guard_violation',
    });
    setSession(conversationId, forced.state);
    return {
      ok: true,
      reply: forced.replyText,
      state: forced.state,
      decision,
      guard,
      responseSource: forced.responseSource,
      fallbackToLegacy: false,
      forcedHandoffReason: 'rule_guard_violation',
    };
  }

  let finalState;
  let replyText;
  let responseSource = 'v3_core_f2';

  if (isV3HandoffEnabled()) {
    const f3 = runF3Pipeline({ state: nextState, decision, text });
    finalState = f3.state;
    replyText = f3.replyText;
    responseSource = f3.f4Applied ? 'v3_core_f4' : 'v3_core_f3_1';
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
      lastAssistantReplySignature: replySignature(replyText),
      lastAssistantQuestion: composed.followUpQuestion || questionFromReply,
      awaitingField:
        composed.awaitingField !== undefined ? composed.awaitingField : nextState.awaitingField,
    };
  }

  if (policyCrossLayer && isPolicyEngineEnabled()) {
    finalState = {
      ...finalState,
      lastPolicyDecision: policyCrossLayer.policyResult?.decision || null,
      lastPolicyRuleId: policyCrossLayer.policyResult?.rule_id || null,
      lastSegments: policyCrossLayer.segments || null,
      lastResponsePlan: policyCrossLayer.responsePlan || null,
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
    policyCrossLayer: policyCrossLayer || null,
  };
}

module.exports = {
  processV3Turn,
  runForcedHandoffTurn,
};
