#!/usr/bin/env node
'use strict';

/**
 * M4-04 — CRM duplicate detection (staging DB).
 * GO criterion: 0 idempotency duplicates; 0 new lead dupes since activation window.
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-duplicate-check.js [--json]
 */

require('dotenv').config();

const { supabase } = require('../services/supabaseService');
const { parseArgs, assertStagingSafe, printResult, exitCode, maskUrl } = require('./staging/stagingLib');
const { SUPABASE_URL } = require('../config/env');

const ACTIVATION_HOURS = Number(process.env.M4_STAGING_ACTIVATION_HOURS || 48);

function sinceIso() {
  return new Date(Date.now() - ACTIVATION_HOURS * 3600000).toISOString();
}

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

  const since = sinceIso();

  const { data: leadsRecent, error: leadErr } = await supabase
    .from('leads')
    .select('contact_id, created_at')
    .gte('created_at', since);

  const leadDupsRecent = [];
  if (!leadErr && Array.isArray(leadsRecent)) {
    const map = new Map();
    for (const row of leadsRecent) {
      if (!row.contact_id) continue;
      map.set(row.contact_id, (map.get(row.contact_id) || 0) + 1);
    }
    for (const [contact_id, n] of map) {
      if (n > 1) leadDupsRecent.push({ contact_id, count: n });
    }
  }

  const { data: leads7d } = await supabase
    .from('leads')
    .select('contact_id, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  const leadDups7d = [];
  if (Array.isArray(leads7d)) {
    const map = new Map();
    for (const row of leads7d) {
      if (!row.contact_id) continue;
      map.set(row.contact_id, (map.get(row.contact_id) || 0) + 1);
    }
    for (const [contact_id, n] of map) {
      if (n > 1) leadDups7d.push({ contact_id, count: n });
    }
  }

  let idemDups = [];
  const { data: idem, error: idemErr } = await supabase
    .from('crm_idempotency_keys')
    .select('conversation_id, idempotency_key');
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

  const { count: pendingOutbox } = await supabase
    .from('crm_outbox')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'processing']);

  const m4GoOk = idemDups.length === 0 && leadDupsRecent.length === 0;

  const result = {
    ok: m4GoOk,
    details: {
      host: maskUrl(SUPABASE_URL),
      staging_guard: safe,
      activation_window_hours: ACTIVATION_HOURS,
      since,
      lead_duplicates_activation_window: leadDupsRecent,
      lead_duplicates_7d_historical: leadDups7d,
      historical_note:
        leadDups7d.length > 0
          ? 'Pre-existing staging data — not counted against M4 GO if activation_window is clean'
          : null,
      idempotency_duplicates: idemDups,
      dead_letter_count: dlqCount ?? null,
      outbox_pending_or_processing: pendingOutbox ?? null,
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
