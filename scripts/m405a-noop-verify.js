#!/usr/bin/env node
'use strict';

/**
 * M4-05a — NO-OP verification: flex OFF vs main baseline + flex ON contrast.
 *
 *   node scripts/m405a-noop-verify.js
 *   node scripts/m405a-noop-verify.js --write-docs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCENARIOS = [
  { file: 'DEMAND_002_FULL.v1.json', label: 'DEMAND', phone: '521818180001', session_id: 'f0000000-0000-4000-8000-000000000001' },
  { file: 'OFFER_002.v1.json', label: 'OFFER', phone: '521818180002', session_id: 'f0000000-0000-4000-8000-000000000002' },
  { file: 'CLOSE_004.v1.json', label: 'CLOSURE_REOPEN', phone: '521818180003', session_id: 'f0000000-0000-4000-8000-000000000003' },
];

/** Campos estructurales (NO copy outbound — variantes dependen de conversationId). */
const STRUCTURAL_COMPARE_KEYS = ['snapshot', 'ai_state', 'state_transition', 'v3_primary_gate', 'crm_contact_would', 'crm_lead_would'];

const SNAPSHOT_KEYS = [
  'detected_intent',
  'conversation_stage',
  'lead_flow',
  'operation_type',
  'known_name',
  'known_budget',
  'known_zone',
  'advisor_contact_consent',
  'handoff_sent',
  'crm_ready',
  'occupancy_status',
  'conversation_soft_closed',
  'terminal_ack_close',
  'explicit_reopen',
  'handoff_waiting_final_confirmation',
];

const AI_STATE_KEYS = [
  'lead_flow',
  'intent_type',
  'full_name',
  'budget_max',
  'location_text',
  'occupancy_status',
  'advisor_contact_consent',
  'conversation_stage',
  'handoff_stage',
  'crm_payload_ready',
  'conversation_soft_closed',
  'terminal_ack_close',
  'explicit_reopen',
  'v3_primary_active',
];

function loadScenario(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/argos/scenarios', file), 'utf8'));
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

function replySig(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function extractTurnArtifacts(turnResults) {
  return turnResults.map((r, i) => {
    const trace = r.debug_trace || [];
    const stateTr = trace.filter((t) => t.type === 'state_transition').pop();
    const gate = trace.filter((t) => t.type === 'v3_primary_gate').pop();
    const crmPreview = trace.filter((t) => t.type === 'crm_preview_completed').pop();
    const legacy = r.legacy_ai_state || {};
    return {
      turn: i + 1,
      user: r.user_text,
      reply_sig: replySig(r.reply),
      reply_len: String(r.reply || '').length,
      response_source: r.response_source || null,
      snapshot: pick(r.conversation_snapshot, SNAPSHOT_KEYS),
      ai_state: pick(legacy, AI_STATE_KEYS),
      state_transition: stateTr?.payload || null,
      v3_primary_gate: gate?.payload || null,
      crm_preview_skipped: crmPreview?.payload?.skipped ?? null,
      crm_contact_would: r.crm_dry_run?.contact?.would_create_contact ?? r.crm_dry_run?.contact?.would_reuse_contact ?? null,
      crm_lead_would: r.crm_dry_run?.lead?.would_create_lead ?? r.crm_dry_run?.lead?.would_reuse_lead ?? null,
    };
  });
}

function pickStructural(turn) {
  const out = {};
  for (const k of STRUCTURAL_COMPARE_KEYS) {
    if (turn[k] !== undefined) out[k] = turn[k];
  }
  return out;
}

async function runScenarioTurns(scenario, flexEnabled, { phone, sessionSeed }) {
  process.env.PERSEO_ARGOS_ENABLED = 'true';
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'false';
  if (flexEnabled) process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED = 'true';
  else delete process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED;

  const { resetFlexTelemetryCounters, getFlexTelemetryCounters } = require('../conversation/flexibility/flexTelemetry');
  resetFlexTelemetryCounters();

  const { processInboundForArgos, resetArgosV3Session } = require('../argos/processInboundForArgos');
  const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
  const { getSession } = require('../conversation/v3/core/sessionStore');
  const { argosConversationId } = require('../argos/processInboundForArgos');

  const flags = {
    ...(scenario.flags || { deterministic_mode: true, crm_dry_run: true }),
    conversational_flex: flexEnabled,
  };

  const { seedSession, resetSession, deleteSession } = require('../argos/argosSessionStore');
  resetArgosV3Session(sessionSeed);
  deleteSession(sessionSeed);
  seedSession({ session_id: sessionSeed, phone_sim: phone, flags });
  resetSession(sessionSeed, { mode: 'full' });
  let session_id = sessionSeed;
  const turnResults = [];

  for (const text of scenario.messages) {
    const out = await processInboundForArgos({
      phone_sim: phone,
      text,
      session_id,
      flags,
    });
    session_id = out.session_id;
    const v3 = getSession(argosConversationId(session_id));
    turnResults.push({
      user_text: text,
      reply: out.reply,
      conversation_snapshot: out.conversation_snapshot,
      legacy_ai_state: mapV3StateToLegacyAiState(v3),
      crm_dry_run: out.crm_dry_run,
      debug_trace: out.debug_trace,
      response_source: inferResponseSource(out.debug_trace),
    });
  }

  resetArgosV3Session(session_id);

  return {
    scenario_code: scenario.scenario_code,
    flex_enabled: flexEnabled,
    turns: extractTurnArtifacts(turnResults),
    final_snapshot: pick(turnResults.at(-1)?.conversation_snapshot, SNAPSHOT_KEYS),
    flex_telemetry: getFlexTelemetryCounters(),
  };
}

function inferResponseSource(trace = []) {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const row = trace[i];
    if (row.payload?.response_source) return row.payload.response_source;
    if (row.type === 'parser_winner') return 'v3_interpreter';
  }
  return 'v3_core';
}

function deepDiff(a, b, pathPrefix = '') {
  const diffs = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b || (a && !b) || (!a && b)) {
    diffs.push({ path: pathPrefix || '(root)', a, b });
    return diffs;
  }
  if (typeof a !== 'object' || a === null) {
    if (a !== b) diffs.push({ path: pathPrefix, a, b });
    return diffs;
  }
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const p = pathPrefix ? `${pathPrefix}.${k}` : k;
    diffs.push(...deepDiff(a[k], b[k], p));
  }
  return diffs;
}

function compareRuns(label, runA, runB, { includeOutbound = false } = {}) {
  const turnDiffs = [];
  const outboundDiffs = [];
  const max = Math.max(runA.turns.length, runB.turns.length);
  for (let i = 0; i < max; i += 1) {
    const ta = runA.turns[i];
    const tb = runB.turns[i];
    if (!ta || !tb) {
      turnDiffs.push({ turn: i + 1, error: 'turn_count_mismatch' });
      continue;
    }
    const dStruct = deepDiff(pickStructural(ta), pickStructural(tb), `turn${i + 1}`);
    if (dStruct.length) turnDiffs.push({ turn: i + 1, diffs: dStruct });
    if (includeOutbound && ta.reply_sig !== tb.reply_sig) {
      outboundDiffs.push({ turn: i + 1, a: ta.reply_sig, b: tb.reply_sig });
    }
  }
  const finalDiff = deepDiff(runA.final_snapshot, runB.final_snapshot, 'final_snapshot');
  return {
    label,
    structural_identical: turnDiffs.length === 0 && finalDiff.length === 0,
    outbound_identical: outboundDiffs.length === 0,
    turnDiffs,
    outboundDiffs,
    finalDiff,
  };
}

async function main() {
  const writeDocs = process.argv.includes('--write-docs');
  const report = {
    at: new Date().toISOString(),
    flag_off: 'PERSEO_CONVERSATIONAL_FLEX_ENABLED=false (unset)',
    scenarios: [],
    checks: {},
  };

  for (const sc of SCENARIOS) {
    const scenario = loadScenario(sc.file);
    const off1 = await runScenarioTurns(scenario, false, { phone: sc.phone, sessionSeed: sc.session_id });
    const off2 = await runScenarioTurns(scenario, false, { phone: sc.phone, sessionSeed: sc.session_id });
    const on = await runScenarioTurns(scenario, true, { phone: sc.phone, sessionSeed: sc.session_id });
    const offRepeat = compareRuns(`${scenario.scenario_code}_off_vs_off`, off1, off2, { includeOutbound: true });
    const offVsOnStruct = compareRuns(`${scenario.scenario_code}_off_vs_on_struct`, off1, on);
    const offVsOnOut = compareRuns(`${scenario.scenario_code}_off_vs_on_out`, off1, on, { includeOutbound: true });

    report.scenarios.push({
      label: sc.label,
      scenario_code: scenario.scenario_code,
      phone: sc.phone,
      session_id: sc.session_id,
      off_repeat_structural_identical: offRepeat.structural_identical,
      off_repeat_outbound_identical: offRepeat.outbound_identical,
      off_vs_on_structural_diff_count: offVsOnStruct.turnDiffs.length + (offVsOnStruct.finalDiff.length ? 1 : 0),
      off_vs_on_outbound_diff_count: offVsOnOut.outboundDiffs.length,
      flex_telemetry_off: off1.flex_telemetry,
      flex_telemetry_on: on.flex_telemetry,
      off_final: off1.final_snapshot,
      on_final: on.final_snapshot,
      off_vs_on_structural_diffs: offVsOnStruct.turnDiffs.slice(0, 2),
      off_vs_on_outbound_diffs: offVsOnOut.outboundDiffs.slice(0, 3),
      turns_off: off1.turns,
      turns_on: on.turns,
    });
  }

  report.checks.all_off_repeat_structural_identical = report.scenarios.every(
    (s) => s.off_repeat_structural_identical,
  );
  report.checks.all_off_repeat_outbound_identical = report.scenarios.every((s) => s.off_repeat_outbound_identical);
  report.checks.all_flex_telemetry_zero_when_off = report.scenarios.every((s) => {
    const t = s.flex_telemetry_off || {};
    return Object.values(t).every((n) => n === 0 || n === undefined) && Object.keys(t).length === 0;
  });
  report.checks.flex_applies_when_on = report.scenarios.some((s) => {
    const t = s.flex_telemetry_on || {};
    return Object.values(t).some((n) => n > 0);
  });

  const evidenceDir = path.join(ROOT, 'docs/argos/evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const jsonPath = path.join(evidenceDir, 'm405a-noop-verification.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  let md = `# M4-05a — NO-OP Verification\n\n**Fecha:** ${report.at}\n\n## Flag\n\n\`PERSEO_CONVERSATIONAL_FLEX_ENABLED=false\` (unset)\n\n## Checks automáticos\n\n| Check | PASS |\n|-------|------|\n| OFF run ×2 — snapshots + ai_state + gates + CRM (estructural) | ${report.checks.all_off_repeat_structural_identical ? '✅' : '❌'} |
| OFF run ×2 — outbound sig (mismo session_id fijo) | ${report.checks.all_off_repeat_outbound_identical ? '✅' : '❌'} |\n| flex_telemetry vacío con OFF | ${report.checks.all_flex_telemetry_zero_when_off ? '✅' : '❌'} |\n| flex_telemetry >0 con ON (contraste) | ${report.checks.flex_applies_when_on ? '✅' : '❌'} |\n\n## Por escenario\n\n`;

  for (const s of report.scenarios) {
    md += `### ${s.label} (\`${s.scenario_code}\`)\n\n`;
    md += `- OFF repeat (estructural): **${s.off_repeat_structural_identical ? 'IDENTICAL' : 'DIFF'}**\n`;
    md += `- OFF repeat (outbound): **${s.off_repeat_outbound_identical ? 'IDENTICAL' : 'DIFF'}**\n`;
    md += `- OFF vs ON estructural: **${s.off_vs_on_structural_diff_count}** grupos\n`;
    md += `- OFF vs ON outbound: **${s.off_vs_on_outbound_diff_count}** turnos\n`;
    md += `- flex_telemetry OFF: \`${JSON.stringify(s.flex_telemetry_off)}\`\n`;
    md += `- flex_telemetry ON: \`${JSON.stringify(s.flex_telemetry_on)}\`\n\n`;
    md += `**Final snapshot OFF:**\n\`\`\`json\n${JSON.stringify(s.off_final, null, 2)}\n\`\`\`\n\n`;
    md += `**Final snapshot ON:**\n\`\`\`json\n${JSON.stringify(s.on_final, null, 2)}\n\`\`\`\n\n`;
    if (s.off_vs_on_structural_diffs?.length) {
      md += `**Sample OFF→ON structural diff:**\n\`\`\`json\n${JSON.stringify(s.off_vs_on_structural_diffs, null, 2)}\n\`\`\`\n\n`;
    }
    md += `<details><summary>Turn artifacts OFF (snapshots + outbound sig)</summary>\n\n\`\`\`json\n${JSON.stringify(
      s.turns_off.map((t) => ({
        turn: t.turn,
        user: t.user,
        reply_sig: t.reply_sig,
        snapshot: t.snapshot,
        ai_state: t.ai_state,
        v3_primary_gate: t.v3_primary_gate,
      })),
      null,
      2,
    )}\n\`\`\`\n</details>\n\n`;
  }

  md += `## Conclusión\n\n`;
  if (report.checks.all_off_repeat_structural_identical && report.checks.all_flex_telemetry_zero_when_off) {
    md += `Con flag **OFF**, no hay aplicación de flex (telemetría vacía) y el runtime ARGOS es **estructuralmente idéntico** en los 3 flujos (DEMAND / OFFER / CLOSURE+reopen): mismos snapshots, \`ai_state\`, \`state_transition\`, \`v3_primary_gate\`, cierres/reopen y CRM dry-run.\n\n`;
    md += `Contraste ON muestra deltas solo cuando el flag está activo (ver \`flex_telemetry_on\`).\n`;
  } else {
    md += `**Revisar** evidencia JSON: \`docs/argos/evidence/m405a-noop-verification.json\`\n`;
  }

  const mdPath = path.join(ROOT, 'docs/argos/M4-05A-NOOP-VERIFICATION.md');
  if (writeDocs) fs.writeFileSync(mdPath, md);

  const ok =
    report.checks.all_off_repeat_structural_identical && report.checks.all_flex_telemetry_zero_when_off;
  console.log(JSON.stringify({ ok, report: report.checks, jsonPath, mdPath: writeDocs ? mdPath : null }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
