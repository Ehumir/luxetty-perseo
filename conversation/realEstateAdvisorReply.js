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
} = require('./advisorDraftContext');
const { getPublicPropertyUrl } = require('../utils/helpers');

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
 * Seguimiento consultivo dentro de flujo inmobiliario (demanda/oferta).
 * No reemplaza el parser completo; evita salidas tipo formulario para preguntas cortas.
 */
function detectRealEstateConsultativeFollowUp(text, leadFlow) {
  if (!leadFlow || (leadFlow !== 'demand' && leadFlow !== 'offer')) return null;
  const t = normalizeText(String(text || ''));
  if (!t) return null;

  const checks = [
    {
      reason: 'listing_link_public',
      re: /(publicad|publicada|publicado|link|liga|url|pdf|brochure|pasame|pásame|mandame|mándame|en luxetty|en la pagina|en la página)/,
    },
    { reason: 'more_options', re: /(otras opciones|más opciones|mas opciones|que más|qué más|hay más|algo más|tienes otra|otra opcion|otra opción|muestrame mas|muéstrame más)/ },
    { reason: 'price_followup', re: /(precio|cuanto cuesta|cuánto cuesta|cuanto vale|cuánto vale|cuanto es|cuánto es)/ },
    { reason: 'location_followup', re: /(ubicacion|ubicación|dónde está|donde esta|en que zona|en qué zona|direccion|dirección)/ },
    { reason: 'availability', re: /(disponible|disponibilidad)/ },
    { reason: 'visit_request', re: /(puedo verla|la puedo ver|agendar|visita|verla)/ },
  ];

  for (const c of checks) {
    if (c.re.test(t)) return { reason: c.reason, leadFlow };
  }
  return null;
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

function isCandidateTooSimilarToLastOutbound(candidateReply, lastOutboundText) {
  const a = normalizeForSimilarity(mergeReplyToString(candidateReply));
  const b = normalizeForSimilarity(lastOutboundText);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 40 && b.length >= 40 && (a.includes(b) || b.includes(a))) return true;
  if (GENERIC_PLAYBOOK_SNIPPET && a.includes(GENERIC_PLAYBOOK_SNIPPET) && b.includes(GENERIC_PLAYBOOK_SNIPPET)) return true;
  return false;
}

const ADVISOR_ALLOWED_RESPONSE_GOALS = new Set([
  'qualify_demand',
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

  const contextOk =
    hasHydratedContext ||
    hasFollowUpPattern ||
    (hasMinimalDemand && (goal === 'qualify_demand' || goal === 'price_followup' || goal === 'location_followup')) ||
    hasCampaign ||
    (hasSuggested && (goal === 'property_followup' || goal === 'link_or_publication' || goal === 'visit_intent')) ||
    hasOfferValuation ||
    (aiState.lead_flow === 'offer' && goal === 'qualify_offer' && !!pc?.location_text) ||
    offerOrValuationFromText;

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
      conversation_id: context.conversation_id,
      change_type: context.change_type,
    });
  }

  const propFacts = lastProp
    ? {
        listing_id: lastProp.listing_id || null,
        title: lastProp.title || null,
        zone: lastProp.zone || lastProp.neighborhood || lastProp.city || null,
        price: lastProp.price != null ? formatMoney(lastProp.price, lastProp.currency_code || 'MXN') : null,
        slug: lastProp.slug || null,
        public_listing_url: getPublicPropertyUrl(lastProp),
        short: formatPropertyShort(lastProp),
      }
    : null;

  const hadCard = lastOutboundHadPropertyCard(context.recent_db_messages_for_card_check || []);

  const forbiddenList = Array.isArray(draft.forbidden_claims) ? [...draft.forbidden_claims] : [];
  const summaryLine = buildForbiddenClaimsSummary({ last_suggested_property: lastProp });
  if (summaryLine) forbiddenList.push(summaryLine);

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
      })}\n\nHECHOS_CONFIRMADOS_JSON:\n${safeJsonStringify(facts)}\n\n${antiRepeatHint}\n\n${linkHint}\n\n${cardHint}\n\nInstrucciones de salida:\n- Español de México, tono asesor humano (no formulario).\n- 2 a 4 frases; máximo 2 preguntas en total; preferible 1.\n- Si falta nombre (missing_name true), cierra incluyendo de forma natural: "Para registrarte bien, ¿me compartes tu nombre?"\n- Disponibilidad: no confirmes disponibilidad si forbidden_claims lo impide.\n- Visita: ofrece canalizar o siguiente paso; no digas que ya quedó agendada salvo confirmación en contexto.\n- PDF: si no hay documento analizado en contexto, dilo y ofrece asesor; no inventes PDF.\n- Precio: usa price en hechos si existe; si no, indica que un asesor confirma.\n- No inventes hechos que contradigan forbidden_claims_list.\n`,
    },
    { role: 'user', content: userMessage },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.45,
  });

  const text =
    cleanSpaces(response?.choices?.[0]?.message?.content || '') ||
    'Perfecto. Para no inventar datos, lo más seguro es que un asesor de Luxetty te confirme publicación, liga y disponibilidad al momento. ¿Te parece si lo canalizamos? Para registrarte bien, ¿me compartes tu nombre?';

  return {
    text,
    used_openai_advisor: true,
    response_source: 'openai_advisor',
    response_reason: context.follow_up_reason || context.response_reason || draft.response_goal || 'real_estate_turn',
    draft,
    response_goal: draft.response_goal,
    advisor_mode: draft.advisor_mode,
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
