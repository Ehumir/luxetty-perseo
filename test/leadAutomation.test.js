const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOrReuseLeadFromConversation,
  detectLeadCreationOpportunity,
  extractCampaignReferralContext,
} = require('../services/leadAutomation');
const { normalizePhoneNumber } = require('../utils/helpers');

function makeQuery(table, db, filters = []) {
  const api = {
    _update: null,
    _inserted: null,
    _order: null,
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

function buildMockSupabase(db) {
  let rpcCalls = 0;

  return {
    _getRpcCalls() {
      return rpcCalls;
    },
    from(table) {
      if (!db[table]) db[table] = [];
      return makeQuery(table, db);
    },
    async rpc(name, args) {
      rpcCalls += 1;
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
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

test('property interest without contact does not create lead', async () => {
  const db = {
    leads: [],
    contacts: [],
    conversations: [{ id: 'conv-1', phone: '5218111111111', channel: 'whatsapp', lead_id: null, contact_id: null }],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0453',
      asks_property_details: true,
      intent_type: 'property_interest',
    },
    contactId: null,
    propertyId: 'prop-1',
    property: { id: 'prop-1', listing_id: 'LUX-A0453', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'missing_contact');
  assert.equal(db.leads.length, 0);
});

test('retries after contact is linked and then creates lead', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-retry', whatsapp: '5218333333333' }],
    conversations: [{ id: 'conv-retry', phone: '5218333333333', channel: 'whatsapp', lead_id: null, contact_id: null }],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);
  const aiState = {
    lead_flow: 'demand',
    direct_property_reference: true,
    property_code: 'LUX-A0470',
    asks_property_details: true,
    intent_type: 'property_interest',
  };

  const first = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    contactId: null,
    propertyId: 'prop-retry',
    property: { id: 'prop-retry', listing_id: 'LUX-A0470', operation_type: 'sale' },
    logger: console,
  });
  assert.equal(first.success, false);
  assert.equal(first.reason, 'missing_contact');
  assert.equal(db.leads.length, 0);

  db.conversations[0].contact_id = 'contact-retry';
  const second = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState,
    contactId: 'contact-retry',
    propertyId: 'prop-retry',
    property: { id: 'prop-retry', listing_id: 'LUX-A0470', operation_type: 'sale', agent_profile_id: 'agent-yolanda' },
    logger: console,
  });
  assert.equal(second.success, true);
  assert.ok(second.leadId);
  assert.equal(db.leads.length, 1);
  assert.equal(db.leads[0].contact_id, 'contact-retry');
  assert.equal(db.conversations[0].lead_id, second.leadId);
});

test('property interest with existing conversation lead does not duplicate', async () => {
  const db = {
    leads: [{
      id: 'lead-1',
      contact_id: 'contact-1',
      lead_type: 'demand',
      interested_in_operation: 'sale',
      interested_property_id: 'prop-1',
      is_active: true,
      is_archived: false,
      notes_summary: 'existing',
    }],
    contacts: [{ id: 'contact-1', whatsapp: '5218111111111' }],
    conversations: [{ id: 'conv-2', phone: '5218111111111', channel: 'whatsapp', lead_id: 'lead-1', contact_id: 'contact-1' }],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_id: 'lead-1',
      lead_flow: 'demand',
      property_code: 'LUX-A0453',
      direct_property_reference: true,
      intent_type: 'property_interest',
      asks_property_details: true,
    },
    contactId: 'contact-1',
    propertyId: 'prop-1',
    property: { id: 'prop-1', listing_id: 'LUX-A0453', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, false);
  assert.equal(result.leadId, 'lead-1');
  assert.equal(db.leads.length, 1);
});

test('property interest links existing open lead by contact and property', async () => {
  const db = {
    leads: [{
      id: 'lead-2',
      contact_id: 'contact-2',
      lead_type: 'demand',
      interested_in_operation: 'sale',
      interested_property_id: 'prop-2',
      is_active: true,
      is_archived: false,
      notes_summary: 'existing open lead',
    }],
    contacts: [{ id: 'contact-2', whatsapp: '5218222222222' }],
    conversations: [{ id: 'conv-3', phone: '5218222222222', channel: 'whatsapp', lead_id: null, contact_id: 'contact-2' }],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-B0020',
      wants_visit: true,
      intent_type: 'property_interest',
    },
    contactId: 'contact-2',
    propertyId: 'prop-2',
    property: { id: 'prop-2', listing_id: 'LUX-B0020', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, false);
  assert.equal(result.leadId, 'lead-2');
  assert.equal(db.leads.length, 1);
});

test('contact without property context does not create lead', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-noproperty', whatsapp: '5218444444444' }],
    conversations: [{ id: 'conv-noproperty', phone: '5218444444444', channel: 'whatsapp', lead_id: null, contact_id: 'contact-noproperty' }],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);
  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      confidence: 'low',
      user_goal: null,
      direct_property_reference: false,
    },
    contactId: 'contact-noproperty',
    propertyId: null,
    property: null,
    logger: console,
  });

  assert.equal(result.success, false);
  assert.equal(db.leads.length, 0);
});

test('extractCampaignReferralContext detects campaign/ad context from referral', () => {
  const extracted = extractCampaignReferralContext({
    referral: {
      source_type: 'ad',
      source_id: 'src-10',
      source_url: 'https://facebook.com/ads/x?utm_source=meta&utm_campaign=mty_houses',
      ad_id: 'ad-10',
      ad_name: 'Casa MTY',
      adgroup_id: 'ag-10',
      campaign_id: 'cmp-10',
      campaign_name: 'Campana MTY',
      ctwa_clid: 'clid-10',
    },
    messageText: 'Hola, vi su anuncio en Facebook',
  });

  assert.equal(extracted.hasCampaignContext, true);
  assert.equal(extracted.campaignContext.ad_id, 'ad-10');
  assert.equal(extracted.campaignContext.campaign_id, 'cmp-10');
  assert.equal(extracted.campaignContext.source_platform, 'facebook');
  assert.equal(extracted.campaignContext.utm.utm_campaign, 'mty_houses');
});

test('extractCampaignReferralContext handles missing referral safely', () => {
  const extracted = extractCampaignReferralContext({ messageText: 'Hola, buen día' });
  assert.equal(extracted.hasCampaignContext, false);
  assert.equal(extracted.referralContext, null);
});

test('detectLeadCreationOpportunity rejects ambiguous message', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: null, direct_property_reference: false },
    propertyId: null,
    messageText: 'hola',
  });

  assert.equal(opportunity.shouldCreate, false);
});

test('detectLeadCreationOpportunity rejects when property reference has no property found', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: 'demand', direct_property_reference: true, property_code: 'LUX-A0453' },
    propertyId: null,
    propertyCode: 'LUX-A0453',
    messageText: 'me interesa la propiedad LUX-A0453',
  });

  assert.equal(opportunity.shouldCreate, false);
  assert.equal(opportunity.reason, 'property_not_found_for_reference');
});

test('detectLeadCreationOpportunity accepts explicit property interest when property exists', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: 'demand', direct_property_reference: true, asks_property_details: true },
    propertyId: 'prop-77',
    propertyCode: 'LUX-C0077',
    messageText: 'me interesa esta propiedad',
  });

  assert.equal(opportunity.shouldCreate, true);
});

test('detectLeadCreationOpportunity accepts short Info with campaign + resolved property', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: {
      lead_flow: null,
      campaign_context: { property_code: 'LUX-A0470' },
    },
    propertyId: 'prop-a0470',
    propertyCode: 'LUX-A0470',
    messageText: 'Info',
    hasCampaignContext: true,
  });

  assert.equal(opportunity.shouldCreate, true);
  assert.ok(
    opportunity.reason === 'property_interest_detected' ||
      opportunity.reason === 'campaign_property_interest_detected',
  );
});

test('property owner agent assignment has priority and bypasses fallback engine', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-x', whatsapp: '5218111111111' }],
    conversations: [{ id: 'conv-x', phone: '5218111111111', channel: 'whatsapp', lead_id: null, contact_id: 'contact-x' }],
    conversation_events: [],
    lead_assignments: [],
    assignment_logs: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      direct_property_reference: true,
      property_code: 'LUX-A0453',
      asks_property_details: true,
      intent_type: 'property_interest',
    },
    contactId: 'contact-x',
    propertyId: 'prop-x',
    property: { id: 'prop-x', listing_id: 'LUX-A0453', operation_type: 'sale', agent_profile_id: 'agent-owner-1' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.assignedAgentProfileId, 'agent-owner-1');
  assert.equal(db.leads[0].assigned_agent_profile_id, 'agent-owner-1');
  assert.equal(db.conversations[0].assigned_agent_profile_id, 'agent-owner-1');
  assert.equal(db.lead_assignments.filter((row) => row.is_current).length, 1);
  assert.equal(db.assignment_logs.some((row) => row.reason === 'assigned_by_property_owner_agent'), true);
  assert.equal(supabase._getRpcCalls(), 0);
});

test('property without owner agent uses assignment rule before fallback', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-r', whatsapp: '5218111111111' }],
    conversations: [{ id: 'conv-r', phone: '5218111111111', channel: 'whatsapp', lead_id: null, contact_id: 'contact-r' }],
    conversation_events: [],
    lead_assignments: [],
    assignment_logs: [],
    assignment_rules: [{ id: 'rule-1', is_active: true, priority: 1, operation_type: 'sale' }],
    assignment_rule_agents: [{ id: 'rule-agent-1', assignment_rule_id: 'rule-1', agent_profile_id: 'agent-rule-1', is_active: true, priority: 1 }],
    assignment_settings: [{ id: 'settings-1', is_active: true, fallback_agent_profile_id: 'agent-fallback-1' }],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      direct_property_reference: true,
      property_code: 'LUX-B0001',
      asks_property_details: true,
      intent_type: 'property_interest',
    },
    contactId: 'contact-r',
    propertyId: 'prop-r',
    property: { id: 'prop-r', listing_id: 'LUX-B0001', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.assignedAgentProfileId, 'agent-rule-1');
  assert.equal(db.assignment_logs.some((row) => row.reason === 'assigned_by_rule'), true);
});

test('seller generic flow creates supply lead and no property id invention', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-s', whatsapp: '5218111111111' }],
    conversations: [{ id: 'conv-s', phone: '5218111111111', channel: 'whatsapp', lead_id: null, contact_id: 'contact-s' }],
    conversation_events: [],
    assignment_settings: [{ id: 'settings-1', is_active: true, fallback_agent_profile_id: 'agent-fallback-1' }],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'supply', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Cumbres',
      property_type: 'house',
      budget_max: 4500000,
      confidence: 'high',
    },
    contactId: 'contact-s',
    propertyId: null,
    property: null,
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(db.leads[0].lead_type, 'supply');
  assert.equal(db.leads[0].interested_property_id, null);
});

test('duplicate processing does not create duplicate current lead assignments', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-d', whatsapp: '5218111111111' }],
    conversations: [{ id: 'conv-d', phone: '5218111111111', channel: 'whatsapp', lead_id: null, contact_id: 'contact-d' }],
    conversation_events: [],
    lead_assignments: [],
    assignment_logs: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);
  const payload = {
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      direct_property_reference: true,
      property_code: 'LUX-D0101',
      asks_property_details: true,
      intent_type: 'property_interest',
    },
    contactId: 'contact-d',
    propertyId: 'prop-d',
    property: { id: 'prop-d', listing_id: 'LUX-D0101', operation_type: 'sale', agent_profile_id: 'agent-owner-2' },
    logger: console,
  };

  const first = await createOrReuseLeadFromConversation(payload);
  db.conversations[0].lead_id = first.leadId;
  await createOrReuseLeadFromConversation(payload);

  const currentAssignments = db.lead_assignments.filter((row) => row.is_current);
  assert.equal(currentAssignments.length, 1);
});

test('normalization prevents duplicates across mexican phone formats', () => {
  assert.equal(normalizePhoneNumber('+52 81 1234 5678'), '5218112345678');
  assert.equal(normalizePhoneNumber('52-81-1234-5678'), '5218112345678');
  assert.equal(normalizePhoneNumber('5218112345678'), '5218112345678');
  assert.equal(normalizePhoneNumber('(81) 1234 5678'), '5218112345678');
});

test('no rule and no fallback does not crash and leaves assignment pending', async () => {
  const db = {
    leads: [],
    contacts: [{ id: 'contact-n', whatsapp: '5218111111111' }],
    conversations: [{ id: 'conv-n', phone: '5218111111111', channel: 'whatsapp', lead_id: null, contact_id: 'contact-n' }],
    conversation_events: [],
    assignment_rules: [],
    assignment_rule_agents: [],
    assignment_settings: [{ id: 'settings-1', is_active: true, fallback_agent_profile_id: null }],
    assignment_god_modes: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = buildMockSupabase(db);

  // Forzamos RPC sin asignación para simular ausencia total.
  supabase.rpc = async () => ({ data: { success: false, reason: 'no_assignment_match' }, error: null });

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Monterrey',
      budget_max: 5000000,
      direct_property_reference: true,
      property_code: 'LUX-N0001',
      asks_property_details: true,
      confidence: 'high',
      intent_type: 'property_interest',
    },
    contactId: 'contact-n',
    propertyId: 'prop-n',
    property: { id: 'prop-n', listing_id: 'LUX-N0001', operation_type: 'sale' },
    logger: console,
  });

  assert.equal(result.success, true);
  assert.equal(result.assignedAgentProfileId, null);
  assert.equal(db.conversation_events.some((event) => event.type === 'lead_assignment_failed'), true);
});
