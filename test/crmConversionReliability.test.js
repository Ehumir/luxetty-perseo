const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractCampaignReferralContext,
  detectLeadCreationOpportunity,
  createOrReuseLeadFromConversation,
} = require('../services/leadAutomation');
const { buildLowInfoCampaignReply, buildDemandReply } = require('../conversation/responseBuilder');
const { evaluateCommercialCloseDecision } = require('../conversation/inboundReliability');

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
    or() {
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

function buildMockSupabase(db) {
  return {
    from(table) {
      if (!db[table]) db[table] = [];
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
          assigned_agent_profile_id: 'agent-fallback-1',
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
    assignment_settings: [{ id: 'settings-1', is_active: true, fallback_agent_profile_id: 'agent-fallback-1' }],
    assignment_logs: [],
  };
}

test('Caso A: pauta captacion + Hola orienta a venta/valuacion', () => {
  const extracted = extractCampaignReferralContext({
    referral: {
      source_url: 'https://facebook.com/ad?utm_campaign=captacion_propietarios',
      ad_name: 'Captacion propietarios MTY',
      headline: 'Vende tu propiedad con Luxetty',
    },
    messageText: 'Hola',
  });

  const reply = buildLowInfoCampaignReply(true, extracted.campaignContext);

  assert.equal(extracted.campaignContext.campaign_type, 'seller_capture');
  assert.match(reply, /anuncio para propietarios/i);
  assert.match(reply, /vender|valuaci[oó]n/i);
});

test('Caso B: referral de propiedad + Precio usa propiedad contextual', () => {
  const extracted = extractCampaignReferralContext({
    referral: {
      source_url: 'https://luxetty.com/propiedad/casa-cumbres-LUX-A0453',
      ad_name: 'Propiedad LUX-A0453',
    },
    messageText: 'Precio',
  });

  assert.equal(extracted.campaignContext.property_code, 'LUX-A0453');
  assert.equal(extracted.campaignContext.campaign_type, 'property_listing');
});

test('Caso C: Quiero verla dispara cierre comercial con contexto', () => {
  const decision = evaluateCommercialCloseDecision({
    text: 'Quiero verla',
    state: { lead_flow: 'demand', property_code: 'LUX-A0453', direct_property_reference: true },
    hasPropertyContext: true,
  });

  assert.equal(decision.shouldClose, true);
  assert.equal(decision.shouldClarify, false);
});

test('Caso D: Sí, ese es mi número cierra con contexto previo', () => {
  const decision = evaluateCommercialCloseDecision({
    text: 'Sí, ese es mi número',
    state: { lead_flow: 'demand', wants_human: true },
    hasPropertyContext: false,
  });

  assert.equal(decision.shouldClose, true);
  assert.equal(decision.reason.includes('close'), true);
});

test('Caso E: lead valido con propiedad responsable asigna agente de propiedad', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      property_code: 'LUX-A0453',
      direct_property_reference: true,
      asks_property_details: true,
      wants_visit: true,
      intent_type: 'property_interest',
    },
    contactId: 'contact-1',
    propertyId: 'prop-1',
    property: { id: 'prop-1', listing_id: 'LUX-A0453', operation_type: 'sale', agent_profile_id: 'agent-owner-1' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.assignedAgentProfileId, 'agent-owner-1');
});

test('Caso F: lead valido sin agente claro usa fallback y no queda vacio', async () => {
  const db = baseDb();
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 3500000,
      asks_property_details: true,
      wants_human: true,
      confidence: 'high',
    },
    contactId: 'contact-1',
    propertyId: null,
    property: null,
    logger: console,
  });

  assert.equal(result.success, true);
  assert.ok(result.assignedAgentProfileId);
});

test('Caso G: Hola ambiguo sin contexto no crea lead', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: null, direct_property_reference: false },
    propertyId: null,
    messageText: 'Hola',
    hasCampaignContext: false,
  });

  assert.equal(opportunity.shouldCreate, false);
});

test('Caso H: LUX-A0453 responde con link + CTA, no solo link', () => {
  const reply = buildDemandReply(
    {
      lead_flow: 'demand',
      operation_type: 'sale',
      property_code: 'LUX-A0453',
      direct_property_reference: true,
      full_name: 'Ana',
    },
    'append_info',
    [{ id: 'prop-1', listing_id: 'LUX-A0453', slug: 'casa-cumbres-a0453', neighborhood: 'Cumbres' }],
    'direct_property_code'
  );

  const text = Array.isArray(reply) ? reply.join(' ') : reply;
  assert.match(text, /https:\/\/luxetty\.com\/propiedad\//i);
  assert.match(text, /confirm(e|ar).*disponibilidad|visita/i);
});
