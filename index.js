require('dotenv').config();

const express = require('express');
const axios = require('axios');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'luxetty_token';

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

// Memoria corta solo para fallback conversacional
const conversations = new Map();

const SYSTEM_PROMPT = `
Eres el asesor conversacional de Luxetty.

Reglas obligatorias:
- Responde corto, amable y directo.
- Máximo una pregunta por mensaje.
- Nunca inventes propiedades, precios, ubicaciones, disponibilidad, amenidades ni links.
- Nunca reutilices propiedades viejas si en el turno actual no llegaron resultados reales.
- Nunca envíes URLs técnicas de imágenes, storage, Supabase o CDN interno.
- Si existe una landing pública, usa solo esa URL.
- Si el usuario quiere fotos, indícale que vea la galería en la landing.
- Si el usuario cambia zona, operación o tipo de propiedad, reconoce el cambio y continúa con la nueva búsqueda.
- Si cambia de buscar a vender o de vender a buscar, cambia completamente de flujo.
- No hagas textos largos ni explicaciones innecesarias.
- No repitas saludo si ya existe contexto.
`;

const SUPPORTED_LOCATIONS = new Set([
  'Cumbres',
  'San Pedro',
  'Monterrey',
  'García',
  'Carretera Nacional',
  'Guadalupe',
  'San Nicolás',
  'Apodaca',
  'Santa Catarina',
]);

const KNOWN_LOCATIONS = {
  cumbres: 'Cumbres',
  'san pedro': 'San Pedro',
  monterrey: 'Monterrey',
  'garcía': 'García',
  garcia: 'García',
  'carretera nacional': 'Carretera Nacional',
  guadalupe: 'Guadalupe',
  'san nicolás': 'San Nicolás',
  'san nicolas': 'San Nicolás',
  apodaca: 'Apodaca',
  'santa catarina': 'Santa Catarina',
  montemorelos: 'Montemorelos',
};

function normalizeText(value) {
  return (value || '').toLowerCase().trim();
}

function cleanSpaces(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function isSupportedLocation(location) {
  if (!location) return true;
  return SUPPORTED_LOCATIONS.has(location);
}

function detectIntent(message) {
  const text = normalizeText(message);

  const wantsOfferRent =
    text.includes('poner en renta') ||
    text.includes('quiero poner en renta') ||
    text.includes('rentar mi propiedad') ||
    text.includes('renta mi casa') ||
    text.includes('renta mi propiedad');

  const wantsSell =
    text.includes('vender') ||
    text.includes('quiero vender') ||
    text.includes('vendo') ||
    text.includes('venta mi casa') ||
    text.includes('venta mi propiedad');

  const wantsRent =
    text.includes('quiero rentar') ||
    text.includes('busco renta') ||
    text.includes('quiero una renta') ||
    text.includes('rentar') ||
    text.includes('alquilar') ||
    text.includes('alquiler');

  const wantsBuy =
    text.includes('quiero comprar') ||
    text.includes('busco comprar') ||
    text.includes('busco casa') ||
    text.includes('busco depa') ||
    text.includes('busco terreno') ||
    text.includes('comprar') ||
    text.includes('compra');

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

  return { leadType, operationType };
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

  for (const [needle, normalized] of Object.entries(KNOWN_LOCATIONS)) {
    if (text.includes(needle)) return normalized;
  }

  if (prevState?.awaiting_field === 'location_text') {
    return cleanSpaces(message);
  }

  return null;
}

function extractMaxPrice(message) {
  const text = normalizeText(message);

  const shorthand = [
    ['10 millones', 10000000],
    ['9 millones', 9000000],
    ['8 millones', 8000000],
    ['7 millones', 7000000],
    ['6 millones', 6000000],
    ['5 millones', 5000000],
    ['4 millones', 4000000],
    ['3 millones', 3000000],
    ['10m', 10000000],
    ['9m', 9000000],
    ['8m', 8000000],
    ['7m', 7000000],
    ['6m', 6000000],
    ['5m', 5000000],
    ['4m', 4000000],
    ['3m', 3000000],
  ];

  for (const [needle, value] of shorthand) {
    if (text.includes(needle)) return value;
  }

  const numberMatch = text.match(/\$?\s*([\d,]+)\s*(mxn|pesos)?/i);
  if (numberMatch) {
    return Number(numberMatch[1].replace(/,/g, ''));
  }

  return null;
}

function extractBedrooms(message) {
  const text = normalizeText(message);

  let match = text.match(/(\d+)\s*(rec[aá]maras?|habitaciones?)/i);
  if (match) return Number(match[1]);

  match = text.match(/\b(\d+)\b/);
  if (match && text.length <= 10) return Number(match[1]);

  return null;
}

function extractBathrooms(message) {
  const text = normalizeText(message);
  const match = text.match(/(\d+)\s*(bañ[oa]s?)/i);
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

function getDefaultAiState() {
  return {
    lead_flow: null,
    operation_type: null,
    property_type: null,
    location_text: null,
    location_any: false,
    budget_min: null,
    budget_max: null,
    bedrooms: null,
    bedrooms_any: false,
    bathrooms: null,
    must_have_features: [],
    timeline_text: null,
    contact_preference: null,
    contact_number_confirmed: null,

    awaiting_field: null,
    last_change_type: null,
    intent_version: 1,

    needs_fresh_search: false,
    last_search_filters: null,
    last_search_result_count: 0,
    last_shown_property_ids: [],
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

function parseMessageSignals(message, prevState = getDefaultAiState()) {
  const intent = detectIntent(message);
  const contextual = detectContextualSignals(message, prevState);

  return {
    lead_flow: intent.leadType || null,
    operation_type: intent.operationType || null,
    property_type: extractPropertyType(message),
    location_text: extractLocation(message, prevState),
    budget_max: extractMaxPrice(message),
    bedrooms: extractBedrooms(message),
    bathrooms: extractBathrooms(message),
    contact_preference: detectContactPreference(message),
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
  if (!next.location_any && !isSupportedLocation(next.location_text)) return false;

  return (
    prev.lead_flow !== next.lead_flow ||
    prev.operation_type !== next.operation_type ||
    prev.property_type !== next.property_type ||
    prev.location_text !== next.location_text ||
    prev.budget_max !== next.budget_max ||
    prev.bedrooms !== next.bedrooms ||
    prev.bathrooms !== next.bathrooms ||
    prev.location_any !== next.location_any ||
    prev.bedrooms_any !== next.bedrooms_any
  );
}

function setAwaitingField(state, matchedProperties) {
  const next = { ...state };

  if (next.lead_flow === 'demand') {
    if (!isSupportedLocation(next.location_text) && next.location_text) {
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

async function saveConversationState(conversationId, nextState) {
  try {
    if (!conversationId) return false;

    const { error } = await supabase
      .from('conversations')
      .update({
        ai_state: nextState,
        updated_at: new Date().toISOString(),
      })
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

async function searchProperties({
  operationType,
  location,
  minPrice = null,
  maxPrice = null,
  bedrooms = null,
  propertyType = null,
  limit = 3,
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

function formatMoney(amount, currencyCode = 'MXN') {
  if (amount == null) return 'Precio por confirmar';
  return `$${Number(amount).toLocaleString('es-MX')} ${currencyCode}`;
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

function getChangeAcknowledgement(changeType, state) {
  if (changeType === 'restart_flow') {
    if (state.lead_flow === 'offer' && state.operation_type === 'sale') {
      return 'Perfecto, ahora te apoyo con venta.';
    }
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') {
      return 'Perfecto, ahora te apoyo con poner en renta.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') {
      return 'Perfecto, ahora te apoyo con compra.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') {
      return 'Perfecto, ahora te apoyo con renta.';
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

function buildDemandReply(state, changeType, properties) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (state.location_text && !isSupportedLocation(state.location_text)) {
    return `${ack}
${state.location_text} está fuera de nuestra cobertura principal.
¿Quieres que te ayude con una zona que sí trabajamos?`;
  }

  if (properties.length > 0) {
    return `${ack}
Tengo una opción real que coincide con tu búsqueda:

${formatPropertyShort(properties[0])}

¿Quieres otra opción o prefieres que te contacte un asesor por WhatsApp?`;
  }

  const base = `${ack}
En este momento no tengo opciones exactas con esos filtros.`;

  if ((state.bedrooms === null || state.bedrooms === undefined) && !state.bedrooms_any) {
    return `${base}
¿Tienes un mínimo de recámaras?`;
  }

  return `${base}
¿Quieres que un asesor te contacte para buscar alternativas reales?`;
}

function buildOfferReply(state, changeType) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.location_text) {
    return `${ack}
¿En qué colonia o municipio está la propiedad?`;
  }

  if (state.budget_max === null || state.budget_max === undefined) {
    return `${ack}
¿Cuál es tu precio estimado de venta?`;
  }

  return `${ack}
Perfecto, con eso avanzamos.
¿Prefieres que te contacte por WhatsApp o llamada?`;
}

async function buildFallbackOpenAIReply(text, state, changeType) {
  const response = await openai.chat.completions.create({
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Estado actual:
${JSON.stringify(state, null, 2)}

Tipo de cambio detectado: ${changeType}

IMPORTANTE:
- No compartas propiedades específicas.
- No inventes resultados.
- Responde corto.
- Máximo una pregunta.
`,
      },
      { role: 'user', content: text },
    ],
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    'Perfecto. ¿Me das un poco más de contexto para ayudarte mejor?'
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
        last_message_at: new Date().toISOString(),
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
        last_message_at: new Date().toISOString(),
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

    let matchedProperties = [];

    if (shouldRunPropertySearch(previousAiState, nextAiState)) {
      console.log('Buscando propiedades reales...');
      matchedProperties = await searchProperties({
        operationType: nextAiState.operation_type,
        location: nextAiState.location_any ? null : nextAiState.location_text,
        maxPrice: nextAiState.budget_max,
        bedrooms: nextAiState.bedrooms,
        propertyType: nextAiState.property_type,
        limit: 3,
      });

      nextAiState.needs_fresh_search = false;
      nextAiState.last_search_filters = {
        operation_type: nextAiState.operation_type,
        location_text: nextAiState.location_text,
        location_any: nextAiState.location_any,
        budget_min: nextAiState.budget_min,
        budget_max: nextAiState.budget_max,
        bedrooms: nextAiState.bedrooms,
        property_type: nextAiState.property_type,
      };
      nextAiState.last_search_result_count = matchedProperties.length;
      nextAiState.last_shown_property_ids = matchedProperties.map((p) => p.id);
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

    let reply = null;

    if (nextAiState.lead_flow === 'demand') {
      reply = buildDemandReply(nextAiState, changeType, matchedProperties);
    } else if (nextAiState.lead_flow === 'offer') {
      reply = buildOfferReply(nextAiState, changeType);
    } else {
      const prevMessages = conversations.get(from) || [];

      const response = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...prevMessages,
          {
            role: 'system',
            content: `Estado actual:
${JSON.stringify(nextAiState, null, 2)}

RESULTADOS_REALES_DEL_SISTEMA: []
No hay propiedades para mostrar en este turno.
Está prohibido reutilizar propiedades viejas.
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

    const updatedMessages = [
      ...(conversations.get(from) || []),
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ];

    conversations.set(from, updatedMessages.slice(-8));

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT} 🚀`);
});