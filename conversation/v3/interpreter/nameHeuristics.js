'use strict';

const { normalizeText } = require('../../../utils/text');
const { CONVERSATION_STAGES } = require('../types/constants');

const NON_NAME_EXACT = new Set([
  'nada',
  'no',
  'nop',
  'ya',
  'ok',
  'vale',
  'claro',
  'si',
  'sí',
  'bueno',
  'ninguno',
  'ninguna',
  'gracias',
]);

const NON_NAME_PATTERNS = [
  /ya te dije/,
  /por que preguntas/,
  /por qué preguntas/,
  /preguntas eso/,
  /no entiendes/,
  /no estas entendiendo/,
  /no estás entendiendo/,
  /\?$/,
];

/**
 * @param {string} text
 */
function isNonNameUtterance(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return true;
  if (NON_NAME_EXACT.has(t)) return true;
  if (NON_NAME_PATTERNS.some((p) => p.test(t))) return true;
  if (t.split(/\s+/).length > 4) return true;
  return false;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function isAwaitingIdentityName(state) {
  if (state.conversationStage === CONVERSATION_STAGES.IDENTITY_PENDING) return true;
  const q = String(state.lastAssistantQuestion || state.lastAssistantReply || '');
  return /c[oó]mo te llamas/i.test(q);
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} text
 * @param {{ explicitNameMatch?: boolean }} [opts]
 */
function shouldAcceptAsIdentityName(state, text, opts = {}) {
  if (state.collectedFields?.fullName) return false;
  if (opts.explicitNameMatch) return !isNonNameUtterance(text);
  if (!isAwaitingIdentityName(state)) return false;
  if (isNonNameUtterance(text)) return false;
  const raw = String(text || '').trim();
  if (!raw || /\d/.test(raw)) return false;
  if (raw.length < 2 || raw.length > 48) return false;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length > 3) return false;
  return true;
}

module.exports = {
  isNonNameUtterance,
  isAwaitingIdentityName,
  shouldAcceptAsIdentityName,
};
