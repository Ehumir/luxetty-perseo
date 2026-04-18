const { normalizeText, cleanSpaces } = require('../utils/text');
const { detectIntent } = require('./intent');
const { getDefaultAiState } = require('./aiState');

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
  const raw = cleanSpaces(message);

  const knownPatterns = [
    /en\s+([a-záéíóúñ\s]+)$/i,
    /por\s+([a-záéíóúñ\s]+)$/i,
    /zona\s+([a-záéíóúñ\s]+)$/i,
    /colonia\s+([a-záéíóúñ\s]+)$/i,
    /municipio\s+([a-záéíóúñ\s]+)$/i,
  ];

  for (const pattern of knownPatterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return cleanSpaces(match[1]).replace(/[.,!?]+$/g, '');
    }
  }

  const directLocations = [
    'cumbres',
    'san pedro',
    'monterrey',
    'garcia',
    'garcía',
    'carretera nacional',
    'guadalupe',
    'san nicolas',
    'san nicolás',
    'apodaca',
    'santa catarina',
  ];

  for (const loc of directLocations) {
    if (text.includes(loc)) return loc;
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
  const betterPhone =
    prevState?.awaiting_field === 'contact_number'
      ? extractPhoneNumber(message)
      : null;

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

module.exports = {
  extractPropertyType,
  extractLocation,
  extractBudgetCurrency,
  extractMaxPrice,
  extractBedrooms,
  extractBathrooms,
  detectContactPreference,
  extractPossibleName,
  detectOwnerRelation,
  extractPhoneNumber,
  detectContextualSignals,
  parseMessageSignals,
  inferUserGoal,
};