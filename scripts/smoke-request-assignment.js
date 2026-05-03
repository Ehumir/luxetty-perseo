/*
 * Legacy filename kept for compatibility.
 * IA.1 smoke test: Solicitud = public.leads. No public.requests path is used.
 *
 * Run:
 *   node scripts/smoke-request-assignment.js
 */

const { createOrReuseLeadFromConversation } = require('../services/leadAutomation');

function makeQuery(table, db, filters = []) {
  const api = {
    select() { return api; },
    insert(payload) {
      db[table].push({ id: `${table}-${db[table].length + 1}`, created_at: new Date().toISOString(), ...payload });
      return api;
    },
    update(payload) {
      api._update = payload;
      return api;
    },
    eq(key, value) {
      filters.push((row) => row[key] === value);
      api._lastEq = { key, value };
      return api;
    },
    is(key, value) {
      filters.push((row) => row[key] === value);
      return api;
    },
    order() { return api; },
    limit() { return api; },
    async maybeSingle() {
      if (api._update) {
        db[table] = db[table].map((row) => (
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row
        ));
      }
      return { data: db[table].filter((row) => filters.every((fn) => fn(row)))[0] || null, error: null };
    },
    async single() {
      if (api._update) {
        db[table] = db[table].map((row) => (
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row
        ));
      }
      return { data: db[table].filter((row) => filters.every((fn) => fn(row)))[0] || null, error: null };
    },
    then(resolve) {
      if (api._update) {
        db[table] = db[table].map((row) => (
          !api._lastEq || row[api._lastEq.key] === api._lastEq.value ? { ...row, ...api._update } : row
        ));
        return resolve({ data: null, error: null });
      }
      return resolve({ data: db[table].filter((row) => filters.every((fn) => fn(row))), error: null });
    },
  };
  return api;
}

async function main() {
  let assignRpcCalls = 0;

  const db = {
    leads: [],
    contacts: [
      { id: 'contact-1', full_name: 'Lead Sin Agente', whatsapp: '5218100000000' },
      { id: 'contact-2', full_name: 'Lead Con Agente', whatsapp: '5218100000001', assigned_agent_profile_id: 'agent-contact-2' },
    ],
    conversations: [
      { id: 'conv-1', phone: '+528100000000', channel: 'whatsapp', lead_id: null, contact_id: 'contact-1' },
      { id: 'conv-2', phone: '+528100000001', channel: 'whatsapp', lead_id: null, contact_id: 'contact-2' },
    ],
    conversation_events: [],
    pipeline_stages: [{ id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 }],
  };

  const supabase = {
    from(table) {
      if (!db[table]) db[table] = [];
      return makeQuery(table, db);
    },
    async rpc(name, args) {
      if (name !== 'assign_lead_via_engine') throw new Error(`Unexpected RPC: ${name}`);
      assignRpcCalls += 1;
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

  const first = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      property_type: 'house',
      location_text: 'Garcia',
      budget_max: 1300000,
      budget_currency: 'MXN',
    },
    contactId: 'contact-1',
    propertyId: null,
    logger: console,
  });

  db.conversations[0].lead_id = first.leadId;

  const second = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_id: first.leadId,
      lead_flow: 'demand',
      operation_type: 'sale',
      property_type: 'house',
      location_text: 'Garcia',
      budget_max: 1300000,
      budget_currency: 'MXN',
    },
    contactId: 'contact-1',
    propertyId: null,
    logger: console,
  });

  if (!first.success || !first.wasCreated) throw new Error('Expected first call to create lead');
  if (!second.success || second.wasCreated) throw new Error('Expected second call to reuse lead');
  if (db.leads.length !== 1) throw new Error(`Expected 1 lead, got ${db.leads.length}`);
  if (db.leads[0].phone !== '5218100000000') throw new Error(`Expected normalized 521 phone, got ${db.leads[0].phone}`);

  const third = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[0],
    aiState: {
      lead_id: first.leadId,
      lead_flow: 'offer',
      operation_type: 'sale',
      property_type: 'house',
      location_text: 'Cumbres',
    },
    contactId: 'contact-1',
    propertyId: null,
    logger: console,
  });

  if (!third.success || !third.wasCreated) throw new Error('Expected intent change to create a new supply lead');
  if (db.leads.length !== 2) throw new Error(`Expected 2 leads after intent change, got ${db.leads.length}`);
  if (db.leads[1].lead_type !== 'supply') throw new Error(`Expected supply lead, got ${db.leads[1].lead_type}`);

  const rpcCallsBeforeContactOwner = assignRpcCalls;

  const fourth = await createOrReuseLeadFromConversation({
    supabase,
    conversation: db.conversations[1],
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      property_type: 'apartment',
      location_text: 'San Pedro',
      budget_max: 7500000,
      budget_currency: 'MXN',
      wants_visit: true,
    },
    contactId: 'contact-2',
    propertyId: null,
    logger: console,
  });

  if (!fourth.success || !fourth.wasCreated) {
    throw new Error('Expected contact owner flow to create lead successfully');
  }
  if (fourth.assignedAgentProfileId !== 'agent-contact-2') {
    throw new Error(`Expected assignment to contact owner agent, got ${fourth.assignedAgentProfileId}`);
  }
  if (assignRpcCalls !== rpcCallsBeforeContactOwner) {
    throw new Error('Expected assign_lead_via_engine to be bypassed for contact owner flow');
  }
  if (!String(fourth.lead?.notes_summary || '').includes('Motivo de asignacion: contacto ya registrado con agente asignado.')) {
    throw new Error('Expected detailed assignment reason in lead notes for contact owner flow');
  }

  console.log('PASS IA.1 lead automation smoke');
}

main().catch((err) => {
  console.error('FAIL IA.1 lead automation smoke', err);
  process.exit(1);
});
