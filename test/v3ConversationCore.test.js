'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const v3 = require('../conversation/v3');
const contracts = require('../conversation/v3/contracts');

describe('V3 conversation core barrel (F1)', () => {
  it('exports stage engine and state factories', () => {
    assert.equal(typeof v3.createInitialConversationState, 'function');
    assert.equal(typeof v3.resolveNextStage, 'function');
    assert.equal(typeof v3.evaluateRuleGuard, 'function');
    assert.equal(typeof v3.composeResponseStub, 'function');
  });

  it('contracts validate state created via barrel', () => {
    const state = v3.createInitialConversationState({ conversationId: 'x' });
    const v = contracts.validateConversationState(state);
    assert.equal(v.valid, true);
  });
});
