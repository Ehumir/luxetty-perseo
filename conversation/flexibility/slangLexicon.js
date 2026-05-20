'use strict';

const { normalizeText } = require('../../utils/text');

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasPropertyMoneyContext(text) {
  const t = normalizeText(text);
  return /\b(casa|depa|depto|departamento|precio|presupuesto|vale|vender|comprar|renta|rentar|inmueble|propiedad|millon|millón|mdp|melones|bolas|busco|quiero)\b/.test(
    t,
  );
}

/**
 * @param {string} text
 * @param {{ propertyContext?: boolean }} [options]
 * @returns {{ amount: number|null, confidence: 'high'|'medium'|'ambiguous' }|null}
 */
function parseFlexMoneyAmount(text, options = {}) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;

  const slangUnit = t.match(/\b(\d+(?:[.,]\d+)?)\s*(mdp|melones|bolas)\b/);
  if (slangUnit) {
    const n = Number(slangUnit[1].replace(',', '.'));
    return { amount: Math.round(n * 1_000_000), confidence: 'high' };
  }

  const millAprox = t.match(
    /\b(\d+(?:[.,]\d+)?)\s*(millones|millon|millón)\s+(?:aprox|aproximadamente)\b/,
  );
  if (millAprox) {
    const n = Number(millAprox[1].replace(',', '.'));
    return { amount: Math.round(n * 1_000_000), confidence: 'high' };
  }

  const hastaMax = t.match(/\b(?:max|hasta)\s+(\d{1,2})(?:\s*(millones|millon|millón|mdp|m\b))?\b/);
  if (hastaMax) {
    const n = Number(hastaMax[1]);
    const unit = hastaMax[2] || '';
    if (n >= 1 && n <= 99 && (!unit || /millon|mdp|^m$/.test(unit) || options.propertyContext || hasPropertyMoneyContext(t))) {
      return { amount: Math.round(n * 1_000_000), confidence: 'high' };
    }
  }

  const standaloneSoft = t.match(/^(?:unos|como|max|hasta)\s+(\d{1,2})$/);
  if (standaloneSoft) {
    const n = Number(standaloneSoft[1]);
    if (n >= 1 && n <= 99) {
      return { amount: Math.round(n * 1_000_000), confidence: 'medium' };
    }
  }

  const softLead = t.match(/\b(?:unos|como)\s+(\d{1,2})\b/);
  if (softLead) {
    const n = Number(softLead[1]);
    if (n >= 1 && n <= 99) {
      const inCtx = options.propertyContext === true || hasPropertyMoneyContext(t);
      if (inCtx) return { amount: Math.round(n * 1_000_000), confidence: 'medium' };
      return { amount: null, confidence: 'ambiguous' };
    }
  }

  const bareSmall = t.match(/^\s*(\d{1,2})\s*$/);
  if (bareSmall && options.propertyContext === true) {
    const n = Number(bareSmall[1]);
    if (n >= 1 && n <= 99) {
      return { amount: Math.round(n * 1_000_000), confidence: 'medium' };
    }
  }

  return null;
}

module.exports = {
  parseFlexMoneyAmount,
  hasPropertyMoneyContext,
};
