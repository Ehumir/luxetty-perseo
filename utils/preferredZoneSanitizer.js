'use strict';

const { normalizeText } = require('./text');

/** Valores que no son zonas geográficas (canales, placeholders QA, etc.). */
const INVALID_ZONE_NORMALIZED = new Set([
  'whatsapp',
  'whats app',
  'qa',
  'unknown',
  'n/a',
  'na',
  'null',
  'undefined',
  'sms',
  'email',
  'telefono',
  'phone',
  'canal',
  'channel',
  'test',
  'prueba',
  'none',
  'sin zona',
]);

/**
 * @param {string|null|undefined} locationText
 * @returns {boolean}
 */
function isValidPreferredZoneLocation(locationText) {
  const raw = String(locationText || '').trim();
  if (!raw || raw.length < 2) return false;

  const norm = normalizeText(raw);
  if (!norm || norm.length < 2) return false;
  if (INVALID_ZONE_NORMALIZED.has(norm)) return false;
  if (/^whatsapp$/i.test(raw.replace(/\s+/g, ''))) return false;

  return true;
}

/**
 * @param {{ location_text?: string|null }} aiState
 * @returns {string[]|null}
 */
function preferredZonesFromAiState(aiState) {
  const lt = aiState?.location_text;
  if (!isValidPreferredZoneLocation(lt)) return null;
  return [String(lt).trim()];
}

module.exports = {
  isValidPreferredZoneLocation,
  preferredZonesFromAiState,
  INVALID_ZONE_NORMALIZED,
};
