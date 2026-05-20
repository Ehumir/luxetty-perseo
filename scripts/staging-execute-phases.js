#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Run staging verification suites per activation phase.
 * Usage: PERSEO_STAGING_CONFIRMED=true node scripts/staging-execute-phases.js [--phase=all|1|2|3|4]
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
const phase = phaseArg ? phaseArg.split('=')[1] : 'all';

const PHASE_ENV = {
  0: {},
  1: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
  },
  2: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
    PERSEO_CRM_DURABILITY_ENABLED: 'true',
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: 'true',
    PERSEO_CRM_WORKER_ASYNC_ENABLED: 'true',
    PERSEO_CRM_WORKER_PROCESS_ENABLED: 'true',
  },
  3: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
    PERSEO_CRM_DURABILITY_ENABLED: 'true',
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: 'true',
    PERSEO_CRM_WORKER_ASYNC_ENABLED: 'true',
    PERSEO_CRM_WORKER_PROCESS_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED: 'true',
    PERSEO_MEDIA_HARDENING_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED: 'true',
  },
  4: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
    PERSEO_CRM_DURABILITY_ENABLED: 'true',
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: 'true',
    PERSEO_CRM_WORKER_ASYNC_ENABLED: 'true',
    PERSEO_CRM_WORKER_PROCESS_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED: 'true',
    PERSEO_MEDIA_HARDENING_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED: 'true',
    PERSEO_RUNTIME_SAFETY_ENABLED: 'true',
    PERSEO_REPLAY_ENGINE_ENABLED: 'true',
  },
};

const PHASE_SCRIPTS = {
  0: ['staging-verify-db.js'],
  1: ['staging-verify-db.js', 'staging-telemetry-smoke.js', 'staging-runtime-health.js'],
  2: [
    'staging-crm-db-smoke.js',
    'staging-worker-tick.js',
    'staging-crm-worker-smoke.js',
    'staging-duplicate-check.js',
  ],
  3: ['staging-media-smoke.js'],
  4: ['staging-replay-smoke.js'],
};

function runScript(script, env) {
  const res = spawnSync('node', [path.join(__dirname, script), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      PERSEO_STAGING_CONFIRMED: 'true',
    },
  });
  let parsed = null;
  try {
    const lines = (res.stdout || '').trim().split('\n');
    const jsonLine = lines.reverse().find((l) => l.startsWith('{'));
    if (jsonLine) parsed = JSON.parse(jsonLine);
  } catch {
    parsed = null;
  }
  return {
    script,
    exit_code: res.status,
    ok: res.status === 0,
    suite: parsed?.suite || script,
    parsed,
    stderr: (res.stderr || '').slice(0, 500),
  };
}

function phasesToRun() {
  if (phase === 'all') return ['0', '1', '2', '3', '4'];
  return [String(phase)];
}

const report = { phase, results: [], ok: true };

for (const p of phasesToRun()) {
  const env = PHASE_ENV[p] || {};
  const scripts = PHASE_SCRIPTS[p] || [];
  const phaseResult = { phase: p, env, scripts: [] };
  for (const s of scripts) {
    const r = runScript(s, env);
    phaseResult.scripts.push(r);
    if (!r.ok) report.ok = false;
  }
  report.results.push(phaseResult);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
