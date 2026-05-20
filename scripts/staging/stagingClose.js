'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const SCRIPTS = path.join(__dirname, '..');

function runScript(script, extraArgs = [], extraEnv = {}) {
  const res = spawnSync(
    'node',
    [path.join(SCRIPTS, script), '--json', ...extraArgs],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PERSEO_STAGING_CONFIRMED: 'true', ...extraEnv },
    },
  );
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
    parsed,
    stderr: (res.stderr || '').slice(0, 400),
  };
}

function closeTechnical() {
  const steps = [];
  const blockers = [];

  steps.push(runScript('staging-verify-db.js'));
  if (!steps[steps.length - 1].ok) blockers.push('staging-verify-db failed');

  if (process.env.PERSEO_BASE_URL_STAGING) {
    steps.push(
      runScript('staging-railway-check.js', [], {
        M4_RAILWAY_REQUIRE_HEARTBEAT: process.env.M4_RAILWAY_REQUIRE_HEARTBEAT || 'true',
      }),
    );
    if (!steps[steps.length - 1].ok) {
      blockers.push('staging-railway-check failed (webhook or heartbeat)');
    }
  } else {
    steps.push({
      script: 'staging-railway-check.js',
      ok: false,
      skipped: true,
      reason: 'PERSEO_BASE_URL_STAGING not set',
    });
    blockers.push('PERSEO_BASE_URL_STAGING missing');
  }

  steps.push(runScript('staging-execute-phases.js', ['--phase=all']));
  if (!steps[steps.length - 1].ok) blockers.push('staging-execute-phases failed');

  steps.push(runScript('staging-duplicate-check.js'));
  if (!steps[steps.length - 1].ok) blockers.push('staging-duplicate-check failed');

  const ok = blockers.length === 0;
  return {
    track: 'M4-04A',
    label: 'Technical Staging',
    verdict: ok ? 'GO' : 'NO-GO',
    ok,
    steps,
    blockers,
  };
}

function closeWa(minPilots) {
  const tier = minPilots <= 3 ? 'b1' : 'b2';
  const steps = [];
  const blockers = [];

  steps.push(
    runScript('staging-wa-allowlist-validate.js', [`--min=${minPilots}`], {
      M4_WA_ALLOWLIST_MIN: String(minPilots),
      M4_WA_SMOKE_TIER: tier,
    }),
  );
  if (!steps[steps.length - 1].ok) {
    blockers.push(`allowlist: need ${minPilots} real QA phones (allowlist-b1.local.yaml or allowlist-10.local.yaml)`);
  }

  steps.push(
    runScript('staging-wa-collect-results.js', [`--min=${minPilots}`], {
      M4_WA_ALLOWLIST_MIN: String(minPilots),
      M4_WA_SMOKE_TIER: tier,
    }),
  );
  if (!steps[steps.length - 1].ok) {
    blockers.push('WA collect: run manual pilots then re-run collect');
  }

  const ok = blockers.length === 0;
  return {
    track: tier === 'b1' ? 'M4-04B' : 'M4-04C',
    label: tier === 'b1' ? 'WhatsApp Smoke B1' : 'WhatsApp Smoke B2',
    verdict: ok ? 'GO' : 'NO-GO',
    ok,
    min_pilots: minPilots,
    steps,
    blockers,
  };
}

function closeFull() {
  const technical = closeTechnical();
  const wa = closeWa(10);
  return {
    track: 'M4-04-full',
    ok: technical.ok && wa.ok,
    technical,
    wa_b2: wa,
    verdict:
      technical.ok && wa.ok
        ? 'GO-full'
        : technical.ok
          ? 'GO-partial (technical only)'
          : 'NO-GO',
  };
}

module.exports = {
  runScript,
  closeTechnical,
  closeWa,
  closeFull,
};
