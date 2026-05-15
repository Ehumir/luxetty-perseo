'use strict';

const { mergeConversationState } = require('../types/conversationState');
const { evaluateRuleGuard } = require('../rules/ruleGuard');
const { resolveNextStage } = require('../stages/stageEngine');
const { resolveIdentityState } = require('../identity/identityResolver');

/**
 * Aplica un parche de estado y recalcula identidad + etapa sugerida por motor V3 (puro).
 * @param {import('../types/conversationState').ConversationState} state
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @returns {{ state: import('../types/conversationState').ConversationState, guard: import('../rules/ruleGuard').RuleGuardResult }}
 */
function applyV3StateTransition(state, patch, decision) {
  let next = mergeConversationState(state, patch);
  next = mergeConversationState(next, { identityState: resolveIdentityState(next) });
  const stage = resolveNextStage(next.conversationStage, decision, next);
  next = mergeConversationState(next, { conversationStage: stage });
  const guard = evaluateRuleGuard(next, decision, {});
  return { state: next, guard };
}

module.exports = {
  applyV3StateTransition,
};
