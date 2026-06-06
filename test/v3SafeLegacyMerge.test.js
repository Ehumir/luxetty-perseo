'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeLegacyAiStateWithV3,
  mapV3StateToLegacyAiState,
} = require('../conversation/v3/state/v3ToLegacyAiState');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const { CONVERSATION_GOALS } = require('../conversation/v3/types/constants');

test('mergeLegacyAiStateWithV3 preserves CRM fields when V3 patch emits null', () => {
  const previous = {
    v3_primary_active: true,
    property_code: 'LUX-A0453',
    interested_property_id: 'prop-uuid-1',
    crm_contact_id: 'contact-1',
    crm_lead_id: 'lead-1',
    crm_execution_completed: true,
    budget_max: 6000000,
    location_text: 'Cumbres',
    intent_type: 'buy',
    conversation_stage: 'qualification',
  };
  const v3Partial = createInitialConversationState({ conversationId: 'c1', phone: '5218119086196' });
  v3Partial.conversationGoal = CONVERSATION_GOALS.BUY_PROPERTY;
  v3Partial.conversationStage = 'greeting';

  const merged = mergeLegacyAiStateWithV3(previous, v3Partial);
  assert.equal(merged.property_code, 'LUX-A0453');
  assert.equal(merged.interested_property_id, 'prop-uuid-1');
  assert.equal(merged.crm_contact_id, 'contact-1');
  assert.equal(merged.crm_lead_id, 'lead-1');
  assert.equal(merged.crm_execution_completed, true);
  assert.equal(merged.budget_max, 6000000);
  assert.equal(merged.location_text, 'Cumbres');
  assert.equal(merged.conversation_stage, 'greeting');
});

test('mergeLegacyAiStateWithV3 does not regress crm_execution_completed to false', () => {
  const previous = { crm_execution_completed: true, v3_primary_active: true };
  const v3 = createInitialConversationState({ conversationId: 'c2' });
  v3.crmExecutionCompleted = false;
  const merged = mergeLegacyAiStateWithV3(previous, v3);
  assert.equal(merged.crm_execution_completed, true);
});

test('blind Object.assign would wipe protected CRM fields', () => {
  const previous = {
    property_code: 'LUX-B001',
    crm_lead_id: 'lead-99',
    v3_primary_active: true,
  };
  const v3 = createInitialConversationState({ conversationId: 'c3' });
  const patch = mapV3StateToLegacyAiState(v3);
  const blind = { ...previous, ...patch };
  assert.equal(blind.property_code, null);
  assert.equal(blind.crm_lead_id, null);
});
