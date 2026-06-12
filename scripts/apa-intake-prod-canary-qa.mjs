#!/usr/bin/env node
/**
 * APA Intake — canary prod QA (solo PERSEO_V3_QA_ALLOWLIST).
 * Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en env.
 *
 * Uso:
 *   PERSEO_APA_INTAKE_HYDRATION=true \
 *   PERSEO_APA_INTAKE_WINDOW_HOURS=48 \
 *   PERSEO_V3_QA_ALLOWLIST=5218181877351 \
 *   node scripts/apa-intake-prod-canary-qa.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const intakeHydration = require('../services/intake/intakeHydration');

const QA_PHONE = '5218181877351';
const EVIDENCE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../luxetty-atena/docs/intake/evidence/block-e-qa-20260612',
);

function assertEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function main() {
  const supabase = createClient(assertEnv('SUPABASE_URL'), assertEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  const propertySlug = 'residencia-en-puerta-de-hierro-privada-2';
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select('id, slug, listing_id')
    .eq('slug', propertySlug)
    .limit(1)
    .maybeSingle();

  if (propErr || !property?.id) {
    throw new Error(`Property demo not found: ${propertySlug}`);
  }

  const leadsBefore = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp', QA_PHONE);

  const rpcPayload = {
    landing_key: 'property_demand',
    config_version: 1,
    property_id: property.id,
    property_slug: property.slug,
    listing_id: property.listing_id || null,
    capture_path: 'form_primary',
    cta_source: 'apa_intake_prod_canary_qa',
    answers: {
      full_name: 'APA Intake Canary QA',
      whatsapp: QA_PHONE,
      intent: 'request_info',
    },
    attribution: {
      landing_slug: `/propiedad/${property.slug}`,
      utm_campaign: 'apa_intake_canary',
    },
  };

  const { data: rpcResult, error: rpcError } = await supabase.rpc('create_intake_submission', {
    p_payload: rpcPayload,
  });

  if (rpcError) throw new Error(`create_intake_submission: ${rpcError.message}`);
  const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
  if (!result?.success) throw new Error(`RPC not success: ${JSON.stringify(result)}`);

  const bridgeToken = result.bridge_token;
  const intakeId = result.intake_id;
  const leadId = result.lead_id;

  const events = [];
  const turn = await intakeHydration.tryIntakeHydrationTurn({
    supabase,
    phone: QA_PHONE,
    text: `Hola, completé el formulario intake=${bridgeToken}`,
    logEvent: (name, payload) => events.push({ name, payload }),
  });

  const { data: intakeRow } = await supabase
    .from('intake_submissions')
    .select('id, status, lead_id, bridge_token')
    .eq('id', intakeId)
    .maybeSingle();

  const leadsAfter = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp', QA_PHONE);

  const checks = {
    rpc_success: result.success === true,
    hydration_handled: turn.handled === true,
    skip_legacy_crm: turn.skipLegacyCrm === true,
    status_bridged: intakeRow?.status === 'bridged',
    lead_id_stable: intakeRow?.lead_id === leadId,
    no_new_lead_rows:
      (leadsAfter.count ?? 0) === (leadsBefore.count ?? 0) ||
      (leadsAfter.count ?? 0) <= (leadsBefore.count ?? 0) + 1,
    allowlist_event: events.some((e) => e.name === 'apa_intake_hydration_applied'),
    skipped_not_allowlisted: events.some((e) => e.name === 'apa_intake_skipped_not_allowlisted'),
  };

  const pass = Object.entries(checks)
    .filter(([k]) => k !== 'skipped_not_allowlisted')
    .every(([, v]) => v === true);

  const evidence = {
    run_date: new Date().toISOString(),
    qa_phone: QA_PHONE,
    intake_id: intakeId,
    lead_id: leadId,
    bridge_token: bridgeToken,
    turn_summary: {
      handled: turn.handled,
      skipLegacyCrm: turn.skipLegacyCrm,
      resolution: turn.resolution,
    },
    intake_status: intakeRow?.status,
    leads_count_before: leadsBefore.count,
    leads_count_after: leadsAfter.count,
    checks,
    pass,
    events: events.map((e) => e.name),
  };

  try {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, 'prod-canary-perseo-20260612.json'),
      JSON.stringify(evidence, null, 2),
    );
  } catch {
    writeFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'prod-canary-perseo-20260612.json'),
      JSON.stringify(evidence, null, 2),
    );
  }

  console.log(JSON.stringify(evidence, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
