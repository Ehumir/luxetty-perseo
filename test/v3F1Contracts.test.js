'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const contracts = require('../conversation/v3/contracts');
const { createEmptyDecision } = require('../conversation/v3/types/conversationDecision');
const {
  CONVERSATION_STAGES,
  V3_INTENT,
  CONVERSATION_GOALS,
} = require('../conversation/v3/types/constants');
const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');

describe('V3-F1 contracts', () => {
  it('validates initial conversation state', () => {
    const state = contracts.createInitialConversationState({
      conversationId: 'c1',
      phone: '5218119086196',
    });
    const v = contracts.validateConversationState(state);
    assert.equal(v.valid, true, v.errors.join('; '));
    assert.equal(state.conversationStage, CONVERSATION_STAGES.NEW);
  });

  it('rejects invalid conversation state', () => {
    const v = contracts.validateConversationState({
      conversationStage: 'NOT_A_STAGE',
      identityState: 'UNKNOWN',
      mode: 'ai',
      frustrationState: 'none',
      advisorContactConsent: 'UNKNOWN',
      collectedFields: {},
      timestamps: { createdAt: 'x', updatedAt: 'y' },
      conversationGoalLocked: false,
      qualificationComplete: false,
    });
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => e.startsWith('invalid_conversation_stage')));
  });

  it('validates empty decision', () => {
    const d = createEmptyDecision();
    const v = contracts.validateConversationDecision(d);
    assert.equal(v.valid, true, v.errors.join('; '));
  });

  it('validates stage, goal, intent enums', () => {
    assert.equal(contracts.validateStage(CONVERSATION_STAGES.QUALIFYING).valid, true);
    assert.equal(contracts.validateConversationGoal(CONVERSATION_GOALS.BUY_PROPERTY).valid, true);
    assert.equal(contracts.validateIntent(V3_INTENT.SELL_PROPERTY).valid, true);
    assert.equal(contracts.validateIntent('NOT_INTENT').valid, false);
  });

  it('validates core slot names', () => {
    assert.equal(contracts.validateSlotName('fullName').valid, true);
    assert.equal(contracts.validateSlotName('unknown_slot').valid, false);
  });

  it('rule guard contract blocks offer→demand flip', () => {
    const state = contracts.createInitialConversationState();
    state.leadFlow = 'offer';
    state.conversationGoal = CONVERSATION_GOALS.SELL_PROPERTY;
    state.conversationGoalLocked = true;
    const decision = createEmptyDecision();
    decision.detectedIntent = V3_INTENT.BUY_PROPERTY;
    decision.explicitFlowSwitch = false;

    const run = contracts.runRuleGuardContract(state, decision);
    assert.equal(run.valid, true);
    assert.equal(run.result.allowed, false);
    assert.ok(run.result.violations.includes('offer_to_demand_without_confirmation'));
  });

  it('composer contract returns shaped output', () => {
    const run = contracts.runComposerContract({
      state: contracts.createInitialConversationState(),
      decision: createEmptyDecision(),
    });
    assert.equal(run.valid, true);
    assert.match(run.output.responseText, /v3-composer-stub/);
  });

  it('production gate: disabled V3 blocks primary route', () => {
    const prevEnabled = process.env.PERSEO_V3_ENABLED;
    const prevList = process.env.PERSEO_V3_QA_ALLOWLIST;
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '';

    try {
      const gate = evaluateV3PrimaryGate({ phone: '5218119086196' });
      assert.equal(gate.v3_primary_allowed, false);
      assert.equal(gate.route, 'legacy_primary');

      const desc = contracts.describeV3ProductionGate();
      assert.equal(desc.operationalFlag, 'PERSEO_V3_ENABLED');
      assert.equal(desc.documentAliasFlag, 'PERSEO_CONVERSATIONAL_CORE_V3_ENABLED');
      assert.equal(desc.engineEffective, 'legacy');
    } finally {
      if (prevEnabled === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prevEnabled;
      if (prevList === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
      else process.env.PERSEO_V3_QA_ALLOWLIST = prevList;
    }
  });
});
