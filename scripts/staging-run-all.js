#!/usr/bin/env node
'use strict';

/**
 * Run all M4-04 staging smokes (local-safe; DB scripts need PERSEO_STAGING_CONFIRMED).
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const scripts = [
  'staging-media-smoke.js',
  'staging-crm-worker-smoke.js',
  'staging-replay-smoke.js',
  'staging-runtime-health.js',
  'staging-telemetry-smoke.js',
  'staging-verify-db.js',
  'staging-duplicate-check.js',
];

let failed = 0;
for (const s of scripts) {
  const res = spawnSync('node', [path.join(__dirname, s), '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PERSEO_STAGING_CONFIRMED: process.env.PERSEO_STAGING_CONFIRMED || 'false' },
  });
  const out = (res.stdout || '') + (res.stderr || '');
  console.log(out);
  if (res.status !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
