#!/usr/bin/env node
'use strict';

/**
 * PERSEO V1 — preflight prod/staging flags + gate + webhook env.
 *
 *   node scripts/perseo-v1-preflight.js
 *   node scripts/perseo-v1-preflight.js --phase f0|f1|f3
 *   node scripts/perseo-v1-preflight.js --phone 5218119086196
 *   node scripts/perseo-v1-preflight.js --json
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  /* optional */
}

const {
  evaluateV3PrimaryGate: gateFn,
  getPerseoV3Config: v3Cfg,
} = require('../config/perseoV3Flags');

/** @type {{ level: 'GO'|'WARNING'|'BLOCKER', code: string, message: string }[]} */
const findings = [];

const PHASE = (() => {
  const i = process.argv.indexOf('--phase');
  return i >= 0 ? String(process.argv[i + 1] || 'check').toLowerCase() : 'check';
})();

const PHONE = (() => {
  const i = process.argv.indexOf('--phone');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : null;
})();

const JSON_OUT = process.argv.includes('--json');

function env(name) {
  return process.env[name];
}

function isTrue(name) {
  return String(env(name) || '').toLowerCase() === 'true';
}

function add(level, code, message) {
  findings.push({ level, code, message });
}

function expectFlag(name, expected, levelIfWrong = 'BLOCKER') {
  const raw = env(name);
  const actual = isTrue(name);
  if (expected === true && !actual) {
    add(levelIfWrong, `FLAG_${name}`, `${name} debe ser true (actual: ${raw || '(unset)'})`);
  } else if (expected === false && actual) {
    add(levelIfWrong, `FLAG_${name}`, `${name} debe ser false/OFF (actual: ${raw})`);
  } else {
    add('GO', `FLAG_${name}`, `${name}=${raw || 'false/unset'} OK`);
  }
}

function envPresent(keys, label) {
  for (const key of keys) {
    const v = String(env(key) || '').trim();
    if (!v) {
      add('BLOCKER', `ENV_${key}`, `${label}: ${key} vacío`);
    } else {
      add('GO', `ENV_${key}`, `${key} presente`);
    }
  }
}

function checkWebhookEnv() {
  envPresent(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], 'Supabase');
  envPresent(['WHATSAPP_TOKEN'], 'WhatsApp');
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID') || env('PHONE_NUMBER_ID');
  if (!String(phoneId || '').trim()) {
    add('BLOCKER', 'ENV_PHONE_NUMBER_ID', 'WHATSAPP_PHONE_NUMBER_ID o PHONE_NUMBER_ID vacío');
  } else {
    add('GO', 'ENV_PHONE_NUMBER_ID', 'Phone number ID presente');
  }
  const verify = env('WHATSAPP_VERIFY_TOKEN') || env('VERIFY_TOKEN');
  if (!String(verify || '').trim()) {
    add('BLOCKER', 'ENV_VERIFY_TOKEN', 'WHATSAPP_VERIFY_TOKEN o VERIFY_TOKEN vacío');
  } else {
    add('GO', 'ENV_VERIFY_TOKEN', 'Verify token presente');
  }
}

function checkV1Frozen() {
  expectFlag('PERSEO_CONVERSATIONAL_FLEX_ENABLED', false);
  if (isTrue('PERSEO_CONVERSATIONAL_FLEX_PRE_ENGINE')) {
    add('BLOCKER', 'V2_PRE', 'PRE-engine congelado en V1');
  } else {
    add('GO', 'FLEX_PRE', 'PRE-engine OFF');
  }
}

function checkWorkerOff() {
  for (const f of [
    'PERSEO_CRM_WORKER_ASYNC_ENABLED',
    'PERSEO_CRM_WORKER_PROCESS_ENABLED',
    'PERSEO_CRM_WORKER_ENABLED',
  ]) {
    if (isTrue(f)) {
      add('BLOCKER', `WORKER_${f}`, `${f}=true — prod V1 Opción A OFF`);
    } else {
      add('GO', `WORKER_${f}`, `${f} OFF`);
    }
  }
  expectFlag('PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED', false);
}

function checkPolicyV2() {
  expectFlag('PERSEO_POLICY_V2_ENABLED', true, 'WARNING');
}

function checkShadowOff() {
  expectFlag('PERSEO_V3_SHADOW_MODE', false);
}

function checkCrmCoherence(phase) {
  if (phase === 'f0') {
    expectFlag('PERSEO_V3_CRM_EXECUTE', false);
    return;
  }
  if (phase === 'f1') {
    expectFlag('PERSEO_V3_CRM_EXECUTE', false);
    if (String(env('PERSEO_V3_CRM_DRY_RUN') || '').toLowerCase() === 'false') {
      add('WARNING', 'CRM_DRY', 'Fase 1: recomendado PERSEO_V3_CRM_DRY_RUN=true');
    } else {
      add('GO', 'CRM_DRY', 'CRM dry-run ON (Fase 1)');
    }
    return;
  }
  if (phase === 'f3') {
    expectFlag('PERSEO_V3_CRM_EXECUTE', true);
    add('GO', 'CRM_EXECUTE', 'Fase 3: CRM_EXECUTE ON — solo allowlist pauta');
  }
}

function checkAllowlist(phase) {
  const cfg = v3Cfg();
  const n = cfg.qaAllowlist.length;
  if (phase === 'f0') return;
  if (!isTrue('PERSEO_V3_ENABLED')) {
    add('BLOCKER', 'V3_OFF', 'PERSEO_V3_ENABLED debe ser true');
    return;
  }
  if (n === 0) {
    add('BLOCKER', 'ALLOWLIST_EMPTY', 'PERSEO_V3_QA_ALLOWLIST vacía');
    return;
  }
  if (n > 15) {
    add('WARNING', 'ALLOWLIST_WIDE', `${n} entradas — V1 pauta debe ser lista corta`);
  } else {
    add('GO', 'ALLOWLIST', `${n} teléfono(s) en allowlist`);
  }
  for (const entry of cfg.qaAllowlist) {
    if (/\s/.test(entry)) {
      add('BLOCKER', 'ALLOWLIST_SPACE', `Entrada con espacio: "${entry}"`);
    }
  }
}

function checkV3Gate() {
  if (!PHONE) {
    add('WARNING', 'GATE_SKIP', 'Use --phone para validar v3_primary_gate');
    return;
  }
  const gate = gateFn({ phone: PHONE });
  if (!isTrue('PERSEO_V3_ENABLED')) {
    add('GO', 'GATE', `V3 OFF → ${gate.v3_primary_block_reason || 'legacy'}`);
    return;
  }
  if (gate.v3_primary_allowed) {
    add('GO', 'GATE', `v3_primary_allowed tel=${PHONE}`);
  } else {
    add('BLOCKER', 'GATE', `blocked: ${gate.v3_primary_block_reason}`);
  }
}

function applyPhase(phase) {
  if (phase === 'f0') {
    expectFlag('PERSEO_V3_ENABLED', false);
    return;
  }
  expectFlag('PERSEO_V3_ENABLED', true);
  expectFlag('PERSEO_V3_HANDOFF_ENABLED', true);
  checkCrmCoherence(phase);
  checkAllowlist(phase);
}

function summary() {
  const blockers = findings.filter((f) => f.level === 'BLOCKER');
  const warnings = findings.filter((f) => f.level === 'WARNING');
  const gos = findings.filter((f) => f.level === 'GO');
  let verdict = 'GO';
  if (blockers.length) verdict = 'BLOCKER';
  else if (warnings.length) verdict = 'WARNING';
  return { verdict, blockers, warnings, gos, findings };
}

function main() {
  findings.length = 0;
  const phase = ['f0', 'f1', 'f3', 'check'].includes(PHASE) ? PHASE : 'check';

  checkWebhookEnv();
  checkV1Frozen();
  checkWorkerOff();
  checkPolicyV2();
  checkShadowOff();

  if (phase === 'check') {
    applyPhase(isTrue('PERSEO_V3_ENABLED') ? 'f1' : 'f0');
  } else {
    applyPhase(phase);
  }

  checkV3Gate();
  const s = summary();

  if (JSON_OUT) {
    console.log(JSON.stringify({ phase, phone: PHONE, ...s }, null, 2));
  } else {
    console.log('\n=== PERSEO V1 Preflight ===');
    console.log(`phase=${phase} phone=${PHONE || '(none)'}\n`);
    for (const f of findings) {
      console.log(`${f.level.padEnd(7)} [${f.code}] ${f.message}`);
    }
    console.log(`\n--- ${s.verdict} ---`);
    console.log(`GO=${s.gos.length} WARNING=${s.warnings.length} BLOCKER=${s.blockers.length}`);
  }

  process.exitCode = s.blockers.length ? 1 : 0;
  return s;
}

if (require.main === module) {
  main();
}

module.exports = { main, findings };
