'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { parseMoneyAmount } = require('./v3/interpreter/moneyParser');
const { normalizeLocationFromUserText } = require('./v3/interpreter/locationNormalizer');
const { isShortPostCloseAck } = require('./v3/interpreter/objectionClassifier');

const NO_REOPEN_ACK = /^(?:gracias|muchas\s+gracias|ok|vale|perfecto|excelente|genial|va|listo|de\s+acuerdo|bien|si|sí|sale|👍|thumbs\s+up)(?:\s+gracias)?$/i;

const COMMERCIAL_INTENT =
  /\b(busco|quiero|necesito|me interesa|tambien|también|revisar|ver opciones|comprar|rentar|vender|presupuesto|recamaras|recámaras|otra\s+zona|otra\s+propiedad)\b/i;

/**
 * @param {object} aiState — V3 state or legacy ai_state shape
 */
function stripClosurePunct(text) {
  return normalizeText(String(text || ''))
    .replace(/[¿?¡!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readClosureContext(aiState) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  return {
    handoffWaitingFinalConfirmation:
      s.handoffWaitingFinalConfirmation === true || s.handoff_waiting_final_confirmation === true,
    softClosePending: s.softClosePending === true || s.soft_close_pending === true,
    conversationSoftClosed: s.conversationSoftClosed === true || s.conversation_soft_closed === true,
    terminalAckClose: s.terminalAckClose === true || s.terminal_ack_close === true,
    explicitReopen: s.explicitReopen === true || s.explicit_reopen === true,
    advisorContactConsent: s.advisorContactConsent || s.advisor_contact_consent || null,
    locationText: s.locationText || s.location_text || null,
    fullName: s.collectedFields?.fullName || s.full_name || null,
  };
}

function isAdvisorConsentAccepted(aiState) {
  const c = readClosureContext(aiState).advisorContactConsent;
  return c === 'ACCEPTED' || c === 'accepted';
}

function isClosureGateActive(aiState) {
  const ctx = readClosureContext(aiState);
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  return (
    ctx.handoffWaitingFinalConfirmation ||
    ctx.softClosePending ||
    ctx.conversationSoftClosed ||
    ctx.terminalAckClose ||
    s.handoff_sent === true
  );
}

/**
 * Ack terminal tras handoff aceptado: cierra sin volver a preguntar "algo más".
 */
function isTerminalAckClose(message) {
  if (detectCommercialReopenIntent(message)) return false;
  const t = stripClosurePunct(message);
  if (!t) return false;
  if (NO_REOPEN_ACK.test(t)) return true;
  if (isShortPostCloseAck(message)) return true;
  if (/^(?:no\s+gracias|no\s+por\s+ahora|no\s+nada)$/i.test(t)) return true;
  if (/^(?:no,?\s*)?es\s+todo(?:\s+gracias)?$/i.test(t)) return true;
  if (/^(?:eso\s+)?(?:ya\s+)?seria\s+todo(?:\s+gracias)?$/i.test(t)) return true;
  if (/^(?:ya\s+)?seria\s+todo$/i.test(t)) return true;
  if (/\bseria\s+todo\b/.test(t) && !/\b(?:busco|quiero|revisar|tambien|también)\b/.test(t) && t.length <= 40) {
    return true;
  }
  if (/^nada\s+mas$/i.test(t)) return true;
  if (/^(?:listo|ya\s+no|todo\s+bien)$/i.test(t)) return true;
  if (/^(?:perfecto|listo)\s+gracias$/i.test(t)) return true;
  if (/\bes\s+todo\b/.test(t) && (/\bgracias\b/.test(t) || t.length <= 32)) return true;
  if (/\bnada\s+mas\b/.test(t)) return true;
  if (shouldTreatAsPostCloseAck(message)) return true;
  return false;
}

function detectCommercialReopenIntent(message) {
  const raw = String(message || '').trim();
  const t = normalizeText(raw);
  if (!t) return false;
  if (NO_REOPEN_ACK.test(t)) return false;
  if (isShortPostCloseAck(raw) && t.length < 28) return false;
  if (COMMERCIAL_INTENT.test(t)) return true;
  if (normalizeLocationFromUserText(raw)) return true;
  if (parseMoneyAmount(raw) != null) return true;
  if (/\b(?:garcia|garcía|cumbres|san pedro|monterrey)\b/i.test(t) && /\b(?:quiero|revisar|busco|tambien|también|me interesa)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Regla central: intención comercial nueva tras cierre suave → reopen explícito.
 * @param {string} message
 * @param {object} [aiState]
 */
function shouldExplicitlyReopenConversation(message, aiState) {
  if (!detectCommercialReopenIntent(message)) return false;
  if (!aiState || typeof aiState !== 'object') return true;
  const ctx = readClosureContext(aiState);
  if (!ctx.conversationSoftClosed && !ctx.handoffWaitingFinalConfirmation) return false;
  return true;
}

function isExplicitCommercialReopen(message, aiState) {
  return shouldExplicitlyReopenConversation(message, aiState);
}

function shouldTreatAsPostCloseAck(message) {
  const t = normalizeText(String(message || ''));
  if (!t) return false;
  if (NO_REOPEN_ACK.test(t)) return true;
  if (isShortPostCloseAck(message)) return true;
  if (/^(?:no|nada|nada\s+mas|nada\s+más|estoy\s+bien|todo\s+bien|ya\s+esta|ya\s+está)$/i.test(t)) return true;
  if (/^(?:no\s+gracias|no\s+por\s+ahora)$/i.test(t)) return true;
  return false;
}

function buildExplicitReopenStatePatch() {
  return {
    handoffWaitingFinalConfirmation: false,
    handoff_waiting_final_confirmation: false,
    softClosePending: false,
    soft_close_pending: false,
    conversationSoftClosed: false,
    conversation_soft_closed: false,
    terminalAckClose: false,
    terminal_ack_close: false,
    explicitReopen: true,
    explicit_reopen: true,
    awaitingField: null,
    awaiting_field: null,
    lastAskedField: null,
    last_asked_field: null,
  };
}

function buildSoftCloseStatePatch() {
  return {
    handoffWaitingFinalConfirmation: false,
    handoff_waiting_final_confirmation: false,
    softClosePending: false,
    soft_close_pending: false,
    conversationSoftClosed: true,
    conversation_soft_closed: true,
    explicitReopen: false,
    explicit_reopen: false,
    awaitingField: null,
    awaiting_field: null,
    lastAskedField: null,
    last_asked_field: null,
  };
}

function buildTerminalAckCloseStatePatch() {
  return {
    ...buildSoftCloseStatePatch(),
    terminalAckClose: true,
    terminal_ack_close: true,
  };
}

function buildConsentWaitingPatch(nowIso) {
  const ts = nowIso || new Date().toISOString();
  return {
    handoffCompletedAt: ts,
    handoff_completed_at: ts,
    handoffWaitingFinalConfirmation: true,
    handoff_waiting_final_confirmation: true,
    softClosePending: true,
    soft_close_pending: true,
    conversationSoftClosed: false,
    conversation_soft_closed: false,
    terminalAckClose: false,
    terminal_ack_close: false,
    lastHandoffPromptAt: ts,
    last_handoff_prompt_at: ts,
    explicitReopen: false,
    explicit_reopen: false,
    awaitingField: null,
    awaiting_field: null,
  };
}

function firstNameFromState(aiState) {
  const full = cleanSpaces(String(readClosureContext(aiState).fullName || ''));
  if (!full) return null;
  return full.split(/\s+/)[0];
}

function composeExplicitReopenReply(aiState, message) {
  const zone = normalizeLocationFromUserText(message) || readClosureContext(aiState).locationText || 'esa zona';
  const nm = firstNameFromState(aiState);
  const head = nm ? `Claro, ${nm}, retomamos.` : 'Claro, retomamos.';
  return `${head} Revisamos ${zone}. ¿Buscas comprar o rentar?`;
}

function composeSoftCloseReply() {
  return 'Con gusto. Si más adelante necesitas revisar opciones o apoyo con alguna propiedad, aquí estaré para ayudarte.';
}

function composeTerminalAckCloseReply(aiState) {
  const nm = firstNameFromState(aiState) || 'perfecto';
  return `Perfecto, ${nm}. Gracias por contactarnos.\nUn asesor de Luxetty continuará contigo por este medio.\nQue tengas excelente día.`;
}

function composeTerminalAckHoldReply() {
  return 'Con gusto. Que tengas excelente día.';
}

function composeWaitingMoreHelpReply(aiState) {
  const nm = firstNameFromState(aiState) || 'perfecto';
  return `${nm}, sin problema. ¿Hay algo más en lo que te pueda ayudar antes de cerrar por ahora?`;
}

function composeConsentAcceptedReply(aiState) {
  const nm = firstNameFromState(aiState) || 'perfecto';
  const { consentAcceptedHandoff } = require('./v3/composer/humanCopyV1');
  return consentAcceptedHandoff(nm === 'perfecto' ? null : nm);
}

/**
 * @param {{
 *   conversationId: string,
 *   message: string,
 *   previousAiState?: object,
 *   pipeline: string,
 *   saveConversationEvent?: Function,
 * }} input
 */
async function recordConversationReopened(input) {
  const payload = {
    reason: 'explicit_new_commercial_intent',
    previous_soft_closed: true,
    message: String(input.message || '').slice(0, 400),
    pipeline: input.pipeline || 'unknown',
    previous_explicit_reopen:
      input.previousAiState?.explicitReopen === true || input.previousAiState?.explicit_reopen === true,
  };
  if (typeof input.saveConversationEvent === 'function' && input.conversationId) {
    await input.saveConversationEvent(input.conversationId, 'conversation_reopened', payload);
  }
  return payload;
}

module.exports = {
  readClosureContext,
  isClosureGateActive,
  isAdvisorConsentAccepted,
  isTerminalAckClose,
  detectCommercialReopenIntent,
  shouldExplicitlyReopenConversation,
  isExplicitCommercialReopen,
  shouldTreatAsPostCloseAck,
  buildExplicitReopenStatePatch,
  buildSoftCloseStatePatch,
  buildTerminalAckCloseStatePatch,
  buildConsentWaitingPatch,
  composeExplicitReopenReply,
  composeSoftCloseReply,
  composeTerminalAckCloseReply,
  composeTerminalAckHoldReply,
  composeWaitingMoreHelpReply,
  composeConsentAcceptedReply,
  recordConversationReopened,
};
