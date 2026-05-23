'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldAllowCrmExecuteForInbound,
} = require('../config/crmExecuteInboundGate');

const PREV = {
  PERSEO_V3_ENABLED: process.env.PERSEO_V3_ENABLED,
  PERSEO_V3_CRM_EXECUTE: process.env.PERSEO_V3_CRM_EXECUTE,
  PERSEO_V3_QA_ALLOWLIST: process.env.PERSEO_V3_QA_ALLOWLIST,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const PREV_BYPASS = process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS;

function restoreBypass() {
  if (PREV_BYPASS === undefined) delete process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS;
  else process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS = PREV_BYPASS;
}

test('CRM_EXECUTE=true + allowlist_no_match → blocked (sin pauta property)', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';
  process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS = 'true';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218119086196',
    conversationId: 'conv-off',
    v3PrimaryAllowed: false,
    selectedPipeline: 'legacy',
    aiState: { lead_flow: 'demand', location_text: 'Centro' },
  });

  assert.equal(gate.crm_execute_allowed, false);
  assert.equal(gate.block_reason, 'allowlist_no_match');
  assert.equal(gate.is_qa_allowed, false);
  restoreEnv();
  restoreBypass();
});

test('CRM_EXECUTE=true + allowlist_no_match + pauta property → bypass allowed', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';
  process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS = 'true';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218998722910',
    conversationId: 'conv-pauta',
    v3PrimaryAllowed: false,
    selectedPipeline: 'legacy',
    aiState: {
      campaign_context: { property_code: 'LUX-A0453' },
      property_code: 'LUX-A0453',
      property_specific_intent: true,
      direct_property_reference: true,
    },
  });

  assert.equal(gate.crm_execute_allowed, true);
  assert.equal(gate.crm_execute_bypass_reason, 'pauta_property');
  assert.equal(gate.block_reason, null);
  restoreEnv();
  restoreBypass();
});

test('CRM_EXECUTE=true + allowlist match + v3 pipeline → allowed', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218181877351',
    conversationId: 'conv-on',
    v3PrimaryAllowed: true,
    selectedPipeline: 'v3',
  });

  assert.equal(gate.crm_execute_allowed, true);
  assert.equal(gate.block_reason, null);
  assert.equal(gate.is_qa_allowed, true);
  restoreEnv();
});

test('CRM_EXECUTE=false → blocked even on allowlist + v3', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'false';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218181877351',
    v3PrimaryAllowed: true,
    selectedPipeline: 'v3',
  });

  assert.equal(gate.crm_execute_allowed, false);
  assert.equal(gate.block_reason, 'crm_execute_disabled');
  restoreEnv();
});

test('legacy fallback off allowlist: pipeline legacy → blocked', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218119086196',
    v3PrimaryAllowed: false,
    selectedPipeline: 'legacy',
  });

  assert.equal(gate.crm_execute_allowed, false);
  assert.ok(
    gate.block_reason === 'allowlist_no_match' || gate.block_reason === 'v3_primary_not_allowed',
  );
  restoreEnv();
});

test('CRM_EXECUTE=true + allowlist + legacy pipeline (no v3) → pipeline_not_v3', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218181877351',
    v3PrimaryAllowed: false,
    selectedPipeline: 'legacy',
  });

  assert.equal(gate.crm_execute_allowed, false);
  assert.equal(gate.block_reason, 'v3_primary_not_allowed');
  restoreEnv();
});

test('CRM_EXECUTE=true + oferta orgánica (sin pauta) → bypass organic_offer', () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';
  process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS = 'true';
  process.env.PERSEO_CRM_EXECUTE_ORGANIC_OFFER_BYPASS = 'true';

  const gate = shouldAllowCrmExecuteForInbound({
    phone: '5218119814146',
    conversationId: 'conv-organic-offer',
    v3PrimaryAllowed: false,
    selectedPipeline: 'legacy',
    aiState: {
      lead_flow: 'offer',
      operation_type: 'sale',
      property_type: 'land',
      full_name: 'Jose Ángel Hernández López',
      location_text: 'Santa Catarina',
    },
  });

  assert.equal(gate.crm_execute_allowed, true);
  assert.equal(gate.crm_execute_bypass_reason, 'organic_offer');
  assert.equal(gate.block_reason, null);
  restoreEnv();
  restoreBypass();
});

test('runCleanOrchestratorCrmPhase: off allowlist → no lead_create_attempted path', async () => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';

  const { runCleanOrchestratorCrmPhase } = require('../index')._private;
  const { getDefaultAiState } = require('../conversation/aiState');
  const { parseMessageSignals } = require('../conversation/parsers');

  const db = {
    conversations: [{ id: 'c1', phone: '5218119086196', contact_id: null, lead_id: null }],
    contacts: [],
    leads: [],
    conversation_events: [],
  };
  const supabase = {
    from(table) {
      const api = {
        select() {
          return api;
        },
        insert(row) {
          const rows = Array.isArray(row) ? row : [row];
          db[table].push(...rows.map((r, i) => ({ id: `${table}-${i}`, ...r })));
          return api;
        },
        update() {
          return api;
        },
        eq() {
          return api;
        },
        or() {
          return api;
        },
        limit() {
          return api;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
      };
      return api;
    },
  };

  const s = { ...getDefaultAiState(), lead_flow: 'demand', full_name: 'Test', location_text: 'Cumbres' };
  const parsed = parseMessageSignals('8 millones', s, { media: { type: 'text' } });
  const out = await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'c1',
    conversationRow: db.conversations[0],
    nextAiState: s,
    parsedSignals: parsed,
    text: '8 millones',
    contact: null,
    from: '5218119086196',
    waProfileName: null,
    rawPayload: {},
    crmGateContext: { v3PrimaryAllowed: false, selectedPipeline: 'legacy' },
  });

  assert.equal(out.crmSkipped, true);
  assert.equal(out.crm_execute_block_reason, 'allowlist_no_match');
  assert.equal(db.leads.length, 0);
  assert.equal(db.contacts.length, 0);
  restoreEnv();
});
