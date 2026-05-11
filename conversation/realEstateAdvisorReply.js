'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { safeJsonStringify } = require('../utils/helpers');
const { formatMoney, formatPropertyShort } = require('../utils/formatting');
const {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
} = require('./perseoConsultantPrompt');
const { openai } = require('../services/openaiService');
const { normalizeRecentMessagesForAdvisor } = require('./advisorDraftContext');

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
    { reason: 'listing_link_public', re: /(publicad|publicada|publicado|link|liga|url|en luxetty|en la pagina|en la página)/ },
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
 * @returns {Promise<{ text: string, used_openai_advisor: boolean, response_source: string, response_reason?: string }>}
 */
async function generateAdvisorReplyForRealEstateTurn(context = {}, options = {}) {
  const client = options.openaiClient || openai;
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const userMessage = cleanSpaces(context.user_message || '');
  const recent = Array.isArray(context.recent_messages) ? context.recent_messages : [];
  const state = context.synthetic_state || {};

  const lastProp = context.last_suggested_property || null;
  const props = Array.isArray(context.suggested_properties) ? context.suggested_properties : [];
  const propFacts = lastProp
    ? {
        listing_id: lastProp.listing_id || null,
        title: lastProp.title || null,
        zone: lastProp.zone || lastProp.neighborhood || lastProp.city || null,
        price: lastProp.price != null ? formatMoney(lastProp.price, lastProp.currency_code || 'MXN') : null,
        slug: lastProp.slug || null,
        short: formatPropertyShort(lastProp),
      }
    : null;

  const facts = {
    lead_flow: context.current_lead_flow || state.lead_flow,
    operation: context.operation || state.operation_type,
    zone: context.zone || state.location_text || null,
    budget: context.budget != null ? context.budget : state.budget_max,
    budget_currency: context.budget_currency || state.budget_currency || 'MXN',
    last_suggested_property: propFacts,
    suggested_count: props.length,
    missing_name: context.missing_name === true,
    next_step: context.next_step || null,
    follow_up_reason: context.follow_up_reason || null,
    anti_repeat: context.anti_repeat === true,
    forbidden_claims: context.forbidden_claims || buildForbiddenClaimsSummary({ last_suggested_property: lastProp }),
  };

  const consultantContext = buildPerseoConsultantContext(state, recent, {
    userMessage,
    changeType: context.change_type || 'follow_up',
    matchedPropertiesCount: props.length,
  });

  const antiRepeatHint = context.anti_repeat
    ? 'IMPORTANTE: Tu mensaje anterior (visible en historial) fue demasiado parecido a uno genérico. NO repitas esa frase. Redacta respuesta nueva, específica y breve.'
    : '';

  const messages = [
    { role: 'system', content: PERSEO_CONSULTANT_SYSTEM_PROMPT },
    { role: 'system', content: consultantContext },
    {
      role: 'system',
      content: `HECHOS_CONFIRMADOS_JSON:\n${safeJsonStringify(facts)}\n\n${antiRepeatHint}\n\nInstrucciones de salida:\n- Español de México, tono asesor humano (no formulario).\n- Máximo 2 preguntas en total; preferible 1.\n- Si falta nombre (missing_name true), cierra incluyendo de forma natural: "Para registrarte bien, ¿me compartes tu nombre?"\n- Si preguntan publicación/liga: explica que puedes apoyar a revisarla; si no tienes URL en datos, dilo y ofrece asesor.\n- Si preguntan más opciones: confirma que se pueden buscar más en la zona y presupuesto indicados y pide 1 preferencia (tipo de casa, privada, patio, etc.).\n- No inventes hechos que contradigan forbidden_claims.\n`,
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
    response_reason: context.follow_up_reason || context.response_reason || 'real_estate_turn',
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
};
