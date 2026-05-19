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
const {
  isMediaRuntimeProductionEnabled,
} = require('../../../config/perseoM401Flags');
const { runUnderstandingRuntime } = require('../runtime/understandingRuntime');
const { runResilienceRuntime } = require('../runtime/resilienceRuntime');
const { recordOperationalEvent, buildTelemetryFromTurn } = require('../runtime/waTelemetry');

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

function applyM4RuntimeFinishing(state, { effectiveText, replyText, decision, resolvedMedia, input }) {
  let next = state;
  const resilienceRuntime = runResilienceRuntime({
    state: next,
    text: effectiveText,
    replyText,
  });
  if (resilienceRuntime?.patch) {
    next = { ...next, ...resilienceRuntime.patch };
    if (typeof input.logEvent === 'function') {
      input.logEvent('resilience_runtime', resilienceRuntime.metrics || {});
    }
  }
  const telemetryResult = recordOperationalEvent(
    input.supabase || null,
    buildTelemetryFromTurn({
      state: next,
      decision,
      mediaResult: resolvedMedia,
      crmResult: null,
    }),
    input.logEvent,
    { argosMode: input.argosMode === true, crmDryRun: true },
  );
  next = {
    ...next,
    lastTelemetryRecorded: telemetryResult.recorded === true,
    lastTelemetryMode: telemetryResult.mode || 'disabled',
  };
  return { state: next, resilienceRuntime, telemetryResult };
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
 *   recentMessages?: string[],
 *   supabase?: object|null,
 *   argosMode?: boolean,
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
  const mediaRealOn = isMediaRealV1Enabled() || isMediaRuntimeProductionEnabled();
  if (resolvedMedia && mediaRealOn) {
    resolvedMedia = resolveMediaForIntake(resolvedMedia, {
      deterministic:
        input.argosDeterministic === true ||
        input.argosMode === true ||
        resolvedMedia.provider === 'argos_deterministic',
    });
    if (resolvedMedia && !resolvedMedia.provider) {
      resolvedMedia = { ...resolvedMedia, provider: isMediaRuntimeProductionEnabled() ? 'runtime' : 'bridge' };
    }
  }

  const mediaIntakeResult = maybeRunMediaIntakeV1({ text, media: resolvedMedia, state });
  let effectiveText = mediaIntakeResult.logical_turn?.text ?? text;

  const understandingRuntime = runUnderstandingRuntime({
    state,
    inboundText: text,
    recentMessages: input.recentMessages || [effectiveText],
    decision: {},
  });
  if (understandingRuntime?.patch) {
    state = mergeConversationState(state, understandingRuntime.patch);
    setSession(conversationId, state);
    if (understandingRuntime.patch.lastFusedUserText) {
      effectiveText = understandingRuntime.patch.lastFusedUserText;
    }
    if (typeof input.logEvent === 'function') {
      input.logEvent('understanding_runtime', understandingRuntime.metrics || {});
    }
  }

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
    const mediaFin = applyM4RuntimeFinishing(mediaState, {
      effectiveText,
      replyText: mediaIntakeResult.shortCircuitReply,
      decision: {},
      resolvedMedia,
      input,
    });
    setSession(conversationId, mediaFin.state);
    return {
      ok: true,
      reply: mediaIntakeResult.shortCircuitReply,
      state: mediaFin.state,
      responseSource: 'v3_media_intake',
      fallbackToLegacy: false,
      mediaIntake: mediaIntakeResult.media_intake,
      resilienceRuntime: mediaFin.resilienceRuntime,
      telemetryResult: mediaFin.telemetryResult,
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
      let policyState = {
        ...fin.state,
        lastPolicyDecision: policyCrossLayer.policyResult?.decision || null,
        lastPolicyRuleId: policyCrossLayer.policyResult?.rule_id || null,
        lastPolicyRuntimeApplied: policyCrossLayer.policyResult?.policy_runtime_applied === true,
        lastPolicyRuntimeRuleId: policyCrossLayer.policyResult?.policy_runtime_rule_id || null,
        lastSegments: policyCrossLayer.segments || null,
        lastResponsePlan: policyCrossLayer.responsePlan || null,
      };
      const policyFin = applyM4RuntimeFinishing(policyState, {
        effectiveText,
        replyText: fin.reply,
        decision,
        resolvedMedia,
        input,
      });
      policyState = policyFin.state;
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
        resilienceRuntime: policyFin.resilienceRuntime,
        telemetryResult: policyFin.telemetryResult,
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
    const f4Fin = applyM4RuntimeFinishing(fin.state, {
      effectiveText,
      replyText: fin.reply,
      decision,
      resolvedMedia,
      input,
    });
    setSession(conversationId, f4Fin.state);
    return {
      ok: true,
      reply: fin.reply,
      state: f4Fin.state,
      decision,
      guard,
      responseSource: f4Early.responseSource,
      fallbackToLegacy: false,
      resilienceRuntime: f4Fin.resilienceRuntime,
      telemetryResult: f4Fin.telemetryResult,
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
    const forcedFin = applyM4RuntimeFinishing(fin.state, {
      effectiveText,
      replyText: fin.reply,
      decision,
      resolvedMedia,
      input,
    });
    setSession(conversationId, forcedFin.state);
    v3Log('forced_handoff_applied', {
      conversation_id: conversationId,
      reason: forcedReason,
      stage: forcedFin.state.conversationStage,
    });
    return {
      ok: true,
      reply: fin.reply,
      state: forcedFin.state,
      decision,
      guard,
      responseSource: forced.responseSource,
      fallbackToLegacy: false,
      forcedHandoffReason: forcedReason,
      resilienceRuntime: forcedFin.resilienceRuntime,
      telemetryResult: forcedFin.telemetryResult,
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
        lastPolicyRuntimeApplied: policyCrossLayer.policyResult?.policy_runtime_applied === true,
        lastPolicyRuntimeRuleId: policyCrossLayer.policyResult?.policy_runtime_rule_id || null,
        lastSegments: policyCrossLayer.segments || null,
        lastResponsePlan: policyCrossLayer.responsePlan || null,
      };
  }

  const fin = finalizeAssistantTurn(finalState, replyText, effectiveText, decision);
  replyText = fin.reply;
  finalState = fin.state;

  const m4Fin = applyM4RuntimeFinishing(finalState, {
    effectiveText,
    replyText,
    decision,
    resolvedMedia,
    input,
  });
  finalState = m4Fin.state;
  const resilienceRuntime = m4Fin.resilienceRuntime;
  const telemetryResult = m4Fin.telemetryResult;

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
    understandingRuntime: understandingRuntime || null,
    resilienceRuntime: resilienceRuntime || null,
    telemetryResult,
  };
}

module.exports = {
  processV3Turn,
  runForcedHandoffTurn,
};
