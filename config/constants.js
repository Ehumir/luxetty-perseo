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

module.exports = {
  LOCATION_CACHE_TTL_MS,
  MAX_SHORT_MEMORY_MESSAGES,
  DEFAULT_PROPERTY_LIMIT,
  SEARCH_BUDGET_FALLBACK_MULTIPLIER,
  DEMAND_MIN_SALE_MXN,
  DEMAND_MIN_RENT_MXN,
  OFFER_MIN_SALE_MXN,
  OFFER_MIN_RENT_MXN,
  CAPTURE_ALLOWED_AREAS,
};