'use strict';

const { normalizeText } = require('../../utils/text');

const FLEX_CONSENT_ACCEPT = new Set([
  'sip',
  'simon',
  'simón',
  'jalo',
  'arre',
  'dale',
  'me late',
  'va',
  'ok',
  'vale',
  'sale',
  'claro',
]);

const FLEX_CONSENT_TOKEN_RE =
  /\b(?:sip|simon|simón|jalo|arre|dale|me late|va|ok|vale|sale|claro)\b/;

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeShortReply(text) {
  return normalizeText(String(text || ''))
    .replace(/[.,!?¿¡]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @returns {boolean}
 */
/**
 * Frases compuestas MX en handoff: "sale y vale, me late." → segmentos aceptación.
 * @param {string} t normalized short reply
 */
function isCompoundMxConsent(t) {
  if (!t) return false;
  if (/\bme late\b/.test(t)) return true;
  if (/\bsale\s+(?:y\s+)?vale\b/.test(t)) return true;
  if (/\bsale\b/.test(t) && /\bvale\b/.test(t)) return true;

  const segments = t
    .split(/\s+y\s+|\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2) return false;

  return segments.every((seg) => {
    if (FLEX_CONSENT_ACCEPT.has(seg)) return true;
    if (/\bme late\b/.test(seg)) return true;
    return FLEX_CONSENT_TOKEN_RE.test(seg) && seg.split(/\s+/).every((w) => FLEX_CONSENT_ACCEPT.has(w) || w === 'late');
  });
}

function isFlexConsentAccept(text) {
  const t = normalizeShortReply(text);
  if (!t) return false;
  if (FLEX_CONSENT_ACCEPT.has(t)) return true;
  if (/^(si|sí)(\s+porfa)?$/.test(t)) return true;
  if (/^si\s+por\s+favor$/.test(t)) return true;
  if (isCompoundMxConsent(t)) return true;
  if (FLEX_CONSENT_TOKEN_RE.test(t) && t.length <= 48 && !/\bno\s+quiero\b/.test(t)) {
    const hits = (t.match(new RegExp(FLEX_CONSENT_TOKEN_RE.source, 'g')) || []).length;
    if (hits >= 1 && (/\bme late\b/.test(t) || /\bsale\b/.test(t) || hits >= 2)) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isFlexShortAck(text) {
  return isFlexConsentAccept(text);
}

module.exports = {
  isFlexConsentAccept,
  isFlexShortAck,
  normalizeShortReply,
};
