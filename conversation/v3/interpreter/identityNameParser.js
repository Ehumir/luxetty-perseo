'use strict';

const { cleanSpaces, normalizeText } = require('../../../utils/text');
const { isLikelyFirstNameOnly, isInvalidCompoundNameHead } = require('./identityCompoundCapture');

/**
 * Extrae nombre cuando el usuario responde con afirmación + nombre o frases compuestas.
 * @param {string} raw
 * @returns {string|null}
 */
function extractAffirmationName(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/^(?:s[ií]|ok|vale|claro|perfecto|bueno)\s*[,:\-]?\s+(.+)$/i);
  if (m) {
    let name = cleanSpaces(m[1]);
    name = name.replace(/^(?:soy|me llamo|mi nombre es)\s+/i, '').trim();
    if (isLikelyFirstNameOnly(name) && !isInvalidCompoundNameHead(name)) return name;
  }

  m = s.match(/^(.+?)\s*,\s*ya\s+te\s+dije\b/i);
  if (m && isLikelyFirstNameOnly(m[1]) && !isInvalidCompoundNameHead(m[1])) {
    return cleanSpaces(m[1]);
  }

  m = s.match(/^(?:soy|me llamo|mi nombre es)\s+(.+)$/i);
  if (m && isLikelyFirstNameOnly(m[1]) && !isInvalidCompoundNameHead(m[1])) {
    return cleanSpaces(m[1]);
  }

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 2 && normalizeText(words[0]) === 'si' && isLikelyFirstNameOnly(words[1])) {
    return cleanSpaces(words[1]);
  }

  return null;
}

module.exports = {
  extractAffirmationName,
};
