#!/usr/bin/env node
'use strict';

/**
 * Sprint 4 — Live QA smoke RAG (post-corrección R-01..R-05).
 * Usage: PERSEO_BASE_URL=https://luxetty-perseo-qa.up.railway.app node scripts/qa/ragSprint4LiveSmoke.js --json
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { buildWebhookEnvelope, textMessage } = require('../../test/helpers/whatsappFixtures');
const path = require('path');
const { execSync } = require('child_process');

const BASE_URL = (process.env.PERSEO_BASE_URL || 'https://luxetty-perseo-qa.up.railway.app').replace(/\/$/, '');
const QA_PHONE = String(process.env.RAG_SMOKE_PHONE || '5218181877351').replace(/\D/g, '');
const NON_ALLOWLIST = String(process.env.RAG_SMOKE_NON_ALLOWLIST || '5299912345678').replace(/\D/g, '');
const RUN_ID = `s4-rag-fix-${Date.now()}`;
const jsonOut = process.argv.includes('--json');

const scenarios = [
  { id: 'S4-L01', name: 'Propiedad descripción natural', phone: QA_PHONE, text: 'Busco casa con jardín en Cumbres', waitMs: 7000 },
  { id: 'S4-L02', name: 'Propiedad código LUX', phone: QA_PHONE, text: 'Info LUX-A0453', waitMs: 5000 },
  { id: 'S4-L03', name: 'Precio con propiedad anclada', phone: QA_PHONE, text: '¿Cuánto cuesta?', waitMs: 5000 },
  { id: 'S4-L04', name: 'Sin inventario', phone: QA_PHONE, text: 'castillo en la luna', waitMs: 5000 },
  { id: 'S4-L05', name: 'Objeción comisión', phone: QA_PHONE, text: 'Me parece mucho la comisión que cobran', waitMs: 6000 },
  { id: 'S4-L06', name: 'Captación/venta', phone: QA_PHONE, text: 'Quiero vender mi casa en San Pedro', waitMs: 5000 },
  { id: 'S4-L07', name: 'Consulta ambigua', phone: QA_PHONE, text: 'esa casa bonita', waitMs: 5000 },
  { id: 'S4-L08', name: 'Regresión fuera allowlist', phone: NON_ALLOWLIST, text: `Regresión legacy ${RUN_ID}`, waitMs: 5000 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uniqueWamid(tag) {
  return `wamid.${RUN_ID}.${tag}.${Math.random().toString(36).slice(2, 8)}`;
}

async function postInbound({ phone, text, wamid }) {
  const msg = textMessage(text, { from: phone, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)) });
  const envelope = buildWebhookEnvelope([msg], { waId: phone, profileName: 'S4 RAG QA Fix' });
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  return { ok: res.status === 200, status: res.status, latency_ms: Date.now() - t0 };
}

async function snapshot(supabase, since) {
  const [ragLogs, citations, ragEvents, leads, crmOutbox] = await Promise.all([
    supabase.from('rag_query_logs').select('id, query_text_hash, result_count, fallback_used, created_at', { count: 'exact' }).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
    supabase.from('retrieval_citations').select('id, chunk_id, score, rank, created_at', { count: 'exact' }).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
    supabase.from('conversation_events').select('id, type, payload, created_at', { count: 'exact' }).eq('type', 'rag_retrieval').gte('created_at', since).order('created_at', { ascending: false }).limit(20),
    supabase.from('leads').select('id, created_at, source').gte('created_at', since).order('created_at', { ascending: false }).limit(5),
    supabase.from('crm_outbox').select('id, created_at').gte('created_at', since).limit(5),
  ]);
  return {
    since,
    rag_query_logs_count: ragLogs.count ?? 0,
    rag_query_logs_sample: ragLogs.data || [],
    retrieval_citations_count: citations.count ?? 0,
    retrieval_citations_sample: citations.data || [],
    rag_retrieval_events_count: ragEvents.count ?? 0,
    rag_retrieval_events_sample: ragEvents.data || [],
    leads_recent: leads.data || [],
    crm_outbox_recent: crmOutbox.data || [],
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // R-05: reset oficial antes del smoke
  try {
    execSync(`node scripts/qa/ragSmokeSessionReset.js ${QA_PHONE} --force-qa`, {
      cwd: path.join(__dirname, '../..'),
      env: { ...process.env, PERSEO_QA_SMOKE_RESET_ENABLED: 'true', PERSEO_ENV: 'qa' },
      stdio: jsonOut ? 'pipe' : 'inherit',
    });
  } catch (e) {
    console.error('QA reset failed:', e.message);
    process.exit(1);
  }

  await sleep(2000);
  const baseline = await snapshot(supabase, since);

  const results = { run_id: RUN_ID, base_url: BASE_URL, scenarios: [], baseline, after: null, checks: [] };

  for (const sc of scenarios) {
    const http = await postInbound({ phone: sc.phone, text: sc.text, wamid: uniqueWamid(sc.id) });
    await sleep(sc.waitMs);
    results.scenarios.push({ ...sc, http, pass: http.ok });
    if (!jsonOut) console.log(`${http.ok ? 'PASS' : 'FAIL'} ${sc.id} ${sc.name}`);
  }

  results.after = await snapshot(supabase, since);

  const ragDelta = results.after.rag_query_logs_count - baseline.rag_query_logs_count;
  const citDelta = results.after.retrieval_citations_count - baseline.retrieval_citations_count;
  const evtDelta = results.after.rag_retrieval_events_count - baseline.rag_retrieval_events_count;
  const groundedEvents = (results.after.rag_retrieval_events_sample || []).filter((e) => e.payload?.fallback_used === false);

  results.checks = [
    { id: 'CHK-01', name: 'rag_query_logs > 0', pass: ragDelta > 0, delta: ragDelta },
    { id: 'CHK-02', name: 'retrieval_citations > 0', pass: citDelta > 0, delta: citDelta },
    { id: 'CHK-03', name: 'rag_retrieval events', pass: evtDelta > 0, delta: evtDelta },
    { id: 'CHK-04', name: 'grounded event (fallback_used=false)', pass: groundedEvents.length > 0, count: groundedEvents.length },
    { id: 'CHK-05', name: 'webhook 200 all', pass: results.scenarios.every((s) => s.pass) },
    { id: 'CHK-06', name: 'no PII in logs sample', pass: !JSON.stringify(results.after.rag_query_logs_sample).match(/521\d{10}|@/) },
    { id: 'CHK-07', name: 'no CRM outbox burst', pass: (results.after.crm_outbox_recent?.length || 0) <= (baseline.crm_outbox_recent?.length || 0) + 1 },
  ];

  results.summary = {
    scenarios_pass: results.scenarios.filter((s) => s.pass).length,
    checks_pass: results.checks.filter((c) => c.pass).length,
    rag_logs_delta: ragDelta,
    citations_delta: citDelta,
    rag_events_delta: evtDelta,
    certified: results.checks.every((c) => c.pass),
  };

  if (jsonOut) console.log(JSON.stringify(results, null, 2));
  else console.log('\nSummary:', results.summary);

  process.exit(results.summary.certified ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
