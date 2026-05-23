'use strict';

const { cleanSpaces } = require('../utils/text');
const { sanitizeLocationText } = require('./locationSanitizer');
const { isUsefulContactName } = require('../utils/helpers');
const propertyIntentResolver = require('./propertyIntentResolver');
const { isPautaConversation } = require('./pautaDetection');

function isOrganicOfferBypassEnabled() {
  return process.env.PERSEO_CRM_EXECUTE_ORGANIC_OFFER_BYPASS !== 'false';
}

function hasUsefulFullName(aiState = {}) {
  const name = cleanSpaces(String(aiState.full_name || ''));
  return name.length >= 3 && isUsefulContactName(name);
}

/**
 * Oferta orgánica (venta/renta de su propiedad) con datos mínimos — bypass allowlist controlado (Cuarzo 0C).
 * No aplica si ya hay contexto pauta/propiedad específica (eso usa pauta_property).
 */
function resolveOrganicOfferCrmContext(aiState = {}) {
  if (!aiState || typeof aiState !== 'object') {
    return { bypassEligible: false, reason: 'missing_ai_state' };
  }

  if (aiState.lead_flow !== 'offer') {
    return { bypassEligible: false, reason: 'not_offer_flow' };
  }

  if (propertyIntentResolver.isPropertySpecificConversation(aiState) && isPautaConversation(aiState)) {
    return { bypassEligible: false, reason: 'pauta_property_path' };
  }

  if (!hasUsefulFullName(aiState)) {
    return { bypassEligible: false, reason: 'missing_full_name' };
  }

  const location = sanitizeLocationText(aiState.location_text);
  if (!location) {
    return { bypassEligible: false, reason: 'missing_location' };
  }

  const op = aiState.operation_type;
  const hasCommercialIntent =
    op === 'sale' || op === 'rent' || !!cleanSpaces(String(aiState.property_type || ''));
  if (!hasCommercialIntent) {
    return { bypassEligible: false, reason: 'missing_operation_or_property_type' };
  }

  return {
    bypassEligible: true,
    reason: null,
    operation_type: op || null,
    location_text: location,
  };
}

module.exports = {
  isOrganicOfferBypassEnabled,
  resolveOrganicOfferCrmContext,
  hasUsefulFullName,
};
