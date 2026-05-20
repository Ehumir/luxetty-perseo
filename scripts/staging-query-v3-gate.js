#!/usr/bin/env node
'use strict';

/**
 * Últimos eventos v3_primary_gate para un teléfono (auditoría B1/B2 sin Railway logs).
 *
 *   node scripts/staging-query-v3-gate.js 5218181877351
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');

const phone = process.argv[2] || '5218181877351';

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
    .select('created_at, payload')
    .eq('conversation_id', conv.id)
    .eq('type', 'v3_primary_gate')
    .order('created_at', { ascending: false })
    .limit(5);

  const { data: lastOut } = await supabase
    .from('conversation_messages')
    .select('created_at, message_text, raw_payload')
    .eq('conversation_id', conv.id)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1);

  const outSrc = lastOut?.[0]?.raw_payload?.perseo_metadata?.response_source || null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        phone,
        conversation_id: conv.id,
        last_outbound_response_source: outSrc,
        v3_primary_gate_events: (gates || []).map((g) => ({
          created_at: g.created_at,
          ...g.payload,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
