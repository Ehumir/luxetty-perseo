'use strict';

const { normalizeText } = require('../../../utils/text');
const { CONVERSATION_GOALS } = require('../types/constants');
const { normalizeLocationFromUserText } = require('./locationNormalizer');

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
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 */
function shouldAcceptQualificationLocationTurn(state, raw) {
  if (!isQualificationFlow(state) || state.locationText) return false;

  const loc = normalizeLocationFromUserText(raw);
  if (!loc) return false;

  const t = normalizeText(String(raw || ''));
  if (state.awaitingField === 'location_text') return true;

  const q = normalizeText(
    String(state.lastAssistantQuestion || state.lastAssistantReply || '')
  );
  if (/zona|ubicad|colonia|municipio|cumbres|garcia|garc[ií]a|propiedad/.test(q)) return true;

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
