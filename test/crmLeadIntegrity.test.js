/**
 * test/crmLeadIntegrity.test.js
 *
 * Suite: CRM Lead Integrity — 8 escenarios críticos
 *
 * Garantiza que PERSEO cree o reutilice correctamente Contactos,
 * Solicitudes/Leads y Asignaciones en ATENA, sin duplicados y con trazabilidad.
 *
 * Nota sobre contactos: la creación/reutilización de contactos ocurre en
 * ensureContactForConversation (index.js). Estos tests validan la capa de
 * leadAutomation.js que recibe el contactId ya resuelto, reflejando el flujo real.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOrReuseLeadFromConversation } = require('../services/leadAutomation');

// ─── Mock helpers ────────────────────────────────────────────────────────────

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
        id: row.id || `${table}-${db[table].length + 1}-${Math.floor(Math.random() * 9999)}`,
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
    or() { return api; },
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
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row
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
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row
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
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row
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

/**
 * @param {object} db         - In-memory table state
 * @param {object} opts
 * @param {boolean} opts.failLeadInsert   - Make leads INSERT always fail
 * @param {boolean} opts.rpcNoAgent       - RPC returns success but no agent
 * @param {boolean} opts.failAssignmentRpc - RPC returns error
 * @param {string}  opts.rpcAgent         - Agent returned by RPC (default 'engine-agent-id')
 */
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
          then(resolve) { return resolve({ data: [], error: null }); },
        };
      }

      return makeQuery(table, db);
    },

    async rpc(name) {
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }
      if (opts.failAssignmentRpc) {
        return { data: null, error: { message: 'forced_rpc_failure' } };
      }
      if (opts.rpcNoAgent) {
        return { data: { success: false, assigned_agent_profile_id: null }, error: null };
      }
      return {
        data: {
          success: true,
          assigned_agent_profile_id: opts.rpcAgent || 'engine-agent-id',
          strategy: 'assignment_engine',
          reason: 'engine_assigned',
        },
        error: null,
      };
    },
  };
}

function baseDb(overrides = {}) {
  return {
    leads: [],
    contacts: [],
    conversations: [],
    conversation_events: [],
    pipeline_stages: [
      { id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      { id: 'stage-new-supply', code: 'new', lead_type: 'supply', is_active: true, stage_order: 1 },
    ],
    lead_assignments: [],
    assignment_god_modes: [],
    assignment_rules: [],
    assignment_rule_agents: [],
    assignment_settings: [],
    assignment_logs: [],
    ...overrides,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONTACT_A = {
  id: 'contact-a',
  phone: '5218112345678',
  whatsapp: '5218112345678',
  full_name: 'Ana García',
};

const CONV_A = {
  id: 'conv-a',
  phone: '5218112345678',
  channel: 'whatsapp',
  lead_id: null,
  contact_id: 'contact-a',
  assigned_agent_profile_id: null,
};

const PROP_1 = {
  id: 'prop-1',
  listing_id: 'LUX-A0001',
  operation_type: 'sale',
  agent_profile_id: null,
};

const AI_DEMAND_PROP = {
  lead_flow: 'demand',
  direct_property_reference: true,
  property_code: 'LUX-A0001',
  asks_property_details: true,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

/**
 * T1: nuevo WhatsApp → contacto ya resuelto → crea lead + asignación
 *
 * Simula el flujo completo: ensureContactForConversation ya creó el contacto y
 * devolvió un contactId. createOrReuseLeadFromConversation debe crear lead nuevo
 * y disparar asignación.
 */
test('crm-integrity T1: nuevo WhatsApp crea lead + asignacion', async () => {
  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A }],
  });
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP, wants_human: true },
    contactId: CONTACT_A.id,
    propertyId: PROP_1.id,
    property: { ...PROP_1 },
    logger: console,
  });

  assert.equal(result.success, true, 'debe tener exito');
  assert.equal(result.wasCreated, true, 'debe crear nuevo lead');
  assert.equal(db.leads.length, 1, 'exactamente 1 lead en DB');
  assert.equal(db.leads[0].contact_id, CONTACT_A.id, 'lead ligado al contacto');
  assert.ok(result.leadId, 'leadId presente en resultado');
  assert.ok(result.assignedAgentProfileId, 'debe tener agente asignado');
  assert.ok(
    supabase._events.some((ev) => ev.type === 'lead_created'),
    'evento lead_created emitido'
  );
});

/**
 * T2: WhatsApp existente → reutiliza contacto y lead previo activo
 *
 * El mismo contacto ya tiene una solicitud abierta compatible. No debe crear duplicado.
 */
test('crm-integrity T2: WhatsApp existente reutiliza lead activo sin duplicar', async () => {
  const existingLead = {
    id: 'lead-existing',
    contact_id: CONTACT_A.id,
    lead_type: 'demand',
    interested_in_operation: 'sale',
    interested_property_id: PROP_1.id,
    is_active: true,
    is_archived: false,
    lead_score: 50,
    notes_summary: null,
  };

  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A, lead_id: existingLead.id }],
    leads: [existingLead],
  });
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP },
    contactId: CONTACT_A.id,
    propertyId: PROP_1.id,
    property: { ...PROP_1 },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, false, 'no debe crear nuevo lead');
  assert.equal(result.leadId, existingLead.id, 'debe retornar el lead existente');
  assert.equal(db.leads.length, 1, 'sigue siendo 1 lead en DB');
  assert.ok(
    supabase._events.some((ev) => ev.type === 'lead_reused'),
    'evento lead_reused emitido'
  );
});

/**
 * T3: mismo contacto + nueva intención → crea segunda solicitud
 *
 * El contacto tiene una solicitud de demanda/compra. Ahora tiene intención de
 * oferta/venta. Son incompatibles → debe crear una segunda solicitud.
 */
test('crm-integrity T3: mismo contacto con nueva intencion crea segunda solicitud', async () => {
  const prevLead = {
    id: 'lead-demand',
    contact_id: CONTACT_A.id,
    lead_type: 'demand',
    interested_in_operation: 'sale',
    interested_property_id: null,
    is_active: true,
    is_archived: false,
    lead_score: 40,
    notes_summary: null,
  };

  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A, lead_id: prevLead.id }],
    leads: [prevLead],
    pipeline_stages: [
      { id: 'stage-supply', code: 'new', lead_type: 'supply', is_active: true, stage_order: 1 },
    ],
  });
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'offer',        // supply / venta de su propiedad
      lead_type: 'supply',
      location_text: 'Monterrey Centro',
      budget_max: 3500000,
      budget_currency: 'MXN',
      wants_human: true,
    },
    contactId: CONTACT_A.id,
    propertyId: null,
    property: null,
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, true, 'debe crear nueva solicitud de oferta');
  assert.equal(db.leads.length, 2, 'ahora hay 2 leads en DB');
  assert.equal(db.leads[1].lead_type, 'supply', 'nueva solicitud es de tipo supply');
  assert.ok(
    supabase._events.some((ev) => ev.type === 'new_lead_created_due_to_intent_change'),
    'evento new_lead_created_due_to_intent_change emitido'
  );
});

/**
 * T4: mismo contacto + misma propiedad → no duplica solicitud abierta
 *
 * findCompatibleLead debe encontrar el lead activo y reutilizarlo, incluso si
 * la conversación no tiene lead_id vinculado todavía.
 */
test('crm-integrity T4: mismo contacto + misma propiedad no duplica solicitud abierta', async () => {
  const activeLead = {
    id: 'lead-active',
    contact_id: CONTACT_A.id,
    lead_type: 'demand',
    interested_in_operation: 'sale',
    interested_property_id: PROP_1.id,
    is_active: true,
    is_archived: false,
    lead_score: 60,
    notes_summary: null,
  };

  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A, lead_id: null }], // sin lead_id en conversacion
    leads: [activeLead],
  });
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP },
    contactId: CONTACT_A.id,
    propertyId: PROP_1.id,
    property: { ...PROP_1 },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, false, 'no debe crear duplicado');
  assert.equal(result.leadId, activeLead.id, 'debe reutilizar lead activo');
  assert.equal(db.leads.length, 1, 'solo 1 lead en DB');
});

/**
 * T5: propiedad con agente responsable → lead asignado a ese agente
 *
 * El motor de asignación tiene la más baja prioridad. Si la propiedad ya tiene
 * un agente responsable, ese agente debe recibir el lead.
 */
test('crm-integrity T5: propiedad con agente responsable asigna a ese agente', async () => {
  const propWithAgent = {
    ...PROP_1,
    agent_profile_id: 'property-owner-agent',
  };

  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A }],
  });
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP, wants_human: true },
    contactId: CONTACT_A.id,
    propertyId: propWithAgent.id,
    property: propWithAgent,
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, true);
  assert.equal(
    result.assignedAgentProfileId,
    'property-owner-agent',
    'debe asignar al agente responsable de la propiedad'
  );
  // El evento lead_assigned debe indicar estrategia property_owner_agent
  const assignedEvent = supabase._events.find(
    (ev) => ev.type === 'lead_assigned'
  );
  assert.ok(assignedEvent, 'evento lead_assigned emitido');
  assert.equal(assignedEvent.payload?.strategy, 'property_owner_agent');
});

/**
 * T6: sin agente en propiedad → motor de asignación resuelve el agente
 *
 * Ningún candidato prioritario (propiedad, campaña, contacto, conversación).
 * El RPC assign_lead_via_engine devuelve un agente.
 */
test('crm-integrity T6: sin agente responsable usa motor de asignacion', async () => {
  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A }],
  });
  // rpcAgent por defecto = 'engine-agent-id'
  const supabase = buildMockSupabase(db, { rpcAgent: 'motor-agent-id' });

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP, wants_human: true },
    contactId: CONTACT_A.id,
    propertyId: PROP_1.id,
    property: { ...PROP_1 }, // sin agent_profile_id
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, true);
  assert.equal(
    result.assignedAgentProfileId,
    'motor-agent-id',
    'debe asignar el agente devuelto por el motor'
  );
  const assignedEvent = supabase._events.find((ev) => ev.type === 'lead_assigned');
  assert.ok(assignedEvent, 'evento lead_assigned emitido');
  assert.equal(assignedEvent.payload?.strategy, 'assignment_engine');
});

/**
 * T7: fallback solo cuando no existe alternativa
 *
 * Todos los candidatos prioritarios y el motor de asignación devuelven sin agente.
 * Solo entonces se usa el agente de fallback de assignment_settings.
 * El evento assignment_fallback_used debe emitirse.
 */
test('crm-integrity T7: fallback solo cuando no existe alternativa y emite evento', async () => {
  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A }],
    assignment_settings: [
      { id: 'settings-1', fallback_agent_profile_id: 'fallback-agent-id', is_active: true },
    ],
  });
  // RPC devuelve sin agente → dispara fallback
  const supabase = buildMockSupabase(db, { rpcNoAgent: true });

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP, wants_human: true },
    contactId: CONTACT_A.id,
    propertyId: PROP_1.id,
    property: { ...PROP_1 }, // sin agent_profile_id
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, true);
  assert.equal(
    result.assignedAgentProfileId,
    'fallback-agent-id',
    'debe asignar agente de fallback'
  );
  assert.ok(
    supabase._events.some((ev) => ev.type === 'assignment_fallback_used'),
    'evento assignment_fallback_used emitido'
  );
  const fallbackEvent = supabase._events.find((ev) => ev.type === 'assignment_fallback_used');
  assert.equal(
    fallbackEvent.payload?.fallback_agent_profile_id,
    'fallback-agent-id'
  );
});

/**
 * T8: error de Supabase en INSERT no responde como si todo salió bien
 *
 * Si la inserción del lead falla, el resultado debe indicar success=false
 * y emitir el evento crm_creation_failed. Nunca success=true con lead=null.
 */
test('crm-integrity T8: error de Supabase no simula exito y emite crm_creation_failed', async () => {
  const db = baseDb({
    contacts: [{ ...CONTACT_A }],
    conversations: [{ ...CONV_A }],
  });
  const supabase = buildMockSupabase(db, { failLeadInsert: true });

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: { ...AI_DEMAND_PROP, wants_human: true },
    contactId: CONTACT_A.id,
    propertyId: PROP_1.id,
    property: { ...PROP_1 },
    logger: console,
  });

  assert.equal(result.success, false, 'debe reportar fracaso');
  assert.equal(result.lead, null, 'lead debe ser null');
  assert.equal(result.leadId, null, 'leadId debe ser null');
  assert.equal(db.leads.length, 0, 'ningún lead insertado en DB');
  assert.ok(
    supabase._events.some((ev) => ev.type === 'crm_creation_failed'),
    'evento crm_creation_failed emitido'
  );
});
