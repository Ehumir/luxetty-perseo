const { normalizeText, cleanSpaces } = require('../utils/text');

const SELLER_SCENARIOS = {
  STANDARD: 'seller_standard',
  ALREADY_LISTED: 'seller_already_listed',
  SENIOR_DOWNSIZING: 'seller_senior_downsizing',
  URGENT: 'seller_urgent',
  LEGAL_SENSITIVE: 'seller_legal_sensitive',
  OCCUPIED_PROPERTY: 'seller_occupied_property',
  INHERITANCE_SUCCESSION: 'seller_inheritance_succession',
  INVESTOR_OPPORTUNITY: 'seller_investor_opportunity',
  MISSING_DOCUMENTS: 'seller_missing_documents',
  LOCATION_SENT: 'seller_location_sent',
  DOCUMENTS_SENT: 'seller_documents_sent',
  IMAGES_SENT: 'seller_images_sent',
};

function getPrimaryScenario(scenarios = []) {
  const priority = [
    SELLER_SCENARIOS.LEGAL_SENSITIVE,
    SELLER_SCENARIOS.OCCUPIED_PROPERTY,
    SELLER_SCENARIOS.INHERITANCE_SUCCESSION,
    SELLER_SCENARIOS.ALREADY_LISTED,
    SELLER_SCENARIOS.SENIOR_DOWNSIZING,
    SELLER_SCENARIOS.URGENT,
    SELLER_SCENARIOS.INVESTOR_OPPORTUNITY,
    SELLER_SCENARIOS.MISSING_DOCUMENTS,
    SELLER_SCENARIOS.STANDARD,
  ];

  for (const scenario of priority) {
    if (scenarios.includes(scenario)) return scenario;
  }

  return null;
}

function detectListingDurationDays(rawText = '') {
  const text = normalizeText(rawText);
  if (!text) return null;

  const days = text.match(/(\d{1,4})\s*dias?/i);
  if (days?.[1]) return Number(days[1]);

  const months = text.match(/(\d{1,3})\s*mes(?:es)?/i);
  if (months?.[1]) return Number(months[1]) * 30;

  return null;
}

function classifySellerScenarios({ messageText = '', aiState = {}, media = {} } = {}) {
  const text = normalizeText(messageText || '');
  const raw = cleanSpaces(messageText || '');
  const scenarios = [];

  const isOfferFlow = aiState.lead_flow === 'offer' || aiState.intent_type === 'supply';
  if (!isOfferFlow) {
    return {
      scenarios,
      primaryScenario: null,
      legalSensitive: false,
      alreadyListed: false,
      listingDurationDays: null,
      hasDocuments: null,
      sellerSummaryFlags: {},
    };
  }

  scenarios.push(SELLER_SCENARIOS.STANDARD);

  const legalSensitiveTokens = [
    'ocupada',
    'ocupado',
    'invadida',
    'invadido',
    'despojo',
    'sin contrato',
    'arrendamiento',
    'sucesion',
    'sucesión',
    'intestado',
    'heredero',
    'herederos',
    'poder notarial',
    'registro publico',
    'registro público',
    'escritura',
    'predial',
    'infonavit',
    'juicio',
  ];

  const inheritanceTokens = ['sucesion', 'sucesión', 'intestado', 'heredero', 'herederos', 'juicio'];
  const occupiedTokens = ['ocupada', 'ocupado', 'invadida', 'invadido', 'sin contrato', 'inquilino'];

  const listedTokens = [
    'publicada',
    'publicado',
    'inmuebles24',
    'portal',
    'otras inmobiliarias',
    'sin resultados',
    'sin llamadas',
  ];

  const seniorTokens = ['tercera edad', 'adulto mayor', 'casa mas chica', 'casa más chica', 'downsizing'];
  const urgentTokens = ['urgente', 'necesito vender', 'vender rapido', 'vender rápido', 'liquidez'];
  const investorTokens = ['inversionista', 'inversor', 'oportunidad', 'barata', 'debajo del mercado'];
  const missingDocumentsTokens = ['sin papeles', 'no tengo papeles', 'sin escritura', 'falta escritura'];

  const legalSensitive = legalSensitiveTokens.some((token) => text.includes(token));
  const inheritance = inheritanceTokens.some((token) => text.includes(token));
  const occupied = occupiedTokens.some((token) => text.includes(token));
  const alreadyListed = listedTokens.some((token) => text.includes(token)) || !!aiState.works_with_realtor;
  const seniorDownsizing = seniorTokens.some((token) => text.includes(token));
  const urgent = urgentTokens.some((token) => text.includes(token)) || aiState.urgency_level === 'high';
  const investorOpportunity = investorTokens.some((token) => text.includes(token));
  const missingDocuments = missingDocumentsTokens.some((token) => text.includes(token));

  const hasDocuments =
    text.includes('tengo papeles') ||
    text.includes('tengo escritura') ||
    text.includes('tengo predial') ||
    text.includes('registro publico') ||
    text.includes('registro público')
      ? true
      : missingDocuments
      ? false
      : null;

  if (alreadyListed) scenarios.push(SELLER_SCENARIOS.ALREADY_LISTED);
  if (seniorDownsizing) scenarios.push(SELLER_SCENARIOS.SENIOR_DOWNSIZING);
  if (urgent) scenarios.push(SELLER_SCENARIOS.URGENT);
  if (legalSensitive) scenarios.push(SELLER_SCENARIOS.LEGAL_SENSITIVE);
  if (occupied || aiState.occupancy_status === 'occupied') scenarios.push(SELLER_SCENARIOS.OCCUPIED_PROPERTY);
  if (inheritance) scenarios.push(SELLER_SCENARIOS.INHERITANCE_SUCCESSION);
  if (investorOpportunity) scenarios.push(SELLER_SCENARIOS.INVESTOR_OPPORTUNITY);
  if (missingDocuments) scenarios.push(SELLER_SCENARIOS.MISSING_DOCUMENTS);
  if (aiState.location_text || /https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|maps\.google\.com|goo\.gl\/maps|waze\.com)/i.test(raw)) {
    scenarios.push(SELLER_SCENARIOS.LOCATION_SENT);
  }
  if (media?.category === 'document') scenarios.push(SELLER_SCENARIOS.DOCUMENTS_SENT);
  if (media?.type === 'image') scenarios.push(SELLER_SCENARIOS.IMAGES_SENT);

  const uniqueScenarios = Array.from(new Set(scenarios));

  return {
    scenarios: uniqueScenarios,
    primaryScenario: getPrimaryScenario(uniqueScenarios),
    legalSensitive,
    alreadyListed,
    listingDurationDays: detectListingDurationDays(raw),
    hasDocuments,
    sellerSummaryFlags: {
      inheritance,
      occupied,
      investorOpportunity,
      seniorDownsizing,
      urgent,
      missingDocuments,
    },
  };
}

module.exports = {
  SELLER_SCENARIOS,
  classifySellerScenarios,
  detectListingDurationDays,
  getPrimaryScenario,
};
