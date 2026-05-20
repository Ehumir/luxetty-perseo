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
]);

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
function isFlexConsentAccept(text) {
  const t = normalizeShortReply(text);
  if (!t) return false;
  if (FLEX_CONSENT_ACCEPT.has(t)) return true;
  if (/^(si|sí)(\s+porfa)?$/.test(t)) return true;
  if (/^si\s+por\s+favor$/.test(t)) return true;
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
