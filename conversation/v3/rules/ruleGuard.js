'use strict';

const { ALL_STAGES, V3_INTENT, CONVERSATION_MODE } = require('../types/constants');

function isDemandIntent(intent) {
  return (
    intent === 'demand' ||
    intent === V3_INTENT.BUY_PROPERTY ||
    intent === V3_INTENT.RENT_PROPERTY ||
    intent === V3_INTENT.PROPERTY_INQUIRY
  );
}

function isOfferIntent(intent) {
  return intent === 'offer' || intent === V3_INTENT.SELL_PROPERTY;
}

/**
 * @typedef {object} RuleGuardResult
 * @property {boolean} allowed
 * @property {string[]} violations
 * @property {string[]} blockedReasons
 */

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {{ mode?: string }} [context]
 * @returns {RuleGuardResult}
 */
function evaluateRuleGuard(state, decision, context = {}) {
  const violations = [];
  const blockedReasons = [];
  const mode = context.mode || state.mode;

  if (mode === CONVERSATION_MODE.HUMAN && decision.detectedIntent && !decision.shouldEscalateHuman) {
    violations.push('human_mode_no_ai_reply');
    blockedReasons.push('conversation_in_human_attention');
  }

  if (
    (state.leadFlow === 'offer' || state.conversationGoalLocked) &&
    isDemandIntent(decision.detectedIntent) &&
    !decision.explicitFlowSwitch
  ) {
    violations.push('offer_to_demand_without_confirmation');
    blockedReasons.push('sticky_lead_flow');
  }

  if (
    state.leadFlow === 'demand' &&
    isOfferIntent(decision.detectedIntent) &&
    !decision.explicitFlowSwitch
  ) {
    violations.push('demand_to_offer_without_confirmation');
    blockedReasons.push('sticky_lead_flow');
  }

  if (decision.shouldCreateLead && !state.hasContact) {
    violations.push('lead_without_contact');
    blockedReasons.push('crm_guard');
  }

  if (decision.inventedPropertyClaim) {
    violations.push('invented_property');
    blockedReasons.push('inventory_integrity');
  }

  if (decision.nextSuggestedStage && !ALL_STAGES.has(decision.nextSuggestedStage)) {
    violations.push('invalid_next_stage');
    blockedReasons.push('stage_contract');
  }

  const allowed = blockedReasons.length === 0;
  return { allowed, violations, blockedReasons };
}

module.exports = {
  evaluateRuleGuard,
};
