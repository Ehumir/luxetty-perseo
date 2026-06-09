'use strict';

/**
 * Diagnóstico v3 — simula producción cuando index.js hidrata inventario desde Supabase.
 * Inyecta fixtures ARGOS dinámicos desde DB para códigos LUX reales.
 */

require('dotenv').config();

process.env.PERSEO_ARGOS_ENABLED = 'true';
process.env.PERSEO_V3_ENABLED = 'true';
process.env.PERSEO_V3_CRM_EXECUTE = 'false';

const propertyInventoryService = require('../services/propertyInventoryService');
const { supabase } = require('../services/supabaseService');
const fixtures = require('../argos/propertyFixtures');
const { runArgosScenario } = require('../argos/scenarioRunner');
const { clearAllSessionsForTests } = require('../argos/argosSessionStore');
const { classifyEntryPoint } = require('../conversation/leadEntryPointRouter');
const { extractPropertyCode } = require('../conversation/propertyIntentResolver');

const CODE = 'LUX-A0473';
const TITLE = 'Terreno en Privada Renacimiento · 1,680.83 m² con vista a las montañas';
const PRICE = '$17,000,000 MXN';
const URL =
  'https://luxetty.com/propiedad/terreno-en-privada-renacimiento-168083-m-con-vista-a-las-montanas';

const FOLLOW_UPS = [
  'Mariana',
  '¿Cuál es el precio?',
  '¿Dónde está ubicada?',
  '¿Sigue disponible?',
  'Quiero verla el sábado por la mañana',
  '¿Aceptan crédito hipotecario?',
  'Gracias',
];

const ZONE = 'Puerta de Hierro';

const CASES = [
  { id: 'info', hasLux: true, opener: `Hola, me interesa la propiedad ${CODE} de ${ZONE}. ¿Me das más información?` },
  { id: 'visit', hasLux: true, opener: `Hola, me gustaría agendar una visita a la propiedad ${CODE} — ${TITLE} (${PRICE}).` },
  { id: 'reserve', hasLux: true, opener: `Hola, quiero avanzar con la propiedad ${CODE} — ${TITLE} (${PRICE}). ¿Cuál es el siguiente paso?` },
  { id: 'advisor', hasLux: true, opener: `Hola Jorge, vi en luxetty.com que tienes la propiedad ${CODE} en ${ZONE}, Monterrey. ¿Podemos agendar una visita?` },
  { id: 'share', hasLux: true, opener: `Te comparto esta propiedad de Luxetty ${CODE}:\n\n${TITLE}\n${PRICE}` },
  { id: 'share-url', hasLux: true, opener: `Te comparto esta propiedad de Luxetty ${CODE}:\n\n${TITLE}\n${PRICE}\n\n${URL}` },
  { id: 'comparison', hasLux: true, opener: `Hola, me gustaría recibir información comparativa sobre ${CODE} — ${TITLE} y opciones similares.` },
  { id: 'similar-no-lux', hasLux: false, opener: `Hola, me gustaría recibir información sobre ${TITLE} y opciones relacionadas.` },
  { id: 'sold-with-lux', hasLux: true, opener: `Hola, vi la propiedad ${CODE} "${TITLE}" que ya fue vendida. ¿Tienen opciones similares?` },
  { id: 'sold-no-lux', hasLux: false, opener: `Hola, vi la propiedad "${TITLE}" que ya fue vendida. ¿Tienen opciones similares?` },
  { id: 'custom-prefix', hasLux: true, opener: `[Propiedad ${CODE}] Hola, me interesa este terreno. ¿Podemos agendar visita?` },
];

async function ensureFixtureFromDb(code) {
  if (fixtures.PROPERTY_FIXTURES[code]) return true;
  const inv = await propertyInventoryService.findPropertyByCode(supabase, code);
  if (!inv.property) return false;
  const ap = propertyInventoryService.normalizeInventoryProperty(inv.property.raw || inv.property);
  if (!ap?.id) return false;
  fixtures.PROPERTY_FIXTURES[code] = {
    id: ap.id,
    code,
    price: ap.price,
    price_label: ap.price_label,
    public_url: ap.public_url,
    location_label: ap.location_label || ap.neighborhood || ap.city || 'Monterrey',
    is_active: true,
    is_published: true,
  };
  return true;
}

function score(result, c) {
  const issues = [];
  const turns = result.turns || [];
  const snap = result.conversation_snapshot || {};

  if (!result.ok) issues.push('scenario_not_ok');
  for (const v of result.violations || []) issues.push(v.code);

  turns.forEach((turn, idx) => {
    const n = idx + 1;
    const reply = String(turn.reply || '');
    if (!reply || reply.length < 8) issues.push(`empty_reply@${n}`);
    if (/no encuentro.*inventario/i.test(reply)) issues.push(`inventory_miss@${n}`);
    if (/soy un bot|no pude procesar/i.test(reply)) issues.push(`bot_tone@${n}`);
    for (const mv of turn.must_not_violations || []) issues.push(`${mv.constraint}@${n}`);
  });

  if (c.hasLux && snap.property_code !== CODE) issues.push(`lost_property_code:${snap.property_code || 'null'}`);

  if (!c.hasLux) {
    const t1 = turns[0]?.reply || '';
    const t3 = turns[2]?.reply || '';
    if (/buscas comprar|en qué puedo ayudarte|comprar, vender o rentar/i.test(t1)) {
      issues.push('generic_menu_without_lux@1');
    }
    if (t1 && t3 && t1.slice(0, 60) === t3.slice(0, 60)) issues.push('reply_loop@1_3');
    if (!snap.property_code && !snap.interested_property_id) issues.push('never_resolved_property');
  }

  const entry = classifyEntryPoint(c.opener, {}).entry_type;
  if (entry !== 'property_ad') issues.push(`entry_not_property_ad:${entry}`);

  return {
    id: c.id,
    hasLux: c.hasLux,
    entry,
    ok: issues.length === 0,
    issues,
    end: { property_code: snap.property_code, lead_flow: snap.lead_flow, known_name: snap.known_name },
    t1: (turns[0]?.reply || '').slice(0, 120),
    t3: (turns[2]?.reply || '').slice(0, 120),
    t8: (turns[7]?.reply || '').slice(0, 120),
  };
}

async function main() {
  const hydrated = await ensureFixtureFromDb(CODE);
  console.log(`DB fixture for ${CODE}: ${hydrated ? 'ok' : 'missing'}\n`);

  const results = [];
  for (let i = 0; i < CASES.length; i += 1) {
    clearAllSessionsForTests();
    const c = CASES[i];
    const result = await runArgosScenario({
      phone_sim: `521810007${String(i).padStart(4, '0')}`,
      supabaseRaw: supabase,
      scenario: {
        messages: [c.opener, ...FOLLOW_UPS],
        flags: { deterministic_mode: true, crm_dry_run: true, wa_hardening_v2: true },
        setup: {},
        must_not: { invent_property: true, invent_price: true, flow_restart: true },
      },
    });
    const scored = score(result, c);
    results.push(scored);
    process.stdout.write(`${scored.ok ? 'PASS' : 'FAIL'} ${scored.id}\n`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== PRODUCCIÓN SIMULADA (inventario hidratado) ===`);
  console.log(`PASS: ${results.length - failed.length}/${results.length}`);

  if (failed.length) {
    console.log('\n=== NO ATIENDE 8 TURNOS SIN ERROR ===');
    for (const f of failed) {
      console.log(`\n[${f.id}] entry=${f.entry} hasLux=${f.hasLux}`);
      console.log(`Issues: ${f.issues.join(', ')}`);
      console.log(`t1: ${f.t1}`);
      console.log(`t3: ${f.t3}`);
      console.log(`t8: ${f.t8}`);
    }
  }

  console.log('\n=== MATRIZ ===');
  for (const r of results) {
    console.log(`${r.id}\t${r.ok ? 'OK' : 'FAIL'}\t${r.entry}\t${r.issues.join(',') || '-'}`);
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
