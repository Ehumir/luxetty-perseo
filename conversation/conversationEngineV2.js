'use strict';

/**
 * PERSEO — Conversation Engine V2
 * OpenAI (orchestrator + advisor) protagonista; código valida, facts reales y CRM fuera del LLM.
 */

const { cleanSpaces, normalizeText } = require('../utils/text');
const { safeJsonStringify } = require('../utils/helpers');
const { parseQaCommand } = require('./qaCommands');
const {
  evaluateConversationWithOpenAI,
  fallbackOrchestratorDecision,
  applyDecisionToAiState,
} = require('./conversationOrchestrator');
const { detectStateChange, buildNextState } = require('./stateUpdater');
const {
  generateAdvisorReplyForRealEstateTurn,
  mapConversationDbRowsToChatMessages,
  buildSyntheticStateForAdvisor,
} = require('./realEstateAdvisorReply');
const { appendNameRequestIfNeeded, hasValidHumanName } = require('./namePrompt');
const contextualMemoryResolver = require('./contextualMemoryResolver');
const { mergeSignalsWithMulti, extractMultiSignals } = require('./multiSignalExtractor');
const antiLoopGuardrails = require('./antiLoopGuardrails');
const { OPENAI_MODEL } = require('../config/env');

function isEngineV2Enabled() {
  return String(process.env.PERSEO_ENGINE_V2 || '').toLowerCase() === 'true';
}

function logEngine(logger, payload) {
  const fn = logger && typeof logger.info === 'function' ? logger.info.bind(logger) : console.info;
  fn('perseo_engine_v2', safeJsonStringify(payload));
}

/**
 * Hard exclusions: QA, multimedia sin análisis útil, spam señalado por parser.
 */
function shouldUseConversationEngineV2(input = {}) {
  if (!isEngineV2Enabled()) return false;
  const text = cleanSpaces(String(input.text ?? ''));
  if (!text) return false;
  if (parseQaCommand(text)) return false;

  const sig = input.parsedSignals && typeof input.parsedSignals === 'object' ? input.parsedSignals : {};
  if (sig.non_real_estate || sig.spam_signal || sig.spam_detected) return false;
  if (sig.low_info_campaign_message && !sig.lead_flow) return false;

  const media = input.inboundContext?.media && typeof input.inboundContext.media === 'object' ? input.inboundContext.media : {};
  if (media.attachment_detected_not_processed || media.unsupported_media) {
    if (!text || text.length < 2) return false;
  }

  return true;
}

function buildEngineFacts(input = {}) {
  const props = Array.isArray(input.propertiesContext?.matchedProperties)
    ? input.propertiesContext.matchedProperties
    : [];
  return {
    property: props[0] || null,
    properties: props,
    contact: input.contact && typeof input.contact === 'object' ? input.contact : null,
    lead: input.lead && typeof input.lead === 'object' ? input.lead : null,
    campaign: input.campaignContext && typeof input.campaignContext === 'object' ? input.campaignContext : null,
  };
}

function buildEngineAdvisorContext(input = {}) {
  const orch = input.orchestratorDecision && typeof input.orchestratorDecision === 'object' ? input.orchestratorDecision : {};
  const facts = buildEngineFacts(input);
  const sig = input.parsedSignals && typeof input.parsedSignals === 'object' ? { ...input.parsedSignals } : {};
  sig.orchestrator_decision = orch;
  sig.conversation_engine_v2 = true;
  return {
    user_message: cleanSpaces(String(input.text ?? '')),
    ai_state: input.nextAiState && typeof input.nextAiState === 'object' ? input.nextAiState : {},
    signals: sig,
    contact: facts.contact,
    suggested_properties: facts.properties || [],
    last_suggested_property: facts.property || null,
    campaign_context: facts.campaign,
    media_context: {
      requires_programmed_safety: !!(
        input.inboundContext?.media?.attachment_detected_not_processed ||
        input.inboundContext?.media?.unsupported_media
      ),
      image_analysis_available: !!input.inboundContext?.media?.image_vision_success,
      audio_transcription_available: !!input.inboundContext?.media?.audio_has_transcription,
      document_analysis_available: false,
    },
    recent_db_messages: Array.isArray(input.recentMessages) ? input.recentMessages : [],
    conversation_id: input.conversationId ?? null,
    change_type: input.changeType ?? 'minor_update',
  };
}

function validateEngineOutput(output) {
  const o = output && typeof output === 'object' ? output : {};
  if (typeof o.reply !== 'string' && !Array.isArray(o.reply)) return { ok: false, reason: 'missing_reply' };
  const r = typeof o.reply === 'string' ? cleanSpaces(o.reply) : o.reply;
  if (!r || (Array.isArray(r) && !r.length)) return { ok: false, reason: 'empty_reply' };
  if (!o.nextAiState || typeof o.nextAiState !== 'object') return { ok: false, reason: 'missing_next_ai_state' };
  return { ok: true };
}

function buildSafeEngineFallback(input = {}) {
  const text = cleanSpaces(String(input.text ?? ''));
  const prev = input.previousAiState && typeof input.previousAiState === 'object' ? input.previousAiState : {};
  const sig = input.parsedSignals && typeof input.parsedSignals === 'object' ? input.parsedSignals : {};
  const loc = sig.location_text || prev.location_text || '';
  const hasName = !!(sig.full_name || prev.full_name);

  if (sig.lead_flow === 'demand' && (sig.location_text || sig.location_any) && !hasName && !sig.budget_max) {
    const locBit = loc ? ` en ${loc}` : '';
    return `Hola, claro. Te puedo ayudar a buscar casa${locBit}. Para registrarte bien, ¿me compartes tu nombre?`;
  }
  if (hasName && (sig.location_text || prev.location_text) && !sig.budget_max && prev.awaiting_field !== 'budget_max') {
    const n = sig.full_name || prev.full_name;
    const l = sig.location_text || prev.location_text || '';
    return `Gracias, ${n}. ¿Qué presupuesto aproximado tienes para la casa en ${l}?`;
  }
  if (sig.budget_max != null && hasName && (sig.location_text || prev.location_text)) {
    const n = sig.full_name || prev.full_name;
    const l = sig.location_text || prev.location_text || '';
    const b = Number(sig.budget_max);
    const cur = sig.budget_currency === 'USD' ? 'USD' : 'MXN';
    return `Perfecto, ${n}. Con ${cur === 'USD' ? '$' : '$'}${b.toLocaleString('es-MX')} podemos revisar opciones en ${l}. Déjame buscar alternativas reales y te comparto lo más alineado.`;
  }
  if (sig.complaint_followup) {
    return 'Tienes razón, lamento la experiencia. Para canalizarlo bien con un asesor, ¿me confirmas tu nombre y el mejor horario para contactarte?';
  }
  return 'Te apoyo con gusto. Para orientarte sin inventar datos, dime en una frase qué buscas o qué necesitas resolver.';
}

function mergeCapturedIntoSignals(signals, orch) {
  const out = { ...(signals && typeof signals === 'object' ? signals : {}) };
  const cf = orch?.captured_fields && typeof orch.captured_fields === 'object' ? orch.captured_fields : {};
  if (cf.full_name) out.full_name = cf.full_name;
  if (cf.location_text) out.location_text = cf.location_text;
  if (cf.budget_max != null) out.budget_max = cf.budget_max;
  if (cf.budget_currency) out.budget_currency = cf.budget_currency;
  if (cf.property_code) {
    out.property_code = cf.property_code;
    out.direct_property_reference = true;
  }
  if (cf.owner_relation != null) out.owner_relation = cf.owner_relation;
  if (cf.property_type) out.property_type = cf.property_type;
  if (orch?.lead_flow) out.lead_flow = orch.lead_flow;
  if (orch?.operation_type) out.operation_type = orch.operation_type;
  return out;
}

function applyOrchestratorToAwaitingField(nextAiState, orch) {
  const g = orch?.reply_strategy?.goal;
  if (g === 'capture_name' && orch?.reply_strategy?.must_ask_name) {
    nextAiState.awaiting_field = 'full_name';
  } else if (g === 'qualify_demand' && nextAiState.full_name && nextAiState.budget_max == null) {
    nextAiState.awaiting_field = 'budget_max';
  }
}

function buildCrmActionsFromOrchestrator(orch, nextAiState, contact) {
  const crm = orch?.crm_recommendation && typeof orch.crm_recommendation === 'object' ? orch.crm_recommendation : {};
  const hasName = !!(nextAiState.full_name || (contact && hasValidHumanName(contact, nextAiState)));
  return {
    shouldEnsureContact: !!(crm.should_create_or_update_contact || hasName),
    shouldCreateOrReuseLead: !!crm.should_create_or_update_lead,
    reason: crm.lead_reason || null,
    capturedFields: orch?.captured_fields || {},
  };
}

function buildPropertyActionsFromOrchestrator(orch, nextAiState) {
  const pa = orch?.property_action && typeof orch.property_action === 'object' ? orch.property_action : {};
  return {
    shouldSearchProperties: !!pa.should_search_properties,
    shouldFetchProperty: !!pa.should_fetch_property,
    propertyCode: pa.property_code || nextAiState.property_code || null,
    searchFilters: {
      operation_type: nextAiState.operation_type,
      location_text: nextAiState.location_text,
      budget_max: nextAiState.budget_max,
      budget_currency: nextAiState.budget_currency,
    },
  };
}

/**
 * Procesa un turno conversacional V2: orquestador → estado → facts → advisor → fallback seguro.
 * @param {object} input
 * @param {{ generateAdvisorReplyFn?: function }} [options]
 */
async function processConversationTurnV2(input = {}, options = {}) {
  const logger = input.logger || console;
  const logs = [];
  const pushLog = (k, v) => {
    logs.push({ k, v, t: new Date().toISOString() });
  };

  pushLog('engine_v2_enabled', true);

  const text = cleanSpaces(String(input.text ?? ''));
  const previousAiState = input.previousAiState && typeof input.previousAiState === 'object' ? input.previousAiState : {};
  let incomingSignals = input.parsedSignals && typeof input.parsedSignals === 'object' ? input.parsedSignals : {};
  incomingSignals = mergeSignalsWithMulti(incomingSignals, extractMultiSignals(text, previousAiState));
  const propertyIntentResolver = require('./propertyIntentResolver');
  Object.assign(incomingSignals, propertyIntentResolver.resolvePropertyIntent(text, previousAiState));

  const orchContext = {
    text,
    previousAiState,
    incomingSignals,
    inboundContext: input.inboundContext || {},
    contact: input.contact || null,
    campaignContext: input.campaignContext || null,
  };

  let orchestratorDecision;
  let orchestratorCalled = false;
  try {
    if (process.env.PERSEO_CONVERSATION_ORCHESTRATOR_MODE === 'fallback_only') {
      orchestratorDecision = fallbackOrchestratorDecision(orchContext);
    } else {
      orchestratorCalled = true;
      orchestratorDecision = await evaluateConversationWithOpenAI(orchContext, {
        openaiClient: input.openaiClient,
        model: input.openaiModel,
      });
    }
  } catch (e) {
    orchestratorDecision = fallbackOrchestratorDecision(orchContext);
    pushLog('orchestrator_error', String(e?.message || e));
  }

  pushLog('orchestrator_called', orchestratorCalled);
  pushLog('orchestrator_decision', orchestratorDecision);

  if (orchestratorDecision?.safety?.requires_programmed_reply) {
    const mergedSig0 = mergeCapturedIntoSignals(incomingSignals, orchestratorDecision);
    const changeType0 = detectStateChange(previousAiState, mergedSig0);
    let nextAiState0 = buildNextState(previousAiState, mergedSig0, changeType0);
    nextAiState0 = applyDecisionToAiState(orchestratorDecision, nextAiState0);
    applyOrchestratorToAwaitingField(nextAiState0, orchestratorDecision);
    Object.assign(nextAiState0, contextualMemoryResolver.mergeContextualSignals(mergedSig0, previousAiState, nextAiState0, text));
    let reply0 = buildSafeEngineFallback({
      ...input,
      parsedSignals: mergedSig0,
      previousAiState: nextAiState0,
      orchestratorDecision,
    });
    const sub0 = contextualMemoryResolver.substituteForbiddenGenericDemandReply(reply0, {
      text,
      aiState: nextAiState0,
      hasValidName: hasValidHumanName(input.contact, nextAiState0),
      matchedProperties: [],
      recentMessages: input.recentMessages || [],
      contact: input.contact || null,
      waProfileName: input.waProfileDisplayName || null,
    });
    Object.assign(nextAiState0, sub0.statePatch);
    reply0 = sub0.messages;
    if (cleanSpaces(String(nextAiState0.full_name || '')) && nextAiState0.awaiting_field === 'full_name') {
      nextAiState0.awaiting_field = null;
    }
    logEngine(logger, {
      engine_v2_used: true,
      orchestrator_called: orchestratorCalled,
      orchestrator_decision: orchestratorDecision,
      advisor_called: false,
      response_source: 'engine_v2_programmed_safety',
      reply_strategy: orchestratorDecision?.reply_strategy,
      fallback_used: true,
      fallback_reason: orchestratorDecision?.safety?.reason || 'safety',
    });
    return {
      reply: reply0,
      outboundMessages: reply0,
      nextAiState: nextAiState0,
      crmActions: buildCrmActionsFromOrchestrator(orchestratorDecision, nextAiState0, input.contact),
      propertyActions: buildPropertyActionsFromOrchestrator(orchestratorDecision, nextAiState0),
      facts: buildEngineFacts({ ...input, propertiesContext: { matchedProperties: [] } }),
      responseSource: 'engine_v2_programmed_safety',
      advisorCalled: false,
      orchestratorDecision,
      logs,
      safetyFlags: orchestratorDecision?.safety?.forbidden_claims || [],
    };
  }

  incomingSignals = mergeCapturedIntoSignals(incomingSignals, orchestratorDecision);

  const changeType = detectStateChange(previousAiState, incomingSignals);
  let nextAiState = buildNextState(previousAiState, incomingSignals, changeType);
  nextAiState = applyDecisionToAiState(orchestratorDecision, nextAiState);
  applyOrchestratorToAwaitingField(nextAiState, orchestratorDecision);
  Object.assign(nextAiState, contextualMemoryResolver.mergeContextualSignals(incomingSignals, previousAiState, nextAiState, text));

  const inboundFrustration = antiLoopGuardrails.detectConversationalFrustration(text);
  Object.assign(
    nextAiState,
    antiLoopGuardrails.buildStaleAwaitingFieldPatch(nextAiState, incomingSignals, text, input.contact || null)
  );

  /** Propiedad explícita */
  let matchedProperties = Array.isArray(input.propertiesContext?.matchedProperties)
    ? [...input.propertiesContext.matchedProperties]
    : [];
  if (
    orchestratorDecision?.property_action?.should_fetch_property &&
    typeof input.getPropertyByCode === 'function'
  ) {
    const code = orchestratorDecision.property_action.property_code || nextAiState.property_code;
    if (code) {
      try {
        const p = await input.getPropertyByCode(code);
        if (p) matchedProperties = [p];
      } catch (e) {
        pushLog('fetch_property_error', String(e?.message || e));
      }
    }
  }

  if (
    orchestratorDecision?.property_action?.should_search_properties &&
    typeof input.searchPropertiesWithFallbacks === 'function'
  ) {
    try {
      const res = await input.searchPropertiesWithFallbacks(nextAiState);
      if (res?.properties?.length) matchedProperties = res.properties;
    } catch (e) {
      pushLog('search_properties_error', String(e?.message || e));
    }
  }

  const facts = buildEngineFacts({ ...input, propertiesContext: { matchedProperties } });

  const advisorGen =
    typeof options.generateAdvisorReplyFn === 'function'
      ? options.generateAdvisorReplyFn
      : (ctx, opts) => generateAdvisorReplyForRealEstateTurn(ctx, opts);

  const chatRecent = mapConversationDbRowsToChatMessages(input.recentMessages || []);
  const synth = buildSyntheticStateForAdvisor(nextAiState, matchedProperties);

  const advisorCtx = {
    user_message: text,
    recent_messages: chatRecent,
    recent_db_messages_for_card_check: input.recentMessages || [],
    current_lead_flow: nextAiState.lead_flow,
    synthetic_state: synth,
    signals: {
      ...incomingSignals,
      orchestrator_decision: orchestratorDecision,
      conversation_engine_v2: true,
    },
    contact: input.contact || null,
    campaign_context: input.campaignContext || null,
    media_context: {
      requires_programmed_safety: !!(
        input.inboundContext?.media?.attachment_detected_not_processed ||
        input.inboundContext?.media?.unsupported_media
      ),
      image_analysis_available: !!input.inboundContext?.media?.image_vision_success,
      audio_transcription_available: !!input.inboundContext?.media?.audio_has_transcription,
      document_analysis_available: false,
    },
    last_suggested_property: matchedProperties[0] || null,
    suggested_properties: matchedProperties,
    draft_context: null,
    budget: nextAiState.budget_max,
    budget_currency: nextAiState.budget_currency,
    zone: nextAiState.location_text || '',
    operation: nextAiState.operation_type,
    missing_name: !hasValidHumanName(input.contact, nextAiState),
    next_step: nextAiState.next_step || null,
    follow_up_reason: 'engine_v2',
    change_type: input.changeType || 'minor_update',
    conversation_id: input.conversationId,
  };

  let reply;
  let advisorCalled = false;
  let responseSource = 'engine_v2_advisor';
  let fallbackUsed = false;
  let fallbackReason = null;

  try {
    advisorCalled = true;
    const advisory = await advisorGen(advisorCtx, { model: input.openaiModel || OPENAI_MODEL });
    reply = advisory.text;
  } catch (e) {
    fallbackUsed = true;
    fallbackReason = String(e?.message || e);
    reply = buildSafeEngineFallback({
      ...input,
      parsedSignals: incomingSignals,
      previousAiState: nextAiState,
      orchestratorDecision,
    });
    responseSource = 'engine_v2_safe_fallback';
  }

  if (!reply || !cleanSpaces(String(reply))) {
    fallbackUsed = true;
    fallbackReason = fallbackReason || 'empty_advisor';
    reply = buildSafeEngineFallback({
      ...input,
      parsedSignals: incomingSignals,
      previousAiState: nextAiState,
      orchestratorDecision,
    });
    responseSource = 'engine_v2_safe_fallback';
  }

  const skipNameAppend = orchestratorDecision?.reply_strategy?.goal === 'capture_name';

  let outboundMessages = reply;
  if (
    input.conversationId &&
    input.skipNameAppend !== true &&
    !skipNameAppend &&
    !inboundFrustration.frustrated
  ) {
    const nameAppendMode =
      nextAiState.lead_flow === 'demand' &&
      cleanSpaces(String(nextAiState.location_text || '')) &&
      nextAiState.budget_max != null &&
      Number.isFinite(Number(nextAiState.budget_max)) &&
      !hasValidHumanName(input.contact, nextAiState)
        ? 'name_only'
        : 'default';

    const namePack = appendNameRequestIfNeeded(reply, {
      contact: input.contact || null,
      aiState: nextAiState,
      waProfileDisplayName: input.waProfileDisplayName || null,
      userInboundText: text,
      leadFlow: nextAiState.lead_flow,
      wantsVisit: !!nextAiState.wants_visit,
      nameAppendMode,
    });
    outboundMessages = namePack.messages;
    if (namePack.statePatch && typeof namePack.statePatch === 'object') {
      Object.assign(nextAiState, namePack.statePatch);
    }
    if (namePack.setAwaitingFullName) {
      nextAiState.awaiting_field = 'full_name';
    }
  }

  const subReply = contextualMemoryResolver.substituteForbiddenGenericDemandReply(outboundMessages, {
    text,
    aiState: nextAiState,
    hasValidName: hasValidHumanName(input.contact, nextAiState),
    matchedProperties,
    recentMessages: input.recentMessages || [],
    contact: input.contact || null,
    waProfileName: input.waProfileDisplayName || null,
  });
  Object.assign(nextAiState, subReply.statePatch);
  outboundMessages = subReply.messages;

  if (cleanSpaces(String(nextAiState.full_name || '')) && nextAiState.awaiting_field === 'full_name') {
    nextAiState.awaiting_field = null;
  }

  const crmActions = buildCrmActionsFromOrchestrator(orchestratorDecision, nextAiState, input.contact);
  const propertyActions = buildPropertyActionsFromOrchestrator(orchestratorDecision, nextAiState);

  logEngine(logger, {
    engine_v2_used: true,
    engine_v2_enabled: true,
    orchestrator_called: orchestratorCalled,
    orchestrator_decision: orchestratorDecision,
    advisor_called: advisorCalled,
    response_source: responseSource,
    reply_strategy: orchestratorDecision?.reply_strategy,
    captured_fields: orchestratorDecision?.captured_fields,
    crm_actions_recommended: crmActions,
    property_actions_recommended: propertyActions,
    early_return_blocked: 'templates_skipped',
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
  });

  const out = {
    reply: outboundMessages,
    outboundMessages,
    nextAiState,
    crmActions,
    propertyActions,
    facts,
    responseSource,
    advisorCalled,
    orchestratorDecision,
    logs,
    safetyFlags: orchestratorDecision?.safety?.forbidden_claims || [],
  };

  const v = validateEngineOutput(out);
  if (!v.ok) {
    out.reply = buildSafeEngineFallback({ ...input, parsedSignals: incomingSignals, previousAiState: nextAiState });
    out.outboundMessages = out.reply;
    out.responseSource = 'engine_v2_validate_fallback';
  }

  const subValidate = contextualMemoryResolver.substituteForbiddenGenericDemandReply(out.outboundMessages, {
    text,
    aiState: out.nextAiState,
    hasValidName: hasValidHumanName(input.contact, out.nextAiState),
    matchedProperties,
    recentMessages: input.recentMessages || [],
    contact: input.contact || null,
    waProfileName: input.waProfileDisplayName || null,
  });
  Object.assign(out.nextAiState, subValidate.statePatch);
  out.outboundMessages = subValidate.messages;
  out.reply = subValidate.messages;

  const recentOutboundTextsV2 = Array.isArray(input.recentMessages)
    ? input.recentMessages
        .filter((r) => r?.direction === 'outbound')
        .map((r) => String(r?.message_text || ''))
        .filter(Boolean)
    : [];
  const nearDupV2 = antiLoopGuardrails.applyOutboundNearDuplicateGuard(out.outboundMessages, {
    recentOutboundTexts: recentOutboundTextsV2,
    userInboundText: text,
    nextAiState: out.nextAiState,
  });
  out.outboundMessages = nearDupV2.reply;
  out.reply = nearDupV2.reply;
  Object.assign(out.nextAiState, nearDupV2.patch);
  antiLoopGuardrails.recordTurnAntiLoopMeta(out.nextAiState, out.outboundMessages, out.responseSource);

  return out;
}

module.exports = {
  processConversationTurnV2,
  shouldUseConversationEngineV2,
  buildEngineFacts,
  buildEngineAdvisorContext,
  validateEngineOutput,
  buildSafeEngineFallback,
  isEngineV2Enabled,
};
