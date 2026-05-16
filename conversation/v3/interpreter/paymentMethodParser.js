'use strict';

const { normalizeText } = require('../../../utils/text');

/**
 * @param {string} text
 * @returns {'credit'|'cash'|'unknown'|null}
 */
function parsePaymentMethod(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;
  if (/\b(con\s+)?credito\b/.test(t) || /\bhipotec/.test(t) || /\bfinanciad/.test(t)) return 'credit';
  if (/\bde\s+contado\b/.test(t) || (/\bcontado\b/.test(t) && !/\bcredito\b/.test(t))) return 'cash';
  return null;
}

module.exports = {
  parsePaymentMethod,
};
