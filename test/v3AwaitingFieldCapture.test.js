'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyDecision } = require('../conversation/v3/types/conversationDecision');
const { CONVERSATION_GOALS } = require('../conversation/v3/types/constants');
const { tryResolveAwaitingFieldCapture } = require('../conversation/v3/interpreter/awaitingFieldCapture');

describe('v3AwaitingFieldCapture', () => {
  it('maps Cumbres to location when awaiting location_text', () => {
    const state = {
      conversationGoalLocked: true,
      conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
      leadFlow: 'demand',
      awaitingField: 'location_text',
    };
    const patch = {};
    const decision = createEmptyDecision();
    const out = tryResolveAwaitingFieldCapture(state, 'Cumbres', 'Cumbres', patch, decision);
    assert.ok(out);
    assert.equal(out.patch.locationText, 'Cumbres');
  });

  it('maps Sí to consent when awaiting advisor_contact_consent', () => {
    const state = {
      conversationGoalLocked: true,
      conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
      awaitingField: 'advisor_contact_consent',
    };
    const patch = {};
    const decision = createEmptyDecision();
    const out = tryResolveAwaitingFieldCapture(state, 'Sí', 'Sí', patch, decision);
    assert.ok(out);
    assert.equal(out.patch.advisorContactConsent, 'ACCEPTED');
  });
});
