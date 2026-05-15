'use strict';

const { cleanSpaces, normalizeText } = require('../../../utils/text');

/**
 * Extrae zona/colonia desde frases tipo "Está en San Pedro".
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeLocationFromUserText(raw) {
  let t = cleanSpaces(String(raw || ''));
  if (!t) return null;

  // Corrección conversacional: "No, está en San Pedro" → zona San Pedro
  t = t.replace(/^(?:no|nop|nope)[,\s]+/i, '').trim();

  const lower = normalizeText(t);
  if (lower.includes('cumbres')) return 'Cumbres';

  const queEn = t.match(/\bque\s+en\s+(.+)$/i);
  if (queEn && queEn[1]) {
    t = cleanSpaces(queEn[1]);
  }

  const prefixPatterns = [
    /^(?:no,?\s*)?(?:esta|está|ubicada|ubicado|queda|se encuentra|localizada|localizado)\s+en\s+(.+)$/i,
    /^(?:en|la zona es|zona|colonia|municipio)\s+(.+)$/i,
    /^(?:es|seria|sería)\s+en\s+(.+)$/i,
  ];

  for (const pattern of prefixPatterns) {
    const m = t.match(pattern);
    if (m && m[1]) {
      t = cleanSpaces(m[1]);
      break;
    }
  }

  t = t.replace(/^(?:la|el|los|las)\s+/i, '').trim();
  if (!t) return null;
  if (t.length > 120) t = t.slice(0, 120);

  return t;
}

module.exports = {
  normalizeLocationFromUserText,
};
