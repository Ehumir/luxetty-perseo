const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOrReuseLeadFromConversation,
  detectLeadCreationOpportunity,
  extractCampaignReferralContext,
} = require('../services/leadAutomation');

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
          assigned_agent_profile_id: 'agent-1',
          strategy: 'fallback',
          reason: 'fallback_agent',
        },
        error: null,
      };
    },
  };
}

test('property interest with real property creates lead even without contact', async () => {
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

  assert.equal(result.success, true);
  assert.equal(result.wasCreated, true);
  assert.equal(db.leads.length, 1);
  assert.equal(db.leads[0].contact_id, null);
  assert.equal(db.leads[0].interested_property_id, 'prop-1');
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
