'use strict';

/**
 * Validación local equivalente a colección Postman ARGOS-1.
 * Uso: node scripts/argos-postman-validation.js
 * Requiere servidor en BASE_URL (default http://localhost:3000).
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.PERSEO_BASE_URL || 'http://localhost:3000';
const SECRET = process.env.ARGOS_SERVICE_SECRET || 'argos-local-validation-secret';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'argos', 'evidence');

function headers(secret = SECRET) {
  return {
    'Content-Type': 'application/json',
    'X-Argos-Service-Secret': secret,
    'X-Argos-Admin-User-Id': '00000000-0000-0000-0000-000000000001',
  };
}

async function req(method, route, body, hdrs = headers()) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: hdrs,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json };
}

function save(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

async function main() {
  const report = { at: new Date().toISOString(), base: BASE, sections: {} };

  console.log('=== 1. GET /internal/argos/health ===');
  const health = await req('GET', '/internal/argos/health');
  report.sections.health = health;
  save('01-health', health);
  console.log('status', health.status, JSON.stringify(health.json, null, 2));

  console.log('\n=== 2. simulate-turn (multi-turn) ===');
  let session_id = null;
  const turnTexts = [
    'Hola',
    'Busco casa en Cumbres',
    'Jorge, tengo 5 millones',
    'Sí, que me contacte un asesor',
  ];
  const turns = [];
  for (const text of turnTexts) {
    const r = await req('POST', '/internal/argos/simulate-turn', {
      session_id,
      phone_sim: '5218100000001',
      text,
      flags: { deterministic_mode: true, crm_dry_run: true },
    });
    session_id = r.json.session_id || session_id;
    turns.push({ text, status: r.status, keys: Object.keys(r.json) });
    if (r.json.error_code) {
      turns.push({ error: r.json });
      break;
    }
  }
  const lastTurn = await req('POST', '/internal/argos/simulate-turn', {
    session_id,
    phone_sim: '5218100000001',
    text: turnTexts[turnTexts.length - 1],
    flags: { deterministic_mode: true, crm_dry_run: true },
  });
  report.sections.simulate_turn = { session_id, turns, last: lastTurn };
  save('02-simulate-turn-last', lastTurn);
  console.log('last turn status', lastTurn.status);
  console.log('reply snippet:', String(lastTurn.json.reply || '').slice(0, 120));
  console.log(
    'whatsapp_blocked in debug_trace:',
    (lastTurn.json.debug_trace || []).some((d) => d.type === 'whatsapp_blocked'),
  );

  console.log('\n=== 3. crm-dry-run ===');
  const crmDry = await req('POST', '/internal/argos/crm-dry-run', {
    session_id,
    phone_sim: '5218100000001',
  });
  report.sections.crm_dry_run = crmDry;
  save('03-crm-dry-run', crmDry);
  console.log('status', crmDry.status);
  if (crmDry.json.crm_dry_run) {
    console.log(JSON.stringify(crmDry.json.crm_dry_run, null, 2));
  }

  console.log('\n=== 4a. run-scenario DEMAND_002 ===');
  const demand002 = await req('POST', '/internal/argos/run-scenario', {
    phone_sim: '5218100000999',
    flags: { deterministic_mode: true, crm_dry_run: true },
    scenario: {
      scenario_code: 'DEMAND_002',
      messages: [
        'Hola',
        'Busco casa en Cumbres',
        'Tengo presupuesto de 5 millones',
        'Jorge',
        'Sí, que me contacte un asesor',
      ],
      expected: {
        intent: 'buy',
        lead_type: 'demand',
        should_create_contact: true,
        should_create_lead: true,
      },
      must_not: {
        invent_property: true,
        send_whatsapp: true,
        write_contacts: true,
        write_leads: true,
        use_requests_table: true,
      },
    },
  });
  report.sections.run_scenario_demand002 = demand002;
  save('04-demand002', demand002);
  console.log('status', demand002.status, 'ok=', demand002.json.ok);

  console.log('\n=== 4b. run-scenario PROP_003 must_not ===');
  const prop003 = await req('POST', '/internal/argos/run-scenario', {
    phone_sim: '5218100000888',
    flags: { deterministic_mode: true },
    scenario: {
      scenario_code: 'PROP_003',
      messages: ['Me interesa LUX-INVALID-999', '¿Cuánto cuesta?'],
      must_not: { invent_property: true, invent_price: true, invent_link: true },
    },
  });
  report.sections.run_scenario_prop003 = prop003;
  save('04-prop003-must-not', prop003);
  console.log('status', prop003.status, 'violations', prop003.json.violations?.length);

  console.log('\n=== 4c. run-scenario LOOP (CHAOS) ===');
  const loopScenario = await req('POST', '/internal/argos/run-scenario', {
    phone_sim: '5218100000777',
    flags: { crm_dry_run: false },
    scenario: {
      scenario_code: 'CHAOS_001',
      messages: Array(12).fill('hola'),
      must_not: { send_whatsapp: true },
    },
  });
  report.sections.run_scenario_loop = loopScenario;
  save('04-chaos-loop', loopScenario);
  console.log('status', loopScenario.status, 'error_code', loopScenario.json.error_code);

  console.log('\n=== 5a. secret inválido → 401 ===');
  const badSecret = await req('GET', '/internal/argos/health', null, headers('wrong-secret'));
  report.sections.security_401 = badSecret;
  console.log('status', badSecret.status, badSecret.json.error_code);

  console.log('\n=== 5b. ARGOS disabled → 403 (separate process note) ===');
  report.sections.security_403_note =
    'Ejecutar servidor con PERSEO_ARGOS_ENABLED=false; este script asume servidor con ARGOS=true.';

  console.log('\n=== 5c. ARGOS_SIDE_EFFECT_BLOCKED (unit via import) ===');
  const { createArgosNoWriteSupabase } = require('../argos/argosNoWriteSupabase');
  let blocked = null;
  try {
    const mock = {
      from() {
        return {
          insert() {
            throw new Error('should not reach');
          },
        };
      },
    };
    const wrapped = createArgosNoWriteSupabase(mock);
    wrapped.from('contacts').insert({ phone: '1' });
  } catch (e) {
    blocked = { code: e.code, message: e.message };
  }
  report.sections.security_side_effect = blocked;
  console.log(blocked);

  save('00-report-summary', report);
  console.log('\nEvidence saved under', OUT_DIR);
}

main().catch((err) => {
  console.error('VALIDATION_FAILED', err);
  process.exit(1);
});
