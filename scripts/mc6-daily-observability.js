#!/usr/bin/env node
'use strict';

/**
 * MC-6 — Entregable diario de observación (Fase 2).
 * Métricas read-only Supabase — últimas 24h por defecto.
 *
 * Usage:
 *   node scripts/mc6-daily-observability.js [--json] [--hours=24]
 *
 * Entregables: % V3, % Legacy, % Fallback, leads, handoffs, errores.
 */

require('dotenv').config();

const jsonOut = process.argv.includes('--json');
const hoursArg = process.argv.find((a) => a.startsWith('--hours='));
const HOURS = hoursArg ? parseInt(hoursArg.split('=')[1], 10) : 24;

const QA_SOURCES = new Set(['qa_sprint1', 'qa_sprint2', 'qa_manual', 'argos_sim']);
const V3_PREFIX = 'v3_';
const ERROR_EVENT_TYPES = [
  'crm_creation_failed',
  'crm_execute_error',
  'perseo_policy_resolution_failed',
  'v3_runtime_error',
  'webhook_processing_error',
  'lead_validation_error',
];

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key);
  const since = new Date(Date.now() - HOURS * 60 * 60 * 1000).toISOString();
  const reportDate = new Date().toISOString().slice(0, 10);

  const { data: outbound } = await supabase
    .from('conversation_messages')
    .select('raw_payload, conversation_id')
    .eq('direction', 'outbound')
    .eq('sender_type', 'ai_agent')
    .gte('created_at', since)
    .limit(2000);

  const rows = (outbound || []).filter((r) => r.raw_payload?.perseo_metadata?.response_source);
  const exQa = rows.filter((r) => !QA_SOURCES.has(r.raw_payload.perseo_metadata.response_source));

  let v3 = 0;
  let legacy = 0;
  let fallback = 0;
  const bySource = {};

  for (const r of exQa) {
    const src = r.raw_payload.perseo_metadata.response_source;
    bySource[src] = (bySource[src] || 0) + 1;
    if (src.startsWith(V3_PREFIX)) v3 += 1;
    else if (src === 'fallback_consultive') fallback += 1;
    else legacy += 1;
  }

  const totalExQa = exQa.length;

  const { data: leads } = await supabase
    .from('leads')
    .select('id, contact_id, assigned_agent_profile_id')
    .gte('created_at', since)
    .limit(500);

  const leadRows = leads || [];
  const leadsCreated = leadRows.length;
  const leadsAssigned = leadRows.filter((l) => l.assigned_agent_profile_id).length;

  const { data: handoffs } = await supabase
    .from('conversation_events')
    .select('id')
    .in('type', ['handoff_requested', 'handoff_completed', 'v3_handoff', 'human_handoff'])
    .gte('created_at', since);

  const { data: gates } = await supabase
    .from('conversation_events')
    .select('payload')
    .eq('type', 'v3_primary_gate')
    .gte('created_at', since)
    .limit(1000);

  let propertyBypass = 0;
  let allowlistBlock = 0;
  for (const g of gates || []) {
    if (g.payload?.v3_primary_bypass_reason) propertyBypass += 1;
    if (g.payload?.v3_primary_block_reason === 'allowlist_no_match') allowlistBlock += 1;
  }

  const errors = {};
  let errorTotal = 0;
  for (const et of ERROR_EVENT_TYPES) {
    const { count } = await supabase
      .from('conversation_events')
      .select('id', { count: 'exact', head: true })
      .eq('type', et)
      .gte('created_at', since);
    if (count) {
      errors[et] = count;
      errorTotal += count;
    }
  }

  const report = {
    sprint: 'MC-6',
    phase: 'observacion-f2',
    report_date: reportDate,
    window_hours: HOURS,
    since,
    generated_at: new Date().toISOString(),
    metrics: {
      pct_v3_ex_qa: pct(v3, totalExQa),
      pct_legacy_ex_qa: pct(legacy, totalExQa),
      pct_fallback_ex_qa: pct(fallback, totalExQa),
      outbound_ex_qa_n: totalExQa,
      by_source_ex_qa: bySource,
      leads_created: leadsCreated,
      leads_assigned: leadsAssigned,
      pct_leads_assigned: pct(leadsAssigned, leadsCreated),
      handoffs: (handoffs || []).length,
      v3_gate_property_bypass: propertyBypass,
      v3_gate_allowlist_no_match: allowlistBlock,
      errors_total: errorTotal,
      errors_by_type: errors,
    },
    targets: {
      pct_fallback_max: 5,
      pct_v3_pauta_min: 95,
    },
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nMC-6 Daily Observability — ${reportDate} (últimas ${HOURS}h)\n`);
    console.log(`  % V3 (ex-QA):      ${report.metrics.pct_v3_ex_qa}%`);
    console.log(`  % Legacy (ex-QA):  ${report.metrics.pct_legacy_ex_qa}%`);
    console.log(`  % Fallback:        ${report.metrics.pct_fallback_ex_qa}%  (target <5%)`);
    console.log(`  Leads creados:     ${report.metrics.leads_created}`);
    console.log(`  Leads asignados:   ${report.metrics.leads_assigned} (${report.metrics.pct_leads_assigned}%)`);
    console.log(`  Handoffs:          ${report.metrics.handoffs}`);
    console.log(`  Property bypass:   ${report.metrics.v3_gate_property_bypass} gate events`);
    console.log(`  Errores:           ${report.metrics.errors_total}`, report.metrics.errors_by_type);
    console.log('');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
