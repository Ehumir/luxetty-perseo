'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');

/**
 * Extrae códigos de inventario tipo LUX-A0123, A0453, etc. (patrones generales).
 * @param {string} text
 * @returns {{ raw: string, normalized: string }|null}
 */
function extractPropertyListingCode(text) {
  const rawInput = String(text || '');
  const t = normalizeText(rawInput);

  const luxDigits = t.match(/\blux[\s-]*a[\s-]*(\d{3,6})\b/i);
  if (luxDigits) {
    const raw = (rawInput.match(/\bLUX[\s-]*A[\s-]*\d{3,6}\b/i) || rawInput.match(/\blux[\s-]*a[\s-]*\d{3,6}\b/i) || [
      `LUX-A${luxDigits[1]}`,
    ])[0];
    return { raw: cleanSpaces(raw), normalized: `LUX-A${luxDigits[1]}` };
  }

  const propNear = t.match(
    /\b(?:propiedad|casa|inmueble|depto|departamento|codigo|código|clave|ref|referencia)\s+a(\d{3,6})\b/i
  );
  if (propNear) {
    return { raw: cleanSpaces(propNear[1]), normalized: `LUX-A${propNear[1]}` };
  }

  const standalone = rawInput.match(/\b(LUX[\s-]*A[\s-]*\d{3,6})\b/i);
  if (standalone) {
    const digits = standalone[0].replace(/\s+/g, '').replace(/^LUX-A/i, '');
    return { raw: cleanSpaces(standalone[0]), normalized: `LUX-A${digits}` };
  }

  const loneA = t.match(/\ba(\d{4,6})\b/i);
  if (loneA && !/\b(?:area|amp|agosto|año|ano)\b/i.test(t)) {
    return { raw: cleanSpaces(loneA[0]), normalized: `LUX-A${loneA[1]}` };
  }

  return null;
}

module.exports = {
  extractPropertyListingCode,
};
