# ARGOS-1 — Reporte final pre-PR

**Repositorio:** `luxetty-perseo`  
**Fecha:** 2026-05-18  
**Alcance:** API interna `/internal/argos/*`, dry-run CRM, escenarios QA, fases conversacionales 1–4 (V3→CRM_READY, assignment parity, `must_not` semántico, observabilidad).  
**Estado:** Listo para preparar PR (sin deploy, sin migraciones).

---

## 1. Endpoints validados

Base: `http://localhost:3000` · Auth: `X-Argos-Service-Secret` · Admin opcional: `X-Argos-Admin-User-Id`

| Método | Ruta | Resultado | Notas |
|--------|------|-----------|--------|
| `GET` | `/internal/argos/health` | ✅ 200 | `argos_enabled`, `v3_enabled`, `crm_execute: false`, `crm_dry_run: true`, límites anti-loop |
| `POST` | `/internal/argos/simulate-turn` | ✅ 200 | `reply`, `conversation_snapshot`, `technical_panel`, `gates`, `events`, `debug_trace`; sin writes |
| `POST` | `/internal/argos/crm-dry-run` | ✅ 200 | Preview CRM cuando `CRM_READY`; `skipped` con razón si no elegible |
| `POST` | `/internal/argos/reset-session` | ✅ (contrato + tests) | Modos `crm` / `full`; 404 si sesión inexistente |
| `POST` | `/internal/argos/run-scenario` | ✅ 200 | Batch multi-turno + `expected` + `must_not` |

**Seguridad**

| Caso | Resultado | Evidencia |
|------|-----------|-----------|
| Secret inválido | ✅ 401 `argos_unauthorized` | `docs/argos/evidence/05-security-401.json`, `test/argosInternalApi.test.js` |
| ARGOS deshabilitado | ✅ 403 `argos_disabled` | `docs/argos/evidence/05-security-403.json` (proceso con `PERSEO_ARGOS_ENABLED=false`, puerto 3001) |

Montaje: `index.js` → `argosAuth` + `internalArgosRouter` bajo `/internal/argos`.

---

## 2. Evidencia Postman

**Colección:** `docs/argos/postman/ARGOS-1-Internal-API.postman_collection.json`  
**Guía:** `docs/argos/postman/README.md`  
**Script automatizado:** `scripts/argos-postman-validation.js`  
**Carpeta evidencia:** `docs/argos/evidence/`

| Archivo | Contenido |
|---------|-----------|
| `00-report-summary.json` | Resumen corrida 2026-05-18T05:46:34Z |
| `01-health.json` | Health OK |
| `02-simulate-turn-last.json` | Multi-turno script (ver nota §5) |
| `03-crm-dry-run.json` | Dry-run sobre sesión script (puede `stage_not_crm_ready`) |
| `04-demand002.json` | Escenario DEMAND_002 **`ok: true`**, `CRM_READY`, `crm_dry_run` ejecutado |
| `04-prop003-must-not.json` | PROP_003 — 0 violaciones semánticas |
| `04-chaos-loop.json` | CHAOS anti-loop |
| `05-security-401.json` | 401 secret |
| `05-security-403.json` | 403 disabled |

**Variables servidor QA local usadas:**

```bash
PERSEO_ARGOS_ENABLED=true
ARGOS_SERVICE_SECRET=argos-local-validation-secret
PERSEO_V3_ENABLED=true
PERSEO_V3_HANDOFF_ENABLED=true
PERSEO_V3_CRM_EXECUTE=false
PERSEO_V3_CRM_DRY_RUN=true
PORT=3000
```

---

## 3. Pruebas ejecutadas

| Suite | Comando | Resultado |
|-------|---------|-----------|
| ARGOS | `npm run test:argos` | **14/14 pass** |
| Regresión global | `npm test` | **675/675 pass** |
| PERSEO / CRM | `npm run test:perseo` | **103/103 pass** |
| Postman script | `node scripts/argos-postman-validation.js` | Exit 0; DEMAND_002 `ok=true` |

**Archivos `test/argos*.test.js`:**

| Archivo | Cubre |
|---------|--------|
| `argosDryRunNoWrites.test.js` | Wrapper Supabase: 0 mutaciones en tablas bloqueadas |
| `argosOwnershipRules.test.js` | RULE_1–4 ownership |
| `argosInternalApi.test.js` | HTTP simulate-turn, crm-dry-run, reset-session, 401 |
| `argosPreviewParity.test.js` | `_planContact` / `_planLead` preview ≡ motor decisión |
| `argosAntiLoop.test.js` | `LOOP_DETECTED`, límites consecutivos |
| `argosWhatsAppBlocked.test.js` | `ARGOS_WHATSAPP_BLOCKED` en modo ARGOS |
| `argosMustNotValidator.test.js` | Precios/códigos/URLs inventados |

**Regresión V3 añadida (flujo compra):** `test/v3RuleGuardBuyDemand.test.js` (incluida en `npm test`).

---

## 4. Cambios principales

### ARGOS-1 (infraestructura)

- Módulo `argos/`: router, auth, sesión en memoria, `processInboundForArgos`, `previewCrmPipeline`, `ownershipValidator`, `scenarioRunner`, `argosNoWriteSupabase`, `argosTrace`, `crmGateDiagnostics`, `mustNotValidator`, `deterministicMode`.
- `config/argosFlags.js`, montaje en `index.js`, script `test:argos`.
- Preview CRM compartido: `contactProvisioning.previewContactForConversation`, `leadAutomation.previewLeadFromConversation` + `_planContact` / `_planLead`.
- Gate V3: `argosMode` en `perseoV3Flags` (allowlist bypass para `phone_sim`).
- Guard WhatsApp: `perseoAutomatedWhatsApp` → `ARGOS_WHATSAPP_BLOCKED`.

### Fases 1–4 (madurez conversacional + QA)

| Fase | Cambio |
|------|--------|
| **1 — V3→CRM_READY** | `ruleGuard` solo bloquea switch oferta↔demanda real; nombre en `HANDOFF_PENDING`; F3 en ARGOS (`applyArgosSimulationEnv`); `f3Pipeline` resume calificación si consent sin payload |
| **2 — Assignment parity** | `services/assignmentDecision.js`: `resolveAssignmentDecision` / `applyAssignmentDecision`; `assignLead` y `_planLead` usan el mismo motor; execute conserva `shouldTriggerHandoff` → `assignLead` |
| **3 — must_not semántico** | `argos/mustNotValidator.js` vs facts (precio, listing, URL, disponibilidad) |
| **4 — Observabilidad** | `debug_trace`: `parser_winner`, `rule_guard_result`, `state_transition`, `crm_gate_blockers`, `assignment_decision`; proyección intent en `v3ToLegacyAiState` + panel/snapshot |

**Sin migraciones** · **Sin tablas `argos_*`** · **Sin hacks por escenario** (DEMAND_002 es flujo genérico compra).

---

## 5. Riesgos abiertos

| Riesgo | Severidad | Estado |
|--------|-----------|--------|
| **Ownership `passed=false` sin fallback en BD** | Media | Esperado en dev si no hay `assignment_settings.fallback_agent_profile_id`, god_mode ni reglas. Validador **no relajado**. Escenario DEMAND_002 pasa (`ok: true`) con warning `ownership_validation_failed`. |
| **Preview vs execute con `assign_lead_via_engine` RPC** | Media | Preview no invoca RPC; execute sí. Paridad en candidatos prioritarios + god_mode + rules + settings fallback; gap solo cuando todo vacío y RPC asignaría en prod. |
| **403 ARGOS disabled** | Baja | Evidencia manual (proceso separado); no hay test HTTP automatizado 403 en suite (solo 401). |
| **Documentación ARGOS en README V3** | Baja | Plan B.9 pide sección en README; hoy documentado en `docs/argos/postman/README.md` y sprint plan. Pendiente 1 párrafo en README principal si se exige literal B.9. |
| **Smoke webhook producción** | Baja | No re-ejecutado en esta corrida; regresión `npm test` + `test:perseo` green. Recomendado 1 inbound QA allowlist antes de merge a QA Railway. |
| **TTL sesiones ARGOS en memoria** | Baja | Plan menciona TTL 2h / max 500; implementación actual es Map sin TTL (ARGOS-2). |
| **Endpoint expuesto** | Crítica (ops) | Mitigación: secret fuerte, `PERSEO_ARGOS_ENABLED=false` en prod customer, IP allowlist Railway. |

---

## 6. Confirmación: cero writes

**Mecanismo:** `createArgosNoWriteSupabase` envuelve el cliente Supabase y lanza `ARGOS_SIDE_EFFECT_BLOCKED` en mutaciones.

**Tablas bloqueadas** (`argos/constants.js`):  
`contacts`, `leads`, `conversations`, `conversation_messages`, `conversation_events`, `notifications`, `notification_deliveries`, `notification_queue`, `opportunities`, `opportunity_matches`, `assignment_logs`, `agent_assignments`, **`requests`**.

**Path ARGOS:**

- No `getOrCreateConversation` / `saveConversationMessage` en `processInboundForArgos`.
- CRM solo `previewCrmPipeline` con cliente envuelto.
- Tests: `argosDryRunNoWrites.test.js` — contador mutaciones = 0.

**Evidencia script:** sección 5c → `{ code: 'ARGOS_SIDE_EFFECT_BLOCKED', message: '... insert contacts' }`.

---

## 7. Confirmación: WhatsApp blocked

- `processInboundForArgos` emite trace `whatsapp_blocked` (`reason: argos_mode`) en cada turno.
- `services/perseoAutomatedWhatsApp.js`: guard duro si `argosMode` → `ARGOS_WHATSAPP_BLOCKED`.
- Test: `argosWhatsAppBlocked.test.js`.
- Escenarios `must_not.send_whatsapp`: evento `must_not_whatsapp_verified` en DEMAND_002.

---

## 8. Confirmación: ownership validation

**Implementación:** `argos/ownershipValidator.js` — RULE_1 (property agent), RULE_2 (contact owner demand), RULE_3 (engine fallback), RULE_4 (legal_sensitive defer).

**Tests:** `argosOwnershipRules.test.js` — matriz RULE_1–4 con mocks.

**E2E DEMAND_002** (`04-demand002.json`):

```json
"ownership_validation": {
  "passed": false,
  "rule": "RULE_3_ENGINE_FALLBACK",
  "violations": [{ "code": "MISSING_ASSIGNMENT_FALLBACK" }]
}
```

Interpretación: el motor de decisión y el preview funcionan; la BD local no resolvió agente. **No es falla del escenario** (`violations: []`, `ok: true`). Para `passed: true` en QA: configurar fallback o reglas en Supabase dev.

---

## 9. Confirmación: preview parity

- `_planContact` / `_planLead` comparten lógica con execute vía `resolveAssignmentDecision` (`mode: 'preview' | 'execute'`).
- `assignLead()` en execute delega al mismo resolver + `assignLeadViaEngineOnly`.
- Tests: `argosPreviewParity.test.js` — preview contact y preview lead alineados con `_planContact` / `_planLead`.
- Regresión CRM: `crmCreationAuditV2.test.js` + `leadAutomation` **675 tests green** tras restaurar path `assignLead` en `createOrReuseLeadFromConversation`.

---

## 10. Checklist B.9 completo

Referencia: `docs/sprints/argos-qa-plan-argos-0-1.md` § B.9

| # | Criterio | Estado |
|---|----------|--------|
| 1 | `PERSEO_ARGOS_ENABLED=false` → 403 en todos los endpoints | ✅ Evidencia `05-security-403.json` |
| 2 | Secret inválido → 401 | ✅ Evidencia + `argosInternalApi.test.js` |
| 3 | `simulate-turn`: reply + panel sin filas CRM | ✅ Tests + Postman |
| 4 | `crm-dry-run`: campos `would_*`, assignment, ownership, errors/warnings | ✅ DEMAND_002 final block |
| 5 | No `public.requests` en path ARGOS | ✅ Tabla en `ARGOS_BLOCKED_TABLES`; trace `must_not_requests_table` |
| 6 | Lógica `leadAutomation` / `contactProvisioning` (preview refactor) | ✅ Sin reimplementación paralela |
| 7 | RULE_1–4 en `argosOwnershipRules.test.js` | ✅ |
| 8 | `npm test` y `npm run test:perseo` green | ✅ 675 + 103 |
| 9 | Webhook producción sin regresión (smoke 1 inbound) | ⚠️ Pendiente manual pre-deploy QA Railway |
| 10 | Documentado en README / `conversation/v3/README.md` | ⚠️ Parcial: `docs/argos/postman/README.md`; falta sección breve en README raíz/V3 si se exige literal |

**Gate ARGOS-2:** checklist B.9 sustancialmente completo (ítems 9–10 operativos/documentación menor antes de merge a QA).

---

## Flujo conversacional de referencia (DEMAND_002)

Mensajes: Hola → Busco casa en Cumbres → Presupuesto 5M → Jorge → Sí contacte asesor.

| Campo final | Valor |
|-------------|--------|
| `conversation_stage` | `CRM_READY` |
| `crm_ready` | `true` |
| `known_name` | Jorge |
| `known_budget` | 5000000 |
| `advisor_contact_consent` | ACCEPTED |
| `would_create_contact` / `would_create_lead` | true |
| Escenario `ok` | **true** |

Sin sembrar `v3_state` en el escenario (estado emerge del diálogo).

---

## Próximo paso: PR

1. Branch dedicado `feat/argos-1-internal-api` (o convención del equipo).
2. Excluir del commit: docs sprint no relacionados, `.github-pr-body-*.md` locales, si aplica.
3. Cuerpo PR: enlazar este reporte, evidencia `docs/argos/evidence/`, checklist B.9, variables env Railway QA.
4. Post-merge QA: smoke webhook + opcional `assignment_settings.fallback_agent_profile_id` para ownership green.

---

*Generado para gate pre-PR ARGOS-1. No autoriza deploy a producción ni migraciones `argos_*`.*
