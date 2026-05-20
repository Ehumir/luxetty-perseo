'use strict';

const { SUPABASE_URL } = require('../../config/env');

const REQUIRED_TABLES = [
  'crm_outbox',
  'crm_idempotency_keys',
  'crm_execution_logs',
  'crm_dead_letters',
  'wa_operational_telemetry',
  'runtime_metrics_rollup',
  'crm_worker_heartbeats',
];

const CRM_OUTBOX_INDEXES = [
  'idx_crm_outbox_status_scheduled',
  'idx_crm_outbox_worker_poll',
];

function parseMinArg(argv = process.argv.slice(2)) {
  const minFlag = argv.find((a) => a.startsWith('--min='));
  if (minFlag) {
    const n = Number(minFlag.split('=')[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envMin = Number(process.env.M4_WA_ALLOWLIST_MIN);
  if (Number.isFinite(envMin) && envMin > 0) return envMin;
  return 10;
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--') && !a.startsWith('--min='));
  return {
    dryRun: flags.has('--dry-run'),
    json: flags.has('--json'),
    force: flags.has('--force'),
    stagingConfirmed: flags.has('--staging-confirmed'),
    minPilots: parseMinArg(argv),
    tier: process.env.M4_WA_SMOKE_TIER || (parseMinArg(argv) <= 3 ? 'b1' : 'b2'),
    positional,
  };
}

function maskUrl(url) {
  if (!url) return '(missing)';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/***`;
  } catch {
    return '(invalid-url)';
  }
}

/**
 * Blocks accidental prod use unless explicitly confirmed.
 */
function assertStagingSafe(opts = {}) {
  if (process.env.PERSEO_STAGING_CONFIRMED === 'true' || opts.stagingConfirmed) {
    return { ok: true, mode: 'confirmed' };
  }
  const prodRef = String(process.env.PERSEO_PROD_SUPABASE_PROJECT_REF || '').trim();
  const url = String(SUPABASE_URL || '');
  if (prodRef && url.includes(prodRef)) {
    throw new Error(
      'SUPABASE_URL matches PERSEO_PROD_SUPABASE_PROJECT_REF — aborting. Set PERSEO_STAGING_CONFIRMED=true only on staging.',
    );
  }
  if (process.env.PERSEO_ENV === 'production') {
    throw new Error('PERSEO_ENV=production — aborting staging script.');
  }
  return { ok: true, mode: 'unchecked', warning: 'Set PERSEO_STAGING_CONFIRMED=true for staging runs' };
}

function printResult(name, result, json) {
  if (json) {
    console.log(JSON.stringify({ suite: name, ...result }, null, 2));
    return;
  }
  console.log(`\n=== ${name} ===`);
  console.log(result.ok ? 'PASS' : 'FAIL');
  if (result.details) console.log(JSON.stringify(result.details, null, 2));
  if (result.error) console.error(result.error);
}

function exitCode(result) {
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  REQUIRED_TABLES,
  CRM_OUTBOX_INDEXES,
  parseArgs,
  parseMinArg,
  maskUrl,
  assertStagingSafe,
  printResult,
  exitCode,
};
