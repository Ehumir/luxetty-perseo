'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_EXECUTE = process.env.PERSEO_V3_CRM_EXECUTE;
const PREV_ALLOWLIST = process.env.PERSEO_V3_QA_ALLOWLIST;
const PREV_V3 = process.env.PERSEO_V3_ENABLED;

const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { parseSprint1StrictCommand, processSprint1QaInbound } = require('../conversation/qaSprint1Commands');
const {
  evaluateQaCrmResetGate,
  executeQaCrmReset,
  stripCrmFieldsFromAiState,
} = require('../conversation/v3/qa/qaCrmReset');
const { createOrReuseLeadFromConversation } = require('../services/leadAutomation');
const {
  isValidPreferredZoneLocation,
  preferredZonesFromAiState,
} = require('../utils/preferredZoneSanitizer');
const { setSession, getSession, clearSession } = require('../conversation/v3/core/sessionStore');
const { createInitialConversationState, mergeConversationState } = require('../conversation/v3/types/conversationState');
const { executeV3CrmIfEligible } = require('../conversation/v3/crm/crmExecutor');
const {
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  ADVISOR_CONTACT_CONSENT,
} = require('../conversation/v3');

const QA_PHONE = '5218119086196';
const OTHER_PHONE = '5219999999999';

before(() => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = QA_PHONE;
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
});

after(() => {
  if (PREV_EXECUTE === undefined) delete process.env.PERSEO_V3_CRM_EXECUTE;
  else process.env.PERSEO_V3_CRM_EXECUTE = PREV_EXECUTE;
  if (PREV_ALLOWLIST === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
  else process.env.PERSEO_V3_QA_ALLOWLIST = PREV_ALLOWLIST;
  if (PREV_V3 === undefined) delete process.env.PERSEO_V3_ENABLED;
  else process.env.PERSEO_V3_ENABLED = PREV_V3;
});

function makeQuery(table, db, filters = []) {
  const api = {
    _update: null,
    _inserted: null,
    _order: null,
    _limit: null,
    select() {
      return api;
    },
    insert(payload) {
      const rows = Array.isArray(payload) ? payload : [payload];
      const inserted = rows.map((row) => ({
        id: row.id || `${table}-${db[table].length + 1}`,
        created_at: row.created_at || new Date().toISOString(),
        ...row,
      }));
      db[table].push(...inserted);
      api._inserted = inserted;
      return api;
    },
    update(payload) {
      api._update = payload;
      return api;
    },
    eq(key, value) {
      filters.push((row) => row[key] === value);
      return api;
    },
    is(key, value) {
      if (value === null) filters.push((row) => row[key] == null);
      else filters.push((row) => row[key] === value);
      return api;
    },
    order(key, opts = {}) {
      api._order = { key, asc: !!opts.ascending };
      return api;
    },
    limit(n) {
      api._limit = n;
      return api;
    },
    async maybeSingle() {
      if (api._update) {
        db[table] = db[table].map((row) =>
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row,
        );
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : a[key] > b[key] ? -1 : 1));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return { data: rows[0] || null, error: null };
    },
    async single() {
      if (api._inserted) return { data: api._inserted[0], error: null };
      if (api._update) {
        db[table] = db[table].map((row) =>
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row,
        );
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : a[key] > b[key] ? -1 : 1));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return { data: rows[0] || null, error: null };
    },
    then(resolve) {
      if (api._update) {
        db[table] = db[table].map((row) =>
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row,
        );
        return resolve({ data: null, error: null });
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : a[key] > b[key] ? -1 : 1));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return resolve({ data: rows, error: null });
    },
  };
  return api;
}

function buildMockSupabase(db) {
  return {
    from(table) {
      if (!db[table]) db[table] = [];
      if (table === 'conversation_events') {
        return {
          insert(payload) {
            db[table].push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      }
      return makeQuery(table, db);
    },
    async rpc(name, args) {
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }
      return {
        data: {
          success: true,
          lead_id: args.p_lead_id,
          assigned_agent_profile_id: 'agent-1',
          strategy: 'fallback',
        },
        error: null,
      };
    },
  };
}

function baseDb() {
  return {
    conversations: [
      {
        id: 'conv-f61',
        phone: QA_PHONE,
        contact_id: 'contact-carls',
        lead_id: 'lead-old-083',
        ai_state: {
          lead_flow: 'demand',
          full_name: 'Gemma Triay',
          crm_lead_id: 'lead-old-083',
          crm_execution_completed: true,
          crm_payload_ready: true,
        },
      },
    ],
    contacts: [
      {
        id: 'contact-carls',
        first_name: 'Carls',
        last_name: 'JR',
        full_name: 'Carls JR',
        phone: QA_PHONE,
        whatsapp: QA_PHONE,
      },
    ],
    leads: [
      {
        id: 'lead-old-083',
        contact_id: 'contact-carls',
        lead_type: 'demand',
        interested_in_operation: 'sale',
        interested_property_id: 'prop-0462',
        is_active: true,
        is_archived: false,
        notes_summary: 'Resumen viejo Carls',
      },
    ],
    pipeline_stages: [
      { id: 'stage-1', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
    ],
    conversation_events: [],
  };
}

describe('F6.1 !resetcrm gate', () => {
  it('parseSprint1StrictCommand reconoce !resetcrm', () => {
    assert.equal(parseSprint1StrictCommand('!resetcrm'), 'resetcrm');
    assert.equal(parseSprint1StrictCommand('  !RESETCRM  '), 'resetcrm');
  });

  it('fuera de allowlist → skipped', () => {
    const gate = evaluateQaCrmResetGate({ phone: OTHER_PHONE, qaCommandsAllowed: true });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'allowlist_no_match');
  });

  it('CRM_EXECUTE off → skipped', () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'false';
    const gate = evaluateQaCrmResetGate({ phone: QA_PHONE, qaCommandsAllowed: true });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'crm_execute_disabled');
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  });
});

describe('F6.1 executeQaCrmReset', () => {
  it('en allowlist limpia lead_id y flags CRM sin borrar lead/contacto', async () => {
    const db = baseDb();
    const supabase = buildMockSupabase(db);
    const events = [];
    const stateHolder = {};

    const logs = [];
    const result = await executeQaCrmReset({
      phone: QA_PHONE,
      conversationId: 'conv-f61',
      conversationRow: db.conversations[0],
      qaCommandsAllowed: true,
      saveStateFn: async (_id, st) => {
        Object.assign(stateHolder, st);
      },
      updateConversationFn: async (_client, _id, payload) => {
        db.conversations[0] = { ...db.conversations[0], ...payload };
      },
      supabase,
      normalizeAiState,
      saveEventFn: async (_id, type, payload) => {
        events.push({ type, payload });
      },
      logEvent: (ev, payload) => logs.push({ ev, payload }),
    });

    assert.equal(result.ok, true);
    assert.equal(db.conversations[0].lead_id, null);
    assert.equal(stateHolder.crm_execution_completed, false);
    assert.equal(stateHolder.crm_payload_ready, false);
    assert.equal(stateHolder.crm_lead_id, null);
    assert.equal(db.leads.length, 1);
    assert.equal(db.contacts.length, 1);
    assert.ok(logs.some((l) => l.ev === 'qa_crm_reset_started'));
    assert.ok(logs.some((l) => l.ev === 'qa_crm_reset_completed'));
    assert.ok(events.some((e) => e.type === 'qa_crm_reset_completed'));
  });

  it('limpia sesión V3 CRM en memoria', async () => {
    clearSession('conv-v3-mem');
    setSession(
      'conv-v3-mem',
      mergeConversationState(createInitialConversationState({ conversationId: 'conv-v3-mem' }), {
        crmExecutionCompleted: true,
        crmLeadId: 'lead-old',
        crmContactId: 'contact-old',
        crmPayloadReady: true,
      }),
    );

    await executeQaCrmReset({
      phone: QA_PHONE,
      conversationId: 'conv-v3-mem',
      conversationRow: { id: 'conv-v3-mem', lead_id: 'lead-old' },
      qaCommandsAllowed: true,
      saveStateFn: async () => {},
      getV3Session: getSession,
      setV3Session: setSession,
      logEvent: () => {},
    });

    const session = getSession('conv-v3-mem');
    assert.equal(session.crmExecutionCompleted, false);
    assert.equal(session.crmLeadId, null);
    assert.equal(session.crmContactId, null);
    clearSession('conv-v3-mem');
  });

  it('processSprint1QaInbound !resetcrm integrado', async () => {
    const db = baseDb();
    const supabase = buildMockSupabase(db);
    const stateHolder = { ...db.conversations[0].ai_state };

    const r = await processSprint1QaInbound({
      text: '!resetcrm',
      from: QA_PHONE,
      conversationId: 'conv-f61',
      conversationRow: db.conversations[0],
      supabase,
      getDefaultAiState,
      normalizeAiState,
      nowIso: () => '2026-05-17T08:00:00.000Z',
      saveEventFn: async () => {},
      saveStateFn: async (_id, st) => {
        Object.assign(stateHolder, st);
      },
      updateConversationFn: async (_c, _id, payload) => {
        Object.assign(db.conversations[0], payload);
      },
      getV3Session: getSession,
      setV3Session: setSession,
      isQaExecutionAllowed: () => true,
      logEvent: () => {},
    });

    assert.equal(r.handled, true);
    assert.equal(db.conversations[0].lead_id, null);
    assert.equal(stateHolder.crm_lead_id, null);
    assert.equal(stateHolder.qa_crm_force_new_lead, true);
  });
});

describe('F6.1 lead reuse vs new create', () => {
  it('con lead_id en conversación → reuse (producción intacto)', async () => {
    const db = baseDb();
    const supabase = buildMockSupabase(db);

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: {
        lead_flow: 'demand',
        operation_type: 'sale',
        property_code: 'LUX-A0462',
        direct_property_reference: true,
        confidence: 'high',
        full_name: 'Gemma Triay',
        asks_property_details: true,
      },
      contactId: 'contact-carls',
      propertyId: 'prop-0462',
      property: { id: 'prop-0462', listing_id: 'LUX-A0462', operation_type: 'sale' },
      logger: console,
    });

    assert.equal(result.success, true);
    assert.equal(result.wasCreated, false);
    assert.equal(result.leadId, 'lead-old-083');
    assert.equal(db.leads.length, 1);
  });

  it('sin qa_crm_force_new_lead sigue reutilizando por teléfono+propiedad (idempotencia prod)', async () => {
    const db = baseDb();
    db.conversations[0].lead_id = null;
    const supabase = buildMockSupabase(db);

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: {
        lead_flow: 'demand',
        operation_type: 'sale',
        property_code: 'LUX-A0462',
        direct_property_reference: true,
        confidence: 'high',
        asks_property_details: true,
      },
      contactId: 'contact-carls',
      propertyId: 'prop-0462',
      property: { id: 'prop-0462', listing_id: 'LUX-A0462', operation_type: 'sale' },
      logger: console,
    });

    assert.equal(result.success, true);
    assert.equal(result.wasCreated, false);
    assert.equal(result.leadId, 'lead-old-083');
    assert.equal(db.leads.length, 1);
  });

  it('después de reset CRM (lead_id null + force flag) → crea nuevo lead', async () => {
    const db = baseDb();
    db.conversations[0].lead_id = null;
    const supabase = buildMockSupabase(db);

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: {
        lead_flow: 'demand',
        operation_type: 'sale',
        property_code: 'LUX-A0462',
        direct_property_reference: true,
        confidence: 'high',
        full_name: 'Gemma Triay',
        location_text: 'WhatsApp',
        asks_property_details: true,
        qa_crm_force_new_lead: true,
      },
      contactId: 'contact-carls',
      propertyId: 'prop-0462',
      property: { id: 'prop-0462', listing_id: 'LUX-A0462', operation_type: 'sale' },
      logger: console,
    });

    assert.equal(result.success, true);
    assert.equal(result.wasCreated, true);
    assert.notEqual(result.leadId, 'lead-old-083');
    assert.equal(db.leads.length, 2);
    const created = db.leads.find((l) => l.id === result.leadId);
    assert.ok(created);
    assert.equal(created.preferred_zones, null);
  });
});

describe('F6.1 preferred_zones sanitizer', () => {
  it('rechaza WhatsApp/qa/unknown como zona', () => {
    assert.equal(isValidPreferredZoneLocation('WhatsApp'), false);
    assert.equal(isValidPreferredZoneLocation('qa'), false);
    assert.equal(isValidPreferredZoneLocation('unknown'), false);
    assert.equal(isValidPreferredZoneLocation('San Pedro'), true);
  });

  it('preferredZonesFromAiState ignora canal', () => {
    assert.equal(preferredZonesFromAiState({ location_text: 'WhatsApp' }), null);
    assert.deepEqual(preferredZonesFromAiState({ location_text: 'Cumbres' }), ['Cumbres']);
  });
});

describe('F6.1 stripCrmFieldsFromAiState', () => {
  it('limpia campos CRM legacy sin borrar full_name', () => {
    const next = stripCrmFieldsFromAiState({
      full_name: 'Gemma Triay',
      crm_lead_id: 'x',
      crm_execution_completed: true,
    });
    assert.equal(next.full_name, 'Gemma Triay');
    assert.equal(next.crm_lead_id, null);
    assert.equal(next.crm_execution_completed, false);
  });
});

describe('F6.1 executor propaga qa_crm_force_new_lead desde ai_state persistido', () => {
  it('mapV3StateToLeadAutomation no pierde el flag de !resetcrm', async () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const { executeV3CrmIfEligible } = require('../conversation/v3/crm/crmExecutor');
    const st = mergeConversationState(
      createInitialConversationState({ conversationId: 'conv-flag', phone: '5218119086196' }),
      {
        conversationStage: CONVERSATION_STAGES.CRM_READY,
        advisorContactConsent: ADVISOR_CONTACT_CONSENT.ACCEPTED,
        crmPayloadReady: true,
        qualificationComplete: true,
        conversationGoal: CONVERSATION_GOALS.PROPERTY_INQUIRY,
        leadFlow: 'demand',
        operationType: 'sale',
        propertyListingCode: 'LUX-A0462',
        collectedFields: { fullName: 'Gemma Triay' },
        crmExecutionCompleted: false,
      },
    );
    let captured = null;
    await executeV3CrmIfEligible({
      v3State: st,
      phone: '5218119086196',
      conversationRow: {
        id: 'conv-flag',
        phone: '5218119086196',
        lead_id: null,
        ai_state: { qa_crm_force_new_lead: true },
      },
      supabase: {},
      ensureContactForConversation: async () => 'contact-1',
      createOrReuseLeadFromConversation: async ({ aiState }) => {
        captured = aiState;
        return { success: true, leadId: 'new-lead', wasCreated: true, lead: { id: 'new-lead' } };
      },
    });
    assert.equal(captured?.qa_crm_force_new_lead, true);
  });
});

describe('F6.1 F6 gate tras reset CRM en V3', () => {
  it('permite nueva ejecución F6 si crmExecutionCompleted fue limpiado', async () => {
    process.env.PERSEO_V3_CRM_EXECUTE = 'true';
    const st = mergeConversationState(createInitialConversationState({ conversationId: 'conv-f61-gate' }), {
      conversationStage: CONVERSATION_STAGES.CRM_READY,
      advisorContactConsent: ADVISOR_CONTACT_CONSENT.ACCEPTED,
      crmPayloadReady: true,
      qualificationComplete: true,
      conversationGoal: CONVERSATION_GOALS.PROPERTY_INQUIRY,
      leadFlow: 'demand',
      operationType: 'sale',
      propertyListingCode: 'LUX-A0462',
      collectedFields: { fullName: 'Gemma Triay' },
      crmExecutionCompleted: false,
    });

    let leadCalls = 0;
    const out = await executeV3CrmIfEligible({
      v3State: st,
      phone: QA_PHONE,
      conversationRow: { id: 'conv-f61-gate', phone: QA_PHONE, lead_id: null },
      supabase: {
        from(table) {
          if (table === 'contacts') {
            return makeQuery(table, {
              contacts: [
                {
                  id: 'contact-carls',
                  first_name: 'Carls',
                  last_name: 'JR',
                  full_name: 'Carls JR',
                },
              ],
            });
          }
          return makeQuery(table, { [table]: [] });
        },
      },
      ensureContactForConversation: async () => 'contact-carls',
      createOrReuseLeadFromConversation: async () => {
        leadCalls += 1;
        return {
          success: true,
          leadId: 'lead-new-084',
          wasCreated: true,
          lead: { id: 'lead-new-084' },
        };
      },
    });

    assert.equal(out.executed, true);
    assert.equal(leadCalls, 1);
    assert.equal(out.v3State.crmLeadId, 'lead-new-084');
  });
});
