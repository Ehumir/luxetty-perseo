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

const DRAFT_VERSION = '1.0.0';

/** @typedef {{ role: string, content: string, created_at?: string|null }} AdvisorChatMessage */

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

  if (/(publicad|publicada|link|liga|url|pdf|brochure)/.test(t)) return 'link_or_publication';
  if (/(otras opciones|más opciones|otra opcion|otra opción|que más|hay más)/.test(t)) return 'more_options';
  if (/(precio|cuanto cuesta|cuánto cuesta|cuanto vale)/.test(t)) return 'price_followup';
  if (/(ubicacion|ubicación|donde|dónde|direccion|dirección)/.test(t)) return 'location_followup';
  if (/(disponible|disponibilidad)/.test(t)) return 'property_followup';
  if (/(visita|verla|puedo ver|agendar)/.test(t)) return 'visit_intent';

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

  const advisor_mode = inferAdvisorMode({
    ai_state: aiState,
    signals,
    campaign_context: campaignContext,
    media_context: mediaContext,
  });

  const response_goal = inferResponseGoal(userMessage, aiState, { ...signals, contact });

  const forbidden_claims = buildForbiddenClaims({
    last_suggested_property,
    media_context: mediaContext,
  });

  const crm_actions_taken = Array.isArray(safe.crm_actions_taken)
    ? safe.crm_actions_taken.map((x) => (typeof x === 'string' ? x : safeJsonStringify(x))).slice(0, 20)
    : [];

  const metadata = {
    draft_version: DRAFT_VERSION,
    conversation_id: safe.conversation_id != null ? String(safe.conversation_id) : null,
    change_type: safe.change_type != null ? String(safe.change_type) : null,
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
    metadata,
  };
}

module.exports = {
  buildAdvisorResponseDraftContext,
  inferAdvisorMode,
  inferResponseGoal,
  buildSafetyConstraints,
  buildForbiddenClaims,
  normalizeRecentMessagesForAdvisor,
};
