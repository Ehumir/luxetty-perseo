'use strict';

const { normalizeText } = require('../../../utils/text');
const { isSellValuationUnknownRequest } = require('./sellValuationSignals');

/**
 * Propietario (venta o renta) sin precio conocido o pide orientación de precio/renta.
 * @param {string} text
 */
function isOfferValuationUnknownRequest(text) {
  if (isSellValuationUnknownRequest(text)) return true;
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (/\bno\s+tengo\s+precio\b/.test(t)) return true;
  if (/\b(?:cu[aá]nto\s+pedir|cuanto\s+pedir|cu[aá]nto\s+cobrar|cuanto\s+cobrar)\b/.test(t)) return true;
  if (
    /\b(?:cu[aá]nto\s+vale|cuanto\s+vale|saber\s+cu[aá]nto\s+vale)\b/.test(t) &&
    /\b(?:mi\s+)?(?:casa|propiedad|inmueble|depa|departamento)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Intención inicial de captación por valuación (sin "quiero vender" explícito).
 * @param {string} text
 */
function isSellValuationLeadIntent(text) {
  const t = normalizeText(String(text || ''));
  return (
    /\b(?:cu[aá]nto\s+vale|cuanto\s+vale|saber\s+cu[aá]nto\s+vale)\b/.test(t) &&
    /\b(?:mi\s+)?(?:casa|propiedad|inmueble)\b/.test(t)
  );
}

module.exports = {
  isOfferValuationUnknownRequest,
  isSellValuationLeadIntent,
};
