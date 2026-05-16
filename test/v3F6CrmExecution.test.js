'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;
const PREV_CRM = process.env.PERSEO_V3_CRM_DRY_RUN;
const PREV_V3 = process.env.PERSEO_V3_ENABLED;
const PREV_EXECUTE = process.env.PERSEO_V3_CRM_EXECUTE;
const PREV_ALLOWLIST = process.env.PERSEO_V3_QA_ALLOWLIST;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_DRY_RUN = 'true';
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218119086196';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
  if (PREV_CRM === undefined) delete process.env.PERSEO_V3_CRM_DRY_RUN;
  else process.env.PERSEO_V3_CRM_DRY_RUN = PREV_CRM;
  if (PREV_V3 === undefined) delete process.env.PERSEO_V3_ENABLED;
  else process.env.PERSEO_V3_ENABLED = PREV_V3;
  if (PREV_EXECUTE === undefined) delete process.env.PERSEO_V3_CRM_EXECUTE;
  else process.env.PERSEO_V3_CRM_EXECUTE = PREV_EXECUTE;
  if (PREV_ALLOWLIST === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
  else process.env.PERSEO_V3_QA_ALLOWLIST = PREV_ALLOWLIST;
});

const { evaluateV3CrmExecutionGate } = require('../conversation/v3/crm/executionGate');
const { executeV3CrmIfEligible } = require('../conversation/v3/crm/crmExecutor');
const { buildV3CrmExecutionPayload } = require('../conversation/v3/crm/executionPayload');
const {
  processV3Turn,
  clearV3Session,
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  ADVISOR_CONTACT_CONSENT,
} = require('../conversation/v3');
const { createInitialConversationState, mergeConversationState } = require('../conversation/v3/types/conversationState');
const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');

function crmReadyState(overrides = {}) {
  return mergeConversationState(
    createInitialConversationState({ conversationId: 'conv-f6', phone: '5218119086196' }),
    {
      conversationStage: CONVERSATION_STAGES.CRM_READY,
      handoffStage: CONVERSATION_STAGES.CRM_READY,
      advisorContactConsent: ADVISOR_CONTACT_CONSENT.ACCEPTED,
      crmPayloadReady: true,
      qualificationComplete: true,
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      leadFlow: 'offer',
      operationType: 'sale',
      collectedFields: { fullName: 'Ana' },
      locationText: 'San Pedro',
      valuationRequested: true,
      priceUnknown: true,
      crmPayloadPreview: { intent: 'SELL_PROPERTY' },
      ...overrides,
    },
  );
}

function makeCrmMocks() {
  const calls = { contact: 0, lead: 0 };
  return {
    calls,
    ensureContact: async () => {
      calls.contact += 1;
      return 'contact-mock-1';
    },
    createLead: async () => {
      calls.lead += 1;
      return {
        success: true,
        leadId: 'lead-mock-1',
        wasCreated: calls.lead === 1,
        lead: { id: 'lead-mock-1' },
      };
    },
  };
}

describe('F6 CRM execution gate', () => {
  it('flag off → no write (crm_execute_disabled)', () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'false';
    const gate = evaluateV3CrmExecutionGate({
      state: crmReadyState(),
      phone: '5218119086196',
    });
    assert.equal(gate.eligible, false);
    assert.equal(gate.reason, 'crm_execute_disabled');
  });

  it('allowlist off → no write', () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const gate = evaluateV3CrmExecutionGate({
      state: crmReadyState(),
      phone: '5219999999999',
    });
    assert.equal(gate.eligible, false);
    assert.equal(gate.reason, 'allowlist_no_match');
  });

  it('consent REQUESTED → no write', () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const gate = evaluateV3CrmExecutionGate({
      state: crmReadyState({ advisorContactConsent: ADVISOR_CONTACT_CONSENT.REQUESTED }),
      phone: '5218119086196',
    });
    assert.equal(gate.eligible, false);
    assert.equal(gate.reason, 'consent_not_accepted');
  });

  it('CRM_READY + ACCEPTED + flag + allowlist → eligible', () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const gate = evaluateV3CrmExecutionGate({
      state: crmReadyState(),
      phone: '5218119086196',
    });
    assert.equal(gate.eligible, true);
  });
});

describe('F6 CRM executor (mocked writes)', () => {
  it('CRM_READY + ACCEPTED + flag → contact + lead', async () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const mocks = makeCrmMocks();
    const state = crmReadyState();
    const out = await executeV3CrmIfEligible({
      v3State: state,
      phone: '5218119086196',
      conversationRow: { id: 'conv-f6', phone: '5218119086196' },
      supabase: {},
      ensureContactForConversation: mocks.ensureContact,
      createOrReuseLeadFromConversation: mocks.createLead,
    });
    assert.equal(out.executed, true);
    assert.equal(mocks.calls.contact, 1);
    assert.equal(mocks.calls.lead, 1);
    assert.equal(out.v3State.crmExecutionCompleted, true);
    assert.equal(out.v3State.crmContactId, 'contact-mock-1');
    assert.equal(out.v3State.crmLeadId, 'lead-mock-1');
  });

  it('idempotencia: segundo turno no duplica', async () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const mocks = makeCrmMocks();
    const done = crmReadyState({ crmExecutionCompleted: true, crmContactId: 'c1', crmLeadId: 'l1' });
    const out = await executeV3CrmIfEligible({
      v3State: done,
      phone: '5218119086196',
      conversationRow: { id: 'conv-f6' },
      supabase: {},
      ensureContactForConversation: mocks.ensureContact,
      createOrReuseLeadFromConversation: mocks.createLead,
    });
    assert.equal(out.skipped, true);
    assert.equal(out.reason, 'already_executed');
    assert.equal(mocks.calls.contact, 0);
    assert.equal(mocks.calls.lead, 0);
  });

  it('PROPERTY_INQUIRY payload incluye property_code', () => {
    const st = crmReadyState({
      conversationGoal: CONVERSATION_GOALS.PROPERTY_INQUIRY,
      leadFlow: 'demand',
      operationType: 'sale',
      propertyListingCode: 'LUX-A0470',
      propertySpecificIntent: true,
      activeProperty: { id: 'prop-uuid-1', code: 'LUX-A0470' },
      collectedFields: { fullName: 'Gemma' },
    });
    const payload = buildV3CrmExecutionPayload(st, '5218119086196');
    assert.equal(payload.property_listing_code, 'LUX-A0470');
    assert.equal(payload.interested_property_id, 'prop-uuid-1');
    assert.equal(payload.source, 'PERSEO_V3');
  });

  it('valuation_requested sin expected_price en payload', () => {
    const payload = buildV3CrmExecutionPayload(crmReadyState(), '5218119086196');
    assert.equal(payload.captured_slots.valuation_requested, true);
    assert.equal(payload.captured_slots.price_unknown, true);
    assert.equal(payload.captured_slots.expected_price, null);
  });
});

describe('F6 regresión F4.1 (conversación, sin CRM write)', () => {
  before(() => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'false';
  });

  it('Ana: valuación sin precio', () => {
    const cid = 'f6-ana';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Quiero vender mi casa' });
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Ana' });
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'En San Pedro' });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218119086196',
      text: 'Es lo que no sé. Necesito que hagan la valuación ustedes.',
    });
    assert.equal(r.state.valuationRequested, true);
    assert.notEqual(r.state.awaitingField, 'expected_price');
    assert.equal(r.state.crmExecutionCompleted, false);
  });

  it('Luisa: Sí, Luisa y Luisa, ya te dije', () => {
    const cid = 'f6-luisa';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Quiero vender mi casa' });
    const r = processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Sí, Luisa' });
    assert.equal(r.state.collectedFields?.fullName, 'Luisa');
    const r2 = processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Luisa, ya te dije' });
    assert.equal(r2.state.collectedFields?.fullName, 'Luisa');
  });

  it('PROPERTY_INQUIRY → crm_payload_ready sin ejecución', () => {
    const cid = 'f6-prop';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'LUX-A0470' });
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Jorge' });
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Quiero un asesor' });
    const r = processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Sí' });
    assert.equal(r.state.crmPayloadReady, true);
    assert.equal(r.state.crmExecutionCompleted, false);
  });

  it('BUY_PROPERTY calificación completa dry-run', () => {
    const cid = 'f6-buy';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Busco casa en Cumbres' });
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: 'Sofía' });
    processV3Turn({ conversationId: cid, phone: '5218119086196', text: '7.5 millones' });
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218119086196',
      text: 'Sí, que me contacte un asesor',
    });
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.equal(r.state.crmPayloadReady, true);
    assert.equal(r.state.crmExecutionCompleted, false);
  });

  it('legacy gate off sin impacto', () => {
    const prev = process.env.PERSEO_V3_ENABLED;
    process.env.PERSEO_V3_ENABLED = 'false';
    try {
      assert.equal(evaluateV3PrimaryGate({ phone: '5218119086196' }).v3_primary_allowed, false);
    } finally {
      process.env.PERSEO_V3_ENABLED = prev === undefined ? 'true' : prev;
    }
  });
});
