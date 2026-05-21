#!/usr/bin/env node
'use strict';

/**
 * Genera docs/argos/PERSEO_V1_PRODUCTION_READINESS_REPORT.md
 *
 *   node scripts/perseo-v1-production-readiness.js
 *   node scripts/perseo-v1-production-readiness.js --phase f1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'docs/argos/PERSEO_V1_PRODUCTION_READINESS_REPORT.md');

const SUITES = [
  'perseo-v1-essential-p0',
  'release-p0',
  'closure-integrity-p0',
  'closure-terminal-ack-p0',
];

const PHASE = (() => {
  const i = process.argv.indexOf('--phase');
  return i >= 0 ? String(process.argv[i + 1] || 'f1') : 'f1';
})();

function run(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, encoding: 'utf8', env: process.env }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') + (e.message || '') };
  }
}

function parseSuitePass(out, suite) {
  const m = out.match(new RegExp(`suite=${suite} pass=(\\d+)\\/(\\d+)`));
  if (!m) return { pass: 0, total: 0, rate: 0, ok: false };
  const pass = Number(m[1]);
  const total = Number(m[2]);
  return { pass, total, rate: total ? pass / total : 0, ok: pass === total };
}

function collectFlags() {
  const keys = [
    'PERSEO_V3_ENABLED',
    'PERSEO_V3_SHADOW_MODE',
    'PERSEO_V3_HANDOFF_ENABLED',
    'PERSEO_V3_CRM_DRY_RUN',
    'PERSEO_V3_CRM_EXECUTE',
    'PERSEO_V3_QA_ALLOWLIST',
    'PERSEO_CONVERSATIONAL_FLEX_ENABLED',
    'PERSEO_CRM_WORKER_ASYNC_ENABLED',
    'PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED',
    'PERSEO_POLICY_V2_ENABLED',
  ];
  const flags = {};
  for (const k of keys) {
    flags[k] = process.env[k] != null ? String(process.env[k]) : '(unset)';
  }
  return flags;
}

function main() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
  } catch {
    /* */
  }

  const ts = new Date().toISOString();
  const suiteResults = {};
  let allSuitesOk = true;

  for (const suite of SUITES) {
    const r = run(`node scripts/argos-run-suite.js --suite ${suite}`);
    const parsed = parseSuitePass(r.out, suite);
    suiteResults[suite] = { ...parsed, raw: r.out.slice(-4000) };
    if (!parsed.ok) allSuitesOk = false;
  }

  const perseoTest = run('npm run test:perseo');
  const perseoPass = /pass (\d+)/.exec(perseoTest.out);
  const perseoFail = /fail (\d+)/.exec(perseoTest.out);
  const perseoOk = perseoTest.ok && Number(perseoFail?.[1] || 0) === 0;

  const savedArgv = process.argv.slice();
  process.argv = [process.argv[0], __filename, '--phase', PHASE];
  const { main: preflightMain } = require('./perseo-v1-preflight');
  const preflight = preflightMain();
  process.argv = savedArgv;

  const flags = collectFlags();
  const blockers = [
    ...preflight.blockers.map((b) => `[preflight] ${b.code}: ${b.message}`),
  ];
  if (!allSuitesOk) {
    for (const [name, r] of Object.entries(suiteResults)) {
      if (!r.ok) blockers.push(`[argos] ${name}: ${r.pass}/${r.total}`);
    }
  }
  if (!perseoOk) blockers.push('[test] npm run test:perseo failed');

  const codeReady =
    suiteResults['perseo-v1-essential-p0']?.ok &&
    suiteResults['release-p0']?.ok &&
    suiteResults['closure-integrity-p0']?.ok &&
    suiteResults['closure-terminal-ack-p0']?.ok &&
    perseoOk;

  const envReady = preflight.verdict !== 'BLOCKER';
  const phase1Ready = codeReady && envReady && String(flags.PERSEO_V3_CRM_EXECUTE).toLowerCase() !== 'true';

  const goNoGo = phase1Ready
    ? 'GO Fase 1 prod'
    : codeReady
      ? 'GO código — corregir env Railway (ver blockers preflight)'
      : 'NO-GO código';

  const md = `# PERSEO V1 — Production Readiness Report

**Generado:** ${ts}  
**Phase preflight:** ${PHASE}  
**Decisión:** **${goNoGo}**

---

## 1. Resumen ejecutivo

| Área | Estado |
|------|--------|
| ARGOS perseo-v1-essential-p0 | ${suiteResults['perseo-v1-essential-p0'].pass}/${suiteResults['perseo-v1-essential-p0'].total} |
| ARGOS release-p0 | ${suiteResults['release-p0'].pass}/${suiteResults['release-p0'].total} |
| ARGOS closure-integrity-p0 | ${suiteResults['closure-integrity-p0'].pass}/${suiteResults['closure-integrity-p0'].total} |
| ARGOS closure-terminal-ack-p0 | ${suiteResults['closure-terminal-ack-p0'].pass}/${suiteResults['closure-terminal-ack-p0'].total} |
| test:perseo | ${perseoOk ? 'PASS' : 'FAIL'} (${perseoPass?.[1] || '?'} tests) |
| Preflight | **${preflight.verdict}** |

---

## 2. Flags (entorno local al generar)

\`\`\`json
${JSON.stringify(flags, null, 2)}
\`\`\`

---

## 3. Preflight

| Veredicto | ${preflight.verdict} |
|-----------|--------|
| GO | ${preflight.gos.length} |
| WARNING | ${preflight.warnings.length} |
| BLOCKER | ${preflight.blockers.length} |

### Blockers preflight

${preflight.blockers.length ? preflight.blockers.map((b) => `- **${b.code}**: ${b.message}`).join('\n') : '_ninguno_'}

### Warnings preflight

${preflight.warnings.length ? preflight.warnings.map((w) => `- **${w.code}**: ${w.message}`).join('\n') : '_ninguno_'}

---

## 4. ARGOS suites

${SUITES.map((s) => {
  const r = suiteResults[s];
  return `### ${s}\n- **Resultado:** ${r.ok ? 'PASS' : 'FAIL'} (${r.pass}/${r.total})\n`;
}).join('\n')}

---

## 5. Blockers producción

${blockers.length ? blockers.map((b) => `- ${b}`).join('\n') : '_Ninguno en código/tests. Validar Railway prod env (WhatsApp IDs, worker OFF)._'}

---

## 6. Qué activar Fase 1 prod

\`\`\`env
PERSEO_V3_ENABLED=true
PERSEO_V3_HANDOFF_ENABLED=true
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_CRM_DRY_RUN=true
PERSEO_V3_CRM_EXECUTE=false
PERSEO_CONVERSATIONAL_FLEX_ENABLED=false
PERSEO_CRM_WORKER_ASYNC_ENABLED=false
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=false
PERSEO_V3_QA_ALLOWLIST=<telefonos_internos>
\`\`\`

## 7. Qué NO activar todavía

- \`PERSEO_V3_CRM_EXECUTE=true\` (solo Fase 3 pauta)
- \`PERSEO_CONVERSATIONAL_FLEX_ENABLED=true\`
- Worker async / runtime persistent
- PRE-engine M4-05b

---

## 8. Criterios GO Fase 1

| Criterio | OK |
|----------|-----|
| perseo-v1-essential-p0 20/20 | ${suiteResults['perseo-v1-essential-p0'].ok ? '✅' : '❌'} |
| release-p0 | ${suiteResults['release-p0'].ok ? '✅' : '❌'} |
| closure suites | ${suiteResults['closure-integrity-p0'].ok && suiteResults['closure-terminal-ack-p0'].ok ? '✅' : '❌'} |
| test:perseo | ${perseoOk ? '✅' : '❌'} |
| preflight sin BLOCKER (Railway) | ${preflight.verdict !== 'BLOCKER' ? '✅ local' : '❌'} |
| CRM_EXECUTE OFF | ${String(flags.PERSEO_V3_CRM_EXECUTE).toLowerCase() !== 'true' ? '✅' : '❌'} |

---

## 9. Regenerar

\`\`\`bash
node scripts/perseo-v1-production-readiness.js --phase f1
node scripts/perseo-v1-preflight.js --phase f1 --phone <tel>
\`\`\`

---

_Auto-generated PERSEO V1 readiness — no M4-05b scope._
`;

  fs.writeFileSync(REPORT_PATH, md, 'utf8');
  console.log(`Wrote ${REPORT_PATH}`);
  console.log(`Decision: ${goNoGo}`);
  process.exitCode = goNoGo.startsWith('GO') ? 0 : 1;
}

main();
