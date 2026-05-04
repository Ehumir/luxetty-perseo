require('dotenv').config();

const express = require('express');

const {
  PORT,
  VERIFY_TOKEN,
  OPENAI_MODEL,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
} = require('./config/env');

const {
  LOCATION_CACHE_TTL_MS,
  MAX_SHORT_MEMORY_MESSAGES,
  DEFAULT_PROPERTY_LIMIT,
  SEARCH_BUDGET_FALLBACK_MULTIPLIER,
} = require('./config/constants');

const {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
} = require('./conversation/perseoConsultantPrompt');

const { supabase } = require('./services/supabaseService');
const { openai } = require('./services/openaiService');
const { axios } = require('./services/whatsappService');
const {
  createOrReuseLeadFromConversation,
  detectLeadCreationOpportunity,
  extractCampaignReferralContext,
  buildLeadContextFromConversation,
  buildStructuredSellerCrmSummary,
} = require('./services/leadAutomation');
const { runInactivityFollowups } = require('./services/followupAutomation');
const { persistConversationReferral } = require('./services/referralService');

const { getDefaultAiState, normalizeAiState } = require('./conversation/aiState');
const { parseMessageSignals } = require('./conversation/parsers');
const {
  buildInboundMessageContext,
  buildMediaAcknowledgementReply,
  buildImageVisionContextPrefix,
} = require('./conversation/mediaSignals');
const { buildUnifiedConversationContext } = require('./conversation/contextFusion');
const {
  extractInboundMediaMetadata,
  extractInboundSignalText,
} = require('./conversation/mediaIngestion');
const { resolveInboundMedia } = require('./services/whatsappMediaService');
const { transcribeAudio } = require('./services/audioTranscriptionService');
const { analyzeImage } = require('./services/imageVisionService');
const { getNextStep } = require('./conversation/nextStep');
const {
  getNextPlaybookStep,
  getPlaybookAwaitingField,
  buildPlaybookReply,
} = require('./conversation/playbooks');
const { detectStateChange, buildNextState } = require('./conversation/stateUpdater');
const {
  qualifiesOfferGeo,
  qualifiesOfferValue,
  shouldRunPropertySearch,
} = require('./conversation/searchRules');
const {
  buildAiSummary,
  buildLowInfoCampaignReply,
  buildDemandReply,
  buildOfferReply,
  buildFallbackOpenAIReply,
  buildFinalHandoffReply,
  buildPropertyPriceReply,
} = require('./conversation/responseBuilder');

const { normalizeText, cleanSpaces } = require('./utils/text');
const {
  uniq,
  nowIso,
  sanitizeReply,
  safeJsonStringify,
  normalizePhoneNumber,
  isUsefulContactName,
  extractWhatsAppReferral,
  normalizeOutboundMessages,
} = require('./utils/helpers');
const { isGreetingOnly } = require('./utils/messageChecks');

const app = express();
app.use(express.json({ limit: '10mb' }));
const DEBUG_MEDIA_PIPELINE = String(process.env.DEBUG_MEDIA_PIPELINE || '').toLowerCase() === 'true';

console.log('ENV CHECK:', {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI: !!process.env.OPENAI_API_KEY,
  WHATSAPP: !!process.env.WHATSAPP_TOKEN,
  PHONE_ID: !!process.env.PHONE_NUMBER_ID,
});

const conversations = new Map();

const locationCatalog = {
  loadedAt: 0,
  rawNames: [],
  normalizedMap: new Map(),
};

function sanitizeDebugErrorMessage(message = '') {
  const text = String(message || '');
  const withoutBearer = text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return withoutBearer.replace(/https?:\/\/\S+/gi, '[URL_REDACTED]').slice(0, 240);
}

function logDebugMediaPipeline(label, payload = {}) {
  if (!DEBUG_MEDIA_PIPELINE) return;
  try {
    console.log(`[DEBUG_MEDIA_PIPELINE] ${label}`, payload);
  } catch (_) {
    // no-op
  }
}

function isClosureCheck(text) {
  const t = normalizeText(text);
  return (
    t.includes('es todo') ||
    t.includes('algo mas') ||
    t.includes('algo más') ||
    t === 'bueno' ||
    t === 'ok' ||
    t === 'gracias' ||
    t === 'listo'
  );
}

function getNextStepCta(nextStep) {
  if (nextStep === 'qualify_search') {
    return '¿Prefieres ver opciones disponibles o que un asesor de Luxetty te contacte?';
  }

  if (nextStep === 'push_visit') {
    return '¿Deseas coordinar una visita o prefieres que un asesor de Luxetty te contacte?';
  }

  if (nextStep === 'qualify_property') {
    return '¿Me compartes los datos de la propiedad para revisarla contigo?';
  }

  return '¿En qué puedo orientarte? ¿Buscas comprar, rentar, vender o necesitas hablar con un asesor?';
}

function hasConversationAdvance(reply) {
  const text = normalizeText(reply);
  if (!text) return false;
  if (/[?¿]\s*$/.test(String(reply).trim())) return true;

  return (
    text.includes('te contactara') ||
    text.includes('te contactará') ||
    text.includes('te conecto') ||
    text.includes('asesor de luxetty') ||
    text.includes('puedo canalizar') ||
    text.includes('te ayudo a coordinar') ||
    text.includes('te ayudo a buscar') ||
    text.includes('te muestro opciones') ||
    text.includes('avanzamos con un asesor')
  );
}

function enrichReplyWithNextStepCta(reply, nextStep) {
  const base = cleanSpaces(reply || '');
  if (!base) return getNextStepCta(nextStep);
  if (hasConversationAdvance(base)) return base;
  return `${base} ${getNextStepCta(nextStep)}`;
}

function shouldUseMediaAcknowledgement(media = {}, incomingSignals = {}, previousAiState = {}, nextAiState = {}) {
  if (!media || !media.type) return false;

  if (media.type === 'audio' || media.type === 'voice') {
    return !!media.audio_without_transcription;
  }

  if (media.type !== 'image' && media.type !== 'document') {
    return true;
  }

  const hasIntentContext =
    !!incomingSignals?.lead_flow ||
    !!incomingSignals?.intent_type ||
    !!incomingSignals?.property_code ||
    !!previousAiState?.lead_flow ||
    !!nextAiState?.lead_flow;

  if (media.type === 'image' && hasIntentContext) {
    return false;
  }

  return true;
}

function prependVisionPrefixIfNeeded(reply, media = {}, aiState = {}) {
  const baseReply = cleanSpaces(reply || '');
  if (!baseReply) return baseReply;

  const prefix = buildImageVisionContextPrefix(media, aiState);
  if (!prefix) return baseReply;

  const normalizedBase = normalizeText(baseReply);
  if (normalizedBase.includes(normalizeText(prefix))) return baseReply;

  return `${prefix} ${baseReply}`;
}

function buildIntelligentHandoffReply() {
  return 'Para darte una atención más precisa, puedo canalizar tu caso con un asesor de Luxetty que te apoye directamente.';
}

function hasValidPropertySlug(property) {
  const slug = typeof property?.slug === 'string' ? property.slug.trim() : '';
  return !!slug && !/\s/.test(slug);
}

function mapInboundMessageType(messageType) {
  if (messageType === 'text') return 'text';
  if (messageType === 'audio') return 'audio';
  if (messageType === 'voice') return 'voice';
  if (messageType === 'image') return 'image';
  if (messageType === 'document') return 'document';
  if (messageType === 'video') return 'video';
  if (messageType === 'sticker') return 'sticker';
  if (messageType === 'location') return 'location';
  if (messageType === 'contact' || messageType === 'contacts') return 'contact';
  if (messageType === 'button' || messageType === 'interactive') return 'interactive';
  if (messageType === 'list_reply' || messageType === 'button_reply') return 'interactive';
  if (messageType === 'referral') return 'referral';
  if (messageType === 'unsupported' || messageType === 'unknown') return 'unsupported';
  return 'system';
}

function isDirectPriceQuestion(text) {
  const normalized = normalizeText(text);
  return (
    normalized === 'precio' ||
    normalized.includes('precio') ||
    normalized.includes('cuanto cuesta') ||
    normalized.includes('cuánto cuesta') ||
    normalized.includes('cuanto vale') ||
    normalized.includes('cuánto vale')
  );
}

function applyPlaybookProgress(state, context = {}) {
  const progress = getNextPlaybookStep(state, context);
  state.playbook_type = progress.playbook_type;
  state.playbook = progress.playbook;
  state.playbook_step = progress.playbook_step;
  return progress;
}

function getIntentFamily(intentType, leadFlow) {
  if (intentType === 'supply' || leadFlow === 'offer') return 'supply';
  if (intentType === 'demand' || intentType === 'property_interest' || leadFlow === 'demand') return 'demand';
  return null;
}

function isCrossFamilyIntentChange(prevState = {}, nextState = {}) {
  const prevFamily = getIntentFamily(prevState.intent_type, prevState.lead_flow);
  const nextFamily = getIntentFamily(nextState.intent_type, nextState.lead_flow);
  return !!prevFamily && !!nextFamily && prevFamily !== nextFamily;
}

function markIntentChangeHandled(prevState = {}, nextState = {}) {
  if (!nextState.intent_changed) return false;

  const crossFamilyChanged = isCrossFamilyIntentChange(prevState, nextState);

  nextState.previous_intent_type = prevState.intent_type || null;
  nextState.intent_changed_at = nowIso();
  nextState.awaiting_field = null;
  nextState.handoff_ready = false;
  nextState.handoff_sent = false;
  nextState.closing_message_sent = false;

  if (crossFamilyChanged) {
    nextState.last_shown_property_ids = [];
    nextState.last_search_filters = null;
    nextState.last_search_result_count = 0;
  }

  return crossFamilyChanged;
}

async function refreshLocationCatalog(force = false) {
  try {
    const cacheStillValid =
      !force &&
      locationCatalog.loadedAt &&
      Date.now() - locationCatalog.loadedAt < LOCATION_CACHE_TTL_MS;

    if (cacheStillValid) return locationCatalog;

    const names = [];

    const { data: zonesData, error: zonesError } = await supabase
      .from('zones')
      .select('name');

    if (!zonesError && Array.isArray(zonesData)) {
      zonesData.forEach((row) => {
        if (row?.name) names.push(cleanSpaces(row.name));
      });
    }

    const { data: propsData, error: propsError } = await supabase
      .from('properties')
      .select('zone, neighborhood, city, municipality, state')
      .limit(5000);

    if (!propsError && Array.isArray(propsData)) {
      propsData.forEach((row) => {
        ['zone', 'neighborhood', 'city', 'municipality', 'state'].forEach((key) => {
          if (row?.[key]) names.push(cleanSpaces(row[key]));
        });
      });
    }

    const uniqueNames = uniq(names).sort((a, b) => a.localeCompare(b, 'es'));
    const normalizedMap = new Map();

    uniqueNames.forEach((name) => {
      normalizedMap.set(normalizeText(name), name);
    });

    locationCatalog.loadedAt = Date.now();
    locationCatalog.rawNames = uniqueNames;
    locationCatalog.normalizedMap = normalizedMap;

    console.log(`Location catalog refreshed: ${uniqueNames.length} entries`);
    return locationCatalog;
  } catch (err) {
    console.error('FATAL refreshLocationCatalog:', err);
    return locationCatalog;
  }
}

function findCanonicalLocation(rawText) {
  if (!rawText) return null;
  const text = normalizeText(rawText);

  if (!text) return null;

  if (locationCatalog.normalizedMap.has(text)) {
    return locationCatalog.normalizedMap.get(text);
  }

  for (const [normalized, canonical] of locationCatalog.normalizedMap.entries()) {
    if (text.includes(normalized) || normalized.includes(text)) {
      return canonical;
    }
  }

  return cleanSpaces(rawText);
}

function propertyMatchesLocation(property, locationText) {
  if (!locationText) return true;
  const needle = normalizeText(locationText);
  const hay = [
    property.zone,
    property.neighborhood,
    property.city,
    property.municipality,
    property.state,
    property.formatted_address,
  ]
    .filter(Boolean)
    .map(normalizeText)
    .join(' | ');

  return hay.includes(needle);
}

function propertyMatchesCurrency(property, currency) {
  if (!currency) return true;
  return normalizeText(property.currency_code || 'MXN') === normalizeText(currency);
}

function dedupePropertiesById(properties) {
  const seen = new Set();
  const result = [];

  for (const property of properties || []) {
    if (!property?.id) continue;
    if (seen.has(property.id)) continue;
    seen.add(property.id);
    result.push(property);
  }

  return result;
}

function filterOutPreviouslyShown(properties, state) {
  const shownIds = new Set(state.last_shown_property_ids || []);
  return (properties || []).filter((p) => !shownIds.has(p.id));
}

function applyDemandResultGuards(properties, state) {
  let rows = [...(properties || [])];

  if (state.budget_currency) {
    rows = rows.filter((p) => propertyMatchesCurrency(p, state.budget_currency));
  }

  if (state.location_text && !state.location_any) {
    rows = rows.filter((p) => propertyMatchesLocation(p, state.location_text));
  }

  if (state.property_type) {
    const desired = normalizeText(state.property_type);
    rows = rows.filter((p) => {
      const rawType = normalizeText(p.property_type || p.property_type_code || '');
      if (!rawType) return true;
      if (desired === 'house' && (rawType.includes('casa') || rawType.includes('house'))) return true;
      if (desired === 'apartment' && (rawType.includes('depa') || rawType.includes('depart') || rawType.includes('apartment'))) return true;
      if (desired === 'land' && (rawType.includes('terreno') || rawType.includes('land'))) return true;
      if (desired === 'office' && (rawType.includes('oficina') || rawType.includes('office'))) return true;
      if (desired === 'commercial' && (rawType.includes('local') || rawType.includes('commercial'))) return true;
      if (desired === 'warehouse' && (rawType.includes('nave') || rawType.includes('warehouse'))) return true;
      return true;
    });
  }

  return rows;
}

function getDemandPropertyMatchScore(property, state) {
  let score = 0;

  if (state.location_text && !state.location_any) {
    const normalizedDesiredLocation = normalizeText(state.location_text);
    const zone = normalizeText(property.zone || '');
    const neighborhood = normalizeText(property.neighborhood || '');
    const city = normalizeText(property.city || '');
    const municipality = normalizeText(property.municipality || '');
    const address = normalizeText(property.formatted_address || '');

    if (
      zone === normalizedDesiredLocation ||
      neighborhood === normalizedDesiredLocation ||
      city === normalizedDesiredLocation ||
      municipality === normalizedDesiredLocation
    ) {
      score += 45;
    } else if (
      zone.includes(normalizedDesiredLocation) ||
      neighborhood.includes(normalizedDesiredLocation) ||
      city.includes(normalizedDesiredLocation) ||
      municipality.includes(normalizedDesiredLocation) ||
      address.includes(normalizedDesiredLocation)
    ) {
      score += 28;
    }
  } else if (state.location_any) {
    score += 8;
  }

  if (state.property_type) {
    const desiredType = normalizeText(state.property_type);
    const rawType = normalizeText(property.property_type || property.property_type_code || '');

    if (!rawType) {
      score += 3;
    } else if (
      (desiredType === 'house' && (rawType.includes('casa') || rawType.includes('house'))) ||
      (desiredType === 'apartment' && (rawType.includes('depa') || rawType.includes('depart') || rawType.includes('apartment'))) ||
      (desiredType === 'land' && (rawType.includes('terreno') || rawType.includes('land'))) ||
      (desiredType === 'office' && (rawType.includes('oficina') || rawType.includes('office'))) ||
      (desiredType === 'commercial' && (rawType.includes('local') || rawType.includes('commercial'))) ||
      (desiredType === 'warehouse' && (rawType.includes('nave') || rawType.includes('warehouse')))
    ) {
      score += 20;
    }
  }

  if (state.budget_currency && propertyMatchesCurrency(property, state.budget_currency)) {
    score += 10;
  }

  if (state.budget_max != null && property.price != null) {
    const desiredBudget = Number(state.budget_max);
    const propertyPrice = Number(property.price);

    if (desiredBudget > 0 && propertyPrice > 0) {
      const diffRatio = Math.abs(propertyPrice - desiredBudget) / desiredBudget;

      if (diffRatio <= 0.1) score += 20;
      else if (diffRatio <= 0.2) score += 15;
      else if (diffRatio <= 0.35) score += 10;
      else if (diffRatio <= 0.5) score += 5;
    }
  }

  if (state.bedrooms != null && property.bedrooms != null) {
    const diff = Math.abs(Number(property.bedrooms) - Number(state.bedrooms));
    if (diff === 0) score += 12;
    else if (diff === 1) score += 6;
  }

  if (state.bathrooms != null && property.bathrooms != null) {
    const diff = Math.abs(Number(property.bathrooms) - Number(state.bathrooms));
    if (diff === 0) score += 6;
    else if (diff === 1) score += 3;
  }

  return score;
}

function rankDemandProperties(properties, state) {
  return [...(properties || [])]
    .map((property) => ({
      ...property,
      match_score: getDemandPropertyMatchScore(property, state),
    }))
    .sort((a, b) => {
      if (b.match_score !== a.match_score) return b.match_score - a.match_score;
      return Number(a.price || 0) - Number(b.price || 0);
    });
}

function classifyDemandResultQuality(properties = []) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return {
      resultQuality: 'none',
      topMatchScore: 0,
      visibleLimit: 0,
    };
  }

  const topMatchScore = Number(properties[0]?.match_score || 0);

  if (topMatchScore >= 80) {
    return {
      resultQuality: 'strong',
      topMatchScore,
      visibleLimit: 3,
    };
  }

  if (topMatchScore >= 55) {
    return {
      resultQuality: 'medium',
      topMatchScore,
      visibleLimit: 3,
    };
  }

  if (topMatchScore >= 35) {
    return {
      resultQuality: 'weak',
      topMatchScore,
      visibleLimit: 2,
    };
  }

  return {
    resultQuality: 'very_weak',
    topMatchScore,
    visibleLimit: 0,
  };
}

function shouldPrioritizeDemandHandoff(state, properties = []) {
  const strongCommercialIntent =
    !!state.wants_visit ||
    !!state.shows_high_interest ||
    !!state.asks_property_details ||
    !!state.direct_property_reference;

  const hasResults = Array.isArray(properties) && properties.length > 0;
  const strongMatch = Number(state.top_match_score || 0) >= 80;
  const mediumMatch = Number(state.top_match_score || 0) >= 55;

  if (strongCommercialIntent && hasResults) return true;
  if (state.wants_visit && mediumMatch) return true;
  if (state.asks_property_details && hasResults) return true;
  if (state.shows_high_interest && strongMatch) return true;
  if (state.direct_property_reference && hasResults) return true;

  return false;
}

function getDemandFollowupPriority(state, properties = []) {
  const hasResults = Array.isArray(properties) && properties.length > 0;
  const topMatchScore = Number(state.top_match_score || 0);

  if (state.direct_property_reference && hasResults) return 'high';
  if (state.wants_visit && hasResults) return 'high';
  if (state.asks_property_details && hasResults) return 'high';
  if (state.shows_high_interest && topMatchScore >= 80) return 'high';
  if (state.wants_human && hasResults) return 'high';
  if (!hasResults && state.location_text && state.budget_max && state.budget_currency) return 'high';
  if (hasResults && topMatchScore >= 55) return 'medium';

  return 'medium';
}

async function saveConversationEvent(conversationId, type, payload = {}, createdBy = null) {
  try {
    if (!conversationId) return;
    const { error } = await supabase.from('conversation_events').insert({
      conversation_id: conversationId,
      type,
      payload,
      created_by: createdBy,
    });
    if (error) console.error('Error saving conversation event:', error);
  } catch (err) {
    console.error('FATAL saveConversationEvent:', err);
  }
}

async function maybeCreateOrReuseLeadWithEngine({
  conversationId,
  conversationRow,
  nextAiState,
  contactId,
  property = null,
  messageText = '',
  referralContext = null,
  rawPayload = null,
  unifiedContext = null,
}) {
  try {
    const propertyId = property?.id || null;
    const propertyCode =
      nextAiState?.property_code || nextAiState?.direct_property_code || property?.listing_id || null;

    const campaignExtraction = extractCampaignReferralContext({
      aiState: nextAiState,
      referral: referralContext,
      rawPayload,
      messageText,
    });

    if (campaignExtraction.hasCampaignContext) {
      console.log('campaign_context_detected', {
        conversation_id: conversationId,
        property_id: propertyId,
        has_referral: !!campaignExtraction.referralContext,
      });
    } else {
      console.log('campaign_context_missing', {
        conversation_id: conversationId,
        property_id: propertyId,
      });
    }

    const shouldEvaluatePropertyOpportunity = !!(
      propertyId ||
      nextAiState?.direct_property_reference ||
      nextAiState?.property_code ||
      nextAiState?.direct_property_code
    );

    if (shouldEvaluatePropertyOpportunity) {
      const leadOpportunity = detectLeadCreationOpportunity({
        aiState: nextAiState,
        propertyId,
        propertyCode,
        messageText,
        hasCampaignContext: campaignExtraction.hasCampaignContext,
        unifiedContext,
      });

      if (propertyId && leadOpportunity.shouldCreate) {
        console.log('property_interest_detected', {
          conversation_id: conversationId,
          property_id: propertyId,
          property_code: propertyCode,
          reason: leadOpportunity.reason,
        });
      }

      if (!leadOpportunity.shouldCreate) {
        return {
          success: false,
          reason: leadOpportunity.reason,
        };
      }
    }

    const leadContext = buildLeadContextFromConversation({
      conversation: conversationRow,
      aiState: nextAiState,
      property,
      propertyId,
      propertyCode,
      propertySlug: property?.slug || null,
      contactId,
      referralContext: campaignExtraction.referralContext,
      campaignContext: campaignExtraction.campaignContext,
      rawReferral: campaignExtraction.rawReferral,
    });

    console.log('lead_create_attempted', {
      conversation_id: leadContext.conversationId,
      contact_id_present: !!leadContext.contactId,
      property_id: leadContext.propertyId,
      property_code: leadContext.propertyCode,
      source_channel: leadContext.sourceChannel,
      has_campaign_context: !!leadContext.campaignContext,
      has_referral: !!leadContext.referralContext,
    });

    const aiStateForLead = {
      ...(nextAiState || {}),
      whatsapp_referral:
        nextAiState?.whatsapp_referral || campaignExtraction.referralContext || null,
      campaign_context:
        nextAiState?.campaign_context || campaignExtraction.campaignContext || null,
      context_fusion: unifiedContext || nextAiState?.context_fusion || null,
    };

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: conversationRow,
      aiState: aiStateForLead,
      contactId,
      propertyId,
      property,
      logger: console,
    });

    if (result?.success && result.aiState) {
      Object.assign(nextAiState, result.aiState);
    }

    if (result?.success && result.wasCreated) {
      console.log('lead_created', {
        conversation_id: conversationId,
        lead_id: result.leadId || null,
        property_id: propertyId,
      });
    } else if (result?.success && !result.wasCreated) {
      console.log('lead_linked_existing', {
        conversation_id: conversationId,
        lead_id: result.leadId || null,
        property_id: propertyId,
      });
      console.log('lead_skipped_duplicate', {
        conversation_id: conversationId,
        lead_id: result.leadId || null,
      });
    } else if (!result?.success) {
      console.warn('lead_creation_failed', {
        conversation_id: conversationId,
        reason: result?.reason || 'unknown',
        error: result?.error || null,
      });
    }

    return result;
  } catch (err) {
    console.warn('Lead automation failed:', err?.message || err);
    console.warn('lead_creation_failed', {
      conversation_id: conversationId,
      reason: 'lead_automation_exception',
      error: err?.message || String(err),
    });
    await saveConversationEvent(conversationId, 'lead_assignment_failed', {
      reason: 'lead_automation_exception',
      error: err?.message || String(err),
    });
    return null;
  }
}

async function updateConversationMeta(conversationId, payload) {
  try {
    if (!conversationId) return;
    const { error } = await supabase.from('conversations').update(payload).eq('id', conversationId);
    if (error) console.error('Error updating conversation meta:', error);
  } catch (err) {
    console.error('FATAL updateConversationMeta:', err);
  }
}

async function fetchConversationLinkedEntities(conversationRow = {}) {
  const result = {
    existingContact: null,
    existingLead: null,
  };

  try {
    if (conversationRow?.contact_id) {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', conversationRow.contact_id)
        .maybeSingle();
      result.existingContact = data || null;
    }

    if (conversationRow?.lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', conversationRow.lead_id)
        .maybeSingle();
      result.existingLead = data || null;
    }
  } catch (error) {
    console.warn('fetchConversationLinkedEntities warning:', error?.message || error);
  }

  return result;
}

async function saveConversationState(conversationId, nextState, aiSummary = null) {
  try {
    if (!conversationId) return false;

    const payload = {
      ai_state: nextState,
      updated_at: nowIso(),
    };

    if (aiSummary !== null) payload.ai_summary = aiSummary;

    const { error } = await supabase
      .from('conversations')
      .update(payload)
      .eq('id', conversationId);

    if (error) {
      console.error('Error saving ai_state:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('FATAL saveConversationState:', err);
    return false;
  }
}

async function saveConversationMessage({
  conversationId,
  direction,
  senderType,
  messageType,
  messageText,
  transcriptionText = null,
  metaMessageId = null,
  rawPayload = {},
}) {
  try {
    if (!conversationId) return null;

    const { data, error } = await supabase
      .from('conversation_messages')
      .insert({
        conversation_id: conversationId,
        direction,
        sender_type: senderType,
        message_type: messageType,
        message_text: messageText,
        transcription_text: transcriptionText,
        meta_message_id: metaMessageId,
        raw_payload: rawPayload,
      })
      .select()
      .single();

    if (error) {
      console.error('Error guardando mensaje:', error);
      return null;
    }

    await supabase
      .from('conversations')
      .update({
        last_message_at: nowIso(),
      })
      .eq('id', conversationId);

    return data;
  } catch (err) {
    console.error('FATAL saveConversationMessage:', err);
    return null;
  }
}

async function inboundMessageAlreadyProcessed(metaMessageId) {
  try {
    if (!metaMessageId) return false;

    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('direction', 'inbound')
      .eq('meta_message_id', metaMessageId)
      .limit(1);

    if (error) {
      console.error('Error checking inbound duplicate:', error);
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.error('FATAL inboundMessageAlreadyProcessed:', err);
    return false;
  }
}

async function savePropertySuggestions(conversationId, conversationMessageId, properties) {
  try {
    if (!conversationId || !conversationMessageId || !properties?.length) return;

    const rows = properties
      .filter((property) => property?.id)
      .map((property, index) => ({
        conversation_id: conversationId,
        conversation_message_id: conversationMessageId,
        property_id: property.id,
        position: index + 1,
      }));

    if (!rows.length) return;

    const { error } = await supabase
      .from('conversation_property_suggestions')
      .insert(rows);

    if (error) console.error('Error saving property suggestions:', error);
  } catch (err) {
    console.error('FATAL savePropertySuggestions:', err);
  }
}

async function searchProperties({
  operationType,
  location,
  minPrice = null,
  maxPrice = null,
  bedrooms = null,
  propertyType = null,
  limit = DEFAULT_PROPERTY_LIMIT,
}) {
  try {
    let result = await supabase.rpc('ai_search_properties', {
      p_operation_type: operationType,
      p_location: location,
      p_min_price: minPrice,
      p_max_price: maxPrice,
      p_bedrooms: bedrooms,
      p_limit: limit,
      p_property_type: propertyType,
    });

    if (result.error) {
      result = await supabase.rpc('ai_search_properties', {
        p_operation_type: operationType,
        p_location: location,
        p_min_price: minPrice,
        p_max_price: maxPrice,
        p_bedrooms: bedrooms,
        p_limit: limit,
      });
    }

    if (result.error) {
      console.error('RPC error:', result.error);
      return [];
    }

    return result.data || [];
  } catch (err) {
    console.error('FATAL searchProperties:', err);
    return [];
  }
}

function normalizeListingId(rawValue) {
  if (!rawValue) return null;

  const text = String(rawValue)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—−_./,#:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Caso completo: LUX-A0462 incluso si está pegado a texto
  const fullMatch = text.match(/LUX\s*([A-Z])\s*(\d{4})(?!\d)/);
  if (fullMatch) {
    return `LUX-${fullMatch[1]}${fullMatch[2]}`;
  }

  // Caso corto: A0462 -> LUX-A0462
  const shortMatch = text.match(/([A-Z])\s*(\d{4})(?!\d)/);
  if (shortMatch) {
    return `LUX-${shortMatch[1]}${shortMatch[2]}`;
  }

  return null;
}

async function getPropertyByCode(propertyCode) {
  try {
    const normalizedListingId = normalizeListingId(propertyCode);

    console.log('getPropertyByCode INPUT:', {
      raw_property_code: propertyCode,
      normalized_listing_id: normalizedListingId,
    });

    if (!normalizedListingId) return null;

    const { data, error } = await supabase
      .from('properties')
      .select(`
        id,
        listing_id,
        agent_profile_id,
        title,
        slug,
        price,
        currency_code,
        neighborhood,
        zone,
        city,
        bedrooms,
        bathrooms,
        parking_spaces,
        main_image_url,
        canonical_url,
        operation_type,
        status,
        archived_at,
        visible_on_website,
        is_public
      `)
      .eq('listing_id', normalizedListingId.trim())
      .is('archived_at', null)
      .eq('visible_on_website', true)
      .in('status', ['active', 'sold', 'rented'])
      .limit(1);

    if (error) {
      console.error('Error buscando propiedad por listing_id:', error);
      return null;
    }

    const property = Array.isArray(data) && data.length > 0 ? data[0] : null;

    console.log('getPropertyByCode OUTPUT:', {
      normalized_listing_id: normalizedListingId,
      found: !!property,
      property_id: property?.id || null,
      listing_id: property?.listing_id || null,
    });

    return property;
  } catch (err) {
    console.error('FATAL getPropertyByCode:', err);
    return null;
  }
}

function extractPropertySlugFromText(rawValue) {
  if (!rawValue) return null;
  const text = String(rawValue);
  const match = text.match(/luxetty\.com\/propiedad\/([a-z0-9-]+)/i);
  if (match?.[1]) return match[1].replace(/[/?#].*$/, '').trim();
  return null;
}

async function getPropertyBySlug(slug) {
  try {
    if (!slug) return null;

    const { data, error } = await supabase
      .from('properties')
      .select(`
        id,
        listing_id,
        agent_profile_id,
        title,
        slug,
        price,
        currency_code,
        neighborhood,
        zone,
        city,
        bedrooms,
        bathrooms,
        parking_spaces,
        main_image_url,
        canonical_url,
        operation_type,
        status,
        archived_at,
        visible_on_website,
        is_public
      `)
      .eq('slug', slug)
      .is('archived_at', null)
      .eq('visible_on_website', true)
      .in('status', ['active', 'sold', 'rented'])
      .limit(1);

    if (error) {
      console.error('Error buscando propiedad por slug:', error);
      return null;
    }

    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.error('FATAL getPropertyBySlug:', err);
    return null;
  }
}

function getAssignedAgentProfileIdFromProperty(property) {
  if (!property || typeof property !== 'object') return null;
  return property.agent_profile_id || null;
}

async function searchPropertiesWithFallbacks(state) {
  const attempts = [];
  const seen = new Set();

  function pushAttempt(attempt) {
    const key = JSON.stringify(attempt);
    if (!seen.has(key)) {
      seen.add(key);
      attempts.push(attempt);
    }
  }

  pushAttempt({
    operationType: state.operation_type,
    location: state.location_any ? null : state.location_text,
    minPrice: state.budget_min,
    maxPrice: state.budget_max,
    bedrooms: state.bedrooms_any ? null : state.bedrooms,
    propertyType: state.property_type,
    limit: DEFAULT_PROPERTY_LIMIT,
    label: 'exact',
  });

  pushAttempt({
    operationType: state.operation_type,
    location: state.location_any ? null : state.location_text,
    minPrice: state.budget_min,
    maxPrice: state.budget_max,
    bedrooms: null,
    propertyType: state.property_type,
    limit: DEFAULT_PROPERTY_LIMIT,
    label: 'without_bedrooms',
  });

  pushAttempt({
    operationType: state.operation_type,
    location: state.location_any ? null : state.location_text,
    minPrice: state.budget_min,
    maxPrice: state.budget_max,
    bedrooms: null,
    propertyType: null,
    limit: DEFAULT_PROPERTY_LIMIT,
    label: 'without_property_type',
  });

  if (state.budget_max) {
    pushAttempt({
      operationType: state.operation_type,
      location: state.location_any ? null : state.location_text,
      minPrice: state.budget_min,
      maxPrice: Math.round(Number(state.budget_max) * SEARCH_BUDGET_FALLBACK_MULTIPLIER),
      bedrooms: null,
      propertyType: null,
      limit: DEFAULT_PROPERTY_LIMIT,
      label: 'expanded_budget',
    });
  }

  for (const attempt of attempts) {
    const rows = await searchProperties(attempt);
    const deduped = dedupePropertiesById(rows);
    const guarded = applyDemandResultGuards(deduped, state);
    const fresh = filterOutPreviouslyShown(guarded, state);
    const usable = fresh.length > 0 ? fresh : guarded;

    if (usable.length > 0) {
      const ranked = rankDemandProperties(usable, state);
      const quality = classifyDemandResultQuality(ranked);

      const visibleProperties =
        quality.visibleLimit > 0
          ? ranked.slice(0, Math.min(quality.visibleLimit, DEFAULT_PROPERTY_LIMIT))
          : [];

      return {
        properties: visibleProperties,
        rawProperties: ranked,
        attemptUsed: attempt.label,
        resultQuality: quality.resultQuality,
        topMatchScore: quality.topMatchScore,
        rawResultCount: ranked.length,
      };
    }
  }

  return {
    properties: [],
    rawProperties: [],
    attemptUsed: 'no_results',
    resultQuality: 'none',
    topMatchScore: 0,
    rawResultCount: 0,
  };
}

async function getOrCreateConversation(phone) {
  try {
    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const phoneLookupValues = getPhoneLookupValues(normalizedPhone);
    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('*')
      .eq('channel', 'whatsapp')
      .in('phone', phoneLookupValues)
      .order('created_at', { ascending: false })
      .limit(1);

    if (findError) {
      console.error('Error buscando conversación:', findError);
      return { id: null, ai_state: getDefaultAiState() };
    }

    if (existing && existing.length > 0) {
      if (existing[0].phone !== normalizedPhone) {
        await supabase
          .from('conversations')
          .update({ phone: normalizedPhone, updated_at: nowIso() })
          .eq('id', existing[0].id);
        existing[0].phone = normalizedPhone;
      }
      return existing[0];
    }

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
      console.error('Error creando conversación:', createError);
      return { id: null, ai_state: getDefaultAiState() };
    }

    return created;
  } catch (err) {
    console.error('FATAL getOrCreateConversation:', err);
    return { id: null, ai_state: getDefaultAiState() };
  }
}

async function sendWhatsAppText(to, body) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
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
  for (const body of outbound) {
    await sendWhatsAppText(to, body);
  }
  return outbound;
}

async function saveOutboundMessages({ conversationId, messages, rawPayload = {} }) {
  const outbound = normalizeOutboundMessages(messages);
  const rows = [];

  for (const messageText of outbound) {
    const row = await saveConversationMessage({
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

async function maybeCreateFollowupRequest({
  conversationId,
  state,
  summary,
  priority = 'medium',
  requestType,
}) {
  try {
    if (!conversationId || !requestType || !summary) return null;

    const { data: existing, error: existingError } = await supabase
      .from('agent_followup_requests')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('request_type', requestType)
      .in('status', ['pending', 'assigned', 'contacted'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingError) {
      console.error('Error checking existing followup requests:', existingError);
      return null;
    }

    if (existing && existing.length > 0) {
      return existing[0];
    }

    const { data, error } = await supabase
      .from('agent_followup_requests')
      .insert({
        conversation_id: conversationId,
        lead_id: null,
        request_type: requestType,
        summary,
        priority,
        status: 'pending',
        created_by_system: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating followup request:', error);
      return null;
    }

    await saveConversationEvent(conversationId, 'followup_request_created', {
      followup_id: data.id,
      request_type: requestType,
      priority,
      summary,
    });

    await updateConversationMeta(conversationId, {
      status: 'pending',
      next_action: 'human_followup',
      next_action_due_at: nowIso(),
      follow_up_status: 'due_soon',
    });

    return data;
  } catch (err) {
    console.error('FATAL maybeCreateFollowupRequest:', err);
    return null;
  }
}

function getPhoneLookupValues(phone) {
  const normalized = normalizePhoneNumber(phone) || phone;
  const values = new Set([normalized, String(phone || '').trim()].filter(Boolean));

  if (normalized) {
    values.add(`+${normalized}`);
    if (normalized.startsWith('521') && normalized.length === 13) {
      const legacyMx = `52${normalized.slice(3)}`;
      values.add(legacyMx);
      values.add(`+${legacyMx}`);
    }
  }

  return Array.from(values).filter(Boolean);
}

async function ensureContactForConversation({
  conversationRow,
  state,
  phone,
  waName = null,
  source = 'whatsapp',
  rawPayload = null,
}) {
  try {
    if (!conversationRow?.id || !phone) return null;

    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const candidateNames = [state?.full_name, waName].filter(Boolean);
    const usefulName = candidateNames.find((name) => isUsefulContactName(name)) || null;

    let existingContact = null;

    if (conversationRow.contact_id) {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', conversationRow.contact_id)
        .maybeSingle();
      existingContact = data || null;
    }

    if (!existingContact) {
      const { data: byWhatsapp } = await supabase
        .from('contacts')
        .select('*')
        .eq('whatsapp', normalizedPhone)
        .limit(1);

      existingContact = byWhatsapp?.[0] || null;
    }

    if (!existingContact) {
      const { data: byPhone } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone', normalizedPhone)
        .limit(1);

      existingContact = byPhone?.[0] || null;
    }

    if (!existingContact) {
      const lookupValues = getPhoneLookupValues(normalizedPhone);
      const orFilter = lookupValues
        .flatMap((value) => [`phone.eq.${value}`, `whatsapp.eq.${value}`])
        .join(',');
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(orFilter)
        .limit(1);
      existingContact = data?.[0] || null;
    }

    if (existingContact) {
      const payload = {};
      if (usefulName && !isUsefulContactName(existingContact.full_name)) {
        payload.full_name = usefulName;
      }
      if (!existingContact.phone) payload.phone = normalizedPhone;
      if (!existingContact.whatsapp) payload.whatsapp = normalizedPhone;

      if (Object.keys(payload).length > 0) {
        await supabase.from('contacts').update(payload).eq('id', existingContact.id);
      }

      if (!conversationRow.contact_id || conversationRow.contact_id !== existingContact.id) {
        await updateConversationMeta(conversationRow.id, {
          contact_id: existingContact.id,
        });
      }

      await saveConversationEvent(conversationRow.id, 'contact_reused', {
        contact_id: existingContact.id,
        source,
        normalized_phone: normalizedPhone,
      });

      return existingContact.id;
    }

    const createPayload = {
      phone: normalizedPhone,
      whatsapp: normalizedPhone,
    };
    if (usefulName) createPayload.full_name = usefulName;
    else createPayload.full_name = 'Cliente';

    const { data: created, error } = await supabase
      .from('contacts')
      .insert(createPayload)
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return null;
    }

    await updateConversationMeta(conversationRow.id, {
      contact_id: created.id,
    });

    await saveConversationEvent(conversationRow.id, 'contact_created', {
      contact_id: created.id,
      source,
      normalized_phone: normalizedPhone,
      has_useful_name: !!usefulName,
      raw_payload_meta_message_id: rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id || null,
    });

    return created.id;
  } catch (err) {
    console.error('FATAL ensureContactForConversation:', err);
    return null;
  }
}

async function upsertContactForConversation(conversationRow, state, phone) {
  return ensureContactForConversation({ conversationRow, state, phone });
}

function shouldEscalateDemand(state, properties, text) {
  const normalized = normalizeText(text);

  const explicitHuman =
    state.wants_human ||
    normalized.includes('asesor') ||
    normalized.includes('agente') ||
    normalized.includes('llamen') ||
    normalized.includes('marquen') ||
    normalized.includes('contactame') ||
    normalized.includes('contáctame') ||
    normalized.includes('quiero informes') ||
    normalized.includes('quiero mas info') ||
    normalized.includes('quiero más info') ||
    !!state.direct_property_reference;

  const commercialIntent =
    !!state.wants_visit ||
    !!state.shows_high_interest ||
    !!state.asks_property_details ||
    !!state.direct_property_reference;

  const enoughContextForHuman =
    !!state.location_text ||
    !!state.direct_property_reference ||
    !!state.property_type ||
    !!state.budget_max;

  if (explicitHuman) return true;
  if (commercialIntent && enoughContextForHuman) return true;
  if (properties.length === 0 && state.location_text && state.budget_max && state.budget_currency) return true;

  return false;
}

function shouldEscalateOffer(state) {
  return (
    state.capture_qualified === true &&
    !!state.location_text &&
    !!state.budget_max &&
    !!state.budget_currency &&
    !!state.owner_relation &&
    !!state.property_type &&
    !!state.full_name &&
    !!state.contact_preference &&
    state.contact_number_confirmed === true
  );
}

async function maybeGenerateAiSummary(conversationId, state, properties) {
  const aiSummary = buildAiSummary(state, properties);
  if (!aiSummary) return null;
  await saveConversationState(conversationId, state, aiSummary);
  return aiSummary;
}

app.get('/conversations', async (req, res) => {
  const { data, error } = await supabase.rpc('get_conversations_list');
  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/conversations/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

app.get('/', (req, res) => {
  return res.status(200).send('Luxetty Agent OK');
});

app.post('/jobs/inactivity-followups', async (req, res) => {
  const expectedSecret = process.env.FOLLOWUP_JOB_SECRET || null;
  const receivedSecret = req.headers['x-job-secret'] || req.body?.secret || null;

  if (expectedSecret && receivedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const summary = await runInactivityFollowups({
      supabase,
      sendWhatsAppText,
      limit: Number(process.env.FOLLOWUP_JOB_LIMIT || 50),
      logger: console,
    });

    return res.status(200).json({ ok: true, summary });
  } catch (err) {
    console.error('FOLLOWUP_JOB_ERROR', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'followup_job_failed' });
  }
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    await refreshLocationCatalog();

    async function processInboundWhatsAppMessage({ entry, change, value, message }) {
      let from = null;

      if (!message || typeof message !== 'object') return;

      const rawFrom = message.from;
      const fromIsValid = typeof rawFrom === 'string' && rawFrom.trim().length > 0;
      const messageType = message.type;
      const metaMessageId = message.id || null;

      if (!metaMessageId) {
        console.log('inbound_missing_message_id_skipped', {
          message_type: messageType || null,
          from: rawFrom || null,
        });
        return;
      }

      if (!fromIsValid) {
        console.log('inbound_missing_from_skipped', {
          meta_message_id: metaMessageId,
          message_type: messageType || null,
        });
        return;
      }

      const duplicateInbound = await inboundMessageAlreadyProcessed(metaMessageId);
      if (duplicateInbound) {
        console.log('inbound_duplicate_skipped', {
          meta_message_id: metaMessageId,
          from: rawFrom,
        });
        return;
      }

      const normalizedReferral = extractWhatsAppReferral(message);
      if (normalizedReferral) {
        console.log('referral_detected', {
          meta_message_id: metaMessageId,
          from: rawFrom,
          referral: normalizedReferral,
        });
      } else {
        console.log('referral_absent', {
          meta_message_id: metaMessageId,
          from: rawFrom,
        });
      }

      const inboundRawPayload = normalizedReferral
        ? {
            ...(req.body || {}),
            perseo_metadata: {
              ...((req.body && req.body.perseo_metadata) || {}),
              whatsapp_referral: normalizedReferral,
            },
          }
        : req.body;

      from = normalizePhoneNumber(rawFrom) || rawFrom;

      const inboundContext = buildInboundMessageContext(message);
      let text = inboundContext.messageText;
      let transcriptionText = inboundContext.transcriptionText;
      let finalInputTextSource = text ? 'message_text' : 'empty';
      let transcriptionAttempted = false;
      let transcriptionSuccess = false;
      let transcriptionErrorCode = null;
      let transcriptionErrorMessage = null;

      const conversationRow = await getOrCreateConversation(from);
      const conversationId = conversationRow?.id || null;
      const previousAiState = normalizeAiState(conversationRow?.ai_state);
      const linkedEntities = await fetchConversationLinkedEntities(conversationRow);

      const signalText = extractInboundSignalText(message);
      if (signalText) {
        text = cleanSpaces(signalText);
        finalInputTextSource = 'signal_text';
      }

      const inboundMediaMetadata = extractInboundMediaMetadata(message, {
        conversationId,
        from,
      });

      let mediaResolution = null;

      if (inboundContext?.media && inboundContext.media.type !== 'text') {
        mediaResolution = await resolveInboundMedia(message);
        inboundContext.media.media_download_status = mediaResolution?.download_status || 'received';

        if (mediaResolution?.success) {
          inboundContext.media.attachment_detected_not_processed = false;
          inboundContext.media.media_downloaded = true;
          inboundContext.media.media_download_bytes = mediaResolution.size_bytes || null;
          inboundContext.media.media_download_mime_type =
            mediaResolution.mime_type || inboundContext.media.mime_type || null;
        } else {
          inboundContext.media.media_downloaded = false;
          inboundContext.media.media_download_error = mediaResolution?.error_message || mediaResolution?.error?.message || mediaResolution?.status || null;
        }

        inboundMediaMetadata.download_status = mediaResolution?.download_status || inboundMediaMetadata.download_status;
        inboundMediaMetadata.download_result = {
          status: mediaResolution?.status || null,
          success: !!mediaResolution?.success,
          media_id: mediaResolution?.media_id || inboundMediaMetadata.media_id,
          mime_type: mediaResolution?.mime_type || inboundMediaMetadata.mime_type,
          size_bytes: mediaResolution?.size_bytes || null,
          error_code: mediaResolution?.error_code || null,
          error_message: mediaResolution?.error_message || null,
          downloaded_at: mediaResolution?.downloaded_at || null,
        };

        const canAttemptAudioTranscription =
          (messageType === 'audio' || messageType === 'voice') &&
          !!mediaResolution?.success &&
          Buffer.isBuffer(mediaResolution?.buffer);

        const canAttemptImageVision =
          messageType === 'image' &&
          !!mediaResolution?.success &&
          Buffer.isBuffer(mediaResolution?.buffer);

        if (canAttemptAudioTranscription) {
          transcriptionAttempted = true;
          const audioTranscription = await transcribeAudio({
            fileBuffer: mediaResolution.buffer,
            mimeType: mediaResolution.mime_type || inboundContext.media.mime_type,
            filename: inboundContext.media.file_name || inboundMediaMetadata.filename || null,
            mediaId: mediaResolution.media_id || inboundMediaMetadata.media_id,
            conversationId,
            messageId: metaMessageId,
            provider: 'openai',
          });

          inboundContext.media.audio_transcription = audioTranscription;
          inboundMediaMetadata.audio_transcription = {
            status: audioTranscription.status,
            success: audioTranscription.success,
            provider: audioTranscription.provider,
            model: audioTranscription.model,
            confidence_score: audioTranscription.confidence_score,
            needs_confirmation: audioTranscription.needs_confirmation,
            language: audioTranscription.language,
            duration_seconds: audioTranscription.duration_seconds,
            error_code: audioTranscription.error_code,
            error_message: audioTranscription.error_message,
            transcribed_at: audioTranscription.transcribed_at,
          };

          if (audioTranscription.success && audioTranscription.transcription_text) {
            transcriptionSuccess = true;
            transcriptionText = audioTranscription.transcription_text;
            text = audioTranscription.transcription_text;
            finalInputTextSource = 'audio_transcription';
            inboundContext.transcriptionText = transcriptionText;
            inboundContext.media.audio_has_transcription = true;
            inboundContext.media.audio_without_transcription = false;
            inboundContext.media.audio_transcription_success = true;
            inboundContext.media.audio_low_confidence = !!audioTranscription.needs_confirmation;

            if (
              cleanSpaces(previousAiState.last_audio_transcription || '') &&
              normalizeText(previousAiState.last_audio_transcription) === normalizeText(transcriptionText)
            ) {
              inboundContext.media.audio_transcription_duplicate = true;
            }
          } else {
            transcriptionSuccess = false;
            transcriptionErrorCode = audioTranscription.error_code || null;
            transcriptionErrorMessage = sanitizeDebugErrorMessage(audioTranscription.error_message || '');
            inboundContext.media.audio_transcription_success = false;
            inboundContext.media.audio_without_transcription = true;
            inboundContext.media.audio_transcription_failed = true;
          }
        }

        if (canAttemptImageVision) {
          const imageVision = await analyzeImage({
            fileBuffer: mediaResolution.buffer,
            mimeType: mediaResolution.mime_type || inboundContext.media.mime_type,
            filename: inboundContext.media.file_name || inboundMediaMetadata.filename || null,
            mediaId: mediaResolution.media_id || inboundMediaMetadata.media_id,
            conversationId,
            messageId: metaMessageId,
            caption: inboundContext.media.caption || inboundMediaMetadata.caption || null,
            provider: 'openai',
          });

          inboundContext.media.image_vision = imageVision;
          inboundContext.media.image_vision_status = imageVision.status || null;
          inboundContext.media.image_vision_success = !!imageVision.ok;

          inboundMediaMetadata.image_vision = {
            status: imageVision.status,
            success: imageVision.ok,
            provider: imageVision.provider,
            model: imageVision.model || null,
            summary: imageVision.summary || null,
            property_signals: imageVision.propertySignals || null,
            suggested_follow_up: imageVision.suggestedFollowUp || null,
            caution: imageVision.caution || null,
            error_code: imageVision.errorCode || null,
            error_message: imageVision.errorMessage || null,
          };
        }
      }

      if (
        inboundContext?.media?.audio_without_transcription &&
        previousAiState?.has_audio_without_transcription
      ) {
        inboundContext.media.audio_without_transcription_repeat = true;
      }

      const propertyContextFromState =
        previousAiState?.direct_property_reference && previousAiState?.property_code
          ? {
              listing_id: previousAiState.property_code,
            }
          : null;

      const campaignContextForFusion = extractCampaignReferralContext({
        aiState: previousAiState,
        referral: normalizedReferral,
        rawPayload: inboundRawPayload,
        messageText: text,
      });

      const unifiedContext = buildUnifiedConversationContext({
        inboundText: text,
        caption: inboundContext?.media?.caption || inboundMediaMetadata?.caption || null,
        audioTranscription: transcriptionText,
        imageVision: inboundContext?.media?.image_vision || inboundMediaMetadata?.image_vision || null,
        location: inboundMediaMetadata?.location || null,
        interactive: inboundMediaMetadata?.interactive || null,
        previousAiState,
        existingContact: linkedEntities.existingContact,
        existingLead: linkedEntities.existingLead,
        campaignContext: campaignContextForFusion?.campaignContext || null,
        propertyContext: propertyContextFromState,
        rawMessage: message,
        now: nowIso(),
      });

      if (cleanSpaces(unifiedContext?.effectiveText || '')) {
        text = cleanSpaces(unifiedContext.effectiveText);
      }

      console.log('--- NUEVO MENSAJE ---');
      console.log('From:', from);
      console.log('Tipo:', messageType);
      console.log('Texto:', text);

      const normalizedText = normalizeText(text);

      if (rawFrom && from && rawFrom !== from) {
        await saveConversationEvent(conversationId, 'contact_phone_normalized', {
          raw_phone: rawFrom,
          normalized_phone: from,
        });
      }

      const inboundMessageRow = await saveConversationMessage({
        conversationId,
        direction: 'inbound',
        senderType: 'lead',
        messageType: mapInboundMessageType(messageType),
        messageText: text,
        transcriptionText,
        metaMessageId,
        rawPayload: {
          ...(inboundRawPayload || {}),
          perseo_metadata: {
            ...((inboundRawPayload && inboundRawPayload.perseo_metadata) || {}),
            media_ingestion: inboundMediaMetadata,
            image_vision: inboundMediaMetadata.image_vision || null,
            context_fusion: {
              source_signals: unifiedContext?.sourceSignals || null,
              normalized_intent: unifiedContext?.normalizedIntent || null,
              crm_action: unifiedContext?.crmAction || null,
              missing_critical_fields: unifiedContext?.missingCriticalFields || [],
              should_create_or_update_lead: !!unifiedContext?.shouldCreateOrUpdateLead,
              should_ask_one_more_question: !!unifiedContext?.shouldAskOneMoreQuestion,
              suggested_next_question: unifiedContext?.suggestedNextQuestion || null,
            },
          },
        },
      });

      try {
        const referralPersistResult = await persistConversationReferral({
          supabase,
          conversationId,
          conversationMessageId: inboundMessageRow?.id || null,
          metaMessageId,
          referral: normalizedReferral,
        });

        if (referralPersistResult?.ok) {
          console.log('[referral] persisted', {
            id: referralPersistResult.id || null,
            duplicate: referralPersistResult.duplicate || false,
          });
        } else if (referralPersistResult?.skipped) {
          console.log('[referral] skipped', { reason: referralPersistResult.reason });
        } else {
          console.warn('[referral] persist warning', referralPersistResult);
        }
      } catch (error) {
        console.error('[referral] unexpected persist error', error);
      }

      const incomingSignals = parseMessageSignals(text, previousAiState, inboundContext);
      const signals = incomingSignals;

      if (inboundContext?.media && inboundContext.media.type !== 'text') {
        await saveConversationEvent(conversationId, 'inbound_media_classified', {
          conversation_message_id: inboundMessageRow?.id || null,
          media_type: inboundContext.media.type || null,
          media_category: inboundContext.media.category || null,
          media_id: inboundContext.media.media_id || null,
          is_forwarded: !!inboundContext.media.is_forwarded,
          attachment_detected_not_processed: !!inboundContext.media.attachment_detected_not_processed,
          unsupported_media: !!inboundContext.media.unsupported_media,
          map_url: inboundContext.media.map_url || null,
          file_name: inboundContext.media.file_name || null,
          mime_type: inboundContext.media.mime_type || null,
          property_image_candidate: !!inboundContext.media.property_image_candidate,
          legal_or_property_document_candidate: !!inboundContext.media.legal_or_property_document_candidate,
          has_transcription: !!inboundContext.transcriptionText,
          media_downloaded: !!inboundContext.media.media_downloaded,
          media_download_error: inboundContext.media.media_download_error || null,
          media_download_bytes: inboundContext.media.media_download_bytes || null,
          media_download_mime_type: inboundContext.media.media_download_mime_type || null,
          media_resolution_reason: mediaResolution?.reason || null,
          media_resolution_stage: mediaResolution?.error?.stage || null,
          download_status: inboundMediaMetadata.download_status || null,
          media_sha256: inboundMediaMetadata.sha256 || null,
          media_voice: inboundMediaMetadata.voice,
          media_timestamp: inboundMediaMetadata.timestamp || null,
          media_location_latitude: inboundMediaMetadata.location?.latitude ?? null,
          media_location_longitude: inboundMediaMetadata.location?.longitude ?? null,
          media_location_name: inboundMediaMetadata.location?.name || null,
          media_location_address: inboundMediaMetadata.location?.address || null,
          interactive_type: inboundMediaMetadata.interactive?.interactive_type || null,
          interactive_button_reply_id: inboundMediaMetadata.interactive?.button_reply_id || null,
          interactive_button_reply_title: inboundMediaMetadata.interactive?.button_reply_title || null,
          interactive_list_reply_id: inboundMediaMetadata.interactive?.list_reply_id || null,
          interactive_list_reply_title: inboundMediaMetadata.interactive?.list_reply_title || null,
          audio_transcription_status: inboundMediaMetadata.audio_transcription?.status || null,
          audio_transcription_success: !!inboundMediaMetadata.audio_transcription?.success,
          audio_transcription_provider: inboundMediaMetadata.audio_transcription?.provider || null,
          audio_transcription_model: inboundMediaMetadata.audio_transcription?.model || null,
          audio_transcription_confidence: inboundMediaMetadata.audio_transcription?.confidence_score ?? null,
          audio_transcription_needs_confirmation: !!inboundMediaMetadata.audio_transcription?.needs_confirmation,
          audio_transcription_error_code: inboundMediaMetadata.audio_transcription?.error_code || null,
          audio_transcription_error_message: inboundMediaMetadata.audio_transcription?.error_message || null,
          image_vision_status: inboundMediaMetadata.image_vision?.status || null,
          image_vision_success: !!inboundMediaMetadata.image_vision?.success,
          image_vision_provider: inboundMediaMetadata.image_vision?.provider || null,
          image_vision_model: inboundMediaMetadata.image_vision?.model || null,
          image_vision_confidence: inboundMediaMetadata.image_vision?.property_signals?.confidence ?? null,
          image_vision_probable_property_type:
            inboundMediaMetadata.image_vision?.property_signals?.probablePropertyType || null,
          image_vision_visible_area_type:
            inboundMediaMetadata.image_vision?.property_signals?.visibleAreaType || null,
          image_vision_apparent_condition:
            inboundMediaMetadata.image_vision?.property_signals?.apparentCondition || null,
          image_vision_error_code: inboundMediaMetadata.image_vision?.error_code || null,
          image_vision_error_message: inboundMediaMetadata.image_vision?.error_message || null,
        });
      }

    if (!signals.property_code) {
      const propertySlug = extractPropertySlugFromText(text);
      if (propertySlug) {
        const propertyFromSlug = await getPropertyBySlug(propertySlug);
        if (propertyFromSlug?.listing_id) {
          signals.property_code = propertyFromSlug.listing_id;
          signals.direct_property_reference = true;
          signals.lead_flow = 'demand';
          signals.operation_type = propertyFromSlug.operation_type || signals.operation_type || null;
          signals.user_goal = 'search_property';
          await saveConversationEvent(conversationId, 'direct_property_slug_resolved', {
            slug: propertySlug,
            property_id: propertyFromSlug.id,
            listing_id: propertyFromSlug.listing_id,
          });
        } else {
          await saveConversationEvent(conversationId, 'direct_property_slug_not_found', {
            slug: propertySlug,
          });
        }
      }
    }

    if (signals?.property_code || /LUX|[A-Z]\d{4}/i.test(text || '')) {
      console.log('PROPERTY CODE DEBUG:', {
        raw_text: text,
        parsed_property_code: signals?.property_code || null,
        normalized_property_code: normalizeListingId(signals?.property_code || text),
      });
    }

    if (signals.direct_property_reference && signals.property_code) {
      const normalizedDirectCode = normalizeListingId(signals.property_code);

      console.log('DIRECT PROPERTY ENTRY:', {
        raw_text: text,
        parsed_property_code: signals.property_code,
        normalized_direct_code: normalizedDirectCode,
      });

      const property = normalizedDirectCode
        ? await getPropertyByCode(normalizedDirectCode)
        : null;

      const directPropertyAssignedAgentId = getAssignedAgentProfileIdFromProperty(property);

      console.log('DIRECT PROPERTY PRIORITY RESULT:', {
        requested_code: signals.property_code,
        normalized_code: normalizedDirectCode,
        found: !!property,
        property_id: property?.id || null,
        listing_id: property?.listing_id || null,
      });

      if (!property) {
        const directState = {
          ...previousAiState,
          ...signals,
          lead_flow: 'demand',
          property_code: normalizedDirectCode || signals.property_code,
          direct_property_reference: true,
          direct_property_code: normalizedDirectCode || signals.property_code,
          last_search_result_count: 0,
          last_shown_property_ids: [],
          result_quality: 'none',
          top_match_score: 0,
          awaiting_field: null,
        };
        directState.next_step = getNextStep(
          { leadType: 'demand', directPropertyReference: true },
          directState
        );
        applyPlaybookProgress(directState, {
          playbookType: 'property_interest',
          matchedProperties: [],
        });

        const notFoundReply = enrichReplyWithNextStepCta(
          'No encontré esa propiedad disponible en este momento. Si deseas, puedo mostrarte opciones similares. ¿Qué zona te interesa?',
          directState.next_step
        );

        await saveConversationState(conversationId, directState);

        conversations.set(
          from,
          [
            ...(conversations.get(from) || []),
            { role: 'user', content: text },
            { role: 'assistant', content: notFoundReply },
          ].slice(-MAX_SHORT_MEMORY_MESSAGES)
        );

        await saveOutboundMessages({
          conversationId,
          messages: notFoundReply,
          rawPayload: {},
        });

        await sendWhatsAppMessages(from, notFoundReply);
        return;
      }

      const directState = {
        ...previousAiState,
        ...signals,
        lead_flow: 'demand',
        operation_type: property.operation_type || signals.operation_type || previousAiState.operation_type || null,
        property_code: normalizedDirectCode || signals.property_code,
        direct_property_reference: true,
        assigned_agent_profile_id:
          directPropertyAssignedAgentId || previousAiState.assigned_agent_profile_id || null,
        direct_property_code: normalizedDirectCode || signals.property_code,
        intent_type: 'property_interest',
        playbook_type: 'property_interest',
        last_search_result_count: 1,
        last_shown_property_ids: [property.id],
        result_quality: 'strong',
        top_match_score: 100,
        awaiting_field: null,
      };
      const directPropertyHasSlug = hasValidPropertySlug(property);
      if (!directPropertyHasSlug) {
        directState.wants_human = true;
        directState.handoff_ready = true;
        await saveConversationEvent(conversationId, 'direct_property_missing_public_slug', {
          property_id: property.id,
          listing_id: property.listing_id || null,
          requested_code: signals.property_code,
          requires_human_attention: true,
        });
      }

      directState.next_step = getNextStep(
        { leadType: 'demand', directPropertyReference: true },
        directState
      );
      applyPlaybookProgress(directState, {
        playbookType: 'property_interest',
        matchedProperties: [property],
      });

      const directReplyBase = buildDemandReply(
        directState,
        null,
        [property],
        'direct_property_code'
      );
      const directReply = Array.isArray(directReplyBase)
        ? directReplyBase.map((message) => sanitizeReply(message)).filter(Boolean)
        : sanitizeReply(enrichReplyWithNextStepCta(directReplyBase, directState.next_step));

      const directOutbound = await saveOutboundMessages({
        conversationId,
        messages: directReply,
        rawPayload: {},
      });

      if (directOutbound.rows[0]?.id) {
        await savePropertySuggestions(conversationId, directOutbound.rows[0].id, [property]);
      }

      const contactId = await upsertContactForConversation(conversationRow, directState, from);
      const leadAutomationResult = await maybeCreateOrReuseLeadWithEngine({
        conversationId,
        conversationRow,
        nextAiState: directState,
        contactId,
        property,
        messageText: text,
        referralContext: normalizedReferral,
        rawPayload: inboundRawPayload,
      });

      if (leadAutomationResult?.handoffTriggered) {
        directState.handoff_ready = true;

        await saveConversationEvent(conversationId, 'intelligent_handoff_ready', {
          lead_id: leadAutomationResult.leadId || null,
          assigned_agent_profile_id: leadAutomationResult.assignedAgentProfileId || null,
          source: 'ai_agent',
          message_preserved: 'property_interest_microcommitment',
        });
      }

      await saveConversationState(conversationId, directState);
      await maybeGenerateAiSummary(conversationId, directState, [property]);

      const directOutboundMessages = normalizeOutboundMessages(directReply);
      conversations.set(
        from,
        [
          ...(conversations.get(from) || []),
          { role: 'user', content: text },
          {
            role: 'assistant',
            content:
              directOutboundMessages.join('\n\n') ||
              (Array.isArray(directReply) ? directReply.join('\n\n') : directReply),
          },
        ].slice(-MAX_SHORT_MEMORY_MESSAGES)
      );

      await sendWhatsAppMessages(from, directReply);
      return;
    }

    if (incomingSignals.location_text && !incomingSignals.location_any) {
      const rawLoc = normalizeText(incomingSignals.location_text);

      if (!['venta', 'renta', 'compra', 'comprar', 'rentar', 'vender'].includes(rawLoc)) {
        const canonicalLocation = findCanonicalLocation(incomingSignals.location_text);
        incomingSignals.location_text = canonicalLocation || incomingSignals.location_text;
        incomingSignals.matched_location_from_catalog =
          canonicalLocation || incomingSignals.location_text;
      }
    }

    const changeType = detectStateChange(previousAiState, incomingSignals);
    let nextAiState = buildNextState(previousAiState, incomingSignals, changeType);

    // Persistir referral en ai_state para detección de pauta en cierre por inactividad.
    // buildNextState puede descartar campos extra en restart_flow, por lo que se aplica aquí.
    if (normalizedReferral) {
      nextAiState.whatsapp_referral = normalizedReferral;
    } else if (previousAiState.whatsapp_referral && !nextAiState.whatsapp_referral) {
      nextAiState.whatsapp_referral = previousAiState.whatsapp_referral;
    }

    // 🔒 Anti-loop: evitar repetir preguntas si ya estamos esperando respuesta
    if (previousAiState.awaiting_field && !incomingSignals[previousAiState.awaiting_field]) {
      nextAiState.awaiting_field = previousAiState.awaiting_field;
    }

    // ✅ Resolver awaiting_field cuando el usuario ya contestó
    if (
      previousAiState.awaiting_field &&
      (
        (previousAiState.awaiting_field === 'full_name' && !!incomingSignals.full_name) ||
        (previousAiState.awaiting_field === 'contact_preference' && !!incomingSignals.contact_preference) ||
        (previousAiState.awaiting_field === 'contact_number_confirmed' && incomingSignals.contact_number_confirmed !== null) ||
        (previousAiState.awaiting_field === 'location_text' && (!!incomingSignals.location_text || !!incomingSignals.location_any)) ||
        (previousAiState.awaiting_field === 'budget_max' && incomingSignals.budget_max != null) ||
        (previousAiState.awaiting_field === 'property_type' && !!incomingSignals.property_type) ||
        (previousAiState.awaiting_field === 'bedrooms' && (incomingSignals.bedrooms != null || !!incomingSignals.bedrooms_any))
      )
    ) {
      nextAiState.awaiting_field = null;
    }

    if (incomingSignals.location_any) {
      nextAiState.location_text = null;
      nextAiState.location_any = true;
    } else if (incomingSignals.location_text) {
      nextAiState.location_text = incomingSignals.location_text;
      nextAiState.location_any = false;
    }

    if (incomingSignals.matched_location_from_catalog) {
      nextAiState.matched_location_from_catalog =
        incomingSignals.matched_location_from_catalog;
    }

    if (incomingSignals.better_phone) {
      nextAiState.contact_number_confirmed = true;
    }

    if (inboundContext?.media?.type) {
      nextAiState.last_media_type = inboundContext.media.type;
      nextAiState.last_media_category = inboundContext.media.category || null;
      nextAiState.last_media_id = inboundContext.media.media_id || null;
      nextAiState.last_media_mime_type = inboundContext.media.mime_type || null;
      nextAiState.last_media_file_name = inboundContext.media.file_name || null;
      nextAiState.last_media_map_url = inboundContext.media.map_url || null;
      nextAiState.last_media_forwarded = !!inboundContext.media.is_forwarded;
      nextAiState.last_media_detected_not_processed = !!inboundContext.media.attachment_detected_not_processed;
      nextAiState.last_media_unsupported = !!inboundContext.media.unsupported_media;
      nextAiState.property_image_candidate = !!inboundContext.media.property_image_candidate;
      nextAiState.legal_or_property_document_candidate = !!inboundContext.media.legal_or_property_document_candidate;
      nextAiState.last_media_downloaded = !!inboundContext.media.media_downloaded;
      nextAiState.last_media_download_error = inboundContext.media.media_download_error || null;
      nextAiState.last_media_download_bytes = inboundContext.media.media_download_bytes || null;
      nextAiState.last_media_download_mime_type = inboundContext.media.media_download_mime_type || null;
      nextAiState.last_media_download_status = inboundContext.media.media_download_status || null;
    }

    if (inboundContext?.media?.audio_has_transcription && transcriptionText) {
      nextAiState.last_audio_transcription = transcriptionText;
      nextAiState.has_audio_without_transcription = false;
      nextAiState.last_audio_transcription_status =
        inboundContext.media.audio_transcription?.status || 'transcribed';
      nextAiState.last_audio_transcription_confidence =
        inboundContext.media.audio_transcription?.confidence_score != null
          ? Number(inboundContext.media.audio_transcription.confidence_score)
          : null;
      nextAiState.last_audio_transcription_needs_confirmation =
        !!inboundContext.media.audio_transcription?.needs_confirmation;
    }

    if (inboundContext?.media?.audio_without_transcription) {
      nextAiState.has_audio_without_transcription = true;
    }

    if (inboundContext?.media?.image_vision) {
      nextAiState.last_image_vision_status = inboundContext.media.image_vision.status || null;
      nextAiState.last_image_vision_summary = inboundContext.media.image_vision.summary || null;
      nextAiState.last_image_vision_confidence =
        inboundContext.media.image_vision.propertySignals?.confidence != null
          ? Number(inboundContext.media.image_vision.propertySignals.confidence)
          : null;
      nextAiState.last_image_vision_property_type =
        inboundContext.media.image_vision.propertySignals?.probablePropertyType || null;
      nextAiState.last_image_vision_area_type =
        inboundContext.media.image_vision.propertySignals?.visibleAreaType || null;
      nextAiState.last_image_vision_condition =
        inboundContext.media.image_vision.propertySignals?.apparentCondition || null;
    }

    if (unifiedContext?.ok) {
      const fusedCategory = unifiedContext.normalizedIntent?.category || null;

      if (!nextAiState.lead_flow) {
        if (['sell_property', 'rent_out_property', 'valuate_property'].includes(fusedCategory)) {
          nextAiState.lead_flow = 'offer';
        } else if (['buy_property', 'rent_property', 'visit_property', 'ask_property_info'].includes(fusedCategory)) {
          nextAiState.lead_flow = 'demand';
        }
      }

      if (!nextAiState.operation_type) {
        if (fusedCategory === 'rent_out_property' || fusedCategory === 'rent_property') {
          nextAiState.operation_type = 'rent';
        } else if (['sell_property', 'buy_property', 'valuate_property'].includes(fusedCategory)) {
          nextAiState.operation_type = 'sale';
        }
      }

      if (unifiedContext.normalizedIntent?.requiresHumanAdvisor) {
        nextAiState.wants_human = true;
      }

      if (
        fusedCategory === 'ask_property_info' &&
        (unifiedContext.sourceSignals?.hasCampaignContext || unifiedContext.sourceSignals?.hasPropertyContext)
      ) {
        nextAiState.asks_property_details = true;
      }

      nextAiState.context_fusion = {
        last_intent_category: unifiedContext.normalizedIntent?.category || null,
        last_intent_confidence: unifiedContext.normalizedIntent?.confidence ?? null,
        lead_type: unifiedContext.crmAction?.leadType || null,
        offer_context: unifiedContext.propertyOffer || null,
        demand_context: unifiedContext.propertyDemand || null,
        last_media_summary:
          unifiedContext.propertyOffer?.visualSummary ||
          unifiedContext.normalizedIntent?.source ||
          null,
        last_audio_text: transcriptionText || null,
        last_image_summary: unifiedContext.propertyOffer?.visualSummary || null,
        last_location: unifiedContext.propertyOffer?.location || null,
        missing_critical_fields: unifiedContext.missingCriticalFields || [],
        pending_question:
          unifiedContext.shouldAskOneMoreQuestion
            ? unifiedContext.suggestedNextQuestion || null
            : null,
        crm_action_last_decision: unifiedContext.crmAction || null,
        source_signals: unifiedContext.sourceSignals || null,
        should_create_or_update_lead: !!unifiedContext.shouldCreateOrUpdateLead,
        updated_at: nowIso(),
      };
    }

    if (incomingSignals.full_name) {
      nextAiState.full_name = incomingSignals.full_name;
    }

    // ✅ No volver a pedir datos que ya existen en estado
    if (nextAiState.full_name && nextAiState.awaiting_field === 'full_name') {
      nextAiState.awaiting_field = null;
    }

    if (nextAiState.contact_preference && nextAiState.awaiting_field === 'contact_preference') {
      nextAiState.awaiting_field = null;
    }

    if (
      nextAiState.contact_number_confirmed !== null &&
      nextAiState.awaiting_field === 'contact_number_confirmed'
    ) {
      nextAiState.awaiting_field = null;
    }

    if (
      (nextAiState.location_text || nextAiState.location_any) &&
      nextAiState.awaiting_field === 'location_text'
    ) {
      nextAiState.awaiting_field = null;
    }

    if (
      nextAiState.budget_max != null &&
      nextAiState.awaiting_field === 'budget_max'
    ) {
      nextAiState.awaiting_field = null;
    }

    if (
      nextAiState.property_type &&
      nextAiState.awaiting_field === 'property_type'
    ) {
      nextAiState.awaiting_field = null;
    }

    if (
      (nextAiState.bedrooms != null || nextAiState.bedrooms_any) &&
      nextAiState.awaiting_field === 'bedrooms'
    ) {
      nextAiState.awaiting_field = null;
    }

    if (
      (incomingSignals.wants_human || incomingSignals.wants_visit || incomingSignals.shows_high_interest) &&
      !previousAiState.direct_property_reference
    ) {
      const { createAgentFollowup } = require('./utils/helpers');

      const requestType = nextAiState?.lead_flow === 'offer' ? 'offer' : 'demand';

      // Verificar si ya existe followup activo
      const { data: existingFollowup, error: followupError } = await supabase
        .from('agent_followup_requests')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('request_type', requestType)
        .in('status', ['pending', 'assigned', 'contacted'])
        .limit(1);

      if (followupError) {
        console.error('Error checking existing followup:', followupError);
      }

      if (!existingFollowup || existingFollowup.length === 0) {
        await createAgentFollowup(supabase, {
          conversation_id: conversationId,
          lead_id: conversationRow?.lead_id || null,
          request_type: requestType,
          summary: incomingSignals.wants_visit
            ? 'Lead solicitó visita'
            : incomingSignals.shows_high_interest
            ? 'Lead mostró alto interés'
            : 'Lead pidió atención humana',
          priority: 'high',
          assigned_to_agent_profile_id: conversationRow?.assigned_agent_profile_id || null
        });
      }
    }

    if (incomingSignals.wants_visit) {
      nextAiState.wants_visit = true;
    }

    if (incomingSignals.shows_high_interest) {
      nextAiState.shows_high_interest = true;
    }

    if (incomingSignals.asks_property_details) {
      nextAiState.asks_property_details = true;
    }

    if (incomingSignals.property_code) {
      nextAiState.property_code = incomingSignals.property_code;
      nextAiState.direct_property_reference = true;
      nextAiState.direct_property_code = incomingSignals.property_code;
      nextAiState.lead_flow = 'demand';
    }

    const isNewSearchWithoutDirectProperty =
      !incomingSignals.property_code &&
      (
        incomingSignals.budget_max != null ||
        !!incomingSignals.location_text ||
        !!incomingSignals.location_any ||
        !!incomingSignals.property_type ||
        incomingSignals.bedrooms != null ||
        incomingSignals.bathrooms != null
      );

    if (isNewSearchWithoutDirectProperty) {
      nextAiState.direct_property_reference = false;
      nextAiState.property_code = null;
      nextAiState.direct_property_code = null;
    }

    const crossFamilyIntentChanged = markIntentChangeHandled(previousAiState, nextAiState);
    if (crossFamilyIntentChanged) {
      nextAiState.lead_id = null;
      nextAiState.crm_lead_created_at = null;
    }

    nextAiState.next_step = getNextStep(
      {
        leadType: nextAiState.lead_flow,
        operationType: nextAiState.operation_type,
        propertyCode: nextAiState.property_code,
        directPropertyReference: nextAiState.direct_property_reference,
      },
      nextAiState
    );

    if (nextAiState.lead_flow === 'offer') {
      if (nextAiState.location_text) {
        nextAiState.geo_qualified = qualifiesOfferGeo(nextAiState.location_text);
      }
      if (nextAiState.budget_max != null) {
        nextAiState.value_qualified = qualifiesOfferValue(nextAiState);
      }
      nextAiState.capture_qualified =
        nextAiState.geo_qualified === true &&
        nextAiState.value_qualified === true;
    }

    console.log('Previous ai_state:', previousAiState);
    console.log('Incoming signals:', incomingSignals);
    console.log('Change type:', changeType);
    console.log('Next ai_state before search:', nextAiState);

    await saveConversationEvent(conversationId, 'inbound_message_processed', {
      message_type: messageType,
      text,
      incoming_signals: incomingSignals,
      change_type: changeType,
      intent_changed: !!incomingSignals.intent_changed,
      previous_intent_type: previousAiState.intent_type || null,
      next_intent_type: nextAiState.intent_type || null,
      cross_family_intent_changed: crossFamilyIntentChanged,
    });

    if (incomingSignals.intent_changed) {
      await saveConversationEvent(conversationId, 'intent_changed', {
        previous_intent_type: previousAiState.intent_type || null,
        next_intent_type: nextAiState.intent_type || null,
        previous_lead_flow: previousAiState.lead_flow || null,
        next_lead_flow: nextAiState.lead_flow || null,
        cross_family_intent_changed: crossFamilyIntentChanged,
        previous_flow_closed: true,
        source: 'ai_agent',
      });
    }

    let matchedProperties = [];
    let attemptUsed = null;
    let resultQuality = 'none';
    let topMatchScore = 0;
    let rawResultCount = 0;

    if (nextAiState.direct_property_reference && nextAiState.property_code) {
      const normalizedLookupCode = normalizeListingId(nextAiState.property_code);

      await saveConversationEvent(conversationId, 'direct_property_lookup_started', {
        property_code: nextAiState.property_code,
        normalized_property_code: normalizedLookupCode,
      });

      const directProperty = normalizedLookupCode
        ? await getPropertyByCode(normalizedLookupCode)
        : null;

      console.log('DIRECT PROPERTY GENERAL RESULT:', {
        requested_code: nextAiState.property_code,
        normalized_code: normalizedLookupCode,
        found: !!directProperty,
        property_id: directProperty?.id || null,
        listing_id: directProperty?.listing_id || null,
      });

      if (directProperty && directProperty.id) {
        matchedProperties = [directProperty];
        attemptUsed = 'direct_property_code';
        resultQuality = 'strong';
        topMatchScore = 100;
        rawResultCount = 1;

        nextAiState.needs_fresh_search = false;
        nextAiState.result_quality = resultQuality;
        nextAiState.top_match_score = topMatchScore;
        nextAiState.last_search_filters = {
          attempt_used: attemptUsed,
          property_code: normalizedLookupCode || nextAiState.property_code,
          result_quality: resultQuality,
        };
        nextAiState.property_code = normalizedLookupCode || nextAiState.property_code;
        nextAiState.direct_property_code = normalizedLookupCode || nextAiState.direct_property_code || nextAiState.property_code;
        nextAiState.last_search_result_count = 1;
        nextAiState.last_shown_property_ids = [directProperty.id];

        if (!hasValidPropertySlug(directProperty)) {
          nextAiState.wants_human = true;
          nextAiState.handoff_ready = true;
          await saveConversationEvent(conversationId, 'direct_property_missing_public_slug', {
            property_id: directProperty.id,
            listing_id: directProperty.listing_id || null,
            property_code: normalizedLookupCode || nextAiState.property_code,
            requires_human_attention: true,
          });
        }

        await saveConversationEvent(conversationId, 'direct_property_lookup_found', {
          property_code: normalizedLookupCode || nextAiState.property_code,
          property_id: directProperty.id,
        });
      } else {
        matchedProperties = [];
        attemptUsed = 'direct_property_code_not_found';
        resultQuality = 'none';
        topMatchScore = 0;
        rawResultCount = 0;

        nextAiState.needs_fresh_search = false;
        nextAiState.result_quality = resultQuality;
        nextAiState.top_match_score = topMatchScore;
        nextAiState.last_search_filters = {
          attempt_used: attemptUsed,
          property_code: normalizedLookupCode || nextAiState.property_code,
          result_quality: resultQuality,
        };
        nextAiState.property_code = normalizedLookupCode || nextAiState.property_code;
        nextAiState.direct_property_code = normalizedLookupCode || nextAiState.direct_property_code || nextAiState.property_code;
        nextAiState.last_search_result_count = 0;
        nextAiState.last_shown_property_ids = [];

        await saveConversationEvent(conversationId, 'direct_property_lookup_not_found', {
          property_code: normalizedLookupCode || nextAiState.property_code,
        });
      }
    } else if (shouldRunPropertySearch(previousAiState, nextAiState)) {
      await saveConversationEvent(conversationId, 'search_started', {
        filters: {
          operation_type: nextAiState.operation_type,
          location_text: nextAiState.location_text,
          budget_max: nextAiState.budget_max,
          budget_currency: nextAiState.budget_currency,
          bedrooms: nextAiState.bedrooms,
          property_type: nextAiState.property_type,
        },
      });

      const searchResult = await searchPropertiesWithFallbacks(nextAiState);
      matchedProperties = searchResult.properties;
      attemptUsed = searchResult.attemptUsed;
      resultQuality = searchResult.resultQuality || 'none';
      topMatchScore = Number(searchResult.topMatchScore || 0);
      rawResultCount = Number(searchResult.rawResultCount || matchedProperties.length || 0);

      nextAiState.needs_fresh_search = false;
      nextAiState.result_quality = resultQuality;
      nextAiState.top_match_score = topMatchScore;
      nextAiState.last_search_filters = {
        operation_type: nextAiState.operation_type,
        location_text: nextAiState.location_text,
        budget_max: nextAiState.budget_max,
        budget_currency: nextAiState.budget_currency,
        bedrooms: nextAiState.bedrooms,
        property_type: nextAiState.property_type,
        attempt_used: attemptUsed,
        result_quality: resultQuality,
      };
      nextAiState.last_search_result_count = matchedProperties.length;
      nextAiState.last_shown_property_ids = matchedProperties.map((p) => p.id);

      await saveConversationEvent(
        conversationId,
        matchedProperties.length > 0 ? 'search_results_found' : 'search_no_results',
        {
          filters: nextAiState.last_search_filters,
          result_count: matchedProperties.length,
          raw_result_count: rawResultCount,
          result_quality: resultQuality,
          top_match_score: topMatchScore,
        }
      );
    }

    applyPlaybookProgress(nextAiState, { matchedProperties });

    nextAiState.crm_structured_summary = buildStructuredSellerCrmSummary({
      aiState: nextAiState,
      conversation: conversationRow,
      property: matchedProperties[0] || null,
    });

    nextAiState.missing_information = Array.isArray(nextAiState.crm_structured_summary?.missing_information)
      ? nextAiState.crm_structured_summary.missing_information
      : nextAiState.missing_information;

    nextAiState.risk_flags = Array.isArray(nextAiState.crm_structured_summary?.risk_flags)
      ? nextAiState.crm_structured_summary.risk_flags
      : nextAiState.risk_flags;

    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);

    let reply = null;
    let fallbackReason = null;

    function shouldAskField(state, fieldName) {
      if (!state) return false;

      if (fieldName === 'full_name') return !state.full_name;
      if (fieldName === 'contact_preference') return !state.contact_preference;
      if (fieldName === 'contact_number_confirmed') return state.contact_number_confirmed == null;
      if (fieldName === 'location_text') return !state.location_text && !state.location_any;
      if (fieldName === 'budget_max') return state.budget_max == null;
      if (fieldName === 'property_type') return !state.property_type;
      if (fieldName === 'bedrooms') return state.bedrooms == null && !state.bedrooms_any;

      return true;
    }

    function shouldUsePlaybookReply(state, step) {
      if (!step || state.handoff_sent) return false;
      const fieldName = getPlaybookAwaitingField(step);
      if (!fieldName) return state.awaiting_field == null;
      return shouldAskField(state, fieldName);
    }

    if (inboundContext?.media?.audio_transcription_duplicate) {
      fallbackReason = 'audio_transcription_duplicate';
      reply = 'Gracias, ya tengo ese punto principal de tu audio. Para avanzar sin repetir información, ¿prefieres que te conecte con un asesor o seguimos afinando detalles aquí?';
    } else if (inboundContext?.media?.audio_low_confidence) {
      fallbackReason = 'audio_low_confidence';
      reply = 'Gracias, recibí tu audio y pude transcribir una parte. Para evitar errores, ¿me confirmas en una frase el dato más importante? Si prefieres, también puedo pedir que un asesor te contacte.';
    } else if (inboundContext?.media?.audio_without_transcription) {
      fallbackReason = 'audio_without_transcription';
      reply = buildMediaAcknowledgementReply(inboundContext.media);
    } else if (incomingSignals.non_real_estate_or_provider) {
      reply = 'Gracias por tu mensaje. Este canal esta enfocado en compra, renta y venta de propiedades. Si tu solicitud es de otro tipo, con gusto la canalizo por la via interna correspondiente.';
      nextAiState.lead_flow = null;
      nextAiState.operation_type = null;
      nextAiState.awaiting_field = null;
    } else if (incomingSignals.complaint_followup) {
      nextAiState.wants_human = true;
      reply = 'Tienes razon, gracias por decirmelo. Te apoyo a retomarlo con prioridad y seguimiento humano. Para ubicar tu caso rapido, ¿me confirmas tu nombre y si era por compra, renta o venta?';
      if (!nextAiState.full_name) {
        nextAiState.awaiting_field = 'full_name';
      }
    } else if (incomingSignals.low_info_campaign_message && !incomingSignals.lead_flow) {
      const campaignContext = extractCampaignReferralContext({
        aiState: nextAiState,
        referral: normalizedReferral,
        rawPayload: inboundRawPayload,
        messageText: text,
      });
      reply = buildLowInfoCampaignReply(campaignContext.hasCampaignContext);
    } else if (isGreetingOnly(text) && !previousAiState.lead_flow && !incomingSignals.property_code) {
      reply =
        'Hola, bienvenido a Luxetty 😊\n¿En qué puedo orientarte hoy? ¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    } else if (nextAiState.handoff_sent && isClosureCheck(text)) {
      // 🚫 No responder para evitar duplicar cierre
      return;
    } else if (nextAiState.direct_property_reference && nextAiState.property_code && matchedProperties.length === 0) {
      reply = `No encontré esa propiedad disponible en este momento. Si deseas, puedo ayudarte a buscar opciones similares. ¿Qué zona te interesa?`;
    } else if (shouldUsePlaybookReply(nextAiState, nextAiState.playbook_step)) {
      const playbookReply = buildPlaybookReply(nextAiState.playbook_step, nextAiState);
      if (playbookReply) {
        const awaitingField = getPlaybookAwaitingField(nextAiState.playbook_step);
        reply = playbookReply;
        if (awaitingField && shouldAskField(nextAiState, awaitingField)) {
          nextAiState.awaiting_field = awaitingField;
        }
      }
    } else if (nextAiState.lead_flow === 'demand') {
      const explicitHandoffIntent =
        nextAiState.wants_human ||
        normalizedText.includes('contacte un asesor') ||
        normalizedText.includes('contacte un agente');

      const shouldAnswerDirectPrice =
        nextAiState.direct_property_reference &&
        matchedProperties.length > 0 &&
        isDirectPriceQuestion(text) &&
        !nextAiState.wants_visit &&
        !explicitHandoffIntent;

      reply = shouldAnswerDirectPrice
        ? buildPropertyPriceReply(matchedProperties[0], nextAiState)
        : buildDemandReply(nextAiState, changeType, matchedProperties, attemptUsed);

      const commercialHandoffIntent =
        shouldPrioritizeDemandHandoff(nextAiState, matchedProperties);

      const isHotDemandLead =
        (
          nextAiState.wants_visit ||
          nextAiState.shows_high_interest ||
          nextAiState.asks_property_details ||
          nextAiState.direct_property_reference
        ) &&
        matchedProperties.length > 0;

      if (
        !shouldAnswerDirectPrice &&
        (explicitHandoffIntent || commercialHandoffIntent || isHotDemandLead) &&
        shouldAskField(nextAiState, 'full_name')
      ) {
        reply = nextAiState.wants_visit
          ? 'Para coordinar la visita, ¿me compartes tu nombre, por favor?'
          : 'Para canalizarte con un asesor de Luxetty, ¿me compartes tu nombre, por favor?';
        nextAiState.awaiting_field = 'full_name';
      } else if (
        !shouldAnswerDirectPrice &&
        (explicitHandoffIntent || commercialHandoffIntent || isHotDemandLead) &&
        nextAiState.full_name &&
        shouldAskField(nextAiState, 'contact_preference')
      ) {
        reply = '¿Prefieres que te contacten por WhatsApp o por llamada?';
        nextAiState.awaiting_field = 'contact_preference';
      } else if (
        !shouldAnswerDirectPrice &&
        (explicitHandoffIntent || commercialHandoffIntent || isHotDemandLead) &&
        nextAiState.full_name &&
        nextAiState.contact_preference &&
        shouldAskField(nextAiState, 'contact_number_confirmed')
      ) {
        reply = '¿Este es el mejor número para contactarte?';
        nextAiState.awaiting_field = 'contact_number_confirmed';
      }

      const canCreateDemandHandoff =
        !shouldAnswerDirectPrice &&
        (shouldEscalateDemand(nextAiState, matchedProperties, text) || commercialHandoffIntent) &&
        !!nextAiState.full_name &&
        !!nextAiState.contact_preference &&
        nextAiState.contact_number_confirmed === true &&
        !nextAiState.handoff_sent;

      if (canCreateDemandHandoff) {
        const contactId = await upsertContactForConversation(conversationRow, nextAiState, from);
        const summary =
          buildAiSummary(nextAiState, matchedProperties) ||
          'Cliente buscando propiedad y requiere seguimiento humano.';

        await maybeCreateFollowupRequest({
          conversationId,
          state: nextAiState,
          summary,
          priority: getDemandFollowupPriority(nextAiState, matchedProperties),
          requestType: 'demand',
        });

        nextAiState.handoff_ready = true;
        nextAiState.handoff_sent = true;
        nextAiState.awaiting_field = null;
        reply = buildFinalHandoffReply(nextAiState);
      } else {
        if (
          !matchedProperties.length &&
          nextAiState.full_name &&
          nextAiState.contact_preference &&
          nextAiState.contact_number_confirmed === true &&
          !nextAiState.handoff_sent &&
          !canCreateDemandHandoff
        ) {
          if (nextAiState.handoff_sent) {
            return;
          }

          const contactId = await upsertContactForConversation(conversationRow, nextAiState, from);
          const summary =
            buildAiSummary(nextAiState, matchedProperties) ||
            'Cliente buscando propiedad y requiere seguimiento humano.';
          await maybeCreateFollowupRequest({
            conversationId,
            state: nextAiState,
            summary,
            priority: 'high',
            requestType: 'demand',
          });

          nextAiState.handoff_ready = true;
          nextAiState.handoff_sent = true;
          nextAiState.awaiting_field = null;
          reply = buildFinalHandoffReply(nextAiState);
        } else {
          if (nextAiState.awaiting_field == null) {
            if (
              matchedProperties.length > 0 &&
              shouldAskField(nextAiState, 'full_name') &&
              (
                normalizedText.includes('asesor') ||
                normalizedText.includes('contacte') ||
                nextAiState.wants_visit ||
                nextAiState.shows_high_interest ||
                nextAiState.asks_property_details ||
                nextAiState.direct_property_reference
              )
            ) {
              nextAiState.awaiting_field = 'full_name';
              reply = nextAiState.wants_visit
                ? 'Para coordinar la visita, ¿me compartes tu nombre, por favor?'
                : 'Para canalizarte con un asesor de Luxetty, ¿me compartes tu nombre, por favor?';
            }
          }
        }
      }

      reply = prependVisionPrefixIfNeeded(reply, inboundContext?.media, nextAiState);
    } else if (nextAiState.lead_flow === 'offer') {
      const mediaReply = shouldUseMediaAcknowledgement(
        inboundContext?.media,
        incomingSignals,
        previousAiState,
        nextAiState
      )
        ? buildMediaAcknowledgementReply(inboundContext?.media)
        : null;

      if (mediaReply) {
        reply = mediaReply;
      } else {
        reply = buildOfferReply(nextAiState, changeType, { signals: incomingSignals, text });
        reply = prependVisionPrefixIfNeeded(reply, inboundContext?.media, nextAiState);
      }

      if (
        nextAiState.capture_qualified === false &&
        nextAiState.location_text &&
        nextAiState.budget_max != null
      ) {
        nextAiState.handoff_ready = false;
        nextAiState.awaiting_field = null;
        await updateConversationMeta(conversationId, {
          status: 'closed',
        });
      }

      if (shouldEscalateOffer(nextAiState) && !nextAiState.handoff_sent) {
        const contactId = await upsertContactForConversation(conversationRow, nextAiState, from);

        const summary =
          buildAiSummary(nextAiState, matchedProperties) ||
          'Cliente quiere vender o poner en renta una propiedad.';

        await maybeCreateFollowupRequest({
          conversationId,
          state: nextAiState,
          summary,
          priority: 'high',
          requestType: 'offer',
        });

        nextAiState.handoff_ready = true;
        nextAiState.handoff_sent = true;
        nextAiState.awaiting_field = null;
        reply = buildFinalHandoffReply(nextAiState);
      }
    } else {
      const mediaReply = shouldUseMediaAcknowledgement(
        inboundContext?.media,
        incomingSignals,
        previousAiState,
        nextAiState
      )
        ? buildMediaAcknowledgementReply(inboundContext?.media)
        : null;

      if (mediaReply) {
        fallbackReason = 'media_acknowledgement';
        reply = mediaReply;
      }

      if (reply) {
        // Mantiene fallback de media sin transcripcion o imagen cuando no hay flujo definido.
      } else {
      const prevMessages = conversations.get(from) || [];

      const consultantContext = buildPerseoConsultantContext(nextAiState, prevMessages, {
        userMessage: text,
        changeType,
        matchedPropertiesCount: 0,
        locationCatalog: locationCatalog.rawNames,
      });

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: PERSEO_CONSULTANT_SYSTEM_PROMPT },
          { role: 'system', content: consultantContext },
          ...prevMessages,
          {
            role: 'system',
            content: `Estado actual:
${safeJsonStringify(nextAiState)}

RESULTADOS_REALES_DEL_SISTEMA: []
No hay propiedades para mostrar en este turno.
Está prohibido reutilizar propiedades viejas.
Ubicaciones disponibles del sistema:
${locationCatalog.rawNames.join(', ')}
`,
          },
          { role: 'user', content: text },
        ],
      });

      reply =
        response.choices?.[0]?.message?.content?.trim() ||
        '¿En qué puedo orientarte? ¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
      }
    }

    if (!reply) {
      if (unifiedContext?.shouldAskOneMoreQuestion && unifiedContext?.suggestedNextQuestion) {
        reply = unifiedContext.suggestedNextQuestion;
      }
    }

    if (!reply) {
      reply = await buildFallbackOpenAIReply(text, nextAiState, changeType);
      fallbackReason = fallbackReason || 'fallback_openai_reply';
    }

    const getReplyText = (value) => (Array.isArray(value) ? value.join('\n\n') : value);

    reply = sanitizeReply(getReplyText(reply));

    // ✅ Anti-loop semántico: evitar preguntas ya resueltas
    if (
      reply &&
      nextAiState.full_name &&
      /nombre completo/i.test(reply) &&
      shouldAskField(nextAiState, 'contact_preference')
    ) {
      reply = '¿Prefieres que te contacten por WhatsApp o por llamada?';
      nextAiState.awaiting_field = 'contact_preference';
    }

    if (
      reply &&
      nextAiState.contact_preference &&
      /whatsapp o por llamada/i.test(reply) &&
      shouldAskField(nextAiState, 'contact_number_confirmed')
    ) {
      reply = '¿Este es el mejor número para contactarte?';
      nextAiState.awaiting_field = 'contact_number_confirmed';
    }

    if (
      reply &&
      nextAiState.contact_number_confirmed !== null &&
      /mejor numero para contactarte|mejor número para contactarte/i.test(reply)
    ) {
      nextAiState.awaiting_field = null;
    }

    nextAiState.next_step = getNextStep(
      {
        leadType: nextAiState.lead_flow,
        operationType: nextAiState.operation_type,
        propertyCode: nextAiState.property_code,
        directPropertyReference: nextAiState.direct_property_reference,
      },
      nextAiState
    );
    reply = sanitizeReply(enrichReplyWithNextStepCta(reply, nextAiState.next_step));

    // 🔒 Anti-loop: evitar repetir exactamente la misma respuesta
    const lastMessages = conversations.get(from) || [];
    const lastAssistantMessage = [...lastMessages].reverse().find(m => m.role === 'assistant');


    if (
      lastAssistantMessage &&
      lastAssistantMessage.content === reply &&
      nextAiState.lead_flow !== 'demand'
    ) {
      reply = 'Entendido. ¿Puedes darme un poco más de detalle para orientarte mejor?';
      fallbackReason = 'anti_loop_same_reply';
    }

    const updatedMessages = [
      ...(conversations.get(from) || []),
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ];

    conversations.set(from, updatedMessages.slice(-MAX_SHORT_MEMORY_MESSAGES));

    const shouldAttemptLeadAutomation =
      !isGreetingOnly(text) &&
      (
        nextAiState.lead_flow === 'demand' ||
        nextAiState.lead_flow === 'offer' ||
        nextAiState.direct_property_reference ||
        nextAiState?.context_fusion?.should_create_or_update_lead
      );

    if (shouldAttemptLeadAutomation) {
      const propertyForLead =
        nextAiState.direct_property_reference && matchedProperties.length > 0
          ? matchedProperties[0]
          : null;
      const contactId = await upsertContactForConversation(conversationRow, nextAiState, from);

      if (contactId) {
        const leadAutomationResult = await maybeCreateOrReuseLeadWithEngine({
          conversationId,
          conversationRow,
          nextAiState,
          contactId,
          property: propertyForLead,
          messageText: text,
          referralContext: normalizedReferral,
          rawPayload: inboundRawPayload,
          unifiedContext: nextAiState?.context_fusion || null,
        });

        if (
          leadAutomationResult?.handoffTriggered &&
          !lastAssistantMessage?.content?.includes('Para darte una atención más precisa, puedo canalizar')
        ) {
          reply = buildIntelligentHandoffReply();
          nextAiState.handoff_ready = true;
          nextAiState.handoff_sent = true;

          const refreshedMessages = [
            ...(conversations.get(from) || []).slice(0, -1),
            { role: 'assistant', content: reply },
          ];
          conversations.set(from, refreshedMessages.slice(-MAX_SHORT_MEMORY_MESSAGES));

          await saveConversationEvent(conversationId, 'intelligent_handoff_message_sent', {
            lead_id: leadAutomationResult.leadId || null,
            assigned_agent_profile_id: leadAutomationResult.assignedAgentProfileId || null,
            source: 'ai_agent',
          });
        }
      }
    }

    if (inboundContext?.media && inboundContext.media.type !== 'text') {
      const metadataMimeOriginal =
        mediaResolution?.metadata_mime_original ||
        inboundMediaMetadata?.mime_type ||
        inboundContext?.media?.mime_type ||
        null;
      const responseContentTypeOriginal = mediaResolution?.response_content_type_original || null;
      const normalizedMime =
        mediaResolution?.normalized_mime ||
        mediaResolution?.mime_type ||
        inboundContext?.media?.media_download_mime_type ||
        inboundContext?.media?.mime_type ||
        null;
      const bufferSize =
        mediaResolution?.size_bytes ||
        (Buffer.isBuffer(mediaResolution?.buffer) ? mediaResolution.buffer.length : 0) ||
        0;

      logDebugMediaPipeline('final', {
        media_type: inboundContext?.media?.type || messageType || null,
        media_id_present: !!(inboundMediaMetadata?.media_id || mediaResolution?.media_id),
        media_id: inboundMediaMetadata?.media_id || mediaResolution?.media_id || null,
        metadata_mime_original: metadataMimeOriginal,
        response_content_type_original: responseContentTypeOriginal,
        normalized_mime: normalizedMime,
        media_url_resolved: mediaResolution?.media_url_resolved === true,
        download_status: mediaResolution?.download_status || 'not_attempted',
        buffer_size: bufferSize,
        transcription_attempted: transcriptionAttempted,
        transcription_success: transcriptionSuccess,
        transcription_error_code: transcriptionErrorCode,
        transcription_error_message: transcriptionErrorMessage,
        final_input_text_source: finalInputTextSource,
        fallback_reason: fallbackReason,
      });
    }

    const outboundResult = await saveOutboundMessages({
      conversationId,
      messages: reply,
      rawPayload: {},
    });

    if (matchedProperties.length > 0 && outboundResult.rows[0]?.id) {
      await savePropertySuggestions(
        conversationId,
        outboundResult.rows[0].id,
        matchedProperties
      );

      await saveConversationEvent(conversationId, 'properties_suggested', {
        property_ids: matchedProperties.map((p) => p.id),
        count: matchedProperties.length,
        raw_result_count: rawResultCount,
        result_quality: resultQuality,
        top_match_score: topMatchScore,
        direct_property_reference: !!nextAiState.direct_property_reference,
        property_code: nextAiState.property_code || null,
      });
    }

    await saveConversationState(conversationId, nextAiState);
    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);
    await sendWhatsAppMessages(from, reply);

    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const change of changes) {
        const value = change?.value || {};
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        for (const message of messages) {
          try {
            await processInboundWhatsAppMessage({ entry, change, value, message });
          } catch (messageError) {
            console.error('--- ERROR WEBHOOK MESSAGE ---');
            console.error(
              messageError?.response?.data ||
                messageError?.stack ||
                messageError?.message ||
                messageError
            );

            const fallbackFromRaw = message?.from;
            const fallbackTo = normalizePhoneNumber(fallbackFromRaw) || fallbackFromRaw;

            if (fallbackTo) {
              try {
                await sendWhatsAppText(
                  fallbackTo,
                  'Perdón, tuve un problema momentáneo. ¿Me lo puedes repetir en una sola frase?'
                );
              } catch (sendError) {
                console.error(
                  'Error enviando fallback:',
                  sendError?.response?.data || sendError?.message || sendError
                );
              }
            }
          }
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('--- ERROR WEBHOOK ---');
    console.error(error?.response?.data || error?.stack || error?.message || error);
    return res.sendStatus(200);
  }
});

refreshLocationCatalog(true).catch((err) => {
  console.error('Error on initial location catalog warmup:', err);
});

if (process.env.FOLLOWUP_AUTOMATION_ENABLED === 'true') {
  const intervalMinutes = Math.max(5, Number(process.env.FOLLOWUP_INTERVAL_MINUTES || 15));
  setInterval(() => {
    runInactivityFollowups({
      supabase,
      sendWhatsAppText,
      limit: Number(process.env.FOLLOWUP_JOB_LIMIT || 50),
      logger: console,
    }).catch((err) => {
      console.error('FOLLOWUP_INTERVAL_ERROR', err?.message || err);
    });
  }, intervalMinutes * 60 * 1000);

  console.log(`Follow-up automation enabled every ${intervalMinutes} minutes`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
});
