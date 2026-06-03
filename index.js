require('dotenv').config();

'use strict';

/**
 * PERSEO — Clean Orchestrator (P0)
 *
 * Reemplazo TOTAL de index.js: sin cascadas legacy de playbooks/templates como respuesta final.
 * Orquesta: inbound → dedupe → persist → gatekeeper (Sprint 2) → contexto mínimo → engineV2/fallback consultivo
 * → guardrail obligatorio de nombre → contacto provisional → lead (solo si aplica) → outbound vía sendPerseoAutomatedWhatsApp → WhatsApp.
 *
 * V3-F0 — Congelación legacy: no añadir aquí lógica conversacional nueva ni ramas de tono;
 * migrar evolución a conversation/v3/ (ver docs/sprints/perseo-v3-f0-legacy-freeze.md).
 */

const express = require('express');

const { PORT, VERIFY_TOKEN, getPerseoEngineRuntime } = require('./config/env');
const { supabase } = require('./services/supabaseService');
const { sendPerseoAutomatedWhatsApp } = require('./services/perseoAutomatedWhatsApp');
const { scheduleInboundMediaIngest } = require('./services/inboundMediaStorageIngest');
const { saveConversationMessage, inboundMessageAlreadyProcessed } = require('./services/saveConversationMessage');
const { ensureContactForConversationCore } = require('./services/contactProvisioning');
const { createOrReuseLeadFromConversation, extractCampaignReferralContext } = require('./services/leadAutomation');

const { getDefaultAiState, normalizeAiState } = require('./conversation/aiState');
const { processSprint1QaInbound, parseSprint1StrictCommand, isSprint1QaTesterPhone } = require('./conversation/qaSprint1Commands');
const { resolveAutomatedReplyPolicy } = require('./conversation/perseoGatekeeper');
const { parseMessageSignals } = require('./conversation/parsers');
const { detectStateChange, buildNextState } = require('./conversation/stateUpdater');
const {
  processConversationTurnV2,
  shouldUseConversationEngineV2,
  isEngineV2Enabled,
} = require('./conversation/conversationEngineV2');
const {
  appendNameRequestIfNeeded,
  hasValidHumanName,
  replyAlreadyAsksName: replyAlreadyAsksNameFromPrompt,
} = require('./conversation/namePrompt');
const contextualMemoryResolver = require('./conversation/contextualMemoryResolver');
const { mergeSignalsWithMulti, extractMultiSignals } = require('./conversation/multiSignalExtractor');
const propertyIntentResolver = require('./conversation/propertyIntentResolver');
const propertySpecificFlow = require('./conversation/propertySpecificFlow');
const propertyInventoryService = require('./services/propertyInventoryService');
const leadEntryPointRouter = require('./conversation/leadEntryPointRouter');
const nameFirstGuardrail = require('./conversation/nameFirstGuardrail');
const antiLoopGuardrails = require('./conversation/antiLoopGuardrails');
const r0ContextContinuity = require('./conversation/r0ContextContinuity');
const { extractPossibleName } = require('./conversation/parsers');
const v3InboundBridge = require('./conversation/v3/core/v3InboundBridge');
const { getSession: getV3Session } = require('./conversation/v3/core/sessionStore');
const { mapV3StateToLegacyAiState } = require('./conversation/v3/state/v3ToLegacyAiState');
const { executeV3CrmIfEligible } = require('./conversation/v3/crm/crmExecutor');
const { setSession, getSession } = require('./conversation/v3/core/sessionStore');
const { sanitizeV3PrimaryLegacyAiState } = require('./conversation/v3/state/sanitizeV3PrimaryLegacyAiState');

const { normalizeText, cleanSpaces } = require('./utils/text');
const {
  nowIso,
  safeJsonStringify,
  normalizePhoneNumber,
  buildPhoneLookupValues,
  normalizeOutboundMessages,
  isUsefulContactName,
  isInvalidContactName,
  selectConversationReuseStrategy,
} = require('./utils/helpers');

const app = express();
app.use(express.json({ limit: '10mb' }));

function logEvent(type, payload = {}) {
  console.info(type, safeJsonStringify({ ...(payload || {}), ts: nowIso() }));
}

async function saveConversationEventToClient(client, conversationId, type, payload = {}, createdBy = null) {
  try {
    if (!conversationId || !client) return;
    const { error } = await client.from('conversation_events').insert({
      conversation_id: conversationId,
      type,
      payload,
      created_by: createdBy,
    });
    if (error) console.error('conversation_event_error', error);
  } catch (err) {
    console.error('conversation_event_fatal', err);
  }
}

async function saveConversationEvent(conversationId, type, payload = {}, createdBy = null) {
  return saveConversationEventToClient(supabase, conversationId, type, payload, createdBy);
}

async function updateConversationMetaWithClient(client, conversationId, payload) {
  try {
    if (!conversationId || !client) return;
    const { error } = await client.from('conversations').update(payload).eq('id', conversationId);
    if (error) console.error('conversation_meta_error', error);
  } catch (err) {
    console.error('conversation_meta_fatal', err);
  }
}

async function updateConversationMeta(conversationId, payload) {
  return updateConversationMetaWithClient(supabase, conversationId, payload);
}

async function fetchRecentConversationMessages(conversationId, limit = 20) {
  try {
    if (!conversationId) return [];
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(limit) || 20)));
    if (error) {
      console.error('recent_messages_error', error);
      return [];
    }
    return Array.isArray(data) ? data.reverse() : [];
  } catch (err) {
    console.error('recent_messages_fatal', err);
    return [];
  }
}

async function getOrCreateConversation(phone) {
  try {
    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const phoneLookupValues = buildPhoneLookupValues(normalizedPhone);

    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('*')
      .eq('channel', 'whatsapp')
      .in('phone', phoneLookupValues)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);

    if (findError) {
      console.error('conversation_find_error', findError);
      return { id: null, ai_state: getDefaultAiState(), phone: normalizedPhone };
    }

    const rows = Array.isArray(existing) ? existing : [];
    const reuse = selectConversationReuseStrategy(rows, normalizedPhone);
    if (reuse.reusableConversation?.id) {
      const row = reuse.reusableConversation;
      if (reuse.shouldNormalizeReusablePhone && normalizedPhone && row.phone !== normalizedPhone) {
        await supabase.from('conversations').update({ phone: normalizedPhone }).eq('id', row.id);
        return { ...row, phone: normalizedPhone };
      }
      return row;
    }

    const createSeed = reuse.createSeed || {};
    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({
        channel: 'whatsapp',
        phone: normalizedPhone,
        status: 'open',
        priority: 'medium',
        last_message_at: nowIso(),
        ai_state: getDefaultAiState(),
        contact_id: createSeed.contact_id || null,
        lead_id: createSeed.lead_id || null,
        assigned_agent_profile_id: createSeed.assigned_agent_profile_id || null,
        external_contact_id: createSeed.external_contact_id || null,
      })
      .select()
      .single();

    if (createError) {
      console.error('conversation_create_error', createError);
      return { id: null, ai_state: getDefaultAiState(), phone: normalizedPhone };
    }
    return created;
  } catch (err) {
    console.error('conversation_get_or_create_fatal', err);
    return { id: null, ai_state: getDefaultAiState(), phone };
  }
}

async function fetchContactByWhatsApp(phone) {
  try {
    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const lookupValues = buildPhoneLookupValues(normalizedPhone);
    const orFilter = lookupValues
      .flatMap((value) => [
        `phone.eq.${value}`,
        `whatsapp.eq.${value}`,
        `phone_normalized.eq.${value}`,
        `whatsapp_normalized.eq.${value}`,
      ])
      .join(',');

    const { data, error } = await supabase.from('contacts').select('*').or(orFilter).limit(1);
    if (error) {
      console.error('contact_lookup_error', error);
      return null;
    }
    return (Array.isArray(data) && data[0]) || null;
  } catch (err) {
    console.error('contact_lookup_fatal', err);
    return null;
  }
}

function extractInboundMessage(reqBody) {
  const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0] || null;
  return { value, message };
}

function extractMetaMessageId(message) {
  const id = message?.id;
  return id != null ? String(id).trim() : '';
}

function extractFromPhone(message) {
  const from = message?.from;
  return from != null ? String(from).trim() : '';
}

function extractTextFromInbound(message) {
  const type = message?.type || null;
  if (type === 'text') return cleanSpaces(message?.text?.body || '');
  if (type === 'button') return cleanSpaces(message?.button?.text || '');
  if (type === 'interactive') {
    const i = message?.interactive || {};
    const btn = i?.button_reply?.title || i?.button_reply?.id || '';
    const list = i?.list_reply?.title || i?.list_reply?.id || '';
    return cleanSpaces(btn || list || '');
  }
  if (type === 'image') return cleanSpaces(message?.image?.caption || '');
  if (type === 'document') {
    return cleanSpaces(message?.document?.caption || message?.document?.filename || '');
  }
  if (type === 'audio') return cleanSpaces(message?.audio?.caption || '');
  if (type === 'video') return cleanSpaces(message?.video?.caption || '');
  if (type === 'voice') return cleanSpaces(message?.voice?.caption || '');
  return cleanSpaces(message?.text?.body || message?.caption || '');
}

function extractWaProfileDisplayName(value = {}, rawFromPhone = '') {
  if (!value || typeof value !== 'object') return null;
  const normalizedFrom =
    normalizePhoneNumber(rawFromPhone) || String(rawFromPhone || '').replace(/[\s\-+()]/g, '');
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  for (const c of contacts) {
    const cw = normalizePhoneNumber(c?.wa_id) || String(c?.wa_id || '').replace(/[\s\-+()]/g, '');
    if (!cw || !normalizedFrom) continue;
    if (cw === normalizedFrom) {
      const n = c?.profile?.name;
      if (typeof n === 'string' && n.trim()) return n.trim();
    }
  }
  return null;
}

function isUsefulWaProfileName(waProfileName) {
  const p = cleanSpaces(String(waProfileName || ''));
  if (!p) return false;
  return isUsefulContactName(p) && !isInvalidContactName(p);
}

function requiresName(contact, aiState, waProfileName) {
  return !hasValidHumanName(contact, aiState) && !isUsefulWaProfileName(waProfileName);
}

function replyAlreadyAsksName(reply) {
  return replyAlreadyAsksNameFromPrompt(reply);
}

function operationalDemandContextComplete(aiState = {}) {
  return (
    aiState?.lead_flow === 'demand' &&
    !!cleanSpaces(String(aiState?.location_text || '')) &&
    aiState?.budget_max != null &&
    Number.isFinite(Number(aiState.budget_max))
  );
}

function enforceNameCapture(reply, context = {}) {
  const {
    contact = null,
    aiState = {},
    waProfileName = null,
    recentOutboundTexts = [],
    userInboundText = '',
    leadFlow = null,
    inboundFrustration = null,
    hasValidHumanNameFn = null,
  } = context;

  const frustration = inboundFrustration && typeof inboundFrustration === 'object' ? inboundFrustration : { frustrated: false };
  const nameOkFn = typeof hasValidHumanNameFn === 'function' ? hasValidHumanNameFn : hasValidHumanName;

  if (aiState?.handoff_sent) return { reply, applied: false, statePatch: { awaiting_field: null } };
  if (!requiresName(contact, aiState, waProfileName)) return { reply, applied: false };
  const merged = Array.isArray(reply) ? reply.join('\n\n') : String(reply || '');
  if (replyAlreadyAsksName(merged)) return { reply, applied: false };

  if (frustration.frustrated) {
    if (aiState?.handoff_sent) {
      return { reply, applied: false, statePatch: { awaiting_field: null } };
    }
    if (aiState?.awaiting_field === 'full_name' && !cleanSpaces(String(aiState?.full_name || ''))) {
      return {
        reply: antiLoopGuardrails.buildFrustrationRecoveryReply({
          aiState,
          contact,
          userText: userInboundText,
          hasValidHumanNameFn: nameOkFn,
        }),
        applied: true,
        reason: 'frustration_name_loop_break',
        statePatch: { awaiting_field: null, complaint_followup: true },
      };
    }
    if (cleanSpaces(merged)) {
      return { reply, applied: false, statePatch: { awaiting_field: null } };
    }
  }

  // Insistir si ya estamos esperando nombre y el usuario no lo dio.
  if (aiState?.awaiting_field === 'full_name' && !cleanSpaces(String(aiState?.full_name || ''))) {
    if (frustration.frustrated) {
      return {
        reply: antiLoopGuardrails.buildFrustrationRecoveryReply({
          aiState,
          contact,
          userText: userInboundText,
          hasValidHumanNameFn: nameOkFn,
        }),
        applied: true,
        reason: 'frustration_instead_of_name_insist',
        statePatch: { awaiting_field: null, complaint_followup: true },
      };
    }
    const insist = [cleanSpaces(merged), 'Para registrarte bien y orientarte mejor, ¿me compartes tu nombre?']
      .filter(Boolean)
      .join('\n\n');
    return { reply: insist, applied: true, reason: 'awaiting_full_name_insist' };
  }

  if (frustration.frustrated && cleanSpaces(merged)) {
    return { reply, applied: false, statePatch: { awaiting_field: null } };
  }

  const nameAppendMode = operationalDemandContextComplete(aiState) ? 'name_only' : 'default';

  const packed = appendNameRequestIfNeeded(reply, {
    contact,
    aiState,
    waProfileDisplayName: waProfileName,
    recentOutboundTexts,
    userInboundText,
    leadFlow,
    wantsVisit: false,
    nameAppendMode,
  });
  return { reply: packed.messages, applied: true, reason: 'append_name_request' };
}

/**
 * Cuarzo §15 — no escribir lead legacy hasta slots mínimos (zona + presupuesto en demanda).
 */
function hasMinimumSlotsForLegacyCrmWrite(aiState = {}, signals = {}) {
  const { resolvePautaPropertyCrmContext } = require('./conversation/pautaDetection');
  if (aiState?.meta_lead_form_flow === true) {
    return !!(
      cleanSpaces(String(aiState?.full_name || signals?.full_name || '')) ||
      cleanSpaces(String(aiState?.location_text || signals?.location_text || ''))
    );
  }
  if (resolvePautaPropertyCrmContext(aiState).bypassEligible) return true;
  if (propertyIntentResolver.isPropertySpecificConversation(aiState)) return true;
  const flow = aiState?.lead_flow || signals?.lead_flow;
  if (flow === 'offer') {
    return !!cleanSpaces(String(aiState?.location_text || signals?.location_text || ''));
  }
  if (flow === 'demand') {
    const loc = cleanSpaces(String(aiState?.location_text || signals?.location_text || ''));
    const budget =
      aiState?.budget_max != null &&
      Number.isFinite(Number(aiState.budget_max)) &&
      Number(aiState.budget_max) > 0;
    return !!loc && budget;
  }
  return false;
}

function hasClearRealEstateIntent(signals = {}, text = '', aiState = {}) {
  if (signals?.lead_flow === 'demand' || signals?.lead_flow === 'offer') return true;
  if (signals?.property_code || signals?.direct_property_reference) return true;
  if (aiState?.lead_flow === 'demand' || aiState?.lead_flow === 'offer') return true;
  if (aiState?.direct_property_reference && (aiState?.property_code || aiState?.direct_property_code)) return true;
  const t = normalizeText(text);
  return (
    t.includes('busco') ||
    t.includes('comprar') ||
    t.includes('rentar') ||
    t.includes('renta') ||
    t.includes('vender') ||
    t.includes('venta') ||
    t.includes('casa') ||
    t.includes('depa') ||
    t.includes('departamento') ||
    t.includes('propiedad') ||
    t.includes('valu')
  );
}

function hasConversationCapturedFullName(aiState = {}) {
  return !!cleanSpaces(String(aiState?.full_name || ''));
}

/**
 * V3-F0 LEGACY FREEZE — Fallback consultivo productivo.
 * Hotfix only (P0/security). Nuevas capacidades → PERSEO Conversational Core V3.
 */
function buildConsultiveFallbackReply({
  text,
  signals,
  aiState,
  contact = null,
  waProfileName = null,
  resolvedPropertyRow = undefined,
  recentMessages = [],
}) {
  const t = normalizeText(text);
  const loc = cleanSpaces(signals?.location_text || aiState?.location_text || '');
  const conversationNameOk = hasConversationCapturedFullName(aiState);
  const hasName = hasValidHumanName(contact, aiState);

  if (propertyIntentResolver.isPropertySpecificConversation(aiState)) {
    return propertyIntentResolver.buildPropertyModeReply({
      text,
      aiState,
      propertyRow: resolvedPropertyRow === undefined ? null : resolvedPropertyRow,
      hasValidName: conversationNameOk,
      recentMessages,
      contact,
      waProfileName,
    });
  }

  if (
    contextualMemoryResolver.isOptionsRequestText(text) &&
    aiState?.lead_flow === 'demand' &&
    !r0ContextContinuity.isR0StickySaleCaptureThread(aiState) &&
    contextualMemoryResolver.hasOperationalContext(aiState)
  ) {
    const demandReply = contextualMemoryResolver.buildContextualDemandReply({
      aiState,
      text,
      hasValidName: hasName,
      matchedProperties: [],
    });
    return (
      demandReply ||
      'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.'
    );
  }

  if (
    r0ContextContinuity.isR0StickySaleCaptureThread(aiState) &&
    !r0ContextContinuity.explicitDemandSearchIntent(text)
  ) {
    return r0ContextContinuity.buildSaleCaptiveContinuityReply({
      text,
      aiState,
      loc,
      hasValidHumanName: hasName,
    });
  }

  if (signals?.lead_flow === 'offer' || t.includes('vender') || t.includes('venta') || t.includes('valu')) {
    const zoneAsk = loc ? '' : ' Y dime también en qué zona está la propiedad.';
    return `Claro, te puedo orientar con la venta.${zoneAsk}`;
  }

  if ((signals?.lead_flow === 'demand' || t.includes('busco') || t.includes('comprar') || t.includes('rentar')) && loc) {
    const hasBudget = aiState?.budget_max != null && Number.isFinite(Number(aiState.budget_max));
    if (hasBudget) {
      if (hasName) {
        return `Claro, sigo con tu búsqueda en ${loc}. ¿Quieres afinar recámaras, amenidades o zona más específica?`;
      }
      return `Claro, sigo con tu búsqueda en ${loc}. Para registrarte bien, ¿me compartes tu nombre?`;
    }
    return `Claro, te ayudo a buscar casa en ${loc}. Para registrarte bien, ¿me compartes tu nombre? Y dime también tu presupuesto aproximado.`;
  }

  if (t.includes('precio')) {
    return 'Claro, te apoyo con el precio. Para revisarlo bien, te hago una pregunta rápida.';
  }

  if (t.includes('disponible') || t.includes('disponibilidad')) {
    return 'Claro, te apoyo con la disponibilidad. Para confirmarlo correctamente, te hago una pregunta rápida.';
  }

  if (!t || t === 'hola') {
    return 'Hola, claro. Te puedo ayudar. Dime en una frase qué necesitas y lo revisamos.';
  }
  if (t === 'info' || t === 'informacion' || t === 'información') {
    return 'Te puedo orientar con compra o renta, venta de tu propiedad, avalúo o seguimiento de un anuncio. ¿Cuál es tu caso en una sola frase?';
  }
  if (t === 'me interesa') {
    return 'Perfecto. Cuéntame en una frase qué te interesa (comprar, rentar, vender o ver una propiedad) y lo vemos.';
  }

  return 'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.';
}

/**
 * P0.1.1 — Si el fallback consultivo ya pidió zona de captación, reflejar awaiting_field.
 */
function consultiveFallbackAwaitingFieldPatch(reply, { signals, aiState, text }) {
  const merged = Array.isArray(reply)
    ? reply.map((s) => String(s || '').trim()).filter(Boolean).join('\n\n')
    : String(reply || '');
  const m = cleanSpaces(merged);
  if (!m) return {};
  const flow = signals?.lead_flow || aiState?.lead_flow;
  const loc = cleanSpaces(String(signals?.location_text || aiState?.location_text || ''));
  const t = normalizeText(String(text || ''));
  const offerish =
    flow === 'offer' ||
    r0ContextContinuity.isR0StickySaleCaptureThread(aiState) ||
    t.includes('vender') ||
    t.includes('venta') ||
    t.includes('valu');
  if (!offerish || loc) return {};
  if (/colonia|municipio|zona.*propiedad|en qué zona|en que zona/i.test(m)) {
    return { awaiting_field: 'location_text' };
  }
  return {};
}

async function saveConversationState(conversationId, nextState) {
  try {
    if (!conversationId) return;
    const { error } = await supabase
      .from('conversations')
      .update({ ai_state: nextState, updated_at: nowIso(), last_message_at: nowIso() })
      .eq('id', conversationId);
    if (error) console.error('conversation_state_error', error);
  } catch (err) {
    console.error('conversation_state_fatal', err);
  }
}

/** Normaliza códigos tipo A0470 / LUX-A0470 para lookup en public.properties.listing_id */
function normalizeListingCodeForLookup(raw) {
  if (raw == null) return null;
  const c = String(raw).trim().toUpperCase();
  if (!c) return null;
  if (c.startsWith('LUX-')) return c;
  const m = c.match(/^([A-Z])(\d{4})$/);
  if (m) return `LUX-${m[1]}${m[2]}`;
  return c;
}

async function fetchPropertyByListingCode(db, rawCode) {
  const inv = await propertyInventoryService.findPropertyByCode(db, rawCode, console);
  return { property: inv.property, propertyId: inv.propertyId };
}

function buildPropertyContextSnapshot(row) {
  if (!row || !row.id) return null;
  const n = propertyInventoryService.normalizeInventoryProperty(row);
  if (!n) return null;
  return {
    id: n.id,
    listing_id: n.code,
    operation_type: n.operation_type,
    price: n.price,
    title: n.title,
    neighborhood: n.neighborhood,
    city: n.city,
    slug: n.slug,
    property_type: n.property_type,
    bedrooms: n.bedrooms,
    bathrooms: n.bathrooms,
    terrain_m2: n.terrain_m2,
    construction_m2: n.construction_m2,
    status: n.status,
    public_url: n.public_url,
    operation_label: n.operation_label,
  };
}

async function saveOutboundMessages({ conversationId, messages, rawPayload = {} }) {
  const outbound = normalizeOutboundMessages(messages);
  const rows = [];
  for (const messageText of outbound) {
    const row = await saveConversationMessage(supabase, {
      conversationId,
      direction: 'outbound',
      senderType: 'ai_agent',
      messageType: 'text',
      messageText,
      rawPayload,
    });
    if (row?.id) rows.push(row);
  }
  return { outbound, rows };
}

/**
 * CRM post-respuesta: contacto provisional + lead (solo public.leads vía createOrReuseLeadFromConversation).
 * @returns {{ hasIntent: boolean, canEnsureContact: boolean, contactId: string|null, leadResult: object|null }}
 */
async function runCleanOrchestratorCrmPhase({
  supabase: db = supabase,
  conversationId,
  conversationRow,
  nextAiState,
  parsedSignals,
  text,
  contact,
  from,
  waProfileName,
  rawPayload,
  property = null,
  propertyId = null,
  crmGateContext = null,
}) {
  const resolvedPropertyId = propertyId != null ? propertyId : property?.id || null;
  const {
    shouldAllowCrmExecuteForInbound,
    logCrmExecuteGate,
  } = require('./config/crmExecuteInboundGate');
  const { resolvePautaPropertyCrmContext } = require('./conversation/pautaDetection');
  const pautaPropertyCtx = resolvePautaPropertyCrmContext(nextAiState, {
    propertyId: resolvedPropertyId,
  });

  const crmGate = shouldAllowCrmExecuteForInbound({
    phone: from,
    conversationId,
    v3PrimaryAllowed: crmGateContext?.v3PrimaryAllowed === true,
    selectedPipeline: crmGateContext?.selectedPipeline || 'legacy',
    aiState: nextAiState,
    propertyId: resolvedPropertyId,
  });
  if (typeof crmGateContext?.logEvent === 'function') {
    logCrmExecuteGate(crmGateContext.logEvent, crmGate);
  }
  if (!crmGate.crm_execute_allowed) {
    return {
      hasIntent: false,
      canEnsureContact: false,
      contactId: null,
      leadResult: null,
      crmSkipped: true,
      crm_execute_block_reason: crmGate.block_reason,
    };
  }

  const hasIntent = hasClearRealEstateIntent(parsedSignals, text, nextAiState);
  const canEnsureContact =
    hasIntent &&
    (hasValidHumanName(contact, nextAiState) ||
      isUsefulWaProfileName(waProfileName) ||
      (pautaPropertyCtx.bypassEligible && !!pautaPropertyCtx.propertyCode));

  let contactId = null;
  let contactWasCreated = false;
  if (canEnsureContact) {
    const contactResult = await ensureContactForConversationCore({
      supabase: db,
      conversationRow,
      state: nextAiState,
      phone: from,
      waName: waProfileName,
      source: 'whatsapp',
      rawPayload,
      property,
      logger: console,
      saveConversationEvent: (cid, type, payload, createdBy) =>
        saveConversationEventToClient(db, cid, type, payload, createdBy),
      updateConversationMeta: (cid, payload) => updateConversationMetaWithClient(db, cid, payload),
    });
    contactId = contactResult?.contactId || null;
    contactWasCreated = !!contactResult?.wasCreated;
  }

  let leadResult = null;
  const crmSlotsReady = hasMinimumSlotsForLegacyCrmWrite(nextAiState, parsedSignals);
  if (hasIntent && contactId && crmSlotsReady) {
    logEvent('lead_create_attempted', { conversation_id: conversationId, contact_id: contactId });
    leadResult = await createOrReuseLeadFromConversation({
      supabase: db,
      conversation: conversationRow,
      aiState: nextAiState,
      contactId,
      propertyId: resolvedPropertyId,
      property,
      contactWasCreated,
      logger: console,
    });

    if (leadResult?.success && leadResult?.wasCreated) {
      logEvent('lead_created', { conversation_id: conversationId, lead_id: leadResult.leadId || null });
      if (crmGate.crm_execute_bypass_reason === 'pauta_property' || pautaPropertyCtx.bypassEligible) {
        await saveConversationEventToClient(db, conversationId, 'property_pauta_lead_autocreated', {
          lead_id: leadResult.leadId,
          interested_property_id: resolvedPropertyId,
          property_code: pautaPropertyCtx.propertyCode,
          assigned_agent_profile_id: leadResult.assignedAgentProfileId,
          assignment_strategy: leadResult.assignmentResult?.strategy || null,
          source: 'legacy_crm_phase',
          crm_execute_bypass_reason: crmGate.crm_execute_bypass_reason || 'pauta_property',
        });
      }
    } else if (leadResult?.success && !leadResult?.wasCreated) {
      logEvent('lead_reused', { conversation_id: conversationId, lead_id: leadResult.leadId || null });
    } else {
      logEvent('lead_skipped', { conversation_id: conversationId, reason: leadResult?.reason || 'unknown' });
    }
  } else if (hasIntent && !contactId) {
    logEvent('lead_skipped', { conversation_id: conversationId, reason: 'missing_contact' });
  } else if (hasIntent && contactId && !crmSlotsReady) {
    logEvent('lead_skipped', {
      conversation_id: conversationId,
      reason: 'minimum_slots_not_met',
      lead_flow: nextAiState?.lead_flow || parsedSignals?.lead_flow || null,
    });
  }

  return { hasIntent, canEnsureContact, contactId, leadResult, crmSlotsReady };
}

// ──────────────────────────────────────────────────────────────────────────────
// Webhook endpoints
// ──────────────────────────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const webhookStart = Date.now();
  try {
    const { value, message } = extractInboundMessage(req.body);
    if (!message) {
      res.sendStatus(200);
      return;
    }

    const metaMessageId = extractMetaMessageId(message);
    const rawFrom = extractFromPhone(message);
    const from = normalizePhoneNumber(rawFrom) || rawFrom;
    const waProfileName = extractWaProfileDisplayName(value, rawFrom);
    const text = extractTextFromInbound(message);

    logEvent('inbound_received', {
      meta_message_id: metaMessageId || null,
      from,
      from_raw: rawFrom || null,
      message_type: message?.type || null,
      engine_v2_enabled: isEngineV2Enabled(),
    });

    if (!metaMessageId || !from) {
      res.sendStatus(200);
      return;
    }

    const dup = await inboundMessageAlreadyProcessed(supabase, metaMessageId);
    if (dup) {
      logEvent('inbound_duplicate_skipped', { meta_message_id: metaMessageId, from });
      res.sendStatus(200);
      return;
    }

    let conversationRow = await getOrCreateConversation(from);
    const conversationId = conversationRow?.id || null;

    try {
      const { checkFloodProtection, endWebhookTiming } = require('./conversation/v3/runtime/runtimeSafety');
      const flood = checkFloodProtection(conversationId || from);
      if (!flood.allowed) {
        logEvent('runtime_flood_blocked', {
          conversation_id: conversationId,
          count: flood.count,
        });
        res.sendStatus(200);
        endWebhookTiming(webhookStart);
        return;
      }
    } catch (_floodErr) {
      /* non-blocking */
    }

    const previousAiState = normalizeAiState(conversationRow?.ai_state);

    await saveConversationEvent(conversationId, 'conversation_resolved', {
      conversation_id: conversationId,
      from,
    });

    const inboundRow = await saveConversationMessage(supabase, {
      conversationId,
      direction: 'inbound',
      senderType: 'lead',
      messageType: message?.type || 'text',
      messageText: text,
      metaMessageId,
      rawPayload: req.body || {},
    });

    if (inboundRow?.conversation_id && conversationId && inboundRow.conversation_id !== conversationId) {
      logEvent('inbound_duplicate_cross_conversation', {
        meta_message_id: metaMessageId,
        expected_conversation_id: conversationId,
        existing_conversation_id: inboundRow.conversation_id,
      });
      res.sendStatus(200);
      return;
    }

    logEvent('inbound_persisted', {
      conversation_id: conversationId,
      inbound_message_id: inboundRow?.id || null,
    });

    const policy = await resolveAutomatedReplyPolicy({ supabase, conversationRow, from });
    if (policy.policyResolution === 'error') {
      logEvent('perseo_policy_fail_closed', {
        conversation_id: conversationId,
        reason_code: policy.reason_code,
      });
      await saveConversationEvent(conversationId, 'perseo_policy_resolution_failed', {
        reason_code: policy.reason_code,
      });
    }

    if (inboundRow?.id) {
      scheduleInboundMediaIngest({
        supabase,
        logEvent,
        conversationId,
        inboundMessageId: inboundRow.id,
        message,
      });
    }

    const sprintQa = await processSprint1QaInbound({
      text,
      from,
      conversationId,
      conversationRow,
      metaMessageId,
      supabase,
      getDefaultAiState,
      normalizeAiState,
      nowIso,
      saveEventFn: (cid, type, payload, createdBy) =>
        saveConversationEventToClient(supabase, cid, type, payload, createdBy),
      saveStateFn: saveConversationState,
      updateConversationFn: updateConversationMetaWithClient,
      conversations: null,
      isQaExecutionAllowed: isSprint1QaTesterPhone,
      getV3Session: getSession,
      setV3Session: setSession,
      logEvent,
    });

    if (sprintQa?.unauthorized) {
      await saveConversationEvent(conversationId, 'qa_command_unauthorized', sprintQa.payload);
      logEvent('qa_command_unauthorized', sprintQa.payload);
    }

    if (sprintQa?.handled) {
      const cmd = parseSprint1StrictCommand(text);
      if (cmd === 'reset') {
        v3InboundBridge.clearSession(conversationId);
      }
      if (cmd === 'resetcrm' && sprintQa.conversationUpdate?.lead_id === null) {
        conversationRow = { ...conversationRow, lead_id: null };
      }
      const reply = sprintQa.messages;
      await sendPerseoAutomatedWhatsApp({
        channel: 'qa',
        to: from,
        messages: reply,
        conversationId,
        rawPayload: { perseo_metadata: { response_source: 'qa_sprint1', qa_command: cmd } },
        policy,
        saveOutboundMessages,
        saveConversationEvent,
        logEvent,
      });
      res.sendStatus(200);
      return;
    }

    const recentMessages = await fetchRecentConversationMessages(conversationId, 20);
    const contact = await fetchContactByWhatsApp(from);
    await saveConversationEvent(conversationId, 'contact_resolved', {
      has_contact: !!contact,
      has_valid_name: hasValidHumanName(contact, previousAiState),
    });

    const inboundContext = { media: { type: message?.type || 'text' } };
    const slotSanitizer = require('./conversation/slotSanitizer');
    let parsedSignals = mergeSignalsWithMulti(
      parseMessageSignals(text, previousAiState, inboundContext),
      extractMultiSignals(text, previousAiState)
    );
    parsedSignals = slotSanitizer.sanitizeInboundSignals(parsedSignals, previousAiState);
    Object.assign(parsedSignals, propertyIntentResolver.resolvePropertyIntent(text, previousAiState));
    leadEntryPointRouter.applyEntryClassificationToSignals(parsedSignals, text, previousAiState);
    const earlyExtractedName = extractPossibleName(text, previousAiState, parsedSignals.owner_relation);
    if (earlyExtractedName) parsedSignals.full_name = earlyExtractedName;

    parsedSignals = r0ContextContinuity.applyR0StickySignalsGuard(previousAiState, parsedSignals, text);

    const changeType = detectStateChange(previousAiState, parsedSignals);
    let nextAiState = buildNextState(previousAiState, parsedSignals, changeType);
    Object.assign(nextAiState, contextualMemoryResolver.mergeContextualSignals(parsedSignals, previousAiState, nextAiState, text));
    Object.assign(nextAiState, leadEntryPointRouter.reassertEntryLeadFlow(nextAiState, parsedSignals.__entry_point_meta));

    let property = null;
    let propertyId = null;
    let resolvedPropertyRow = undefined;
    if (propertyIntentResolver.isPropertySpecificConversation(nextAiState)) {
      const codeForFetch = cleanSpaces(String(nextAiState.property_code || nextAiState.direct_property_code || ''));
      if (codeForFetch) {
        const hintZone = cleanSpaces(String(parsedSignals.location_text || nextAiState.location_text || ''));
        const resolved = await propertyInventoryService.findPropertyByInventoryReference(
          supabase,
          {
            code: codeForFetch,
            text,
            hintZone: hintZone || propertyInventoryService.extractZoneFromPropertyPhrase(text),
          },
          console
        );
        property = resolved.property;
        propertyId = resolved.propertyId;
        resolvedPropertyRow = property;
        nextAiState.interested_property_id = propertyId != null ? propertyId : null;
        nextAiState.property_context = property ? buildPropertyContextSnapshot(property) : null;
        if (property?.id) {
          const codeKey = propertyInventoryService.normalizeInventoryCode(codeForFetch) || codeForFetch;
          Object.assign(
            nextAiState,
            propertyInventoryService.pushPropertyHistory(nextAiState, {
              code: codeKey,
              interested_property_id: propertyId,
            })
          );
          Object.assign(
            nextAiState,
            propertyInventoryService.mergePropertyContextCache(
              nextAiState,
              codeKey,
              propertyInventoryService.getPropertyPublicFacts(property)
            )
          );
        }
      }
    }

    const inboundFrustration = antiLoopGuardrails.detectConversationalFrustration(text);
    Object.assign(nextAiState, antiLoopGuardrails.buildStaleAwaitingFieldPatch(nextAiState, parsedSignals, text, contact));

    const engineV2 = isEngineV2Enabled() && shouldUseConversationEngineV2({ text, parsedSignals, inboundContext });

    let reply;
    let responseSource = 'fallback_consultive';
    let nameFirstHandled = false;
    let v3PrimaryHandled = false;
    let skipLegacyCrm = false;
    let selectedPipeline = 'legacy';

    if (policy.allowAutomatedReply) {
      const cuarzoHandoff = require('./conversation/cuarzoHandoff');
      const cuarzoFallbacks = require('./conversation/cuarzoFallbacks');

      const earlyPostHandoff = cuarzoHandoff.resolvePostHandoffTurn({
        previousAiState,
        nextAiState,
        text,
      });
      if (earlyPostHandoff.handled) {
        reply = earlyPostHandoff.reply;
        Object.assign(nextAiState, earlyPostHandoff.statePatch || {});
        responseSource = earlyPostHandoff.responseSource || 'cuarzo_post_handoff';
        nameFirstHandled = true;
        v3PrimaryHandled = true;
        logEvent('cuarzo_post_handoff', { conversation_id: conversationId, source: responseSource });
      }

      const { campaignContext } = extractCampaignReferralContext({
        aiState: previousAiState,
        referral: previousAiState?.whatsapp_referral || null,
        rawPayload: inboundRow?.raw_payload || req.body || {},
        messageText: text,
      });
      const campaignHeadline =
        (campaignContext && (campaignContext.headline || campaignContext.ad_name)) || null;

      const legacyHydration = {
        propertyListingCode:
          cleanSpaces(
            String(
              nextAiState.property_code ||
                nextAiState.direct_property_code ||
                previousAiState.property_code ||
                previousAiState.direct_property_code ||
                ''
            )
          ) || null,
        locationText: previousAiState.location_text || null,
        campaignHeadline: campaignHeadline || previousAiState.campaignHeadline || null,
      };
      if (property?.id) {
        try {
          const rowForNorm = property.raw && property.raw.id ? property.raw : property;
          const ap = propertyInventoryService.normalizeInventoryProperty(rowForNorm);
          if (ap && ap.id) {
            const { raw: _omitRaw, ...snapshot } = ap;
            legacyHydration.activeProperty = snapshot;
          }
        } catch (e) {
          logEvent('v3_active_property_normalize_fail', {
            conversation_id: conversationId,
            message: String(e && e.message ? e.message : e),
          });
        }
      }

      let v3Media = null;
      if (message?.type && message.type !== 'text') {
        try {
          const { resolveInboundMediaForV3Turn } = require('./services/inboundMediaV3Bridge');
          const mediaResolved = await resolveInboundMediaForV3Turn({
            message,
            conversationId,
            messageId: metaMessageId,
            logEvent,
          });
          v3Media = mediaResolved.media;
          if (mediaResolved.fallback_reason) {
            logEvent('media_v3_fallback', {
              conversation_id: conversationId,
              reason: mediaResolved.fallback_reason,
              fail_open: mediaResolved.fail_open,
            });
          }
        } catch (mediaErr) {
          logEvent('media_v3_bridge_error', {
            conversation_id: conversationId,
            error: String(mediaErr?.message || mediaErr),
          });
        }
      }

      const { tryMetaLeadFormCaptureTurn } = require('./conversation/metaLeadFormCapture');
      const metaLeadTurn = tryMetaLeadFormCaptureTurn({
        text,
        message,
        campaignContext,
        previousAiState,
        parsedSignals,
      });
      if (metaLeadTurn.handled) {
        reply = metaLeadTurn.reply;
        Object.assign(nextAiState, metaLeadTurn.statePatch || {});
        Object.assign(parsedSignals, metaLeadTurn.signalsPatch || {});
        responseSource = metaLeadTurn.responseSource || 'meta_lead_form_c1';
        nameFirstHandled = true;
        logEvent('meta_lead_form_c1_ack', { conversation_id: conversationId });
      }

      const v3Try =
        metaLeadTurn.handled
          ? { handled: false }
          : await v3InboundBridge.tryV3PrimaryReply({
              conversationId,
              phone: from,
              rawPhone: rawFrom,
              text,
              media: v3Media,
              logEvent,
              saveConversationEvent,
              campaignHeadline,
              legacyHydration,
              persistedLegacyAiState: previousAiState,
              supabase,
            });
      if (v3Try.handled) {
        v3PrimaryHandled = true;
        selectedPipeline = 'v3';
        skipLegacyCrm = !!v3Try.skipLegacyCrm;
        reply = v3Try.reply;
        responseSource = v3Try.responseSource || 'v3_core_f2';
        if (v3Try.v3State) {
          let v3StateForCrm = v3Try.v3State;
          let crmOut = null;
          const { isClosureGateActive } = require('./conversation/v3/runtime/closureIntegrity');
          const { runWithTimeout } = require('./utils/runWithTimeout');
          const closureGateActive = isClosureGateActive(v3Try.v3State);
          const {
            shouldAllowCrmExecuteForInbound,
            logCrmExecuteGate,
            persistCrmExecuteGateEvent,
          } = require('./config/crmExecuteInboundGate');
          const crmExecuteGate = shouldAllowCrmExecuteForInbound({
            phone: from,
            rawPhone: rawFrom,
            conversationId,
            v3PrimaryAllowed: true,
            selectedPipeline: 'v3',
            aiState: nextAiState,
            propertyId: propertyId != null ? propertyId : property?.id ?? null,
          });
          logCrmExecuteGate(logEvent, crmExecuteGate);
          await persistCrmExecuteGateEvent(saveConversationEvent, conversationId, crmExecuteGate);

          if (skipLegacyCrm && !closureGateActive && crmExecuteGate.crm_execute_allowed) {
            crmOut = await runWithTimeout(
              () =>
                executeV3CrmIfEligible({
                  v3State: v3Try.v3State,
                  phone: from,
                  rawPhone: rawFrom,
                  conversationRow,
                  supabase,
                  property,
                  propertyId,
                  waProfileName,
                  rawPayload: req.body || null,
                  logEvent,
                  ensureContactForConversation: ensureContactForConversationCore,
                  createOrReuseLeadFromConversation,
                  saveConversationEvent,
                  updateConversationMeta,
                }),
              Number(process.env.PERSEO_CLOSURE_CRM_TIMEOUT_MS || 2500),
              null,
            );
            if (crmOut?.v3State) {
              v3StateForCrm = crmOut.v3State;
              setSession(conversationId, v3StateForCrm);
            }
          } else if (skipLegacyCrm && !closureGateActive && !crmExecuteGate.crm_execute_allowed) {
            logEvent('v3_crm_execute_skipped', {
              conversation_id: conversationId,
              block_reason: crmExecuteGate.block_reason,
            });
          }
          Object.assign(nextAiState, mapV3StateToLegacyAiState(v3StateForCrm));
          sanitizeV3PrimaryLegacyAiState(nextAiState);
          if (crmOut?.leadResult?.aiState?.qa_crm_force_new_lead === false) {
            nextAiState.qa_crm_force_new_lead = false;
          }
        }
        logEvent('v3_primary_reply', {
          conversation_id: conversationId,
          route: v3Try.route,
          allowlist_match: v3Try.gate?.allowlist_match,
        });
      } else if (v3Try.fallback) {
        logEvent('v3_primary_fallback_legacy', {
          conversation_id: conversationId,
          reason: v3Try.reason || null,
          block_reason: v3Try.blockReason || v3Try.gate?.v3_primary_block_reason || null,
        });
      }

      if (!v3PrimaryHandled) {
      const {
        resolveLegacyClosureTurn,
        shouldBlockLegacyCommercialReply,
        tryResolveLegacyConsentClosure,
      } = require('./conversation/v3/runtime/closureIntegrity');

      if (!nameFirstHandled) {
        const frHandoff = cuarzoHandoff.resolveFrustrationTerminalHandoff({
          previousAiState,
          nextAiState,
          text,
          inboundFrustration,
        });
        if (frHandoff.handled) {
          reply = frHandoff.reply;
          Object.assign(nextAiState, frHandoff.statePatch || {});
          nameFirstHandled = true;
          responseSource = frHandoff.responseSource || 'cuarzo_frustration_handoff';
          logEvent('cuarzo_frustration_handoff', { conversation_id: conversationId });
        }
      }

      if (!nameFirstHandled) {
        const oosTurn = cuarzoFallbacks.resolveCuarzoOutOfScopeTurn({
          text,
          parsedSignals,
          inboundContext,
          previousAiState,
          nextAiState,
        });
        if (oosTurn.handled) {
          reply = oosTurn.reply;
          Object.assign(nextAiState, oosTurn.statePatch || {});
          nameFirstHandled = true;
          responseSource = oosTurn.responseSource || 'cuarzo_out_of_scope';
          logEvent('cuarzo_out_of_scope', {
            conversation_id: conversationId,
            source: responseSource,
            pending_version: oosTurn.pending_version || null,
          });
        }
      }

      const legacyConsentClosure = tryResolveLegacyConsentClosure({
        text,
        previousAiState,
        nextAiState,
      });
      if (legacyConsentClosure?.handled) {
        reply = legacyConsentClosure.reply;
        Object.assign(nextAiState, legacyConsentClosure.statePatch || {});
        responseSource = legacyConsentClosure.responseSource || 'closure_integrity_legacy_consent';
        nameFirstHandled = true;
        logEvent('closure_integrity_legacy_consent', { conversation_id: conversationId });
      }
      if (
        !nameFirstHandled &&
        (shouldBlockLegacyCommercialReply(previousAiState) ||
          shouldBlockLegacyCommercialReply(nextAiState))
      ) {
        const legacyClosure = resolveLegacyClosureTurn({
          text,
          previousAiState,
          nextAiState,
          conversationId,
          saveConversationEvent,
        });
        if (legacyClosure?.handled) {
          reply = legacyClosure.reply;
          Object.assign(nextAiState, legacyClosure.statePatch || {});
          responseSource = legacyClosure.responseSource || 'closure_integrity_legacy';
          nameFirstHandled = true;
          logEvent('closure_integrity_legacy', { conversation_id: conversationId });
        }
      }

      if (!nameFirstHandled) {
      const humanEscalation = require('./conversation/humanEscalation');
      const humanEsc = humanEscalation.resolveWantsHumanEscalationTurn({
        previousAiState,
        nextAiState,
        parsedSignals,
        text,
      });
      if (humanEsc.handled) {
        reply = humanEsc.reply;
        Object.assign(nextAiState, humanEsc.statePatch);
        nameFirstHandled = true;
        responseSource = humanEsc.responseSource || 'wants_human_auto_escalation';
        logEvent('wants_human_auto_escalation', { conversation_id: conversationId });
      }
      }

      if (!nameFirstHandled) {
      const guard = nameFirstGuardrail.evaluateInboundTurn({
        text,
        previousAiState,
        nextAiState,
        contact,
        waProfileName,
        recentMessages,
        propertyRow: property,
        entryMeta: parsedSignals.__entry_point_meta,
      });
      if (guard.handled) {
        reply = guard.reply;
        Object.assign(nextAiState, guard.statePatch);
        nameFirstHandled = true;
        responseSource = 'name_first_guardrail';
        logEvent('name_first_guardrail', { conversation_id: conversationId });
      }

      if (!nameFirstHandled && engineV2) {
        const v2 = await processConversationTurnV2({
          text,
          conversationId,
          phone: from,
          previousAiState,
          conversationRow,
          contact,
          lead: null,
          recentMessages,
          inboundContext,
          unifiedContext: null,
          referralContext: null,
          campaignContext: null,
          media: inboundContext.media,
          propertiesContext: { matchedProperties: [] },
          parsedSignals,
          routeEvaluatorDecision: null,
          waProfileDisplayName: waProfileName,
          changeType,
          logger: console,
        });

        reply = v2.outboundMessages;
        nextAiState = v2.nextAiState || nextAiState;
        Object.assign(nextAiState, contextualMemoryResolver.mergeContextualSignals(parsedSignals, previousAiState, nextAiState, text));
        responseSource = v2.responseSource || 'engine_v2';
        logEvent('advisor_reply_generated', { response_source: responseSource, engine_v2_used: true });
      }

      if (!nameFirstHandled && !engineV2 && !shouldBlockLegacyCommercialReply(nextAiState)) {
        reply = buildConsultiveFallbackReply({
          text,
          signals: parsedSignals,
          aiState: nextAiState,
          contact,
          waProfileName,
          resolvedPropertyRow,
          recentMessages,
        });
        const fbLoop = antiLoopGuardrails.applyFallbackStreakRecovery(reply, {
          nextAiState,
          text,
          contact,
          waProfileName,
        });
        reply = fbLoop.reply;
        Object.assign(nextAiState, fbLoop.patch);
        Object.assign(
          nextAiState,
          consultiveFallbackAwaitingFieldPatch(reply, {
            signals: parsedSignals,
            aiState: nextAiState,
            text,
          })
        );
        logEvent('advisor_reply_generated', { response_source: responseSource, engine_v2_used: false });
      }

      const subHasName = propertyIntentResolver.isPropertySpecificConversation(nextAiState)
        ? hasConversationCapturedFullName(nextAiState)
        : hasValidHumanName(contact, nextAiState);
      const subCtx = contextualMemoryResolver.substituteForbiddenGenericDemandReply(reply, {
        text,
        aiState: nextAiState,
        hasValidName: subHasName,
        matchedProperties: [],
        resolvedPropertyRow,
        recentMessages,
        contact,
        waProfileName,
      });
      Object.assign(nextAiState, subCtx.statePatch);
      reply = subCtx.messages;

      const recentOutboundTexts = Array.isArray(recentMessages)
        ? recentMessages
            .filter((r) => r?.direction === 'outbound')
            .map((r) => String(r?.message_text || ''))
            .filter(Boolean)
        : [];

      const enforced = nameFirstHandled
        ? { reply, applied: false }
        : enforceNameCapture(reply, {
            contact,
            aiState: nextAiState,
            waProfileName,
            recentOutboundTexts,
            userInboundText: text,
            leadFlow: nextAiState.lead_flow || parsedSignals.lead_flow || null,
            inboundFrustration,
            hasValidHumanNameFn: hasValidHumanName,
          });

      if (enforced.statePatch && typeof enforced.statePatch === 'object') {
        Object.assign(nextAiState, enforced.statePatch);
      }

      if (enforced.applied) {
        logEvent('name_required_guardrail_applied', { conversation_id: conversationId, reason: enforced.reason || null });
        await saveConversationEvent(conversationId, 'name_required_guardrail_applied', {
          reason: enforced.reason || null,
          response_source: responseSource,
        });
        const skipAwaitingReassert =
          enforced.reason === 'frustration_name_loop_break' ||
          enforced.reason === 'frustration_instead_of_name_insist';
        if (!nextAiState.full_name && !skipAwaitingReassert) nextAiState.awaiting_field = 'full_name';
      }

      reply = enforced.reply;

      const nearDup = antiLoopGuardrails.applyOutboundNearDuplicateGuard(reply, {
        recentOutboundTexts,
        userInboundText: text,
        nextAiState,
      });
      reply = nearDup.reply;
      Object.assign(nextAiState, nearDup.patch);

      antiLoopGuardrails.recordTurnAntiLoopMeta(nextAiState, reply, responseSource);

      if (propertyIntentResolver.isPropertySpecificConversation(nextAiState)) {
        const mergedReplyText = Array.isArray(reply) ? reply.join('\n\n') : String(reply || '');
        const intent = nameFirstHandled
          ? { type: 'property_intro' }
          : propertySpecificFlow.classifyPropertyFollowUp(text, nextAiState, recentMessages);
        Object.assign(
          nextAiState,
          propertySpecificFlow.markPropertyReplyProgress(nextAiState, {
            intentType: intent.type,
            replyText: mergedReplyText,
          })
        );
      }

      if (cleanSpaces(String(nextAiState.full_name || '')) && nextAiState.awaiting_field === 'full_name') {
        nextAiState.awaiting_field = null;
      }

      try {
        v3InboundBridge.maybeRunV3Shadow({
          conversationId,
          phone: from,
          rawPhone: rawFrom,
          text,
          legacyReply: reply,
          logEvent,
        });
      } catch (v3ShadowErr) {
        console.error('v3_shadow_fatal', v3ShadowErr);
      }
      }
      }

    } else {
      reply = [];
      responseSource = 'automation_gated_skip';
      nameFirstHandled = false;
      logEvent('perseo_automation_orchestration_skipped', {
        conversation_id: conversationId,
        reason_code: policy.reason_code,
        policy_resolution: policy.policyResolution,
      });
      if (policy.policyResolution === 'ok') {
        await saveConversationEvent(conversationId, 'ai_auto_response_skipped_human_attention', {
          reason_code: policy.reason_code,
          policy_resolution: policy.policyResolution,
          gate: 'pre_orchestration',
        });
      }
    }

    await saveConversationState(conversationId, nextAiState);

    if (nextAiState.handoff_summary && !previousAiState.handoff_summary) {
      await saveConversationEvent(conversationId, 'cuarzo_handoff_summary', {
        handoff_summary: nextAiState.handoff_summary,
        response_source: responseSource,
      });
    }

    const {
      shouldAllowCrmExecuteForInbound,
      logCrmExecuteGate,
      persistCrmExecuteGateEvent,
    } = require('./config/crmExecuteInboundGate');
    const crmExecuteGate = shouldAllowCrmExecuteForInbound({
      phone: from,
      rawPhone: rawFrom,
      conversationId,
      v3PrimaryAllowed: v3PrimaryHandled,
      selectedPipeline,
      aiState: nextAiState,
      propertyId,
    });
    logCrmExecuteGate(logEvent, crmExecuteGate);
    await persistCrmExecuteGateEvent(saveConversationEvent, conversationId, crmExecuteGate);

    if (!skipLegacyCrm && crmExecuteGate.crm_execute_allowed) {
      await runCleanOrchestratorCrmPhase({
        supabase,
        conversationId,
        conversationRow,
        nextAiState,
        parsedSignals,
        text,
        contact,
        from,
        waProfileName,
        rawPayload: req.body || null,
        property,
        propertyId,
        crmGateContext: {
          v3PrimaryAllowed: v3PrimaryHandled,
          selectedPipeline,
          logEvent,
        },
      });
    } else if (!skipLegacyCrm) {
      logEvent('legacy_crm_execute_skipped', {
        conversation_id: conversationId,
        block_reason: crmExecuteGate.block_reason,
        selected_pipeline: selectedPipeline,
        v3_primary_handled: v3PrimaryHandled,
      });
    } else {
      logEvent('v3_skip_legacy_crm', { conversation_id: conversationId });
    }

    await sendPerseoAutomatedWhatsApp({
      channel: 'ia',
      to: from,
      messages: reply,
      conversationId,
      rawPayload: { perseo_metadata: { response_source: responseSource } },
      policy,
      saveOutboundMessages,
      saveConversationEvent,
      logEvent,
    });

    try {
      const { endWebhookTiming } = require('./conversation/v3/runtime/runtimeSafety');
      endWebhookTiming(webhookStart);
    } catch (_t) {
      /* non-blocking */
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('webhook_post_fatal', err);
    try {
      const { endWebhookTiming } = require('./conversation/v3/runtime/runtimeSafety');
      endWebhookTiming(webhookStart);
    } catch (_t) {
      /* non-blocking */
    }
    res.sendStatus(200);
  }
});

const { argosAuthMiddleware } = require('./argos/middleware/argosAuth');
const internalArgosRouter = require('./argos/routes/internalArgosRouter');
app.use('/internal/argos', argosAuthMiddleware, internalArgosRouter);

const { perseoCronAuthMiddleware } = require('./middleware/perseoCronAuth');
const internalJobsRouter = require('./routes/internalJobsRouter');
app.use('/internal/jobs', perseoCronAuthMiddleware, internalJobsRouter);

if (require.main === module) {
  app.listen(PORT, () => {
    const engineRt = getPerseoEngineRuntime();
    logEvent('server_started', {
      port: PORT,
      perseo_policy_v2_reads_global_settings: process.env.PERSEO_POLICY_V2_ENABLED === 'true',
      perseo_policy_debug_log: process.env.PERSEO_POLICY_DEBUG_LOG === 'true',
      perseo_engine_requested: engineRt.requested,
      perseo_engine_effective: engineRt.effective,
      perseo_engine_v3_reserved_ignored: engineRt.v3Ignored,
    });
  });
}

const { processInboundForArgos } = require('./argos/processInboundForArgos');

module.exports = {
  app,
  _private: {
    processInboundForArgos,
    requiresName,
    replyAlreadyAsksName,
    enforceNameCapture,
    buildConsultiveFallbackReply,
    mergeContextualSignals: contextualMemoryResolver.mergeContextualSignals,
    substituteForbiddenGenericDemandReply: contextualMemoryResolver.substituteForbiddenGenericDemandReply,
    hasOperationalContext: contextualMemoryResolver.hasOperationalContext,
    runCleanOrchestratorCrmPhase,
    normalizeListingCodeForLookup,
    fetchPropertyByListingCode,
  },
};

