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
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SHORT_MEMORY_MESSAGES = 8;
const DEFAULT_PROPERTY_LIMIT = 3;
const SEARCH_BUDGET_FALLBACK_MULTIPLIER = 1.15;

const DEMAND_MIN_SALE_MXN = 3000000;
const DEMAND_MIN_RENT_MXN = 10000;
const OFFER_MIN_SALE_MXN = 3000000;
const OFFER_MIN_RENT_MXN = 10000;

const CAPTURE_ALLOWED_AREAS = [
  'monterrey',
  'cumbres',
  'garcia',
  'garcía',
  'san pedro',
  'san pedro garza garcia',
  'san pedro garza garcía',
  'carretera nacional',
  'guadalupe',
  'san nicolas',
  'san nicolas',
  'apodaca',
  'santa catarina',
];

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

const conversations = new Map();

const locationCatalog = {
  loadedAt: 0,
  rawNames: [],
  normalizedMap: new Map(),
};

const SYSTEM_PROMPT = `
Eres Luxetty IA, asistente inmobiliario premium de Luxetty Real Estate.

Reglas no negociables:
- Responde breve, amable, profesional y natural.
- Máximo una pregunta por mensaje.
- Nunca inventes propiedades, precios, ubicaciones, disponibilidad, links, amenidades o datos técnicos.
- Solo puedes ofrecer propiedades reales encontradas en el sistema en este turno.
- Solo usa links públicos de Luxetty: https://luxetty.com
- Nunca envíes links técnicos de storage, supabase, cdn o internos.
- Si no hay coincidencia exacta, dilo con tacto y ofrece ampliar búsqueda o pasar con asesor.
- Si el usuario quiere vender o poner en renta, filtra, califica y lleva a seguimiento humano.
- Si ya quedó listo para seguimiento humano, confirma el siguiente paso y no entres en loop.
- No envíes resúmenes internos al prospecto.
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
  return [...new Set((arr || []).filter(Boolean))];
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '{}';
  }
}

function formatMoney(amount, currencyCode = 'MXN') {
  if (amount == null) return 'Precio por confirmar';
  return `$${Number(amount).toLocaleString('es-MX')} ${currencyCode}`;
}

function formatOperationLabel(operationType) {
  if (operationType === 'sale') return 'compra';
  if (operationType === 'rent') return 'renta';
  return 'operación';
}

function formatPropertyTypeLabel(propertyType) {
  const labels = {
    house: 'casa',
    apartment: 'departamento',
    land: 'terreno',
    office: 'oficina',
    commercial: 'local comercial',
    warehouse: 'nave',
  };
  return labels[propertyType] || propertyType || 'propiedad';
}

function isGreetingOnly(text) {
  const t = normalizeText(text);
  const greetings = [
    'hola',
    'buenas',
    'buenos dias',
    'buenos días',
    'buenas tardes',
    'buenas noches',
    'hello',
    'hi',
  ];
  return greetings.includes(t);
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

function getDefaultAiState() {
  return {
    lead_flow: null,
    operation_type: null,
    property_type: null,

    location_text: null,
    matched_location_from_catalog: null,
    location_any: false,

    budget_min: null,
    budget_max: null,
    budget_currency: null,

    bedrooms: null,
    bedrooms_any: false,
    bathrooms: null,

    must_have_features: [],
    timeline_text: null,
    urgency_level: null,

    full_name: null,
    owner_relation: null,
    contact_preference: null,
    contact_number_confirmed: null,

    awaiting_field: null,
    last_change_type: null,
    intent_version: 1,

    needs_fresh_search: false,
    last_search_filters: null,
    last_search_result_count: 0,
    last_shown_property_ids: [],

    wants_human: false,
    user_goal: null,
    confidence: 'low',

    geo_qualified: null,
    value_qualified: null,
    capture_qualified: null,

    handoff_ready: false,
    handoff_sent: false,
    closing_message_sent: false,
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
    text.includes('compra') ||
    text.includes('busco una propiedad');

  const implicitDemand =
    text.includes('tienes propiedades') ||
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
    text.includes('marquen') ||
    text.includes('llamen') ||
    text.includes('llamada') ||
    text.includes('contactenme') ||
    text.includes('contáctenme') ||
    text.includes('contactarme');

  const hasPriceExpressions =
    text.includes('millones') ||
    text.endsWith('m') ||
    text.includes('$') ||
    /\b\d{4,8}\b/.test(text);

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
    } else if (leadType && prev.operation_type) {
      operationType = prev.operation_type;
    }
  }

  if (!operationType && text.includes('renta')) operationType = 'rent';
  if (!operationType && text.includes('venta')) operationType = 'sale';

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

  for (const [normalized, canonical] of locationCatalog.normalizedMap.entries()) {
    if (text.includes(normalized)) return canonical;
  }

  if (prevState?.awaiting_field === 'location_text') {
    return cleanSpaces(message);
  }

  return null;
}

function extractBudgetCurrency(message) {
  const text = normalizeText(message);

  if (
    text.includes('usd') ||
    text.includes('dolares') ||
    text.includes('dólares') ||
    text.includes('dlls') ||
    text.includes('us dollars')
  ) {
    return 'USD';
  }

  if (
    text.includes('mxn') ||
    text.includes('pesos') ||
    text.includes('millon') ||
    text.includes('millón') ||
    text.includes('millones') ||
    text.includes('$') ||
    /\b\d{4,8}\b/.test(text)
  ) {
    return 'MXN';
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

  const numberMatch = text.match(/\$?\s*([\d,]{4,10})\s*(mxn|pesos|usd|dolares|dólares)?/i);
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
    text.includes('cualquiera')
  ) {
    return 'any';
  }

  return null;
}

function extractPossibleName(message, prevState = null) {
  const raw = cleanSpaces(message);
  const text = normalizeText(message);

  const patterns = [
    /me llamo\s+([a-záéíóúñ\s]+)/i,
    /soy\s+([a-záéíóúñ\s]+)/i,
    /mi nombre es\s+([a-záéíóúñ\s]+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return cleanSpaces(match[1]).replace(/[.,!?]+$/g, '');
    }
  }

  if (prevState?.awaiting_field === 'full_name') {
    if (
      raw.length >= 3 &&
      raw.length <= 80 &&
      !/\d/.test(raw) &&
      !text.includes('comprar') &&
      !text.includes('rentar') &&
      !text.includes('vender') &&
      !text.includes('whatsapp') &&
      !text.includes('llamada')
    ) {
      return raw.replace(/[.,!?]+$/g, '');
    }
  }

  return null;
}

function detectOwnerRelation(message) {
  const text = normalizeText(message);

  if (
    text.includes('es mia') ||
    text.includes('es mía') ||
    text.includes('es mi propiedad') ||
    text.includes('es propia') ||
    text.includes('soy el propietario') ||
    text.includes('soy la propietaria')
  ) {
    return 'owner';
  }

  if (
    text.includes('ayudo a alguien') ||
    text.includes('de un familiar') ||
    text.includes('de mi mama') ||
    text.includes('de mi mamá') ||
    text.includes('de mi papa') ||
    text.includes('de mi papá') ||
    text.includes('de un amigo') ||
    text.includes('de un cliente')
  ) {
    return 'representative';
  }

  return null;
}

function extractPhoneNumber(message) {
  const match = (message || '').replace(/[^\d+]/g, '').match(/(\+?\d{10,15})/);
  return match ? match[1] : null;
}

function detectContextualSignals(message, prevState) {
  const text = normalizeText(message);
  const awaitingField = prevState?.awaiting_field || null;

  const signals = {
    answer_affirmative:
      text === 'si' ||
      text === 'sí' ||
      text.startsWith('sí,') ||
      text.startsWith('si,') ||
      text === 'correcto',
    answer_negative: text === 'no',
    answer_any:
      text.includes('no importa') ||
      text.includes('da igual') ||
      text.includes('sin importar') ||
      text.includes('cualquiera'),
    location_any: false,
    bedrooms_any: false,
    contact_number_confirmed: null,
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

  if (awaitingField === 'contact_number_confirmed') {
    if (signals.answer_affirmative) signals.contact_number_confirmed = true;
    if (signals.answer_negative) signals.contact_number_confirmed = false;
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
  const budgetCurrency = extractBudgetCurrency(message);
  const bedrooms = extractBedrooms(message);
  const bathrooms = extractBathrooms(message);
  const contactPreference = detectContactPreference(message);
  const fullName = extractPossibleName(message, prevState);
  const ownerRelation = detectOwnerRelation(message);
  const betterPhone = prevState?.awaiting_field === 'contact_number' ? extractPhoneNumber(message) : null;

  let confidence = 'low';
  const filledCount = [
    intent.leadType,
    intent.operationType,
    propertyType,
    locationText,
    budgetMax,
    budgetCurrency,
    bedrooms,
    fullName,
    ownerRelation,
  ].filter((v) => v !== null && v !== undefined).length;

  if (filledCount >= 5) confidence = 'high';
  else if (filledCount >= 3) confidence = 'medium';

  return {
    lead_flow: intent.leadType || null,
    operation_type: intent.operationType || null,
    property_type: propertyType,
    location_text: locationText,
    budget_max: budgetMax,
    budget_currency: budgetCurrency,
    bedrooms,
    bathrooms,
    contact_preference: contactPreference,
    full_name: fullName,
    owner_relation: ownerRelation,
    better_phone: betterPhone,
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

  if (flowChanged) return 'restart_flow';

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

  if (budgetChanged || signals.bedrooms_any) return 'minor_update';

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
      matched_location_from_catalog: signals.matched_location_from_catalog || null,
      budget_max:
        signals.budget_max !== null && signals.budget_max !== undefined
          ? signals.budget_max
          : null,
      budget_currency: signals.budget_currency || null,
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
      full_name: signals.full_name || null,
      owner_relation: signals.owner_relation || null,
      contact_preference: signals.contact_preference || null,
      contact_number_confirmed: signals.contact_number_confirmed,
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
      matched_location_from_catalog:
        signals.matched_location_from_catalog || prev.matched_location_from_catalog,
      budget_max:
        signals.budget_max !== null && signals.budget_max !== undefined
          ? signals.budget_max
          : prev.budget_max,
      budget_currency: signals.budget_currency || prev.budget_currency,
      bedrooms:
        signals.bedrooms !== null && signals.bedrooms !== undefined
          ? signals.bedrooms
          : prev.bedrooms,
      bathrooms:
        signals.bathrooms !== null && signals.bathrooms !== undefined
          ? signals.bathrooms
          : prev.bathrooms,
      full_name: signals.full_name || prev.full_name,
      owner_relation: signals.owner_relation || prev.owner_relation,
      contact_preference: signals.contact_preference || prev.contact_preference,
      contact_number_confirmed:
        signals.contact_number_confirmed !== null && signals.contact_number_confirmed !== undefined
          ? signals.contact_number_confirmed
          : prev.contact_number_confirmed,
      wants_human: prev.wants_human || !!signals.wants_human,
      user_goal: signals.user_goal || prev.user_goal,
      confidence: signals.confidence || prev.confidence,
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
      next.handoff_ready = false;
      next.handoff_sent = false;
      next.closing_message_sent = false;
    }
  }

  next.last_change_type = changeType;
  return next;
}

function qualifiesDemandValue(state) {
  if (state.operation_type === 'sale' && state.budget_max != null) {
    return Number(state.budget_max) >= DEMAND_MIN_SALE_MXN;
  }
  if (state.operation_type === 'rent' && state.budget_max != null) {
    return Number(state.budget_max) >= DEMAND_MIN_RENT_MXN;
  }
  return true;
}

function qualifiesOfferGeo(locationText) {
  if (!locationText) return null;
  const normalized = normalizeText(locationText);
  return CAPTURE_ALLOWED_AREAS.some((term) => normalized.includes(term));
}

function qualifiesOfferValue(state) {
  if (state.operation_type === 'sale' && state.budget_max != null) {
    return Number(state.budget_max) >= OFFER_MIN_SALE_MXN;
  }
  if (state.operation_type === 'rent' && state.budget_max != null) {
    return Number(state.budget_max) >= OFFER_MIN_RENT_MXN;
  }
  return null;
}

function hasDemandSearchableState(state) {
  return (
    state.lead_flow === 'demand' &&
    !!state.operation_type &&
    (!!state.location_text || state.location_any) &&
    state.budget_max != null &&
    !!state.budget_currency
  );
}

function shouldRunPropertySearch(prevState, nextState) {
  const prev = normalizeAiState(prevState);
  const next = normalizeAiState(nextState);

  if (!hasDemandSearchableState(next)) return false;
  if (next.lead_flow !== 'demand') return false;

  return (
    prev.lead_flow !== next.lead_flow ||
    prev.operation_type !== next.operation_type ||
    prev.property_type !== next.property_type ||
    prev.location_text !== next.location_text ||
    prev.budget_max !== next.budget_max ||
    prev.budget_currency !== next.budget_currency ||
    prev.bedrooms !== next.bedrooms ||
    prev.bathrooms !== next.bathrooms ||
    prev.location_any !== next.location_any ||
    prev.bedrooms_any !== next.bedrooms_any ||
    prev.last_search_result_count === 0
  );
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

function getPublicPropertyUrl(property) {
  if (!property) return null;

  if (
    property.listing_url &&
    /^https:\/\/luxetty\.com/i.test(property.listing_url)
  ) {
    return property.listing_url;
  }

  if (
    property.canonical_url &&
    /^https:\/\/luxetty\.com/i.test(property.canonical_url) &&
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
  if (property.bedrooms != null) extras.push(`${property.bedrooms} recámaras`);
  if (property.bathrooms != null) extras.push(`${property.bathrooms} baños`);
  if (property.parking_spaces != null) extras.push(`${property.parking_spaces} cajones`);

  const publicUrl = getPublicPropertyUrl(property);

  let text = `• ${title}\n${price}\n${location}`;
  if (extras.length > 0) text += `\n${extras.join(' · ')}`;
  if (publicUrl) text += `\nVer galería y detalles: ${publicUrl}`;

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

  if (state.full_name) parts.push(`Nombre: ${state.full_name}.`);

  if (state.lead_flow === 'demand') {
    parts.push(`Lead buscando ${state.operation_type === 'rent' ? 'renta' : 'compra'}.`);
  } else if (state.lead_flow === 'offer') {
    parts.push(`Lead quiere ${state.operation_type === 'rent' ? 'poner en renta' : 'vender'} su propiedad.`);
  }

  if (state.property_type) parts.push(`Tipo: ${formatPropertyTypeLabel(state.property_type)}.`);
  if (state.location_text) parts.push(`Ubicación: ${state.location_text}.`);
  if (state.budget_max) parts.push(`Monto: ${formatMoney(state.budget_max, state.budget_currency || 'MXN')}.`);
  if (state.owner_relation) parts.push(`Relación con propiedad: ${state.owner_relation}.`);
  if (state.contact_preference) parts.push(`Canal preferido: ${state.contact_preference}.`);
  if (state.timeline_text) parts.push(`Tiempo: ${state.timeline_text}.`);

  if (properties.length > 0) parts.push(`Resultados actuales: ${properties.length}.`);
  else if (state.last_search_result_count === 0 && state.lead_flow === 'demand') parts.push('Sin resultados exactos en última búsqueda.');

  return parts.join(' ').trim() || null;
}

function getChangeAcknowledgement(changeType, state) {
  if (changeType === 'restart_flow') {
    if (state.lead_flow === 'offer' && state.operation_type === 'sale') return 'Perfecto, ahora te apoyo con la venta.';
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') return 'Perfecto, ahora te apoyo con ponerla en renta.';
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') return 'Perfecto, ahora te apoyo con la búsqueda de compra.';
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') return 'Perfecto, ahora te apoyo con la búsqueda de renta.';
  }

  if (changeType === 'radical_change') {
    if (state.location_any) return 'Perfecto, amplio la búsqueda.';
    if (state.location_text) return `Perfecto, actualizo la búsqueda a ${state.location_text}.`;
    return 'Perfecto, actualizo la búsqueda.';
  }

  if (changeType === 'minor_update') return 'Perfecto, lo actualizo.';
  return 'Perfecto.';
}

function buildDemandLowValueReply(state) {
  if (state.operation_type === 'sale') {
    return 'Por el momento estamos enfocados en opciones de compra desde $3,000,000 MXN. Si quieres, te oriento brevemente o te ayudo a ajustar la búsqueda.';
  }
  return 'Por el momento estamos enfocados en opciones de renta desde $10,000 MXN. Si quieres, te ayudo a ajustar la búsqueda.';
}

function buildOfferRejectedReply(state) {
  if (state.geo_qualified === false) {
    return 'Por el momento estamos enfocados en Monterrey, Cumbres, García, San Pedro, Carretera Nacional y zonas residenciales de alto valor en Guadalupe, San Nicolás, Apodaca y Santa Catarina.';
  }

  if (state.value_qualified === false) {
    return 'Por el momento estamos enfocados en propiedades de mayor valor en ciertas zonas, pero con gusto puedo orientarte brevemente si lo necesitas.';
  }

  return 'Por el momento necesito revisar un poco más el caso para orientarte correctamente.';
}

function buildFinalHandoffReply(state) {
  const name = state.full_name ? `, ${state.full_name}` : '';
  const channel =
    state.contact_preference === 'call'
      ? 'por llamada'
      : 'por WhatsApp';

  if (state.lead_flow === 'offer') {
    return `Perfecto${name}. Ya dejé tu caso registrado y un asesor de Luxetty te contactará ${channel} para revisar la propiedad contigo.`;
  }

  return `Perfecto${name}. Ya dejé tu búsqueda registrada y un asesor de Luxetty te contactará ${channel} para ayudarte con opciones alineadas.`;
}

function buildDemandReply(state, changeType, properties, attemptUsed) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.operation_type) {
    return 'Con gusto te ayudo. ¿Buscas comprar o rentar?';
  }

  if (!state.location_text && !state.location_any) {
    return `${ack}\n¿En qué zona te interesa buscar?`;
  }

  if (state.budget_max == null) {
    return `${ack}\n¿Cuál es tu presupuesto aproximado?`;
  }

  if (!state.budget_currency) {
    return `${ack}\n¿Tu presupuesto es en MXN o USD?`;
  }

  if (!qualifiesDemandValue(state)) {
    return buildDemandLowValueReply(state);
  }

  if (properties.length > 0) {
    if (properties.length === 1) {
      return `${ack}
Tengo una opción real para ti:

${formatPropertyShort(properties[0])}

¿Quieres que te comparta otra opción o prefieres que te contacte un asesor?`;
    }

    return `${ack}
Encontré opciones reales para ti:

${formatPropertyList(properties)}

¿Prefieres que te contacte un asesor o quieres que afine la búsqueda?`;
  }

  const noExact = `${ack}
No tengo una coincidencia exacta en este momento.`;

  if (attemptUsed === 'expanded_budget') {
    return `${noExact}
Puedo ampliar zona o presupuesto, o dejarte con un asesor para alternativas reales. ¿Qué prefieres?`;
  }

  return `${noExact}
¿Quieres que amplíe la búsqueda o prefieres que te contacte un asesor?`;
}

function buildOfferReply(state, changeType) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.location_text) {
    return `${ack}
¿En qué zona, colonia o municipio está la propiedad?`;
  }

  if (state.geo_qualified === false || state.value_qualified === false) {
    return buildOfferRejectedReply(state);
  }

  if (state.budget_max == null) {
    return `${ack}
¿Cuál es tu precio estimado?`;
  }

  if (!state.budget_currency) {
    return `${ack}
¿Ese monto es en MXN o USD?`;
  }

  if (state.owner_relation == null) {
    return `${ack}
¿La propiedad es tuya o estás apoyando a alguien?`;
  }

  if (!state.property_type) {
    return `${ack}
¿Qué tipo de propiedad es?`;
  }

  if (!state.full_name) {
    return `${ack}
¿Me compartes tu nombre completo?`;
  }

  if (!state.contact_preference) {
    return `${ack}
¿Prefieres que te contacten por WhatsApp o por llamada?`;
  }

  if (state.contact_number_confirmed == null) {
    return `${ack}
¿Este es el mejor número para contactarte?`;
  }

  return buildFinalHandoffReply(state);
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

function sanitizeReply(reply) {
  return (reply || '')
    .replace(/https?:\/\/[^\s]*supabase[^\s]*/gi, '')
    .replace(/https?:\/\/[^\s]*storage[^\s]*/gi, '')
    .replace(/https?:\/\/(?!luxetty\.com)[^\s]+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

    if (incomingSignals.better_phone) {
      nextAiState.contact_number_confirmed = true;
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

      nextAiState.needs_fresh_search = false;
      nextAiState.last_search_filters = {
        operation_type: nextAiState.operation_type,
        location_text: nextAiState.location_text,
        budget_max: nextAiState.budget_max,
        budget_currency: nextAiState.budget_currency,
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
    }

    await maybeGenerateAiSummary(conversationId, nextAiState, matchedProperties);

    let reply = null;

    if (isGreetingOnly(text) && !previousAiState.lead_flow) {
      reply =
        'Hola, soy el asistente de Luxetty 😊\nCon gusto te ayudo.\n¿Buscas comprar, rentar, vender o poner en renta una propiedad?';
    } else if (nextAiState.handoff_sent && isClosureCheck(text)) {
      reply = nextAiState.lead_flow === 'offer'
        ? 'Gracias. Quedó registrado y un asesor de Luxetty te contactará por el canal que elegiste.'
        : 'Gracias. Quedó registrada tu búsqueda y un asesor de Luxetty te contactará para continuar.';
      nextAiState.closing_message_sent = true;
    } else if (nextAiState.lead_flow === 'demand') {
      reply = buildDemandReply(nextAiState, changeType, matchedProperties, attemptUsed);

      const explicitHandoffIntent =
        nextAiState.wants_human ||
        normalizeText(text).includes('contacte un asesor') ||
        normalizeText(text).includes('contacte un agente');

      if (
        explicitHandoffIntent &&
        !nextAiState.full_name
      ) {
        reply = 'Claro. Antes de pasarte con un asesor, ¿me compartes tu nombre completo?';
        nextAiState.awaiting_field = 'full_name';
      } else if (
        explicitHandoffIntent &&
        nextAiState.full_name &&
        !nextAiState.contact_number_confirmed &&
        !nextAiState.contact_preference
      ) {
        reply = 'Perfecto. ¿Prefieres que te contacten por WhatsApp o por llamada?';
        nextAiState.awaiting_field = 'contact_preference';
      } else if (
        explicitHandoffIntent &&
        nextAiState.full_name &&
        nextAiState.contact_preference &&
        nextAiState.contact_number_confirmed == null
      ) {
        reply = 'Perfecto. ¿Este es el mejor número para contactarte?';
        nextAiState.awaiting_field = 'contact_number_confirmed';
      }

      const canCreateDemandHandoff =
        shouldEscalateDemand(nextAiState, matchedProperties, text) &&
        !!nextAiState.full_name &&
        !!nextAiState.contact_preference &&
        nextAiState.contact_number_confirmed === true &&
        !nextAiState.handoff_sent;

      if (canCreateDemandHandoff) {
        await upsertContactForConversation(conversationRow, nextAiState, from);
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
        nextAiState.handoff_ready = true;
        nextAiState.handoff_sent = true;
        nextAiState.awaiting_field = null;
        reply = buildFinalHandoffReply(nextAiState);
      } else {
        if (!matchedProperties.length && nextAiState.full_name && nextAiState.contact_preference && nextAiState.contact_number_confirmed === true && !nextAiState.handoff_sent) {
          await upsertContactForConversation(conversationRow, nextAiState, from);
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
              !nextAiState.full_name &&
              (normalizeText(text).includes('asesor') || normalizeText(text).includes('contacte'))
            ) {
              nextAiState.awaiting_field = 'full_name';
              reply = 'Claro. Antes de pasarte con un asesor, ¿me compartes tu nombre completo?';
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