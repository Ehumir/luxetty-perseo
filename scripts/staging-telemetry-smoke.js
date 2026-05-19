#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Telemetry insert/read smoke (staging when confirmed).
 * Usage: PERSEO_STAGING_CONFIRMED=true PERSEO_WA_TELEMETRY_ENABLED=true node scripts/staging-telemetry-smoke.js
 */

require('dotenv').config();

process.env.PERSEO_WA_TELEMETRY_ENABLED = 'true';
process.env.PERSEO_RUNTIME_OBSERVABILITY_ENABLED = 'true';

const { supabase } = require('../services/supabaseService');
const { parseArgs, assertStagingSafe, printResult, exitCode, maskUrl } = require('./staging/stagingLib');
const { SUPABASE_URL } = require('../config/env');
const { recordOperationalEvent, resetMemoryTelemetry, getMemoryTelemetry } = require('../conversation/v3/runtime/waTelemetry');
const { buildRuntimeHealthSnapshot, resetRuntimeMetrics, recordMetric } = require('../conversation/v3/runtime/observability/runtimeMetricsCollector');

async function main() {
  const args = parseArgs();
  const safe = assertStagingSafe(args);

  resetMemoryTelemetry();
  resetRuntimeMetrics();

  const mem = recordOperationalEvent(null, {
    conversation_id: '00000000-0000-0000-0000-staging00000001',
    channel: 'staging_smoke',
    fallback_reason: 'staging_telemetry_smoke',
    metadata: { smoke: true, at: new Date().toISOString() },
  }, null, { argosMode: false });

  recordMetric('webhook_latency', { ms: 42, force: true });
  const health = buildRuntimeHealthSnapshot();

  let dbInsert = { skipped: true, reason: 'dry-run or not confirmed' };
  if (process.env.PERSEO_STAGING_CONFIRMED === 'true' && !args.dryRun) {
    const row = {
      conversation_id: '00000000-0000-0000-0000-staging00000001',
      channel: 'staging_smoke',
      fallback_reason: 'staging_telemetry_smoke',
      metadata: { smoke: true },
    };
    const { data, error } = await supabase.from('wa_operational_telemetry').insert(row).select('id').maybeSingle();
    dbInsert = error ? { ok: false, error: error.message } : { ok: true, id: data?.id };

    if (data?.id) {
      await supabase.from('wa_operational_telemetry').delete().eq('id', data.id);
    }
  }

  const result = {
    ok: mem.recorded === true && health.enabled !== false,
    details: {
      host: maskUrl(SUPABASE_URL),
      staging_guard: safe,
      memory_telemetry: mem,
      memory_rows: getMemoryTelemetry().length,
      runtime_health: health,
      db_insert: dbInsert,
    },
  };

  printResult('staging-telemetry-smoke', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
