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

const { getDefaultAiState, normalizeAiState } = require('./conversation/aiState');
const { parseMessageSignals } = require('./conversation/parsers');
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
} = require('./conversation/responseBuilder');

const { normalizeText, cleanSpaces } = require('./utils/text');
const { uniq, nowIso, sanitizeReply, safeJsonStringify } = require('./utils/helpers');
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

  const text = String(rawValue).trim().toUpperCase();

  const full = text.match(/\bLUX[\s\-]?([A-Z])\s?([0-9]{4})\b/i);
  if (full) return `LUX-${full[1]}${full[2]}`;

  const short = text.match(/\b([A-Z])([0-9]{4})\b/i);
  if (short) return `LUX-${short[1]}${short[2]}`;

  return null;
}

async function getPropertyByCode(propertyCode) {
  try {
    const normalizedListingId = normalizeListingId(propertyCode);
    if (!normalizedListingId) return null;

    const { data, error } = await supabase
      .from('properties')
      .select(`
        id,
        listing_id,
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
      .eq('listing_id', normalizedListingId)
      .is('archived_at', null)
      .eq('visible_on_website', true)
      .in('status', ['active', 'sold', 'rented'])
      .limit(1);

    if (error) {
      console.error('Error buscando propiedad por listing_id:', error);
      return null;
    }

    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }

    return null;
  } catch (err) {
    console.error('FATAL getPropertyByCode:', err);
    return null;
  }
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
    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('*')
      .eq('channel', 'whatsapp')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (findError) {
      console.error('Error buscando conversación:', findError);
      return { id: null, ai_state: getDefaultAiState() };
    }

    if (existing && existing.length > 0) {
      return existing[0];
    }

    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({
        channel: 'whatsapp',
        phone,
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
      request_id: data.id,
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

async function upsertContactForConversation(conversationRow, state, phone) {
  try {
    if (!conversationRow?.id || !phone) return null;

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
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(`phone.eq.${phone},whatsapp.eq.${phone}`)
        .limit(1);
      existingContact = data?.[0] || null;
    }

    if (existingContact) {
      const payload = {};
      if (contactName && !existingContact.full_name) payload.full_name = contactName;
      if (!existingContact.phone) payload.phone = phone;
      if (!existingContact.whatsapp) payload.whatsapp = phone;

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
        phone,
        whatsapp: phone,
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

async function getInitialRequestStageId(requestType = 'demand') {
  try {
    const { data, error } = await supabase
      .from('request_stages')
      .select('id, code, stage_order')
      .eq('request_type', requestType)
      .eq('code', 'new')
      .limit(1);

    if (error) {
      console.error('Error getting initial request stage:', error);
      return null;
    }

    return data?.[0]?.id || null;
  } catch (err) {
    console.error('FATAL getInitialRequestStageId:', err);
    return null;
  }
}

async function maybeCreateDemandRequest({
  conversationId,
  conversationRow,
  state,
  contactId,
  property,
}) {
  try {
    if (!conversationId || !contactId || !property?.id) return null;

    const { data: existing, error: existingError } = await supabase
      .from('requests')
      .select('id, property_id, contact_id, request_type, operation_type, stage_id')
      .eq('conversation_id', conversationId)
      .eq('request_type', 'demand')
      .eq('contact_id', contactId)
      .eq('property_id', property.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingError) {
      console.error('Error checking existing demand request:', existingError);
      return null;
    }

    if (existing && existing.length > 0) {
      return existing[0];
    }

    const stageId = await getInitialRequestStageId('demand');

    const title =
      property?.listing_id && property?.title
        ? `Demanda directa ${property.listing_id} - ${property.title}`
        : property?.listing_id
        ? `Demanda directa ${property.listing_id}`
        : 'Demanda directa sobre propiedad';

    const notes =
      buildAiSummary(state, property ? [property] : []) ||
      'Cliente entró por referencia directa de propiedad y requiere seguimiento comercial.';

    const payload = {
      request_type: 'demand',
      operation_type: property.operation_type || state.operation_type || 'sale',
      status: 'open',
      contact_id: contactId,
      assigned_agent_profile_id: conversationRow?.assigned_agent_profile_id || null,
      created_by: null,
      source: 'ai_agent',
      property_id: property.id,
      conversation_id: conversationId,
      stage_id: stageId,
      title,
      notes_summary: notes,
      next_action: state.wants_visit ? 'Coordinar visita' : 'Contactar lead',
      next_action_due_at: nowIso(),
      is_active: true,
    };

    const { data: created, error: createError } = await supabase
      .from('requests')
      .insert(payload)
      .select()
      .single();

    if (createError) {
      console.error('Error creating demand request:', createError);
      return null;
    }

    await saveConversationEvent(conversationId, 'demand_request_created', {
      request_id: created.id,
      property_id: property.id,
      listing_id: property.listing_id || null,
      operation_type: payload.operation_type,
    });

    return created;
  } catch (err) {
    console.error('FATAL maybeCreateDemandRequest:', err);
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
    !!state.direct_property_reference;

  const enoughContextForHuman =
    !!state.location_text &&
    !!state.budget_max &&
    !!state.budget_currency &&
    !!state.operation_type;

  return explicitHuman || (properties.length === 0 && enoughContextForHuman);
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

    from = message.from;
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
    });

    let matchedProperties = [];
    let attemptUsed = null;
    let resultQuality = 'none';
    let topMatchScore = 0;
    let rawResultCount = 0;

    if (nextAiState.direct_property_reference && nextAiState.property_code) {
      await saveConversationEvent(conversationId, 'direct_property_lookup_started', {
        property_code: nextAiState.property_code,
      });

      const directProperty = await getPropertyByCode(nextAiState.property_code);

      if (directProperty) {
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
          property_code: nextAiState.property_code,
          result_quality: resultQuality,
        };
        nextAiState.last_search_result_count = 1;
        nextAiState.last_shown_property_ids = [directProperty.id];

        await saveConversationEvent(conversationId, 'direct_property_lookup_found', {
          property_code: nextAiState.property_code,
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
          property_code: nextAiState.property_code,
          result_quality: resultQuality,
        };
        nextAiState.last_search_result_count = 0;
        nextAiState.last_shown_property_ids = [];

        await saveConversationEvent(conversationId, 'direct_property_lookup_not_found', {
          property_code: nextAiState.property_code,
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

    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);

    let reply = null;

    if (isGreetingOnly(text) && !previousAiState.lead_flow && !incomingSignals.property_code) {
      reply =
        'Hola, soy el asistente de Luxetty 😊\nCon gusto te ayudo.\n¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    } else if (nextAiState.handoff_sent && isClosureCheck(text)) {
      reply = nextAiState.lead_flow === 'offer'
        ? 'Gracias. Quedó registrado y un asesor de Luxetty te contactará por el canal que elegiste.'
        : 'Gracias. Quedó registrada tu búsqueda y un asesor de Luxetty te contactará para continuar.';
      nextAiState.closing_message_sent = true;
    } else if (nextAiState.direct_property_reference && nextAiState.property_code && matchedProperties.length === 0) {
      reply = `No encontré una propiedad activa con el ID ${nextAiState.property_code}. Si quieres, dime qué tipo de propiedad buscas y te ayudo a encontrar opciones.`;
    } else if (nextAiState.lead_flow === 'demand') {
      reply = buildDemandReply(nextAiState, changeType, matchedProperties, attemptUsed);

      const explicitHandoffIntent =
        nextAiState.wants_human ||
        normalizedText.includes('contacte un asesor') ||
        normalizedText.includes('contacte un agente');

      const commercialHandoffIntent =
        shouldPrioritizeDemandHandoff(nextAiState, matchedProperties);

      if (
        (explicitHandoffIntent || commercialHandoffIntent) &&
        !nextAiState.full_name
      ) {
        reply = nextAiState.wants_visit
          ? 'Claro. Para ayudarte a coordinar una visita, ¿me compartes tu nombre completo?'
          : 'Claro. Antes de pasarte con un asesor, ¿me compartes tu nombre completo?';
        nextAiState.awaiting_field = 'full_name';
      } else if (
        (explicitHandoffIntent || commercialHandoffIntent) &&
        nextAiState.full_name &&
        !nextAiState.contact_preference
      ) {
        reply = 'Perfecto. ¿Prefieres que te contacten por WhatsApp o por llamada?';
        nextAiState.awaiting_field = 'contact_preference';
      } else if (
        (explicitHandoffIntent || commercialHandoffIntent) &&
        nextAiState.full_name &&
        nextAiState.contact_preference &&
        nextAiState.contact_number_confirmed == null
      ) {
        reply = 'Perfecto. ¿Este es el mejor número para contactarte?';
        nextAiState.awaiting_field = 'contact_number_confirmed';
      }

      const canCreateDemandHandoff =
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

        if (nextAiState.direct_property_reference && matchedProperties.length > 0 && contactId) {
          await maybeCreateDemandRequest({
            conversationId,
            conversationRow,
            state: nextAiState,
            contactId,
            property: matchedProperties[0],
          });
        }

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
          !nextAiState.handoff_sent
        ) {
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

          if (nextAiState.direct_property_reference && matchedProperties.length > 0 && contactId) {
            await maybeCreateDemandRequest({
              conversationId,
              conversationRow,
              state: nextAiState,
              contactId,
              property: matchedProperties[0],
            });
          }

          nextAiState.handoff_ready = true;
          nextAiState.handoff_sent = true;
          nextAiState.awaiting_field = null;
          reply = buildFinalHandoffReply(nextAiState);
        } else {
          if (nextAiState.awaiting_field == null) {
            if (
              matchedProperties.length > 0 &&
              !nextAiState.full_name &&
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
        await upsertContactForConversation(conversationRow, nextAiState, from);
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

    const updatedMessages = [
      ...(conversations.get(from) || []),
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ];

    conversations.set(from, updatedMessages.slice(-MAX_SHORT_MEMORY_MESSAGES));

    const outboundMessageRow = await saveConversationMessage({
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
});