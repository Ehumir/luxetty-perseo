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

/**
 * Evita persistir location_text basura desde inbounds no geográficos (Cuarzo 0A).
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
function sanitizeLocationText(raw) {
  const text = cleanSpaces(String(raw || ''));
  if (!text) return null;
  if (text.length < 3) return null;
  const t = normalizeText(text);
  if (NON_LOCATION_PATTERNS.some((re) => re.test(t))) return null;
  if (/^\d+$/.test(t)) return null;
  return text;
}

module.exports = {
  sanitizeLocationText,
};
