'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { safeJsonStringify } = require('../utils/helpers');
const { formatMoney, formatPropertyShort } = require('../utils/formatting');
const {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
} = require('./perseoConsultantPrompt');
const { openai } = require('../services/openaiService');
const {
  normalizeRecentMessagesForAdvisor,
  buildAdvisorResponseDraftContext,
  classifyShortRealEstateFollowUp,
} = require('./advisorDraftContext');
const { getPublicPropertyUrl } = require('../utils/helpers');
const { getAdvisorFailureFallbackReply } = require('./routeEvaluator');

const GENERIC_PLAYBOOK_SNIPPET = normalizeText(
  'Con esa información puedo orientarte mejor. ¿Prefieres ver opciones disponibles o que un asesor de Luxetty te contacte?'
);

/** Delega en advisorDraftContext para una sola fuente de verdad (PR1 draft layer). */
function mapConversationDbRowsToChatMessages(rows = []) {
  return normalizeRecentMessagesForAdvisor(rows).map(({ role, content }) => ({ role, content }));
}

function getLastOutboundTextFromDbRows(rows = []) {
  if (!Array.isArray(rows)) return '';
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]?.direction === 'outbound') return String(rows[i].message_text || '').trim();
  }
  return '';
}

/**
 * Seguimiento consultivo (PR3: delega en classifyShortRealEstateFollowUp).
 */
function detectRealEstateConsultativeFollowUp(text, leadFlow) {
  const hit = classifyShortRealEstateFollowUp(text, leadFlow);
  return hit ? { reason: hit.reason, leadFlow } : null;
}

function hasRealEstateAdvisorTurnContext(state = {}, matchedProperties = []) {
  if (!state || (state.lead_flow !== 'demand' && state.lead_flow !== 'offer')) return false;
  if (!state.operation_type) return false;

  const hasLoc = !!(state.location_text || state.location_any);
  const hasBudget = state.budget_max != null;
  const hasProps = Array.isArray(matchedProperties) && matchedProperties.length > 0;
  const hadPriorSearch =
    Number(state.last_search_result_count || 0) > 0 ||
    (Array.isArray(state.last_shown_property_ids) && state.last_shown_property_ids.length > 0);

  if (state.lead_flow === 'demand') {
    return hasLoc && hasBudget && (hasProps || hadPriorSearch);
  }

  // Oferta: zona mínima para no disparar en leads vacíos
  return !!state.location_text;
}

function mergeReplyToString(reply) {
  if (Array.isArray(reply)) return reply.map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
  return cleanSpaces(String(reply || ''));
}

function normalizeForSimilarity(s) {
  return normalizeText(String(s || ''))
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9áéíóúñü]+/gi, ' ')
    .trim();
}

function tokenJaccardSimilarity(a, b) {
  const ta = normalizeForSimilarity(a)
    .split(' ')
    .filter((x) => x.length > 2);
  const tb = normalizeForSimilarity(b)
    .split(' ')
    .filter((x) => x.length > 2);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union ? inter / union : 0;
}

function isCandidateTooSimilarToLastOutbound(candidateReply, lastOutboundText) {
  const a = normalizeForSimilarity(mergeReplyToString(candidateReply));
  const b = normalizeForSimilarity(lastOutboundText);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 40 && b.length >= 40 && (a.includes(b) || b.includes(a))) return true;
  if (GENERIC_PLAYBOOK_SNIPPET && a.includes(GENERIC_PLAYBOOK_SNIPPET) && b.includes(GENERIC_PLAYBOOK_SNIPPET)) return true;
  if (a.length >= 28 && b.length >= 28 && tokenJaccardSimilarity(a, b) >= 0.72) return true;
  return false;
}

const ADVISOR_ALLOWED_RESPONSE_GOALS = new Set([
  'qualify_demand',
  'qualify_demand_and_capture_name',
  'qualify_offer',
  'property_followup',
  'more_options',
  'price_followup',
  'location_followup',
  'visit_intent',
  'link_or_publication',
  'valuation_soft',
]);

/**
 * PR2 — enrutamiento hacia OpenAI Advisor sin side-effects.
 * @param {Record<string, unknown>} params
 * @returns {{ use: boolean, reason: string, draft?: object }}
 */
function shouldUseAdvisorForRealEstateTurn(params = {}) {
  const aiState = params.ai_state && typeof params.ai_state === 'object' ? params.ai_state : {};
  const signals = params.signals && typeof params.signals === 'object' ? params.signals : {};
  const contact = params.contact && typeof params.contact === 'object' ? params.contact : null;
  const userMessage = cleanSpaces(String(params.user_message ?? params.text ?? ''));
  const matched = Array.isArray(params.suggested_properties) ? params.suggested_properties : [];
  const campaignContext =
    params.campaign_context && typeof params.campaign_context === 'object' ? params.campaign_context : null;
  const mediaContext =
    params.media_context && typeof params.media_context === 'object' ? params.media_context : {};
  const recentDb = Array.isArray(params.recent_db_messages) ? params.recent_db_messages : [];

  if (params.skip_advisor_for_literal_property_price) {
    return { use: false, reason: 'literal_property_price_programmed' };
  }
  if (signals.qa_command || signals.is_qa_command || params.qa_command_active) {
    return { use: false, reason: 'qa_programmed' };
  }
  if (signals.non_real_estate || signals.spam_signal) {
    return { use: false, reason: 'non_real_estate_or_spam' };
  }
  if (mediaContext.requires_programmed_safety) {
    return { use: false, reason: 'multimedia_safety_programmed' };
  }
  if (aiState.handoff_sent) {
    return { use: false, reason: 'handoff_already_sent' };
  }

  const draft = buildAdvisorResponseDraftContext({
    user_message: userMessage,
    ai_state: aiState,
    signals,
    contact,
    suggested_properties: matched,
    last_suggested_property: params.last_suggested_property || matched[0] || null,
    campaign_context: campaignContext,
    media_context: mediaContext,
    recent_db_messages: recentDb,
    conversation_id: params.conversation_id,
    change_type: params.change_type,
  });

  const orchFull = signals.orchestrator_decision;
  if (
    signals.conversation_engine_v2 &&
    orchFull &&
    typeof orchFull === 'object' &&
    orchFull.reply_strategy?.source === 'advisor' &&
    !orchFull.safety?.requires_programmed_reply
  ) {
    return { use: true, reason: 'conversation_engine_v2', draft };
  }

  const routeD =
    params.route_evaluator_decision && typeof params.route_evaluator_decision === 'object'
      ? params.route_evaluator_decision
      : aiState.route_evaluator_decision && typeof aiState.route_evaluator_decision === 'object'
      ? aiState.route_evaluator_decision
      : null;

  if (routeD && routeD.should_use_programmed_reply && !routeD.should_use_advisor_reply) {
    return { use: false, reason: 'route_evaluator_programmed', draft };
  }

  const mode = draft.advisor_mode;
  const goal = draft.response_goal;

  if (mode === 'qa_programmed' || mode === 'safety_programmed') {
    return { use: false, reason: `advisor_mode_${mode}`, draft };
  }
  if (!ADVISOR_ALLOWED_RESPONSE_GOALS.has(goal)) {
    return { use: false, reason: `response_goal_${goal || 'unknown'}`, draft };
  }

  const hasFollowUpPattern =
    detectRealEstateConsultativeFollowUp(userMessage, aiState.lead_flow) != null;
  const hasHydratedContext = hasRealEstateAdvisorTurnContext(aiState, matched);

  const pc = draft.property_context;
  const hasMinimalDemand =
    aiState.lead_flow === 'demand' &&
    pc &&
    !!pc.operation_type &&
    (!!pc.location_text || !!pc.location_any);

  const hasCampaign = campaignContext && Object.keys(campaignContext).length > 0;
  const hasSuggested = matched.length > 0 || !!draft.last_suggested_property;

  const hasOfferValuation =
    aiState.lead_flow === 'offer' &&
    (goal === 'valuation_soft' || !!signals.asks_only_valuation || !!aiState.asks_only_valuation);

  const offerOrValuationFromText =
    (goal === 'qualify_offer' || goal === 'valuation_soft') && userMessage.length > 0;

  let contextOk =
    hasHydratedContext ||
    hasFollowUpPattern ||
    (hasMinimalDemand &&
      (goal === 'qualify_demand' ||
        goal === 'qualify_demand_and_capture_name' ||
        goal === 'price_followup' ||
        goal === 'location_followup')) ||
    hasCampaign ||
    (hasSuggested && (goal === 'property_followup' || goal === 'link_or_publication' || goal === 'visit_intent')) ||
    hasOfferValuation ||
    (aiState.lead_flow === 'offer' && goal === 'qualify_offer' && !!pc?.location_text) ||
    offerOrValuationFromText;

  if (routeD?.should_use_advisor_reply) {
    if (
      routeD.route === 'demand_initial' &&
      aiState.lead_flow === 'demand' &&
      pc &&
      !!pc.operation_type &&
      (!!pc.location_text || !!pc.location_any)
    ) {
      contextOk = true;
    }
    if (routeD.route === 'demand_followup' && (routeD.person_name_candidate || signals.full_name)) {
      contextOk = true;
    }
    if (
      (routeD.route === 'property_interest' || routeD.route === 'property_followup') &&
      (routeD.property_code || aiState.property_code || matched.length)
    ) {
      contextOk = true;
    }
    if (routeD.route === 'offer_followup' && aiState.lead_flow === 'offer') {
      contextOk = true;
    }
  }

  if (!contextOk) {
    return { use: false, reason: 'insufficient_advisor_context', draft };
  }

  return { use: true, reason: `advisor_goal_${goal}`, draft };
}

function lastOutboundHadPropertyCard(recentMessages = []) {
  if (!Array.isArray(recentMessages)) return false;
  for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
    const row = recentMessages[i];
    if (row?.direction !== 'outbound') continue;
    const t = normalizeText(String(row.message_text || ''));
    if (t.includes('luxetty.com/propiedad') || /\blux-\s*[a-z]\s*\d{4}\b/i.test(t) || t.includes('• ')) {
      return true;
    }
  }
  return false;
}

/** @deprecated Usar buildUnifiedForbiddenClaims en draft; se mantiene por compatibilidad. */
function buildForbiddenClaimsSummary(context = {}) {
  const parts = [];
  parts.push('No inventes precio, disponibilidad, fichas técnicas ni enlaces que no estén en los datos.');
  if (!context?.last_suggested_property) {
    parts.push('No hay propiedad sugerida en contexto: no inventes una; ofrece revisión con asesor.');
  } else {
    const p = context.last_suggested_property;
    if (!p.slug && !p.canonical_url) {
      parts.push('La propiedad en contexto puede no tener URL pública: dilo y ofrece que un asesor comparta enlace o valide en sistema.');
    }
    if (p.price == null || Number(p.price) <= 0) {
      parts.push('Precio no confirmado en datos: no lo afirmes como definitivo.');
    }
  }
  return parts.join(' ');
}

/**
 * @param {object} context
 * @param {{ openaiClient?: object, model?: string }} [options]
 * @returns {Promise<{ text: string, used_openai_advisor: boolean, response_source: string, response_reason?: string, draft?: object, response_goal?: string, advisor_mode?: string }>}
 */
async function generateAdvisorReplyForRealEstateTurn(context = {}, options = {}) {
  const client = options.openaiClient || openai;
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const userMessage = cleanSpaces(context.user_message || '');
  const recent = Array.isArray(context.recent_messages) ? context.recent_messages : [];
  const state = context.synthetic_state || {};
  const props = Array.isArray(context.suggested_properties) ? context.suggested_properties : [];
  const lastProp = context.last_suggested_property || props[0] || null;

  let draft = context.draft_context && typeof context.draft_context === 'object' ? context.draft_context : null;
  if (!draft) {
    draft = buildAdvisorResponseDraftContext({
      user_message: userMessage,
      ai_state: state,
      signals: context.signals || {},
      contact: context.contact || null,
      suggested_properties: props,
      last_suggested_property: lastProp,
      campaign_context: context.campaign_context || null,
      media_context: context.media_context || {},
      recent_messages: recent,
      recent_db_messages: context.recent_db_messages_for_card_check || [],
      conversation_id: context.conversation_id,
      change_type: context.change_type,
    });
  }

  const hadCard =
    lastOutboundHadPropertyCard(context.recent_db_messages_for_card_check || []) ||
    !!draft.memory_cohesion?.outbound_had_property_card;

  const forbiddenList = Array.isArray(draft.forbidden_claims) ? [...draft.forbidden_claims] : [];

  const propFacts = lastProp
    ? {
        listing_id: lastProp.listing_id || null,
        title: lastProp.title || null,
        zone: lastProp.zone || lastProp.neighborhood || lastProp.city || null,
        price: lastProp.price != null ? formatMoney(lastProp.price, lastProp.currency_code || 'MXN') : null,
        slug: lastProp.slug || null,
        public_listing_url: getPublicPropertyUrl(lastProp),
        ...(hadCard ? {} : { short: formatPropertyShort(lastProp) }),
      }
    : null;

  const facts = {
    lead_flow: context.current_lead_flow || state.lead_flow || draft.lead_flow,
    operation: context.operation || state.operation_type,
    zone: context.zone || state.location_text || draft.property_context?.location_text || null,
    budget: context.budget != null ? context.budget : state.budget_max,
    budget_currency: context.budget_currency || state.budget_currency || 'MXN',
    last_suggested_property: propFacts,
    suggested_count: props.length,
    missing_name: context.missing_name === true || draft.should_ask_name === true,
    next_step: context.next_step || draft.next_step || null,
    follow_up_reason: context.follow_up_reason || context.response_reason || null,
    anti_repeat: context.anti_repeat === true,
    response_goal: draft.response_goal,
    advisor_mode: draft.advisor_mode,
    safety_constraints: draft.safety_constraints,
    forbidden_claims_list: forbiddenList,
    conversation_summary: draft.conversation_summary,
    last_outbound_had_property_card: hadCard,
    memory_cohesion: draft.memory_cohesion || null,
    name_timing_hint: draft.name_timing_hint || 'standard',
    advisor_followup_type: draft.metadata?.advisor_followup_type || null,
  };

  const consultantContext = buildPerseoConsultantContext(state, recent, {
    userMessage,
    changeType: context.change_type || 'follow_up',
    matchedPropertiesCount: props.length,
  });

  const antiRepeatHint = context.anti_repeat
    ? 'IMPORTANTE: Tu mensaje anterior (visible en historial) fue demasiado parecido a uno genérico. NO repitas esa frase. Redacta respuesta nueva, específica y breve.'
    : '';

  const linkHint =
    propFacts?.public_listing_url && normalizeText(userMessage).match(/(link|liga|url|pdf|publicad|pasame|pásame)/)
      ? `Si el usuario pide enlace y existe public_listing_url en hechos, puedes incluir esa URL exacta una sola vez.`
      : '';

  const cardHint = hadCard
    ? 'NO vuelvas a pegar la ficha completa ni el listado de bullets: resume o referencia "la opción que te compartí".'
    : 'Puedes describir brevemente la opción sin exceder 2–3 líneas de detalle.';

  const nameHint =
    draft.name_timing_hint === 'soft_close'
      ? 'Si falta nombre (missing_name true), una sola pregunta corta al final; tono cercano, no invasivo.'
      : draft.name_timing_hint === 'defer'
      ? 'No pidas nombre en este turno (awaiting otro dato).'
      : '';

  const messages = [
    { role: 'system', content: PERSEO_CONSULTANT_SYSTEM_PROMPT },
    { role: 'system', content: consultantContext },
    {
      role: 'system',
      content: `DRAFT_CONTEXT_JSON:\n${safeJsonStringify({
        response_goal: draft.response_goal,
        advisor_mode: draft.advisor_mode,
        detected_intent: draft.detected_intent,
        awaiting_field: draft.awaiting_field,
        missing_fields: draft.missing_fields,
        contact_context: draft.contact_context,
        advisor_followup_type: draft.metadata?.advisor_followup_type,
        name_timing_hint: draft.name_timing_hint,
      })}\n\nMEMORY_COHESION_JSON:\n${safeJsonStringify(draft.memory_cohesion || {})}\n\nHECHOS_CONFIRMADOS_JSON:\n${safeJsonStringify(facts)}\n\n${antiRepeatHint}\n\n${linkHint}\n\n${cardHint}\n\n${nameHint}\n\nInstrucciones de salida (PR3 polish):\n- Español México; tono asesor humano, cálido, no corporativo.\n- Máximo 2–3 frases cortas; 1 pregunta si hace falta.\n- Responde SOLO a lo que preguntó el usuario; sin reintro pitch largo.\n- No repitas datos, CTAs o intros ya cubiertos en MEMORY_COHESION / historial.\n- Si falta nombre (missing_name true), una pregunta natural al final (salvo name_timing_hint defer).\n- Disponibilidad: no confirmes sin hecho; visita: coordinar sin decir agendada; PDF: honesto sin inventar.\n- Precio: usa hechos; si no hay, asesor confirma.\n- Cumple forbidden_claims_list al pie de la letra.\n`,
    },
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.45,
  });

  const sigForRoute = context.signals && typeof context.signals === 'object' ? context.signals : {};
  const routeEval = sigForRoute.route_evaluator_decision;
  const text =
    cleanSpaces(response?.choices?.[0]?.message?.content || '') ||
    getAdvisorFailureFallbackReply({
      route: routeEval?.route || draft.metadata?.route_evaluator_route || null,
      response_goal: draft.response_goal,
      location_text: draft.property_context?.location_text || routeEval?.location_text || null,
    });

  const advisor_shortened_response = text.length > 0 && text.length <= 420;

  return {
    text,
    used_openai_advisor: true,
    response_source: 'openai_advisor',
    response_reason: context.follow_up_reason || context.response_reason || draft.response_goal || 'real_estate_turn',
    draft,
    response_goal: draft.response_goal,
    advisor_mode: draft.advisor_mode,
    reused_memory_context: !!(draft.memory_cohesion?.last_outbound_snippet || draft.memory_cohesion?.last_inbound_before_current),
    advisor_followup_type: draft.metadata?.advisor_followup_type || null,
    advisor_shortened_response,
  };
}

function buildSyntheticStateForAdvisor(aiState = {}, matchedProperties = []) {
  const base = { ...(aiState && typeof aiState === 'object' ? aiState : {}) };
  if (matchedProperties.length && !base.asks_property_details) {
    base.asks_property_details = true;
  }
  return base;
}

module.exports = {
  detectRealEstateConsultativeFollowUp,
  hasRealEstateAdvisorTurnContext,
  mapConversationDbRowsToChatMessages,
  getLastOutboundTextFromDbRows,
  mergeReplyToString,
  isCandidateTooSimilarToLastOutbound,
  generateAdvisorReplyForRealEstateTurn,
  buildSyntheticStateForAdvisor,
  buildForbiddenClaimsSummary,
  shouldUseAdvisorForRealEstateTurn,
};
