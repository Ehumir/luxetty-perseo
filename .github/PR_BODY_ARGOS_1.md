## Resumen ejecutivo

ARGOS-1 expone una **API interna de laboratorio** en PERSEO para simular conversaciones V3/F3/F6 **sin WhatsApp** y **sin writes** en tablas CRM, usando el **mismo motor de decisión** que producción (`contactProvisioning` + `leadAutomation` en modo preview).

Incluye escenarios batch (`run-scenario`), validación de ownership (RULE_1–4), `must_not` semántico, anti-loop, observabilidad (`debug_trace`) y endurecimiento conversacional para llegar a `CRM_READY` de forma natural (flujo compra genérico, no hacks por escenario).

**Sin migraciones** · **Sin tablas `argos_*`** · **Sin deploy a prod customer con ARGOS habilitado por defecto**.

Reporte pre-PR: [`docs/argos/ARGOS-1-PRE-PR-REPORT.md`](../docs/argos/ARGOS-1-PRE-PR-REPORT.md)

---

## Alcance

### Incluido (ARGOS-1)

- Router `/internal/argos/*` + auth por `X-Argos-Service-Secret`
- Sesión en memoria (`argosSessionStore`) + `conversationId` sintético `argos:{session_id}`
- `processInboundForArgos` (turno sin persistencia operativa)
- `previewCrmPipeline` + `ownershipValidator` + `technical_panel` / `conversation_snapshot`
- `argosNoWriteSupabase` (cero mutaciones en tablas prohibidas)
- `run-scenario` + `mustNotValidator` semántico
- Tests `test/argos*.test.js` + script `scripts/argos-postman-validation.js`
- Colección Postman `docs/argos/postman/`
- Fases QA: V3→CRM_READY, assignment parity (`assignmentDecision.js`), observabilidad trace

### Fuera de alcance (ARGOS-2+)

- UI simulador ATENA
- Tablas `argos_*` en Supabase
- TTL sesiones / runner batch persistente
- Deploy producción con ARGOS expuesto

### Prerrequisitos en esta rama

Esta rama incluye commits previos de **demand ownership** y fixes V3/F6.1 necesarios para assignment parity y preview CRM honesto en flujos demanda.

---

## Cambios principales

| Área | Cambio |
|------|--------|
| **ARGOS core** | `argos/*` — router, auth, session, process, preview, ownership, scenario, trace, no-write wrapper |
| **Flags** | `config/argosFlags.js`; `perseoV3Flags` bypass allowlist en `argosMode` |
| **CRM preview** | `previewContactForConversation` / `previewLeadFromConversation`; `_planContact` / `_planLead` compartidos |
| **Assignment** | `services/assignmentDecision.js` — `resolveAssignmentDecision` preview/execute; `assignLead` unificado |
| **V3 conversacional** | `ruleGuard` sticky real; nombre en `HANDOFF_PENDING`; `f3Pipeline` resume qual post-consent; proyección intent legacy |
| **Seguridad** | `perseoAutomatedWhatsApp` → `ARGOS_WHATSAPP_BLOCKED` en modo ARGOS |
| **Tests** | 7 suites ARGOS + `v3RuleGuardBuyDemand.test.js` |

---

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/internal/argos/health` | Estado flags, límites, Supabase/OpenAI disponibles |
| `POST` | `/internal/argos/simulate-turn` | Un turno V3 + panel + gates + trace (sin writes) |
| `POST` | `/internal/argos/crm-dry-run` | Preview contacto/lead/asignación/ownership |
| `POST` | `/internal/argos/reset-session` | Reset `crm` o `full` en memoria |
| `POST` | `/internal/argos/run-scenario` | Multi-turno + `expected` + `must_not` |

**Auth:** header `X-Argos-Service-Secret` (obligatorio salvo health público opcional).

---

## Variables de entorno

### Railway QA (ARGOS habilitado)

```bash
PERSEO_ARGOS_ENABLED=true
ARGOS_SERVICE_SECRET=<secret fuerte, solo QA>
PERSEO_V3_ENABLED=true
PERSEO_V3_HANDOFF_ENABLED=true
PERSEO_V3_CRM_EXECUTE=false
PERSEO_V3_CRM_DRY_RUN=true
```

### Producción / customer (default seguro)

```bash
PERSEO_ARGOS_ENABLED=false
# No exponer ARGOS_SERVICE_SECRET en prod customer
```

### Opcionales

```bash
ARGOS_HEALTH_PUBLIC=false          # health sin secret si true
ARGOS_MAX_TURNS_PER_SCENARIO=30
ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE=8
```

---

## Suites ejecutadas

| Comando | Resultado |
|---------|-----------|
| `npm run test:argos` | **14/14 pass** |
| `npm test` | **675/675 pass** |
| `npm run test:perseo` | **103/103 pass** |
| `node scripts/argos-postman-validation.js` | Exit 0 — DEMAND_002 `ok: true` |

---

## Riesgos abiertos

| Riesgo | Mitigación |
|--------|------------|
| `ownership_validation.passed=false` sin fallback en BD QA | Configurar `assignment_settings.fallback_agent_profile_id` o reglas/god_mode en Supabase dev |
| Preview vs RPC `assign_lead_via_engine` cuando no hay candidatos | Documentado; execute puede asignar vía RPC donde preview marca `wouldInvokeRpc` |
| Endpoint interno expuesto | Secret fuerte; `PERSEO_ARGOS_ENABLED=false` en prod; IP allowlist Railway |
| Sesiones en memoria sin TTL | Aceptado ARGOS-1; ARGOS-2 |
| Smoke webhook no automatizado en CI | **Obligatorio manual pre-merge QA** (ver Test plan) |

---

## Checklist B.9 (ARGOS-1)

| # | Criterio | Estado |
|---|----------|--------|
| 1 | `PERSEO_ARGOS_ENABLED=false` → 403 | ✅ |
| 2 | Secret inválido → 401 | ✅ |
| 3 | `simulate-turn` sin writes CRM | ✅ |
| 4 | `crm-dry-run` campos completos | ✅ |
| 5 | No `requests` en path ARGOS | ✅ |
| 6 | Preview `leadAutomation` / `contactProvisioning` | ✅ |
| 7 | RULE_1–4 tests | ✅ |
| 8 | `npm test` + `test:perseo` green | ✅ |
| 9 | Smoke webhook prod | ⚠️ **Manual pre-QA Railway** |
| 10 | README ARGOS | ⚠️ Parcial (`docs/argos/postman/README.md`) |

Ítems 9–10 **no bloquean** merge a QA; sí bloquean confianza en prod webhook.

---

## Rollback

1. **Instantáneo:** `PERSEO_ARGOS_ENABLED=false` en Railway.
2. **Código:** revert merge PR (quita router `/internal/argos`).
3. **BD:** ninguna migración que revertir.
4. **Webhook:** sin cambio de semántica si flags ARGOS off (path `/webhook` intacto).

---

## Test plan (reviewers)

### Automatizado (CI local)

```bash
npm run test:argos
npm test
npm run test:perseo
```

### Manual Postman / script

```bash
# Servidor local
PERSEO_ARGOS_ENABLED=true \
ARGOS_SERVICE_SECRET=<secret> \
PERSEO_V3_ENABLED=true \
PERSEO_V3_HANDOFF_ENABLED=true \
PERSEO_V3_CRM_EXECUTE=false \
PERSEO_V3_CRM_DRY_RUN=true \
PORT=3000 node index.js

ARGOS_SERVICE_SECRET=<secret> \
PERSEO_BASE_URL=http://localhost:3000 \
node scripts/argos-postman-validation.js
```

Verificar: `04-demand002.json` local → `ok: true`, `CRM_READY` (evidence no va en git).

### Pre-merge QA Railway (obligatorio)

1. **Smoke webhook:** 1 inbound WhatsApp desde número QA allowlist → respuesta normal legacy/V3 (fuera de `/internal/argos`).
2. **ARGOS off:** `PERSEO_ARGOS_ENABLED=false` → `GET /internal/argos/health` = **403** en todos los endpoints.
3. **ARGOS on:** health 200; `run-scenario` DEMAND_002; confirmar logs sin `INSERT` real en contacts/leads.
4. **Opcional ownership green:** configurar fallback agent en Supabase QA y re-ejecutar `crm-dry-run`.

---

## Archivos críticos modificados

| Archivo | Rol |
|---------|-----|
| `index.js` | Monta `/internal/argos` |
| `argos/routes/internalArgosRouter.js` | Endpoints |
| `argos/processInboundForArgos.js` | Orquestación turno |
| `argos/previewCrmPipeline.js` | Dry-run CRM |
| `argos/argosNoWriteSupabase.js` | Enforcement cero writes |
| `argos/ownershipValidator.js` | RULE_1–4 |
| `argos/scenarioRunner.js` | Escenarios QA |
| `services/assignmentDecision.js` | Motor único preview/execute |
| `services/leadAutomation.js` | `_planLead`, `assignLead`, preview |
| `services/contactProvisioning.js` | `_planContact`, preview |
| `config/argosFlags.js` / `config/perseoV3Flags.js` | Flags |
| `conversation/v3/*` | CRM_READY, ruleGuard, handoff, snapshot |

---

## Instrucciones Railway QA

1. Merge PR a rama de deploy QA.
2. Variables (sección env arriba); **rotar** `ARGOS_SERVICE_SECRET` si se filtró en local.
3. Deploy; verificar logs `server_started` + `argos_enabled: true` solo en QA.
4. Ejecutar checklist pre-merge (webhook + ARGOS off/on).
5. Postman contra URL QA: importar `docs/argos/postman/ARGOS-1-Internal-API.postman_collection.json`.
6. **No** habilitar ARGOS en entorno prod customer hasta ARGOS-2 + hardening ops.

---

## Archivos que NO deben entrar al PR

| Patrón | Motivo |
|--------|--------|
| `.env`, `.env.*` | Secretos |
| `docs/argos/evidence/*.json` | Evidencia Postman local (gitignored) |
| `*.log`, `logs/` | Ruido |
| `.cursor/`, traces IDE | Local |
| `node_modules/`, `coverage/` | Artefactos |
| `.github-pr-body-r0-p012.md` | Borrador local |
| `docs/sprints/perseo-ai-decision-core-rearchitecture.md` | Fuera de alcance ARGOS-1 |
| `test/conversationOrchestrator.harness.test.js` | WIP no relacionado |
| `test/crmCreationAuditV2.test.js` | WIP no relacionado (si no forma parte de este diff) |
| Exports Postman masivos / captures HAR | No necesarios (sí la colección en `docs/argos/postman/`) |
