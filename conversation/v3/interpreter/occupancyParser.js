'use strict';

const { normalizeText } = require('../../../utils/text');

/** @typedef {'libre'|'habitada'|'rentada'|'ocupada'} OccupancyStatus */

/**
 * @param {string} text
 * @returns {OccupancyStatus|null}
 */
function parseOccupancyStatus(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;

  if (t === 'libre' || /\besta libre\b/.test(t) || /\bestá libre\b/.test(t)) return 'libre';
  if (t.includes('desocupad') || t.includes('sin inquilino') || t.includes('vacant')) return 'libre';
  if (t.includes('habitad') || t.includes('habitada')) return 'habitada';
  if (t.includes('ocupad') || t.includes('ocupada')) return 'ocupada';
  if (t.includes('rentad') || t.includes('rentada')) return 'rentada';

  return null;
}

/**
 * @param {OccupancyStatus|string|null} status
 */
function occupancyStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'libre') return 'libre';
  if (s === 'habitada') return 'habitada';
  if (s === 'rentada') return 'rentada';
  if (s === 'ocupada') return 'ocupada';
  return s || 'libre';
}

module.exports = {
  parseOccupancyStatus,
  occupancyStatusLabel,
};
