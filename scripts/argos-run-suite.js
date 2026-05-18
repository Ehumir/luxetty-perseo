'use strict';

/**
 * Ejecuta suite de escenarios ARGOS desde manifest / release-p0.json.
 *
 * Uso:
 *   node scripts/argos-run-suite.js --suite release-p0
 *   node scripts/argos-run-suite.js --suite release-p0 --remote
 *   node scripts/argos-run-suite.js --list
 */

const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config();

const SCENARIOS_DIR = path.join(__dirname, '..', 'docs', 'argos', 'scenarios');
const SUITES_DIR = path.join(__dirname, '..', 'docs', 'argos', 'suites');
const MANIFEST_PATH = path.join(SCENARIOS_DIR, 'manifest.json');

const remote = process.argv.includes('--remote');
const listOnly = process.argv.includes('--list');
const suiteArg = process.argv.find((a) => a.startsWith('--suite='));
const suiteName = suiteArg
  ? suiteArg.split('=')[1]
  : process.argv.includes('--suite')
    ? process.argv[process.argv.indexOf('--suite') + 1]
    : 'release-p0';

const BASE = process.env.PERSEO_BASE_URL || 'http://localhost:3000';
const SECRET = process.env.ARGOS_SERVICE_SECRET || 'argos-local-validation-secret';

function loadSuite(name) {
  const suitePath = path.join(SUITES_DIR, `${name}.json`);
  if (fs.existsSync(suitePath)) {
    return JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const files = manifest.suites?.[name] || [];
  return {
    suite: name,
    threshold: { pass_rate: name === 'P0' || name === 'release-p0' ? 1.0 : 0.9 },
    scenarios: files.map((f) => (f.endsWith('.json') ? f : `${f}.json`)),
  };
}

function resolveScenarioPath(file) {
  const direct = path.join(SCENARIOS_DIR, file);
  if (fs.existsSync(direct)) return direct;
  const base = file.replace(/\.v\d+\.json$/, '');
  const alt = path.join(SCENARIOS_DIR, `${base}.v1.json`);
  if (fs.existsSync(alt)) return alt;
  throw new Error(`Scenario file not found: ${file}`);
}

async function runRemote(scenario, phoneSim) {
  const res = await fetch(`${BASE}/internal/argos/run-scenario`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Argos-Service-Secret': SECRET,
      'X-Argos-Admin-User-Id': '00000000-0000-0000-0000-000000000001',
    },
    body: JSON.stringify({
      phone_sim: phoneSim,
      flags: scenario.flags || { deterministic_mode: true, crm_dry_run: true },
      scenario,
    }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function runLocal(scenario, phoneSim) {
  process.env.PERSEO_ARGOS_ENABLED = 'true';
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'false';
  const { runArgosScenario } = require('../argos/scenarioRunner');
  const json = await runArgosScenario({
    phone_sim: phoneSim,
    flags: scenario.flags || { deterministic_mode: true, crm_dry_run: true },
    scenario,
  });
  return { status: 200, json };
}

async function main() {
  const suite = loadSuite(suiteName);
  if (listOnly) {
    console.log(JSON.stringify(suite, null, 2));
    return;
  }

  if (remote) {
    const health = await fetch(`${BASE}/internal/argos/health`, {
      headers: { 'X-Argos-Service-Secret': SECRET },
    });
    const healthJson = await health.json();
    console.log('health', health.status, healthJson.ok, 'build', healthJson.build_sha);
    if (!healthJson.ok) process.exit(1);
  }

  const results = [];
  let pass = 0;
  for (let i = 0; i < suite.scenarios.length; i += 1) {
    const file = suite.scenarios[i];
    const scenarioPath = resolveScenarioPath(file);
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
    const phoneSim = `5218100${String(100000 + i).slice(-6)}`;
    const run = remote ? await runRemote(scenario, phoneSim) : await runLocal(scenario, phoneSim);
    const ok = run.status === 200 && run.json.ok === true;
    if (ok) pass += 1;
    results.push({
      file,
      scenario_code: scenario.scenario_code,
      ok,
      status: run.status,
      violations: run.json.violations || [],
      stage: run.json.final?.conversation_snapshot?.conversation_stage,
      crm_ready: run.json.final?.conversation_snapshot?.crm_ready,
    });
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`${mark} ${scenario.scenario_code} (${file})`);
    if (!ok) {
      console.log('  violations', JSON.stringify(run.json.violations));
    }
  }

  const rate = suite.scenarios.length ? pass / suite.scenarios.length : 1;
  const need = suite.threshold?.pass_rate ?? 1.0;
  console.log('\n---');
  console.log(`suite=${suiteName} pass=${pass}/${suite.scenarios.length} rate=${rate.toFixed(3)} need>=${need}`);
  console.log(JSON.stringify({ at: new Date().toISOString(), base: remote ? BASE : 'local', results }, null, 2));
  process.exit(rate >= need ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
