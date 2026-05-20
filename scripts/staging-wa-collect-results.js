#!/usr/bin/env node
'use strict';

/**
 * M4-04 — After manual WA pilots, pull Supabase evidence per allowlist phone.
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-wa-collect-results.js [--json]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabaseService');
const { validateAllowlist, normalizeMxWa } = require('./staging/stagingAllowlist');
const { parseArgs, assertStagingSafe, printResult, exitCode } = require('./staging/stagingLib');

const RUN_MD = path.join(
  __dirname,
  '../docs/argos/whatsapp-smoke/m4-02/runs/M4-04-STAGING-20260520.md',
);

async function fetchPilotEvidence(phoneNorm, sinceIso) {
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, whatsapp_phone, created_at')
    .or(`whatsapp_phone.eq.${phoneNorm},whatsapp_phone.eq.+${phoneNorm}`)
    .limit(3);

  const contactIds = (contacts || []).map((c) => c.id);
  let conversations = [];
  if (contactIds.length) {
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, contact_id, created_at, updated_at')
      .in('contact_id', contactIds)
      .gte('updated_at', sinceIso)
      .order('updated_at', { ascending: false })
      .limit(3);
    conversations = convs || [];
  }

  const convIds = conversations.map((c) => c.id);
  let messages = [];
  if (convIds.length) {
    const { data: msgs } = await supabase
      .from('conversation_messages')
      .select('id, conversation_id, role, content, created_at, message_type')
      .in('conversation_id', convIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(40);
    messages = msgs || [];
  }

  let telemetry = [];
  if (convIds.length) {
    const { data: tel } = await supabase
      .from('wa_operational_telemetry')
      .select('id, conversation_id, humanity_score, policy_hit, fallback_reason, metadata, created_at')
      .in('conversation_id', convIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20);
    telemetry = tel || [];
  }

  let leads = [];
  if (contactIds.length) {
    const { data: leadRows } = await supabase
      .from('leads')
      .select('id, contact_id, created_at')
      .in('contact_id', contactIds)
      .gte('created_at', sinceIso);
    leads = leadRows || [];
  }

  const humanityScores = telemetry
    .map((t) => t.humanity_score)
    .filter((n) => n != null)
    .map(Number);
  const avgHumanity =
    humanityScores.length > 0
      ? humanityScores.reduce((a, b) => a + b, 0) / humanityScores.length
      : null;

  const loopMeta = telemetry.some((t) => Number(t.metadata?.loop_score || 0) > 0.85);

  return {
    phone_norm: phoneNorm,
    contacts_found: contactIds.length,
    conversations: convIds.length,
    message_count: messages.length,
    telemetry_events: telemetry.length,
    avg_humanity_score: avgHumanity,
    leads_created_in_window: leads.length,
    duplicate_leads: leads.length > 1,
    loop_signal: loopMeta,
    last_fallback: telemetry[0]?.fallback_reason || null,
    last_policy_hit: telemetry[0]?.policy_hit || null,
    transcript_preview: messages.slice(-6).map((m) => ({
      role: m.role,
      type: m.message_type,
      text: String(m.content || '').slice(0, 120),
    })),
  };
}

function appendRunMarkdown(pilots, sinceIso) {
  const lines = [
    '',
    `## Auto-collect ${new Date().toISOString()}`,
    `Window since: ${sinceIso}`,
    '',
    '| ID | Msgs | Tel events | Humanity avg | Leads | Dup | Loop | Fallback | Verdict |',
    '|----|------|------------|--------------|-------|-----|------|----------|---------|',
  ];
  for (const p of pilots) {
    const v = p.evidence;
    const humanityOk = v.avg_humanity_score != null && v.avg_humanity_score >= 0.8;
    const pass =
      v.message_count > 0 &&
      !v.duplicate_leads &&
      !v.loop_signal &&
      humanityOk;
    lines.push(
      `| ${p.id} | ${v.message_count} | ${v.telemetry_events} | ${v.avg_humanity_score ?? 'n/a'} | ${v.leads_created_in_window} | ${v.duplicate_leads ? 'Y' : 'N'} | ${v.loop_signal ? 'Y' : 'N'} | ${v.last_fallback || '—'} | ${pass ? 'PASS' : 'REVIEW'} |`,
    );
  }
  fs.appendFileSync(RUN_MD, `${lines.join('\n')}\n`);
}

async function main() {
  const args = parseArgs();
  assertStagingSafe(args);

  const allowlist = validateAllowlist();
  if (!allowlist.ok) {
    const result = { ok: false, details: { errors: allowlist.errors, file: allowlist.filePath } };
    printResult('staging-wa-collect-results', result, args.json);
    exitCode(result);
    return;
  }

  const hours = Number(process.env.M4_WA_COLLECT_HOURS || 24);
  const sinceIso = new Date(Date.now() - hours * 3600000).toISOString();

  const pilots = [];
  for (const p of allowlist.pilots) {
    const evidence = await fetchPilotEvidence(normalizeMxWa(p.phone), sinceIso);
    pilots.push({ ...p, evidence });
  }

  const humanityPass = pilots.filter(
    (p) => p.evidence.avg_humanity_score != null && p.evidence.avg_humanity_score >= 0.8,
  ).length;
  const dupes = pilots.filter((p) => p.evidence.duplicate_leads).length;
  const loops = pilots.filter((p) => p.evidence.loop_signal).length;
  const withMsgs = pilots.filter((p) => p.evidence.message_count > 0).length;

  const ok =
    withMsgs >= 10 &&
    humanityPass >= 8 &&
    dupes === 0 &&
    loops === 0;

  if (!args.dryRun) {
    appendRunMarkdown(pilots, sinceIso);
  }

  const result = {
    ok,
    details: {
      since: sinceIso,
      pilots_with_messages: withMsgs,
      humanity_pass_4of5_proxy: humanityPass,
      duplicate_pilots: dupes,
      loop_pilots: loops,
      pilots,
      run_log: RUN_MD,
    },
  };

  printResult('staging-wa-collect-results', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
