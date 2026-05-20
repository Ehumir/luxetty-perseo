'use strict';

const { normalizeText } = require('../../../utils/text');
const { isConversationalFlexEnabled } = require('../../../config/perseoM405Flags');
const { parseFlexMoneyAmount } = require('../../flexibility/slangLexicon');
const { recordFlexApplied } = require('../../flexibility/flexTelemetry');

/**
 * @param {string} text
 * @returns {number|null}
 */
function parseMoneyAmount(text) {
  if (isConversationalFlexEnabled()) {
    const flex = parseFlexMoneyAmount(text);
    if (flex?.amount != null) {
      recordFlexApplied('money', { confidence: flex.confidence });
      return flex.amount;
    }
  }

  const t = normalizeText(text);
  const below = t.match(
    /(?:por\s+)?(?:debajo|menos)\s+de\s+(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|m\b|mdp)?/
  );
  if (below) {
    const n = Number(below[1].replace(',', '.'));
    const unit = below[2] || '';
    if (unit === 'm' || !unit || /millon/.test(unit) || unit === 'mdp') {
      return Math.round(n * 1_000_000);
    }
  }
  const mill = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|mdp)/);
  if (mill) {
    const n = Number(mill[1].replace(',', '.'));
    return Math.round(n * 1_000_000);
  }
  const mShort = t.match(/\b(\d+(?:[.,]\d+)?)\s*m\b/);
  if (mShort) return Math.round(Number(mShort[1].replace(',', '.')) * 1_000_000);
  const mdp = t.match(/\b(\d+(?:[.,]\d+)?)\s*mdp\b/);
  if (mdp) return Math.round(Number(mdp[1].replace(',', '.')) * 1_000_000);
  return null;
}

module.exports = {
  parseMoneyAmount,
};
