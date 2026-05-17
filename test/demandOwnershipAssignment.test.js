'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_EXECUTE = process.env.PERSEO_V3_CRM_EXECUTE;
const PREV_ALLOWLIST = process.env.PERSEO_V3_QA_ALLOWLIST;
const PREV_V3 = process.env.PERSEO_V3_ENABLED;

const { ensureContactForConversationCore } = require('../services/contactProvisioning');
const { createOrReuseLeadFromConversation } = require('../services/leadAutomation');

const QA_PHONE = '5218119086196';

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
    or() {
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
  let rpcCalls = 0;
  return {
    _getRpcCalls() {
      return rpcCalls;
    },
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
    async rpc(name) {
      rpcCalls += 1;
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }
      return {
        data: {
          success: true,
          lead_id: 'rpc-lead',
          assigned_agent_profile_id: 'agent-engine',
          strategy: 'assignment_engine',
        },
        error: null,
      };
    },
  };
}

const DEMAND_AI = {
  lead_flow: 'demand',
  operation_type: 'sale',
  property_code: 'LUX-A0462',
  direct_property_reference: true,
  asks_property_details: true,
  intent_type: 'property_interest',
  wants_human: true,
  confidence: 'high',
};

describe('demand ownership — regla oficial', () => {
  it('contacto existente con asesor + propiedad → lead al asesor del contacto', async () => {
    const db = {
      conversations: [
        {
          id: 'conv-own-1',
          phone: QA_PHONE,
          channel: 'whatsapp',
          lead_id: null,
          contact_id: 'contact-owned',
        },
      ],
      contacts: [
        {
          id: 'contact-owned',
          phone: QA_PHONE,
          whatsapp: QA_PHONE,
          assigned_agent_profile_id: 'agent-contact-owner',
        },
      ],
      leads: [],
      pipeline_stages: [
        { id: 'stage-1', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      ],
      conversation_events: [],
      lead_assignments: [],
      assignment_logs: [],
    };
    const supabase = buildMockSupabase(db);
    const logLabels = [];
    const logger = { info: (l) => logLabels.push(l), warn() {} };

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: { ...DEMAND_AI, full_name: 'Gemma Triay' },
      contactId: 'contact-owned',
      propertyId: 'prop-0462',
      property: {
        id: 'prop-0462',
        listing_id: 'LUX-A0462',
        operation_type: 'sale',
        agent_profile_id: 'agent-property-0462',
      },
      contactWasCreated: false,
      logger,
    });

    assert.equal(result.success, true);
    assert.equal(result.assignedAgentProfileId, 'agent-contact-owner');
    assert.equal(db.leads[0].assigned_agent_profile_id, 'agent-contact-owner');
    assert.equal(db.leads[0].interested_property_id, 'prop-0462');
    assert.ok(logLabels.includes('assignment_owner_contact_priority'));
    assert.equal(supabase._getRpcCalls(), 0);
    assert.ok(!logLabels.includes('ASSIGNMENT_PROPERTY_AGENT'));
  });

  it('contacto nuevo + LUX-A0462 → contacto y lead al asesor de la propiedad', async () => {
    const db = {
      conversations: [{ id: 'conv-new-prop', phone: QA_PHONE, contact_id: null }],
      contacts: [],
      leads: [],
      pipeline_stages: [
        { id: 'stage-1', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      ],
      conversation_events: [],
      lead_assignments: [],
      assignment_logs: [],
    };
    const supabase = buildMockSupabase(db);

    const contactResult = await ensureContactForConversationCore({
      supabase,
      conversationRow: db.conversations[0],
      state: { full_name: 'Nuevo Lead' },
      phone: QA_PHONE,
      property: { id: 'prop-0462', listing_id: 'LUX-A0462', agent_profile_id: 'agent-property-0462' },
      saveConversationEvent: async () => {},
      updateConversationMeta: async (_id, payload) => {
        db.conversations[0] = { ...db.conversations[0], ...payload };
      },
    });

    assert.equal(contactResult.wasCreated, true);
    const createdContact = db.contacts[0];
    assert.equal(createdContact.assigned_agent_profile_id, 'agent-property-0462');

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: { ...DEMAND_AI },
      contactId: createdContact.id,
      propertyId: 'prop-0462',
      property: {
        id: 'prop-0462',
        listing_id: 'LUX-A0462',
        agent_profile_id: 'agent-property-0462',
      },
      contactWasCreated: true,
      logger: console,
    });

    assert.equal(result.success, true);
    assert.equal(result.assignedAgentProfileId, 'agent-property-0462');
    assert.equal(db.leads[0].interested_property_id, 'prop-0462');
  });

  it('contacto nuevo sin propiedad → motor de asignación', async () => {
    const db = {
      conversations: [{ id: 'conv-new-generic', phone: QA_PHONE, channel: 'whatsapp', lead_id: null }],
      contacts: [
        {
          id: 'contact-new-generic',
          phone: QA_PHONE,
          whatsapp: QA_PHONE,
        },
      ],
      leads: [],
      pipeline_stages: [
        { id: 'stage-1', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      ],
      conversation_events: [],
      lead_assignments: [],
      assignment_logs: [],
    };
    const supabase = buildMockSupabase(db);
    const logLabels = [];
    const logger = { info: (l) => logLabels.push(l), warn() {} };

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: {
        lead_flow: 'demand',
        operation_type: 'sale',
        wants_human: true,
        confidence: 'high',
      },
      contactId: 'contact-new-generic',
      propertyId: null,
      property: null,
      contactWasCreated: true,
      logger,
    });

    assert.equal(result.success, true);
    assert.equal(result.assignedAgentProfileId, 'agent-engine');
    assert.ok(logLabels.includes('assignment_engine_fallback_used'));
  });
});

describe('demand ownership — QA !resetcrm', () => {
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

  it('!resetcrm fuerza lead nuevo, conserva contacto y dueño del contacto', async () => {
    const db = {
      conversations: [
        {
          id: 'conv-qa-reset',
          phone: QA_PHONE,
          channel: 'whatsapp',
          lead_id: null,
          contact_id: 'contact-carls',
          ai_state: { qa_crm_force_new_lead: true },
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
          assigned_agent_profile_id: 'agent-contact-owner',
        },
      ],
      leads: [
        {
          id: 'lead-old-083',
          contact_id: 'contact-carls',
          lead_type: 'demand',
          interested_in_operation: 'sale',
          interested_property_id: 'prop-0462',
          assigned_agent_profile_id: 'agent-property-0462',
          is_active: true,
          is_archived: false,
        },
      ],
      pipeline_stages: [
        { id: 'stage-1', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      ],
      conversation_events: [],
      lead_assignments: [],
      assignment_logs: [],
    };
    const supabase = buildMockSupabase(db);
    const logLabels = [];
    const logger = { info: (l) => logLabels.push(l), warn() {} };

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: {
        ...DEMAND_AI,
        full_name: 'Gemma Triay',
        qa_crm_force_new_lead: true,
      },
      contactId: 'contact-carls',
      propertyId: 'prop-0462',
      property: {
        id: 'prop-0462',
        listing_id: 'LUX-A0462',
        agent_profile_id: 'agent-property-0462',
      },
      contactWasCreated: false,
      logger,
    });

    assert.equal(result.success, true);
    assert.equal(result.wasCreated, true);
    assert.equal(db.contacts.length, 1);
    assert.equal(db.leads.length, 2);
    assert.notEqual(result.leadId, 'lead-old-083');
    assert.equal(result.assignedAgentProfileId, 'agent-contact-owner');
    assert.equal(db.leads.find((l) => l.id === result.leadId).assigned_agent_profile_id, 'agent-contact-owner');
    assert.ok(logLabels.includes('LEAD_AUTOMATION_QA_FORCE_NEW_LEAD'));
    assert.ok(logLabels.includes('qa_crm_force_new_lead_owner_preserved'));
    assert.ok(logLabels.includes('assignment_owner_contact_priority'));
    assert.ok(!logLabels.includes('LEAD_AUTOMATION_REUSE_BY_MATCH'));
  });

  it('sin qa_crm_force_new_lead mantiene idempotencia por contacto+propiedad', async () => {
    const db = {
      conversations: [
        {
          id: 'conv-prod',
          phone: QA_PHONE,
          channel: 'whatsapp',
          lead_id: null,
          contact_id: 'contact-carls',
        },
      ],
      contacts: [
        {
          id: 'contact-carls',
          phone: QA_PHONE,
          whatsapp: QA_PHONE,
          assigned_agent_profile_id: 'agent-contact-owner',
        },
      ],
      leads: [
        {
          id: 'lead-old-083',
          contact_id: 'contact-carls',
          lead_type: 'demand',
          interested_in_operation: 'sale',
          interested_property_id: 'prop-0462',
          assigned_agent_profile_id: 'agent-contact-owner',
          is_active: true,
          is_archived: false,
        },
      ],
      pipeline_stages: [
        { id: 'stage-1', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      ],
      conversation_events: [],
    };
    const supabase = buildMockSupabase(db);

    const result = await createOrReuseLeadFromConversation({
      supabase,
      conversation: db.conversations[0],
      aiState: { ...DEMAND_AI },
      contactId: 'contact-carls',
      propertyId: 'prop-0462',
      property: { id: 'prop-0462', listing_id: 'LUX-A0462', agent_profile_id: 'agent-property-0462' },
      logger: console,
    });

    assert.equal(result.wasCreated, false);
    assert.equal(result.leadId, 'lead-old-083');
    assert.equal(db.leads.length, 1);
  });
});
