'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hydrateV3StateFromLegacyAiState } = require('../conversation/v3/state/legacyToV3State');
const { CONVERSATION_GOALS } = require('../conversation/v3/types/constants');

test('hydrateV3StateFromLegacyAiState restores demand slots from ai_state', () => {
  const state = hydrateV3StateFromLegacyAiState('conv-1', '5218119086196', {
    v3_primary_active: true,
    lead_flow: 'demand',
    intent_type: 'buy',
    location_text: 'Cumbres',
    budget_max: 6000000,
    bedrooms: 4,
    full_name: 'Jorge',
    crm_execution_completed: false,
  });

  assert.ok(state);
  assert.equal(state.conversationId, 'conv-1');
  assert.equal(state.leadFlow, 'demand');
  assert.equal(state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
  assert.equal(state.locationText, 'Cumbres');
  assert.equal(state.budget, 6000000);
  assert.equal(state.bedrooms, 4);
  assert.equal(state.collectedFields.fullName, 'Jorge');
});

test('hydrateV3StateFromLegacyAiState returns null for empty legacy state', () => {
  assert.equal(hydrateV3StateFromLegacyAiState('c', '521', {}), null);
});
