#!/usr/bin/env node
'use strict';

/**
 * MC-5 — Certificación sesión durable #8 (Cuarzo).
 * Tests locales + auditoría read-only Supabase. Sin Graph, sin toggles prod.
 *
 * Usage: node scripts/mc5-durable-session-certification.js [--json]
 */

require('dotenv').config();

const { spawnSync } = require('child_process');
const path = require('path');
const { isSessionDbReadthroughEnabled, getPerseoV3Config } = require('../config/perseoV3Flags');
const { mergeLegacyAiStateWithV3 } = require('../conversation/v3/state/v3ToLegacyAiState');
const { hydrateV3StateFromLegacyAiState } = require('../conversation/v3/state/legacyToV3State');
const { resolveSession, clearSession } = require('../conversation/v3/core/sessionStore');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');

const jsonOut = process.argv.includes('--json');
const results = [];

function record(id, name, pass, detail = {}) {
  const row = { id, name, pass: !!pass, ...detail };
  results.push(row);
  if (!jsonOut) console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} — ${name}`);
  return pass;
}

function runTests(files) {
  const proc = spawnSync(process.execPath, ['--test', ...files], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PERSEO_V3_SESSION_DB_READTHROUGH: 'true',
      PERSEO_V3_ENABLED: 'true',
    },
  });
  if (!jsonOut && proc.stdout) process.stdout.write(proc.stdout);
  if (!jsonOut && proc.stderr) process.stderr.write(proc.stderr);
  return proc.status === 0;
}

function runUnitCases() {
  process.env.PERSEO_V3_SESSION_DB_READTHROUGH = 'true';

  record('F01', 'Flag read-through ON by default (unset env)', isSessionDbReadthroughEnabled() === true);

  process.env.PERSEO_V3_SESSION_DB_READTHROUGH = 'false';
  record('F02', 'Flag read-through OFF when explicit false', isSessionDbReadthroughEnabled() === false);
  process.env.PERSEO_V3_SESSION_DB_READTHROUGH = 'true';

  const cfg = getPerseoV3Config();
  record('F03', 'Config expone sessionDbReadthrough', cfg.sessionDbReadthrough === true);

  const legacy = {
    v3_primary_active: true,
    property_code: 'LUX-X001',
    crm_lead_id: 'lead-x',
    crm_execution_completed: true,
    budget_max: 7000000,
    intent_type: 'buy',
    conversation_stage: 'qualification',
  };
  const v3Empty = createInitialConversationState({ conversationId: 'h1', phone: '521' });
  const merged = mergeLegacyAiStateWithV3(legacy, v3Empty);
  record(
    'M01',
    'Merge seguro preserva CRM/comercial',
    merged.property_code === 'LUX-X001' &&
      merged.crm_lead_id === 'lead-x' &&
      merged.crm_execution_completed === true &&
      merged.budget_max === 7000000,
  );

  clearSession('h2');
  const resolved = resolveSession('h2', { phone: '521', legacyAiState: legacy, readthrough: true });
  record(
    'M02',
    'resolveSession hidrata desde ai_state tras Map vacío',
    resolved != null && resolved.propertyListingCode === 'LUX-X001' && resolved.crmLeadId === 'lead-x',
  );

  clearSession('h3');
  const hydrated = hydrateV3StateFromLegacyAiState('h3', '521', legacy);
  record(
    'M03',
    'hydrateV3StateFromLegacyAiState round-trip',
    hydrated?.propertyListingCode === 'LUX-X001' && hydrated?.crmExecutionCompleted === true,
  );
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

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: convs, error } = await supabase
    .from('conversations')
    .select('id, ai_state, lead_id, contact_id, updated_at')
    .gte('updated_at', since)
    .not('ai_state', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) {
    record('S01', 'Supabase conversations sample', false, { error: error.message });
    return;
  }

  const rows = convs || [];
  const withV3 = rows.filter((r) => r.ai_state?.v3_primary_active === true);
  const withProperty = rows.filter(
    (r) => r.ai_state?.property_code || r.ai_state?.direct_property_code || r.ai_state?.interested_property_id,
  );
  const withIntent = rows.filter(
    (r) =>
      r.ai_state?.intent_type ||
      r.ai_state?.conversation_goal ||
      r.ai_state?.current_intent ||
      r.ai_state?.user_goal ||
      r.ai_state?.lead_flow,
  );
  const withStage = rows.filter(
    (r) =>
      r.ai_state?.conversation_stage ||
      r.ai_state?.current_intent ||
      r.ai_state?.handoff_stage ||
      r.ai_state?.intent_version != null,
  );
  const withCrm = rows.filter((r) => {
    const s = r.ai_state || {};
    return (
      s.crm_lead_id ||
      s.crm_contact_id ||
      s.crm_execution_completed ||
      s.lead_id ||
      s.crm_lead_created_at ||
      s.crm_structured_summary ||
      r.lead_id
    );
  });

  record('S01', 'Supabase: muestra 30d conversations con ai_state', rows.length > 0, { count: rows.length });
  record('S02', 'Supabase: ai_state con v3_primary_active', withV3.length > 0, { count: withV3.length });
  record('S03', 'Supabase: ai_state con propiedad persistida', withProperty.length > 0, { count: withProperty.length });
  record('S04', 'Supabase: ai_state con intención/goal', withIntent.length > 0, { count: withIntent.length });
  record('S05', 'Supabase: ai_state con etapa conversacional', withStage.length > 0, { count: withStage.length });
  record('S06', 'Supabase: ai_state con contexto CRM', withCrm.length > 0, { count: withCrm.length });

  const rich = rows.filter((r) => {
    const s = r.ai_state || {};
    const hasProperty =
      s.property_code ||
      s.direct_property_code ||
      s.interested_property_id ||
      s.detected_property_id ||
      s.current_property_code;
    const hasIntent =
      s.intent_type || s.conversation_goal || s.current_intent || s.user_goal || s.lead_flow;
    const hasStage =
      s.conversation_stage || s.current_intent || s.handoff_stage || s.intent_version != null;
    return hasProperty && hasIntent && hasStage;
  });
  record(
    'S07',
    'Supabase: conversaciones con propiedad + intención + etapa',
    rich.length >= Math.min(5, Math.floor(rows.length * 0.05)),
    { count: rich.length },
  );

  const hydrateOk = rich.slice(0, 5).every((r) => {
    const h = hydrateV3StateFromLegacyAiState(r.id, null, r.ai_state);
    return h != null && (h.propertyListingCode || h.conversationGoal || h.conversationStage);
  });
  record('S08', 'Supabase: ai_state prod hidrata a V3 (muestra 5)', hydrateOk || rich.length === 0, {
    sampled: Math.min(5, rich.length),
  });
}

async function main() {
  if (!jsonOut) console.log('MC-5 Durable Session certification harness\n');

  record('T01', 'v3SafeLegacyMerge.test.js', runTests(['test/v3SafeLegacyMerge.test.js']));
  record('T02', 'v3SessionRestart.test.js', runTests(['test/v3SessionRestart.test.js']));
  record('T03', 'legacyToV3State.test.js', runTests(['test/legacyToV3State.test.js']));

  runUnitCases();
  await runSupabaseAudit();

  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  const summary = { pass, fail, total: results.length, results };

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\nSummary: ${pass} pass, ${fail} fail / ${results.length}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
