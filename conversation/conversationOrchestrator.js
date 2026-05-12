'use strict';

/**
 * P0 — Conversation Orchestrator (OpenAI primero; código valida y ejecuta CRM después).
 * Este módulo NO escribe DB ni CRM: solo produce/valida decisión estructurada y sugerencias.
 */

const { openai } = require('../services/openaiService');
const { cleanSpaces, normalizeText } = require('../utils/text');
const { safeJsonStringify } = require('../utils/helpers');
const { parseMessageSignals } = require('./parsers');
const { parseQaCommand } = require('./qaCommands');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const STAGES = new Set([
  'new',
  'qualifying',
  'property_followup',
  'seller_capture',
  'valuation',
  'mixed',
  'handoff',
  'safety',
]);

const PRIMARY_INTENTS = new Set([
  'buy',
  'rent',
  'sell',
  'valuation',
  'property_interest',
  'mixed',
  'support',
  'unknown',
]);

function emptyCaptured() {
  return {
    full_name: null,
    location_text: null,
    budget_max: null,
    budget_currency: null,
    property_code: null,
    owner_relation: null,
    property_type: null,
  };
}

function defaultDecision(overrides = {}) {
  return {
    conversation_stage: 'new',
    primary_intent: 'unknown',
    secondary_intents: [],
    lead_flow: null,
    operation_type: null,
    captured_fields: emptyCaptured(),
    missing_fields: [],
    crm_recommendation: {
      should_create_or_update_contact: false,
      should_create_or_update_lead: false,
      lead_reason: null,
    },
    property_action: {
      should_search_properties: false,
      should_fetch_property: false,
      property_code: null,
    },
    reply_strategy: {
      source: 'advisor',
      goal: 'qualify_demand',
      must_ask_name: false,
      must_not_ask_name: false,
      max_questions: 1,
    },
    safety: {
      forbidden_claims: [],
      requires_programmed_reply: false,
      reason: null,
    },
    confidence: 0,
    notes: '',
    ...overrides,
  };
}

/**
 * Contexto compacto para el orchestrator (sin ejecutar CRM).
 */
function buildConversationOrchestratorContext(input = {}) {
  const text = cleanSpaces(String(input.text ?? input.user_message ?? ''));
  const prev = input.previousAiState && typeof input.previousAiState === 'object' ? input.previousAiState : {};
  const sig =
    input.incomingSignals && typeof input.incomingSignals === 'object'
      ? input.incomingSignals
      : parseMessageSignals(text, prev, input.inboundContext || {});
  const contact = input.contact && typeof input.contact === 'object' ? input.contact : null;
  const campaign = input.campaignContext && typeof input.campaignContext === 'object' ? input.campaignContext : null;
  const media = input.inboundContext?.media && typeof input.inboundContext.media === 'object' ? input.inboundContext.media : {};

  return {
    user_message: text,
    previous_ai_state: {
      lead_flow: prev.lead_flow ?? null,
      operation_type: prev.operation_type ?? null,
      awaiting_field: prev.awaiting_field ?? null,
      full_name: prev.full_name ?? null,
      location_text: prev.location_text ?? null,
      budget_max: prev.budget_max ?? null,
      property_code: prev.property_code ?? null,
      direct_property_reference: !!prev.direct_property_reference,
    },
    signals: {
      lead_flow: sig.lead_flow ?? null,
      operation_type: sig.operation_type ?? null,
      location_text: sig.location_text ?? null,
      budget_max: sig.budget_max ?? null,
      full_name: sig.full_name ?? null,
      property_code: sig.property_code ?? null,
      owner_relation: sig.owner_relation ?? null,
      property_type: sig.property_type ?? null,
      intent_type: sig.intent_type ?? null,
    },
    contact_summary: {
      has_display_name: !!(contact && String(contact.full_name || contact.name || '').trim()),
    },
    campaign_property_code: campaign?.property_code || null,
    media: {
      type: media.type || null,
      requires_programmed_safety: !!(media.attachment_detected_not_processed || media.unsupported_media),
    },
  };
}

function coerceNum01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function sanitizeStringArray(v, max = 16) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, max);
}

/**
 * Reglas duras: CRM y safety no salen confiables solo desde OpenAI.
 */
function validateOrchestratorDecision(decision, ctx = {}) {
  const raw = decision && typeof decision === 'object' ? decision : {};
  const sig = ctx.incomingSignals && typeof ctx.incomingSignals === 'object' ? ctx.incomingSignals : {};
  const prevState = ctx.previousAiState && typeof ctx.previousAiState === 'object' ? ctx.previousAiState : {};
  const text = cleanSpaces(String(ctx.text ?? ''));

  let conversation_stage =
    typeof raw.conversation_stage === 'string' ? raw.conversation_stage.trim() : 'new';
  if (!STAGES.has(conversation_stage)) conversation_stage = 'new';

  let primary_intent =
    typeof raw.primary_intent === 'string' ? raw.primary_intent.trim() : 'unknown';
  if (!PRIMARY_INTENTS.has(primary_intent)) primary_intent = 'unknown';

  const secondary_intents = sanitizeStringArray(raw.secondary_intents, 8);

  let lead_flow = raw.lead_flow === 'demand' || raw.lead_flow === 'offer' || raw.lead_flow === 'mixed' ? raw.lead_flow : null;
  let operation_type =
    raw.operation_type === 'sale' || raw.operation_type === 'rent' ? raw.operation_type : null;

  const captured = emptyCaptured();
  const cf = raw.captured_fields && typeof raw.captured_fields === 'object' ? raw.captured_fields : {};
  if (cf.full_name != null && String(cf.full_name).trim()) captured.full_name = String(cf.full_name).trim().slice(0, 80);
  if (cf.location_text != null && String(cf.location_text).trim())
    captured.location_text = String(cf.location_text).trim().slice(0, 120);
  if (cf.budget_max != null && Number.isFinite(Number(cf.budget_max))) captured.budget_max = Number(cf.budget_max);
  if (cf.budget_currency != null && String(cf.budget_currency).trim())
    captured.budget_currency = String(cf.budget_currency).trim().slice(0, 8);
  if (cf.property_code != null && String(cf.property_code).trim())
    captured.property_code = String(cf.property_code).trim().slice(0, 32);
  if (cf.owner_relation != null) captured.owner_relation = cf.owner_relation;
  if (cf.property_type != null && String(cf.property_type).trim())
    captured.property_type = String(cf.property_type).trim().slice(0, 40);

  /** Preferir hechos del parser sobre modelo */
  if (sig.full_name) captured.full_name = String(sig.full_name).trim().slice(0, 80);
  if (sig.location_text) captured.location_text = String(sig.location_text).trim().slice(0, 120);
  if (sig.budget_max != null && Number.isFinite(Number(sig.budget_max))) captured.budget_max = Number(sig.budget_max);
  if (sig.budget_currency) captured.budget_currency = String(sig.budget_currency).trim().slice(0, 8);
  if (sig.property_code) captured.property_code = String(sig.property_code).trim().slice(0, 32);
  if (sig.owner_relation != null) captured.owner_relation = sig.owner_relation;
  if (sig.property_type) captured.property_type = String(sig.property_type).trim().slice(0, 40);

  const missing_fields = sanitizeStringArray(raw.missing_fields, 20);

  const crmRaw = raw.crm_recommendation && typeof raw.crm_recommendation === 'object' ? raw.crm_recommendation : {};
  let should_create_or_update_contact = !!crmRaw.should_create_or_update_contact;
  let should_create_or_update_lead = !!crmRaw.should_create_or_update_lead;
  /** Nunca permitir lead desde modelo sin señales fuertes locales */
  should_create_or_update_lead = false;
  should_create_or_update_contact = !!(sig.full_name || captured.full_name);

  const paRaw = raw.property_action && typeof raw.property_action === 'object' ? raw.property_action : {};
  const locForSearch = sig.location_text || prevState.location_text || null;
  const budgetForSearch =
    sig.budget_max != null && Number.isFinite(Number(sig.budget_max))
      ? Number(sig.budget_max)
      : captured.budget_max != null
      ? Number(captured.budget_max)
      : null;
  const property_action = {
    should_search_properties: !!paRaw.should_search_properties && !!locForSearch && budgetForSearch != null,
    should_fetch_property: !!(paRaw.should_fetch_property && (sig.property_code || captured.property_code)),
    property_code: sig.property_code || captured.property_code || null,
  };

  const rsRaw = raw.reply_strategy && typeof raw.reply_strategy === 'object' ? raw.reply_strategy : {};
  const allowedSources = new Set(['advisor', 'programmed_safety', 'qa_command', 'no_reply']);
  let source = typeof rsRaw.source === 'string' ? rsRaw.source.trim() : 'advisor';
  if (!allowedSources.has(source)) source = 'advisor';

  const reply_strategy = {
    source,
    goal: typeof rsRaw.goal === 'string' ? rsRaw.goal.trim().slice(0, 64) : 'qualify_demand',
    must_ask_name: !!rsRaw.must_ask_name,
    must_not_ask_name: !!rsRaw.must_not_ask_name,
    max_questions: Math.min(3, Math.max(1, Number(rsRaw.max_questions) || 1)),
  };

  const sRaw = raw.safety && typeof raw.safety === 'object' ? raw.safety : {};
  const safety = {
    forbidden_claims: sanitizeStringArray(sRaw.forbidden_claims, 24),
    requires_programmed_reply: !!sRaw.requires_programmed_reply,
    reason: sRaw.reason != null ? String(sRaw.reason).slice(0, 200) : null,
  };

  if (parseQaCommand(text)) {
    reply_strategy.source = 'qa_command';
    safety.requires_programmed_reply = true;
    safety.reason = 'qa_command';
  }

  const confidence = coerceNum01(raw.confidence);
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 500) : '';

  return {
    conversation_stage,
    primary_intent,
    secondary_intents,
    lead_flow,
    operation_type,
    captured_fields: captured,
    missing_fields,
    crm_recommendation: {
      should_create_or_update_contact,
      should_create_or_update_lead,
      lead_reason: crmRaw.lead_reason != null ? String(crmRaw.lead_reason).slice(0, 200) : null,
    },
    property_action,
    reply_strategy,
    safety,
    confidence,
    notes,
  };
}

function logOrchestratorEvent(decision, meta = {}) {
  const payload = {
    event: 'orchestrator_decision',
    orchestrator_confidence: decision.confidence,
    conversation_stage: decision.conversation_stage,
    primary_intent: decision.primary_intent,
    captured_fields: decision.captured_fields,
    reply_strategy: decision.reply_strategy,
    crm_recommendation: decision.crm_recommendation,
    property_action: decision.property_action,
    early_return_blocked: meta.early_return_blocked ?? null,
    advisor_called: meta.advisor_called ?? null,
    response_source: meta.response_source ?? null,
    programmed_reply_reason: meta.programmed_reply_reason ?? null,
    ...meta,
  };
  console.info('perseo_orchestrator_event', safeJsonStringify(payload));
}

/**
 * Fallback determinístico (parseMessageSignals + reglas mínimas).
 */
function fallbackOrchestratorDecision(context = {}) {
  const text = cleanSpaces(String(context.text ?? context.user_message ?? ''));
  const prev = context.previousAiState && typeof context.previousAiState === 'object' ? context.previousAiState : {};
  const inbound = context.inboundContext && typeof context.inboundContext === 'object' ? context.inboundContext : {};
  const sig =
    context.incomingSignals && typeof context.incomingSignals === 'object'
      ? context.incomingSignals
      : parseMessageSignals(text, prev, inbound);

  const media = inbound.media && typeof inbound.media === 'object' ? inbound.media : {};
  if (media.attachment_detected_not_processed || media.unsupported_media) {
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'safety',
        primary_intent: 'support',
        reply_strategy: {
          source: 'programmed_safety',
          goal: 'safety',
          must_ask_name: false,
          must_not_ask_name: true,
          max_questions: 1,
        },
        safety: {
          forbidden_claims: ['No afirmar análisis de multimedia no procesada.'],
          requires_programmed_reply: true,
          reason: 'media_unsupported',
        },
        notes: 'multimedia_safety',
      }),
      { text, incomingSignals: sig, previousAiState: prev }
    );
  }

  if (sig.spam_detected || sig.non_real_estate_or_provider) {
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'safety',
        reply_strategy: {
          source: 'programmed_safety',
          goal: 'safety',
          must_ask_name: false,
          must_not_ask_name: true,
          max_questions: 0,
        },
        safety: { forbidden_claims: [], requires_programmed_reply: true, reason: 'spam_or_non_re' },
        notes: 'hard_block',
      }),
      { text, incomingSignals: sig, previousAiState: prev }
    );
  }

  /** Continuación venta: ubicación (el parser a veces etiqueta demand por patrón geográfico). */
  if (
    prev.lead_flow === 'offer' &&
    (sig.location_text || sig.location_any) &&
    !sig.property_code &&
    !sig.direct_property_reference
  ) {
    const merged = {
      ...sig,
      lead_flow: 'offer',
      operation_type: prev.operation_type || sig.operation_type || 'sale',
      location_text: sig.location_text || prev.location_text || null,
      owner_relation: sig.owner_relation != null ? sig.owner_relation : prev.owner_relation || null,
    };
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'seller_capture',
        primary_intent: 'sell',
        lead_flow: 'offer',
        operation_type: 'sale',
        captured_fields: {
          ...emptyCaptured(),
          location_text: merged.location_text,
          owner_relation: merged.owner_relation,
          full_name: merged.full_name || prev.full_name || null,
        },
        missing_fields: [],
        reply_strategy: {
          source: 'advisor',
          goal: 'qualify_offer',
          must_ask_name: !(merged.full_name || prev.full_name),
          must_not_ask_name: false,
          max_questions: 1,
        },
        confidence: 0.78,
        notes: 'offer_location_followup',
      }),
      { text, incomingSignals: merged, previousAiState: prev }
    );
  }

  /** Oferta activa + intención de compra adicional (mixta; conservar venta como lead_flow principal). */
  if (prev.lead_flow === 'offer' && /\b(comprar|compra)\b/i.test(normalizeText(text))) {
    const merged = {
      ...sig,
      lead_flow: 'offer',
      operation_type: prev.operation_type || 'sale',
      owner_relation: sig.owner_relation || prev.owner_relation || null,
      location_text: sig.location_text || prev.location_text || null,
      full_name: sig.full_name || prev.full_name || null,
    };
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'mixed',
        primary_intent: 'mixed',
        secondary_intents: ['buy'],
        lead_flow: 'offer',
        operation_type: 'sale',
        captured_fields: {
          ...emptyCaptured(),
          full_name: merged.full_name,
          location_text: merged.location_text,
          owner_relation: merged.owner_relation,
        },
        reply_strategy: {
          source: 'advisor',
          goal: 'qualify_offer',
          must_ask_name: false,
          must_not_ask_name: false,
          max_questions: 1,
        },
        confidence: 0.72,
        notes: 'sell_plus_buy_intent',
      }),
      { text, incomingSignals: merged, previousAiState: prev }
    );
  }

  /** Demanda inicial con zona, sin nombre aún */
  if (
    sig.lead_flow === 'demand' &&
    (sig.location_text || sig.location_any) &&
    !prev.lead_flow &&
    !sig.full_name &&
    !sig.direct_property_reference &&
    !sig.unclear_non_real_estate
  ) {
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'qualifying',
        primary_intent: 'buy',
        lead_flow: 'demand',
        operation_type: sig.operation_type || 'sale',
        captured_fields: {
          ...emptyCaptured(),
          location_text: sig.location_text || null,
          property_type: sig.property_type || null,
        },
        missing_fields: ['full_name', 'budget_max'],
        reply_strategy: {
          source: 'advisor',
          goal: 'capture_name',
          must_ask_name: true,
          must_not_ask_name: false,
          max_questions: 1,
        },
        safety: {
          forbidden_claims: [
            'No mencionar publicación, liga ni disponibilidad al momento salvo petición explícita con datos confirmados.',
          ],
          requires_programmed_reply: false,
          reason: null,
        },
        property_action: {
          should_search_properties: false,
          should_fetch_property: false,
          property_code: null,
        },
        confidence: 0.82,
        notes: 'demand_initial_zone',
      }),
      { text, incomingSignals: sig, previousAiState: prev }
    );
  }

  /** Nombre corto cuando el estado esperaba nombre */
  if (
    prev.awaiting_field === 'full_name' &&
    text.length > 0 &&
    text.length < 48 &&
    /^[a-záéíóúñü]{2,24}$/i.test(text.trim()) &&
    !sig.property_code
  ) {
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'qualifying',
        primary_intent: 'buy',
        lead_flow: prev.lead_flow || sig.lead_flow || 'demand',
        operation_type: sig.operation_type || prev.operation_type || 'sale',
        captured_fields: {
          ...emptyCaptured(),
          full_name: text.trim(),
          location_text: sig.location_text || prev.location_text || null,
        },
        missing_fields: ['budget_max'],
        reply_strategy: {
          source: 'advisor',
          goal: 'qualify_demand',
          must_ask_name: false,
          must_not_ask_name: true,
          max_questions: 1,
        },
        confidence: 0.74,
        notes: 'short_name_token',
      }),
      {
        text,
        incomingSignals: { ...sig, full_name: text.trim(), lead_flow: prev.lead_flow || sig.lead_flow },
        previousAiState: prev,
      }
    );
  }

  /** Nombre recién capturado */
  if (sig.full_name && prev.awaiting_field === 'full_name') {
    return validateOrchestratorDecision(
      defaultDecision({
        conversation_stage: 'qualifying',
        primary_intent: 'buy',
        lead_flow: sig.lead_flow || prev.lead_flow || 'demand',
        operation_type: sig.operation_type || prev.operation_type || 'sale',
        captured_fields: {
          ...emptyCaptured(),
          full_name: sig.full_name,
          location_text: sig.location_text || prev.location_text || null,
        },
        missing_fields: ['budget_max'],
        reply_strategy: {
          source: 'advisor',
          goal: 'qualify_demand',
          must_ask_name: false,
          must_not_ask_name: true,
          max_questions: 1,
        },
        confidence: 0.75,
        notes: 'name_captured',
      }),
      { text, incomingSignals: sig, previousAiState: prev }
    );
  }

  /** Presupuesto numérico (incluye contexto previo aunque signals pierdan lead_flow) */
  const budgetVal =
    sig.budget_max != null && Number.isFinite(Number(sig.budget_max))
      ? Number(sig.budget_max)
      : sig.expected_price != null && Number.isFinite(Number(sig.expected_price))
      ? Number(sig.expected_price)
      : null;
  if (budgetVal != null) {
    const hasDemandShape =
      prev.lead_flow === 'demand' ||
      sig.lead_flow === 'demand' ||
      !!prev.location_text ||
      !!sig.location_text ||
      !!prev.full_name ||
      !!sig.full_name;
    if (hasDemandShape) {
      return validateOrchestratorDecision(
        defaultDecision({
          conversation_stage: 'qualifying',
          primary_intent: 'buy',
          lead_flow: 'demand',
          operation_type: sig.operation_type || prev.operation_type || 'sale',
          captured_fields: {
            ...emptyCaptured(),
            full_name: prev.full_name || sig.full_name || null,
            location_text: sig.location_text || prev.location_text || null,
            budget_max: budgetVal,
            budget_currency: sig.budget_currency || prev.budget_currency || 'MXN',
          },
          missing_fields: [],
          property_action: {
            should_search_properties: !!(sig.location_text || prev.location_text),
            should_fetch_property: !!sig.property_code,
            property_code: sig.property_code || null,
          },
          reply_strategy: {
            source: 'advisor',
            goal: 'qualify_demand',
            must_ask_name: false,
            must_not_ask_name: true,
            max_questions: 1,
          },
          confidence: 0.7,
          notes: 'budget_captured',
        }),
        { text, incomingSignals: sig, previousAiState: prev }
      );
    }
  }

  return validateOrchestratorDecision(
    defaultDecision({
      conversation_stage: 'qualifying',
      primary_intent: sig.intent_type === 'demand' ? 'buy' : 'unknown',
      lead_flow: sig.lead_flow || prev.lead_flow || null,
      operation_type: sig.operation_type || prev.operation_type || null,
      notes: 'fallback_default',
    }),
    { text, incomingSignals: sig, previousAiState: prev }
  );
}

/**
 * @param {object} context
 * @param {{ model?: string, openaiClient?: object }} [options]
 */
async function evaluateConversationWithOpenAI(context = {}, options = {}) {
  if (process.env.PERSEO_CONVERSATION_ORCHESTRATOR_MODE === 'fallback_only') {
    const fb = fallbackOrchestratorDecision(context);
    logOrchestratorEvent(fb, { response_source: 'orchestrator_fallback_only' });
    return fb;
  }

  const client = options.openaiClient || openai;
  const model = options.model || DEFAULT_MODEL;
  const payload = buildConversationOrchestratorContext(context);

  const system = `Eres el Conversation Orchestrator de PERSEO (inmobiliaria). Devuelves SOLO JSON válido con las claves exactas solicitadas.
No ejecutes CRM: los flags crm_recommendation son sugerencias; el backend las validará.
conversation_stage: new | qualifying | property_followup | seller_capture | valuation | mixed | handoff | safety
primary_intent: buy | rent | sell | valuation | property_interest | mixed | support | unknown
lead_flow: demand | offer | mixed | null
operation_type: sale | rent | null
reply_strategy.source: advisor | programmed_safety | qa_command | no_reply
reply_strategy.goal: capture_name | qualify_demand | qualify_offer | answer_property_followup | create_lead_handoff | safety`;

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.15,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `ORCHESTRATOR_CONTEXT:\n${safeJsonStringify(payload)}` },
      ],
    });
    const rawText = cleanSpaces(response?.choices?.[0]?.message?.content || '');
    if (!rawText) {
      const fb = fallbackOrchestratorDecision(context);
      logOrchestratorEvent(fb, { response_source: 'orchestrator_empty_model' });
      return fb;
    }
    const parsed = JSON.parse(rawText);
    const v = validateOrchestratorDecision(parsed, {
      text: context.text,
      incomingSignals: context.incomingSignals,
      previousAiState: context.previousAiState,
    });
    logOrchestratorEvent(v, { response_source: 'orchestrator_openai' });
    return v;
  } catch (e) {
    const fb = fallbackOrchestratorDecision(context);
    logOrchestratorEvent(fb, { response_source: 'orchestrator_error', error: String(e?.message || e) });
    return fb;
  }
}

/**
 * Aplica campos capturados validados sobre una copia de ai_state (sin persistir).
 */
function applyDecisionToAiState(decision, aiState = {}) {
  const base = { ...(aiState && typeof aiState === 'object' ? aiState : {}) };
  const d = decision && typeof decision === 'object' ? decision : {};
  const cf = d.captured_fields && typeof d.captured_fields === 'object' ? d.captured_fields : {};
  if (cf.full_name) base.full_name = cf.full_name;
  if (cf.location_text) {
    base.location_text = cf.location_text;
    base.location_any = false;
  }
  if (cf.budget_max != null) base.budget_max = cf.budget_max;
  if (cf.budget_currency) base.budget_currency = cf.budget_currency;
  if (cf.property_code) {
    base.property_code = cf.property_code;
    base.direct_property_reference = true;
  }
  if (cf.owner_relation != null) base.owner_relation = cf.owner_relation;
  if (cf.property_type) base.property_type = cf.property_type;
  if (d.lead_flow) base.lead_flow = d.lead_flow === 'mixed' ? base.lead_flow || 'demand' : d.lead_flow;
  if (d.operation_type) base.operation_type = d.operation_type;
  base.orchestrator_last_decision = {
    conversation_stage: d.conversation_stage,
    primary_intent: d.primary_intent,
    reply_strategy: d.reply_strategy,
    confidence: d.confidence,
    updated_at: new Date().toISOString(),
  };
  return base;
}

/**
 * Contexto final sugerido para OpenAI Advisor (facts + decisión).
 */
function buildAdvisorFinalContext(decision, facts = {}, aiState = {}) {
  return {
    orchestrator: decision,
    facts: facts && typeof facts === 'object' ? facts : {},
    ai_state_snapshot: aiState && typeof aiState === 'object' ? { ...aiState } : {},
  };
}

module.exports = {
  buildConversationOrchestratorContext,
  evaluateConversationWithOpenAI,
  validateOrchestratorDecision,
  fallbackOrchestratorDecision,
  applyDecisionToAiState,
  buildAdvisorFinalContext,
  logOrchestratorEvent,
};
