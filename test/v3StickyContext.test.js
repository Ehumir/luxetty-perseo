'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  stampStickyContext,
  enforceStickyContext,
  isStickyContextActive,
  releaseStickyContext,
} = require('../conversation/v3/ownership/stickyContext');
const { CONVERSATION_GOALS } = require('../conversation/v3/types/constants');

describe('v3StickyContext', () => {
  it('stamps sticky fields on goal lock', () => {
    const patch = {
      conversationGoalLocked: true,
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      leadFlow: 'offer',
      operationType: 'sale',
    };
    stampStickyContext(patch);
    assert.equal(patch.stickyLeadFlow, 'offer');
    assert.equal(patch.stickyOperationType, 'sale');
  });

  it('blocks offer to demand flip without explicit switch', () => {
    const state = {
      conversationGoalLocked: true,
      stickyLeadFlow: 'offer',
      stickyOperationType: 'sale',
      stickyConversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      leadFlow: 'offer',
    };
    const patch = enforceStickyContext(
      state,
      { leadFlow: 'demand', conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY },
      { explicitFlowSwitch: false }
    );
    assert.equal(patch.leadFlow, 'offer');
    assert.equal(isStickyContextActive(state), true);
  });

  it('releases sticky on explicitFlowSwitch', () => {
    const patch = {
      stickyLeadFlow: 'offer',
      stickyOperationType: 'sale',
      stickyConversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
    };
    releaseStickyContext(patch);
    assert.equal(patch.stickyLeadFlow, null);
    const out = enforceStickyContext(
      { stickyLeadFlow: 'offer', conversationGoalLocked: true },
      { leadFlow: 'demand', conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY },
      { explicitFlowSwitch: true }
    );
    assert.equal(out.leadFlow, 'demand');
    assert.equal(out.stickyLeadFlow, null);
  });

  it('allows buy patch when explicitFlowSwitch after sell sticky', () => {
    const state = {
      conversationGoalLocked: true,
      stickyLeadFlow: 'offer',
      stickyOperationType: 'sale',
      stickyConversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      leadFlow: 'offer',
    };
    const patch = enforceStickyContext(
      state,
      {
        conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
        leadFlow: 'demand',
        operationType: 'sale',
        conversationGoalLocked: true,
      },
      { explicitFlowSwitch: true }
    );
    assert.equal(patch.leadFlow, 'demand');
    assert.equal(patch.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    stampStickyContext(patch);
    assert.equal(patch.stickyLeadFlow, 'demand');
  });

  it('maps budget to expectedPrice on sell sticky', () => {
    const state = {
      conversationGoalLocked: true,
      stickyConversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      stickyLeadFlow: 'offer',
      stickyOperationType: 'sale',
    };
    const patch = enforceStickyContext(state, { budget: 5000000 }, { explicitFlowSwitch: false });
    assert.equal(patch.expectedPrice, 5000000);
    assert.equal(patch.budget, null);
  });
});
