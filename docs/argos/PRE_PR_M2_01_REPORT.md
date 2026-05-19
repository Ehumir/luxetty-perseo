# PR-M2-01 — Pre-PR Report (Policy + Cross foundation)

**Branch:** `feat/m2-01-policy-cross-foundation`  
**Date:** 2026-05-19  
**Flags:** `PERSEO_POLICY_ENGINE_ENABLED`, `PERSEO_MESSAGE_PLANNER_ENABLED` (default `false` en prod)

---

## Validation summary

| Check | Result |
|-------|--------|
| `test/policyEngine.test.js` | **2/2 PASS** |
| `test/argosM2PolicyCross.test.js` | **9/9 PASS** |
| `npm run test:argos` | **33/33 PASS** |
| `npm run test:perseo` | **103/103 PASS** |
| `npm test` | **702/709 PASS**, **7 fail** (mismo conteo que `main`: 676/683, 7 fail) |

### ARGOS suites

| Suite | Flags | Result |
|-------|-------|--------|
| `release-p0` | OFF | **7/7** |
| `release-p1` | OFF | **11/11** |
| `release-p1` | ON | **11/11** |
| `policy-p0` | ON | **8/8** |
| `cross-intent-p0` | ON | **6/6** |
| `humanity-p0` | OFF | **2/2** |
| `humanity-policy-p0` | ON | **2/2** |
| `reg-sticky-p0` | OFF | **2/2** |
| `reg-short-msg-p0` | OFF | **1/1** |
| `humanity-handoff-p0` | OFF | **2/2** |

---

## Scenarios included (16 in gate)

- **policy-p0:** POLICY_001–008  
- **cross-intent-p0:** CROSS_001–006  
- **humanity-policy-p0:** HUMANITY_002, HUMANITY_003  

**Opcionales (repo, no en suite gate):** REG_LONG_MSG_001, REG_POLICY_TONE_001

---

## npm test — delta aislado (2026-05-19)

**Entorno:** `PERSEO_POLICY_ENGINE_ENABLED=false` `PERSEO_MESSAGE_PLANNER_ENABLED=false` (default prod/PR).

| Métrica | `main` (`a13ac7f`, post PR #88) | Rama M2-01 (2× OFF) |
|---------|--------------------------------|---------------------|
| tests | 700 | 709 (+9 tests M2) |
| pass | 693 | 702 |
| **fail** | **7** | **7** (run1 y run2 idénticos) |

**Delta regresión M2-01 con flags OFF: 0** (mismos 7 subtests, mismas aserciones).

El reporte previo de **12 fail** fue artefacto de medición (p. ej. `grep '✖'` cuenta suites padre + hojas, o corrida sin flags OFF). Con parser `test at` + `ℹ fail`, la rama da **7/7** estable.

### Tabla de fallos (leaf)

| Test | Main | Rama (OFF) | Delta | Causa probable | Acción |
|------|------|------------|-------|----------------|--------|
| `v3F23Occupancy` — guion completo hasta Libre | FAIL | FAIL | 0 | `HANDOFF_PENDING` vs `READY_FOR_CRM` (handoff M1) | Legacy; fuera scope M2 |
| `v3F2Conversation` — guion Hola→venta→Jorge→Cumbres→8M | FAIL | FAIL | 0 | Copy pide ocupación antes de confirmar nombre | Legacy F2 slot order |
| `v3F2Conversation` — permite pasar a compra | FAIL | FAIL | 0 | `SELL_PROPERTY` vs `BUY_PROPERTY` pivot | Legacy F2 intent |
| `v3F2Conversation` — empatía sin "Listo, retomo" | FAIL | FAIL | 0 | Abre con saludo genérico vs empatía | Legacy F2 frustración |
| `v3F32CampaignIntake` — Sí / Por WhatsApp consent | FAIL | FAIL | 0 | `handoffChannel` null vs `whatsapp` | Legacy F3.1 consent |
| `v3F4ComposerObjections` — gracias después ACCEPTED | FAIL | FAIL | 0 | Copy búsqueda vs cierre corto | Legacy F4 composer |
| `v3PrimaryGate` — processV3Turn síncrono | FAIL | FAIL | 0 | `handled` = `v3_core_f3_1` vs `v3_core_f2` | Legacy gate label post-F3 |

**Flags ON** (solo QA local, no default): **13 fail** (+6 hojas nuevas: handoff guion, buy open search policy, name repeat, CRM Luisa, etc.). No bloquean PR si merge con flags OFF.

### Flaky check

Rama OFF run1 vs run2: **misma lista de 7** — no flaky en el set baseline.

---

## Risks

1. Activar flags en prod sin QA Railway — mitigado: default `false`.  
2. Suite `release-p1` lenta (~63s) en CI — `argosM2PolicyCross` usa timeout 120s.  
3. Railway: ejecutar mismas suites remote con flags OFF/ON post-deploy.

---

## Rollout

1. Merge con flags OFF.  
2. QA: `PERSEO_POLICY_ENGINE_ENABLED=true` + `PERSEO_MESSAGE_PLANNER_ENABLED=true`.  
3. Prod escalonado: planner → policy.
