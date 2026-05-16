'use strict';

const { evaluateRuleGuard } = require('../rules/ruleGuard');
const { isPlainObject, pushError, result } = require('./_helpers');

/**
 * @param {unknown} guardResult
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRuleGuardResult(guardResult) {
  const errors = [];
  if (!isPlainObject(guardResult)) {
    pushError(errors, 'rule_guard_result_not_object');
    return result(errors);
  }
  if (typeof guardResult.allowed !== 'boolean') {
    pushError(errors, 'allowed_not_boolean');
  }
  if (!Array.isArray(guardResult.violations)) {
    pushError(errors, 'violations_not_array');
  }
  if (!Array.isArray(guardResult.blockedReasons)) {
    pushError(errors, 'blocked_reasons_not_array');
  }
  return result(errors);
}

/**
 * Contrato de uso: evaluateRuleGuard(state, decision) → RuleGuardResult.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @param {object} [context]
 * @returns {{ valid: boolean, errors: string[], result: import('../rules/ruleGuard').RuleGuardResult }}
 */
function runRuleGuardContract(state, decision, context) {
  const guardResult = evaluateRuleGuard(state, decision, context);
  const shape = validateRuleGuardResult(guardResult);
  return { ...shape, result: guardResult };
}

module.exports = {
  validateRuleGuardResult,
  runRuleGuardContract,
  evaluateRuleGuard,
};
