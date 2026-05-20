# M4-05a — Conversational Flex Quick Wins

## Objetivo

Reducir la rigidez conversacional de PERSEO en WhatsApp cuando el usuario escribe como habla en México: slang de dinero, typos de colonia, respuestas cortas de consentimiento y frases de ocupación con negación. Hoy un `cumpres`, `10 melones` o `simon jalo` rompe o alarga el flujo; M4-05a corrige eso **sin cambiar** closure, CRM, gate ni producción.

**Problema humano:** el bot se siente formulario + regex; el usuario abandona o repite.

---

## Alcance

| Quick win | Módulo | Hook |
|-----------|--------|------|
| **Slang dinero MX** | `conversation/flexibility/slangLexicon.js` | `moneyParser.js` |
| **Fuzzy zones** | `conversation/flexibility/typoTolerance.js` | `locationNormalizer.js` |
| **Short consent MX** | `conversation/flexibility/shortReplyLexicon.js` | `consentParser.js`, `minimalInterpreter.js` |
| **Occupancy negation** | (lógica en flex path) | `occupancyParser.js` |
| **Flag + telemetría** | `config/perseoM405Flags.js`, `flexTelemetry.js` | env + opt-in logs |

**Suite ARGOS:** `conversation-flexibility-p0` — 20 escenarios `FLEX_001`–`FLEX_020`.

---

## Qué NO toca

- `closureIntegrity.js` / `conversationReopenPolicy.js`
- `crmExecutor` / worker / persistencia CRM
- `v3InboundBridge` gate / assignment
- **Producción** — flag OFF por defecto; activación solo QA/staging explícita

---

## Feature flag

```env
PERSEO_CONVERSATIONAL_FLEX_ENABLED=true
```

**Default:** `false` (unset = OFF).

- **OFF:** parsers y comportamiento idénticos al baseline (NO-OP verificado).
- **ON:** hooks flex en parsers listados arriba.
- **ARGOS FLEX:** `flags.conversational_flex: true` en escenarios FLEX.

Documentado en `.env.example`.

---

## Suites ejecutadas

| Suite | Resultado |
|-------|-----------|
| `conversation-flexibility-p0` | **20/20 PASS** |
| `closure-integrity-p0` | **8/8 PASS** |
| `closure-terminal-ack-p0` | **6/6 PASS** |
| `npm run test:perseo` | **103/103 PASS** |
| `test/conversationFlexibilityQuickWins.test.js` | **6/6 PASS** |
| `test/argosConversationFlexibilitySuite.test.js` | **1/1 PASS** |

Regenerar local:

```bash
node scripts/argos-run-suite.js --suite conversation-flexibility-p0
node scripts/argos-run-suite.js --suite closure-integrity-p0
node scripts/argos-run-suite.js --suite closure-terminal-ack-p0
npm run test:perseo
node scripts/m405a-noop-verify.js --write-docs
```

---

## NO-OP verification

Evidencia explícita con `PERSEO_CONVERSATIONAL_FLEX_ENABLED=false`:

- Mismos snapshots, `ai_state`, `state_transition`, `v3_primary_gate`, CRM dry-run
- `flex_telemetry` vacío con OFF
- OFF ×2 determinístico (session_id fijo)

**Doc:** [docs/argos/M4-05A-NOOP-VERIFICATION.md](../docs/argos/M4-05A-NOOP-VERIFICATION.md)

**Script:** `node scripts/m405a-noop-verify.js --write-docs`

---

## Impact report

**Doc:** [docs/sprints/M4-05A-IMPACT-REPORT.md](../docs/sprints/M4-05A-IMPACT-REPORT.md)

Resumen: más tolerante a typos/slang/consent corto; sigue rígido en menú inicial, orden de slots y plantillas; humanizer pendiente M4-05b.

---

## WA staging smoke — **BLOQUEANTE PRE-MERGE**

> **NO mergear a `main` hasta completar los 4 smokes en WhatsApp real staging** con screenshots y telemetría.

| Recurso | Enlace |
|---------|--------|
| Runbook | [docs/argos/whatsapp-smoke/m4-05a/FLEX_STAGING_SMOKE_RUNBOOK.md](../docs/argos/whatsapp-smoke/m4-05a/FLEX_STAGING_SMOKE_RUNBOOK.md) |
| Resultados (rellenar) | [docs/argos/whatsapp-smoke/m4-05a/FLEX_STAGING_SMOKE_RESULTS.md](../docs/argos/whatsapp-smoke/m4-05a/FLEX_STAGING_SMOKE_RESULTS.md) |

### Activación solo Railway QA

```env
PERSEO_CONVERSATIONAL_FLEX_ENABLED=true
PERSEO_V3_ENABLED=true
PERSEO_V3_QA_ALLOWLIST=<teléfono piloto>
```

### Checklist staging WA

- [ ] **FLEX1** — `Hola busco casa en cumpres elite como de unos 6 melones` → Cumbres Elite + ~6M, sin reinicio
- [ ] **FLEX2** — `Simón jalo` (tras handoff) → `ACCEPTED`, no `UNKNOWN`
- [ ] **FLEX3** — `No está libre, vive mi familia ahí` → `habitada`, no `libre`
- [ ] **FLEX4** — Audio corto con typo → sin `fallback_consultive` agresivo, sin menú IVR, sin loop
- [ ] Screenshots WA adjuntos en `FLEX_STAGING_SMOKE_RESULTS.md`
- [ ] `node scripts/staging-query-v3-gate.js <phone>` → `v3_primary_allowed: true`
- [ ] `node scripts/staging-wa-flex-smoke-check.js <phone>` → JSON por smoke
- [ ] `response_source` ∈ `v3_core_*` en cada outbound (no `fallback_consultive`)

### Auditoría post-smoke

```bash
node scripts/staging-query-v3-gate.js <phone>
node scripts/staging-wa-flex-smoke-check.js <phone> FLEX1
```

---

## Riesgos abiertos

| Riesgo | Mitigación actual | Siguiente fase |
|--------|-------------------|----------------|
| **STT imperfecto** | No cubierto en 05a | M4-05c STT softener |
| **Fragments multi-intent** | Regex por campo; competencia de parsers | M4-05b Flex Engine PRE |
| **Wording rígido** | Plantillas `slotTemplates` sin cambio | M4-05d Humanizer POST |
| **IVR opening** | Menú global primer turno intacto | M4-05b + humanizer |
| **Sin humanizer** | Solo parsers; copy igual de estructura | M4-05d |
| **Railway sin V3 primary** | Independiente de flex; ver B1 M4-04B | Ops: flags V3 en QA |
| **`como 6` sin contexto** | No inventar precio (correcto) | Confirmación suave en 05b |

---

## Rollback

**Inmediato (sin redeploy de código):**

```env
PERSEO_CONVERSATIONAL_FLEX_ENABLED=false
```

o eliminar la variable en Railway QA → comportamiento baseline (NO-OP probado).

**Si hay regresión tras merge:**

1. Flag OFF en staging/prod.
2. Revert PR en `main` si hiciera falta (diff acotado a parsers + `conversation/flexibility/*`).
3. Re-ejecutar `closure-integrity-p0` + `closure-terminal-ack-p0` post-revert.

**No hay migraciones DB ni cambios CRM** en este PR.

---

## Qué queda para M4-05b (NO en este PR)

| Fase | Entrega |
|------|---------|
| **M4-05b** | `conversationFlexibilityEngine` PRE-interpreter, fragmentos, intención implícita |
| **M4-05c** | STT softener + escenarios audio |
| **M4-05d** | `conversationHumanizer` POST-compose |
| **M4-05e** | Re-smoke pilotos WA flex ON, rollout staging controlado |

Suite objetivo post-05b: expansión `conversation-flexibility-p0` hacia 50 escenarios.

**Entrar a M4-05b solo cuando:** M4-05a mergeado + FLEX1–4 PASS en staging + flag estable 48h QA.

---

## Test plan (reviewer)

- [ ] Revisar que hooks flex están detrás de `isConversationalFlexEnabled()`
- [ ] Correr `node scripts/m405a-noop-verify.js` → `ok: true`
- [ ] Correr suite `conversation-flexibility-p0` → 20/20
- [ ] Corrar closure suites → 8/8 + 6/6
- [ ] Confirmar checklist WA vacío / pendiente antes de approve merge

---

## Commits

- `fix(flex): M4-05a conversational flex quick wins`
- `docs(flex): NO-OP verification, staging WA smoke runbook, impact report`
