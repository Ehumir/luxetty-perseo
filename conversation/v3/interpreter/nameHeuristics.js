'use strict';

const { normalizeText } = require('../../../utils/text');
const { CONVERSATION_STAGES } = require('../types/constants');
const { isLikelyFirstNameOnly } = require('./identityCompoundCapture');

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
  'va',
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
 * Tonos Luxetty: reconoce solicitud de nombre profesional (no "¿cómo te llamo/llamas?").
 * @param {import('../types/conversationState').ConversationState} state
 */
function isAwaitingIdentityName(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.awaitingField === 'full_name') return true;
  if (state.conversationStage === CONVERSATION_STAGES.IDENTITY_PENDING) return true;
  const q = String(state.lastAssistantQuestion || state.lastAssistantReply || '');
  return (
    /compartes tu nombre|comparte tu nombre/i.test(q) ||
    /qui[eé]n tengo el gusto/i.test(q) ||
    /me ayudas con tu nombre/i.test(q) ||
    /para continuar.*compartes tu nombre/i.test(q) ||
    /me compartes tu nombre/i.test(q)
  );
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} text
 * @param {{ explicitNameMatch?: boolean }} [opts]
 */
function shouldAcceptAsIdentityName(state, text, opts = {}) {
  if (state.collectedFields?.fullName) return false;
  if (opts.explicitNameMatch) return !isNonNameUtterance(text);
  if (!isAwaitingIdentityName(state) && !isHandoffPendingMissingName(state)) return false;
  if (isNonNameUtterance(text)) return false;
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\bwhatsapp\b|por\s+whatsapp|por\s+wa\b/i.test(raw)) return false;
  if (!isLikelyFirstNameOnly(raw)) return false;
  return true;
}

/**
 * Durante handoff pendiente el usuario puede responder con su nombre antes del consentimiento explícito.
 */
function isHandoffPendingMissingName(state) {
  if (!state || state.collectedFields?.fullName) return false;
  const stage = state.conversationStage || state.handoffStage;
  if (stage !== CONVERSATION_STAGES.HANDOFF_PENDING) return false;
  if (state.awaitingField === 'advisor_contact_consent') return true;
  return state.advisorContactConsent === 'REQUESTED';
}

module.exports = {
  isNonNameUtterance,
  isAwaitingIdentityName,
  isHandoffPendingMissingName,
  shouldAcceptAsIdentityName,
};
