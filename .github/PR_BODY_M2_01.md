## Summary

PR-M2-01 entrega **Policy Engine v1** y la **fundación de Message Understanding** (segmentación, multi-intent, response planner) integradas en el runtime V3, con cobertura ARGOS y flags desactivados por default en producción.

## Estado de flags

- `PERSEO_POLICY_ENGINE_ENABLED=false` por default (`config/perseoM2Flags.js` — solo activo con `=== 'true'`).
- `PERSEO_MESSAGE_PLANNER_ENABLED=false` por default (misma regla).
- **Con flags OFF:** paridad exacta con `main` en `npm test` — **7 fallos legacy**, **0 regresiones nuevas** (delta aislado documentado en `docs/argos/PRE_PR_M2_01_REPORT.md`).
- **Con flags ON:** suites ARGOS `policy-p0` y `cross-intent-p0` pasan; `release-p1` validado 11/11 OFF y ON en ARGOS. Algunos legacy integration tests (`npm test`) aún no son compatibles con planner/policy activos (**13 fail** vs 7 baseline) y quedan **fuera del default** de merge/prod.

## Bloque entregado

- **Policy Engine v1:** decisiones ATTEND / QUALIFY / DECLINE_SOFT / HANDOFF / DEFER, umbrales comerciales, zonas activas, templates de decline, trace `policy_decision`.
- **Message Understanding foundation:** `messageSegmenter`, `multiIntentDetector`, `segmentSlotExtractor`, `responsePlanner`, `runUnderstandingLayer`, trace `segments` / `response_plan`.
- **Integración:** `policyCrossTurn.js`, hooks en `v3Runtime` / `v3InboundBridge`, `goalLock` dual-intent, ARGOS snapshot/runner/mustNot.
- **`policy-p0`:** 8/8 (flags ON)
- **`cross-intent-p0`:** 6/6 (flags ON)
- **`release-p1`:** 11/11 flags OFF + validado 11/11 flags ON en ARGOS
- **+9 tests nuevos** (`policyEngine.test.js`, `argosM2PolicyCross.test.js`): todos PASS
- **Sin** migraciones Supabase
- **Sin** ATENA / ARGOS UI
- **Sin** CRM execute

## Validación

| Check | Resultado |
|-------|-----------|
| `test/policyEngine.test.js` | 2/2 PASS |
| `test/argosM2PolicyCross.test.js` | 9/9 PASS |
| `npm run test:argos` | 33/33 PASS |
| `npm run test:perseo` | 103/103 PASS |
| `npm test` (flags OFF) | 702/709 pass, **7 fail** (= baseline `main`) |
| `release-p0` | 7/7 |
| `release-p1` OFF / ON | 11/11 / 11/11 |
| `policy-p0` / `cross-intent-p0` | 8/8 / 6/6 |
| Suites regresión (humanity, reg-sticky, reg-short-msg, handoff, humanity-policy) | PASS |

## npm test — baseline legacy (no ocultar)

`main` y esta rama con flags OFF comparten **exactamente estos 7 subtests** en FAIL (deuda pre-M2, post PR #88):

1. `v3F23Occupancy` — guion completo hasta Libre (`HANDOFF_PENDING` vs `READY_FOR_CRM`)
2. `v3F2Conversation` — guion venta Jorge/Cumbres/8M (orden slots)
3. `v3F2Conversation` — pivot compra explícita
4. `v3F2Conversation` — empatía frustración
5. `v3F32CampaignIntake` — consentimiento WhatsApp
6. `v3F4ComposerObjections` — cierre post-ACCEPTED
7. `v3PrimaryGate` — label `v3_core_f3_1` vs `v3_core_f2`

Detalle y flaky check: `docs/argos/PRE_PR_M2_01_REPORT.md`.

## Rollout post-merge

1. Merge con flags OFF.
2. QA staging: `PERSEO_POLICY_ENGINE_ENABLED=true` + `PERSEO_MESSAGE_PLANNER_ENABLED=true`.
3. Prod escalonado: planner → policy.

## Test plan

- [ ] CI verde en suites ARGOS del PR
- [ ] Confirmar flags OFF en Railway tras deploy
- [ ] QA manual `policy-p0` + `cross-intent-p0` con flags ON en staging
- [ ] Re-ejecutar `release-p1` OFF/ON en Railway

## Docs

- Contratos: `docs/argos/contracts/PolicyEngine-v1.md`, `MessageUnderstanding-v1.md`
- Roadmap: `docs/argos/PERSEO-ARGOS-INTEGRATED-ROADMAP-v2.md`, `PERSEO-ARGOS-M2-M3-EXECUTION-PLAN-v1.md`
