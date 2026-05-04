const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOrReuseLeadFromConversation,
  detectLeadCreationOpportunity,
} = require('../services/leadAutomation');

function makeQuery(table, db, filters = []) {
  const api = {
    _update: null,
    _inserted: null,
    _order: null,
    _limit: null,
    select() { return api; },
    insert(payload) {
      const rows = Array.isArray(payload) ? payload : [payload];
      const inserted = rows.map((row) => ({
        id: row.id || `${table}-${db[table].length + 1 + Math.floor(Math.random() * 1000)}`,
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
        db[table] = db[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row));
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1)));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return { data: rows[0] || null, error: null };
    },
    async single() {
      if (api._inserted) return { data: api._inserted[0], error: null };
      if (api._update) {
        db[table] = db[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row));
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1)));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return { data: rows[0] || null, error: null };
    },
    then(resolve) {
      if (api._update) {
        db[table] = db[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row));
        return resolve({ data: null, error: null });
      }
      let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      if (api._order) {
        const { key, asc } = api._order;
        rows = [...rows].sort((a, b) => (asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1)));
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return resolve({ data: rows, error: null });
    },
  };

  return api;
}

function buildMockSupabase(db, opts = {}) {
  const events = [];

  return {
    _events: events,
    from(table) {
      if (!db[table]) db[table] = [];

      if (table === 'conversation_events') {
        return {
          insert(payload) {
            events.push(payload);
            db[table].push(payload);
            return Promise.resolve({ data: payload, error: null });
          },
        };
      }

      if (opts.failLeadInsert && table === 'leads') {
        return {
          select() { return this; },
          insert() { return this; },
          single: async () => ({ data: null, error: { message: 'forced_lead_insert_failure' } }),
          maybeSingle: async () => ({ data: null, error: null }),
          eq() { return this; },
          is() { return this; },
          order() { return this; },
          limit() { return this; },
          then(resolve) {
            return resolve({ data: [], error: null });
          },
        };
      }

      if (opts.failLeadAssignment && table === 'leads') {
        const base = makeQuery(table, db);
        const originalUpdate = base.update.bind(base);
        base.update = function update(payload) {
          originalUpdate(payload);
          return {
            eq() { return this; },
            select() { return this; },
            single: async () => ({ data: null, error: { message: 'forced_assignment_update_failure' } }),
          };
        };
        return base;
      }

      return makeQuery(table, db);
    },
    async rpc(name, args) {
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }
      if (opts.failAssignmentRpc) {
        return { data: null, error: { message: 'forced_assignment_rpc_failure' } };
      }
      return {
        data: {
          success: true,
          lead_id: args.p_lead_id,
          assigned_agent_profile_id: 'agent-1',
          strategy: 'fallback',
          reason: 'fallback_agent',
        },
        error: null,
      };
    },
  };
}

function baseDb() {
  return {
    leads: [],
    contacts: [{ id: 'contact-1', whatsapp: '5218111111111' }],
    conversations: [
      {
        id: 'conv-1',
        phone: '5218111111111',
        channel: 'whatsapp',
        lead_id: null,
        contact_id: 'contact-1',
        assigned_agent_profile_id: null,
      },
    ],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
    lead_assignments: [],
    assignment_god_modes: [],
    assignment_rules: [],
    assignment_rule_agents: [],
    assignment_settings: [],
    assignment_logs: [],
  };
}

test('crm regression: detectLeadCreationOpportunity keeps idempotent/no inventa propiedad', () => {
  const negative = detectLeadCreationOpportunity({
    aiState: { lead_flow: 'demand', direct_property_reference: true, property_code: 'LUX-X9999' },
    propertyId: null,
    propertyCode: 'LUX-X9999',
    messageText: 'me interesa LUX-X9999',
  });

  assert.equal(negative.shouldCreate, false);
  assert.equal(negative.reason, 'property_not_found_for_reference');

  const positive = detectLeadCreationOpportunity({
    aiState: { lead_flow: 'demand', direct_property_reference: true, asks_property_details: true },
    propertyId: 'prop-99',
    propertyCode: 'LUX-A0099',
    messageText: 'me interesa esta propiedad',
  });

  assert.equal(positive.shouldCreate, true);
});

test('crm regression: fallo en creacion de lead no simula exito', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db, { failLeadInsert: true });

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0100',
      asks_property_details: true,
    },
    contactId: 'contact-1',
    propertyId: 'prop-100',
    property: { id: 'prop-100', listing_id: 'LUX-A0100', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'lead_automation_error');
  assert.equal(db.leads.length, 0);
});

test('crm regression: idempotencia evita duplicado para misma conversacion/lead', async () => {
  const db = baseDb();
  db.leads.push({
    id: 'lead-existing',
    contact_id: 'contact-1',
    lead_type: 'demand',
    interested_in_operation: 'sale',
    interested_property_id: 'prop-200',
    is_active: true,
    is_archived: false,
  });
  db.conversations[0].lead_id = 'lead-existing';

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0200',
      asks_property_details: true,
    },
    contactId: 'contact-1',
    propertyId: 'prop-200',
    property: { id: 'prop-200', listing_id: 'LUX-A0200', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, false);
  assert.equal(result.leadId, 'lead-existing');
  assert.equal(db.leads.length, 1);
});

test('crm regression: contacto existe sin lead y crea lead nuevo compatible', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0300',
      asks_property_details: true,
      wants_visit: true,
    },
    contactId: 'contact-1',
    propertyId: 'prop-300',
    property: { id: 'prop-300', listing_id: 'LUX-A0300', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, true);
  assert.equal(db.leads.length, 1);
  assert.ok(result.assignedAgentProfileId);
});

test('crm regression: fallo de asignacion no marca asignacion exitosa', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db, { failLeadAssignment: true });

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0400',
      asks_property_details: true,
      wants_human: true,
    },
    contactId: 'contact-1',
    propertyId: 'prop-400',
    property: { id: 'prop-400', listing_id: 'LUX-A0400', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.assignmentResult?.success, false);
  assert.equal(result.assignedAgentProfileId, null);
  assert.ok(Array.isArray(supabase._events));
  assert.ok(supabase._events.some((ev) => ev.type === 'lead_assignment_failed'));
});

test('crm regression: existe lead previo de contacto pero nueva conversacion lo reutiliza', async () => {
  const db = baseDb();
  db.leads.push({
    id: 'lead-contact-reuse',
    contact_id: 'contact-1',
    lead_type: 'demand',
    interested_in_operation: 'sale',
    interested_property_id: 'prop-500',
    is_active: true,
    is_archived: false,
  });

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: { ...db.conversations[0], id: 'conv-2', lead_id: null },
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0500',
      asks_property_details: true,
    },
    contactId: 'contact-1',
    propertyId: 'prop-500',
    property: { id: 'prop-500', listing_id: 'LUX-A0500', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.leadId, 'lead-contact-reuse');
  assert.equal(result.wasCreated, false);
  assert.equal(db.leads.length, 1);
});

test('crm regression: no crea lead con imagen sola sin intencion', () => {
  const decision = detectLeadCreationOpportunity({
    aiState: { lead_flow: null },
    messageText: '',
    unifiedContext: {
      sourceSignals: {
        hasText: false,
        hasCaption: false,
        hasAudioTranscription: false,
        hasImageVision: true,
        hasLocation: false,
        hasInteractive: false,
        hasCampaignContext: false,
        hasPropertyContext: false,
      },
      shouldCreateOrUpdateLead: false,
      normalizedIntent: { category: 'unknown' },
      crmAction: { reason: 'intent_not_actionable' },
    },
  });

  assert.equal(decision.shouldCreate, false);
  assert.equal(decision.reason, 'media_without_actionable_intent');
});

test('crm regression: ubicacion posterior actualiza lead existente sin duplicar', async () => {
  const db = baseDb();
  db.leads.push({
    id: 'lead-offer-1',
    contact_id: 'contact-1',
    lead_type: 'supply',
    interested_in_operation: 'sale',
    interested_property_id: null,
    is_active: true,
    is_archived: false,
  });
  db.conversations[0].lead_id = 'lead-offer-1';

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Cumbres',
      context_fusion: {
        normalizedIntent: { category: 'sell_property', confidence: 0.9 },
      },
    },
    contactId: 'contact-1',
    propertyId: null,
    property: null,
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, false);
  assert.equal(result.leadId, 'lead-offer-1');
  assert.equal(db.leads.length, 1);
});

test('crm regression: audio repetido no duplica lead', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const payload = {
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'rent',
      location_text: 'Cumbres',
      budget_max: 20000,
      context_fusion: {
        normalizedIntent: { category: 'rent_property', confidence: 0.9 },
      },
    },
    contactId: 'contact-1',
    propertyId: null,
    property: null,
    logger: console,
  };

  const first = await createOrReuseLeadFromConversation(payload);
  db.conversations[0].lead_id = first.leadId;
  const second = await createOrReuseLeadFromConversation(payload);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(db.leads.length, 1);
});

test('crm regression: respeta asesor asignado en lead existente', async () => {
  const db = baseDb();
  db.leads.push({
    id: 'lead-assigned-1',
    contact_id: 'contact-1',
    lead_type: 'demand',
    interested_in_operation: 'sale',
    interested_property_id: null,
    assigned_agent_profile_id: 'agent-existing',
    is_active: true,
    is_archived: false,
  });
  db.conversations[0].lead_id = 'lead-assigned-1';

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      asks_property_details: true,
    },
    contactId: 'contact-1',
    propertyId: null,
    property: null,
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.leadId, 'lead-assigned-1');
  assert.equal(result.assignedAgentProfileId, 'agent-existing');
  assert.equal(db.leads.length, 1);
});
