'use strict';

const { cleanSpaces } = require('../../../utils/text');

/**
 * @param {string} text
 * @returns {{ text: string, index: number }[]}
 */
function segmentMessage(text) {
  const rawInput = String(text || '');
  if (!rawInput.trim()) return [];

  const lineParts = rawInput
    .split(/\n+/)
    .map((p) => cleanSpaces(p))
    .filter(Boolean);
  if (lineParts.length > 1) {
    return lineParts.map((p, index) => ({ text: p, index }));
  }

  const raw = cleanSpaces(rawInput);
  if (!raw) return [];

  const parts = raw
    .split(/\n+|(?:\.\s+)(?=[¿A-Z])|(?:;\s+)|(?:\s+y\s+también\s+)|(?:\s+también\s+)/i)
    .map((p) => cleanSpaces(p))
    .filter(Boolean);

  if (parts.length <= 1) {
    const dual = raw.split(/\s+y\s+(?=busco|quiero|tengo|compro|comprar|vendo|vender)/i);
    if (dual.length > 1) {
      return dual.map((p, index) => ({ text: cleanSpaces(p), index }));
    }
    return [{ text: raw, index: 0 }];
  }

  return parts.map((p, index) => ({ text: p, index }));
}

module.exports = {
  segmentMessage,
};
