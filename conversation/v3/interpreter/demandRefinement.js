'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { CONVERSATION_GOALS, V3_INTENT } = require('../types/constants');
const { normalizeLocationFromUserText } = require('./locationNormalizer');
const { parseMoneyAmount } = require('./moneyParser');
const { extractLooseLocationPhrase } = require('./campaignIntake');

/**
 * @param {string} text
 */
function isDemandRefinementMessage(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    /\b(mas|más)\s+(grande|grandes|chico|chica|peque)/.test(t) ||
    /\b(mas|más)\s+barat/.test(t) ||
    /\b(algo|opciones?)\s+mas\s+barat/.test(t) ||
    /\b(con|que\s+tenga)\s+(patio|terraza|jardin|jardín)\b/.test(t) ||
    /\b(otra|otro|mejor\s+en)\s+(zona|colonia|lugar|barrio)\b/.test(t) ||
    /\ben\s+otra\s+zona\b/.test(t) ||
    /\b(cambiar|mover|prefiero)\s+(de\s+)?zona\b/.test(t) ||
    /\bmas\s+ampl/i.test(t) ||
    /\bmejor\s+en\s+[a-záéíóúñ]/i.test(String(text || ''))
  );
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 * @param {string} text
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
function tryParseDemandRefinement(state, raw, text, patch, decision) {
  if (state.conversationGoal !== CONVERSATION_GOALS.BUY_PROPERTY) return null;
  if (!state.conversationGoalLocked && !state.leadFlow) return null;
  if (!isDemandRefinementMessage(text)) return null;

  const t = normalizeText(text);
  decision.detectedIntent = V3_INTENT.DEMAND_REFINEMENT;
  decision.confidence = 0.86;
  decision.explicitFlowSwitch = false;

  let zonePhrase = extractLooseLocationPhrase(raw) || normalizeLocationFromUserText(raw);
  if (!zonePhrase) {
    const zm = String(raw || '').match(/\ben\s+([a-záéíóúñ][\wáéíóúñ\s]{2,40})/i);
    if (zm?.[1]) {
      zonePhrase = cleanSpaces(zm[1].replace(/\b(zona|colonia)\b/gi, '').trim());
    }
  }

  if (
    /\b(otra|otro|mejor\s+en)\s+(zona|colonia|lugar|barrio)\b/.test(t) ||
    /\ben\s+otra\s+zona\b/.test(t) ||
    /\b(cambiar|mover|prefiero)\s+(de\s+)?zona\b/.test(t) ||
    /\bmejor\s+en\s+[a-záéíóúñ]/i.test(String(raw || ''))
  ) {
    decision.refinementKind = 'zone';
    if (zonePhrase && !/^(busco|quiero|necesito|otra|mejor)\b/i.test(normalizeText(zonePhrase))) {
      patch.locationText = zonePhrase;
      decision.detectedIntent = V3_INTENT.LOCATION_CAPTURE;
      decision.extractedEntities.locationText = zonePhrase;
      patch.awaitingField = state.budget == null ? 'budget' : state.collectedFields?.fullName ? null : 'full_name';
      return { patch, decision };
    }
    patch.awaitingField = 'location_text';
    return { patch, decision };
  }

  if (/\b(mas|más)\s+barat/.test(t) || /\balgo\s+mas\s+barat/.test(t)) {
    decision.refinementKind = 'budget_down';
    const amount = parseMoneyAmount(text);
    if (amount != null) {
      patch.budget = amount;
      decision.detectedIntent = V3_INTENT.BUYER_BUDGET;
      decision.extractedEntities.budget = amount;
    } else {
      patch.awaitingField = 'budget';
    }
    return { patch, decision };
  }

  if (/\b(mas|más)\s+(grande|grandes|ampl)/.test(t)) {
    decision.refinementKind = 'size_up';
    const prev = state.bedrooms != null ? Number(state.bedrooms) : 0;
    const next = prev > 0 ? Math.min(prev + 1, 8) : 3;
    patch.bedrooms = next;
    decision.extractedEntities.bedrooms = next;
    decision.detectedIntent = V3_INTENT.DEMAND_REFINEMENT;
    return { patch, decision };
  }

  if (/\b(con|que\s+tenga)\s+(patio|terraza|jardin|jardín)\b/.test(t)) {
    decision.refinementKind = 'feature_patio';
    patch.collectedFields = {
      ...(patch.collectedFields || state.collectedFields || {}),
      wantsPatio: true,
    };
    return { patch, decision };
  }

  return null;
}

module.exports = {
  isDemandRefinementMessage,
  tryParseDemandRefinement,
};
