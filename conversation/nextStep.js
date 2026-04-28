function getIntentType(intent = {}, aiState = {}) {
  if (intent.intent) return intent.intent;
  if (intent.type) return intent.type;
  if (intent.leadType === 'offer') return 'supply';
  if (intent.leadType === 'demand') {
    if (
      intent.propertyCode ||
      intent.directPropertyReference ||
      aiState.direct_property_reference ||
      aiState.property_code ||
      aiState.wants_visit ||
      aiState.shows_high_interest ||
      aiState.asks_property_details
    ) {
      return 'property_interest';
    }

    return 'demand';
  }

  if (
    aiState.direct_property_reference ||
    aiState.property_code ||
    aiState.wants_visit ||
    aiState.shows_high_interest ||
    aiState.asks_property_details
  ) {
    return 'property_interest';
  }

  if (aiState.lead_flow === 'offer') return 'supply';
  if (aiState.lead_flow === 'demand') return 'demand';

  return null;
}

function getNextStep(intent = {}, aiState = {}) {
  const intentType = getIntentType(intent, aiState);

  if (intentType === 'demand') return 'qualify_search';
  if (intentType === 'property_interest') return 'push_visit';
  if (intentType === 'supply') return 'qualify_property';

  return 'clarify_intent';
}

module.exports = {
  getNextStep,
};
