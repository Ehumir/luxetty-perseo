'use strict';

const { normalizeText } = require('../../../utils/text');

/**
 * Usuario pide valuación o declara que no conoce el precio esperado (captación venta).
 * @param {string} text
 */
function isSellValuationUnknownRequest(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (/\bnecesito\s+que\s+(?:hagan|haga)\s+(?:la\s+)?valuaci[oó]n/.test(t)) return true;
  if (/\b(valuar|valuaci[oó]n|aval[uú]o)\b/.test(t) && /\b(ustedes|usted|nosotros|luxetty)\b/.test(t)) {
    return true;
  }
  if (
    /\b(no\s+se|no\s+sé|desconozco|no\s+lo\s+se|no\s+lo\s+sé)\b/.test(t) &&
    /\b(precio|valor|cuanto|cuesta|precio\s+esperado)\b/.test(t)
  ) {
    return true;
  }
  if (/\bes\s+lo\s+que\s+no\s+s[eé]\b/.test(t) && /\b(valuaci[oó]n|precio|valor)\b/.test(t)) {
    return true;
  }
  return false;
}

module.exports = {
  isSellValuationUnknownRequest,
};
