#!/usr/bin/env node
'use strict';

/**
 * MC-6 Fase 1 — Validación post-deploy (flag OFF).
 * Smoke prod: webhook, QA allowlist V3, sin property-entry bypass activo.
 *
 * Usage: node scripts/mc6-production-validation.js [--json]
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { VERIFY_TOKEN } = require('../config/env');
const { buildWebhookEnvelope, referralTextMessage, textMessage } = require('../test/helpers/whatsappFixtures');

const BASE_URL = (process.env.PERSEO_BASE_URL || 'https://luxetty-agent-production.up.railway.app').replace(/\/$/, '');
const QA_PHONE = String(process.env.MC6_QA_PHONE || process.env.MC5_QA_PHONE || '5218181877351').replace(/\D/g, '');
const jsonOut = process.argv.includes('--json');
const RUN_ID = `mc6prod-f1-${Date.now()}`;
const results = [];

function record(id, name, pass, detail = {}) {
  const row = { id, name, pass: !!pass, at: new Date().toISOString(), ...detail };
  results.push(row);
  if (!jsonOut) console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} — ${name}`);
  return pass;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniqueWamid(tag) {
  return `wamid.${RUN_ID}.${tag}.${Math.random().toString(36).slice(2, 8)}`;
}

async function postInbound({ phone, text, wamid, referral = null }) {
  const msg = referral
    ? referralTextMessage(text, referral, { from: phone, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)) })
    : textMessage(text, { from: phone, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)) });
  const envelope = buildWebhookEnvelope([msg], { waId: phone, profileName: 'MC6 F1' });
  const res = await fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  return { ok: res.status === 200, status: res.status };
}

async function main() {
  if (!jsonOut) console.log(`\nMC-6 Fase 1 — Post-deploy validation (flag OFF esperado)\n${BASE_URL}\n`);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    record('E00', 'Supabase credentials', false);
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const health = await postInbound({
    phone: QA_PHONE,
    text: `MC6 F1 health ${RUN_ID}`,
    wamid: uniqueWamid('health'),
  });
  record('F1-01', 'Webhook POST 200 (prod online)', health.ok, health);
  await sleep(3000);

  const propWamid = uniqueWamid('qa-property');
  const prop = await postInbound({
    phone: QA_PHONE,
    text: 'Info LUX-A0453',
    wamid: propWamid,
    referral: { source_type: 'ad', ad_id: 'mc6-f1-test', headline: 'LUX-A0453 Cumbres' },
  });
  record('F1-02', 'QA allowlist + referral inbound 200', prop.ok, prop);
  await sleep(5000);

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, phone, ai_state')
    .eq('phone', QA_PHONE)
    .order('updated_at', { ascending: false })
    .limit(1);

  const conv = convs?.[0];
  record('F1-03', 'Conversación QA resuelta', !!conv?.id, { conversation_id: conv?.id });

  if (conv?.id) {
    const { data: gates } = await supabase
      .from('conversation_events')
      .select('payload, created_at')
      .eq('conversation_id', conv.id)
      .eq('type', 'v3_primary_gate')
      .order('created_at', { ascending: false })
      .limit(3);

    const latest = gates?.[0]?.payload;
    const bypassActive = latest?.v3_primary_bypass_reason != null;
    record(
      'F1-04',
      'Flag OFF: sin property_entry bypass en gate reciente',
      !bypassActive,
      { latest_gate: latest },
    );

    const { data: outs } = await supabase
      .from('conversation_messages')
      .select('raw_payload, created_at')
      .eq('conversation_id', conv.id)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(3);

    const src = outs?.[0]?.raw_payload?.perseo_metadata?.response_source;
    record('F1-05', 'Outbound QA con response_source', !!src, { response_source: src });
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const summary = { phase: 'MC-6-F1', run_id: RUN_ID, passed, failed, results };

  if (jsonOut) console.log(JSON.stringify(summary, null, 2));
  else console.log(`\nFase 1: ${passed}/${results.length} PASS\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
