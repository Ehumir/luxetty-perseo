'use strict';

const { normalizeText } = require('../../../utils/text');

/**
 * Normalización ligera de typos/abreviaciones MX (V1, sin PRE-engine).
 * @param {string} text
 * @returns {string}
 */
function normalizeConversationalTypos(text) {
  let t = String(text || '');
  if (!t.trim()) return t;

  t = t.replace(/\bx\s+(cumbres|cumpres|cunbres)\b/gi, 'por $1');
  t = t.replace(/\bx\s+([a-záéíóúñ]{4,})\b/gi, 'por $1');

  const lower = normalizeText(t);
  const replacements = [
    [/\bkiero\b/g, 'quiero'],
    [/\bocupo\b/g, 'busco'],
    [/\bando\s+buscando\b/g, 'busco'],
    [/\btranqui\b/g, 'tranquilo'],
    [/\bnop\b/g, 'no'],
  ];
  let out = lower;
  for (const [re, rep] of replacements) {
    out = out.replace(re, rep);
  }

  if (out !== lower) {
    return out;
  }
  return t;
}

/** Tokens de ACK conversacional (V1, siempre activos). */
const HUMAN_ACK_EXACT = new Set([
  'ok',
  'va',
  'vale',
  'sip',
  'si',
  'sí',
  'claro',
  'dale',
  'jalo',
  'listo',
  'bueno',
  'genial',
  'super',
  'súper',
  'excelente',
  'perfecto',
  'entendido',
  'de acuerdo',
  'gracias',
  'muchas gracias',
  'me parece bien',
  'me parece muy bien',
]);

const HUMAN_ACK_RE =
  /^(?:gracias|muchas\s+gracias|ok|vale|perfecto|excelente|genial|va|listo|de\s+acuerdo|bien|si|sí|dale|jalo|entendido|super|súper|sip)(?:\s+gracias)?$/i;

const EMOJI_ACK_RE = /^[\s👍👌🙏✅]+$/u;

/**
 * @param {string} text
 * @returns {boolean}
 */
function isHumanShortAck(text) {
  const t = normalizeText(String(text || ''))
    .replace(/[.,!?¿¡]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (EMOJI_ACK_RE.test(String(text || '').trim())) return true;
  if (HUMAN_ACK_EXACT.has(t)) return true;
  if (HUMAN_ACK_RE.test(t)) return true;
  const { isFlexConsentAccept } = require('../../flexibility/shortReplyLexicon');
  if (isFlexConsentAccept(text)) return true;
  return false;
}

module.exports = {
  normalizeConversationalTypos,
  isHumanShortAck,
};
