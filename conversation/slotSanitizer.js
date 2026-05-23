'use strict';

const { cleanSpaces, normalizeText } = require('../utils/text');
const { sanitizeLocationText, extractKnownZoneFromText } = require('./locationSanitizer');

const PROPERTY_DESCRIPTION_MARKERS =
  /\b(terreno|industrial|hectarea|hectárea|m2|m²|metros|deslind|topograf|servicio|nave|bodega|fraccion|fracción|escritur|document)\b/i;

function isLikelyPropertyDescription(text) {
  const t = cleanSpaces(String(text || ''));
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 12) return true;
  if (t.length > 100 && PROPERTY_DESCRIPTION_MARKERS.test(t)) return true;
  return words.length >= 8 && PROPERTY_DESCRIPTION_MARKERS.test(t);
}

function sanitizeLocationSignal(raw, prevState = {}) {
  const awaiting = prevState?.awaiting_field === 'location_text';
  const zone = extractKnownZoneFromText(raw);
  if (zone) return zone;

  const cleaned = sanitizeLocationText(raw);
  if (!cleaned) return null;

  if (!awaiting && isLikelyPropertyDescription(cleaned)) {
    return null;
  }

  if (cleaned.length > 80) {
    return awaiting ? null : cleaned.slice(0, 80);
  }

  return cleaned;
}

/**
 * Limpia señales antes de persistir en ai_state (evita slots contaminados).
 * @param {object} signals
 * @param {object} prevState
 * @returns {object}
 */
function sanitizeInboundSignals(signals = {}, prevState = {}) {
  const out = { ...(signals && typeof signals === 'object' ? signals : {}) };

  if (out.location_text != null) {
    const loc = sanitizeLocationSignal(out.location_text, prevState);
    out.location_text = loc;
    if (!loc) {
      out.matched_location_from_catalog = null;
    } else if (out.matched_location_from_catalog && String(out.matched_location_from_catalog).length > 80) {
      out.matched_location_from_catalog = loc;
    }
  }

  if (out.matched_location_from_catalog != null) {
    const cat = sanitizeLocationSignal(out.matched_location_from_catalog, prevState);
    out.matched_location_from_catalog = cat;
  }

  const awaitingRentReq = prevState?.awaiting_field === 'rental_special_requirements';
  if (out.rental_special_requirements && !awaitingRentReq && isLikelyPropertyDescription(out.rental_special_requirements)) {
    out.rental_special_requirements = null;
  }

  if (out.full_name) {
    const name = cleanSpaces(String(out.full_name)).slice(0, 80);
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length > 6 || /\d/.test(name)) {
      out.full_name = null;
    } else {
      out.full_name = name;
    }
  }

  return out;
}

module.exports = {
  sanitizeInboundSignals,
  sanitizeLocationSignal,
  isLikelyPropertyDescription,
};
