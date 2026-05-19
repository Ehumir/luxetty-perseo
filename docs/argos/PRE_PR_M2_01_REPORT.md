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

## npm test — baseline

No se añadieron fallos nuevos vs `main` (7 fail en ambos). Los 7 existentes son deuda previa (handoff/F3/F4 en tests de integración), no introducidos por policy/planner con flags OFF.

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
