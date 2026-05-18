'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRuleGuard } = require('../conversation/v3/rules/ruleGuard');
const { CONVERSATION_GOALS, V3_INTENT } = require('../conversation/v3/types/constants');

describe('ruleGuard buy demand slot filling', () => {
  it('allows BUYER_BUDGET when goal is locked BUY_PROPERTY (demand flow)', () => {
    const state = {
      leadFlow: 'demand',
      conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
      conversationGoalLocked: true,
      mode: 'ai',
    };
    const decision = {
      detectedIntent: V3_INTENT.BUYER_BUDGET,
      explicitFlowSwitch: false,
      shouldCreateLead: false,
      inventedPropertyClaim: false,
    };
    const guard = evaluateRuleGuard(state, decision, {});
    assert.equal(guard.allowed, true);
    assert.equal(guard.violations.length, 0);
  });

  it('blocks demand intent when active offer flow', () => {
    const state = {
      leadFlow: 'offer',
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      conversationGoalLocked: true,
      mode: 'ai',
    };
    const decision = {
      detectedIntent: V3_INTENT.BUY_PROPERTY,
      explicitFlowSwitch: false,
    };
    const guard = evaluateRuleGuard(state, decision, {});
    assert.equal(guard.allowed, false);
    assert.ok(guard.violations.includes('offer_to_demand_without_confirmation'));
  });
});
