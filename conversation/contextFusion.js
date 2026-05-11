const { normalizeText, cleanSpaces } = require('../utils/text');

function toNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBudgetMax(text = '') {
  const normalized = normalizeText(text || '');

  const spanishNumbers = {
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    veinte: 20,
    treinta: 30,
    cuarenta: 40,
    cincuenta: 50,
    sesenta: 60,
    setenta: 70,
    ochenta: 80,
    noventa: 90,
    cien: 100,
  };

  const decimalMillionsMatch = normalized.match(/\b(\d+(?:[\.,]\d+)?)\s*(millones|millon|m)\b/i);
  if (decimalMillionsMatch?.[1]) {
    const value = Number(decimalMillionsMatch[1].replace(',', '.'));
    if (Number.isFinite(value)) return Math.round(value * 1000000);
  }

  const thousandsMatch = normalized.match(/\b(\d+(?:[\.,]\d+)?)\s*mil\b/i);
  if (thousandsMatch?.[1]) {
    const value = Number(thousandsMatch[1].replace(',', '.'));
    if (Number.isFinite(value)) return Math.round(value * 1000);
  }

  const wordMillionsMatch = normalized.match(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\s+(millones|millon)\b/i);
  if (wordMillionsMatch?.[1]) {
    const value = spanishNumbers[wordMillionsMatch[1]];
    if (Number.isFinite(value)) return Math.round(value * 1000000);
  }

  const wordThousandsMatch = normalized.match(/\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\s+mil\b/i);
  if (wordThousandsMatch?.[1]) {
    const value = spanishNumbers[wordThousandsMatch[1]];
    if (Number.isFinite(value)) return Math.round(value * 1000);
  }

  const currencyMatch = normalized.match(/\$?\s*(\d{4,9}(?:[\.,]\d{1,2})?)\s*(mxn|pesos|usd|dolares|dolares)?/i);
  if (currencyMatch?.[1]) {
    const value = Number(currencyMatch[1].replace(/,/g, ''));
    if (Number.isFinite(value)) return Math.round(value);
  }

  return null;
}

function parseBedrooms(text = '') {
  const normalized = normalizeText(text || '');
  const match = normalized.match(/(\d+)\s*(recamaras|recamara|habitaciones|habitacion)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function parseBathrooms(text = '') {
  const normalized = normalizeText(text || '');
  const match = normalized.match(/(\d+)\s*(banos|bano)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function parseParkingSpaces(text = '') {
  const normalized = normalizeText(text || '');
  const match = normalized.match(/(\d+)\s*(cocheras|cochera|cajones|estacionamientos)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function detectOperationForDemand(text = '', previousAiState = {}) {
  const normalized = normalizeText(text || '');

  if (
    normalized.includes('renta') ||
    normalized.includes('rentar') ||
    previousAiState?.operation_type === 'rent'
  ) {
    return 'renta';
  }

  if (
    normalized.includes('comprar') ||
    normalized.includes('compra') ||
    previousAiState?.operation_type === 'sale'
  ) {
    return 'compra';
  }

  return null;
}

function detectOperationForOffer(text = '', previousAiState = {}) {
  const normalized = normalizeText(text || '');

  if (
    normalized.includes('rentar mi') ||
    normalized.includes('poner en renta') ||
    normalized.includes('quiero rentar mi') ||
    (previousAiState?.lead_flow === 'offer' && previousAiState?.operation_type === 'rent')
  ) {
    return 'renta';
  }

  if (
    normalized.includes('vender') ||
    normalized.includes('venta') ||
    (previousAiState?.lead_flow === 'offer' && previousAiState?.operation_type === 'sale')
  ) {
    return 'venta';
  }

  return null;
}

function detectPropertyType(text = '', fallback = null) {
  const normalized = normalizeText(text || '');
  if (normalized.includes('casa')) return 'house';
  if (normalized.includes('departamento') || normalized.includes('depa')) return 'apartment';
  if (normalized.includes('terreno') || normalized.includes('lote')) return 'land';
  if (normalized.includes('oficina')) return 'office';
  if (normalized.includes('local')) return 'commercial';
  if (normalized.includes('bodega')) return 'warehouse';
  return fallback || null;
}

function detectZone(text = '', previousAiState = {}) {
  const normalized = normalizeText(text || '');
  const known = [
    'cumbres',
    'san pedro',
    'monterrey',
    'garcia',
    'guadalupe',
    'san nicolas',
    'apodaca',
    'santa catarina',
    'carretera nacional',
  ];

  for (const item of known) {
    if (normalized.includes(item)) return item;
  }

  return previousAiState?.location_text || null;
}

function buildSourceSignals({
  inboundText,
  caption,
  audioTranscription,
  imageVision,
  location,
  interactive,
  campaignContext,
  propertyContext,
  existingLead,
}) {
  return {
    hasText: !!cleanSpaces(inboundText || ''),
    hasCaption: !!cleanSpaces(caption || ''),
    hasAudioTranscription: !!cleanSpaces(audioTranscription || ''),
    hasImageVision: !!imageVision,
    hasLocation: !!location,
    hasInteractive: !!interactive,
    hasCampaignContext: !!campaignContext,
    hasPropertyContext: !!propertyContext,
    hasExistingLead: !!existingLead,
  };
}

function chooseEffectiveText({ inboundText, caption, audioTranscription, interactive, previousAiState }) {
  const candidates = [
    cleanSpaces(inboundText || ''),
    cleanSpaces(audioTranscription || ''),
    cleanSpaces(caption || ''),
    cleanSpaces(interactive?.text || interactive?.title || interactive?.id || ''),
  ].filter(Boolean);

  const effective = candidates.slice(0, 2).join(' ').trim();

  if (effective) return effective;

  if (previousAiState?.awaiting_field === 'location_text') {
    return 'comparto ubicacion de la propiedad';
  }

  return '';
}

function detectIntentCategory({ effectiveText, sourceSignals, previousAiState, campaignContext, propertyContext }) {
  const text = normalizeText(effectiveText || '');

  if (!text && previousAiState?.lead_flow === 'offer') {
    return {
      category: 'sell_property',
      confidence: 0.58,
      source: sourceSignals.hasLocation ? 'location' : 'history',
      requiresHumanAdvisor: false,
      userAcceptedAdvisor: false,
    };
  }

  if (!text && previousAiState?.lead_flow === 'demand') {
    return {
      category: 'buy_property',
      confidence: 0.58,
      source: sourceSignals.hasLocation ? 'location' : 'history',
      requiresHumanAdvisor: false,
      userAcceptedAdvisor: false,
    };
  }

  if (!text && !sourceSignals.hasCampaignContext && !sourceSignals.hasPropertyContext) {
    return {
      category: 'unknown',
      confidence: 0.2,
      source: sourceSignals.hasImageVision ? 'image_context' : 'history',
      requiresHumanAdvisor: false,
      userAcceptedAdvisor: false,
    };
  }

  const userAcceptedAdvisor =
    text.includes('si') &&
    (
      text.includes('asesor') ||
      text.includes('contacte') ||
      text.includes('llam')
    );

  const requiresHumanAdvisor =
    userAcceptedAdvisor ||
    text.includes('asesor') ||
    text.includes('agente') ||
    text.includes('valuacion') ||
    text.includes('valuacion');

  const source =
    sourceSignals.hasAudioTranscription
      ? 'audio'
      : sourceSignals.hasCaption
      ? 'caption'
      : sourceSignals.hasText
      ? 'text'
      : sourceSignals.hasInteractive
      ? 'interactive'
      : sourceSignals.hasLocation
      ? 'location'
      : sourceSignals.hasImageVision
      ? 'image_context'
      : (sourceSignals.hasCampaignContext || sourceSignals.hasPropertyContext)
      ? 'history'
      : 'mixed';

  if (text.includes('no me interesa') || text.includes('ya no gracias') || text.includes('no gracias')) {
    return {
      category: 'not_interested',
      confidence: 0.95,
      source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (
    text.includes('quiero vender') ||
    text.includes('vender mi') ||
    text.includes('poner a la venta')
  ) {
    return {
      category: 'sell_property',
      confidence: 0.92,
      source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (
    text.includes('quiero rentar mi') ||
    text.includes('poner en renta') ||
    text.includes('rentar mi casa')
  ) {
    return {
      category: 'rent_out_property',
      confidence: 0.9,
      source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (
    text.includes('busco en renta') ||
    text.includes('busco renta') ||
    text.includes('en renta') ||
    text.includes('quiero rentar') ||
    text.includes('rentar casa')
  ) {
    return {
      category: 'rent_property',
      confidence: 0.86,
      source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (
    text.includes('busco comprar') ||
    text.includes('quiero comprar') ||
    text.includes('busco casa') ||
    text.includes('quiero una casa')
  ) {
    return {
      category: 'buy_property',
      confidence: 0.86,
      source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (
    text.includes('valuacion') ||
    text.includes('valuar') ||
    text.includes('en cuanto creen que se vende') ||
    text.includes('en cuanto se vende')
  ) {
    return {
      category: 'valuate_property',
      confidence: 0.84,
      source,
      requiresHumanAdvisor: true,
      userAcceptedAdvisor,
    };
  }

  if (text.includes('agendar visita') || text.includes('quiero verla') || text.includes('visita')) {
    return {
      category: 'visit_property',
      confidence: 0.86,
      source,
      requiresHumanAdvisor: true,
      userAcceptedAdvisor,
    };
  }

  if (
    text.includes('me interesa') ||
    text.includes('precio') ||
    text.includes('informacion') ||
    text.includes('detalles') ||
    text.includes('disponible') ||
    sourceSignals.hasCampaignContext ||
    sourceSignals.hasPropertyContext
  ) {
    return {
      category: 'ask_property_info',
      confidence: sourceSignals.hasCampaignContext || sourceSignals.hasPropertyContext ? 0.82 : 0.68,
      source: sourceSignals.hasCampaignContext || sourceSignals.hasPropertyContext ? 'mixed' : source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (requiresHumanAdvisor) {
    return {
      category: 'talk_to_advisor',
      confidence: 0.75,
      source,
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  if (previousAiState?.lead_flow === 'offer' || previousAiState?.lead_flow === 'demand') {
    return {
      category: previousAiState.lead_flow === 'offer' ? 'sell_property' : 'buy_property',
      confidence: 0.6,
      source: 'history',
      requiresHumanAdvisor,
      userAcceptedAdvisor,
    };
  }

  return {
    category: 'unknown',
    confidence: 0.35,
    source,
    requiresHumanAdvisor,
    userAcceptedAdvisor,
  };
}

function buildPropertyDemand({ effectiveText, normalizedIntent, previousAiState, propertyContext }) {
  const operation =
    normalizedIntent.category === 'rent_property'
      ? 'renta'
      : normalizedIntent.category === 'buy_property'
      ? 'compra'
      : detectOperationForDemand(effectiveText, previousAiState);

  const notes = [];

  if (propertyContext?.listing_id || propertyContext?.slug) {
    notes.push('contexto_de_propiedad_detectado');
  }

  const data = {
    operation,
    propertyType: detectPropertyType(effectiveText, previousAiState?.property_type || null),
    zone: detectZone(effectiveText, previousAiState),
    budgetMin: toNumber(previousAiState?.budget_min),
    budgetMax: parseBudgetMax(effectiveText) ?? toNumber(previousAiState?.budget_max),
    bedrooms: parseBedrooms(effectiveText) ?? toNumber(previousAiState?.bedrooms),
    bathrooms: parseBathrooms(effectiveText) ?? toNumber(previousAiState?.bathrooms),
    parkingSpaces: parseParkingSpaces(effectiveText) ?? toNumber(previousAiState?.garage_spaces),
    notes,
  };

  return data;
}

function buildPropertyOffer({ effectiveText, normalizedIntent, previousAiState, imageVision, location }) {
  const operation =
    normalizedIntent.category === 'rent_out_property'
      ? 'renta'
      : normalizedIntent.category === 'sell_property' || normalizedIntent.category === 'valuate_property'
      ? 'venta'
      : detectOperationForOffer(effectiveText, previousAiState);

  const visualSummary = cleanSpaces(imageVision?.summary || '') || null;
  const imageCondition = cleanSpaces(imageVision?.propertySignals?.apparentCondition || '') || null;
  const notes = [];

  if (visualSummary) notes.push('vision_summary_available');
  if (location?.latitude != null && location?.longitude != null) notes.push('location_attached');

  return {
    operation,
    propertyType: detectPropertyType(effectiveText, previousAiState?.property_type || null),
    zone: detectZone(effectiveText, previousAiState),
    neighborhood: previousAiState?.neighborhood_text || null,
    askingPrice: parseBudgetMax(effectiveText) ?? toNumber(previousAiState?.expected_price) ?? toNumber(previousAiState?.budget_max),
    bedrooms: parseBedrooms(effectiveText) ?? toNumber(previousAiState?.bedrooms),
    bathrooms: parseBathrooms(effectiveText) ?? toNumber(previousAiState?.bathrooms),
    parkingSpaces: parseParkingSpaces(effectiveText) ?? toNumber(previousAiState?.garage_spaces),
    condition: imageCondition || null,
    visualSummary,
    location: {
      lat: toNumber(location?.latitude),
      lng: toNumber(location?.longitude),
      name: cleanSpaces(location?.name || '') || null,
      address: cleanSpaces(location?.address || '') || null,
    },
    notes,
  };
}

function buildMissingCriticalFields({
  normalizedIntent,
  propertyDemand,
  propertyOffer,
  sourceSignals,
  previousAiState,
  campaignContext = null,
}) {
  const fields = [];
  const isOffer =
    normalizedIntent.category === 'sell_property' ||
    normalizedIntent.category === 'rent_out_property' ||
    normalizedIntent.category === 'valuate_property';
  const isDemand =
    normalizedIntent.category === 'buy_property' ||
    normalizedIntent.category === 'rent_property';

  if (isOffer) {
    const hasPropertySignal = !!(
      propertyOffer.zone ||
      propertyOffer.neighborhood ||
      propertyOffer.location.lat != null ||
      propertyOffer.location.lng != null ||
      propertyOffer.propertyType ||
      propertyOffer.askingPrice != null ||
      propertyOffer.visualSummary ||
      sourceSignals.hasCampaignContext ||
      previousAiState?.property_image_candidate
    );

    if (!hasPropertySignal) fields.push('offer_property_reference');
  }

  if (isDemand) {
    const hasDemandSignal = !!(
      propertyDemand.zone ||
      propertyDemand.budgetMax != null ||
      propertyDemand.propertyType ||
      sourceSignals.hasPropertyContext ||
      sourceSignals.hasCampaignContext
    );

    if (!hasDemandSignal) fields.push('demand_context_minimum');
  }

  if (normalizedIntent.category === 'visit_property' || normalizedIntent.category === 'ask_property_info') {
    const hasPropertyContext = !!(
      sourceSignals.hasPropertyContext ||
      sourceSignals.hasCampaignContext ||
      (campaignContext &&
        typeof campaignContext === 'object' &&
        String(campaignContext.property_code || '').trim())
    );
    if (!hasPropertyContext) fields.push('property_reference_for_visit_or_info');
  }

  if (normalizedIntent.category === 'talk_to_advisor') {
    const hasContext = !!(
      previousAiState?.lead_flow ||
      sourceSignals.hasPropertyContext ||
      sourceSignals.hasCampaignContext ||
      sourceSignals.hasText
    );
    if (!hasContext) fields.push('advisor_context_minimum');
  }

  return fields;
}

function decideCrmAction({ normalizedIntent, missingCriticalFields, existingLead, existingContact, sourceSignals }) {
  const isActionable = !['unknown', 'not_interested'].includes(normalizedIntent.category);
  const hasMissing = missingCriticalFields.length > 0;

  const leadType =
    normalizedIntent.category === 'sell_property' ||
    normalizedIntent.category === 'rent_out_property' ||
    normalizedIntent.category === 'valuate_property'
      ? 'offer'
      : normalizedIntent.category === 'buy_property' ||
        normalizedIntent.category === 'rent_property' ||
        normalizedIntent.category === 'visit_property' ||
        normalizedIntent.category === 'ask_property_info'
      ? 'demand'
      : null;

  if (!isActionable) {
    return {
      shouldCreateOrUpdateLead: false,
      shouldAskOneMoreQuestion: false,
      suggestedNextQuestion: null,
      crmAction: {
        action: 'none',
        reason: 'intent_not_actionable',
        leadType,
        priority: 'low',
      },
    };
  }

  if (normalizedIntent.category === 'not_interested') {
    return {
      shouldCreateOrUpdateLead: false,
      shouldAskOneMoreQuestion: false,
      suggestedNextQuestion: null,
      crmAction: {
        action: 'none',
        reason: 'user_not_interested',
        leadType,
        priority: 'low',
      },
    };
  }

  if (hasMissing) {
    const firstMissing = missingCriticalFields[0] || 'missing_information';
    const suggestedNextQuestion =
      firstMissing === 'offer_zone_or_location'
        ? 'Para avanzar bien, ¿en que zona o colonia se ubica la propiedad?'
        : firstMissing === 'offer_property_reference'
        ? 'Para orientarte mejor, ¿me compartes zona, tipo de inmueble o precio aproximado?'
        : firstMissing === 'demand_context_minimum'
        ? 'Para ayudarte mejor, ¿me compartes zona, presupuesto o tipo de inmueble?'
        : firstMissing === 'property_reference_for_visit_or_info'
        ? '¿Te refieres a alguna propiedad en especifico o quieres que te comparta opciones por zona?'
        : firstMissing === 'advisor_context_minimum'
        ? 'Claro, para canalizarte bien, ¿buscas comprar, rentar, vender o valuar una propiedad?'
        : 'Para continuar, ¿me compartes un dato clave de la propiedad o de tu busqueda?';

    return {
      shouldCreateOrUpdateLead: false,
      shouldAskOneMoreQuestion: true,
      suggestedNextQuestion,
      crmAction: {
        action: 'request_more_info',
        reason: firstMissing,
        leadType,
        priority: 'medium',
      },
    };
  }

  const priority =
    normalizedIntent.userAcceptedAdvisor || normalizedIntent.category === 'visit_property'
      ? 'high'
      : normalizedIntent.category === 'sell_property' || normalizedIntent.category === 'rent_out_property'
      ? 'high'
      : 'medium';

  const action = existingLead
    ? 'update_existing_lead'
    : existingContact
    ? 'create_lead'
    : sourceSignals.hasExistingLead
    ? 'link_to_existing_lead'
    : 'create_lead';

  return {
    shouldCreateOrUpdateLead: true,
    shouldAskOneMoreQuestion: false,
    suggestedNextQuestion: null,
    crmAction: {
      action,
      reason: existingLead ? 'existing_lead_context' : 'intent_sufficient_context',
      leadType,
      priority,
    },
  };
}

function decideAdvisorRouting({ normalizedIntent, existingLead, propertyContext, campaignContext }) {
  const shouldAssign = !!(
    normalizedIntent.userAcceptedAdvisor ||
    normalizedIntent.requiresHumanAdvisor ||
    normalizedIntent.category === 'visit_property' ||
    normalizedIntent.category === 'valuate_property'
  );

  if (!shouldAssign) {
    return {
      shouldAssign: false,
      preferredAgentProfileId: null,
      reason: null,
    };
  }

  const preferredAgentProfileId =
    propertyContext?.agent_profile_id ||
    campaignContext?.agent_profile_id ||
    existingLead?.assigned_agent_profile_id ||
    null;

  return {
    shouldAssign: true,
    preferredAgentProfileId,
    reason: preferredAgentProfileId ? 'property_or_existing_assignment' : 'assignment_engine_required',
  };
}

function buildUnifiedConversationContext({
  inboundText,
  caption,
  audioTranscription,
  imageVision,
  location,
  interactive,
  previousAiState,
  existingContact,
  existingLead,
  campaignContext,
  propertyContext,
  rawMessage,
  now,
} = {}) {
  const sourceSignals = buildSourceSignals({
    inboundText,
    caption,
    audioTranscription,
    imageVision,
    location,
    interactive,
    campaignContext,
    propertyContext,
    existingLead,
  });

  const effectiveText = chooseEffectiveText({
    inboundText,
    caption,
    audioTranscription,
    interactive,
    previousAiState,
  });

  const normalizedIntent = detectIntentCategory({
    effectiveText,
    sourceSignals,
    previousAiState: previousAiState || {},
    campaignContext,
    propertyContext,
  });

  const propertyDemand = buildPropertyDemand({
    effectiveText,
    normalizedIntent,
    previousAiState: previousAiState || {},
    propertyContext,
  });

  const propertyOffer = buildPropertyOffer({
    effectiveText,
    normalizedIntent,
    previousAiState: previousAiState || {},
    imageVision,
    location,
  });

  const missingCriticalFields = buildMissingCriticalFields({
    normalizedIntent,
    propertyDemand,
    propertyOffer,
    sourceSignals,
    previousAiState: previousAiState || {},
    campaignContext,
  });

  const crmDecision = decideCrmAction({
    normalizedIntent,
    missingCriticalFields,
    existingLead,
    existingContact,
    sourceSignals,
  });

  const advisorRouting = decideAdvisorRouting({
    normalizedIntent,
    existingLead,
    propertyContext,
    campaignContext,
  });

  return {
    ok: true,
    sourceSignals,
    effectiveText,
    normalizedIntent,
    propertyDemand,
    propertyOffer,
    missingCriticalFields,
    shouldCreateOrUpdateLead: crmDecision.shouldCreateOrUpdateLead,
    shouldAskOneMoreQuestion: crmDecision.shouldAskOneMoreQuestion,
    suggestedNextQuestion: crmDecision.suggestedNextQuestion,
    crmAction: crmDecision.crmAction,
    advisorRouting,
    trace: {
      generatedAt: now || new Date().toISOString(),
      hasRawMessage: !!rawMessage,
    },
  };
}

module.exports = {
  buildUnifiedConversationContext,
};
