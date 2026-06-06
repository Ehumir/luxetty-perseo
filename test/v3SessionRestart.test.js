'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PERSEO_V3_SESSION_DB_READTHROUGH = 'true';
process.env.PERSEO_V3_ENABLED = 'true';

const { processV3Turn } = require('../conversation/v3/core/v3Runtime');
const { clearSession, getSession } = require('../conversation/v3/core/sessionStore');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const { hydrateV3StateFromLegacyAiState } = require('../conversation/v3/state/legacyToV3State');
const { CONVERSATION_GOALS } = require('../conversation/v3/types/constants');

const CONV = 'mc5-restart-conv-1';
const PHONE = '5218181877351';

function simulateRestartPersistedState(v3State) {
  return mapV3StateToLegacyAiState(v3State);
}

test('post-restart turn hydrates property + intent + stage from ai_state', () => {
  clearSession(CONV);

  const turn1 = processV3Turn({
    conversationId: CONV,
    phone: PHONE,
    text: 'Hola, busco casa en venta en Cumbres',
    legacyHydration: {
      propertyListingCode: 'LUX-A0453',
      activeProperty: { id: 'prop-abc', code: 'LUX-A0453', title: 'Casa Cumbres' },
    },
    persistedLegacyAiState: null,
  });
  assert.ok(turn1.ok);
  assert.ok(turn1.state);

  const persisted = simulateRestartPersistedState(turn1.state);
  persisted.conversation_stage = turn1.state.conversationStage;
  persisted.intent_type = 'buy';
  persisted.lead_flow = 'demand';
  persisted.v3_primary_active = true;

  clearSession(CONV);
  assert.equal(getSession(CONV), null);

  const turn2 = processV3Turn({
    conversationId: CONV,
    phone: PHONE,
    text: 'Mi presupuesto es 6 millones',
    persistedLegacyAiState: persisted,
    legacyHydration: {
      propertyListingCode: 'LUX-A0453',
      activeProperty: { id: 'prop-abc', code: 'LUX-A0453', title: 'Casa Cumbres' },
    },
  });

  assert.ok(turn2.ok);
  assert.equal(turn2.state.propertyListingCode, 'LUX-A0453');
  assert.ok(turn2.state.activeProperty?.id === 'prop-abc' || turn2.state.propertyListingCode === 'LUX-A0453');
  assert.notEqual(turn2.state.conversationStage, null);
});

test('resolveSession read-through restores CRM commercial context after Map clear', () => {
  clearSession(CONV);

  const legacy = {
    v3_primary_active: true,
    lead_flow: 'demand',
    intent_type: 'buy',
    conversation_goal: CONVERSATION_GOALS.BUY_PROPERTY,
    conversation_stage: 'qualification',
    property_code: 'LUX-C100',
    interested_property_id: 'prop-c100',
    crm_contact_id: 'cnt-1',
    crm_lead_id: 'ld-1',
    crm_execution_completed: true,
    budget_max: 5500000,
    location_text: 'San Pedro',
    full_name: 'Ana Test',
  };

  clearSession(CONV);
  const hydrated = hydrateV3StateFromLegacyAiState(CONV, PHONE, legacy);
  assert.ok(hydrated);
  assert.equal(hydrated.propertyListingCode, 'LUX-C100');
  assert.equal(hydrated.crmLeadId, 'ld-1');
  assert.equal(hydrated.crmExecutionCompleted, true);
  assert.equal(hydrated.collectedFields.fullName, 'Ana Test');
  assert.equal(hydrated.budget, 5500000);

  const turn = processV3Turn({
    conversationId: CONV,
    phone: PHONE,
    text: 'Gracias',
    persistedLegacyAiState: legacy,
  });
  assert.ok(turn.ok);
  assert.equal(turn.state.crmLeadId, 'ld-1');
  assert.equal(turn.state.crmExecutionCompleted, true);
  assert.equal(turn.state.propertyListingCode, 'LUX-C100');
});

test('redeploy simulation: persisted ai_state → turn N+1 without re-asking filled slots', () => {
  clearSession(CONV);

  const legacyAfterDeploy = {
    v3_primary_active: true,
    lead_flow: 'demand',
    intent_type: 'buy',
    conversation_goal: CONVERSATION_GOALS.BUY_PROPERTY,
    conversation_stage: 'qualification',
    location_text: 'Cumbres',
    budget_max: 6000000,
    bedrooms: 4,
    full_name: 'Jorge',
    property_code: 'LUX-A0453',
    interested_property_id: 'prop-abc',
    crm_execution_completed: false,
    awaiting_field: null,
  };

  clearSession(CONV);
  const r = processV3Turn({
    conversationId: CONV,
    phone: PHONE,
    text: 'Sí, correcto',
    persistedLegacyAiState: legacyAfterDeploy,
    legacyHydration: {
      propertyListingCode: 'LUX-A0453',
      activeProperty: { id: 'prop-abc', code: 'LUX-A0453' },
    },
  });

  assert.ok(r.ok);
  assert.equal(r.state.locationText, 'Cumbres');
  assert.equal(r.state.budget, 6000000);
  assert.equal(r.state.collectedFields.fullName, 'Jorge');
  assert.equal(r.state.propertyListingCode, 'LUX-A0453');
  const reply = String(r.reply || '').toLowerCase();
  assert.ok(!reply.includes('¿cuál es tu nombre') && !reply.includes('cómo te llamas'));
});
