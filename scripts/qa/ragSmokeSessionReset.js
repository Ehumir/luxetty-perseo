#!/usr/bin/env node
'use strict';

/**
 * Sprint 4 — Reset controlado de sesión QA para smoke RAG repetible.
 *
 * NO disponible en producción. Requiere:
 *   PERSEO_QA_SMOKE_RESET_ENABLED=true
 *   PERSEO_ENV=qa  OR  RAILWAY_ENVIRONMENT_NAME=qa  OR  --force-qa
 *
 * Usage:
 *   PERSEO_QA_SMOKE_RESET_ENABLED=true PERSEO_ENV=qa \
 *     node scripts/qa/ragSmokeSessionReset.js 5218181877351 [--json]
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const QA_DEFAULT_PHONE = '5218181877351';
const jsonOut = process.argv.includes('--json');
const forceQa = process.argv.includes('--force-qa');
const phoneArg = process.argv.find((a) => /^\d{10,13}$/.test(a.replace(/\D/g, '')));
const phone = String(phoneArg || process.env.RAG_SMOKE_PHONE || QA_DEFAULT_PHONE).replace(/\D/g, '');

function assertQaResetAllowed() {
  if (process.env.PERSEO_QA_SMOKE_RESET_ENABLED !== 'true') {
    throw new Error('PERSEO_QA_SMOKE_RESET_ENABLED must be true');
  }
  const envName = String(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.PERSEO_ENV || '').toLowerCase();
  if (forceQa) return { mode: 'force-qa' };
  if (envName === 'qa' || envName === 'staging') return { mode: envName };
  if (process.env.PERSEO_ENV === 'qa') return { mode: 'qa' };
  throw new Error(
    'QA smoke reset blocked outside QA/staging. Set PERSEO_ENV=qa or RAILWAY_ENVIRONMENT_NAME=qa, or use --force-qa locally.',
  );
}

function buildFreshAiState(existing = {}) {
  const keep = {
    contact_id: existing.contact_id ?? null,
    lead_id: existing.lead_id ?? null,
  };
  return {
    ...keep,
    property_code: null,
    direct_property_code: null,
    direct_property_reference: false,
    property_specific_intent: false,
    property_pauta_handoff_sent: false,
    property_context: null,
    interested_property_id: null,
    property_disambiguation_candidates: null,
    awaiting_field: null,
    qa_smoke_session: true,
    qa_smoke_reset_at: new Date().toISOString(),
  };
}

async function main() {
  const gate = assertQaResetAllowed();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(url, key);
  const { data: rows, error: fetchErr } = await supabase
    .from('conversations')
    .select('id, phone, ai_state')
    .eq('phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (fetchErr) throw fetchErr;

  const conv = rows?.[0];
  if (!conv?.id) {
    const result = { ok: true, phone, conversation_id: null, action: 'no_conversation', gate: gate.mode };
    if (jsonOut) console.log(JSON.stringify(result, null, 2));
    else console.log(`No conversation for ${phone} — nothing to reset`);
    return;
  }

  const nextState = buildFreshAiState(conv.ai_state || {});
  const { error: updErr } = await supabase
    .from('conversations')
    .update({ ai_state: nextState, updated_at: new Date().toISOString() })
    .eq('id', conv.id);

  if (updErr) throw updErr;

  await supabase.from('conversation_events').insert({
    conversation_id: conv.id,
    type: 'qa_smoke_session_reset',
    payload: {
      phone_masked: `***${phone.slice(-4)}`,
      reset_by: 'ragSmokeSessionReset',
      gate: gate.mode,
      cleared: ['property_pauta_handoff_sent', 'property_context', 'property_code'],
    },
  });

  const result = {
    ok: true,
    phone,
    conversation_id: conv.id,
    action: 'ai_state_reset',
    gate: gate.mode,
    cleared_pauta_handoff: true,
  };

  if (jsonOut) console.log(JSON.stringify(result, null, 2));
  else console.log(`QA smoke reset OK — conversation ${conv.id} (***${phone.slice(-4)})`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
