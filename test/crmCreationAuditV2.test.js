/**
 * P4 — Auditoría creación CRM (clean orchestrator): contactos + leads (public.leads).
 * No public.requests; sin migraciones; mocks Supabase estilo leadAutomation/crmFlowRegression.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getDefaultAiState } = require('../conversation/aiState');
const { parseMessageSignals } = require('../conversation/parsers');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');

const indexPath = path.join(__dirname, '..', 'index.js');
const indexMod = require('../index');
const {
  runCleanOrchestratorCrmPhase,
  normalizeListingCodeForLookup,
  fetchPropertyByListingCode,
} = indexMod._private;

const CRM_ENV_PREV = {
  PERSEO_V3_ENABLED: process.env.PERSEO_V3_ENABLED,
  PERSEO_V3_CRM_EXECUTE: process.env.PERSEO_V3_CRM_EXECUTE,
  PERSEO_V3_QA_ALLOWLIST: process.env.PERSEO_V3_QA_ALLOWLIST,
};

function enableCrmExecuteForAuditTests() {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST =
    '5218111111111,5218222222222,5218333333333,5218444444444,5218555555555,5218666666666,5218777777777';
}

test.before(() => {
  enableCrmExecuteForAuditTests();
});

test.after(() => {
  restoreCrmEnv();
});

function restoreCrmEnv() {
  for (const [k, v] of Object.entries(CRM_ENV_PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function v3CrmGateContext(fromPhone) {
  return {
    v3PrimaryAllowed: true,
    selectedPipeline: 'v3',
    logEvent: () => {},
    fromPhone,
  };
}

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
    or(expr) {
      if (typeof expr === 'string' && expr.includes('.eq.')) {
        const parts = expr.split(',');
        filters.push((row) =>
          parts.some((part) => {
            const i = part.indexOf('.eq.');
            if (i === -1) return false;
            const key = part.slice(0, i);
            const val = part.slice(i + 4);
            return row[key] === val;
          }),
        );
      }
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
        rows = [...rows].sort((a, b) => {
          if (a[key] === b[key]) return 0;
          if (a[key] == null) return 1;
          if (b[key] == null) return -1;
          return asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1);
        });
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
        rows = [...rows].sort((a, b) => {
          if (a[key] === b[key]) return 0;
          if (a[key] == null) return 1;
          if (b[key] == null) return -1;
          return asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1);
        });
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
        rows = [...rows].sort((a, b) => {
          if (a[key] === b[key]) return 0;
          if (a[key] == null) return 1;
          if (b[key] == null) return -1;
          return asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1);
        });
      }
      if (api._limit != null) rows = rows.slice(0, api._limit);
      return resolve({ data: rows, error: null });
    },
  };
  return api;
}

function buildAuditMockSupabase(db) {
  const events = [];
  const fromCalls = [];

  return {
    _events: events,
    _fromCalls: fromCalls,
    from(table) {
      fromCalls.push(table);
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

      return makeQuery(table, db, []);
    },
    async rpc(name, args) {
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }
      return {
        data: {
          success: true,
          lead_id: args.p_lead_id,
          assigned_agent_profile_id: 'agent-rpc-1',
          strategy: 'fallback',
          reason: 'fallback_agent',
        },
        error: null,
      };
    },
  };
}

function baseAuditDb(overrides = {}) {
  return {
    leads: [],
    contacts: [],
    properties: [
      {
        id: 'prop-a0470',
        listing_id: 'LUX-A0470',
        operation_type: 'sale',
        agent_profile_id: 'agent-prop-owner',
      },
    ],
    conversations: [
      {
        id: 'conv-audit-1',
        phone: '5218111111111',
        channel: 'whatsapp',
        lead_id: null,
        contact_id: null,
        assigned_agent_profile_id: null,
        ...overrides.conversation,
      },
    ],
    conversation_events: [],
    pipeline_stages: [
      { id: 'stage-d', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      { id: 'stage-s', code: 'new', lead_type: 'supply', is_active: true, stage_order: 1 },
    ],
    lead_assignments: [],
    assignment_god_modes: [],
    assignment_rules: [],
    assignment_rule_agents: [],
    assignment_settings: [],
    assignment_logs: [],
  };
}

function advanceAiState(prev, text) {
  const inboundContext = { media: { type: 'text' } };
  const parsed = parseMessageSignals(text, prev, inboundContext);
  const changeType = detectStateChange(prev, parsed);
  return buildNextState(prev, parsed, changeType);
}

test('P4: index.js no referencia operativa a public.requests', () => {
  const src = fs.readFileSync(indexPath, 'utf8');
  assert.match(src, /\.from\(\s*['"]conversations['"]/);
  assert.doesNotMatch(src, /\.from\(\s*['"]requests['"]\s*\)/);
});

test('P4: normalizeListingCodeForLookup (A0470 → LUX-A0470)', () => {
  assert.equal(normalizeListingCodeForLookup('a0470'), 'LUX-A0470');
  assert.equal(normalizeListingCodeForLookup('LUX-A0470'), 'LUX-A0470');
});

test('P4: fetchPropertyByListingCode usa tabla properties', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);
  const r = await fetchPropertyByListingCode(supabase, 'A0470');
  assert.equal(r.propertyId, 'prop-a0470');
  assert.equal(r.property?.listing_id, 'LUX-A0470');
  assert.ok(supabase._fromCalls.includes('properties'));
  assert.ok(!supabase._fromCalls.includes('requests'));
});

test('P4 flujo A compra: demand + contacto + lead tras secuencia (último mensaje solo presupuesto)', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);

  let s = getDefaultAiState();
  for (const t of ['Hola, busco casa en Cumbres', 'Soy Roberto', '8 millones']) {
    s = advanceAiState(s, t);
  }

  const parsed = parseMessageSignals('8 millones', s, { media: { type: 'text' } });
  const out = await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState: s,
    parsedSignals: parsed,
    text: '8 millones',
    contact: null,
    from: '5218111111111',
    waProfileName: null,
    rawPayload: {},
    property: null,
    propertyId: null,
    crmGateContext: v3CrmGateContext('5218111111111'),
  });

  assert.equal(out.hasIntent, true);
  assert.equal(out.canEnsureContact, true);
  assert.ok(out.contactId);
  assert.equal(out.leadResult?.success, true);
  assert.equal(out.leadResult?.wasCreated, true);
  const lead = db.leads[0];
  assert.equal(lead.lead_type, 'demand');
  assert.equal(lead.contact_id, out.contactId);
  assert.equal(db.conversations[0].lead_id, lead.id);
  const types = supabase._events.map((e) => e.type);
  assert.ok(types.includes('contact_created'));
  assert.ok(types.includes('lead_intent_detected') || db.conversation_events.some((e) => e.type === 'lead_intent_detected'));
  // assignLead solo corre si shouldTriggerHandoff (score/visit/etc.); demand con score medio puede quedar sin agente aún
});

test('P4 flujo B venta: offer/supply con estado explícito (parser legacy puede marcar demand)', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);

  const nextAiState = {
    ...getDefaultAiState(),
    lead_flow: 'offer',
    operation_type: 'sale',
    location_text: 'Cumbres',
    full_name: 'Roberto',
    user_goal: 'list_property',
  };
  const parsed = parseMessageSignals('Está en Cumbres', nextAiState, { media: { type: 'text' } });

  const out = await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState,
    parsedSignals: parsed,
    text: 'Está en Cumbres',
    contact: null,
    from: '5218222222222',
    waProfileName: null,
    rawPayload: {},
    property: null,
    propertyId: null,
    crmGateContext: v3CrmGateContext('5218222222222'),
  });

  assert.equal(out.leadResult?.success, true);
  assert.equal(db.leads[0].lead_type, 'supply');
});

test('P4 flujo C propiedad: demand con interested_property_id cuando existe listing', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);

  const nextAiState = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    full_name: 'Roberto',
    direct_property_reference: true,
    property_code: 'LUX-A0470',
    asks_property_details: true,
    operation_type: 'sale',
  };
  const parsed = parseMessageSignals('Me interesa la propiedad A0470', nextAiState, { media: { type: 'text' } });
  const prop = db.properties[0];

  const out = await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState,
    parsedSignals: parsed,
    text: 'Soy Roberto',
    contact: null,
    from: '5218333333333',
    waProfileName: null,
    rawPayload: {},
    property: prop,
    propertyId: prop.id,
    crmGateContext: v3CrmGateContext('5218333333333'),
  });

  assert.equal(out.leadResult?.success, true);
  assert.equal(db.leads[0].interested_property_id, 'prop-a0470');
});

test('P4 D: segunda ejecución CRM no duplica lead compatible', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);

  const nextAiState = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
    budget_max: 8_000_000,
    full_name: 'Roberto',
  };
  const parsed = parseMessageSignals('ok', nextAiState, { media: { type: 'text' } });

  const args = {
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState,
    parsedSignals: parsed,
    text: 'ok',
    contact: null,
    from: '5218444444444',
    waProfileName: null,
    rawPayload: {},
    property: null,
    propertyId: null,
    crmGateContext: v3CrmGateContext('5218444444444'),
  };

  const first = await runCleanOrchestratorCrmPhase(args);
  db.conversations[0].lead_id = first.leadResult?.leadId || null;
  const second = await runCleanOrchestratorCrmPhase(args);

  assert.equal(first.leadResult?.wasCreated, true);
  assert.equal(second.leadResult?.wasCreated, false);
  assert.equal(db.leads.length, 1);
});

test('P4 E: contacto existente por WhatsApp — reused + agente del contacto', async () => {
  const db = baseAuditDb({
    conversation: { contact_id: null },
  });
  db.contacts.push({
    id: 'contact-existing',
    whatsapp: '5218555555555',
    phone: '5218555555555',
    first_name: 'Roberto',
    last_name: 'Pérez',
    assigned_agent_profile_id: 'agent-contact-owner',
  });
  const supabase = buildAuditMockSupabase(db);

  const nextAiState = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Mitras',
    budget_max: 5_000_000,
    full_name: 'Roberto',
  };
  const parsed = parseMessageSignals('sigo interesado', nextAiState, { media: { type: 'text' } });

  const out = await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState,
    parsedSignals: parsed,
    text: 'sigo interesado',
    contact: db.contacts[0],
    from: '5218555555555',
    waProfileName: null,
    rawPayload: {},
    property: null,
    propertyId: null,
    crmGateContext: v3CrmGateContext('5218555555555'),
  });

  assert.equal(out.contactId, 'contact-existing');
  assert.ok(supabase._events.some((e) => e.type === 'contact_reused'));
  assert.equal(out.leadResult?.success, true);
});

test('P4 F: sin nombre válido — no lead aunque haya intención en estado', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);

  const nextAiState = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    location_text: 'Cumbres',
    full_name: null,
  };
  const parsed = parseMessageSignals('busco casa', nextAiState, { media: { type: 'text' } });

  const out = await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState,
    parsedSignals: parsed,
    text: 'busco casa en Cumbres',
    contact: null,
    from: '5218666666666',
    waProfileName: null,
    rawPayload: {},
    property: null,
    propertyId: null,
    crmGateContext: v3CrmGateContext('5218666666666'),
  });

  assert.equal(out.hasIntent, true);
  assert.equal(out.canEnsureContact, false);
  assert.equal(out.contactId, null);
  assert.equal(out.leadResult, null);
  assert.equal(db.leads.length, 0);
});

test('P4: contacto nuevo no envía assigned_agent_profile_id en insert (auditoría)', async () => {
  const db = baseAuditDb();
  const supabase = buildAuditMockSupabase(db);

  const nextAiState = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Centro',
    budget_max: 3_000_000,
    full_name: 'Laura Méndez',
  };
  const parsed = parseMessageSignals('gracias', nextAiState, { media: { type: 'text' } });

  await runCleanOrchestratorCrmPhase({
    supabase,
    conversationId: 'conv-audit-1',
    conversationRow: db.conversations[0],
    nextAiState,
    parsedSignals: parsed,
    text: 'gracias',
    contact: null,
    from: '5218777777777',
    waProfileName: null,
    rawPayload: {},
    property: null,
    propertyId: null,
    crmGateContext: v3CrmGateContext('5218777777777'),
  });

  const created = db.contacts.find((c) => c.whatsapp === '5218777777777');
  assert.ok(created);
  assert.equal(Object.prototype.hasOwnProperty.call(created, 'assigned_agent_profile_id'), false);
  assert.ok(db.leads[0]);
});
