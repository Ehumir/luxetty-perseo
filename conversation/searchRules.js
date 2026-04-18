const { normalizeText } = require('../utils/text');
const { normalizeAiState } = require('./aiState');
const {
  DEMAND_MIN_SALE_MXN,
  DEMAND_MIN_RENT_MXN,
  OFFER_MIN_SALE_MXN,
  OFFER_MIN_RENT_MXN,
  CAPTURE_ALLOWED_AREAS,
} = require('../config/constants');

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

module.exports = {
  qualifiesDemandValue,
  qualifiesOfferGeo,
  qualifiesOfferValue,
  hasDemandSearchableState,
  shouldRunPropertySearch,
};