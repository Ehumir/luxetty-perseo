'use strict';

/**
 * Ejecuta DEMAND_002_FULL y guarda evidencia JSON.
 * Uso local: node scripts/argos-run-demand002-full.js
 * Railway: PERSEO_BASE_URL=... ARGOS_SERVICE_SECRET=... node scripts/argos-run-demand002-full.js --remote
 */

const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config();

const SCENARIO_PATH = path.join(__dirname, '..', 'docs', 'argos', 'scenarios', 'DEMAND_002_FULL.v1.json');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'argos', 'evidence', 'DEMAND_002_FULL-run.json');
const remote = process.argv.includes('--remote');
const BASE = process.env.PERSEO_BASE_URL || 'http://localhost:3000';
const SECRET = process.env.ARGOS_SERVICE_SECRET || 'argos-local-validation-secret';

async function runRemote(scenario) {
  const res = await fetch(`${BASE}/internal/argos/run-scenario`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Argos-Service-Secret': SECRET,
      'X-Argos-Admin-User-Id': '00000000-0000-0000-0000-000000000001',
    },
    body: JSON.stringify({
      phone_sim: '5218100000998',
      flags: scenario.flags,
      scenario,
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json, base: BASE, at: new Date().toISOString() };
}

async function runLocal(scenario) {
  process.env.PERSEO_ARGOS_ENABLED = 'true';
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_EXECUTE = 'false';
  const { runArgosScenario } = require('../argos/scenarioRunner');
  const json = await runArgosScenario({
    phone_sim: '5218100000998',
    flags: scenario.flags,
    scenario,
  });
  return { status: 200, json, base: 'local', at: new Date().toISOString() };
}

async function main() {
  const scenario = JSON.parse(fs.readFileSync(SCENARIO_PATH, 'utf8'));
  const health =
    remote &&
    (await fetch(`${BASE}/internal/argos/health`, {
      headers: { 'X-Argos-Service-Secret': SECRET },
    }).then(async (r) => ({ status: r.status, json: await r.json() })));

  const result = remote ? await runRemote(scenario) : await runLocal(scenario);
  const payload = { health: health || null, ...result };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2));
  console.log('saved', OUT_PATH);
  console.log('ok', result.json.ok, 'violations', result.json.violations?.length || 0);
  if (result.json.final) {
    console.log('snapshot', JSON.stringify(result.json.final.conversation_snapshot, null, 2));
    console.log(
      'crm',
      JSON.stringify(
        {
          skipped: result.json.final.crm_dry_run?.skipped,
          contact: result.json.final.crm_dry_run?.contact,
          lead: result.json.final.crm_dry_run?.lead,
          crm_gate_blockers: result.json.final.crm_gate_blockers,
          parser_winner: result.json.final.parser_winner,
          state_transition: result.json.final.state_transition,
        },
        null,
        2,
      ),
    );
  }
  process.exit(result.json.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
