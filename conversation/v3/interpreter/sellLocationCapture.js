'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { CONVERSATION_GOALS } = require('../types/constants');
const { normalizeLocationFromUserText } = require('./locationNormalizer');
const { extractLooseLocationPhrase } = require('./campaignIntake');

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function isSellFlow(state) {
  return state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY || state.leadFlow === 'offer';
}

function isQualificationFlow(state) {
  return !!(
    state.conversationGoal &&
    (state.conversationGoalLocked || state.leadFlow || state.conversationGoal)
  );
}

/**
 * Evita tomar un nombre propio (ej. "Jorge") como colonia cuando el asistente acaba de pedir nombre.
 * @param {string} t texto normalizado (normalizeText)
 */
function hasLocationStructuralHint(t) {
  if (/^no,/.test(t) || /^nop,/.test(t)) return true;
  if (/\bbusco\s+en\b/.test(t)) return true;
  if (
    /\b(esta en|que en|no en|ubicad|ubicada|municipio|colonia|\bzona\b|queda|localizada|localizado|se encuentra)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (t.includes('cumbres')) return true;
  if (/\b(en san|en garcia|en mitras|en sur|en norte|en valle)\b/.test(t)) return true;
  return false;
}

function isBuyFlow(state) {
  return state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 */
function shouldAcceptQualificationLocationTurn(state, raw) {
  if (!isQualificationFlow(state) || state.locationText) return false;

  /**
   * PROPERTY_INQUIRY solo califica código + nombre; no hay slot `location_text`.
   * Si el asistente menciona "zona" en modo Q&A, no debemos tomar "¿dónde está?" / "¿precio?"
   * como colonia del lead (provoca LOCATION_CAPTURE y el menú genérico en bucle).
   */
  if (state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY) {
    return state.awaitingField === 'location_text';
  }

  const loc = normalizeLocationFromUserText(raw);
  if (!loc) return false;

  const t = normalizeText(String(raw || ''));
  const q = normalizeText(
    String(state.lastAssistantQuestion || state.lastAssistantReply || '')
  );
  const namePrompt = /compartes tu nombre|qui[eé]n tengo el gusto|me ayudas con tu nombre|nombre para continuar/i.test(
    q,
  );

  // Tras pedir nombre (F2 sin awaiting_field): no tomar "Jorge" como colonia.
  if (namePrompt && !state.collectedFields?.fullName && !hasLocationStructuralHint(t)) {
    return false;
  }

  if (state.awaitingField === 'location_text') return true;

  if (isBuyFlow(state) && (/\bbusco\s+en\b/.test(t) || state.awaitingField === 'location_text')) {
    return true;
  }

  if (
    /zona|ubicad|colonia|municipio|cumbres|garcia|garc[ií]a|propiedad|compartes tu nombre|qui[eé]n tengo el gusto|nombre para continuar/i.test(
      q
    )
  ) {
    return true;
  }

  if (/\b(en|esta en|está en|que en|no en)\b/.test(t)) return true;
  if (t.includes('cumbres') || t.includes('zona') || t.includes('colonia') || t.includes('municipio')) {
    return true;
  }

  return false;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 */
function shouldAcceptSellLocationTurn(state, raw) {
  return shouldAcceptQualificationLocationTurn(state, raw) && isSellFlow(state);
}

function tryParseQualificationLocation(state, raw) {
  if (!shouldAcceptQualificationLocationTurn(state, raw)) return null;
  if (isBuyFlow(state)) {
    return (
      extractLooseLocationPhrase(raw) ||
      normalizeLocationFromUserText(raw) ||
      (state.awaitingField === 'location_text' ? cleanSpaces(String(raw || '')).slice(0, 120) : null)
    );
  }
  return normalizeLocationFromUserText(raw);
}

function tryParseSellLocation(state, raw) {
  if (!shouldAcceptSellLocationTurn(state, raw)) return null;
  return normalizeLocationFromUserText(raw);
}

module.exports = {
  isSellFlow,
  isQualificationFlow,
  shouldAcceptQualificationLocationTurn,
  shouldAcceptSellLocationTurn,
  tryParseQualificationLocation,
  tryParseSellLocation,
};
