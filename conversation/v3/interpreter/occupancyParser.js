'use strict';

const { normalizeText } = require('../../../utils/text');
const { isConversationalFlexEnabled } = require('../../../config/perseoM405Flags');
const { recordFlexApplied } = require('../../flexibility/flexTelemetry');

/** @typedef {'libre'|'habitada'|'rentada'|'ocupada'} OccupancyStatus */

/**
 * @param {string} text
 * @returns {OccupancyStatus|null}
 */
function parseOccupancyStatus(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;

  if (isConversationalFlexEnabled()) {
    if (/\bno\s+(?:esta|está)\s+libre\b/.test(t)) {
      recordFlexApplied('occupancy', { status: 'habitada', reason: 'negated_libre' });
      return 'habitada';
    }
    if (/\bno\s+vive\s+nadie\b/.test(t)) {
      recordFlexApplied('occupancy', { status: 'libre', reason: 'no_vive_nadie' });
      return 'libre';
    }
    if (/\b(?:esta|está)\s+desocupad/.test(t)) {
      recordFlexApplied('occupancy', { status: 'libre', reason: 'desocupada' });
      return 'libre';
    }
    if (/\b(?:la\s+)?tengo\s+rentad/.test(t)) {
      recordFlexApplied('occupancy', { status: 'rentada' });
      return 'rentada';
    }
    if (/\bvive\s+mi\s+familia\b/.test(t)) {
      recordFlexApplied('occupancy', { status: 'habitada', reason: 'vive_familia' });
      return 'habitada';
    }
    if (
      (t === 'libre' || /\b(?:esta|está)\s+libre\b/.test(t)) &&
      !/\bno\s+.*\s+libre\b/.test(t)
    ) {
      recordFlexApplied('occupancy', { status: 'libre' });
      return 'libre';
    }
    if (t.includes('desocupad') || t.includes('sin inquilino') || t.includes('vacant')) {
      recordFlexApplied('occupancy', { status: 'libre' });
      return 'libre';
    }
    if (t.includes('habitad') || t.includes('habitada')) return 'habitada';
    if (t.includes('ocupad') || t.includes('ocupada')) return 'ocupada';
    if (t.includes('rentad') || t.includes('rentada')) return 'rentada';
    return null;
  }

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
