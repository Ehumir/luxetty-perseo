'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { createEmptyDecision } = require('../types/conversationDecision');
const { CONVERSATION_STAGES } = require('../types/constants');

/**
 * Intérprete **mock** solo para tests y harness (F1). Sin OpenAI.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} text
 * @returns {{ patch: Partial<import('../types/conversationState').ConversationState>, decision: import('../types/conversationDecision').ConversationDecision }}
 */
function interpretUserTextMock(state, text) {
  const t = normalizeText(String(text || ''));
  const raw = cleanSpaces(String(text || ''));
  const decision = createEmptyDecision();
  /** @type {Partial<import('../types/conversationState').ConversationState>} */
  const patch = {};

  const wantsSell = t.includes('vender') || t.includes('venta') || t.includes('captacion') || t.includes('captación');
  const wantsBuy = /\bbusco\b/.test(t) || t.includes('quiero comprar') || t.includes('comprar casa');
  if (wantsBuy) {
    decision.detectedIntent = 'demand';
    decision.confidence = 0.75;
    decision.explicitFlowSwitch = true;
    patch.leadFlow = 'demand';
    patch.operationType = 'sale';
    decision.shouldAskName = true;
    decision.nextSuggestedStage = CONVERSATION_STAGES.UNDERSTANDING;
    return { patch, decision };
  }

  if (wantsSell) {
    decision.detectedIntent = 'offer';
    decision.confidence = 0.85;
    decision.explicitFlowSwitch = true;
    patch.leadFlow = 'offer';
    patch.operationType = 'sale';
    decision.shouldAskName = !state.collectedFields?.fullName;
    decision.nextSuggestedStage = CONVERSATION_STAGES.QUALIFYING;
    return { patch, decision };
  }

  const explicitSwitchToDemand =
    /\bbusco\b/.test(t) ||
    t.includes('quiero comprar') ||
    t.includes('no quiero vender') ||
    t.includes('en realidad busco');
  if (state.leadFlow === 'offer' && explicitSwitchToDemand) {
    decision.detectedIntent = 'demand';
    decision.explicitFlowSwitch = true;
    patch.leadFlow = 'demand';
    decision.shouldAskName = true;
    return { patch, decision };
  }

  const nameMatch = raw.match(/^(?:soy|me llamo|mi nombre es)\s+(.+)/i);
  const looksLikeName =
    state.leadFlow === 'offer' &&
    !/\d/.test(raw) &&
    raw.trim().split(/\s+/).filter(Boolean).length <= 3 &&
    raw.trim().length >= 2 &&
    raw.trim().length <= 48 &&
    !t.includes('cumbres') &&
    !t.includes('millon') &&
    !t.includes('millón') &&
    !t.includes('mdp') &&
    !t.includes('vender') &&
    !t.includes('casa');
  if (nameMatch || looksLikeName) {
    const nm = cleanSpaces(nameMatch ? nameMatch[1] : raw);
    if (nm) {
      decision.detectedIntent = 'identity_capture';
      decision.confidence = 0.9;
      decision.extractedEntities.fullName = nm;
      patch.collectedFields = { fullName: nm };
      decision.shouldAskName = false;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  if (t.includes('cumbres') || t.includes('zona') || t.includes('colonia') || t.includes('municipio') || t.includes('esta en ') || t.includes('está en ')) {
    decision.detectedIntent = 'location_capture';
    decision.confidence = 0.8;
    patch.locationText = t.includes('cumbres') ? 'Cumbres' : cleanSpaces(raw).slice(0, 120) || null;
    decision.extractedEntities.locationText = patch.locationText;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  const mill = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|mdp)/);
  if (mill) {
    const n = Number(mill[1].replace(',', '.'));
    const amount = /\bmdp\b/.test(t) ? Math.round(n * 1_000_000) : Math.round(n * 1_000_000);
    decision.detectedIntent = state.leadFlow === 'offer' ? 'seller_price_signal' : 'buyer_budget_signal';
    decision.confidence = 0.8;
    decision.explicitFlowSwitch = false;
    if (state.leadFlow === 'offer') {
      patch.expectedPrice = amount;
      patch.budget = null;
      decision.extractedEntities.expectedPrice = amount;
    } else {
      patch.budget = amount;
      decision.extractedEntities.budget = amount;
    }
    return { patch, decision };
  }

  if (t === 'hola' || t.startsWith('hola ') || t === 'buenas' || t === 'hey') {
    decision.detectedIntent = 'greeting';
    decision.confidence = 0.6;
    decision.nextSuggestedStage = CONVERSATION_STAGES.UNDERSTANDING;
    return { patch, decision };
  }

  decision.detectedIntent = 'unknown_utterance';
  decision.confidence = 0.2;
  return { patch, decision };
}

module.exports = {
  interpretUserTextMock,
};
