#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCENARIOS_DIR = path.join(ROOT, 'docs/argos/scenarios');
const SUITES_DIR = path.join(ROOT, 'docs/argos/suites');

const BASE = {
  deterministic_mode: true,
  crm_dry_run: true,
  media_intake_v1: true,
  policy_engine: true,
  message_planner: true,
  media_real_v1: true,
  resilience_v1: true,
  humanity_wave2: true,
  wa_hardening_v2: true,
  crm_execute_foundation: true,
  crm_runtime_persistent: true,
  wa_telemetry: true,
};

function f(extra = {}) {
  return { ...BASE, ...extra };
}

function write(entry) {
  const doc = {
    schema_version: '1.0',
    scenario_version: 1,
    priority: 'P0',
    scenario_code: entry.scenario_code,
    family: entry.family,
    category: entry.family,
    title: entry.title,
    flags: entry.flags,
    messages: entry.messages,
    expected: entry.expected || {},
    must_not: entry.must_not || { write_leads: true, write_contacts: true },
  };
  fs.writeFileSync(path.join(SCENARIOS_DIR, entry.file), `${JSON.stringify(doc, null, 2)}\n`);
  return entry.file;
}

const catalog = [];

function add(prefix, family, n, builder) {
  for (let i = 1; i <= n; i += 1) {
    const code = `${prefix}_${String(i).padStart(3, '0')}`;
    catalog.push(builder(code, i));
  }
}

// crm-durability-p0 (18)
add('CRMD', 'crm_durability', 18, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'crm_durability',
  title: `CRM durability ${i}`,
  flags: f({ crm_durability: true, crm_worker_async: true, crm_reconciliation: i % 3 === 0 }),
  messages: i % 2 === 0 ? ['Hola', 'Busco en Cumbres'] : ['Hola', 'Quiero vender', 'Ana'],
  expected: {
    crm_runtime_mode: 'memory_argos',
    crm_worker_pending: i % 4 === 0 ? true : undefined,
    crm_worker_process: i % 5 === 0 ? true : undefined,
  },
}));

// crm-concurrency-p0 (12)
add('CRMC', 'crm_concurrency', 12, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'crm_concurrency',
  title: `CRM concurrency ${i}`,
  flags: f({ crm_durability: true, crm_worker_async: true }),
  messages: ['Hola', 'Jorge', 'Cumbres', 'ok'],
  expected: {
    crm_runtime_mode: 'memory_argos',
    crm_worker_process: i <= 6 ? true : undefined,
  },
}));

// runtime-observability-p0 (12)
add('OBS', 'runtime_observability', 12, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'runtime_observability',
  title: `Runtime observability ${i}`,
  flags: f({ runtime_observability: true, resilience_runtime: i % 2 === 0 }),
  messages: i % 3 === 0 ? ['¿Zona? ¿Precio? ¿Cuándo?'] : ['Hola', 'Busco comprar'],
  expected: {
    runtime_observability_recorded: true,
    telemetry_recorded: true,
    resilience_multi_question: i % 3 === 0 ? true : undefined,
  },
}));

// media-hardening-p0 (14)
add('MHD', 'media_hardening', 14, (code, i) => {
  const mediaTurns = [
    { type: 'audio', simulate_transcript: 'Hola', simulate_confidence: 0.9 },
    { type: 'audio', simulate_transcript: 'mmm', simulate_confidence: 0.2 },
    { type: 'image', simulate_hints: ['patio'], malformed: i === 3 },
    { type: 'document', simulate_text: 'contrato' },
    { type: 'audio', corrupt_audio: true, no_transcript: true },
    { type: 'image', simulate_hints: [], byte_size: i === 6 ? 20000000 : 1000 },
    { type: 'image', mime_type: 'application/x-unknown', simulate_hints: ['x'] },
  ];
  const turn = mediaTurns[i % mediaTurns.length];
  return {
    file: `${code}.v1.json`,
    scenario_code: code,
    family: 'media_hardening',
    title: `Media hardening ${i}`,
    flags: f({ media_hardening: true, media_runtime_production: true, media_runtime_fail_open: true }),
    messages: [turn],
    expected: {
      telemetry_recorded: true,
      media_fail_open: turn.corrupt_audio || turn.byte_size > 1000000 ? true : undefined,
    },
    must_not: { write_leads: true, write_contacts: true, invent_price: true },
  };
});

// robustness-p0 (18)
const robustMsgs = [
  ['Hola'],
  ['Hola', 'Perdón', 'Busco en San Pedro'],
  ['Necesito casa urgente estoy desesperado'],
  ['Primero quiero comprar', 'mejor rentar', 'en Cumbres'],
  ['A'.repeat(400)],
  ['¿Cuánto cuesta?', '¿Y la zona?', '¿Tiene estacionamiento?', '¿Cuándo puedo verla?'],
  ['no entiendo nada', 'confundido'],
  ['Hola', 'Jorge', 'Cumbres', '6 millones', 'Sí asesor'],
];
add('ROB', 'robustness', 18, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'robustness',
  title: `Robustness ${i}`,
  flags: f({ resilience_runtime: true, runtime_observability: true, humanity_wave2: true }),
  messages: robustMsgs[i % robustMsgs.length],
  expected: {
    runtime_observability_recorded: true,
    telemetry_recorded: true,
  },
}));

// runtime-safety-p0 (12)
add('SAF', 'runtime_safety', 12, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'runtime_safety',
  title: `Runtime safety ${i}`,
  flags: f({ runtime_safety: true, runtime_observability: true }),
  messages: ['Hola', 'Hola', 'Hola', 'Hola', 'Hola'],
  expected: {
    runtime_observability_recorded: true,
  },
}));

// replay-p0 (12)
add('RPL', 'replay', 12, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'replay',
  title: `Replay pack ${i}`,
  flags: f({ replay_engine: true, runtime_observability: true }),
  messages: ['Hola', 'Busco en Cumbres', 'Jorge'],
  expected: {
    known_name: i % 2 === 0 ? 'Jorge' : undefined,
    runtime_observability_recorded: true,
  },
}));

// replay-regression-p0 (12)
add('RPR', 'replay_regression', 12, (code, i) => ({
  file: `${code}.v1.json`,
  scenario_code: code,
  family: 'replay_regression',
  title: `Replay regression ${i}`,
  flags: f({
    replay_engine: true,
    crm_durability: true,
    media_hardening: true,
    runtime_observability: true,
  }),
  messages:
    i % 2 === 0
      ? [{ type: 'audio', simulate_transcript: 'Quiero rentar', simulate_confidence: 0.88 }]
      : ['Quiero vender', 'Ana', 'Monterrey'],
  expected: {
    crm_runtime_mode: 'memory_argos',
    runtime_observability_recorded: true,
  },
}));

for (const entry of catalog) {
  write(entry);
}

const suites = {
  'crm-durability-p0': catalog.filter((c) => c.family === 'crm_durability').map((c) => c.file),
  'crm-concurrency-p0': catalog.filter((c) => c.family === 'crm_concurrency').map((c) => c.file),
  'runtime-observability-p0': catalog.filter((c) => c.family === 'runtime_observability').map((c) => c.file),
  'media-hardening-p0': catalog.filter((c) => c.family === 'media_hardening').map((c) => c.file),
  'robustness-p0': catalog.filter((c) => c.family === 'robustness').map((c) => c.file),
  'runtime-safety-p0': catalog.filter((c) => c.family === 'runtime_safety').map((c) => c.file),
  'replay-p0': catalog.filter((c) => c.family === 'replay').map((c) => c.file),
  'replay-regression-p0': catalog.filter((c) => c.family === 'replay_regression').map((c) => c.file),
};

for (const [suite, scenarios] of Object.entries(suites)) {
  fs.writeFileSync(
    path.join(SUITES_DIR, `${suite}.json`),
    `${JSON.stringify({ suite, description: `M4-03 — ${suite}`, threshold: { pass_rate: 1 }, scenarios }, null, 2)}\n`,
  );
}

console.log(`Generated ${catalog.length} scenarios in ${Object.keys(suites).length} suites`);
