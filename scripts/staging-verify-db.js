#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Verify staging DB tables, indexes (via write probes), RLS.
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-verify-db.js [--json]
 *
 * Diagnosis notes:
 * - False "missing table" after migration: often stale PostgREST schema cache (wait/reload).
 * - False "missing" with table present: probe assumed `id` column — fixed via HEAD count probe.
 * - Project mismatch: compare SUPABASE_URL ref with dashboard staging ref.
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = require('../config/env');
const { probeTableDetailed, resetRuntimeTableProbeCache } = require('../conversation/v3/runtime/runtimeTableProbe');
const {
  REQUIRED_TABLES,
  CRM_OUTBOX_INDEXES,
  parseArgs,
  maskUrl,
  assertStagingSafe,
  printResult,
  exitCode,
} = require('./staging/stagingLib');

function extractProjectRef(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1] : host;
  } catch {
    return null;
  }
}

async function probeRlsWrite(tableName, buildRow, cleanup) {
  const { data, error } = await supabase.from(tableName).insert(buildRow()).select().maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (cleanup && data) await cleanup(data);
  return { ok: true };
}

async function verifyIndexesViaOutbox() {
  const convId = '00000000-0000-0000-0000-000000000099';
  const key = `staging-index-probe-${Date.now()}`;
  const { data: row, error: insErr } = await supabase
    .from('crm_outbox')
    .insert({
      conversation_id: convId,
      idempotency_key: key,
      payload: { probe: true },
      status: 'pending',
    })
    .select('id')
    .maybeSingle();
  if (insErr) return { ok: false, error: insErr.message };

  const { data: polled, error: pollErr } = await supabase
    .from('crm_outbox')
    .select('id, status, next_attempt_at')
    .eq('id', row.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (pollErr) {
    await supabase.from('crm_outbox').delete().eq('id', row.id);
    return { ok: false, error: pollErr.message };
  }

  const found = polled?.id === row.id;
  await supabase.from('crm_outbox').delete().eq('id', row.id);
  return {
    ok: found,
    worker_poll_query_ok: found,
    expected_indexes: CRM_OUTBOX_INDEXES,
    note: found
      ? 'pending poll query succeeded (indexes likely present)'
      : 'insert OK but poll query did not return row — check idx_crm_outbox_worker_poll',
  };
}

async function verifyHeartbeatTable() {
  const workerId = `staging-verify-${Date.now()}`;
  const { error: upErr } = await supabase.from('crm_worker_heartbeats').upsert({
    worker_id: workerId,
    last_seen_at: new Date().toISOString(),
    metadata: { probe: true, suite: 'staging-verify-db' },
  });
  if (upErr) return { ok: false, error: upErr.message, note: 'PK is worker_id — not id' };

  const { data, error: readErr } = await supabase
    .from('crm_worker_heartbeats')
    .select('worker_id, last_seen_at')
    .eq('worker_id', workerId)
    .maybeSingle();
  await supabase.from('crm_worker_heartbeats').delete().eq('worker_id', workerId);

  return {
    ok: !readErr && data?.worker_id === workerId,
    pk_column: 'worker_id',
    read_error: readErr?.message || null,
  };
}

async function main() {
  const args = parseArgs();
  resetRuntimeTableProbeCache();
  const safe = assertStagingSafe(args);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const result = { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
    printResult('staging-verify-db', result, args.json);
    exitCode(result);
    return;
  }

  const tables = {};
  let allTables = true;
  for (const t of REQUIRED_TABLES) {
    const probe = await probeTableDetailed(supabase, t);
    tables[t] = probe;
    if (!probe.exists) allTables = false;
  }

  let telemetryRls = { skipped: true };
  let heartbeatProbe = { skipped: true };
  let indexProbe = { skipped: true };

  if (allTables) {
    telemetryRls = await probeRlsWrite(
      'wa_operational_telemetry',
      () => ({
        conversation_id: '00000000-0000-0000-0000-000000000099',
        channel: 'staging_verify',
        fallback_reason: 'rls_probe',
        metadata: { probe: true },
      }),
      (row) => supabase.from('wa_operational_telemetry').delete().eq('id', row.id),
    );
    heartbeatProbe = await verifyHeartbeatTable();
    indexProbe = await verifyIndexesViaOutbox();
  }

  const result = {
    ok:
      allTables &&
      telemetryRls.ok !== false &&
      heartbeatProbe.ok !== false &&
      indexProbe.ok !== false,
    details: {
      supabase_host: maskUrl(SUPABASE_URL),
      project_ref: extractProjectRef(SUPABASE_URL),
      staging_guard: safe,
      service_role_configured: !!SUPABASE_SERVICE_ROLE_KEY,
      diagnosis: {
        previous_false_negative:
          'probe used select(id) on crm_worker_heartbeats which has worker_id PK only',
        schema_cache:
          'if tables recently created, reload PostgREST schema in Supabase Settings → API',
      },
      tables,
      rls_telemetry_write: telemetryRls,
      heartbeat_table: heartbeatProbe,
      crm_outbox_poll: indexProbe,
    },
  };

  printResult('staging-verify-db', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
