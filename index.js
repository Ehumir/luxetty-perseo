require('dotenv').config();

'use strict';

/**
 * PERSEO — Clean Orchestrator (P0)
 *
 * Reemplazo TOTAL de index.js: sin cascadas legacy de playbooks/templates como respuesta final.
 * Orquesta: inbound → dedupe → persist → contexto mínimo → engineV2/fallback consultivo
 * → guardrail obligatorio de nombre → contacto provisional → lead (solo si aplica) → outbound → WhatsApp.
 */

const express = require('express');

const { PORT, VERIFY_TOKEN } = require('./config/env');
const { supabase } = require('./services/supabaseService');
const { axios, WHATSAPP_TOKEN, PHONE_NUMBER_ID } = require('./services/whatsappService');
const { saveConversationMessage, inboundMessageAlreadyProcessed } = require('./services/saveConversationMessage');
const { ensureContactForConversationCore } = require('./services/contactProvisioning');
const { createOrReuseLeadFromConversation } = require('./services/leadAutomation');

const { getDefaultAiState, normalizeAiState } = require('./conversation/aiState');
const { processSprint1QaInbound, parseSprint1StrictCommand, isSprint1QaTesterPhone } = require('./conversation/qaSprint1Commands');
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
const contextualReferenceResolver = require('./conversation/contextualReferenceResolver');
const conversationalStateMachine = require('./conversation/conversationalStateMachine');

const { normalizeText, cleanSpaces } = require('./utils/text');
const {
  nowIso,
  safeJsonStringify,
  normalizePhoneNumber,
  buildPhoneLookupValues,
  normalizeOutboundMessages,
  isUsefulContactName,
  isInvalidContactName,
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
      .limit(1);

    if (findError) {
      console.error('conversation_find_error', findError);
      return { id: null, ai_state: getDefaultAiState(), phone: normalizedPhone };
    }

    const row = Array.isArray(existing) ? existing[0] : null;
    if (row?.id) return row;

    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({
        channel: 'whatsapp',
        phone: normalizedPhone,
        status: 'open',
        priority: 'medium',
        last_message_at: nowIso(),
        ai_state: getDefaultAiState(),
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
  } = context;

  if (!requiresName(contact, aiState, waProfileName)) return { reply, applied: false };
  const merged = Array.isArray(reply) ? reply.join('\n\n') : String(reply || '');
  if (replyAlreadyAsksName(merged)) return { reply, applied: false };

  // Insistir si ya estamos esperando nombre y el usuario no lo dio.
  if (aiState?.awaiting_field === 'full_name' && !cleanSpaces(String(aiState?.full_name || ''))) {
    const insist = [cleanSpaces(merged), 'Para registrarte bien y orientarte mejor, ¿me compartes tu nombre?']
      .filter(Boolean)
      .join('\n\n');
    return { reply: insist, applied: true, reason: 'awaiting_full_name_insist' };
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

  if (
    conversationNameOk &&
    (t.includes('ya te di') || t.includes('ya dije') || t.includes('te dije')) &&
    t.includes('nombre')
  ) {
    const fn = cleanSpaces(String(aiState.full_name || '')).split(/\s+/).filter(Boolean)[0];
    return fn ? `Sí ${fn}, ya quedó registrado. ¿En qué más te apoyo?` : 'Sí, ya quedó registrado. ¿En qué más te apoyo?';
  }

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
    contextualMemoryResolver.hasOperationalContext(aiState)
  ) {
    return contextualMemoryResolver.buildContextualDemandReply({
      aiState,
      text,
      hasValidName: hasName,
      matchedProperties: [],
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

  if (!t || t === 'hola' || t === 'info' || t === 'informacion' || t === 'información' || t === 'me interesa') {
    return 'Hola, claro. Te puedo ayudar. Dime en una frase qué necesitas y lo revisamos.';
  }

  return 'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.';
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

async function sendWhatsAppText(to, body) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function sendWhatsAppMessages(to, messages) {
  const outbound = normalizeOutboundMessages(messages);
  for (const body of outbound) await sendWhatsAppText(to, body);
  return outbound;
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
}) {
  const hasIntent = hasClearRealEstateIntent(parsedSignals, text, nextAiState);
  const canEnsureContact =
    hasIntent && (hasValidHumanName(contact, nextAiState) || isUsefulWaProfileName(waProfileName));

  let contactId = null;
  if (canEnsureContact) {
    contactId = await ensureContactForConversationCore({
      supabase: db,
      conversationRow,
      state: nextAiState,
      phone: from,
      waName: waProfileName,
      source: 'whatsapp',
      rawPayload,
      saveConversationEvent: (cid, type, payload, createdBy) =>
        saveConversationEventToClient(db, cid, type, payload, createdBy),
      updateConversationMeta: (cid, payload) => updateConversationMetaWithClient(db, cid, payload),
    });
  }

  const resolvedPropertyId = propertyId != null ? propertyId : property?.id || null;

  let leadResult = null;
  if (hasIntent && contactId) {
    logEvent('lead_create_attempted', { conversation_id: conversationId, contact_id: contactId });
    leadResult = await createOrReuseLeadFromConversation({
      supabase: db,
      conversation: conversationRow,
      aiState: nextAiState,
      contactId,
      propertyId: resolvedPropertyId,
      property,
      logger: console,
    });

    if (leadResult?.success && leadResult?.wasCreated) {
      logEvent('lead_created', { conversation_id: conversationId, lead_id: leadResult.leadId || null });
    } else if (leadResult?.success && !leadResult?.wasCreated) {
      logEvent('lead_reused', { conversation_id: conversationId, lead_id: leadResult.leadId || null });
    } else {
      logEvent('lead_skipped', { conversation_id: conversationId, reason: leadResult?.reason || 'unknown' });
    }
  } else if (hasIntent && !contactId) {
    logEvent('lead_skipped', { conversation_id: conversationId, reason: 'missing_contact' });
  }

  return { hasIntent, canEnsureContact, contactId, leadResult };
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

    const conversationRow = await getOrCreateConversation(from);
    const conversationId = conversationRow?.id || null;
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

    logEvent('inbound_persisted', {
      conversation_id: conversationId,
      inbound_message_id: inboundRow?.id || null,
    });

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
    });

    if (sprintQa?.unauthorized) {
      await saveConversationEvent(conversationId, 'qa_command_unauthorized', sprintQa.payload);
      logEvent('qa_command_unauthorized', sprintQa.payload);
    }

    if (sprintQa?.handled) {
      const cmd = parseSprint1StrictCommand(text);
      const reply = sprintQa.messages;
      await saveOutboundMessages({
        conversationId,
        messages: reply,
        rawPayload: { perseo_metadata: { response_source: 'qa_sprint1', qa_command: cmd } },
      });
      logEvent('outbound_persisted', { conversation_id: conversationId });
      await sendWhatsAppMessages(from, reply);
      logEvent('whatsapp_sent', { conversation_id: conversationId });
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
    const parsedSignals = mergeSignalsWithMulti(
      parseMessageSignals(text, previousAiState, inboundContext),
      extractMultiSignals(text, previousAiState)
    );
    Object.assign(parsedSignals, propertyIntentResolver.resolvePropertyIntent(text, previousAiState));

    const ctxResolved = contextualReferenceResolver.resolveContextualPropertyCode({
      text,
      aiState: previousAiState,
      recentMessages,
    });
    if (ctxResolved.propertyCode && !parsedSignals.property_code) {
      Object.assign(parsedSignals, contextualReferenceResolver.buildPropertySignalsFromResolution(ctxResolved));
    }
    Object.assign(
      parsedSignals,
      conversationalStateMachine.computeSignalPatch({
        text,
        prevAiState: previousAiState,
        parsedSignals,
      })
    );
    Object.assign(
      parsedSignals,
      conversationalStateMachine.applySellerLocationStickyPatch({
        text,
        prevAiState: previousAiState,
        parsedSignals,
      })
    );

    const changeType = detectStateChange(previousAiState, parsedSignals);
    let nextAiState = buildNextState(previousAiState, parsedSignals, changeType);
    Object.assign(nextAiState, contextualMemoryResolver.mergeContextualSignals(parsedSignals, previousAiState, nextAiState, text));

    const engineV2 = isEngineV2Enabled() && shouldUseConversationEngineV2({ text, parsedSignals, inboundContext });

    let reply;
    let responseSource = 'fallback_consultive';

    if (engineV2) {
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

    if (!engineV2) {
      reply = buildConsultiveFallbackReply({
        text,
        signals: parsedSignals,
        aiState: nextAiState,
        contact,
        waProfileName,
        resolvedPropertyRow,
        recentMessages,
      });
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

    const enforced = enforceNameCapture(reply, {
      contact,
      aiState: nextAiState,
      waProfileName,
      recentOutboundTexts,
      userInboundText: text,
      leadFlow: nextAiState.lead_flow || parsedSignals.lead_flow || null,
    });

    if (enforced.applied) {
      logEvent('name_required_guardrail_applied', { conversation_id: conversationId, reason: enforced.reason || null });
      await saveConversationEvent(conversationId, 'name_required_guardrail_applied', {
        reason: enforced.reason || null,
        response_source: responseSource,
      });
      if (!nextAiState.full_name) nextAiState.awaiting_field = 'full_name';
    }

    reply = enforced.reply;

    if (propertyIntentResolver.isPropertySpecificConversation(nextAiState)) {
      const mergedReplyText = Array.isArray(reply) ? reply.join('\n\n') : String(reply || '');
      const intent = propertySpecificFlow.classifyPropertyFollowUp(text, nextAiState, recentMessages);
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

    await saveConversationState(conversationId, nextAiState);

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
    });

    await saveOutboundMessages({
      conversationId,
      messages: reply,
      rawPayload: { perseo_metadata: { response_source: responseSource } },
    });
    logEvent('outbound_persisted', { conversation_id: conversationId });

    await sendWhatsAppMessages(from, reply);
    logEvent('whatsapp_sent', { conversation_id: conversationId });

    res.sendStatus(200);
  } catch (err) {
    console.error('webhook_post_fatal', err);
    res.sendStatus(200);
  }
});

if (require.main === module) {
  app.listen(PORT, () => logEvent('server_started', { port: PORT }));
}

module.exports = {
  app,
  _private: {
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

