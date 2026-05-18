'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { _planContact, previewContactForConversation } = require('../services/contactProvisioning');
const { _planLead, previewLeadFromConversation } = require('../services/leadAutomation');

function makeQuery(table, db, filters = []) {
  const api = {
    _inserted: null,
    select() {
      return api;
    },
    insert(payload) {
      const row = { id: `${table}-1`, ...payload };
      db[table].push(row);
      api._inserted = row;
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
    limit() {
      return api;
    },
    order() {
      return api;
    },
    async maybeSingle() {
      const rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      return { data: rows[0] || null, error: null };
    },
    async single() {
      if (api._inserted) return { data: api._inserted, error: null };
      return api.maybeSingle();
    },
    then(resolve, reject) {
      this.maybeSingle()
        .then((r) => resolve({ data: r.data ? [r.data] : [], error: null }))
        .catch(reject);
    },
  };
  return api;
}

function makeSupabase(db) {
  return {
    from(table) {
      return makeQuery(table, db, []);
    },
  };
}

describe('argosPreviewParity', () => {
  it('previewContactForConversation delegates to _planContact', async () => {
    const db = { contacts: [] };
    const supabase = makeSupabase(db);
    const conversationRow = { id: 'conv-1', contact_id: null };
    const plan = await _planContact({
      supabase,
      conversationRow,
      state: { full_name: 'Jorge' },
      phone: '5218100000001',
    });
    const preview = await previewContactForConversation({
      supabase,
      conversationRow,
      state: { full_name: 'Jorge' },
      phone: '5218100000001',
    });
    assert.deepEqual(preview, plan);
    assert.equal(plan.action, 'would_create');
  });

  it('previewLeadFromConversation matches _planLead for reuse path', async () => {
    const contactId = 'contact-1';
    const leadId = 'lead-1';
    const db = {
      contacts: [
        {
          id: contactId,
          assigned_agent_profile_id: 'agent-owner',
          phone: '5218100000001',
        },
      ],
      leads: [
        {
          id: leadId,
          contact_id: contactId,
          lead_type: 'demand',
          interested_in_operation: null,
          interested_property_id: null,
          is_active: true,
          is_archived: false,
        },
      ],
    };
    const supabase = makeSupabase(db);
    const aiState = {
      lead_type: 'demand',
      lead_flow: 'demand',
      conversation_goal: 'buy_property',
      confidence: 'high',
      budget_max: 5000000,
      location_text: 'Cumbres',
    };
    const conversation = {
      id: 'conv-1',
      phone: '5218100000001',
      lead_id: leadId,
    };

    const plan = await _planLead({
      supabase,
      conversation,
      aiState,
      contactId,
      propertyId: null,
      contactWasCreated: false,
    });
    const preview = await previewLeadFromConversation({
      supabase,
      conversation,
      aiState,
      contactId,
      propertyId: null,
      contactWasCreated: false,
    });
    assert.deepEqual(preview, plan);
    assert.equal(plan.action, 'would_reuse');
    assert.equal(plan.assignment_strategy, 'contact_owner');
    assert.equal(plan.lead_id, leadId);
  });
});
