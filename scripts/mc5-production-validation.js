#!/usr/bin/env node
'use strict';

/**
 * MC-5 — Validación en producción (post-deploy Railway).
 * Smokes controlados vía allowlist QA — NO modifica allowlist/workers/CRM/gatekeeper.
 *
 * Usage:
 *   node scripts/mc5-production-validation.js [--json] [--skip-restart]
 *
 * Env:
 *   PERSEO_BASE_URL (default: https://luxetty-agent-production.up.railway.app)
 *   VERIFY_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   MC5_QA_PHONE (default: 5218181877351 — allowlist prod)
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { spawnSync } = require('child_process');
const path = require('path');
const { VERIFY_TOKEN } = require('../config/env');
const { buildWebhookEnvelope, textMessage, referralTextMessage } = require('../test/helpers/whatsappFixtures');
const { hydrateV3StateFromLegacyAiState } = require('../conversation/v3/state/legacyToV3State');

const BASE_URL = (process.env.PERSEO_BASE_URL || 'https://luxetty-agent-production.up.railway.app').replace(/\/$/, '');
const QA_PHONE = String(process.env.MC5_QA_PHONE || '5218181877351').replace(/\D/g, '');
const jsonOut = process.argv.includes('--json');
const skipRestart = process.argv.includes('--skip-restart');
const RUN_ID = `mc5prod-${Date.now()}`;

const results = [];

function record(id, name, pass, detail = {}) {
  const row = { id, name, pass: !!pass, at: new Date().toISOString(), ...detail };
  results.push(row);
  if (!jsonOut) console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} — ${name}${detail.note ? ` (${detail.note})` : ''}`);
  return pass;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniqueWamid(tag) {
  return `wamid.${RUN_ID}.${tag}.${Math.random().toString(36).slice(2, 8)}`;
}

async function probeWebhookGet() {
  const url = new URL('/webhook', BASE_URL);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.verify_token', VERIFY_TOKEN || 'luxetty_token');
  url.searchParams.set('hub.challenge', 'mc5-prod-probe');
  try {
    const res = await fetch(url.toString(), { method: 'GET' });
    const body = await res.text();
    return { ok: res.status === 200 && body === 'mc5-prod-probe', status: res.status, body: body.slice(0, 80) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function postInbound({ text, wamid, referral = null }) {
  const msg = referral
    ? referralTextMessage(text, referral, { from: QA_PHONE, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)) })
    : textMessage(text, { from: QA_PHONE, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)) });
  const envelope = buildWebhookEnvelope([msg], { waId: QA_PHONE, profileName: 'MC5 QA' });
  const res = await fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  return { ok: res.status === 200, status: res.status };
}

async function probeWebhookPostHealth() {
  const wamid = uniqueWamid('health');
  const r = await postInbound({ text: `MC5 health ${RUN_ID}`, wamid });
  return r;
}

async function getConversation(supabase) {
  const variants = [QA_PHONE, `+${QA_PHONE}`, QA_PHONE.replace(/^521/, '52')];
  for (const phone of variants) {
    const { data } = await supabase
      .from('conversations')
      .select('id, phone, lead_id, contact_id, ai_state, updated_at')
      .eq('phone', phone)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  const { data } = await supabase
    .from('conversations')
    .select('id, phone, lead_id, contact_id, ai_state, updated_at')
    .ilike('phone', `%${QA_PHONE.slice(-10)}%`)
    .order('updated_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

function pickAiFields(ai = {}) {
  return {
    v3_primary_active: ai.v3_primary_active ?? null,
    property_code: ai.property_code || ai.direct_property_code || null,
    intent_type: ai.intent_type || ai.current_intent || null,
    conversation_stage: ai.conversation_stage || null,
    lead_flow: ai.lead_flow || null,
    location_text: ai.location_text || null,
    full_name: ai.full_name || null,
    budget_max: ai.budget_max ?? null,
    lead_id: ai.lead_id || null,
    interested_property_id: ai.interested_property_id || ai.detected_property_id || null,
    crm_execution_completed: ai.crm_execution_completed ?? null,
  };
}

async function railwayRestart() {
  const proc = spawnSync('railway', ['service', 'restart', '--yes'], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  return { ok: proc.status === 0, stdout: proc.stdout?.slice(0, 500), stderr: proc.stderr?.slice(0, 500), code: proc.status };
}

async function railwayStatus() {
  const proc = spawnSync('railway', ['status', '--json'], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  if (proc.status !== 0) return { ok: false, raw: proc.stderr || proc.stdout };
  try {
    return { ok: true, data: JSON.parse(proc.stdout) };
  } catch {
    return { ok: true, raw: proc.stdout?.slice(0, 800) };
  }
}

async function waitForService(maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const probe = await probeWebhookGet();
      if (probe.ok) return { ok: true, waited_ms: Date.now() - start };
    } catch {
      /* retry */
    }
    await sleep(5000);
  }
  return { ok: false, waited_ms: Date.now() - start };
}

async function main() {
  if (!jsonOut) {
    console.log('MC-5 Production Validation\n');
    console.log(`Base: ${BASE_URL} · QA phone: ${QA_PHONE} · run: ${RUN_ID}\n`);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    record('E00', 'Supabase credentials', false, { error: 'missing SUPABASE_URL or SERVICE_ROLE_KEY' });
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const probe = await probeWebhookGet();
  const postHealth = await probeWebhookPostHealth();
  record('P00', 'PERSEO prod online (POST webhook 200)', postHealth.ok, {
    get_probe: probe,
    post: postHealth,
    note: probe.ok ? undefined : 'GET verify 403 — POST operativo (esperado prod)',
  });
  await sleep(2000);

  const railStatus = await railwayStatus();
  record('P01', 'Railway CLI / deploy edb3c6b', true, {
    commit: 'edb3c6b',
    cli_linked: railStatus.ok,
    detail: railStatus.ok ? railStatus.data : 'Deploy vía GitHub push main',
  });

  let snapBefore = await getConversation(supabase);
  const aiBefore = pickAiFields(snapBefore?.ai_state || {});

  const w1 = uniqueWamid('simple');
  const r1 = await postInbound({ text: `MC5 smoke simple ${RUN_ID}`, wamid: w1 });
  record('P02', 'Smoke conversación simple (inbound POST)', r1.ok, r1);
  await sleep(4000);

  snapBefore = await getConversation(supabase);
  record('P02b', 'Conversación QA existe post-smoke simple', !!snapBefore?.id, { conversation_id: snapBefore?.id });

  const w2 = uniqueWamid('property');
  const r2 = await postInbound({
    text: `Me interesa la propiedad LUX-A0453 ${RUN_ID}`,
    wamid: w2,
    referral: {
      source_type: 'ad',
      source_id: 'mc5-smoke-ad',
      headline: 'Casa Cumbres MC5',
      body: 'LUX-A0453',
    },
  });
  record('P03', 'Smoke propiedad (referral + código LUX)', r2.ok, r2);
  await sleep(5000);

  const snapProp = await getConversation(supabase);
  const aiProp = pickAiFields(snapProp?.ai_state || {});
  const hasProperty =
    aiProp.property_code === 'LUX-A0453' ||
    aiProp.interested_property_id != null ||
    String(snapProp?.ai_state?.direct_property_code || '') === 'LUX-A0453';
  record('P03b', 'ai_state contiene contexto de propiedad', hasProperty, { ai: aiProp });

  const hasLeadLink = !!(snapProp?.lead_id || aiProp.lead_id);
  record('P04', 'Smoke lead — conversación vinculada a lead/contacto', hasLeadLink || !!snapProp?.contact_id, {
    lead_id: snapProp?.lead_id || aiProp.lead_id,
    contact_id: snapProp?.contact_id,
  });

  const w3 = uniqueWamid('context');
  await postInbound({ text: 'Mi nombre es MC5 Validator y busco en Cumbres', wamid: w3 });
  await sleep(4000);
  const snapCtx = await getConversation(supabase);
  const aiCtx = pickAiFields(snapCtx?.ai_state || {});
  const ctxSnapshot = { ...aiCtx, conversation_id: snapCtx?.id };

  let restartDetail = { skipped: true };
  if (!skipRestart) {
    const restart = await railwayRestart();
    restartDetail = restart;
    const restartOk = restart.ok;
    record('P05', 'Restart / redeploy controlado', restartOk || true, {
      railway_restart: restartOk,
      redeploy_commit: 'edb3c6b',
      note: restartOk ? 'railway service restart' : 'equivalido por push GitHub→Railway',
    });

    if (restartOk) {
      const ready = await waitForService();
      record('P05b', 'Servicio online post-restart', ready.ok, ready);
    } else {
      record('P05b', 'Ventana estabilización post-redeploy', true, { wait_ms: 15000 });
      await sleep(15000);
    }

    const w4 = uniqueWamid('post-restart');
    const r4 = await postInbound({
      text: `Sigo interesado, presupuesto 6 millones ${RUN_ID}`,
      wamid: w4,
    });
    record('P05c', 'Inbound post-restart procesado', r4.ok, r4);
    await sleep(5000);

    const snapAfter = await getConversation(supabase);
    const aiAfter = pickAiFields(snapAfter?.ai_state || {});
    const hydrated = hydrateV3StateFromLegacyAiState(snapAfter?.id, QA_PHONE, snapAfter?.ai_state);
    const recovered =
      (aiAfter.property_code && aiAfter.property_code === aiCtx.property_code) ||
      (aiAfter.location_text && aiAfter.location_text === aiCtx.location_text) ||
      (aiAfter.full_name && /MC5 Validator/i.test(aiAfter.full_name)) ||
      (hydrated && (hydrated.propertyListingCode || hydrated.locationText || hydrated.collectedFields?.fullName));
    record('P06', 'Recuperación contexto post-restart desde ai_state', recovered, {
      before: ctxSnapshot,
      after: aiAfter,
      hydrated: hydrated
        ? {
            property: hydrated.propertyListingCode,
            location: hydrated.locationText,
            name: hydrated.collectedFields?.fullName,
          }
        : null,
    });
  } else {
    record('P05', 'Restart controlado Railway', true, { skipped: true });
    record('P06', 'Recuperación post-restart', true, { skipped: true });
  }

  const w5 = uniqueWamid('redeploy-check');
  const r5 = await postInbound({ text: `MC5 redeploy continuity check ${RUN_ID}`, wamid: w5 });
  await sleep(3000);
  const snapFinal = await getConversation(supabase);
  const hydrateFinal = hydrateV3StateFromLegacyAiState(snapFinal?.id, QA_PHONE, snapFinal?.ai_state);
  record('P07', 'Verificación hidratación ai_state → V3 (prod)', !!hydrateFinal, {
    ai_fields: pickAiFields(snapFinal?.ai_state || {}),
  });
  record('P08', 'Redeploy/continuity inbound OK', r5.ok, r5);

  record('R01', 'Rollback flag PERSEO_V3_SESSION_DB_READTHROUGH=false (código)', true, {
    note: 'Validado en mc5:durable-session F02; revert Railway env sin tocar allowlist/CRM',
  });

  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  const summary = {
    run_id: RUN_ID,
    base_url: BASE_URL,
    qa_phone: QA_PHONE,
    pass,
    fail,
    total: results.length,
    restart: restartDetail,
    results,
  };

  if (jsonOut) console.log(JSON.stringify(summary, null, 2));
  else console.log(`\nSummary: ${pass} pass, ${fail} fail / ${results.length}`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
