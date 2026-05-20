#!/usr/bin/env node
'use strict';

/**
 * Auditoría post-smoke M4-05a (staging QA, flex ON).
 *
 *   node scripts/staging-wa-flex-smoke-check.js <phone> [smoke_id]
 *
 * Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PERSEO_CONVERSATIONAL_FLEX_ENABLED=true en Railway QA.
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');

const phone = process.argv[2];
const smokeId = process.argv[3] || 'ALL';

if (!phone) {
  console.error('Usage: node scripts/staging-wa-flex-smoke-check.js <phone> [FLEX1|FLEX2|FLEX3|FLEX4]');
  process.exit(1);
}

async function main() {
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, phone, updated_at')
    .eq('phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1);

  const conv = convs?.[0];
  if (!conv) {
    console.log(JSON.stringify({ ok: false, error: 'no_conversation', phone }, null, 2));
    process.exit(1);
  }

  const { data: gates } = await supabase
    .from('conversation_events')
    .select('created_at, type, payload')
    .eq('conversation_id', conv.id)
    .in('type', ['v3_primary_gate', 'perseo_flex_applied'])
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: msgs } = await supabase
    .from('conversation_messages')
    .select('created_at, direction, message_text, raw_payload')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(12);

  const { data: stateRow } = await supabase
    .from('conversations')
    .select('ai_state')
    .eq('id', conv.id)
    .maybeSingle();

  const ai = stateRow?.ai_state || {};
  const outbound = (msgs || [])
    .filter((m) => m.direction === 'outbound')
    .map((m) => ({
      at: m.created_at,
      text: (m.message_text || '').slice(0, 160),
      response_source: m.raw_payload?.perseo_metadata?.response_source || null,
    }));

  const flexEvents = (gates || []).filter((g) => g.type === 'perseo_flex_applied');

  const report = {
    ok: true,
    smoke_id: smokeId,
    phone,
    conversation_id: conv.id,
    flex_flag_expected: 'PERSEO_CONVERSATIONAL_FLEX_ENABLED=true (Railway QA only)',
    last_outbound: outbound[0] || null,
    outbound_tail: outbound.slice(0, 6),
    v3_primary_gate_events: (gates || [])
      .filter((g) => g.type === 'v3_primary_gate')
      .map((g) => ({ at: g.created_at, ...g.payload })),
    flex_applied_events: flexEvents.map((g) => ({ at: g.created_at, ...g.payload })),
    ai_state_snapshot: {
      location_text: ai.location_text || null,
      budget_max: ai.budget_max ?? null,
      occupancy_status: ai.occupancy_status || null,
      advisor_contact_consent: ai.advisor_contact_consent || null,
      conversation_stage: ai.conversation_stage || null,
      lead_flow: ai.lead_flow || null,
      v3_primary_active: ai.v3_primary_active ?? null,
      conversation_soft_closed: ai.conversation_soft_closed ?? null,
      explicit_reopen: ai.explicit_reopen ?? null,
    },
    checks: {
      v3_primary_active: ai.v3_primary_active === true,
      not_fallback_consultive: outbound.every((o) => o.response_source !== 'fallback_consultive'),
      flex_events_present: flexEvents.length > 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
