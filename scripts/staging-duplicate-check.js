#!/usr/bin/env node
'use strict';

/**
 * M4-04 — CRM duplicate detection (staging DB).
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-duplicate-check.js [--json]
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');
const { parseArgs, assertStagingSafe, printResult, exitCode, maskUrl } = require('./staging/stagingLib');
const { SUPABASE_URL } = require('../config/env');

async function main() {
  const args = parseArgs();
  const safe = assertStagingSafe(args);

  if (process.env.PERSEO_STAGING_CONFIRMED !== 'true' || args.dryRun) {
    const result = {
      ok: true,
      details: {
        skipped: true,
        reason: 'Set PERSEO_STAGING_CONFIRMED=true to query staging leads',
        host: maskUrl(SUPABASE_URL),
        staging_guard: safe,
      },
    };
    printResult('staging-duplicate-check', result, args.json);
    exitCode(result);
    return;
  }

  const { data: leads, error: leadErr } = await supabase
    .from('leads')
    .select('contact_id, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  const leadDups = [];
  if (!leadErr && Array.isArray(leads)) {
    const map = new Map();
    for (const row of leads) {
      if (!row.contact_id) continue;
      map.set(row.contact_id, (map.get(row.contact_id) || 0) + 1);
    }
    for (const [contact_id, n] of map) {
      if (n > 1) leadDups.push({ contact_id, count: n });
    }
  }

  let idemDups = [];
  const { data: idem, error: idemErr } = await supabase.from('crm_idempotency_keys').select('conversation_id, idempotency_key');
  if (!idemErr && Array.isArray(idem)) {
    const seen = new Set();
    for (const row of idem) {
      const k = `${row.conversation_id}:${row.idempotency_key}`;
      if (seen.has(k)) idemDups.push({ key: k });
      seen.add(k);
    }
  }

  const { count: dlqCount } = await supabase
    .from('crm_dead_letters')
    .select('*', { count: 'exact', head: true });

  const result = {
    ok: leadDups.length === 0 && idemDups.length === 0,
    details: {
      host: maskUrl(SUPABASE_URL),
      staging_guard: safe,
      lead_duplicates_7d: leadDups,
      idempotency_duplicates: idemDups,
      dead_letter_count: dlqCount ?? null,
      lead_query_error: leadErr?.message || null,
    },
  };

  printResult('staging-duplicate-check', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
