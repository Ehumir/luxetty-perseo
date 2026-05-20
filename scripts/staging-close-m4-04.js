#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Operational close checklist (Railway + WA + staging suites).
 *
 * Usage:
 *   PERSEO_BASE_URL_STAGING=https://your-staging.up.railway.app \
 *   PERSEO_STAGING_CONFIRMED=true \
 *   M4_RAILWAY_REQUIRE_HEARTBEAT=true \
 *   node scripts/staging-close-m4-04.js
 */

require('dotenv').config();

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function run(script, extraEnv = {}) {
  const res = spawnSync('node', [path.join(__dirname, script), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PERSEO_STAGING_CONFIRMED: 'true', ...extraEnv },
  });
  let parsed = null;
  try {
    const line = (res.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{'));
    if (line) parsed = JSON.parse(line);
  } catch {
    parsed = null;
  }
  return {
    script,
    ok: res.status === 0,
    exit_code: res.status,
    suite: parsed?.suite || script,
    parsed,
    stderr: (res.stderr || '').slice(0, 400),
  };
}

const steps = [
  { name: 'wa_allowlist', script: 'staging-wa-allowlist-validate.js', required: true },
  { name: 'verify_db', script: 'staging-verify-db.js', required: true },
  { name: 'railway', script: 'staging-railway-check.js', required: false },
  { name: 'phases', script: 'staging-execute-phases.js', required: true, args: ['--phase=all'] },
  { name: 'wa_collect', script: 'staging-wa-collect-results.js', required: true },
];

const report = { ok: true, steps: [], blockers: [] };

for (const step of steps) {
  const scriptPath = step.script;
  const res = spawnSync(
    'node',
    [path.join(__dirname, scriptPath), '--json', ...(step.args || [])],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PERSEO_STAGING_CONFIRMED: 'true' },
    },
  );
  let parsed = null;
  try {
    const line = (res.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{'));
    if (line) parsed = JSON.parse(line);
  } catch {
    parsed = null;
  }
  const entry = {
    name: step.name,
    ok: res.status === 0,
    exit_code: res.status,
    parsed,
  };
  report.steps.push(entry);
  if (step.required && !entry.ok) {
    report.ok = false;
    if (step.name === 'wa_allowlist') {
      report.blockers.push('allowlist-10: set real phones in allowlist-10.local.yaml');
    }
    if (step.name === 'railway' && !process.env.PERSEO_BASE_URL_STAGING) {
      report.blockers.push('PERSEO_BASE_URL_STAGING not set');
    }
    if (step.name === 'wa_collect') {
      report.blockers.push('WA pilots not executed or no Supabase messages in collect window');
    }
  }
}

if (!process.env.PERSEO_BASE_URL_STAGING) {
  report.blockers.push('PERSEO_BASE_URL_STAGING missing — railway step optional until set');
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
