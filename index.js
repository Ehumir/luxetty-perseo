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

const { SYSTEM_PROMPT } = require('./config/prompts');

const { supabase } = require('./services/supabaseService');
const { openai } = require('./services/openaiService');
const { axios } = require('./services/whatsappService');
const { createOrReuseLeadFromConversation } = require('./services/leadAutomation');
const { runInactivityFollowups } = require('./services/followupAutomation');

const { getDefaultAiState, normalizeAiState } = require('./conversation/aiState');
const { parseMessageSignals } = require('./conversation/parsers');
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
  buildDemandReply,
  buildOfferReply,
  buildFallbackOpenAIReply,
  buildFinalHandoffReply,
  buildPropertyPriceReply,
} = require('./conversation/responseBuilder');

const { normalizeText, cleanSpaces } = require('./utils/text');
const { uniq, nowIso, sanitizeReply, safeJsonStringify, normalizePhoneNumber } = require('./utils/helpers');
const { isGreetingOnly } = require('./utils/messageChecks');

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
    return '¿Prefieres que te muestre opciones o avanzar con un asesor?';
  }

  if (nextStep === 'push_visit') {
    return '¿Quieres que coordinemos una visita o prefieres hablar con un asesor?';
  }

  if (nextStep === 'qualify_property') {
    return '¿Me compartes los datos de la propiedad para revisarla contigo?';
  }

  return '¿Quieres que te ayude a buscar, vender o conectar con un asesor?';
}

function hasConversationAdvance(reply) {
  const text = normalizeText(reply);
  if (!text) return false;
  if (/[?¿]\s*$/.test(String(reply).trim())) return true;

  return (
    text.includes('te contactara') ||
    text.includes('te contactará') ||
    text.includes('te conecto') ||
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

function buildIntelligentHandoffReply() {
  return 'Esto ya vale la pena verlo con un asesor. Te voy a conectar con alguien de nuestro equipo para avanzar contigo.';
}

function hasValidPropertySlug(property) {
  const slug = typeof property?.slug === 'string' ? property.slug.trim() : '';
  return !!slug && !/\s/.test(slug);
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
}) {
  try {
    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: conversationRow,
      aiState: nextAiState,
      contactId,
      propertyId: property?.id || null,
      property,
      logger: console,
    });

    if (result?.success && result.aiState) {
      Object.assign(nextAiState, result.aiState);
    }

    return result;
  } catch (err) {
    console.warn('Lead automation failed:', err?.message || err);
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

async function upsertContactForConversation(conversationRow, state, phone) {
  try {
    if (!conversationRow?.id || !phone) return null;

    const normalizedPhone = normalizePhoneNumber(phone) || phone;
    const contactName = state.full_name || null;

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
      if (contactName && !existingContact.full_name) payload.full_name = contactName;
      if (!existingContact.phone) payload.phone = normalizedPhone;
      if (!existingContact.whatsapp) payload.whatsapp = normalizedPhone;

      if (Object.keys(payload).length > 0) {
        await supabase.from('contacts').update(payload).eq('id', existingContact.id);
      }

      if (!conversationRow.contact_id) {
        await updateConversationMeta(conversationRow.id, {
          contact_id: existingContact.id,
        });
      }

      return existingContact.id;
    }

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        full_name: contactName,
        phone: normalizedPhone,
        whatsapp: normalizedPhone,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return null;
    }

    await updateConversationMeta(conversationRow.id, {
      contact_id: created.id,
    });

    return created.id;
  } catch (err) {
    console.error('FATAL upsertContactForConversation:', err);
    return null;
  }
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
  let from = null;

  try {
    await refreshLocationCatalog();

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return res.sendStatus(200);

    const rawFrom = message.from;
    from = normalizePhoneNumber(rawFrom) || rawFrom;
    const messageType = message.type;
    const metaMessageId = message.id || null;

    let text = '';

    if (messageType === 'text') {
      text = cleanSpaces(message.text?.body || '');
    } else if (messageType === 'audio') {
      text = 'El usuario envió un audio.';
    } else if (messageType === 'image') {
      text = 'El usuario envió una imagen.';
    } else {
      text = `El usuario envió un mensaje tipo ${messageType}.`;
    }

    console.log('--- NUEVO MENSAJE ---');
    console.log('From:', from);
    console.log('Tipo:', messageType);
    console.log('Texto:', text);

    const conversationRow = await getOrCreateConversation(from);
    const conversationId = conversationRow?.id || null;
    const normalizedText = normalizeText(text);

    if (rawFrom && from && rawFrom !== from) {
      await saveConversationEvent(conversationId, 'contact_phone_normalized', {
        raw_phone: rawFrom,
        normalized_phone: from,
      });
    }

    await saveConversationMessage({
      conversationId,
      direction: 'inbound',
      senderType: 'lead',
      messageType:
        messageType === 'text'
          ? 'text'
          : messageType === 'audio'
          ? 'audio'
          : messageType === 'image'
          ? 'image'
          : 'system',
      messageText: text,
      metaMessageId,
      rawPayload: req.body,
    });

    const previousAiState = normalizeAiState(conversationRow?.ai_state);
    const incomingSignals = parseMessageSignals(text, previousAiState);
    const signals = incomingSignals;

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
          'No encontré esa propiedad disponible en este momento. Si quieres, te muestro opciones similares. ¿Qué zona te interesa?',
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

        await saveConversationMessage({
          conversationId,
          direction: 'outbound',
          senderType: 'ai_agent',
          messageType: 'text',
          messageText: notFoundReply,
          rawPayload: {},
        });

        await sendWhatsAppText(from, notFoundReply);
        return res.sendStatus(200);
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

      let directReply = sanitizeReply(
        enrichReplyWithNextStepCta(
          buildDemandReply(directState, null, [property], 'direct_property_code'),
          directState.next_step
        )
      );

      const outboundMessageRow = await saveConversationMessage({
        conversationId,
        direction: 'outbound',
        senderType: 'ai_agent',
        messageType: 'text',
        messageText: directReply,
        rawPayload: {},
      });

      if (outboundMessageRow?.id) {
        await savePropertySuggestions(conversationId, outboundMessageRow.id, [property]);
      }

      const contactId = await upsertContactForConversation(conversationRow, directState, from);
      if (contactId) {
        const leadAutomationResult = await maybeCreateOrReuseLeadWithEngine({
          conversationId,
          conversationRow,
          nextAiState: directState,
          contactId,
          property,
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
      }

      await saveConversationState(conversationId, directState);
      await maybeGenerateAiSummary(conversationId, directState, [property]);

      conversations.set(
        from,
        [
          ...(conversations.get(from) || []),
          { role: 'user', content: text },
          { role: 'assistant', content: directReply },
        ].slice(-MAX_SHORT_MEMORY_MESSAGES)
      );

      await sendWhatsAppText(from, directReply);
      return res.sendStatus(200);
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
    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);

    let reply = null;

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

    if (isGreetingOnly(text) && !previousAiState.lead_flow && !incomingSignals.property_code) {
      reply =
        'Hola, soy el asistente de Luxetty 😊\nCon gusto te ayudo.\n¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    } else if (nextAiState.handoff_sent && isClosureCheck(text)) {
      // 🚫 No responder para evitar duplicar cierre
      return res.sendStatus(200);
    } else if (nextAiState.direct_property_reference && nextAiState.property_code && matchedProperties.length === 0) {
      reply = `No encontré esa propiedad disponible en este momento. Si quieres, te ayudo a buscar opciones similares. ¿Qué zona te interesa?`;
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
          ? 'Claro. Para ayudarte a coordinar una visita, ¿me compartes tu nombre completo?'
          : 'Claro. Antes de pasarte con un asesor, ¿me compartes tu nombre completo?';
        nextAiState.awaiting_field = 'full_name';
      } else if (
        !shouldAnswerDirectPrice &&
        (explicitHandoffIntent || commercialHandoffIntent || isHotDemandLead) &&
        nextAiState.full_name &&
        shouldAskField(nextAiState, 'contact_preference')
      ) {
        reply = 'Perfecto. ¿Prefieres que te contacten por WhatsApp o por llamada?';
        nextAiState.awaiting_field = 'contact_preference';
      } else if (
        !shouldAnswerDirectPrice &&
        (explicitHandoffIntent || commercialHandoffIntent || isHotDemandLead) &&
        nextAiState.full_name &&
        nextAiState.contact_preference &&
        shouldAskField(nextAiState, 'contact_number_confirmed')
      ) {
        reply = 'Perfecto. ¿Este es el mejor número para contactarte?';
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
                ? 'Claro. Para ayudarte a coordinar una visita, ¿me compartes tu nombre completo?'
                : 'Claro. Antes de pasarte con un asesor, ¿me compartes tu nombre completo?';
            }
          }
        }
      }
    } else if (nextAiState.lead_flow === 'offer') {
      reply = buildOfferReply(nextAiState, changeType);

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
      const prevMessages = conversations.get(from) || [];

      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
        'Con gusto te ayudo. ¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    }

    if (!reply) {
      reply = await buildFallbackOpenAIReply(text, nextAiState, changeType);
    }

    reply = sanitizeReply(reply);

    // ✅ Anti-loop semántico: evitar preguntas ya resueltas
    if (
      reply &&
      nextAiState.full_name &&
      /nombre completo/i.test(reply) &&
      shouldAskField(nextAiState, 'contact_preference')
    ) {
      reply = 'Perfecto. ¿Prefieres que te contacten por WhatsApp o por llamada?';
      nextAiState.awaiting_field = 'contact_preference';
    }

    if (
      reply &&
      nextAiState.contact_preference &&
      /whatsapp o por llamada/i.test(reply) &&
      shouldAskField(nextAiState, 'contact_number_confirmed')
    ) {
      reply = 'Perfecto. ¿Este es el mejor número para contactarte?';
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
      reply = 'Perfecto, continúo ayudándote. ¿Puedes darme un poco más de detalle para avanzar?';
    }

    const updatedMessages = [
      ...(conversations.get(from) || []),
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ];

    conversations.set(from, updatedMessages.slice(-MAX_SHORT_MEMORY_MESSAGES));

    let outboundMessageRow = await saveConversationMessage({
      conversationId,
      direction: 'outbound',
      senderType: 'ai_agent',
      messageType: 'text',
      messageText: reply,
      rawPayload: {},
    });

    if (matchedProperties.length > 0 && outboundMessageRow?.id) {
      await savePropertySuggestions(
        conversationId,
        outboundMessageRow.id,
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

    if (
      !isGreetingOnly(text) &&
      (nextAiState.lead_flow === 'demand' || nextAiState.lead_flow === 'offer' || nextAiState.direct_property_reference)
    ) {
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
        });

        if (
          leadAutomationResult?.handoffTriggered &&
          !lastAssistantMessage?.content?.includes('Esto ya vale la pena verlo con un asesor')
        ) {
          reply = buildIntelligentHandoffReply();
          nextAiState.handoff_ready = true;
          nextAiState.handoff_sent = true;

          const refreshedMessages = [
            ...(conversations.get(from) || []).slice(0, -1),
            { role: 'assistant', content: reply },
          ];
          conversations.set(from, refreshedMessages.slice(-MAX_SHORT_MEMORY_MESSAGES));

          if (outboundMessageRow?.id) {
            await supabase
              .from('conversation_messages')
              .update({ message_text: reply })
              .eq('id', outboundMessageRow.id);
          }

          await saveConversationEvent(conversationId, 'intelligent_handoff_message_sent', {
            lead_id: leadAutomationResult.leadId || null,
            assigned_agent_profile_id: leadAutomationResult.assignedAgentProfileId || null,
            source: 'ai_agent',
          });
        }
      }
    }

    await saveConversationState(conversationId, nextAiState);
    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);
    await sendWhatsAppText(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error('--- ERROR WEBHOOK ---');
    console.error(error?.response?.data || error?.stack || error?.message || error);

    if (from) {
      try {
        await sendWhatsAppText(
          from,
          'Perdón, tuve un problema momentáneo. ¿Me lo puedes repetir en una sola frase?'
        );
      } catch (sendError) {
        console.error(
          'Error enviando fallback:',
          sendError?.response?.data || sendError?.message || sendError
        );
      }
    }

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
