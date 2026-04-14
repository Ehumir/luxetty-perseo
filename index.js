require('dotenv').config();

const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'luxetty_token';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const MAX_SHORT_MEMORY_MESSAGES = 8;
const DEFAULT_PROPERTY_LIMIT = 3;
const SEARCH_BUDGET_FALLBACK_MULTIPLIER = 1.2;

console.log('ENV CHECK:', {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI: !!process.env.OPENAI_API_KEY,
  WHATSAPP: !!process.env.WHATSAPP_TOKEN,
  PHONE_ID: !!process.env.PHONE_NUMBER_ID,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Memoria corta de fallback conversacional (solo chitchat / mensajes ambiguos)
const conversations = new Map();

// Catálogo dinámico de ubicaciones del sistema
const locationCatalog = {
  loadedAt: 0,
  rawNames: [],
  normalizedMap: new Map(), // normalized -> canonical
};

const SYSTEM_PROMPT = `
Eres el asesor conversacional premium de Luxetty.

Reglas no negociables:
- Responde corto, amable, claro y elegante.
- Máximo una pregunta por mensaje.
- Nunca inventes propiedades, precios, ubicaciones, disponibilidad, amenidades, recámaras, baños ni links.
- Solo puedes ofrecer propiedades reales encontradas en el sistema en el turno actual.
- Nunca reutilices propiedades viejas si en el turno actual no llegaron resultados reales.
- Nunca envíes URLs técnicas de storage, CDN, Supabase o rutas internas.
- Si existe landing pública, usa solo esa URL pública.
- Si el usuario quiere fotos, indícale que vea la galería en la landing.
- Si el usuario cambia zona, operación o tipo de propiedad, reconoce el cambio y continúa con la nueva búsqueda.
- Si cambia de buscar a vender o de vender a buscar, cambia completamente de flujo.
- Si no hay coincidencias exactas, ofrece ampliar búsqueda o escalar con un asesor.
- Si el usuario quiere vender o poner en renta, capta la propiedad con trato premium.
- No hagas textos largos.
- No repitas saludo si ya hay contexto.
`;

function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function cleanSpaces(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toBoolean(value) {
  return value === true;
}

function hasQuestion(text) {
  return (text || '').includes('?') || (text || '').includes('¿');
}

function capFirst(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatMoney(amount, currencyCode = 'MXN') {
  if (amount == null) return 'Precio por confirmar';
  return `$${Number(amount).toLocaleString('es-MX')} ${currencyCode}`;
}

function getDefaultAiState() {
  return {
    lead_flow: null, // 'demand' | 'offer'
    operation_type: null, // 'sale' | 'rent'
    property_type: null, // house | apartment | land | office | commercial | warehouse
    location_text: null,
    location_any: false,
    budget_min: null,
    budget_max: null,
    bedrooms: null,
    bedrooms_any: false,
    bathrooms: null,
    must_have_features: [],
    timeline_text: null,
    contact_preference: null, // whatsapp | call | any
    contact_number_confirmed: null,

    awaiting_field: null,
    last_change_type: null,
    intent_version: 1,

    needs_fresh_search: false,
    last_search_filters: null,
    last_search_result_count: 0,
    last_shown_property_ids: [],

    // Nuevo
    wants_human: false,
    user_goal: null, // 'search_property' | 'capture_property' | 'browse' | null
    confidence: 'low', // low | medium | high
    matched_location_from_catalog: null,
  };
}

function normalizeAiState(rawState) {
  const base = getDefaultAiState();

  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return base;
  }

  return {
    ...base,
    ...rawState,
    must_have_features: Array.isArray(rawState.must_have_features)
      ? rawState.must_have_features
      : [],
    last_shown_property_ids: Array.isArray(rawState.last_shown_property_ids)
      ? rawState.last_shown_property_ids
      : [],
  };
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

  // match exact
  if (locationCatalog.normalizedMap.has(text)) {
    return locationCatalog.normalizedMap.get(text);
  }

  // match contains
  for (const [normalized, canonical] of locationCatalog.normalizedMap.entries()) {
    if (text.includes(normalized) || normalized.includes(text)) {
      return canonical;
    }
  }

  return cleanSpaces(rawText);
}

function detectIntent(message, prevState = null) {
  const text = normalizeText(message);
  const prev = normalizeAiState(prevState);

  const wantsOfferRent =
    text.includes('poner en renta') ||
    text.includes('quiero poner en renta') ||
    text.includes('rentar mi propiedad') ||
    text.includes('rento mi propiedad') ||
    text.includes('renta mi casa') ||
    text.includes('renta mi propiedad');

  const wantsSell =
    text.includes('quiero vender') ||
    text.includes('vender') ||
    text.includes('vendo') ||
    text.includes('vender mi casa') ||
    text.includes('vender mi propiedad') ||
    text.includes('venta mi casa') ||
    text.includes('venta mi propiedad');

  const wantsRent =
    text.includes('quiero rentar') ||
    text.includes('busco renta') ||
    text.includes('quiero una renta') ||
    text.includes('rentar') ||
    text.includes('alquilar') ||
    text.includes('alquiler') ||
    text.includes('rentar una') ||
    text.includes('rentar un');

  const wantsBuy =
    text.includes('quiero comprar') ||
    text.includes('busco comprar') ||
    text.includes('busco casa') ||
    text.includes('busco depa') ||
    text.includes('busco departamento') ||
    text.includes('busco terreno') ||
    text.includes('comprar') ||
    text.includes('compra');

  const implicitDemand =
    text.includes('tienes propiedades') ||
    text.includes('tiene propiedades') ||
    text.includes('que propiedades tienes') ||
    text.includes('qué propiedades tienes') ||
    text.includes('que tienes') ||
    text.includes('qué tienes') ||
    text.includes('hay casas') ||
    text.includes('hay opciones') ||
    text.includes('manejas') ||
    text.includes('opciones') ||
    text.includes('disponibles') ||
    text.includes('en cumbres') ||
    text.includes('en san pedro') ||
    text.includes('en monterrey') ||
    text.includes('en garcia') ||
    text.includes('en garcía') ||
    text.includes('que tipo de propiedades tienes') ||
    text.includes('qué tipo de propiedades tienes');

  const implicitOffer =
    text.includes('mi casa') ||
    text.includes('mi propiedad') ||
    text.includes('mi depa') ||
    text.includes('mi departamento') ||
    text.includes('quiero que me ayuden a vender') ||
    text.includes('quiero que me ayuden a rentar') ||
    text.includes('quiero publicar mi propiedad');

  const wantsHuman =
    text.includes('asesor') ||
    text.includes('agente') ||
    text.includes('persona') ||
    text.includes('humano') ||
    text.includes('marquenme') ||
    text.includes('marquenme') ||
    text.includes('marquen') ||
    text.includes('llamenme') ||
    text.includes('llámenme') ||
    text.includes('llamen') ||
    text.includes('llamada') ||
    text.includes('contactenme') ||
    text.includes('contáctenme') ||
    text.includes('contactarme');

  const hasPriceExpressions =
    text.includes('millones') ||
    text.includes('m ') ||
    text.endsWith('m') ||
    text.includes('$') ||
    /\b\d{6,8}\b/.test(text);

  let leadType = null;
  let operationType = null;

  if (wantsOfferRent) {
    leadType = 'offer';
    operationType = 'rent';
  } else if (wantsSell) {
    leadType = 'offer';
    operationType = 'sale';
  } else if (wantsRent) {
    leadType = 'demand';
    operationType = 'rent';
  } else if (wantsBuy) {
    leadType = 'demand';
    operationType = 'sale';
  }

  if (!leadType && implicitOffer) {
    leadType = 'offer';
  }

  if (!leadType && implicitDemand) {
    leadType = 'demand';
  }

  if (!operationType) {
    if (leadType === 'demand' && hasPriceExpressions) {
      operationType = 'sale';
    } else if (leadType === 'demand' && prev.operation_type) {
      operationType = prev.operation_type;
    } else if (leadType === 'offer' && prev.operation_type) {
      operationType = prev.operation_type;
    }
  }

  if (!operationType && text.includes('renta')) {
    operationType = 'rent';
  }

  if (!operationType && text.includes('venta')) {
    operationType = 'sale';
  }

  return { leadType, operationType, wantsHuman };
}

function extractPropertyType(message) {
  const text = normalizeText(message);

  if (text.includes('quinta')) return 'land';
  if (text.includes('terreno')) return 'land';
  if (text.includes('casa') || text.includes('residencia')) return 'house';
  if (text.includes('depa') || text.includes('departamento')) return 'apartment';
  if (text.includes('oficina')) return 'office';
  if (text.includes('local')) return 'commercial';
  if (text.includes('nave')) return 'warehouse';

  return null;
}

function extractLocation(message, prevState = null) {
  const text = normalizeText(message);

  // Buscar primero una ubicación conocida del catálogo
  for (const [normalized, canonical] of locationCatalog.normalizedMap.entries()) {
    if (text.includes(normalized)) return canonical;
  }

  // Si el sistema está esperando ubicación, usar el texto limpio
  if (prevState?.awaiting_field === 'location_text') {
    return cleanSpaces(message);
  }

  return null;
}

function extractMaxPrice(message) {
  const text = normalizeText(message);

  const shorthand = [
    ['20 millones', 20000000],
    ['15 millones', 15000000],
    ['12 millones', 12000000],
    ['10 millones', 10000000],
    ['9 millones', 9000000],
    ['8 millones', 8000000],
    ['7 millones', 7000000],
    ['6 millones', 6000000],
    ['5 millones', 5000000],
    ['4 millones', 4000000],
    ['3 millones', 3000000],
    ['2 millones', 2000000],
    ['1 millon', 1000000],
    ['1 millón', 1000000],
    ['10m', 10000000],
    ['9m', 9000000],
    ['8m', 8000000],
    ['7m', 7000000],
    ['6m', 6000000],
    ['5m', 5000000],
    ['4m', 4000000],
    ['3m', 3000000],
    ['2m', 2000000],
    ['1m', 1000000],
  ];

  for (const [needle, value] of shorthand) {
    if (text.includes(needle)) return value;
  }

  const numberMatch = text.match(/\$?\s*([\d,]{6,10})\s*(mxn|pesos)?/i);
  if (numberMatch) {
    return Number(numberMatch[1].replace(/,/g, ''));
  }

  return null;
}

function extractBedrooms(message) {
  const text = normalizeText(message);

  let match = text.match(/(\d+)\s*(recamaras?|habitaciones?)/i);
  if (match) return Number(match[1]);

  match = text.match(/\b(\d+)\b/);
  if (match && text.length <= 10) return Number(match[1]);

  return null;
}

function extractBathrooms(message) {
  const text = normalizeText(message);
  const match = text.match(/(\d+)\s*(banos?|baños?)/i);
  if (match) return Number(match[1]);
  return null;
}

function detectContactPreference(message) {
  const text = normalizeText(message);

  if (text.includes('whatsapp')) return 'whatsapp';
  if (text.includes('llamada') || text.includes('marquen') || text.includes('llamar')) return 'call';
  if (
    text.includes('no importa') ||
    text.includes('da igual') ||
    text.includes('cualquiera') ||
    text.includes('sin importar el canal')
  ) {
    return 'any';
  }

  return null;
}

function detectContextualSignals(message, prevState) {
  const text = normalizeText(message);
  const awaitingField = prevState?.awaiting_field || null;

  const signals = {
    answer_affirmative:
      text === 'si' ||
      text === 'sí' ||
      text.startsWith('sí,') ||
      text.startsWith('si,'),
    answer_negative: text === 'no',
    answer_any:
      text.includes('no importa') ||
      text.includes('da igual') ||
      text.includes('sin importar') ||
      text.includes('cualquiera'),
    location_any: false,
    bedrooms_any: false,
  };

  if (awaitingField === 'bedrooms' && signals.answer_any) {
    signals.bedrooms = null;
    signals.bedrooms_any = true;
  }

  if (awaitingField === 'location_text' && signals.answer_any) {
    signals.location_text = null;
    signals.location_any = true;
  }

  if (awaitingField === 'contact_preference' && signals.answer_any) {
    signals.contact_preference = 'any';
  }

  return signals;
}

function inferUserGoal(leadFlow) {
  if (leadFlow === 'demand') return 'search_property';
  if (leadFlow === 'offer') return 'capture_property';
  return null;
}

function parseMessageSignals(message, prevState = getDefaultAiState()) {
  const intent = detectIntent(message, prevState);
  const contextual = detectContextualSignals(message, prevState);
  const propertyType = extractPropertyType(message);
  const locationText = extractLocation(message, prevState);
  const budgetMax = extractMaxPrice(message);
  const bedrooms = extractBedrooms(message);
  const bathrooms = extractBathrooms(message);
  const contactPreference = detectContactPreference(message);

  let confidence = 'low';
  const filledCount = [
    intent.leadType,
    intent.operationType,
    propertyType,
    locationText,
    budgetMax,
    bedrooms,
    bathrooms,
  ].filter((v) => v !== null && v !== undefined).length;

  if (filledCount >= 4) confidence = 'high';
  else if (filledCount >= 2) confidence = 'medium';

  return {
    lead_flow: intent.leadType || null,
    operation_type: intent.operationType || null,
    property_type: propertyType,
    location_text: locationText,
    budget_max: budgetMax,
    bedrooms,
    bathrooms,
    contact_preference: contactPreference,
    wants_human: !!intent.wantsHuman,
    user_goal: inferUserGoal(intent.leadType),
    confidence,
    matched_location_from_catalog: locationText || null,
    ...contextual,
  };
}

function detectStateChange(prevState, signals) {
  const prev = normalizeAiState(prevState);

  const flowChanged =
    signals.lead_flow &&
    prev.lead_flow &&
    signals.lead_flow !== prev.lead_flow;

  if (flowChanged) {
    return 'restart_flow';
  }

  const operationChanged =
    signals.operation_type &&
    prev.operation_type &&
    signals.operation_type !== prev.operation_type;

  const propertyTypeChanged =
    signals.property_type &&
    prev.property_type &&
    signals.property_type !== prev.property_type;

  const locationChanged =
    signals.location_text &&
    prev.location_text &&
    signals.location_text !== prev.location_text;

  if (operationChanged || propertyTypeChanged || locationChanged || signals.location_any) {
    return 'radical_change';
  }

  const budgetChanged =
    signals.budget_max !== null &&
    signals.budget_max !== undefined &&
    prev.budget_max !== null &&
    prev.budget_max !== undefined &&
    signals.budget_max !== prev.budget_max;

  const bedroomsChanged =
    signals.bedrooms !== null &&
    signals.bedrooms !== undefined &&
    prev.bedrooms !== null &&
    prev.bedrooms !== undefined &&
    signals.bedrooms !== prev.bedrooms;

  if (budgetChanged || bedroomsChanged || signals.bedrooms_any) {
    return 'minor_update';
  }

  const appended =
    (signals.lead_flow && !prev.lead_flow) ||
    (signals.operation_type && !prev.operation_type) ||
    (signals.property_type && !prev.property_type) ||
    (signals.location_text && !prev.location_text) ||
    ((signals.budget_max !== null && signals.budget_max !== undefined) &&
      (prev.budget_max === null || prev.budget_max === undefined)) ||
    ((signals.bedrooms !== null && signals.bedrooms !== undefined) &&
      (prev.bedrooms === null || prev.bedrooms === undefined)) ||
    (signals.contact_preference && !prev.contact_preference);

  if (appended) {
    return 'append_info';
  }

  return 'append_info';
}

function buildNextState(prevState, signals, changeType) {
  const prev = normalizeAiState(prevState);
  let next;

  if (changeType === 'restart_flow') {
    next = {
      ...getDefaultAiState(),
      lead_flow: signals.lead_flow || null,
      operation_type: signals.operation_type || null,
      property_type: signals.property_type || null,
      location_text: signals.location_text || null,
      budget_max:
        signals.budget_max !== null && signals.budget_max !== undefined
          ? signals.budget_max
          : null,
      bedrooms:
        signals.bedrooms !== null && signals.bedrooms !== undefined
          ? signals.bedrooms
          : null,
      bathrooms:
        signals.bathrooms !== null && signals.bathrooms !== undefined
          ? signals.bathrooms
          : null,
      location_any: !!signals.location_any,
      bedrooms_any: !!signals.bedrooms_any,
      wants_human: !!signals.wants_human,
      user_goal: signals.user_goal || null,
      confidence: signals.confidence || 'low',
      matched_location_from_catalog: signals.matched_location_from_catalog || null,
      intent_version: (prev.intent_version || 1) + 1,
    };
  } else {
    next = {
      ...prev,
      lead_flow: signals.lead_flow || prev.lead_flow,
      operation_type: signals.operation_type || prev.operation_type,
      property_type: signals.property_type || prev.property_type,
      location_text:
        signals.location_text !== null && signals.location_text !== undefined
          ? signals.location_text
          : prev.location_text,
      budget_max:
        signals.budget_max !== null && signals.budget_max !== undefined
          ? signals.budget_max
          : prev.budget_max,
      bedrooms:
        signals.bedrooms !== null && signals.bedrooms !== undefined
          ? signals.bedrooms
          : prev.bedrooms,
      bathrooms:
        signals.bathrooms !== null && signals.bathrooms !== undefined
          ? signals.bathrooms
          : prev.bathrooms,
      contact_preference: signals.contact_preference || prev.contact_preference,
      wants_human: prev.wants_human || !!signals.wants_human,
      user_goal: signals.user_goal || prev.user_goal,
      confidence: signals.confidence || prev.confidence,
      matched_location_from_catalog:
        signals.matched_location_from_catalog || prev.matched_location_from_catalog,
      location_any: prev.location_any,
      bedrooms_any: prev.bedrooms_any,
    };

    if (signals.location_any) {
      next.location_text = null;
      next.location_any = true;
    }

    if (signals.bedrooms_any) {
      next.bedrooms = null;
      next.bedrooms_any = true;
    }

    if (changeType === 'radical_change') {
      next.intent_version = (prev.intent_version || 1) + 1;
      next.last_shown_property_ids = [];
      next.last_search_filters = null;
      next.last_search_result_count = 0;
    }
  }

  next.last_change_type = changeType;
  return next;
}

function hasSearchableDemandState(state) {
  return (
    state.lead_flow === 'demand' &&
    !!state.operation_type &&
    (!!state.location_text ||
      state.location_any ||
      !!state.budget_max ||
      !!state.property_type ||
      !!state.bedrooms)
  );
}

function shouldRunPropertySearch(prevState, nextState) {
  const prev = normalizeAiState(prevState);
  const next = normalizeAiState(nextState);

  if (!hasSearchableDemandState(next)) return false;
  if (next.lead_flow !== 'demand') return false;

  return (
    prev.lead_flow !== next.lead_flow ||
    prev.operation_type !== next.operation_type ||
    prev.property_type !== next.property_type ||
    prev.location_text !== next.location_text ||
    prev.budget_max !== next.budget_max ||
    prev.bedrooms !== next.bedrooms ||
    prev.bathrooms !== next.bathrooms ||
    prev.location_any !== next.location_any ||
    prev.bedrooms_any !== next.bedrooms_any ||
    prev.last_search_result_count === 0
  );
}

function setAwaitingField(state, matchedProperties) {
  const next = { ...state };

  if (next.lead_flow === 'demand') {
    if (!next.location_any && !next.location_text) {
      next.awaiting_field = 'location_text';
      return next;
    }

    if (matchedProperties.length > 0) {
      next.awaiting_field = 'contact_preference';
      return next;
    }

    if ((next.bedrooms === null || next.bedrooms === undefined) && !next.bedrooms_any) {
      next.awaiting_field = 'bedrooms';
      return next;
    }

    next.awaiting_field = 'contact_preference';
    return next;
  }

  if (next.lead_flow === 'offer') {
    if (!next.location_text) {
      next.awaiting_field = 'location_text';
      return next;
    }

    if (next.budget_max === null || next.budget_max === undefined) {
      next.awaiting_field = 'price_estimate';
      return next;
    }

    next.awaiting_field = 'contact_preference';
    return next;
  }

  next.awaiting_field = null;
  return next;
}

function getPublicPropertyUrl(property) {
  if (!property) return null;

  if (property.listing_url && /^https?:\/\//i.test(property.listing_url)) {
    return property.listing_url;
  }

  if (
    property.canonical_url &&
    /^https?:\/\//i.test(property.canonical_url) &&
    !property.canonical_url.includes('supabase.co/storage') &&
    !property.canonical_url.includes('/storage/v1/object/public/')
  ) {
    return property.canonical_url;
  }

  if (property.slug) {
    return `https://luxetty.com/propiedad/${property.slug}`;
  }

  return null;
}

function formatPropertyShort(property) {
  const title = property.title || 'Propiedad disponible';
  const price = formatMoney(property.price, property.currency_code || 'MXN');
  const location =
    property.neighborhood ||
    property.zone ||
    property.city ||
    'Ubicación por confirmar';

  const extras = [];
  if (property.bedrooms !== null && property.bedrooms !== undefined) {
    extras.push(`${property.bedrooms} recámaras`);
  }
  if (property.bathrooms !== null && property.bathrooms !== undefined) {
    extras.push(`${property.bathrooms} baños`);
  }
  if (property.parking_spaces !== null && property.parking_spaces !== undefined) {
    extras.push(`${property.parking_spaces} cajones`);
  }

  const publicUrl = getPublicPropertyUrl(property);

  let text = `• ${title}\n${price}\n${location}`;
  if (extras.length > 0) {
    text += `\n${extras.join(' · ')}`;
  }
  if (publicUrl) {
    text += `\nVer galería y detalles: ${publicUrl}`;
  }

  return text;
}

function formatPropertyList(properties) {
  return properties.map((p) => formatPropertyShort(p)).join('\n\n');
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
  const filtered = (properties || []).filter((p) => !shownIds.has(p.id));
  return filtered;
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

    if (error) {
      console.error('Error saving conversation event:', error);
    }
  } catch (err) {
    console.error('FATAL saveConversationEvent:', err);
  }
}

async function saveConversationState(conversationId, nextState, aiSummary = null) {
  try {
    if (!conversationId) return false;

    const payload = {
      ai_state: nextState,
      updated_at: nowIso(),
    };

    if (aiSummary !== null) {
      payload.ai_summary = aiSummary;
    }

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
    if (!conversationId || !conversationMessageId) return;
    if (!properties || properties.length === 0) return;

    const rows = properties
      .filter((property) => property?.id)
      .map((property, index) => ({
        conversation_id: conversationId,
        conversation_message_id: conversationMessageId,
        property_id: property.id,
        position: index + 1,
      }));

    if (rows.length === 0) return;

    const { error } = await supabase
      .from('conversation_property_suggestions')
      .insert(rows);

    if (error) {
      console.error('Error saving property suggestions:', error);
    }
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

    // fallback si la RPC vieja no acepta property_type
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

async function searchPropertiesWithFallbacks(state) {
  const attempts = [];
  const seenAttemptKeys = new Set();

  function pushAttempt(attempt) {
    const key = JSON.stringify(attempt);
    if (!seenAttemptKeys.has(key)) {
      seenAttemptKeys.add(key);
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

  if (state.location_text) {
    pushAttempt({
      operationType: state.operation_type,
      location: null,
      minPrice: state.budget_min,
      maxPrice: state.budget_max,
      bedrooms: null,
      propertyType: state.property_type,
      limit: DEFAULT_PROPERTY_LIMIT,
      label: 'without_location',
    });
  }

  for (const attempt of attempts) {
    const rows = await searchProperties(attempt);
    const deduped = dedupePropertiesById(rows);
    const fresh = filterOutPreviouslyShown(deduped, state);
    const usable = fresh.length > 0 ? fresh : deduped;

    if (usable.length > 0) {
      return {
        properties: usable.slice(0, DEFAULT_PROPERTY_LIMIT),
        attemptUsed: attempt.label,
      };
    }
  }

  return {
    properties: [],
    attemptUsed: 'no_results',
  };
}

function buildAiSummary(state, properties = []) {
  const parts = [];

  if (state.lead_flow === 'demand') {
    parts.push(`Cliente buscando ${state.operation_type === 'rent' ? 'renta' : 'compra'}.`);
  } else if (state.lead_flow === 'offer') {
    parts.push(`Cliente quiere ${state.operation_type === 'rent' ? 'poner en renta' : 'vender'} su propiedad.`);
  }

  if (state.property_type) {
    const labels = {
      house: 'casa',
      apartment: 'departamento',
      land: 'terreno',
      office: 'oficina',
      commercial: 'local comercial',
      warehouse: 'nave',
    };
    parts.push(`Tipo: ${labels[state.property_type] || state.property_type}.`);
  }

  if (state.location_text) {
    parts.push(`Ubicación: ${state.location_text}.`);
  }

  if (state.budget_max) {
    parts.push(`Presupuesto máximo: ${formatMoney(state.budget_max)}.`);
  }

  if (state.bedrooms) {
    parts.push(`Mínimo ${state.bedrooms} recámaras.`);
  }

  if (state.contact_preference) {
    parts.push(`Canal preferido: ${state.contact_preference}.`);
  }

  if (properties.length > 0) {
    parts.push(`Resultados actuales: ${properties.length}.`);
  } else if (state.last_search_result_count === 0 && state.lead_flow === 'demand') {
    parts.push('Sin resultados exactos en la última búsqueda.');
  }

  return parts.join(' ').trim() || null;
}

function getChangeAcknowledgement(changeType, state) {
  if (changeType === 'restart_flow') {
    if (state.lead_flow === 'offer' && state.operation_type === 'sale') {
      return 'Perfecto, ahora te apoyo con la venta.';
    }
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') {
      return 'Perfecto, ahora te apoyo con ponerla en renta.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') {
      return 'Perfecto, ahora te apoyo con la búsqueda de compra.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') {
      return 'Perfecto, ahora te apoyo con la búsqueda de renta.';
    }
  }

  if (changeType === 'radical_change') {
    if (state.location_any) return 'Perfecto, amplio la búsqueda.';
    if (state.location_text) return `Perfecto, actualizo la búsqueda a ${state.location_text}.`;
    return 'Perfecto, actualizo la búsqueda.';
  }

  if (changeType === 'minor_update') {
    return 'Perfecto, lo actualizo.';
  }

  return 'Perfecto.';
}

function buildDemandReply(state, changeType, properties, attemptUsed) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (properties.length > 0) {
    if (properties.length === 1) {
      return `${ack}
Tengo una opción real que coincide con tu búsqueda:

${formatPropertyShort(properties[0])}

¿Quieres que te comparta otra opción o prefieres que te contacte un asesor?`;
    }

    return `${ack}
Encontré opciones reales para ti:

${formatPropertyList(properties)}

¿Prefieres que te contacte un asesor o quieres que afine la búsqueda?`;
  }

  const exactContext =
    state.location_text || state.budget_max || state.property_type || state.bedrooms;

  if (!exactContext) {
    return `${ack}
¿En qué zona te gustaría buscar?`;
  }

  const noExact = `${ack}
No tengo una coincidencia exacta en este momento.`;

  if (!state.location_text && !state.location_any) {
    return `${noExact}
¿Qué zona te interesa?`;
  }

  if ((state.bedrooms === null || state.bedrooms === undefined) && !state.bedrooms_any) {
    return `${noExact}
¿Tienes un mínimo de recámaras?`;
  }

  if (attemptUsed === 'expanded_budget') {
    return `${noExact}
Puedo buscar en zonas cercanas o dejarle el caso a un asesor para alternativas reales. ¿Qué prefieres?`;
  }

  return `${noExact}
¿Quieres que amplíe zona o presupuesto, o prefieres que te contacte un asesor?`;
}

function buildOfferReply(state, changeType) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.location_text) {
    return `${ack}
¿En qué zona, colonia o municipio está la propiedad?`;
  }

  if (!state.property_type) {
    return `${ack}
¿Qué tipo de propiedad es?`;
  }

  if (state.budget_max === null || state.budget_max === undefined) {
    return `${ack}
¿Cuál es tu precio estimado?`;
  }

  if (!state.contact_preference) {
    return `${ack}
Perfecto, con eso avanzamos. ¿Prefieres que te contacte por WhatsApp o llamada?`;
  }

  return `${ack}
Perfecto, ya tengo lo necesario para que un asesor lo revise contigo.`;
}

async function buildFallbackOpenAIReply(text, state, changeType) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Estado actual:
${safeJsonStringify(state)}

Tipo de cambio detectado: ${changeType}

IMPORTANTE:
- No compartas propiedades específicas.
- No inventes resultados.
- Máximo una pregunta.
- Mantén tono premium y amable.
`,
      },
      { role: 'user', content: text },
    ],
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    'Con gusto te ayudo. ¿Buscas comprar, rentar, vender o poner en renta una propiedad?'
  );
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
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

    return data;
  } catch (err) {
    console.error('FATAL maybeCreateFollowupRequest:', err);
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
    normalized.includes('marquen');

  const enoughContextForHuman =
    !!state.location_text &&
    (!!state.budget_max || !!state.property_type || !!state.bedrooms);

  return explicitHuman || (properties.length === 0 && enoughContextForHuman);
}

function shouldEscalateOffer(state, text) {
  const normalized = normalizeText(text);

  if (state.contact_preference) return true;

  return (
    state.wants_human ||
    normalized.includes('asesor') ||
    normalized.includes('agente') ||
    normalized.includes('llamen') ||
    normalized.includes('marquen')
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

  if (error) {
    return res.status(500).json({ error });
  }

  res.json(data);
});

app.get('/conversations/:id', async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(500).json({ error });
  }

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

    if (!message) {
      return res.sendStatus(200);
    }

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
    const changeType = detectStateChange(previousAiState, incomingSignals);
    let nextAiState = buildNextState(previousAiState, incomingSignals, changeType);

    console.log('Previous ai_state:', previousAiState);
    console.log('Incoming signals:', incomingSignals);
    console.log('Change type:', changeType);
    console.log('Next ai_state before search:', nextAiState);

    await saveConversationState(conversationId, nextAiState);
    await saveConversationEvent(conversationId, 'inbound_message_processed', {
      message_type: messageType,
      text,
      incoming_signals: incomingSignals,
      change_type: changeType,
    });

    let matchedProperties = [];
    let attemptUsed = null;

    if (shouldRunPropertySearch(previousAiState, nextAiState)) {
      console.log('Buscando propiedades reales con fallbacks...');
      await saveConversationEvent(conversationId, 'search_started', {
        filters: {
          operation_type: nextAiState.operation_type,
          location_text: nextAiState.location_text,
          location_any: nextAiState.location_any,
          budget_min: nextAiState.budget_min,
          budget_max: nextAiState.budget_max,
          bedrooms: nextAiState.bedrooms,
          property_type: nextAiState.property_type,
        },
      });

      const searchResult = await searchPropertiesWithFallbacks(nextAiState);
      matchedProperties = searchResult.properties;
      attemptUsed = searchResult.attemptUsed;

      nextAiState.needs_fresh_search = false;
      nextAiState.last_search_filters = {
        operation_type: nextAiState.operation_type,
        location_text: nextAiState.location_text,
        location_any: nextAiState.location_any,
        budget_min: nextAiState.budget_min,
        budget_max: nextAiState.budget_max,
        bedrooms: nextAiState.bedrooms,
        property_type: nextAiState.property_type,
        attempt_used: attemptUsed,
      };
      nextAiState.last_search_result_count = matchedProperties.length;
      nextAiState.last_shown_property_ids = matchedProperties.map((p) => p.id);

      await saveConversationEvent(
        conversationId,
        matchedProperties.length > 0 ? 'search_results_found' : 'search_no_results',
        {
          filters: nextAiState.last_search_filters,
          result_count: matchedProperties.length,
        }
      );
    } else if (nextAiState.lead_flow === 'demand' && changeType !== 'append_info') {
      nextAiState.last_search_result_count = 0;
      nextAiState.last_shown_property_ids = [];
      nextAiState.last_search_filters = {
        operation_type: nextAiState.operation_type,
        location_text: nextAiState.location_text,
        location_any: nextAiState.location_any,
        budget_min: nextAiState.budget_min,
        budget_max: nextAiState.budget_max,
        bedrooms: nextAiState.bedrooms,
        property_type: nextAiState.property_type,
      };
    }

    nextAiState = setAwaitingField(nextAiState, matchedProperties);

    await saveConversationState(conversationId, nextAiState);
    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);

    let reply = null;

    if (nextAiState.lead_flow === 'demand') {
      reply = buildDemandReply(nextAiState, changeType, matchedProperties, attemptUsed);

      if (shouldEscalateDemand(nextAiState, matchedProperties, text)) {
        const summary =
          buildAiSummary(nextAiState, matchedProperties) ||
          'Cliente buscando propiedad y requiere seguimiento humano.';
        await maybeCreateFollowupRequest({
          conversationId,
          state: nextAiState,
          summary,
          priority:
            matchedProperties.length === 0
              ? 'high'
              : nextAiState.wants_human
              ? 'high'
              : 'medium',
          requestType: 'demand',
        });
      }
    } else if (nextAiState.lead_flow === 'offer') {
      reply = buildOfferReply(nextAiState, changeType);

      if (shouldEscalateOffer(nextAiState, text)) {
        const summary =
          buildAiSummary(nextAiState, matchedProperties) ||
          'Cliente quiere vender o poner en renta una propiedad.';
        await maybeCreateFollowupRequest({
          conversationId,
          state: nextAiState,
          summary,
          priority: nextAiState.contact_preference ? 'high' : 'medium',
          requestType: 'offer',
        });
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
        'Hola, con gusto te ayudo. ¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    }

    if (!reply) {
      reply = await buildFallbackOpenAIReply(text, nextAiState, changeType);
    }

    // Sanitizar respuesta para evitar URLs técnicas
    reply = reply
      .replace(/https?:\/\/[^\s]*supabase[^\s]*/gi, '')
      .replace(/https?:\/\/[^\s]*storage[^\s]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

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
      });
    }

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

// Warmup inicial del catálogo de ubicaciones
refreshLocationCatalog(true).catch((err) => {
  console.error('Error on initial location catalog warmup:', err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
});