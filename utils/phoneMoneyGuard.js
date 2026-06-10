'use strict';

const { normalizeText } = require('./text');

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function hasMoneyContext(text) {
  const t = normalizeText(text);
  return (
    /\$|mxn|pesos|mdp|millon|millones|presupuesto|renta\s+mensual|mensualidad|hasta|mil\b/.test(t)
  );
}

function isPhoneLikeBudgetDigits(value) {
  const digits = digitsOnly(value);
  if (!digits) return false;
  if (/^521[1-9]\d{9}$/.test(digits)) return true;
  if (/^52[1-9]\d{9}$/.test(digits)) return true;
  if (/^[1-9]\d{9}$/.test(digits)) return true;
  return false;
}

function stripPhoneLabeledSegments(message) {
  let text = String(message || '');
  text = text.replace(
    /(?:^|[\n\r]|[•●▪]\s*)[\p{L}\p{N}_]*(?:telefono|tel[eé]fono|phone|celular|whatsapp)[\p{L}\p{N}_]*\s*:\s*\+?[\d\s\-()]{10,}/giu,
    '\n',
  );
  return text;
}

/**
 * True when the utterance is primarily a phone number, not a budget amount.
 * @param {string} text
 * @returns {boolean}
 */
function isPhoneLikeText(text) {
  if (!text || typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  const digits = digitsOnly(raw);
  if (digits.length === 0) return false;

  const stripped = raw.replace(/[\s\-()+]/g, '');
  const looksLikePhoneToken = /^\+?\d{10,15}$/.test(stripped);

  if (looksLikePhoneToken && !hasMoneyContext(raw)) return true;

  if (!hasMoneyContext(raw)) {
    if (digits.length === 10 && /^[1-9]\d{9}$/.test(digits)) return true;
    if (digits.length === 12 && /^52[1-9]\d{9}$/.test(digits)) return true;
    if (digits.length === 13 && /^521[1-9]\d{9}$/.test(digits)) return true;
  }

  return false;
}

module.exports = {
  digitsOnly,
  hasMoneyContext,
  isPhoneLikeText,
  isPhoneLikeBudgetDigits,
  stripPhoneLabeledSegments,
};
