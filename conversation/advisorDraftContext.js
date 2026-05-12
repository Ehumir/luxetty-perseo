'use strict';

/**
 * PERSEO — Rule-Guarded AI Advisor (PR1)
 * Capa de draft context: solo ordena facts/constraints para OpenAI.
 * NO llama OpenAI, NO escribe DB, NO CRM.
 *
 * Deuda técnica: normalizeRecentMessagesForAdvisor centraliza lo que antes vivía solo en
 * realEstateAdvisorReply.mapConversationDbRowsToChatMessages (ahora delega aquí).
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { safeJsonStringify } = require('../utils/helpers');
const { formatMoney } = require('../utils/formatting');
const { buildAiSummary } = require('./responseBuilder');
const {
  hasValidHumanName,
  getContactDisplayName,
  isPlaceholderContact,
} = require('./namePrompt');

const DRAFT_VERSION = '1.1.0';

/** @typedef {{ role: string, content: string, created_at?: string|null }} AdvisorChatMessage */

/**
 * PR3 — única fuente de patrones cortos inmobiliarios (router + inferResponseGoal + detect follow-up).
 * Orden: del más específico al más general.
 */
const SHORT_FOLLOW_UP_CHECKS = [
  {
    reason: 'listing_link_public',
    response_goal: 'link_or_publication',
    re: /(publicaci[oó]n|publicad[oa]s?|publicado|link|liga|url|pdf|brochure|pasame|pásame|mandame|mándame|en luxetty|en la pagina|en la página)/,
  },
  {
    reason: 'more_options',
    response_goal: 'more_options',
    re: /(otras opciones|más opciones|mas opciones|que más|qué más|hay más|algo más|tienes otra|otra opcion|otra opción|muestrame mas|muéstrame más)/,
  },
  {
    reason: 'price_followup',
    response_goal: 'price_followup',
    re: /(precio|cuanto cuesta|cuánto cuesta|cuanto vale|cuánto vale|cuanto es|cuánto es)/,
  },
  {
    reason: 'location_followup',
    response_goal: 'location_followup',
    re: /(ubicacion|ubicación|dónde está|donde esta|en que zona|en qué zona|direccion|dirección)/,
  },
  {
    reason: 'availability',
    response_goal: 'property_followup',
    re: /(disponible|disponibilidad)/,
  },
  {
    reason: 'visit_request',
    response_goal: 'visit_intent',
    re: /(puedo verla|la puedo ver|agendar|visita|verla)/,
  },
];

/**
 * @param {string} text
 * @param {string|null} leadFlow
 * @returns {{ reason: string, response_goal: string } | null}
 */
function classifyShortRealEstateFollowUp(text, leadFlow) {
  if (!leadFlow || (leadFlow !== 'demand' && leadFlow !== 'offer')) return null;
  const t = normalizeText(String(text || ''));
  if (!t) return null;
  for (const c of SHORT_FOLLOW_UP_CHECKS) {
    if (c.re.test(t)) return { reason: c.reason, response_goal: c.response_goal };
  }
  return null;
}

function outboundRowHadPropertyCard(messageText) {
  const t = normalizeText(String(messageText || ''));
  if (!t) return false;
  return t.includes('luxetty.com/propiedad') || /\blux-\s*[a-z]\s*\d{4}\b/i.test(t) || t.includes('• ');
}

/**
 * PR3 — pistas de memoria sin persistencia nueva (solo lectura de historial + ai_state).
 * @param {Array<Record<string, unknown>>} recentDbRows
 * @param {object} aiState
 * @param {string} currentUserMessage
 */
function analyzeMemoryCohesion(recentDbRows = [], aiState = {}, currentUserMessage = '') {
  const rows = Array.isArray(recentDbRows) ? recentDbRows : [];
  let lastOutboundSnippet = null;
  let lastInboundBeforeCurrent = null;
  let outbound_had_property_card = false;

  const inboundTexts = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.direction === 'outbound' && !lastOutboundSnippet) {
      const raw = cleanSpaces(String(row.message_text || ''));
      if (raw) {
        lastOutboundSnippet = raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
        outbound_had_property_card = outboundRowHadPropertyCard(raw);
      }
    }
    if (row?.direction === 'inbound') {
      const raw = cleanSpaces(String(row.message_text || ''));
      if (raw) inboundTexts.push(raw);
    }
  }

  if (inboundTexts.length >= 2) {
    const last = inboundTexts[0];
    if (normalizeText(last) === normalizeText(String(currentUserMessage || '').trim()) && inboundTexts.length >= 2) {
      lastInboundBeforeCurrent = inboundTexts[1];
    } else {
      lastInboundBeforeCurrent = last;
    }
  } else if (inboundTexts.length === 1) {
    const last = inboundTexts[0];
    if (normalizeText(last) !== normalizeText(String(currentUserMessage || '').trim())) {
      lastInboundBeforeCurrent = last;
    }
  }

  return {
    last_outbound_snippet: lastOutboundSnippet,
    last_inbound_before_current: lastInboundBeforeCurrent
      ? lastInboundBeforeCurrent.slice(0, 180)
      : null,
    outbound_had_property_card: outbound_had_property_card,
    last_intent_lead_flow: aiState.lead_flow || null,
    last_next_step: aiState.next_step != null ? String(aiState.next_step) : null,
    awaiting_field: aiState.awaiting_field || null,
  };
}

/**
 * Hint para el advisor (no modifica namePrompt): cuándo cerrar con nombre de forma natural.
 */
function computeNameTimingHint(contact, aiState, responseGoal) {
  const ask = computeShouldAskName(contact, aiState);
  if (!ask) return 'none';
  if (['contact_preference', 'contact_number_confirmed', 'contact_number'].includes(aiState?.awaiting_field)) {
    return 'defer';
  }
  if (
    aiState?.lead_flow === 'demand' &&
    (responseGoal === 'qualify_demand' || responseGoal === 'qualify_demand_and_capture_name') &&
    aiState?.budget_max != null &&
    aiState?.location_text &&
    (Number(aiState.last_search_result_count) > 0 ||
      (Array.isArray(aiState.last_shown_property_ids) && aiState.last_shown_property_ids.length > 0))
  ) {
    return 'soft_close';
  }
  if (responseGoal === 'link_or_publication' || responseGoal === 'visit_intent' || responseGoal === 'more_options') {
    return 'soft_close';
  }
  return 'standard';
}

/**
 * Lista única de prohibiciones (sin duplicar el párrafo legacy).
 */
function buildUnifiedForbiddenClaims({ last_suggested_property = null, media_context = {} } = {}) {
  const base = buildForbiddenClaims({
    last_suggested_property,
    media_context,
  });
  const extra = [];
  const p = last_suggested_property;
  if (!p) {
    extra.push('No hay propiedad sugerida en contexto: no inventes una; ofrece revisión con asesor.');
  } else {
    if (!p.slug && !p.canonical_url) {
      extra.push('La propiedad puede no tener URL pública: dilo y ofrece que un asesor comparta enlace o valide en sistema.');
    }
    if (p.price == null || Number(p.price) <= 0) {
      extra.push('Precio no confirmado en datos: no lo afirmes como definitivo.');
    }
  }
  const seen = new Set();
  const out = [];
  for (const line of [...base, ...extra]) {
    const k = normalizeText(String(line).slice(0, 80));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(line);
  }
  return out;
}

/**
 * Normaliza filas de conversation_messages (o mensajes ya tipo chat) al shape del advisor.
 * @param {Array<Record<string, unknown>>} rows
 * @returns {AdvisorChatMessage[]}
 */
function normalizeRecentMessagesForAdvisor(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = cleanSpaces(String(row.message_text ?? row.content ?? ''));
    if (!raw) continue;
    let role = row.role;
    if (!role && row.direction === 'outbound') role = 'assistant';
    if (!role && row.direction === 'inbound') role = 'user';
    if (role !== 'assistant' && role !== 'user') continue;
    const msg = { role, content: raw };
    if (row.created_at != null) msg.created_at = String(row.created_at);
    out.push(msg);
  }
  return out;
}

function buildSafetyConstraints() {
  return [
    'no inventar propiedades',
    'no inventar precio',
    'no inventar disponibilidad',
    'no decir que analizó imagen/audio/documento si no existe análisis real en contexto',
    'no prometer llamada inmediata si no está confirmado en contexto',
    'no crear ni modificar CRM, contactos, leads ni asignaciones desde el texto',
    'usar solo datos proporcionados en el contexto estructurado',
  ];
}

/**
 * @param {object} params
 * @returns {string[]}
 */
function buildForbiddenClaims(params = {}) {
  const claims = [];
  const media = params.media_context && typeof params.media_context === 'object' ? params.media_context : {};
  const hasImageAnalysis = !!media.image_analysis_available;
  const hasAudioTranscription = !!media.audio_transcription_available;
  const hasDocumentAnalysis = !!media.document_analysis_available;

  claims.push('No afirmar "ya revisé la imagen" ni análisis visual sin evidencia en contexto.');
  claims.push('No afirmar "ya validé disponibilidad" sin availability_confirmed explícito en hechos.');
  claims.push('No afirmar "la propiedad está disponible" sin campo seguro de disponibilidad en datos.');
  claims.push('No prometer "el asesor te llamará en X minutos" sin SLA real en contexto.');
  claims.push('No afirmar "ya quedó agendada la visita" sin confirmación explícita en contexto.');

  if (!hasImageAnalysis) {
    claims.push('No fingir que se analizó imagen/archivo visual si no hay image_analysis_available.');
  }
  if (!hasAudioTranscription) {
    claims.push('No fingir transcripción o comprensión completa de audio si no hay audio_transcription_available.');
  }
  if (!hasDocumentAnalysis) {
    claims.push('No fingir lectura de PDF/documento si no hay document_analysis_available.');
  }

  const lastProp = params.last_suggested_property;
  if (lastProp && typeof lastProp === 'object') {
    const price = lastProp.price;
    if (price == null || Number(price) <= 0) {
      claims.push('No inventar ni fijar precio como definitivo: precio no confirmado en datos de propiedad.');
    }
    if (!lastProp.slug && !lastProp.canonical_url) {
      claims.push('No inventar URL pública: slug/canonical ausentes en datos.');
    }
  }

  return claims;
}

/**
 * @param {string} userMessage
 * @param {object} aiState
 * @param {object} [signals]
 * @returns {string}
 */
function inferResponseGoal(userMessage, aiState = {}, signals = {}) {
  const t = normalizeText(String(userMessage || ''));
  const state = aiState && typeof aiState === 'object' ? aiState : {};

  if (!cleanSpaces(String(userMessage || '')) && !state.lead_flow) return 'greeting';

  if (state.handoff_sent || signals.handoff_sent) return 'handoff';
  if (signals.qa_command || signals.is_qa_command) return 'safety_fallback';
  if (signals.non_real_estate || signals.spam_signal) return 'safety_fallback';

  if (t && /^(hola|buen[oa]s|hey)\b/.test(t) && t.length < 40 && !state.lead_flow) return 'greeting';

  if (signals.asks_only_valuation || state.asks_only_valuation) return 'valuation_soft';
  if (/(valuar|valuacion|valuación|cuanto vale mi|cuánto vale mi|valor de mi|me urge vender|urgencia.*vender)/.test(t)) {
    return 'valuation_soft';
  }
  if (/(quiero vender|vendo mi casa|poner en venta|vender mi casa|vender la casa)/.test(t)) {
    return 'qualify_offer';
  }

  const shortFollow = classifyShortRealEstateFollowUp(String(userMessage || ''), state.lead_flow);
  if (shortFollow) return shortFollow.response_goal;

  if (!hasValidHumanName(signals.contact || null, state) && state.lead_flow && t.length < 80) {
    if (/(nombre|llamo|me llamo)/.test(t)) return 'qualify_demand';
  }

  if (state.direct_property_reference || state.property_code) return 'property_followup';
  if (state.lead_flow === 'demand') return 'qualify_demand';
  if (state.lead_flow === 'offer') return 'qualify_offer';

  if (!hasValidHumanName(signals.contact || null, state)) return 'capture_name';

  return 'general_real_estate';
}

/**
 * @param {object} params
 * @returns {string}
 */
function inferAdvisorMode(params = {}) {
  const state = params.ai_state && typeof params.ai_state === 'object' ? params.ai_state : {};
  const signals = params.signals && typeof params.signals === 'object' ? params.signals : {};
  const media = params.media_context && typeof params.media_context === 'object' ? params.media_context : {};

  if (signals.qa_command || signals.is_qa_command) return 'qa_programmed';
  if (signals.non_real_estate || signals.spam_signal) return 'safety_programmed';
  if (media.requires_programmed_safety) return 'safety_programmed';

  if (state.direct_property_reference || state.property_code) return 'property_active';
  if (params.campaign_context && typeof params.campaign_context === 'object' && Object.keys(params.campaign_context).length)
    return 'campaign_active';
  if (state.lead_flow === 'demand') return 'demand_active';
  if (state.lead_flow === 'offer') return 'offer_active';
  if (signals.asks_only_valuation || state.asks_only_valuation) return 'valuation_active';

  return 'general_real_estate';
}

function pickSerializableIntent(signals = {}) {
  if (!signals || typeof signals !== 'object') return {};
  const keys = [
    'lead_flow',
    'intent_type',
    'property_code',
    'low_info_campaign_message',
    'wants_human',
    'wants_visit',
    'asks_property_details',
    'complaint_followup',
  ];
  const out = {};
  for (const k of keys) {
    if (signals[k] !== undefined) out[k] = signals[k];
  }
  return out;
}

function compactPropertyForDraft(property) {
  if (!property || typeof property !== 'object') return null;
  return {
    id: property.id ?? null,
    listing_id: property.listing_id ?? null,
    title: property.title ? String(property.title).slice(0, 120) : null,
    neighborhood: property.neighborhood ?? null,
    zone: property.zone ?? null,
    city: property.city ?? null,
    price: property.price != null ? Number(property.price) : null,
    currency_code: property.currency_code || 'MXN',
    slug: property.slug ?? null,
    canonical_url: property.canonical_url ?? null,
    operation_type: property.operation_type ?? null,
    bedrooms: property.bedrooms ?? null,
    bathrooms: property.bathrooms ?? null,
  };
}

function buildPropertySearchContext(aiState = {}) {
  if (!aiState || typeof aiState !== 'object') return null;
  return {
    operation_type: aiState.operation_type ?? null,
    location_text: aiState.location_text ?? null,
    location_any: !!aiState.location_any,
    budget_max: aiState.budget_max != null ? Number(aiState.budget_max) : null,
    budget_currency: aiState.budget_currency ?? null,
    property_type: aiState.property_type ?? null,
    bedrooms: aiState.bedrooms ?? null,
    last_search_result_count: aiState.last_search_result_count != null ? Number(aiState.last_search_result_count) : null,
    last_shown_property_ids: Array.isArray(aiState.last_shown_property_ids) ? [...aiState.last_shown_property_ids] : [],
    result_quality: aiState.result_quality ?? null,
    direct_property_reference: !!aiState.direct_property_reference,
    property_code: aiState.property_code ?? null,
  };
}

function deriveMissingFields(aiState = {}) {
  if (!aiState || typeof aiState !== 'object') return [];
  const missing = [];
  if (aiState.lead_flow === 'demand') {
    if (!aiState.operation_type) missing.push('operation_type');
    if (!aiState.location_text && !aiState.location_any) missing.push('location');
    if (aiState.budget_max == null) missing.push('budget_max');
    if (!aiState.budget_currency && aiState.budget_max != null) missing.push('budget_currency');
  }
  if (aiState.lead_flow === 'offer') {
    if (!aiState.location_text) missing.push('location_text');
    if (aiState.owner_relation == null) missing.push('owner_relation');
  }
  return missing;
}

function computeShouldAskName(contact, aiState) {
  const waiting = aiState?.awaiting_field;
  if (['contact_preference', 'contact_number_confirmed', 'contact_number'].includes(waiting)) return false;
  return !hasValidHumanName(contact, aiState);
}

function buildContactContext(contact, aiState) {
  const valid = hasValidHumanName(contact, aiState);
  const placeholder = isPlaceholderContact(contact);
  const shouldAsk = computeShouldAskName(contact, aiState);
  let display = null;
  if (valid) {
    const raw = cleanSpaces(getContactDisplayName(contact));
    display = raw ? raw.slice(0, 80) : null;
  }
  return {
    has_valid_name: valid,
    display_name: display,
    is_placeholder: placeholder,
    should_ask_name: shouldAsk,
  };
}

/**
 * Construye el draft context estable para el advisor (sin side-effects).
 * @param {Record<string, unknown>} context
 */
function buildAdvisorResponseDraftContext(context) {
  const safe = context && typeof context === 'object' ? context : {};

  const userMessage = cleanSpaces(String(safe.user_message ?? safe.text ?? ''));
  const aiState = safe.ai_state && typeof safe.ai_state === 'object' ? safe.ai_state : {};
  const signals = safe.signals && typeof safe.signals === 'object' ? safe.signals : {};
  const contact = safe.contact && typeof safe.contact === 'object' ? safe.contact : null;
  const campaignContext =
    safe.campaign_context && typeof safe.campaign_context === 'object' ? safe.campaign_context : null;
  const mediaContext =
    safe.media_context && typeof safe.media_context === 'object' ? safe.media_context : {};

  const suggestedRaw = Array.isArray(safe.suggested_properties) ? safe.suggested_properties : [];
  const suggested_properties = suggestedRaw.map(compactPropertyForDraft).filter(Boolean);

  let last_suggested_property =
    safe.last_suggested_property && typeof safe.last_suggested_property === 'object'
      ? compactPropertyForDraft(safe.last_suggested_property)
      : null;
  if (!last_suggested_property && suggested_properties.length > 0) {
    last_suggested_property = suggested_properties[0];
  }

  const recentRaw = safe.recent_messages ?? safe.recent_db_messages ?? [];
  const recent_messages = normalizeRecentMessagesForAdvisor(Array.isArray(recentRaw) ? recentRaw : []);

  const propertiesForSummary = suggestedRaw;
  const conversation_summary = buildAiSummary(aiState, propertiesForSummary);

  const contact_context = buildContactContext(contact, aiState);
  const should_ask_name = contact_context.should_ask_name;

  const routeDecision = signals.route_evaluator_decision;
  const orchDecision = signals.orchestrator_decision;

  let advisor_mode = inferAdvisorMode({
    ai_state: aiState,
    signals,
    campaign_context: campaignContext,
    media_context: mediaContext,
  });

  let response_goal = inferResponseGoal(userMessage, aiState, { ...signals, contact });

  if (orchDecision && signals.conversation_engine_v2 && typeof orchDecision === 'object') {
    const g = orchDecision.reply_strategy?.goal;
    if (g === 'capture_name') response_goal = 'qualify_demand_and_capture_name';
    else if (g === 'qualify_demand') response_goal = 'qualify_demand';
    else if (g === 'qualify_offer') response_goal = 'qualify_offer';
    else if (g === 'answer_property_followup') response_goal = 'property_followup';
    else if (g === 'create_lead_handoff') response_goal = 'qualify_demand';
    else if (g === 'safety') response_goal = 'qualify_demand';

    const stage = orchDecision.conversation_stage;
    if (stage === 'seller_capture' || aiState.lead_flow === 'offer') advisor_mode = 'offer_active';
    else if (stage === 'property_followup' || aiState.direct_property_reference) advisor_mode = 'property_active';
    else if (aiState.lead_flow === 'demand') advisor_mode = 'demand_active';
  }

  if (routeDecision && typeof routeDecision === 'object' && routeDecision.should_use_advisor_reply && !signals.conversation_engine_v2) {
    if (typeof routeDecision.response_goal === 'string' && routeDecision.response_goal.trim()) {
      response_goal = routeDecision.response_goal.trim();
    }
    if (typeof routeDecision.advisor_mode === 'string' && routeDecision.advisor_mode.trim()) {
      advisor_mode = routeDecision.advisor_mode.trim();
    }
  }

  const recentDbOnly = Array.isArray(safe.recent_db_messages) ? safe.recent_db_messages : [];
  const memory_cohesion = analyzeMemoryCohesion(recentDbOnly, aiState, userMessage);
  const advisor_followup_type = classifyShortRealEstateFollowUp(userMessage, aiState.lead_flow)?.reason || null;
  const name_timing_hint = computeNameTimingHint(contact, aiState, response_goal);

  let forbidden_claims = buildUnifiedForbiddenClaims({
    last_suggested_property,
    media_context: mediaContext,
  });
  if (routeDecision && Array.isArray(routeDecision.forbidden_claims) && routeDecision.forbidden_claims.length) {
    const extra = routeDecision.forbidden_claims.map((x) => String(x || '').trim()).filter(Boolean);
    const seen = new Set(forbidden_claims.map((x) => normalizeText(String(x).slice(0, 72))));
    for (const line of extra) {
      const k = normalizeText(String(line).slice(0, 72));
      if (k && !seen.has(k)) {
        seen.add(k);
        forbidden_claims.push(line);
      }
    }
  }

  if (
    orchDecision &&
    signals.conversation_engine_v2 &&
    Array.isArray(orchDecision.safety?.forbidden_claims) &&
    orchDecision.safety.forbidden_claims.length
  ) {
    const extra = orchDecision.safety.forbidden_claims.map((x) => String(x || '').trim()).filter(Boolean);
    const seen = new Set(forbidden_claims.map((x) => normalizeText(String(x).slice(0, 72))));
    for (const line of extra) {
      const k = normalizeText(String(line).slice(0, 72));
      if (k && !seen.has(k)) {
        seen.add(k);
        forbidden_claims.push(line);
      }
    }
  }

  const crm_actions_taken = Array.isArray(safe.crm_actions_taken)
    ? safe.crm_actions_taken.map((x) => (typeof x === 'string' ? x : safeJsonStringify(x))).slice(0, 20)
    : [];

  const metadata = {
    draft_version: DRAFT_VERSION,
    conversation_id: safe.conversation_id != null ? String(safe.conversation_id) : null,
    change_type: safe.change_type != null ? String(safe.change_type) : null,
    advisor_followup_type,
    name_timing_hint,
    route_evaluator_route: routeDecision?.route || null,
    orchestrator_stage: orchDecision?.conversation_stage || null,
  };

  return {
    user_message: userMessage,
    recent_messages,
    conversation_summary,
    detected_intent: pickSerializableIntent(signals),
    lead_flow: aiState.lead_flow ?? null,
    awaiting_field: aiState.awaiting_field ?? null,
    property_context: buildPropertySearchContext(aiState),
    last_suggested_property,
    suggested_properties,
    campaign_context: campaignContext ? { ...campaignContext } : null,
    contact_context,
    missing_fields: deriveMissingFields(aiState),
    crm_actions_taken,
    next_step: aiState.next_step != null ? String(aiState.next_step) : null,
    safety_constraints: buildSafetyConstraints(),
    should_ask_name,
    forbidden_claims,
    response_goal,
    advisor_mode,
    memory_cohesion,
    name_timing_hint,
    metadata,
  };
}

module.exports = {
  buildAdvisorResponseDraftContext,
  inferAdvisorMode,
  inferResponseGoal,
  buildSafetyConstraints,
  buildForbiddenClaims,
  buildUnifiedForbiddenClaims,
  normalizeRecentMessagesForAdvisor,
  classifyShortRealEstateFollowUp,
  analyzeMemoryCohesion,
  computeNameTimingHint,
  outboundRowHadPropertyCard,
};
