#!/usr/bin/env node
'use strict';

/**
 * MC-6 — Certificación GO Pauta Escalable (#46 Cuarzo).
 * Harness local + auditoría read-only Supabase. Sin toggles prod salvo --prod-smoke.
 *
 * Usage:
 *   node scripts/mc6-pauta-certification.js [--json] [--days=30]
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   PERSEO_V3_QA_ALLOWLIST (para excluir cohorte QA)
 */

require('dotenv').config();

const { spawnSync } = require('child_process');
const path = require('path');
const {
  evaluateV3PrimaryGate,
  getPerseoV3Config,
} = require('../config/perseoV3Flags');
const {
  resolvePropertyEntryV3Eligibility,
  isPropertyEntryAutoPrimaryEnabled,
} = require('../conversation/pautaDetection');

const jsonOut = process.argv.includes('--json');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;

const QA_SOURCES = new Set(['qa_sprint1', 'qa_sprint2', 'qa_manual', 'argos_sim']);
const V3_PREFIX = 'v3_';
const FALLBACK_TARGET_PCT = 5;

const results = [];
const metrics = {};

function record(id, name, pass, detail = {}) {
  const row = { id, name, pass: !!pass, at: new Date().toISOString(), ...detail };
  results.push(row);
  if (!jsonOut) console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} — ${name}${detail.note ? ` (${detail.note})` : ''}`);
  return pass;
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function runUnitTests() {
  const files = [
    'test/v3PrimaryGate.test.js',
    'test/pautaDetection.test.js',
    'test/crmExecuteInboundGate.test.js',
  ];
  const proc = spawnSync(process.execPath, ['--test', ...files], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PERSEO_V3_ENABLED: 'true',
      PERSEO_V3_QA_ALLOWLIST: '5218181877351',
      PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY: 'true',
    },
  });
  if (!jsonOut && proc.stdout) process.stdout.write(proc.stdout);
  if (!jsonOut && proc.stderr) process.stderr.write(proc.stderr);
  return proc.status === 0;
}

function runLocalCases() {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218181877351';
  process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY = 'true';

  const cfg = getPerseoV3Config();
  record('G01', 'V3 enabled in harness env', cfg.enabled === true);
  record('G02', 'Property entry auto-primary flag readable', isPropertyEntryAutoPrimaryEnabled() === true);

  const gateOffAllowlist = evaluateV3PrimaryGate({
    phone: '5218111111111',
    propertyEntryEligible: true,
    propertyEntryBypassReason: 'pauta_property',
  });
  record(
    'G03',
    'Gate permite V3 primary por property entry (sin allowlist)',
    gateOffAllowlist.v3_primary_allowed === true && gateOffAllowlist.v3_primary_bypass_reason === 'pauta_property',
  );

  process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY = 'false';
  delete require.cache[require.resolve('../config/perseoV3Flags')];
  const { evaluateV3PrimaryGate: evalOff } = require('../config/perseoV3Flags');
  const gateRollback = evalOff({
    phone: '5218111111111',
    propertyEntryEligible: true,
  });
  record(
    'G04',
    'Rollback: flag OFF bloquea property entry bypass',
    gateRollback.v3_primary_block_reason === 'allowlist_no_match',
  );
  process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY = 'true';

  const elig = resolvePropertyEntryV3Eligibility({
    aiState: {
      campaign_context: { property_code: 'LUX-A0453' },
      property_code: 'LUX-A0453',
      property_specific_intent: true,
    },
    text: 'Info de la propiedad',
  });
  record('G05', 'Eligibility pauta property_code', elig.eligible === true && elig.reason === 'pauta_property');
}

function isPautaAiState(ai = {}) {
  if (!ai || typeof ai !== 'object') return false;
  if (ai.whatsapp_referral && Object.keys(ai.whatsapp_referral).length) return true;
  if (ai.campaign_context && typeof ai.campaign_context === 'object') {
    const keys = Object.keys(ai.campaign_context).filter(
      (k) => ai.campaign_context[k] != null && String(ai.campaign_context[k]).trim() !== '',
    );
    if (keys.length) return true;
  }
  if (ai.property_code || ai.direct_property_code) return true;
  if (ai.interested_property_id || ai.detected_property_id) return true;
  return false;
}

function isQaPhone(phone, qaSet) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return false;
  for (const q of qaSet) {
    if (d === q || d.endsWith(q.slice(-10))) return true;
  }
  return false;
}

async function runSupabaseAudit() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    record('S00', 'Supabase audit (skip — no credentials)', true, { skipped: true });
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key);
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  const qaAllowlist = String(process.env.PERSEO_V3_QA_ALLOWLIST || '5218181877351')
    .split(/[,;]+/)
    .map((x) => x.replace(/\D/g, ''))
    .filter(Boolean);
  const qaSet = new Set(qaAllowlist);

  const { data: outbound, error: outErr } = await supabase
    .from('conversation_messages')
    .select('id, conversation_id, direction, sender_type, raw_payload, created_at')
    .eq('direction', 'outbound')
    .eq('sender_type', 'ai_agent')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(3000);

  if (outErr) {
    record('S01', 'Outbound IA sample', false, { error: outErr.message });
    return;
  }

  const rows = outbound || [];
  const withMeta = rows.filter((r) => r.raw_payload?.perseo_metadata?.response_source);
  const exQa = withMeta.filter((r) => !QA_SOURCES.has(r.raw_payload.perseo_metadata.response_source));

  const countBySource = {};
  for (const r of withMeta) {
    const src = r.raw_payload.perseo_metadata.response_source || 'unknown';
    countBySource[src] = (countBySource[src] || 0) + 1;
  }

  const exQaBySource = {};
  for (const r of exQa) {
    const src = r.raw_payload.perseo_metadata.response_source || 'unknown';
    exQaBySource[src] = (exQaBySource[src] || 0) + 1;
  }

  const totalMeta = withMeta.length;
  const totalExQa = exQa.length;
  const fallbackAll = countBySource.fallback_consultive || 0;
  const fallbackExQa = exQaBySource.fallback_consultive || 0;
  const v3All = Object.entries(countBySource)
    .filter(([k]) => k.startsWith(V3_PREFIX))
    .reduce((s, [, n]) => s + n, 0);
  const v3ExQa = Object.entries(exQaBySource)
    .filter(([k]) => k.startsWith(V3_PREFIX))
    .reduce((s, [, n]) => s + n, 0);
  const legacyExQa = totalExQa - v3ExQa - fallbackExQa;

  metrics.outbound = {
    window_days: DAYS,
    total_ai_outbound: rows.length,
    with_response_source: totalMeta,
    ex_qa: totalExQa,
    pct_v3_all: pct(v3All, totalMeta),
    pct_v3_ex_qa: pct(v3ExQa, totalExQa),
    pct_legacy_ex_qa: pct(Math.max(0, legacyExQa), totalExQa),
    pct_fallback_all: pct(fallbackAll, totalMeta),
    pct_fallback_ex_qa: pct(fallbackExQa, totalExQa),
    by_source: countBySource,
    by_source_ex_qa: exQaBySource,
  };

  record('S01', 'Outbound IA sample loaded', totalMeta > 0, { n: totalMeta });
  record(
    'S02',
    `Fallback consultive ex-QA < ${FALLBACK_TARGET_PCT}% (GO #46)`,
    pct(fallbackExQa, totalExQa) < FALLBACK_TARGET_PCT,
    { actual_pct: pct(fallbackExQa, totalExQa), target_pct: FALLBACK_TARGET_PCT },
  );

  const { data: gateEvents } = await supabase
    .from('conversation_events')
    .select('conversation_id, payload, created_at')
    .eq('type', 'v3_primary_gate')
    .gte('created_at', since)
    .limit(2000);

  const gates = gateEvents || [];
  let allowed = 0;
  let blocked = 0;
  const blockReasons = {};
  const bypassReasons = {};
  for (const g of gates) {
    const p = g.payload || {};
    if (p.v3_primary_allowed === true) allowed += 1;
    else blocked += 1;
    const br = p.v3_primary_block_reason || 'null';
    blockReasons[br] = (blockReasons[br] || 0) + 1;
    if (p.v3_primary_bypass_reason) {
      bypassReasons[p.v3_primary_bypass_reason] = (bypassReasons[p.v3_primary_bypass_reason] || 0) + 1;
    }
  }

  metrics.v3_primary_gate = {
    total: gates.length,
    allowed,
    blocked,
    pct_allowed: pct(allowed, gates.length),
    block_reasons: blockReasons,
    bypass_reasons: bypassReasons,
  };

  record('S03', 'v3_primary_gate events sampled', gates.length > 0, { n: gates.length });

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, phone, lead_id, contact_id, ai_state, updated_at')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(500);

  const allConvs = convs || [];
  const pautaConvs = allConvs.filter((c) => isPautaAiState(c.ai_state));
  const pautaExQa = pautaConvs.filter((c) => !isQaPhone(c.phone, qaSet));
  const pautaWithLead = pautaConvs.filter((c) => c.lead_id);
  const pautaV3Active = pautaConvs.filter((c) => c.ai_state?.v3_primary_active === true);

  metrics.pauta_cohort = {
    total_conversations_window: allConvs.length,
    pauta_conversations: pautaConvs.length,
    pauta_ex_qa: pautaExQa.length,
    pauta_with_lead: pautaWithLead.length,
    pct_pauta_leads: pct(pautaWithLead.length, pautaConvs.length),
    pauta_v3_primary_active: pautaV3Active.length,
    pct_pauta_v3_active: pct(pautaV3Active.length, pautaConvs.length),
  };

  record('S04', 'Cohorte pauta identificada', pautaConvs.length > 0, { n: pautaConvs.length });
  record(
    'S05',
    'Leads pauta ≥80% asignados',
    pct(pautaWithLead.length, pautaConvs.length) >= 80,
    { pct: pct(pautaWithLead.length, pautaConvs.length) },
  );

  const pautaConvIds = new Set(pautaConvs.map((c) => c.id));
  const pautaOutbound = withMeta.filter((r) => pautaConvIds.has(r.conversation_id));
  const pautaFallback = pautaOutbound.filter(
    (r) => r.raw_payload?.perseo_metadata?.response_source === 'fallback_consultive',
  );
  const pautaV3Out = pautaOutbound.filter((r) =>
    String(r.raw_payload?.perseo_metadata?.response_source || '').startsWith(V3_PREFIX),
  );

  metrics.pauta_outbound = {
    messages_with_source: pautaOutbound.length,
    pct_v3: pct(pautaV3Out.length, pautaOutbound.length),
    pct_fallback: pct(pautaFallback.length, pautaOutbound.length),
  };

  record(
    'S06',
    `Pauta outbound fallback < ${FALLBACK_TARGET_PCT}%`,
    pct(pautaFallback.length, pautaOutbound.length) < FALLBACK_TARGET_PCT,
    { actual_pct: pct(pautaFallback.length, pautaOutbound.length) },
  );

  const { data: leads } = await supabase
    .from('leads')
    .select('id, contact_id, assigned_agent_profile_id, created_at')
    .gte('created_at', since)
    .limit(500);

  const leadRows = leads || [];
  const withContact = leadRows.filter((l) => l.contact_id);
  const withAgent = leadRows.filter((l) => l.assigned_agent_profile_id);

  metrics.leads = {
    total: leadRows.length,
    with_contact: withContact.length,
    with_agent: withAgent.length,
    pct_assigned: pct(withAgent.length, leadRows.length),
  };

  record('S07', 'Leads 30d con contact_id', withContact.length === leadRows.length, {
    n: leadRows.length,
    with_contact: withContact.length,
  });

  const { data: handoffs } = await supabase
    .from('conversation_events')
    .select('id, type, created_at')
    .in('type', ['handoff_requested', 'handoff_completed', 'v3_handoff', 'human_handoff'])
    .gte('created_at', since)
    .limit(500);

  metrics.handoffs = { total: (handoffs || []).length };
  record('S08', 'Handoffs registrados (muestra)', true, { n: metrics.handoffs.total });

  const { data: crmGate } = await supabase
    .from('conversation_events')
    .select('payload')
    .eq('type', 'crm_execute_gate')
    .gte('created_at', since)
    .limit(1000);

  let crmAllowed = 0;
  let crmBlocked = 0;
  for (const e of crmGate || []) {
    if (e.payload?.allowed === true) crmAllowed += 1;
    else crmBlocked += 1;
  }
  metrics.crm_execute_gate = {
    allowed: crmAllowed,
    blocked: crmBlocked,
    pct_allowed: pct(crmAllowed, crmAllowed + crmBlocked),
  };
  record('S09', 'CRM execute gate sampled', (crmGate || []).length > 0, metrics.crm_execute_gate);
}

async function main() {
  if (!jsonOut) {
    console.log(`\nMC-6 — GO Pauta Escalable (#46) — window ${DAYS}d\n`);
  }

  const testsOk = runUnitTests();
  record('T01', 'Unit tests (gate + pauta + CRM gate)', testsOk);

  runLocalCases();
  await runSupabaseAudit();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const go46 =
    results.find((r) => r.id === 'S02')?.pass === true &&
    results.find((r) => r.id === 'S06')?.pass === true;

  const summary = {
    sprint: 'MC-6',
    item: '#46 GO Pauta Escalable',
    at: new Date().toISOString(),
    window_days: DAYS,
    passed,
    failed,
    total: results.length,
    verdict_46: go46 ? 'GO' : 'NO-GO',
    metrics,
    results,
  };

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('\n--- Métricas obligatorias ---');
    if (metrics.outbound) {
      console.log(`  % tráfico V3 (ex-QA):     ${metrics.outbound.pct_v3_ex_qa}%`);
      console.log(`  % tráfico legacy (ex-QA): ${metrics.outbound.pct_legacy_ex_qa}%`);
      console.log(`  % fallback consultive:      ${metrics.outbound.pct_fallback_ex_qa}% (target <${FALLBACK_TARGET_PCT}%)`);
    }
    if (metrics.pauta_cohort) {
      console.log(`  % leads pauta:              ${metrics.pauta_cohort.pct_pauta_leads}%`);
      console.log(`  % pauta V3 active:          ${metrics.pauta_cohort.pct_pauta_v3_active}%`);
    }
    if (metrics.leads) {
      console.log(`  % leads asignados:          ${metrics.leads.pct_assigned}%`);
    }
    console.log(`\nVeredicto #46: ${summary.verdict_46}`);
    console.log(`Harness: ${passed}/${results.length} PASS\n`);
  }

  process.exit(failed > 0 && !go46 ? 1 : failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
