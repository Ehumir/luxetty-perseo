'use strict';

const { cleanSpaces, normalizeText } = require('../utils/text');

const NON_LOCATION_PATTERNS = [
  /\bfavores\b/i,
  /\bdisculp/i,
  /\bgracias\b/i,
  /\bpor favor\b/i,
  /\bok\b/i,
  /\bvale\b/i,
  /\blisto\b/i,
  /\bretomo\b/i,
  /\bhola\b/i,
  /\bme llamo\b/i,
  /\bcomision\b/i,
  /\bprecio\b/i,
  /\bcuanto\b/i,
  /\bcuánto\b/i,
];

const MAX_LOCATION_LEN = 80;

/**
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function extractKnownZoneFromText(raw) {
  try {
    const { normalizeLocationFromUserText } = require('./v3/interpreter/locationNormalizer');
    return normalizeLocationFromUserText(raw) || null;
  } catch {
    return null;
  }
}

/**
 * Evita persistir location_text basura desde inbounds no geográficos (Cuarzo 0A/0C).
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function sanitizeLocationText(raw) {
  const text = cleanSpaces(String(raw || ''));
  if (!text) return null;
  if (text.length < 3) return null;
  if (text.length > MAX_LOCATION_LEN) return null;
  const t = normalizeText(text);
  if (NON_LOCATION_PATTERNS.some((re) => re.test(t))) return null;
  if (/^\d+$/.test(t)) return null;
  const zone = extractKnownZoneFromText(text);
  if (zone) return zone;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 10) return null;
  return text;
}

module.exports = {
  sanitizeLocationText,
  extractKnownZoneFromText,
  MAX_LOCATION_LEN,
};
