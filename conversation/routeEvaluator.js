'use strict';

/**
 * P0.2 — OpenAI Route Evaluator (solo recomendación; sin side-effects CRM).
 * OpenAI interpreta intención/ruta; el código valida, aplica reglas duras y decide ejecución.
 */

const { openai } = require('../services/openaiService');
const { cleanSpaces } = require('../utils/text');
const { safeJsonStringify } = require('../utils/helpers');
const { parseMessageSignals } = require('./parsers');
const { parseQaCommand } = require('./qaCommands');

const ROUTES = new Set([
  'demand_initial',
  'demand_followup',
  'property_interest',
  'property_followup',
  'offer_initial',
  'offer_followup',
  'valuation',
  'mixed_sell_buy',
  'qa_command',
  'safety',
  'media_unsupported',
  'spam',
  'unknown',
]);

const INTENTS = new Set([
  'buy',
  'rent',
  'sell',
  'valuation',
  'property_interest',
  'mixed',
  'qa',
  'safety',
  'unknown',
]);

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function emptyDecision(overrides = {}) {
  return {
    route: 'unknown',
    intent: 'unknown',
    confidence: 0,
    lead_flow: null,
    operation_type: null,
    location_text: null,
    property_code: null,
    person_name_candidate: null,
    missing_fields: [],
    should_use_advisor_reply: false,
    should_use_programmed_reply: true,
    programmed_route_reason: 'empty_decision',
    should_create_or_update_contact: false,
    should_create_or_update_lead: false,
    response_goal: 'qualify_demand',
    advisor_mode: 'general_real_estate',
    safety_flags: [],
    forbidden_claims: [],
    notes: '',
    ...overrides,
  };
}

/**
 * Contexto compacto para el prompt del evaluador (sin PII sensible extra).
 */
function buildRouteEvaluatorContext(context = {}) {
  const text = cleanSpaces(String(context.text ?? context.user_message ?? ''));
  const prev = context.previousAiState && typeof context.previousAiState === 'object' ? context.previousAiState : {};
  const sig = context.incomingSignals && typeof context.incomingSignals === 'object' ? context.incomingSignals : {};
  const contact = context.contact && typeof context.contact === 'object' ? context.contact : null;
  const media = context.inboundContext?.media && typeof context.inboundContext.media === 'object' ? context.inboundContext.media : {};
  const campaign = context.campaignContext && typeof context.campaignContext === 'object' ? context.campaignContext : null;

  return {
    user_message: text,
    previous_ai_state: {
      lead_flow: prev.lead_flow ?? null,
      operation_type: prev.operation_type ?? null,
      awaiting_field: prev.awaiting_field ?? null,
      location_text: prev.location_text ?? null,
      location_any: !!prev.location_any,
      property_code: prev.property_code ?? null,
      direct_property_reference: !!prev.direct_property_reference,
      full_name: prev.full_name ?? null,
      pending_name_capture: !!prev.pending_name_capture,
      playbook_step: prev.playbook_step ?? null,
    },
    incoming_signals_summary: {
      lead_flow: sig.lead_flow ?? null,
      operation_type: sig.operation_type ?? null,
      location_text: sig.location_text ?? null,
      property_code: sig.property_code ?? null,
      direct_property_reference: !!sig.direct_property_reference,
      full_name: sig.full_name ?? null,
      owner_relation: sig.owner_relation ?? null,
      intent_type: sig.intent_type ?? null,
      asks_property_details: !!sig.asks_property_details,
      sell_buy_bridge: !!sig.sell_buy_bridge,
      spam_detected: !!sig.spam_detected,
      non_real_estate_or_provider: !!sig.non_real_estate_or_provider,
    },
    contact_has_display_name: !!(contact && String(contact.full_name || contact.name || '').trim()),
    media: {
      type: media.type || null,
      requires_programmed_safety: !!(media.attachment_detected_not_processed || media.unsupported_media),
      has_useful_text: !!text,
    },
    campaign_property_code: campaign?.property_code || null,
  };
}

function coerceNumber01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sanitizeStringArray(v, max = 24) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Reglas duras: ignorar CRM peligroso del modelo; normalizar enums; no ejecutar acciones.
 * @param {object} decision
 * @param {object} ctx — { text, previousAiState, incomingSignals, contact }
 */
function validateRouteDecision(decision, ctx = {}) {
  const raw = decision && typeof decision === 'object' ? decision : {};
  const text = cleanSpaces(String(ctx.text ?? ''));
  const prev = ctx.previousAiState && typeof ctx.previousAiState === 'object' ? ctx.previousAiState : {};
  const sig = ctx.incomingSignals && typeof ctx.incomingSignals === 'object' ? ctx.incomingSignals : {};

  let route = typeof raw.route === 'string' ? raw.route.trim() : 'unknown';
  if (!ROUTES.has(route)) route = 'unknown';

  let intent = typeof raw.intent === 'string' ? raw.intent.trim() : 'unknown';
  if (!INTENTS.has(intent)) intent = 'unknown';

  const confidence = coerceNumber01(raw.confidence);

  let lead_flow = raw.lead_flow === 'demand' || raw.lead_flow === 'offer' ? raw.lead_flow : null;
  let operation_type =
    raw.operation_type === 'sale' || raw.operation_type === 'rent' ? raw.operation_type : null;

  const location_text =
    raw.location_text != null && String(raw.location_text).trim()
      ? String(raw.location_text).trim().slice(0, 120)
      : null;

  let property_code =
    raw.property_code != null && String(raw.property_code).trim()
      ? String(raw.property_code).trim().toUpperCase().slice(0, 32)
      : null;

  const person_name_candidate =
    raw.person_name_candidate != null && String(raw.person_name_candidate).trim()
      ? String(raw.person_name_candidate).trim().slice(0, 80)
      : null;

  const missing_fields = sanitizeStringArray(raw.missing_fields, 20);

  const safety_flags = sanitizeStringArray(raw.safety_flags, 20);
  let forbidden_claims = sanitizeStringArray(raw.forbidden_claims, 30);

  let should_use_advisor_reply = !!raw.should_use_advisor_reply;
  let should_use_programmed_reply = raw.should_use_programmed_reply !== false;

  let response_goal =
    typeof raw.response_goal === 'string' && raw.response_goal.trim()
      ? raw.response_goal.trim().slice(0, 80)
      : 'qualify_demand';

  let advisor_mode =
    typeof raw.advisor_mode === 'string' && raw.advisor_mode.trim()
      ? raw.advisor_mode.trim().slice(0, 80)
      : 'demand_active';

  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 500) : '';

  /** CRM: nunca confiar ciegamente en OpenAI */
  let should_create_or_update_contact = false;
  let should_create_or_update_lead = false;

  if (sig.full_name && cleanSpaces(String(sig.full_name))) {
    should_create_or_update_contact = true;
  } else if (
    prev.awaiting_field === 'full_name' &&
    person_name_candidate &&
    /^[a-záéíóúñü]{2,24}$/i.test(person_name_candidate.trim()) &&
    text.length < 40
  ) {
    should_create_or_update_contact = true;
  }

  /** Refuerzos de seguridad por ruta */
  if (route === 'property_followup' || response_goal === 'price_followup') {
    const extra = 'No inventar precio ni disponibilidad sin dato confirmado en sistema.';
    if (!forbidden_claims.some((x) => normalizeGoalKey(x) === normalizeGoalKey(extra))) {
      forbidden_claims = [...forbidden_claims, extra];
    }
  }

  /** Coherencia mínima ruta ↔ lead_flow */
  if (route === 'demand_initial' || route === 'demand_followup') {
    lead_flow = lead_flow || 'demand';
    if (!operation_type && (intent === 'buy' || intent === 'unknown')) operation_type = 'sale';
  }
  if (route === 'offer_initial' || route === 'offer_followup') {
    lead_flow = lead_flow || 'offer';
  }

  /** Si el modelo pide programado safety, priorizar */
  if (route === 'safety' || route === 'spam' || route === 'media_unsupported' || route === 'qa_command') {
    should_use_advisor_reply = false;
    should_use_programmed_reply = true;
  }

  return {
    route,
    intent,
    confidence,
    lead_flow,
    operation_type,
    location_text: location_text || sig.location_text || null,
    property_code: property_code || sig.property_code || null,
    person_name_candidate,
    missing_fields,
    should_use_advisor_reply,
    should_use_programmed_reply,
    programmed_route_reason:
      typeof raw.programmed_route_reason === 'string' ? raw.programmed_route_reason.slice(0, 200) : null,
    should_create_or_update_contact,
    should_create_or_update_lead,
    response_goal,
    advisor_mode,
    safety_flags,
    forbidden_claims,
    notes,
  };
}

function normalizeGoalKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback determinístico basado en parseMessageSignals (sin OpenAI).
 */
function fallbackRouteDecision(context = {}) {
  const text = cleanSpaces(String(context.text ?? context.user_message ?? ''));
  const prev = context.previousAiState && typeof context.previousAiState === 'object' ? context.previousAiState : {};
  const inbound = context.inboundContext && typeof context.inboundContext === 'object' ? context.inboundContext : {};
  const sig =
    context.incomingSignals && typeof context.incomingSignals === 'object'
      ? context.incomingSignals
      : parseMessageSignals(text, prev, inbound);

  const media = inbound.media && typeof inbound.media === 'object' ? inbound.media : {};
  if (media.attachment_detected_not_processed || media.unsupported_media) {
    return validateRouteDecision(
      emptyDecision({
        route: 'media_unsupported',
        intent: 'safety',
        should_use_advisor_reply: false,
        should_use_programmed_reply: true,
        programmed_route_reason: 'multimedia_sin_analisis',
        response_goal: 'safety_fallback',
        advisor_mode: 'safety_programmed',
      }),
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (sig.property_code && sig.direct_property_reference) {
    return validateRouteDecision(
      {
        route: 'property_interest',
        intent: 'property_interest',
        confidence: 0.78,
        lead_flow: 'demand',
        operation_type: sig.operation_type || 'sale',
        location_text: sig.location_text || null,
        property_code: sig.property_code,
        person_name_candidate: null,
        missing_fields: [],
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: false,
        should_create_or_update_lead: false,
        response_goal: 'property_followup',
        advisor_mode: 'property_active',
        safety_flags: [],
        forbidden_claims: [],
        notes: 'property_code_from_parser',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (sig.spam_detected || sig.non_real_estate_or_provider) {
    return validateRouteDecision(
      emptyDecision({
        route: 'spam',
        intent: 'safety',
        should_use_advisor_reply: false,
        should_use_programmed_reply: true,
        programmed_route_reason: 'spam_or_non_real_estate',
        response_goal: 'safety_fallback',
        advisor_mode: 'safety_programmed',
      }),
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  const t = text.toLowerCase();
  const propMatch = String(text || '').match(/\b(LUX[\s\-]?[A-Z]\s?[0-9]{4}|[A-Z][0-9]{4})\b/i);
  if (propMatch) {
    const rawCode = cleanSpaces(propMatch[1].replace(/\s+/g, ''));
    const code = rawCode.toUpperCase();
    return validateRouteDecision(
      {
        route: 'property_interest',
        intent: 'property_interest',
        confidence: 0.75,
        lead_flow: 'demand',
        operation_type: sig.operation_type || 'sale',
        location_text: sig.location_text || null,
        property_code: code,
        person_name_candidate: null,
        missing_fields: [],
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: false,
        should_create_or_update_lead: false,
        response_goal: 'property_followup',
        advisor_mode: 'property_active',
        safety_flags: [],
        forbidden_claims: [],
        notes: 'property_code_detected',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (
    prev.lead_flow === 'offer' &&
    (prev.awaiting_field === 'owner_relation' || prev.owner_relation == null) &&
    (sig.owner_relation != null || /\b(m[ií]a|mio|mío|yo|si|sí)\b/i.test(t))
  ) {
    return validateRouteDecision(
      {
        route: 'offer_followup',
        intent: 'sell',
        confidence: 0.7,
        lead_flow: 'offer',
        operation_type: prev.operation_type || sig.operation_type || 'sale',
        location_text: sig.location_text || prev.location_text || null,
        property_code: null,
        person_name_candidate: null,
        missing_fields: [],
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: false,
        should_create_or_update_lead: false,
        response_goal: 'qualify_offer',
        advisor_mode: 'offer_active',
        safety_flags: [],
        forbidden_claims: [],
        notes: 'ownership_short_reply',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (prev.awaiting_field === 'full_name' && text.length > 0 && text.length < 48 && !sig.property_code) {
    return validateRouteDecision(
      {
        route: 'demand_followup',
        intent: sig.intent_type === 'demand' || sig.lead_flow === 'demand' ? 'buy' : 'unknown',
        confidence: 0.65,
        lead_flow: sig.lead_flow || prev.lead_flow || 'demand',
        operation_type: sig.operation_type || prev.operation_type || null,
        location_text: sig.location_text || prev.location_text || null,
        property_code: sig.property_code || null,
        person_name_candidate: sig.full_name || text.trim(),
        missing_fields: [],
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: !!sig.full_name,
        should_create_or_update_lead: false,
        response_goal: 'qualify_demand_and_capture_name',
        advisor_mode: 'demand_active',
        safety_flags: [],
        forbidden_claims: [],
        notes: 'name_followup',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (
    (prev.property_code || prev.direct_property_reference) &&
    /\b(precio|cuánto|cuanto|cuesta|vale|disponible|liga|link|pdf)\b/i.test(t)
  ) {
    return validateRouteDecision(
      {
        route: 'property_followup',
        intent: 'property_interest',
        confidence: 0.72,
        lead_flow: 'demand',
        operation_type: sig.operation_type || prev.operation_type || 'sale',
        location_text: sig.location_text || prev.location_text || null,
        property_code: sig.property_code || prev.property_code || null,
        person_name_candidate: null,
        missing_fields: [],
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: false,
        should_create_or_update_lead: false,
        response_goal: /\bprecio|cuánto|cuanto|cuesta|vale\b/i.test(t) ? 'price_followup' : 'property_followup',
        advisor_mode: 'property_active',
        safety_flags: [],
        forbidden_claims: ['No inventar precio ni disponibilidad sin dato confirmado en sistema.'],
        notes: 'active_property_followup',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (
    sig.lead_flow === 'demand' &&
    (sig.location_text || sig.location_any || sig.operation_type) &&
    !prev.lead_flow &&
    !sig.direct_property_reference &&
    !sig.unclear_non_real_estate
  ) {
    return validateRouteDecision(
      {
        route: 'demand_initial',
        intent: 'buy',
        confidence: 0.8,
        lead_flow: 'demand',
        operation_type: sig.operation_type || 'sale',
        location_text: sig.location_text || null,
        property_code: null,
        person_name_candidate: null,
        missing_fields: ['budget_max', 'full_name'].filter((k) => {
          if (k === 'full_name') return !sig.full_name;
          if (k === 'budget_max') return sig.budget_max == null;
          return true;
        }),
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: false,
        should_create_or_update_lead: false,
        response_goal: 'qualify_demand_and_capture_name',
        advisor_mode: 'demand_active',
        safety_flags: [],
        forbidden_claims: [
          'No hables de publicación, liga o disponibilidad al momento salvo que el usuario pida explícitamente enlace o publicación y exista dato confirmado.',
        ],
        notes: 'demanda_inicial_busqueda',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  if (sig.lead_flow === 'demand') {
    return validateRouteDecision(
      {
        route: 'demand_followup',
        intent: 'buy',
        confidence: 0.55,
        lead_flow: 'demand',
        operation_type: sig.operation_type || prev.operation_type || 'sale',
        location_text: sig.location_text || prev.location_text || null,
        property_code: sig.property_code || null,
        person_name_candidate: sig.full_name || null,
        missing_fields: [],
        should_use_advisor_reply: true,
        should_use_programmed_reply: false,
        programmed_route_reason: null,
        should_create_or_update_contact: !!sig.full_name,
        should_create_or_update_lead: false,
        response_goal: 'qualify_demand',
        advisor_mode: 'demand_active',
        safety_flags: [],
        forbidden_claims: [],
        notes: 'demand_default_followup',
      },
      { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
    );
  }

  return validateRouteDecision(
    emptyDecision({
      route: 'unknown',
      notes: 'fallback_default',
      response_goal: 'qualify_demand',
    }),
    { text, previousAiState: prev, incomingSignals: sig, contact: context.contact }
  );
}

/**
 * @param {object} context
 * @param {{ model?: string, openaiClient?: object }} [options]
 */
async function evaluateRouteWithOpenAI(context = {}, options = {}) {
  if (process.env.PERSEO_ROUTE_EVALUATOR_MODE === 'fallback_only') {
    return fallbackRouteDecision(context);
  }

  const client = options.openaiClient || openai;
  const model = options.model || DEFAULT_MODEL;
  const payload = buildRouteEvaluatorContext(context);

  const system = `Eres el Route Evaluator de PERSEO (inmobiliaria México). Devuelves SOLO un JSON válido con las claves exactas indicadas por el usuario.
Reglas:
- NO ejecutes CRM; solo recomienda flags booleanos coherentes (el backend los validará).
- NO inventes códigos de propiedad; si hay duda, property_code null.
- demand_initial: primera intención de compra/renta con zona o tipo sin propiedad explícita.
- property_interest: mención explícita de código tipo LUX-1234 o A0470.
- property_followup: pregunta sobre propiedad ya activa en contexto (precio, disponible, link…).
- offer_followup: respuestas cortas de propiedad (Mía/Yo/Sí) en flujo venta.
- spam/media_unsupported/safety según corresponda.

Claves obligatorias del JSON:
route,intent,confidence,lead_flow,operation_type,location_text,property_code,person_name_candidate,missing_fields,should_use_advisor_reply,should_use_programmed_reply,programmed_route_reason,should_create_or_update_contact,should_create_or_update_lead,response_goal,advisor_mode,safety_flags,forbidden_claims,notes

Enums:
route: demand_initial | demand_followup | property_interest | property_followup | offer_initial | offer_followup | valuation | mixed_sell_buy | qa_command | safety | media_unsupported | spam | unknown
intent: buy | rent | sell | valuation | property_interest | mixed | qa | safety | unknown
lead_flow: demand | offer | null
operation_type: sale | rent | null
missing_fields: array de strings
safety_flags, forbidden_claims: arrays de strings
confidence: número 0..1`;

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `CONTEXT_JSON:\n${safeJsonStringify(payload)}` },
      ],
    });

    const rawText = cleanSpaces(response?.choices?.[0]?.message?.content || '');
    if (!rawText) {
      return fallbackRouteDecision(context);
    }
    const parsed = JSON.parse(rawText);
    const validated = validateRouteDecision(parsed, {
      text: context.text,
      previousAiState: context.previousAiState,
      incomingSignals: context.incomingSignals,
      contact: context.contact,
    });
    return validated;
  } catch (e) {
    return fallbackRouteDecision(context);
  }
}

/**
 * Mensaje seguro si falla el advisor OpenAI (según ruta P0.2).
 */
function getAdvisorFailureFallbackReply(routeDecision) {
  const r = routeDecision && typeof routeDecision === 'object' ? routeDecision : null;
  if (r?.route === 'demand_initial' || r?.response_goal === 'qualify_demand_and_capture_name') {
    const loc = r.location_text ? ` en ${r.location_text}` : '';
    return `Hola, claro. Te puedo ayudar a buscar casa${loc}. Para registrarte bien, ¿me compartes tu nombre?`;
  }
  return (
    'Con gusto reviso ese punto contigo. Para no inventar datos, un asesor de Luxetty puede confirmarte publicación, liga y disponibilidad al momento. ' +
    '¿Te parece si lo canalizamos? Para registrarte bien, ¿me compartes tu nombre?'
  );
}

function shouldSkipOpenAIRouteEvaluator({ text, messageType, inboundContext }) {
  if (parseQaCommand(cleanSpaces(String(text || '')))) return true;
  const media = inboundContext?.media && typeof inboundContext.media === 'object' ? inboundContext.media : {};
  if (media.type && media.type !== 'text') {
    const safety = !!(media.attachment_detected_not_processed || media.unsupported_media);
    if (safety && !cleanSpaces(String(text || ''))) return true;
  }
  if (messageType && messageType !== 'text') {
    const safety = !!(media.attachment_detected_not_processed || media.unsupported_media);
    if (safety) return true;
  }
  return false;
}

module.exports = {
  evaluateRouteWithOpenAI,
  buildRouteEvaluatorContext,
  validateRouteDecision,
  fallbackRouteDecision,
  getAdvisorFailureFallbackReply,
  shouldSkipOpenAIRouteEvaluator,
};
