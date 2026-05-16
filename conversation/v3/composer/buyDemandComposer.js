'use strict';

const { CONVERSATION_GOALS, V3_INTENT } = require('../types/constants');
const { evaluateGeoCoverage } = require('../rules/geoPolicy');
const { evaluateBuyPricePolicy } = require('../rules/pricePolicy');

/**
 * @typedef {'geo_out_of_coverage'|'price_below_floor'|'price_ambiguous'} BuyPolicyKind
 */

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {ReturnType<import('../planner/qualificationPlanner').evaluateQualification>} plannerOut
 * @param {{ action: string }} handoffOut
 * @returns {{ kind: BuyPolicyKind, nextSlot: string|null }|null}
 */
function getBuyDemandPolicyHint(state, decision, plannerOut, handoffOut) {
  if (state.conversationGoal !== CONVERSATION_GOALS.BUY_PROPERTY) return null;
  if (handoffOut.action === 'OFFER_HANDOFF' || handoffOut.action === 'CONSENT_ACCEPTED') return null;

  const geo = evaluateGeoCoverage(state.locationText);
  const price = evaluateBuyPricePolicy(state, state.lastUserText || '');

  const justLocation =
    decision.detectedIntent === V3_INTENT.LOCATION_CAPTURE ||
    !!(decision.extractedEntities && decision.extractedEntities.locationText);
  const justBudget =
    decision.detectedIntent === V3_INTENT.BUYER_BUDGET ||
    (decision.extractedEntities && decision.extractedEntities.budget != null);

  if (geo.status === 'out_of_coverage' && justLocation && state.locationText) {
    return { kind: 'geo_out_of_coverage', nextSlot: plannerOut.nextSlot || null };
  }

  if (price.status === 'below_soft_floor' && justBudget && state.budget != null) {
    return { kind: 'price_below_floor', nextSlot: plannerOut.nextSlot || null };
  }

  if (price.status === 'ambiguous' && decision.detectedIntent === V3_INTENT.UNKNOWN) {
    return { kind: 'price_ambiguous', nextSlot: 'budget' };
  }

  return null;
}

module.exports = {
  getBuyDemandPolicyHint,
};
