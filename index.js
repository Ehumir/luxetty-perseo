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
const messagePersistence = require('./services/saveConversationMessage');
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
const { ensureContactForConversationCore } = require('./services/contactProvisioning');

const { getDefaultAiState, normalizeAiState } = require('./conversation/aiState');
const { parseMessageSignals, isPropertyConversationFollowUp } = require('./conversation/parsers');
const {
  buildInboundMessageContext,
  buildMediaAcknowledgementReply,
  buildImageVisionContextPrefix,
} = require('./conversation/mediaSignals');
const { buildUnifiedConversationContext } = require('./conversation/contextFusion');
const {
  isDetailContinuation,
  mergeIntentWithPreviousState,
  extractCapturedDataFromState,
  decideNextConversationStep,
} = require('./conversation/contextPreservation');
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
const {
  DEFAULT_BURST_WINDOW_MS,
  consolidateInboundBurst,
  applyConversationIntentMemory,
  buildConversationContextSnapshot,
  chooseSingleUsefulQuestion,
  evaluateCommercialCloseDecision,
} = require('./conversation/inboundReliability');
const { applyCommercialClose } = require('./conversation/conversationClose');

const { normalizeText, cleanSpaces } = require('./utils/text');
const {
  uniq,
  nowIso,
  sanitizeReply,
  safeJsonStringify,
  normalizePhoneNumber,
  buildPhoneLookupValues,
  isUsefulContactName,
  isInvalidContactName,
  selectConversationReuseStrategy,
  extractWhatsAppReferral,
  normalizeOutboundMessages,
} = require('./utils/helpers');
const { isGreetingOnly } = require('./utils/messageChecks');
const {
  interceptQaCommand,
  isQaLeadBlocked,
  parseQaCommand,
} = require('./conversation/qaCommands');
const {
  evaluateRouteWithOpenAI,
  shouldSkipOpenAIRouteEvaluator,
  getAdvisorFailureFallbackReply,
} = require('./conversation/routeEvaluator');
const {
  processConversationTurnV2,
  shouldUseConversationEngineV2,
} = require('./conversation/conversationEngineV2');
const { appendNameRequestIfNeeded, hasValidHumanName } = require('./conversation/namePrompt');
const {
  hasRealEstateAdvisorTurnContext,
  mapConversationDbRowsToChatMessages,
  getLastOutboundTextFromDbRows,
  isCandidateTooSimilarToLastOutbound,
  generateAdvisorReplyForRealEstateTurn,
  buildSyntheticStateForAdvisor,
  mergeReplyToString,
  shouldUseAdvisorForRealEstateTurn,
} = require('./conversation/realEstateAdvisorReply');

const app = express();
app.use(express.json({ limit: '10mb' }));

console.log('ENV CHECK:', {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI: !!process.env.OPENAI_API_KEY,
  WHATSAPP: !!process.env.WHATSAPP_TOKEN,
  PHONE_ID: !!process.env.PHONE_NUMBER_ID,
});

const conversations = new Map();
const inboundBurstQueues = new Map();
const conversationProcessingChains = new Map();

function runWithConversationLock(lockKey, task) {
  const previousChain = conversationProcessingChains.get(lockKey) || Promise.resolve();

  const nextChain = previousChain
    .catch(() => null)
    .then(() => task());

  conversationProcessingChains.set(lockKey, nextChain);

  return nextChain.finally(() => {
    if (conversationProcessingChains.get(lockKey) === nextChain) {
      conversationProcessingChains.delete(lockKey);
    }
  });
}

function enqueueInboundBurst({ lockKey, item, processor, windowMs = DEFAULT_BURST_WINDOW_MS }) {
  return new Promise((resolve, reject) => {
    const key = cleanSpaces(lockKey || '');
    if (!key) {
      reject(new Error('missing_burst_lock_key'));
      return;
    }

    let queue = inboundBurstQueues.get(key);
    if (!queue) {
      queue = {
        items: [],
        resolvers: [],
        rejecters: [],
        timer: null,
      };
      inboundBurstQueues.set(key, queue);

      queue.timer = setTimeout(async () => {
        const drainingQueue = inboundBurstQueues.get(key);
        inboundBurstQueues.delete(key);
        if (!drainingQueue) return;

        try {
          await runWithConversationLock(key, async () => {
            await processor(drainingQueue.items);
          });
          drainingQueue.resolvers.forEach((done) => done(true));
        } catch (error) {
          drainingQueue.rejecters.forEach((fail) => fail(error));
        }
      }, Math.max(2000, Number(windowMs) || DEFAULT_BURST_WINDOW_MS));
    }

    queue.items.push(item);
    queue.resolvers.push(resolve);
    queue.rejecters.push(reject);
  });
}

const locationCatalog = {
  loadedAt: 0,
  rawNames: [],
  normalizedMap: new Map(),
};

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

function isNonRealEstateCategory(state = {}) {
  return (
    !!state.external_broker ||
    !!state.provider ||
    !!state.spam_detected ||
    !!state.wrong_context ||
    !!state.unclear_non_real_estate ||
    !!state.non_real_estate_or_provider
  );
}

function buildNonRealEstateCategoryReply(state = {}) {
  if (state.spam_detected) {
    return 'Gracias por tu mensaje. Este canal atiende únicamente solicitudes inmobiliarias de compra, venta, renta y valuación.';
  }

  if (state.external_broker) {
    return 'Gracias por escribir. Este canal está enfocado en atención directa a clientes de Luxetty. Si gustas, puedo canalizarte con el área comercial interna.';
  }

  if (state.provider) {
    return 'Gracias por contactarnos. Este chat está enfocado en clientes inmobiliarios; para temas de proveedores te canalizamos por el medio interno correspondiente.';
  }

  if (state.wrong_context || state.unclear_non_real_estate) {
    return 'Gracias por escribir. Para ayudarte bien, este canal atiende compra, venta, renta y valuación de propiedades.';
  }

  return 'Gracias por tu mensaje. Este canal atiende únicamente solicitudes inmobiliarias de compra, venta, renta y valuación.';
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
    // Bloquear creación de leads durante sesión de prueba QA
    if (isQaLeadBlocked(nextAiState)) {
      await saveConversationEvent(conversationId, 'lead_creation_skipped_qa_session', {
        qa_test_session_id: nextAiState.qa_test_session_id || null,
        qa_test_case_name: nextAiState.qa_test_case_name || null,
      });
      return { success: false, reason: 'qa_session_active' };
    }

    if (isNonRealEstateCategory(nextAiState)) {
      await saveConversationEvent(conversationId, 'lead_creation_skipped_non_real_estate_category', {
        inbound_business_category: nextAiState.inbound_business_category || null,
        external_broker: !!nextAiState.external_broker,
        provider: !!nextAiState.provider,
        spam_detected: !!nextAiState.spam_detected,
        wrong_context: !!nextAiState.wrong_context,
        unclear_non_real_estate: !!nextAiState.unclear_non_real_estate,
      });

      return {
        success: false,
        reason: 'non_real_estate_category',
      };
    }

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
        campaign_type: campaignExtraction.campaignContext?.campaign_type || null,
        campaign_property_code: campaignExtraction.campaignContext?.property_code || null,
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
      campaign_type: leadContext.campaignContext?.campaign_type || null,
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

async function saveConversationMessage(params) {
  return messagePersistence.saveConversationMessage(supabase, params);
}

async function inboundMessageAlreadyProcessed(metaMessageId) {
  return messagePersistence.inboundMessageAlreadyProcessed(supabase, metaMessageId);
}

async function applyNamePromptToReply(reply, {
  conversationId,
  contact,
  aiState,
  waProfileDisplayName,
  userText,
}) {
  if (reply == null) return reply;
  if (Array.isArray(reply) && reply.length === 0) return reply;
  if (typeof reply === 'string' && !cleanSpaces(reply)) return reply;

  const recent = conversationId ? await fetchRecentConversationMessages(conversationId, 16) : [];
  const recentOutboundTexts = recent
    .filter((m) => m.direction === 'outbound')
    .map((m) => m.message_text || '')
    .filter(Boolean)
    .slice(-4);

  const { messages, statePatch, setAwaitingFullName } = appendNameRequestIfNeeded(reply, {
    contact,
    aiState,
    waProfileDisplayName,
    recentOutboundTexts,
    userInboundText: userText || '',
    leadFlow: aiState?.lead_flow || null,
    wantsVisit: !!aiState?.wants_visit,
  });

  Object.assign(aiState, statePatch);
  if (setAwaitingFullName && (!aiState.awaiting_field || aiState.awaiting_field === 'full_name')) {
    aiState.awaiting_field = 'full_name';
  }
  if (statePatch.pending_name_capture) {
    aiState.pending_name_capture = true;
  }

  return messages;
}

async function fetchRecentConversationMessages(conversationId, limit = 20) {
  try {
    if (!conversationId) return [];
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));

    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, direction, sender_type, message_type, message_text, meta_message_id, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      console.warn('fetchRecentConversationMessages warning:', error?.message || error);
      return [];
    }

    return Array.isArray(data) ? [...data].reverse() : [];
  } catch (error) {
    console.warn('FATAL fetchRecentConversationMessages:', error?.message || error);
    return [];
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

const PROPERTY_ROW_SELECT = `
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
      `;

async function getPropertiesByIds(rawIds = []) {
  try {
    const cleanIds = [...new Set((Array.isArray(rawIds) ? rawIds : []).filter(Boolean))].slice(0, 12);
    if (!cleanIds.length) return [];

    const { data, error } = await supabase
      .from('properties')
      .select(PROPERTY_ROW_SELECT)
      .in('id', cleanIds)
      .is('archived_at', null)
      .eq('visible_on_website', true)
      .in('status', ['active', 'sold', 'rented']);

    if (error) {
      console.error('Error buscando propiedades por id:', error);
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    const byId = new Map(rows.map((p) => [p.id, p]));
    return cleanIds.map((id) => byId.get(id)).filter(Boolean);
  } catch (err) {
    console.error('FATAL getPropertiesByIds:', err);
    return [];
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
    const phoneLookupValues = buildPhoneLookupValues(normalizedPhone);
    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('*')
      .eq('channel', 'whatsapp')
      .in('phone', phoneLookupValues)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(25);

    if (findError) {
      console.error('Error buscando conversación:', findError);
      return { id: null, ai_state: getDefaultAiState() };
    }

    const strategy = selectConversationReuseStrategy(existing || [], normalizedPhone);

    if (strategy.hasMultipleReusableConversations) {
      console.warn('multiple_reusable_conversations_detected', {
        phone: normalizedPhone,
        channel: 'whatsapp',
        selected_conversation_id: strategy.reusableConversation?.id || null,
        duplicate_conversation_ids: strategy.duplicateReusableConversationIds || [],
        reason: strategy.multipleReusableResolutionReason || 'canonical_lead_contact_recency_then_id',
      });
    }

    if (strategy.reusableConversation) {
      if (strategy.shouldNormalizeReusablePhone) {
        await supabase
          .from('conversations')
          .update({ phone: normalizedPhone, updated_at: nowIso() })
          .eq('id', strategy.reusableConversation.id);
        strategy.reusableConversation.phone = normalizedPhone;
      }
      return strategy.reusableConversation;
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
        ...strategy.createSeed,
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

function extractWaProfileDisplayName(value = {}, rawFromPhone = '') {
  if (!value || typeof value !== 'object') return null;
  const normalizedFrom = normalizePhoneNumber(rawFromPhone) || String(rawFromPhone || '').replace(/[\s\-+()]/g, '');
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

async function ensureContactForConversation({
  conversationRow,
  state,
  phone,
  waName = null,
  source = 'whatsapp',
  rawPayload = null,
}) {
  return ensureContactForConversationCore({
    supabase,
    conversationRow,
    state,
    phone,
    waName,
    source,
    rawPayload,
    saveConversationEvent,
    updateConversationMeta,
  });
}

async function upsertContactForConversation(conversationRow, state, phone, extra = {}) {
  return ensureContactForConversation({
    conversationRow,
    state,
    phone,
    waName: extra.waName ?? null,
    rawPayload: extra.rawPayload ?? null,
    source: extra.source || 'whatsapp',
  });
}

function hasLeadRetryPropertyContext(state = {}, property = null) {
  return Boolean(
    property?.id ||
      state?.detected_property_id ||
      state?.interested_property_id ||
      state?.property_code ||
      state?.direct_property_code
  );
}

async function maybeRetryLeadAfterContactLinked({
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
  if (!contactId) {
    console.log('LEAD_RETRY_SKIPPED_NO_CONTACT', {
      conversation_id: conversationId,
      lead_id: conversationRow?.lead_id || null,
    });
    return { success: false, reason: 'retry_skipped_no_contact' };
  }

  if (conversationRow?.lead_id) {
    return { success: false, reason: 'retry_skipped_already_linked' };
  }

  if (nextAiState?.lead_retry_after_contact_linked_attempted_at) {
    return { success: false, reason: 'retry_already_attempted' };
  }

  const hasPropertyContext = hasLeadRetryPropertyContext(nextAiState, property);
  const hasCommercialIntent = nextAiState?.lead_flow === 'demand' || nextAiState?.intent_type === 'property_interest';
  const hasDirectPropertyReference = nextAiState?.direct_property_reference === true;

  if (!hasPropertyContext || !hasCommercialIntent || !hasDirectPropertyReference) {
    console.log('LEAD_RETRY_SKIPPED_NO_PROPERTY_CONTEXT', {
      conversation_id: conversationId,
      has_property_context: hasPropertyContext,
      has_commercial_intent: hasCommercialIntent,
      has_direct_property_reference: hasDirectPropertyReference,
    });
    return { success: false, reason: 'retry_skipped_no_property_context' };
  }

  nextAiState.lead_retry_after_contact_linked_attempted_at = nowIso();
  console.log('LEAD_RETRY_AFTER_CONTACT_LINKED', {
    conversation_id: conversationId,
    contact_id: contactId,
    property_id: property?.id || nextAiState?.detected_property_id || nextAiState?.interested_property_id || null,
    property_code: nextAiState?.property_code || nextAiState?.direct_property_code || null,
  });

  const result = await maybeCreateOrReuseLeadWithEngine({
    conversationId,
    conversationRow,
    nextAiState,
    contactId,
    property,
    messageText,
    referralContext,
    rawPayload,
    unifiedContext,
  });

  if (result?.success) {
    nextAiState.lead_retry_after_contact_linked_result = 'success';
    nextAiState.lead_retry_after_contact_linked_success_at = nowIso();
    console.log('LEAD_RETRY_SUCCESS', {
      conversation_id: conversationId,
      lead_id: result.leadId || null,
      was_created: !!result.wasCreated,
    });
  } else {
    nextAiState.lead_retry_after_contact_linked_result = 'failed';
    nextAiState.lead_retry_after_contact_linked_failed_at = nowIso();
    console.warn('LEAD_RETRY_FAILED', {
      conversation_id: conversationId,
      reason: result?.reason || 'unknown',
      error: result?.error || null,
    });
  }

  return result;
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

    async function processInboundWhatsAppMessage({
      entry,
      change,
      value,
      message,
      webhookBody,
      processingMode = 'respond',
      burstCombinedText = null,
      inboundBatch = [],
      burstSize = 1,
    }) {
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

      const payloadSnapshot = webhookBody && typeof webhookBody === 'object' ? webhookBody : req.body;

      const inboundRawPayload = normalizedReferral
        ? {
            ...(payloadSnapshot || {}),
            perseo_metadata: {
              ...((payloadSnapshot && payloadSnapshot.perseo_metadata) || {}),
              whatsapp_referral: normalizedReferral,
            },
          }
        : payloadSnapshot;

      from = normalizePhoneNumber(rawFrom) || rawFrom;
      const waProfileDisplayName = extractWaProfileDisplayName(value, rawFrom);

      const inboundContext = buildInboundMessageContext(message);
      let text = inboundContext.messageText;
      let transcriptionText = inboundContext.transcriptionText;

      const conversationRow = await getOrCreateConversation(from);
      const conversationId = conversationRow?.id || null;
      const previousAiState = normalizeAiState(conversationRow?.ai_state);
      const linkedEntities = await fetchConversationLinkedEntities(conversationRow);

      const signalText = extractInboundSignalText(message);
      if (signalText) {
        text = cleanSpaces(signalText);
      }

      if (processingMode === 'respond' && cleanSpaces(burstCombinedText || '')) {
        text = cleanSpaces(burstCombinedText);
      }

      if (conversationId && parseQaCommand(text)) {
        await saveConversationMessage({
          conversationId,
          direction: 'inbound',
          senderType: 'lead',
          messageType: mapInboundMessageType(messageType),
          messageText: text,
          transcriptionText,
          metaMessageId,
          rawPayload: inboundRawPayload || {},
        });
      }

      // ─── Guard: Comandos internos QA ──────────────────────────────────────
      // Intercepta ANTES del pipeline conversacional para evitar intent/fallback/CRM/OpenAI.
      const qaIntercept = await interceptQaCommand({
        text,
        from,
        conversationId,
        conversationRow,
        supabase,
        conversations,
        sendReplyFn: sendWhatsAppMessages,
        saveEventFn: saveConversationEvent,
        saveStateFn: saveConversationState,
        getDefaultState: getDefaultAiState,
        nowIso,
        metaMessageId,
        logger: console,
      });

      if (qaIntercept?.handled) {
        return; // No continuar con el pipeline normal
      }

      if (qaIntercept?.isQaCommand && !qaIntercept?.handled) {
        if (conversationId) {
          await saveConversationEvent(conversationId, 'qa_command_denied_user_notified', {
            meta_message_id: metaMessageId || null,
            reason: qaIntercept?.reason || 'qa_command_denied',
          });
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

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
            transcriptionText = audioTranscription.transcription_text;
            text = audioTranscription.transcription_text;
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

      const campaignContextForFusion = extractCampaignReferralContext({
        aiState: previousAiState,
        referral: normalizedReferral,
        rawPayload: inboundRawPayload,
        messageText: text,
      });

      const listingFromCampaignForFusion =
        campaignContextForFusion?.campaignContext?.property_code || null;
      const listingFromPrevDirect =
        previousAiState?.direct_property_reference && previousAiState?.property_code
          ? previousAiState.property_code
          : null;
      const propertyContextFromState = listingFromPrevDirect
        ? { listing_id: listingFromPrevDirect }
        : listingFromCampaignForFusion
        ? { listing_id: listingFromCampaignForFusion }
        : null;

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


      // Preserve intent if continuing with details
      const isContinuation = isDetailContinuation(text, previousAiState);
      if (isContinuation && previousAiState?.lead_flow && unifiedContext.normalizedIntent) {
        unifiedContext.normalizedIntent = mergeIntentWithPreviousState(
          unifiedContext.normalizedIntent,
          previousAiState,
          {}
        );
      }
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
            inbound_batch: {
              processing_mode: processingMode,
              burst_size: burstSize,
              message_ids: Array.isArray(inboundBatch)
                ? inboundBatch.map((item) => item?.meta_message_id).filter(Boolean)
                : [],
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

      if (waProfileDisplayName && !incomingSignals.full_name) {
        if (isUsefulContactName(waProfileDisplayName) && !isInvalidContactName(waProfileDisplayName)) {
          incomingSignals.full_name = waProfileDisplayName;
        } else if (conversationId) {
          await saveConversationEvent(conversationId, 'invalid_contact_name_skipped', {
            source: 'whatsapp_profile_name',
            rejected_value: String(waProfileDisplayName).slice(0, 120),
          });
        }
      }

      const normalizedInboundText = normalizeText(text);
      const campaignPropertyCode = campaignContextForFusion?.campaignContext?.property_code || null;
      const referencesCampaignProperty =
        normalizedInboundText.includes('la propiedad') ||
        normalizedInboundText.includes('precio') ||
        normalizedInboundText.includes('disponibilidad') ||
        normalizedInboundText.includes('disponible') ||
        normalizedInboundText.includes('sigue disponible') ||
        normalizedInboundText.includes('informacion') ||
        normalizedInboundText.includes('información') ||
        normalizedInboundText.includes('info') ||
        normalizedInboundText.includes('fotos') ||
        normalizedInboundText.includes('video') ||
        normalizedInboundText.includes('agendar') ||
        normalizedInboundText.includes('visita') ||
        normalizedInboundText.includes('quiero verla') ||
        normalizedInboundText.includes('me interesa');

      if (!signals.property_code && campaignPropertyCode && referencesCampaignProperty) {
        signals.property_code = campaignPropertyCode;
        signals.direct_property_reference = true;
        signals.lead_flow = 'demand';
        signals.operation_type = signals.operation_type || 'sale';
        await saveConversationEvent(conversationId, 'direct_property_resolved_from_campaign_context', {
          property_code: campaignPropertyCode,
          source: 'campaign_referral',
        });
      }

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

      if (processingMode === 'persist_only') {
        await saveConversationEvent(conversationId, 'inbound_message_buffered', {
          meta_message_id: metaMessageId,
          burst_size: burstSize,
          message_type: messageType || null,
        });
        return;
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

      if (
        processingMode === 'respond' &&
        shouldUseConversationEngineV2({
          text,
          parsedSignals: incomingSignals,
          inboundContext,
        })
      ) {
        try {
          await saveConversationEvent(conversationId, 'engine_v2_started', {
            engine_v2_enabled: true,
          });
          const recentEarly = await fetchRecentConversationMessages(conversationId, 20);
          const v2out = await processConversationTurnV2({
            text,
            normalizedText,
            conversationId,
            phone: from,
            previousAiState,
            conversationRow,
            contact: linkedEntities.existingContact,
            lead: linkedEntities.existingLead,
            recentMessages: recentEarly,
            inboundContext,
            unifiedContext: unifiedContext || null,
            referralContext: normalizedReferral,
            campaignContext: campaignContextForFusion?.campaignContext || null,
            media: inboundContext?.media || {},
            propertiesContext: { matchedProperties: [] },
            parsedSignals: incomingSignals,
            routeEvaluatorDecision: null,
            waProfileDisplayName,
            changeType: detectStateChange(previousAiState, incomingSignals),
            getPropertyByCode,
            searchPropertiesWithFallbacks,
            logger: console,
          });

          let v2State = v2out.nextAiState;
          let replyToSend = v2out.outboundMessages;

          if (unifiedContext?.ok) {
            v2State.context_fusion = {
              ...(typeof v2State.context_fusion === 'object' ? v2State.context_fusion : {}),
              should_create_or_update_lead: !!unifiedContext.shouldCreateOrUpdateLead,
              updated_at: nowIso(),
            };
          }

          const matchedFacts = Array.isArray(v2out.facts?.properties) ? v2out.facts.properties : [];
          const campaignPropertyCodeForLead =
            campaignContextForFusion?.campaignContext?.property_code || null;
          const matchedListingForLead =
            matchedFacts.length > 0 ? matchedFacts[0]?.listing_id || null : null;
          const campaignMatchesTopProperty =
            !!campaignPropertyCodeForLead &&
            !!matchedListingForLead &&
            String(campaignPropertyCodeForLead).toUpperCase().replace(/\s+/g, '') ===
              String(matchedListingForLead).toUpperCase().replace(/\s+/g, '');

          const shouldAttemptLeadAutomation =
            !isGreetingOnly(text) &&
            !isNonRealEstateCategory(v2State) &&
            (v2State.lead_flow === 'demand' ||
              v2State.lead_flow === 'offer' ||
              v2State.direct_property_reference ||
              v2State?.context_fusion?.should_create_or_update_lead ||
              (matchedFacts.length > 0 && campaignMatchesTopProperty));

          let leadAutomationResult = null;
          if (shouldAttemptLeadAutomation) {
            const propertyForLead =
              matchedFacts.length > 0 &&
              (v2State.direct_property_reference || campaignMatchesTopProperty)
                ? matchedFacts[0]
                : null;
            const contactId = await upsertContactForConversation(conversationRow, v2State, from, {
              waName: waProfileDisplayName,
              rawPayload: inboundRawPayload,
            });

            leadAutomationResult = await maybeRetryLeadAfterContactLinked({
              conversationId,
              conversationRow,
              nextAiState: v2State,
              contactId,
              property: propertyForLead,
              messageText: text,
              referralContext: normalizedReferral,
              rawPayload: inboundRawPayload,
              unifiedContext: v2State?.context_fusion || unifiedContext || null,
            });

            const lastOutboundV2 = getLastOutboundTextFromDbRows(recentEarly);
            if (
              leadAutomationResult?.handoffTriggered &&
              !String(lastOutboundV2 || '').includes(
                'Para darte una atención más precisa, puedo canalizar'
              )
            ) {
              replyToSend = buildIntelligentHandoffReply();
              v2State.handoff_ready = true;
              v2State.handoff_sent = true;
              await saveConversationEvent(conversationId, 'intelligent_handoff_message_sent', {
                lead_id: leadAutomationResult.leadId || null,
                assigned_agent_profile_id: leadAutomationResult.assignedAgentProfileId || null,
                source: 'ai_agent',
                engine_v2: true,
              });
            }
          }

          const responseSrc = String(v2out.responseSource || '');
          const fallbackUsed =
            responseSrc.includes('fallback') || responseSrc === 'engine_v2_programmed_safety';

          await saveConversationEvent(conversationId, 'engine_v2_response', {
            engine_v2_used: true,
            engine_v2_enabled: true,
            response_source: v2out.responseSource,
            advisor_called: v2out.advisorCalled,
            orchestrator_called: !!v2out.orchestratorDecision,
            orchestrator_decision: v2out.orchestratorDecision || null,
            reply_strategy: v2out.orchestratorDecision?.reply_strategy || null,
            captured_fields: v2out.orchestratorDecision?.captured_fields || null,
            crm_actions_recommended: v2out.crmActions || null,
            property_actions_recommended: v2out.propertyActions || null,
            early_return_blocked: true,
            fallback_used: fallbackUsed,
            fallback_reason: fallbackUsed ? responseSrc : null,
            lead_automation: leadAutomationResult || null,
          });

          await saveConversationState(conversationId, v2State);

          await saveOutboundMessages({
            conversationId,
            messages: replyToSend,
            rawPayload: { perseo_metadata: { engine_v2: true } },
          });

          const v2MessagesStr =
            normalizeOutboundMessages(replyToSend).join('\n\n') || String(replyToSend);
          conversations.set(
            from,
            [
              ...(conversations.get(from) || []),
              { role: 'user', content: text },
              { role: 'assistant', content: v2MessagesStr },
            ].slice(-MAX_SHORT_MEMORY_MESSAGES)
          );

          await sendWhatsAppMessages(from, replyToSend);
          return;
        } catch (engineErr) {
          console.error('PERSEO_ENGINE_V2_failed', engineErr);
          await saveConversationEvent(conversationId, 'engine_v2_failed', {
            message: String(engineErr?.message || engineErr),
          });
        }
      }

      let routeEvaluatorDecision = null;
      if (!shouldSkipOpenAIRouteEvaluator({ text, messageType, inboundContext })) {
        routeEvaluatorDecision = await evaluateRouteWithOpenAI({
          text,
          previousAiState,
          incomingSignals,
          inboundContext,
          contact: linkedEntities.existingContact || null,
          campaignContext: campaignContextForFusion?.campaignContext || null,
        });
        incomingSignals.route_evaluator_decision = routeEvaluatorDecision;
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

      const prevNorm = previousAiState.property_code
        ? normalizeListingId(previousAiState.property_code)
        : null;
      const skipEarlyProgrammedPropertyReply =
        !!property &&
        !!prevNorm &&
        prevNorm === normalizedDirectCode &&
        !!previousAiState.direct_property_reference &&
        isPropertyConversationFollowUp(text);

      if (!skipEarlyProgrammedPropertyReply) {
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

        let notFoundReply = enrichReplyWithNextStepCta(
          'No encontré esa propiedad disponible en este momento. Si deseas, puedo mostrarte opciones similares. ¿Qué zona te interesa?',
          directState.next_step
        );

        notFoundReply = await applyNamePromptToReply(notFoundReply, {
          conversationId,
          contact: linkedEntities.existingContact,
          aiState: directState,
          waProfileDisplayName: waProfileDisplayName,
          userText: text,
        });

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
      let directReply = Array.isArray(directReplyBase)
        ? directReplyBase.map((message) => sanitizeReply(message)).filter(Boolean)
        : sanitizeReply(enrichReplyWithNextStepCta(directReplyBase, directState.next_step));

      directReply = await applyNamePromptToReply(directReply, {
        conversationId,
        contact: linkedEntities.existingContact,
        aiState: directState,
        waProfileDisplayName: waProfileDisplayName,
        userText: text,
      });

      const directOutbound = await saveOutboundMessages({
        conversationId,
        messages: directReply,
        rawPayload: {},
      });

      if (directOutbound.rows[0]?.id) {
        await savePropertySuggestions(conversationId, directOutbound.rows[0].id, [property]);
      }

      const contactId = await upsertContactForConversation(conversationRow, directState, from, {
        waName: waProfileDisplayName,
        rawPayload: inboundRawPayload,
      });
      const leadAutomationResult = await maybeRetryLeadAfterContactLinked({
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

    if (incomingSignals.route_evaluator_decision) {
      nextAiState.route_evaluator_decision = incomingSignals.route_evaluator_decision;
    }

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
        (previousAiState.awaiting_field === 'bedrooms' && (incomingSignals.bedrooms != null || !!incomingSignals.bedrooms_any)) ||
        (previousAiState.awaiting_field === 'owner_relation' && !!incomingSignals.owner_relation)
      )
    ) {
      nextAiState.awaiting_field = null;
    }

    if (incomingSignals.sell_buy_bridge && nextAiState.awaiting_field === 'owner_relation') {
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

    if (campaignContextForFusion?.campaignContext) {
      nextAiState.campaign_context = campaignContextForFusion.campaignContext;
    } else if (previousAiState?.campaign_context && !nextAiState.campaign_context) {
      nextAiState.campaign_context = previousAiState.campaign_context;
    }

      // ─── Sprint 5B: integration_contract para trazabilidad campaña/propiedad ──
      // Persiste en ai_state para que ATENA pueda leerlo desde el detalle de conversación.
      const _contractReferral = nextAiState.whatsapp_referral || null;
      const _contractCampaign = nextAiState.campaign_context || null;
      const _hasContractContext = !!(_contractReferral || _contractCampaign);

      if (_hasContractContext && !previousAiState.integration_contract) {
        nextAiState.integration_contract = {
          version: 'atena-perseo-5b',
          producer: 'PERSEO',
          wa_id: rawFrom || null,
          phone: rawFrom || null,
          normalized_phone: from || null,
          property_public_code: _contractCampaign?.property_code || null,
          campaign_context: _contractCampaign || null,
          referral_context: _contractReferral || null,
          initial_message: text || null,
          created_at: nowIso(),
        };
        console.log('integration_contract_created', {
          conversation_id: conversationId,
          wa_id: rawFrom || null,
          property_public_code: _contractCampaign?.property_code || null,
          has_campaign: !!_contractCampaign,
          has_referral: !!_contractReferral,
        });
      } else if (previousAiState.integration_contract) {
        // Preservar contrato existente; actualizar si hay datos más ricos
        nextAiState.integration_contract = {
          ...previousAiState.integration_contract,
          property_public_code:
            _contractCampaign?.property_code ||
            previousAiState.integration_contract.property_public_code ||
            null,
          campaign_context:
            _contractCampaign || previousAiState.integration_contract.campaign_context || null,
          referral_context:
            _contractReferral || previousAiState.integration_contract.referral_context || null,
        };
      }
      // ──────────────────────────────────────────────────────────────────────────

    const reliabilityFlags = applyConversationIntentMemory({
      text,
      previousAiState,
      incomingSignals,
      nextAiState,
    });

    if (nextAiState.context_fusion) {
      nextAiState.context_fusion.reliability = {
        ...(nextAiState.context_fusion.reliability || {}),
        has_critical_sale_intent: reliabilityFlags.hasCriticalSaleIntent,
        explicit_rent_switch: reliabilityFlags.explicitRentSwitch,
        complaint_correction: reliabilityFlags.isComplaintCorrection,
      };
    }

    nextAiState.pending_question =
      nextAiState.context_fusion?.pending_question || nextAiState.pending_question || null;

    if (incomingSignals.full_name) {
      if (isUsefulContactName(incomingSignals.full_name) && !isInvalidContactName(incomingSignals.full_name)) {
        nextAiState.full_name = incomingSignals.full_name;
      } else if (conversationId) {
        await saveConversationEvent(conversationId, 'invalid_contact_name_skipped', {
          source: 'incoming_signals_full_name',
          rejected_value: String(incomingSignals.full_name).slice(0, 120),
        });
      }
    }

    // ✅ No volver a pedir datos que ya existen en estado
    if (nextAiState.full_name && nextAiState.awaiting_field === 'full_name') {
      nextAiState.awaiting_field = null;
    }

    if (nextAiState.full_name && nextAiState.pending_name_capture) {
      nextAiState.pending_name_capture = false;
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
      !previousAiState.direct_property_reference &&
      !isNonRealEstateCategory(incomingSignals)
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

    if (
      nextAiState.lead_flow === 'demand' &&
      matchedProperties.length === 0 &&
      Array.isArray(nextAiState.last_shown_property_ids) &&
      nextAiState.last_shown_property_ids.length > 0
    ) {
      matchedProperties = await getPropertiesByIds(nextAiState.last_shown_property_ids);
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

    const recentMessages = await fetchRecentConversationMessages(conversationId, 20);
    const conversationContext = buildConversationContextSnapshot({
      recentMessages,
      inboundBatch,
      aiState: nextAiState,
      campaignContext: campaignContextForFusion?.campaignContext || null,
      propertyContext: unifiedContext?.propertyOffer || unifiedContext?.propertyDemand || null,
      contactContext: linkedEntities.existingContact || null,
      leadContext: linkedEntities.existingLead || null,
    });

    if (nextAiState.context_fusion) {
      nextAiState.context_fusion.conversation_context = conversationContext;
    }

    const closeDecision = evaluateCommercialCloseDecision({
      text,
      state: nextAiState,
      campaignContext: campaignContextForFusion?.campaignContext || null,
      hasPropertyContext: !!(
        nextAiState.direct_property_reference ||
        nextAiState.property_code ||
        nextAiState.direct_property_code ||
        campaignContextForFusion?.campaignContext?.property_code
      ),
    });

    let reply = null;
    const replyRouting = {
      response_source: null,
      response_reason: null,
      used_openai_advisor: false,
      repeated_template_prevented: false,
      repeated_content_prevented: false,
      reused_memory_context: false,
      advisor_shortened_response: false,
      advisor_followup_type: null,
      name_prompt_applied: false,
      advisor_mode_used: null,
      response_goal: null,
    };

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
      reply = 'Gracias, ya tengo ese punto principal de tu audio. Para avanzar sin repetir información, ¿prefieres que te conecte con un asesor o seguimos afinando detalles aquí?';
    } else if (inboundContext?.media?.audio_low_confidence) {
      reply = 'Gracias, recibí tu audio y pude transcribir una parte. Para evitar errores, ¿me confirmas en una frase el dato más importante? Si prefieres, también puedo pedir que un asesor te contacte.';
    } else if (inboundContext?.media?.audio_without_transcription) {
      if (inboundContext?.media?.audio_without_transcription_repeat) {
        nextAiState.wants_human = true;
        nextAiState.handoff_ready = true;
        await saveConversationEvent(conversationId, 'audio_non_transcribable_escalated', {
          source: 'ai_agent',
          repeated_audio_without_transcription: true,
        });
      }
      reply = buildMediaAcknowledgementReply(inboundContext.media, { aiState: nextAiState });
    } else if (isNonRealEstateCategory(incomingSignals)) {
      reply = buildNonRealEstateCategoryReply(incomingSignals);
      nextAiState.lead_flow = null;
      nextAiState.operation_type = null;
      nextAiState.awaiting_field = null;
    } else if (closeDecision.shouldClarify) {
      reply = closeDecision.clarificationQuestion;
    } else if (closeDecision.shouldClose) {
      if (/quiero verla|agendame|agéndame/i.test(normalizedText)) {
        nextAiState.wants_visit = true;
      }
      if (/ese es mi numero|ese es mi número/i.test(normalizedText)) {
        nextAiState.contact_number_confirmed = true;
        nextAiState.confirmed_phone = true;
      }
      if (
        previousAiState.awaiting_field === 'contact_number_confirmed' &&
        /^(si|sí|correcto)$/.test(normalizedText)
      ) {
        nextAiState.contact_number_confirmed = true;
        nextAiState.confirmed_phone = true;
      }

      nextAiState.wants_human = true;
      nextAiState.handoff_ready = true;
      nextAiState.awaiting_field = null;

      await saveConversationEvent(conversationId, 'commercial_close_triggered', {
        reason: closeDecision.reason,
        text,
        source: 'ai_agent',
      });

      await applyCommercialClose({
        conversationId,
        conversationRow,
        closeReason: closeDecision.reason,
        saveConversationEvent,
        updateConversationMeta,
        nowIso,
      });

      const phoneExplicitlyConfirmed =
        nextAiState.contact_number_confirmed === true ||
        nextAiState.confirmed_phone === true ||
        /ese es mi numero|ese es mi número|ese es mi whatsapp/i.test(normalizedText) ||
        /correcto.*whatsapp|whatsapp.*correcto/i.test(normalizedText) ||
        (previousAiState.awaiting_field === 'contact_number_confirmed' &&
          /^(si|sí|correcto)$/.test(normalizedText));

      reply = phoneExplicitlyConfirmed
        ? 'Perfecto, ya tengo confirmado tu WhatsApp. Voy a canalizar tu solicitud con un asesor de Luxetty para que te apoye con la información y próximos pasos.'
        : 'Perfecto. Voy a canalizar tu solicitud con un asesor de Luxetty para que te apoye con la información y próximos pasos.';
    } else if (incomingSignals.complaint_followup) {
      nextAiState.wants_human = true;
      const oneUsefulQuestion = chooseSingleUsefulQuestion(nextAiState);
      const operationPrompt =
        nextAiState.operation_type === 'sale'
          ? 'venta'
          : nextAiState.operation_type === 'rent'
          ? 'renta'
          : 'tu solicitud';
      reply = `Tienes razón, me equivoqué. Retomo correctamente: vamos por ${operationPrompt}. ${oneUsefulQuestion}`;
    } else if (incomingSignals.low_info_campaign_message && !incomingSignals.lead_flow) {
      const campaignContext = extractCampaignReferralContext({
        aiState: nextAiState,
        referral: normalizedReferral,
        rawPayload: inboundRawPayload,
        messageText: text,
      });
      reply = buildLowInfoCampaignReply(
        campaignContext.hasCampaignContext,
        campaignContext.campaignContext
      );
    } else if (isGreetingOnly(text) && !previousAiState.lead_flow && !incomingSignals.property_code) {
      reply =
        'Hola, bienvenido a Luxetty 😊\n¿En qué puedo orientarte hoy? ¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    } else if (nextAiState.handoff_sent && isClosureCheck(text)) {
      reply =
        'Gracias a ti. Si surge algo más, aquí estoy para seguirte orientando con gusto.';
    } else if (nextAiState.direct_property_reference && nextAiState.property_code && matchedProperties.length === 0) {
      reply = `No encontré esa propiedad disponible en este momento. Si deseas, puedo ayudarte a buscar opciones similares. ¿Qué zona te interesa?`;
    } else if (!nextAiState.handoff_sent) {
      const explicitHandoffEarly =
        nextAiState.wants_human ||
        normalizedText.includes('contacte un asesor') ||
        normalizedText.includes('contacte un agente');

      const skipAdvisorForLiteralPropertyPrice =
        nextAiState.lead_flow === 'demand' &&
        nextAiState.direct_property_reference &&
        matchedProperties.length > 0 &&
        isDirectPriceQuestion(text) &&
        !nextAiState.wants_visit &&
        !explicitHandoffEarly &&
        !isPropertyConversationFollowUp(text);

      const mediaCtx = inboundContext?.media || {};
      const advisorRoute = shouldUseAdvisorForRealEstateTurn({
        ai_state: nextAiState,
        signals: incomingSignals,
        contact: linkedEntities.existingContact,
        user_message: text,
        suggested_properties: matchedProperties,
        last_suggested_property: matchedProperties[0] || null,
        campaign_context: campaignContextForFusion?.campaignContext || null,
        media_context: {
          requires_programmed_safety: !!(mediaCtx.attachment_detected_not_processed || mediaCtx.unsupported_media),
          image_analysis_available: !!mediaCtx.image_vision_success,
          audio_transcription_available: !!mediaCtx.audio_has_transcription,
          document_analysis_available: false,
        },
        recent_db_messages: recentMessages,
        conversation_id: conversationId,
        change_type: changeType,
        skip_advisor_for_literal_property_price: skipAdvisorForLiteralPropertyPrice,
        route_evaluator_decision:
          incomingSignals.route_evaluator_decision || nextAiState.route_evaluator_decision || null,
      });

      if (advisorRoute.use) {
        const chatRecent = mapConversationDbRowsToChatMessages(recentMessages);
        const synth = buildSyntheticStateForAdvisor(nextAiState, matchedProperties);
        try {
          const advisory = await generateAdvisorReplyForRealEstateTurn(
            {
              user_message: text,
              recent_messages: chatRecent,
              recent_db_messages_for_card_check: recentMessages,
              current_lead_flow: nextAiState.lead_flow,
              synthetic_state: synth,
              signals: incomingSignals,
              contact: linkedEntities.existingContact,
              campaign_context: campaignContextForFusion?.campaignContext || null,
              media_context: {
                image_analysis_available: !!mediaCtx.image_vision_success,
                audio_transcription_available: !!mediaCtx.audio_has_transcription,
                document_analysis_available: false,
              },
              last_suggested_property: matchedProperties[0] || null,
              suggested_properties: matchedProperties,
              draft_context: advisorRoute.draft,
              budget: nextAiState.budget_max,
              budget_currency: nextAiState.budget_currency,
              zone:
                nextAiState.location_text ||
                (nextAiState.location_any ? 'Zona abierta según preferencias del usuario' : ''),
              operation: nextAiState.operation_type,
              missing_name: !hasValidHumanName(linkedEntities.existingContact, nextAiState),
              next_step: nextAiState.next_step || null,
              follow_up_reason: advisorRoute.reason,
              change_type: changeType || 'follow_up',
              conversation_id: conversationId,
            },
            { model: OPENAI_MODEL }
          );
          reply = advisory.text;
          replyRouting.response_source = advisory.response_source;
          replyRouting.response_reason = advisory.response_reason;
          replyRouting.used_openai_advisor = true;
          replyRouting.advisor_mode_used = advisory.advisor_mode || null;
          replyRouting.response_goal = advisory.response_goal || null;
          replyRouting.reused_memory_context = !!advisory.reused_memory_context;
          replyRouting.advisor_shortened_response = !!advisory.advisor_shortened_response;
          replyRouting.advisor_followup_type = advisory.advisor_followup_type || null;
        } catch (advisorErr) {
          console.error('advisor_openai_failed', advisorErr?.message || advisorErr, {
            conversation_id: conversationId,
            response_reason: advisorRoute.reason,
          });
          console.error('generateAdvisorReplyForRealEstateTurn_error', advisorErr?.message || advisorErr);
          reply = getAdvisorFailureFallbackReply(
            incomingSignals.route_evaluator_decision || nextAiState.route_evaluator_decision
          );
          replyRouting.response_source = 'advisor_fallback_static';
          replyRouting.response_reason = advisorRoute.reason || 'advisor_error';
        }
      }
    }
    if (reply == null && shouldUsePlaybookReply(nextAiState, nextAiState.playbook_step)) {
      const playbookReply = buildPlaybookReply(nextAiState.playbook_step, nextAiState);
      if (playbookReply) {
        const awaitingField = getPlaybookAwaitingField(nextAiState.playbook_step);
        reply = playbookReply;
        replyRouting.response_source = 'programmed_template';
        replyRouting.response_reason = nextAiState.playbook_step || 'playbook';
        if (awaitingField && shouldAskField(nextAiState, awaitingField)) {
          nextAiState.awaiting_field = awaitingField;
        }
      }
    }
    if (reply == null && nextAiState.lead_flow === 'demand') {
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
        const contactId = await upsertContactForConversation(conversationRow, nextAiState, from, {
        waName: waProfileDisplayName,
        rawPayload: inboundRawPayload,
      });
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

          const contactId = await upsertContactForConversation(conversationRow, nextAiState, from, {
        waName: waProfileDisplayName,
        rawPayload: inboundRawPayload,
      });
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
        ? buildMediaAcknowledgementReply(inboundContext?.media, { aiState: nextAiState })
        : null;

      if (mediaReply) {
        reply = mediaReply;
      } else {
        reply = buildOfferReply(nextAiState, changeType, { signals: incomingSignals, text });
        const offerMediaCtx = inboundContext?.media || {};
        const offerAdvisorRoute = shouldUseAdvisorForRealEstateTurn({
          ai_state: nextAiState,
          signals: incomingSignals,
          contact: linkedEntities.existingContact,
          user_message: text,
          suggested_properties: matchedProperties,
          last_suggested_property: matchedProperties[0] || null,
          campaign_context: campaignContextForFusion?.campaignContext || null,
          media_context: {
            requires_programmed_safety: !!(
              offerMediaCtx.attachment_detected_not_processed || offerMediaCtx.unsupported_media
            ),
            image_analysis_available: !!offerMediaCtx.image_vision_success,
            audio_transcription_available: !!offerMediaCtx.audio_has_transcription,
            document_analysis_available: false,
          },
          recent_db_messages: recentMessages,
          conversation_id: conversationId,
          change_type: changeType,
          skip_advisor_for_literal_property_price: false,
          route_evaluator_decision:
            incomingSignals.route_evaluator_decision || nextAiState.route_evaluator_decision || null,
        });
        if (!nextAiState.handoff_sent && offerAdvisorRoute.use) {
          try {
            const chatRecent = mapConversationDbRowsToChatMessages(recentMessages);
            const synth = buildSyntheticStateForAdvisor(nextAiState, matchedProperties);
            const advisory = await generateAdvisorReplyForRealEstateTurn(
              {
                user_message: text,
                recent_messages: chatRecent,
                recent_db_messages_for_card_check: recentMessages,
                current_lead_flow: 'offer',
                synthetic_state: synth,
                signals: incomingSignals,
                contact: linkedEntities.existingContact,
                campaign_context: campaignContextForFusion?.campaignContext || null,
                media_context: {
                  image_analysis_available: !!offerMediaCtx.image_vision_success,
                  audio_transcription_available: !!offerMediaCtx.audio_has_transcription,
                  document_analysis_available: false,
                },
                last_suggested_property: matchedProperties[0] || null,
                suggested_properties: matchedProperties,
                draft_context: offerAdvisorRoute.draft,
                budget: nextAiState.budget_max,
                budget_currency: nextAiState.budget_currency,
                zone: nextAiState.location_text || '',
                operation: nextAiState.operation_type,
                missing_name: !hasValidHumanName(linkedEntities.existingContact, nextAiState),
                next_step: nextAiState.next_step || null,
                follow_up_reason: offerAdvisorRoute.reason,
                change_type: changeType || 'follow_up',
                conversation_id: conversationId,
              },
              { model: OPENAI_MODEL }
            );
            reply = advisory.text;
            replyRouting.response_source = advisory.response_source;
            replyRouting.response_reason = advisory.response_reason;
            replyRouting.used_openai_advisor = true;
            replyRouting.advisor_mode_used = advisory.advisor_mode || null;
            replyRouting.response_goal = advisory.response_goal || null;
            replyRouting.reused_memory_context = !!advisory.reused_memory_context;
            replyRouting.advisor_shortened_response = !!advisory.advisor_shortened_response;
            replyRouting.advisor_followup_type = advisory.advisor_followup_type || null;
          } catch (offerAdvisorErr) {
            console.error('advisor_openai_failed', offerAdvisorErr?.message || offerAdvisorErr, {
              conversation_id: conversationId,
              branch: 'offer',
            });
            console.error('offer_generateAdvisorReply_error', offerAdvisorErr?.message || offerAdvisorErr);
            reply = getAdvisorFailureFallbackReply(
              incomingSignals.route_evaluator_decision || nextAiState.route_evaluator_decision
            );
          }
        }
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
        const contactId = await upsertContactForConversation(conversationRow, nextAiState, from, {
        waName: waProfileDisplayName,
        rawPayload: inboundRawPayload,
      });

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
        ? buildMediaAcknowledgementReply(inboundContext?.media, { aiState: nextAiState })
        : null;

      if (mediaReply) {
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
    }

    const getReplyText = (value) => (Array.isArray(value) ? value.join('\n\n') : value);

    reply = sanitizeReply(getReplyText(reply));

    const saleOwnerLocked =
      nextAiState.lead_flow === 'offer' &&
      nextAiState.operation_type === 'sale' &&
      nextAiState.intent_lock_sale_owner === true;

    if (
      saleOwnerLocked &&
      /venderla o rentarla|comprar o rentar|poner en renta|si era por renta/i.test(reply)
    ) {
      reply = `Perfecto, seguimos con venta. ${chooseSingleUsefulQuestion(nextAiState)}`;
    }

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

    const replyAsString = mergeReplyToString(reply);
    const replyNormForComplaint = normalizeText(replyAsString);
    if (
      incomingSignals.complaint_followup &&
      (normalizeText(text).includes('ya te lo') ||
        normalizeText(text).includes('ya te respond') ||
        normalizeText(text).includes('ya conteste') ||
        normalizeText(text).includes('ya contesté')) &&
      (replyNormForComplaint.includes('compartes tu nombre') ||
        replyNormForComplaint.includes('cómo te llamas') ||
        replyNormForComplaint.includes('como te llamas'))
    ) {
      reply = 'Tienes razón, gracias. Lo tomo en cuenta para continuar.';
      nextAiState.pending_name_capture = false;
      if (nextAiState.awaiting_field === 'full_name') {
        nextAiState.awaiting_field = null;
      }
    }

    // 🔒 Anti-loop: misma respuesta exacta → priorizar advisor; sin template genérico "Entendido..."
    const lastMessages = conversations.get(from) || [];
    const lastAssistantMessage = [...lastMessages].reverse().find((m) => m.role === 'assistant');
    const shouldPreserveContextualReply =
      !!incomingSignals.complaint_followup ||
      !!inboundContext?.media?.audio_without_transcription ||
      !!inboundContext?.media?.media_download_error ||
      !!inboundContext?.media?.audio_low_confidence ||
      !!inboundContext?.media?.audio_transcription_duplicate;

    if (
      lastAssistantMessage &&
      lastAssistantMessage.content === replyAsString &&
      !shouldPreserveContextualReply
    ) {
      const hasReContext =
        nextAiState.lead_flow === 'demand' ||
        nextAiState.lead_flow === 'offer' ||
        nextAiState.direct_property_reference ||
        (matchedProperties && matchedProperties.length > 0) ||
        !!nextAiState.property_code;

      let antiLoopHandled = false;
      if (hasReContext && !nextAiState.handoff_sent) {
        const mediaCtxLoop = inboundContext?.media || {};
        try {
          const dedupeRoute = shouldUseAdvisorForRealEstateTurn({
            ai_state: nextAiState,
            signals: incomingSignals,
            contact: linkedEntities.existingContact,
            user_message: text,
            suggested_properties: matchedProperties,
            last_suggested_property: matchedProperties[0] || null,
            campaign_context: campaignContextForFusion?.campaignContext || null,
            media_context: {
              requires_programmed_safety: !!(
                mediaCtxLoop.attachment_detected_not_processed || mediaCtxLoop.unsupported_media
              ),
              image_analysis_available: !!mediaCtxLoop.image_vision_success,
              audio_transcription_available: !!mediaCtxLoop.audio_has_transcription,
              document_analysis_available: false,
            },
            recent_db_messages: recentMessages,
            conversation_id: conversationId,
            change_type: changeType,
            skip_advisor_for_literal_property_price: false,
            route_evaluator_decision:
              incomingSignals.route_evaluator_decision || nextAiState.route_evaluator_decision || null,
          });
          if (dedupeRoute.use) {
            const chatRecentLoop = mapConversationDbRowsToChatMessages(recentMessages);
            const synthLoop = buildSyntheticStateForAdvisor(nextAiState, matchedProperties);
            const advisoryLoop = await generateAdvisorReplyForRealEstateTurn(
              {
                user_message: text,
                recent_messages: chatRecentLoop,
                recent_db_messages_for_card_check: recentMessages,
                current_lead_flow: nextAiState.lead_flow,
                synthetic_state: synthLoop,
                signals: incomingSignals,
                contact: linkedEntities.existingContact,
                campaign_context: campaignContextForFusion?.campaignContext || null,
                media_context: {
                  image_analysis_available: !!mediaCtxLoop.image_vision_success,
                  audio_transcription_available: !!mediaCtxLoop.audio_has_transcription,
                  document_analysis_available: false,
                },
                last_suggested_property: matchedProperties[0] || null,
                suggested_properties: matchedProperties,
                draft_context: dedupeRoute.draft,
                budget: nextAiState.budget_max,
                budget_currency: nextAiState.budget_currency,
                zone:
                  nextAiState.location_text ||
                  (nextAiState.location_any ? 'Zona abierta según preferencias del usuario' : ''),
                operation: nextAiState.operation_type,
                missing_name: !hasValidHumanName(linkedEntities.existingContact, nextAiState),
                next_step: nextAiState.next_step || null,
                follow_up_reason: dedupeRoute.reason,
                change_type: changeType || 'anti_loop_exact_repeat',
                conversation_id: conversationId,
                anti_repeat: true,
              },
              { model: OPENAI_MODEL }
            );
            reply = advisoryLoop.text;
            replyRouting.used_openai_advisor = true;
            replyRouting.response_source = advisoryLoop.response_source || 'openai_advisor';
            replyRouting.response_reason = 'anti_loop_exact_repeat';
            antiLoopHandled = true;
          }
        } catch (antiLoopErr) {
          console.error('anti_loop_exact_repeat_advisor_error', antiLoopErr?.message || antiLoopErr);
        }
      }

      if (!antiLoopHandled && lastAssistantMessage.content === mergeReplyToString(reply)) {
        reply = 'Te sigo. Para orientarte mejor, dime si buscas comprar, vender o rentar.';
        replyRouting.response_source = 'anti_loop_contextual_fallback';
        replyRouting.response_reason = 'exact_repeat_short_fallback';
      }
    }

    const updatedMessages = [
      ...(conversations.get(from) || []),
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ];

    conversations.set(from, updatedMessages.slice(-MAX_SHORT_MEMORY_MESSAGES));

    const campaignPropertyCodeForLead =
      campaignContextForFusion?.campaignContext?.property_code || null;
    const matchedListingForLead =
      matchedProperties.length > 0 ? matchedProperties[0]?.listing_id || null : null;
    const campaignMatchesTopProperty =
      !!campaignPropertyCodeForLead &&
      !!matchedListingForLead &&
      String(campaignPropertyCodeForLead).toUpperCase().replace(/\s+/g, '') ===
        String(matchedListingForLead).toUpperCase().replace(/\s+/g, '');

    const shouldAttemptLeadAutomation =
      !isGreetingOnly(text) &&
      !isNonRealEstateCategory(nextAiState) &&
      (
        nextAiState.lead_flow === 'demand' ||
        nextAiState.lead_flow === 'offer' ||
        nextAiState.direct_property_reference ||
        nextAiState?.context_fusion?.should_create_or_update_lead ||
        (matchedProperties.length > 0 && campaignMatchesTopProperty)
      );

    if (shouldAttemptLeadAutomation) {
      const propertyForLead =
        matchedProperties.length > 0 &&
        (nextAiState.direct_property_reference || campaignMatchesTopProperty)
          ? matchedProperties[0]
          : null;
      const contactId = await upsertContactForConversation(conversationRow, nextAiState, from, {
        waName: waProfileDisplayName,
        rawPayload: inboundRawPayload,
      });

      const leadAutomationResult = await maybeRetryLeadAfterContactLinked({
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

    if (reply != null && !nextAiState.handoff_sent) {
      const lastOut = getLastOutboundTextFromDbRows(recentMessages);
      if (
        lastOut &&
        isCandidateTooSimilarToLastOutbound(reply, lastOut) &&
        hasRealEstateAdvisorTurnContext(nextAiState, matchedProperties)
      ) {
        try {
          const chatRecent = mapConversationDbRowsToChatMessages(recentMessages);
          const synth = buildSyntheticStateForAdvisor(nextAiState, matchedProperties);
          const advisory = await generateAdvisorReplyForRealEstateTurn(
            {
              user_message: text,
              recent_messages: chatRecent,
              recent_db_messages_for_card_check: recentMessages,
              current_lead_flow: nextAiState.lead_flow,
              synthetic_state: synth,
              signals: incomingSignals,
              contact: linkedEntities.existingContact,
              campaign_context: campaignContextForFusion?.campaignContext || null,
              media_context: {
                image_analysis_available: !!inboundContext?.media?.image_vision_success,
                audio_transcription_available: !!inboundContext?.media?.audio_has_transcription,
                document_analysis_available: false,
              },
              last_suggested_property: matchedProperties[0] || null,
              suggested_properties: matchedProperties,
              budget: nextAiState.budget_max,
              budget_currency: nextAiState.budget_currency,
              zone:
                nextAiState.location_text ||
                (nextAiState.location_any ? 'Zona abierta según preferencias del usuario' : ''),
              operation: nextAiState.operation_type,
              missing_name: !hasValidHumanName(linkedEntities.existingContact, nextAiState),
              next_step: nextAiState.next_step || null,
              anti_repeat: true,
              follow_up_reason: 'anti_repeat_template',
              change_type: 'repeat_guard',
            },
            { model: OPENAI_MODEL }
          );
          reply = advisory.text;
          replyRouting.repeated_template_prevented = true;
          replyRouting.repeated_content_prevented = true;
          replyRouting.used_openai_advisor = true;
          replyRouting.response_source = 'openai_advisor_anti_repeat';
          replyRouting.response_reason = 'anti_repeat_template';
          replyRouting.reused_memory_context = !!advisory.reused_memory_context;
          replyRouting.advisor_shortened_response = !!advisory.advisor_shortened_response;
          replyRouting.advisor_followup_type = advisory.advisor_followup_type || null;
        } catch (guardErr) {
          console.error('anti_repeat_advisor_error', guardErr?.message || guardErr);
          reply =
            'Listo, lo veo. Para avanzar sin repetirnos: dime si lo que buscas ahora es validar la última opción (publicación o disponibilidad) o si quieres que afinemos más alternativas en tu zona y presupuesto.';
          replyRouting.repeated_template_prevented = true;
          replyRouting.repeated_content_prevented = true;
          replyRouting.response_source = 'anti_repeat_static_fallback';
          replyRouting.response_reason = 'anti_repeat_template';
        }
      }
    }

    const replyBeforeNamePrompt = reply;

    reply = await applyNamePromptToReply(reply, {
      conversationId,
      contact: linkedEntities.existingContact,
      aiState: nextAiState,
      waProfileDisplayName: waProfileDisplayName,
      userText: text,
    });

    const outboundOwnershipHint = normalizeText(mergeReplyToString(reply));
    if (
      nextAiState.lead_flow === 'offer' &&
      !nextAiState.owner_relation &&
      (outboundOwnershipHint.includes('propiedad es tuya') ||
        outboundOwnershipHint.includes('apoyando a alguien'))
    ) {
      if (
        !['contact_preference', 'contact_number_confirmed', 'contact_number'].includes(
          nextAiState.awaiting_field
        )
      ) {
        nextAiState.awaiting_field = 'owner_relation';
      }
    }

    replyRouting.name_prompt_applied =
      normalizeText(mergeReplyToString(reply)) !== normalizeText(mergeReplyToString(replyBeforeNamePrompt));
    if (!replyRouting.response_source) {
      replyRouting.response_source = 'pipeline_rule';
    }
    console.log(
      'AI_REPLY_ROUTING',
      JSON.stringify({
        conversation_id: conversationId,
        ...replyRouting,
      })
    );

    const replyForMemory = Array.isArray(reply) ? reply.join('\n\n') : String(reply || '');
    const memAfterName = conversations.get(from) || [];
    if (memAfterName.length && memAfterName[memAfterName.length - 1]?.role === 'assistant') {
      memAfterName[memAfterName.length - 1].content = replyForMemory;
      conversations.set(from, memAfterName.slice(-MAX_SHORT_MEMORY_MESSAGES));
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

    async function processInboundWhatsAppBatch(batchItems = []) {
      const consolidated = consolidateInboundBurst(batchItems);
      if (!Array.isArray(consolidated.items) || consolidated.items.length === 0) return;

      const lastIndex = consolidated.items.length - 1;

      for (let i = 0; i < consolidated.items.length; i += 1) {
        const item = consolidated.items[i];
        const shouldRespond = i === lastIndex;

        await processInboundWhatsAppMessage({
          ...item,
          processingMode: shouldRespond ? 'respond' : 'persist_only',
          burstCombinedText: shouldRespond ? consolidated.combinedText : null,
          inboundBatch: consolidated.inboundBatch,
          burstSize: consolidated.items.length,
        });
      }
    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const burstPromises = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const change of changes) {
        const value = change?.value || {};
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        for (const message of messages) {
          try {
            const rawFrom = typeof message?.from === 'string' ? message.from : '';
            const normalizedFrom = normalizePhoneNumber(rawFrom) || rawFrom;

            if (!normalizedFrom) {
              await processInboundWhatsAppMessage({
                entry,
                change,
                value,
                message,
                webhookBody: req.body,
              });
              continue;
            }

            burstPromises.push(
              enqueueInboundBurst({
                lockKey: normalizedFrom,
                item: {
                  entry,
                  change,
                  value,
                  message,
                  webhookBody: req.body,
                },
                processor: processInboundWhatsAppBatch,
              })
            );
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

    if (burstPromises.length > 0) {
      await Promise.allSettled(burstPromises);
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
