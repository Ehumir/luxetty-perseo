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
const { maybeRunMediaIntakeV1 } = require('../media/mediaIntakeV1');
const { resolveMediaForIntake } = require('../media/mediaRealBridge');
const { runResilienceLayer } = require('../resilience/conversationalResilience');
const { applyHumanityWave2Reply, detectHumanityTone } = require('../humanity/humanityWave2');
const { isMediaRealV1Enabled } = require('../../../config/perseoM302Flags');

function finalizeAssistantTurn(state, replyText, effectiveText, decision) {
  const reply = applyHumanityWave2Reply({ state, replyText, text: effectiveText, decision });
  return {
    reply,
    state: {
      ...state,
      lastAssistantReply: reply,
      lastAssistantReplySignature: replySignature(reply),
      lastHumanityTone: detectHumanityTone(state, effectiveText),
    },
  };
}

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
 *   media?: object|null,
 * }} input
 */
function processV3Turn(input) {
  const conversationId = String(input.conversationId || '');
  const text = String(input.text || '');
  const phone = input.phone != null ? String(input.phone) : null;
  const media = input.media && typeof input.media === 'object' ? input.media : null;

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

  let resolvedMedia = input.media && typeof input.media === 'object' ? input.media : null;
  if (resolvedMedia && isMediaRealV1Enabled()) {
    resolvedMedia = resolveMediaForIntake(resolvedMedia, {
      deterministic: input.argosDeterministic === true || resolvedMedia.provider === 'argos_deterministic',
    });
  }

  const mediaIntakeResult = maybeRunMediaIntakeV1({ text, media: resolvedMedia, state });
  const effectiveText = mediaIntakeResult.logical_turn?.text ?? text;

  if (typeof input.logEvent === 'function' && mediaIntakeResult.media_intake) {
    input.logEvent('media_intake', mediaIntakeResult.media_intake);
  }
  if (mediaIntakeResult.enabled && mediaIntakeResult.media_intake) {
    v3Log('media_intake', {
      conversation_id: conversationId,
      mode: mediaIntakeResult.media_intake.mode,
      source: mediaIntakeResult.logical_turn?.source,
    });
  }

  if (mediaIntakeResult.shortCircuitReply) {
    const mediaState = mergeConversationState(state, {
      lastMediaIntake: mediaIntakeResult.media_intake,
      lastLogicalTurnSource: mediaIntakeResult.logical_turn?.source || null,
      lastUserText: effectiveText,
      lastAssistantReply: mediaIntakeResult.shortCircuitReply,
      lastAssistantReplySignature: replySignature(mediaIntakeResult.shortCircuitReply),
    });
    setSession(conversationId, mediaState);
    return {
      ok: true,
      reply: mediaIntakeResult.shortCircuitReply,
      state: mediaState,
      responseSource: 'v3_media_intake',
      fallbackToLegacy: false,
      mediaIntake: mediaIntakeResult.media_intake,
    };
  }

  const fr = detectFrustration(effectiveText);
  if (fr.isFrustrated) {
    v3Log('frustration_detected', { conversation_id: conversationId, level: fr.level });
  }

  const headline =
    input.campaignHeadline != null && String(input.campaignHeadline).trim()
      ? String(input.campaignHeadline).slice(0, 400)
      : state.campaignHeadline || null;

  const { patch, decision } = interpretUserMessage(state, effectiveText, { campaignHeadline: headline });
  v3Log('interpreter_decision', {
    conversation_id: conversationId,
    intent: decision.detectedIntent,
    confidence: decision.confidence,
    explicit_flow_switch: decision.explicitFlowSwitch,
  });

  const policyCrossLayer = runPolicyCrossLayer({
    state,
    decision,
    text: effectiveText,
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
  let patchWithStreak = {
    ...patchMerged,
    unknownIntentStreak: unknownStreak,
    lastUserText: effectiveText,
    lastMediaIntake: mediaIntakeResult.media_intake || null,
    lastLogicalTurnSource: mediaIntakeResult.logical_turn?.source || null,
  };

  const resilienceLayer = runResilienceLayer({ state, text: effectiveText, decision });
  if (resilienceLayer) {
    if (typeof input.logEvent === 'function') {
      input.logEvent('resilience_layer', {
        question_count: resilienceLayer.question_count,
        metrics: resilienceLayer.metrics,
        ambiguity: resilienceLayer.ambiguity?.resolved || false,
      });
    }
    const resPatch = resilienceLayer.patch || {};
    patchWithStreak = {
      ...patchWithStreak,
      ...resPatch,
      collectedFields: {
        ...(patchWithStreak.collectedFields || {}),
        ...(resPatch.collectedFields || {}),
      },
      entityTracker: resilienceLayer.entityTracker,
      lastResilienceMetrics: resilienceLayer.metrics,
    };
  }

  const { state: nextState, guard } = applyV3StateTransition(state, patchWithStreak, decision);

  if (policyCrossLayer && shouldShortCircuitPolicy({ layer: policyCrossLayer, state: nextState, text: effectiveText })) {
    const policyReply = buildPolicyShortCircuitReply({
      layer: policyCrossLayer,
      state: nextState,
    });
    if (policyReply) {
      const fin = finalizeAssistantTurn(nextState, policyReply, effectiveText, decision);
      const policyState = {
        ...fin.state,
        lastPolicyDecision: policyCrossLayer.policyResult?.decision || null,
        lastPolicyRuleId: policyCrossLayer.policyResult?.rule_id || null,
        lastSegments: policyCrossLayer.segments || null,
        lastResponsePlan: policyCrossLayer.responsePlan || null,
      };
      setSession(conversationId, policyState);
      return {
        ok: true,
        reply: fin.reply,
        state: policyState,
        decision,
        guard,
        responseSource: 'v3_policy_cross',
        fallbackToLegacy: false,
        policyCrossLayer,
      };
    }
  }

  const f4Early = tryComposeF4EarlyTurn({ state: nextState, decision, text: effectiveText });
  if (f4Early && decision.detectedIntent !== V3_INTENT.ADVISOR_CONSENT_CAPTURE) {
    const fin = finalizeAssistantTurn(
      f4Early.state,
      f4Early.composed.responseText,
      effectiveText,
      decision,
    );
    setSession(conversationId, fin.state);
    return {
      ok: true,
      reply: fin.reply,
      state: fin.state,
      decision,
      guard,
      responseSource: f4Early.responseSource,
      fallbackToLegacy: false,
    };
  }

  let forcedReason = detectForcedHandoffReason({
    state: nextState,
    decision,
    text: effectiveText,
    frustration: fr,
    guard,
  });

  if (shouldSuppressForcedHandoff(forcedReason, nextState, decision, effectiveText)) {
    forcedReason = null;
  }

  if (forcedReason) {
    const forced = runForcedHandoffTurn({
      state: nextState,
      decision,
      reason: forcedReason,
      userText: effectiveText,
    });
    const fin = finalizeAssistantTurn(forced.state, forced.replyText, effectiveText, decision);
    setSession(conversationId, fin.state);
    v3Log('forced_handoff_applied', {
      conversation_id: conversationId,
      reason: forcedReason,
      stage: fin.state.conversationStage,
    });
    return {
      ok: true,
      reply: fin.reply,
      state: fin.state,
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
    const f3 = runF3Pipeline({ state: nextState, decision, text: effectiveText });
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

  const fin = finalizeAssistantTurn(finalState, replyText, effectiveText, decision);
  replyText = fin.reply;
  finalState = fin.state;

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
    mediaIntake: mediaIntakeResult.media_intake || null,
    resilienceLayer: resilienceLayer || null,
  };
}

module.exports = {
  processV3Turn,
  runForcedHandoffTurn,
};
