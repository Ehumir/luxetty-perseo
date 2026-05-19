#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Verify staging DB tables, indexes, RLS policies.
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-verify-db.js [--json]
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');
const { SUPABASE_URL } = require('../config/env');
const { probeTable } = require('../conversation/v3/runtime/runtimeTableProbe');
const {
  REQUIRED_TABLES,
  CRM_OUTBOX_INDEXES,
  parseArgs,
  maskUrl,
  assertStagingSafe,
  printResult,
  exitCode,
} = require('./staging/stagingLib');

async function tableProbe(tableName) {
  const exists = await probeTable(supabase, tableName);
  if (exists) return { exists: true };
  const { error } = await supabase.from(tableName).select('id').limit(1);
  return { exists: false, error: error?.message || error?.code || 'probe_failed' };
}

async function countTable(tableName) {
  const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

async function main() {
  const args = parseArgs();
  const safe = assertStagingSafe(args);

  const tables = {};
  let allTables = true;
  for (const t of REQUIRED_TABLES) {
    const probe = await tableProbe(t);
    tables[t] = { ...probe, ...(probe.exists ? await countTable(t) : {}) };
    if (!probe.exists) allTables = false;
  }

  const indexNote =
    'Confirm idx_crm_outbox_status_scheduled and idx_crm_outbox_worker_poll in Supabase SQL editor';

  const result = {
    ok: allTables,
    details: {
      supabase_host: maskUrl(SUPABASE_URL),
      staging_guard: safe,
      tables,
      expected_indexes: CRM_OUTBOX_INDEXES,
      index_note: indexNote,
      rls_note: 'service_role should bypass RLS — verify policies in dashboard',
    },
  };

  printResult('staging-verify-db', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
