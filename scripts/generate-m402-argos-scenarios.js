#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCENARIOS_DIR = path.join(ROOT, 'docs/argos/scenarios');
const SUITES_DIR = path.join(ROOT, 'docs/argos/suites');

const M3_BASE = {
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
};

function flags(overrides = {}) {
  return { ...M3_BASE, ...overrides };
}

function writeScenario(entry) {
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
}

const CATALOG = [
  {
    file: 'CRMW_001.v1.json',
    scenario_code: 'CRMW_001',
    family: 'crm_worker',
    title: 'Async enqueue sin worker — pending',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola', 'Busco en Cumbres'],
    expected: { crm_worker_pending: true, crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_002.v1.json',
    scenario_code: 'CRMW_002',
    family: 'crm_worker',
    title: 'Worker procesa job dry-run',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola', 'Busco comprar en Cumbres', 'Jorge', '6 millones', 'Sí asesor'],
    expected: { crm_worker_process: true, crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_003.v1.json',
    scenario_code: 'CRMW_003',
    family: 'crm_worker',
    title: 'Idempotency tras worker',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola', 'Jorge', 'Cumbres', 'ok'],
    expected: { crm_worker_process: true, crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_004.v1.json',
    scenario_code: 'CRMW_004',
    title: 'Runtime skip sin CRM ready',
    family: 'crm_worker',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola'],
    expected: { crm_ready: false, crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_005.v1.json',
    scenario_code: 'CRMW_005',
    family: 'crm_worker',
    title: 'Collision no duplica enqueue',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola', 'Hola'],
    expected: { crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_006.v1.json',
    scenario_code: 'CRMW_006',
    family: 'crm_worker',
    title: 'Telemetry tras worker',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true, wa_telemetry: true }),
    messages: ['Hola', 'Busco rentar'],
    expected: { crm_worker_process: true, telemetry_recorded: true, telemetry_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_007.v1.json',
    scenario_code: 'CRMW_007',
    family: 'crm_worker',
    title: 'Sync path cuando async OFF',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: false }),
    messages: ['Hola', 'Busco en San Pedro'],
    expected: { crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'CRMW_008.v1.json',
    scenario_code: 'CRMW_008',
    family: 'crm_worker',
    title: 'must_not writes ARGOS worker',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola', 'Quiero vender', 'Ana', 'Monterrey', 'Sí'],
    expected: { crm_worker_process: true },
    must_not: { write_leads: true, write_contacts: true },
  },
  {
    file: 'WHM_001.v1.json',
    scenario_code: 'WHM_001',
    family: 'webhook_media',
    title: 'Audio deterministic transcript',
    flags: flags({ media_runtime_production: true }),
    messages: [
      { type: 'audio', simulate_transcript: 'Busco casa en Cumbres', simulate_confidence: 0.9 },
    ],
    expected: { logical_turn_source: 'audio_transcript' },
  },
  {
    file: 'WHM_002.v1.json',
    scenario_code: 'WHM_002',
    family: 'webhook_media',
    title: 'Audio low confidence',
    flags: flags({ media_runtime_production: true }),
    messages: [{ type: 'audio', simulate_transcript: 'mmm', simulate_confidence: 0.3 }],
    expected: { media_intake_mode: 'audio_low_confidence' },
  },
  {
    file: 'WHM_003.v1.json',
    scenario_code: 'WHM_003',
    family: 'webhook_media',
    title: 'Imagen con caption',
    flags: flags({ media_runtime_production: true }),
    messages: [
      {
        type: 'image',
        caption: 'Esta es la fachada',
        simulate_hints: ['fachada visible'],
      },
    ],
    expected: { media_intake_mode: 'image_with_text' },
  },
  {
    file: 'WHM_004.v1.json',
    scenario_code: 'WHM_004',
    family: 'webhook_media',
    title: 'Imagen illegible',
    flags: flags({ media_runtime_production: true }),
    messages: [{ type: 'image', simulate_hints: [] }],
    expected: { media_intake_mode: 'image_hints_only' },
  },
  {
    file: 'WHM_005.v1.json',
    scenario_code: 'WHM_005',
    family: 'webhook_media',
    title: 'PDF texto simulado',
    flags: flags({ media_runtime_production: true }),
    messages: [{ type: 'document', simulate_text: 'Contrato arrendamiento zona Cumbres' }],
    expected: { logical_turn_source: 'document_text' },
  },
  {
    file: 'WHM_006.v1.json',
    scenario_code: 'WHM_006',
    family: 'webhook_media',
    title: 'Fail-open timeout path',
    flags: flags({ media_runtime_production: true, media_runtime_fail_open: true }),
    messages: [
      {
        type: 'audio',
        no_transcript: true,
        media_timeout: true,
        fallback_reason: 'media_timeout',
        fail_open_applied: true,
      },
    ],
    expected: { media_fallback_reason: 'media_timeout', media_fail_open: true },
  },
  {
    file: 'WHM_007.v1.json',
    scenario_code: 'WHM_007',
    family: 'webhook_media',
    title: 'must_not invent price from image',
    flags: flags({ media_runtime_production: true }),
    messages: [{ type: 'image', simulate_hints: ['sala amplia'] }],
    must_not: { invent_price: true, invent_listing: true },
    expected: { media_intake_mode: 'image_hints_only' },
  },
  {
    file: 'WHM_008.v1.json',
    scenario_code: 'WHM_008',
    family: 'webhook_media',
    title: 'Flags OFF texto only',
    flags: flags({ media_runtime_production: false }),
    messages: ['Hola busco casa'],
    expected: { crm_ready: false },
  },
  {
    file: 'TELR_001.v1.json',
    scenario_code: 'TELR_001',
    family: 'wa_telemetry_runtime',
    title: 'Telemetry memory argos',
    flags: flags({ wa_telemetry: true }),
    messages: ['Hola'],
    expected: { telemetry_recorded: true, telemetry_mode: 'memory_argos' },
  },
  {
    file: 'TELR_002.v1.json',
    scenario_code: 'TELR_002',
    family: 'wa_telemetry_runtime',
    title: 'Policy hit captured',
    flags: flags({ wa_telemetry: true, policy_runtime: true }),
    messages: ['Busco en zona prohibida test'],
    expected: { telemetry_recorded: true },
  },
  {
    file: 'TELR_003.v1.json',
    scenario_code: 'TELR_003',
    family: 'wa_telemetry_runtime',
    title: 'Media processed telemetry',
    flags: flags({ wa_telemetry: true, media_runtime_production: true }),
    messages: [{ type: 'audio', simulate_transcript: 'Hola', simulate_confidence: 0.9 }],
    expected: { telemetry_recorded: true },
  },
  {
    file: 'TELR_004.v1.json',
    scenario_code: 'TELR_004',
    family: 'wa_telemetry_runtime',
    title: 'CRM worker telemetry hook',
    flags: flags({ wa_telemetry: true, crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola'],
    expected: { telemetry_recorded: true, crm_worker_pending: true },
  },
  {
    file: 'TELR_005.v1.json',
    scenario_code: 'TELR_005',
    family: 'wa_telemetry_runtime',
    title: 'Fallback reason',
    flags: flags({ wa_telemetry: true, media_runtime_fail_open: true }),
    messages: [{ type: 'audio', no_transcript: true, fallback_reason: 'no_transcript' }],
    expected: { telemetry_recorded: true },
  },
  {
    file: 'TELR_006.v1.json',
    scenario_code: 'TELR_006',
    family: 'wa_telemetry_runtime',
    title: 'Telemetry OFF',
    flags: flags({ wa_telemetry: false }),
    messages: ['Hola'],
    expected: { telemetry_recorded: false },
  },
  {
    file: 'ROL_001.v1.json',
    scenario_code: 'ROL_001',
    family: 'rollout_flags',
    title: 'All M4 flags OFF path',
    flags: flags({
      crm_runtime_persistent: false,
      media_runtime_production: false,
      wa_telemetry: false,
      crm_worker_async: false,
    }),
    messages: ['Hola'],
    expected: { crm_runtime_mode: null },
  },
  {
    file: 'ROL_002.v1.json',
    scenario_code: 'ROL_002',
    family: 'rollout_flags',
    title: 'CRM runtime ON memory argos',
    flags: flags({ crm_runtime_persistent: true }),
    messages: ['Hola'],
    expected: { crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'ROL_003.v1.json',
    scenario_code: 'ROL_003',
    family: 'rollout_flags',
    title: 'Media production flag stack',
    flags: flags({ media_runtime_production: true, media_runtime_fail_open: true }),
    messages: [{ type: 'image', simulate_hints: ['patio'] }],
    expected: { media_intake_mode: 'image_hints_only' },
  },
  {
    file: 'ROL_004.v1.json',
    scenario_code: 'ROL_004',
    family: 'rollout_flags',
    title: 'Async worker flag ON',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Hola'],
    expected: { crm_worker_pending: true },
  },
  {
    file: 'WRS_001.v1.json',
    scenario_code: 'WRS_001',
    family: 'wa_real_smoke',
    title: 'Humanity baseline demand',
    flags: flags({ wa_telemetry: true, humanity_wave2: true }),
    messages: ['Hola', 'Busco comprar en Cumbres', 'Jorge'],
    expected: { known_name: 'Jorge' },
  },
  {
    file: 'WRS_002.v1.json',
    scenario_code: 'WRS_002',
    family: 'wa_real_smoke',
    title: 'Multi-question resilience',
    flags: flags({ resilience_runtime: true }),
    messages: ['¿Zona? ¿Precio? ¿Cuándo?'],
    expected: { resilience_multi_question: true },
  },
  {
    file: 'WRS_003.v1.json',
    scenario_code: 'WRS_003',
    family: 'wa_real_smoke',
    title: 'Interruption recovery',
    flags: flags({ resilience_v1: true }),
    messages: ['Hola', 'Perdón', 'Busco en San Pedro'],
    expected: { known_zone: 'San Pedro' },
  },
  {
    file: 'WRS_004.v1.json',
    scenario_code: 'WRS_004',
    family: 'wa_real_smoke',
    title: 'Media audio smoke',
    flags: flags({ media_runtime_production: true }),
    messages: [{ type: 'audio', simulate_transcript: 'Quiero rentar', simulate_confidence: 0.88 }],
    expected: { logical_turn_source: 'audio_transcript' },
  },
  {
    file: 'WRS_005.v1.json',
    scenario_code: 'WRS_005',
    family: 'wa_real_smoke',
    title: 'CRM path smoke dry-run',
    flags: flags({ crm_runtime_persistent: true, crm_worker_async: true }),
    messages: ['Quiero vender', 'Ana', 'Monterrey', 'Sí'],
    expected: { crm_runtime_mode: 'memory_argos' },
  },
  {
    file: 'WRS_006.v1.json',
    scenario_code: 'WRS_006',
    family: 'wa_real_smoke',
    title: 'No invent price',
    flags: flags({ media_runtime_production: true }),
    messages: [{ type: 'image', simulate_hints: ['cocina'] }],
    must_not: { invent_price: true },
    expected: { media_intake_mode: 'image_hints_only' },
  },
];

const SUITES = {
  'crm-worker-p0': [
    'CRMW_001.v1.json',
    'CRMW_002.v1.json',
    'CRMW_003.v1.json',
    'CRMW_004.v1.json',
    'CRMW_005.v1.json',
    'CRMW_006.v1.json',
    'CRMW_007.v1.json',
    'CRMW_008.v1.json',
  ],
  'webhook-media-p0': [
    'WHM_001.v1.json',
    'WHM_002.v1.json',
    'WHM_003.v1.json',
    'WHM_004.v1.json',
    'WHM_005.v1.json',
    'WHM_006.v1.json',
    'WHM_007.v1.json',
    'WHM_008.v1.json',
  ],
  'wa-telemetry-runtime-p0': [
    'TELR_001.v1.json',
    'TELR_002.v1.json',
    'TELR_003.v1.json',
    'TELR_004.v1.json',
    'TELR_005.v1.json',
    'TELR_006.v1.json',
  ],
  'rollout-flags-p0': ['ROL_001.v1.json', 'ROL_002.v1.json', 'ROL_003.v1.json', 'ROL_004.v1.json'],
  'wa-real-smoke-p0': [
    'WRS_001.v1.json',
    'WRS_002.v1.json',
    'WRS_003.v1.json',
    'WRS_004.v1.json',
    'WRS_005.v1.json',
    'WRS_006.v1.json',
  ],
};

for (const entry of CATALOG) {
  writeScenario(entry);
}

for (const [suite, scenarios] of Object.entries(SUITES)) {
  const doc = {
    suite,
    description: `M4-02 — ${suite}`,
    threshold: { pass_rate: 1 },
    scenarios,
  };
  fs.writeFileSync(path.join(SUITES_DIR, `${suite}.json`), `${JSON.stringify(doc, null, 2)}\n`);
}

console.log(`Wrote ${CATALOG.length} scenarios and ${Object.keys(SUITES).length} suites`);
