# ARGOS QA — Plan ejecutivo ARGOS-0 y ARGOS-1

**Versión:** 1.2 (ajustes finales pre-implementación)  
**Fecha:** 2026-05-15  
**Estado:** Plan aprobado — **implementable** (Postman ARGOS-1 antes de código PERSEO)  
**Alcance explícito:** NO migraciones, NO tablas `argos_*`, NO Edge Function en ARGOS-0/1 (PERSEO primero; UI ATENA solo fundación en ARGOS-0)

**Documento padre:** `argos-qa-propuesta-implementacion.md` (visión completa; fases 2+ condicionadas a validar ARGOS-1)

---

## Resumen del alcance acordado

| Fase | Repo | Qué entrega | Qué NO incluye |
|------|------|-------------|----------------|
| **ARGOS-0** | `luxetty-atena` | Rename UI, ruta, UX Insight corregida, dashboard básico `ai_audit_*` | Esquema, simulador, llamadas PERSEO |
| **ARGOS-1** | `luxetty-perseo` | API `/internal/argos/*`, dry-run CRM real, tests | Tablas `argos_*`, runner batch, UI simulador (→ ARGOS-2) |

---

# PARTE A — ARGOS-0 (Fundación UI)

## A.1 Objetivo

Renombrar ATENA Insight a **ARGOS QA**, corregir UX rota del módulo actual y añadir dashboard básico — **sin tocar Supabase** (ni migraciones, ni RPCs, ni RLS).

## A.2 Archivos exactos

### A.2.1 Archivos nuevos

| Archivo | Propósito |
|---------|-----------|
| `src/pages/panel/ArgosQaPage.tsx` | Página principal (evolución de `AtenaInsightPage.tsx`) |
| `src/components/panel/argos/ArgosRunSelector.tsx` | Selector global de `ai_audit_runs` |
| `src/components/panel/argos/ArgosDashboard.tsx` | KPIs desde `ai_audit_runs` + `ai_audit_findings` (client-side) |
| `src/hooks/useArgosSelectedAuditRun.ts` | Estado `selectedRunId` + helpers |
| `src/pages/panel/AtenaInsightRedirect.tsx` | `<Navigate to="/panel/argos-qa" replace />` (opcional, o redirect inline en ruta) |

### A.2.2 Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/App.tsx` | Ruta `argos-qa` → `ArgosQaPage`; `atena-insight` → redirect |
| `src/components/panel/PanelSidebar.tsx` | Label "ARGOS QA", url `/panel/argos-qa`, icono Brain |
| `src/hooks/useAiAuditFindings.ts` | Asegurar `queryKey` incluye `auditRunId`; invalidación por corrida |
| `src/hooks/useAiAuditDeliverables.ts` | Filtrar reports/recs/sprints por `audit_run_id`; `queryKey` con runId |
| `src/components/panel/atena/AtenaFindingsSection.tsx` | Prop `auditRunId`; link conversación; empty si no hay corrida |
| `src/components/panel/atena/AtenaReportSection.tsx` | Prop `auditRunId`; reporte de esa corrida (no siempre `[0]`) |
| `src/components/panel/atena/AtenaRecommendationsSection.tsx` | Prop `auditRunId` + filtro |
| `src/components/panel/atena/AtenaCopilotSprintsSection.tsx` | Prop `auditRunId` + filtro |
| `src/hooks/useAiAuditDeliverables.ts` → `inferFilesToReview` | Paths `ArgosQaPage`, `argos/*` |
| `src/pages/panel/AtenaInsightPage.tsx` | **Deprecar:** re-export o redirect-only (evitar duplicar lógica) |

### A.2.3 Archivos que NO se tocan

- `supabase/migrations/**`
- `supabase/functions/**`
- RPCs SQL existentes
- `src/hooks/useConversations.ts` / inbox operativo

## A.3 Funciones / componentes nuevos (frontend)

### `useArgosSelectedAuditRun()`

```typescript
// Retorna:
{
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  selectedRun: AiAuditRun | undefined;
  runs: AiAuditRun[];
}
```

- Inicializar `selectedRunId` con `runs[0]?.id` cuando carguen corridas.
- Al completar `useRunDeterministicAudit`, auto-seleccionar la corrida recién creada.

### `ArgosRunSelector`

- `<Select>` o lista compacta de corridas (título, periodo, status, findings count opcional).
- Emite `onSelect(runId)`.

### `ArgosDashboard`

Agregación **solo con datos ya en cliente** (sin RPC nueva):

| KPI | Fuente |
|-----|--------|
| Última corrida | `selectedRun` o `runs[0]` |
| Total hallazgos | `findings.filter(f => f.audit_run_id === selectedRunId).length` |
| Por severidad | reduce `findings.severity` |
| Por categoría | reduce `findings.category` |
| Convos / msgs auditadas | `selectedRun.total_conversations`, `total_messages` |
| Delta vs corrida anterior | comparar con `runs[1]` (patrón ya en `AuditRunComparison`) |

### `ArgosQaPage`

- Header: "ARGOS QA" + subtítulo laboratorio PERSEO.
- `ArgosRunSelector` debajo del header (visible en todas las tabs).
- Tabs existentes: Resumen (dashboard + corridas + reporte + dataset), Hallazgos, Recomendaciones, Codex Sprints.
- `handleGenerateDeliverables(selectedRunId)` — **no** `latestRun`.
- Pasar `auditRunId={selectedRunId}` a todas las secciones.

### Link a Conversaciones IA

En `AtenaFindingsSection` (o helper `getConversationLink`):

```typescript
function getConversationInsightLink(evidence: Record<string, unknown>, sourceRef: string | null) {
  const id = evidence?.conversation_id ?? sourceRef;
  if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  return `/panel/conversaciones-ia?id=${id}`;
}
```

- Botón "Ver conversación" en fila expandida del hallazgo.

## A.4 Cambios en hooks existentes (detalle)

### `useAiAuditReports(enabled, auditRunId?)`

```typescript
queryKey: ["ai-audit-reports", auditRunId ?? "all"]
// queryFn: si auditRunId → .eq("audit_run_id", auditRunId).order("created_at", { ascending: false }).limit(5)
```

### `useAiAuditRecommendations(enabled, auditRunId?)`

- Igual patrón `.eq("audit_run_id", auditRunId)` cuando hay id.

### `useAiAuditCopilotSprints(enabled, auditRunId?)`

- Igual patrón.

### `useAiAuditFindings(enabled, auditRunId?)`

- Ya soporta filtro; página debe pasar `selectedRunId` y `enabled: isAdmin && !!selectedRunId` (o mostrar empty "Selecciona una corrida").

### `useGenerateDeliverables`

- Sin cambio de firma (`auditRunId` argumento); página pasa `selectedRunId`.

## A.5 Configuración / env (ARGOS-0)

**Ninguna variable nueva.** Solo build/deploy frontend ATENA.

## A.6 Pruebas (ARGOS-0)

| Tipo | Acción |
|------|--------|
| Build | `npm run build` en `luxetty-atena` |
| Manual admin | Login admin → `/panel/argos-qa` |
| Redirect | `/panel/atena-insight` → argos-qa |
| Corrida | Nueva auditoría 7 días → auto-select corrida |
| Hallazgos | Solo de corrida seleccionada; cambiar corrida actualiza lista |
| Entregables | Generar sobre corrida B (no siempre la más reciente) |
| Link | Hallazgo con `conversation_id` abre inbox |
| Regresión | Manager/coordinator no ven menú ARGOS |
| No-admin | `/panel/argos-qa` redirige a `/panel` |

**Tests automatizados (opcional recomendado, no bloqueante v0):**

- `src/hooks/useArgosSelectedAuditRun.test.ts` — lógica selección.
- Vitest mock supabase para filtro `audit_run_id`.

## A.7 Criterios de aceptación (ARGOS-0)

- [ ] Ruta `/panel/argos-qa` operativa; sidebar dice "ARGOS QA".
- [ ] `/panel/atena-insight` redirige sin 404.
- [ ] Selector de corrida visible; cambiar corrida filtra hallazgos, reporte, recomendaciones, sprints.
- [ ] "Generar entregables" usa corrida **seleccionada**, no `runs[0]` fijo.
- [ ] Dashboard muestra KPIs de la corrida seleccionada.
- [ ] Al menos un hallazgo con `conversation_id` enlaza a `conversaciones-ia?id=`.
- [ ] Auditoría determinística sigue funcionando (mismas RPCs).
- [ ] `npm run build` sin errores TypeScript.
- [ ] Cero archivos en `supabase/migrations/` modificados.

## A.8 Riesgos (ARGOS-0)

| Riesgo | Mitigación |
|--------|------------|
| Bookmarks rotos a `atena-insight` | Redirect permanente 6+ meses |
| Imports rotos a `AtenaInsightPage` | grep + re-export temporal |
| Deliverables duplicados al regenerar | Toast "reemplaza entregables de esta corrida" (comportamiento actual RPC) |
| Query cache stale al cambiar corrida | `queryKey` con `auditRunId` |

## A.9 Rollback (ARGOS-0)

1. Revert PR ATENA (restaurar ruta `atena-insight`, título ATENA Insight).
2. Sin rollback de BD (no hubo cambios).
3. Tiempo estimado: &lt; 15 min.

---

# PARTE B — ARGOS-1 (PERSEO API + Dry-run CRM)

## B.1 Objetivo

Exponer API interna para simular el flujo PERSEO/V3/F6 **sin WhatsApp** y **sin writes** en `contacts`, `leads`, `conversations`, `conversation_messages` — usando la **misma lógica** de decisión CRM (contact provisioning + lead automation + asignación), en modo preview.

**Entregable principal:** endpoints probables vía Postman/curl + suite de tests. **UI simulador ATENA:** fuera de alcance (ARGOS-2, tras validar API).

## B.2 Principio de diseño: sesión en memoria + Supabase lectura

```
┌─────────────────────────────────────────────────────────┐
│  ARGOS session (in-memory)                              │
│  session_id → { phone_sim, v3State, legacyAiState,      │
│                 transcript[], flags }                   │
└─────────────────────────────────────────────────────────┘
         │ simulate-turn
         ▼
┌─────────────────────────────────────────────────────────┐
│  processInboundForArgos                                 │
│  - NO getOrCreateConversation                           │
│  - NO saveConversationMessage                         │
│  - SÍ v3InboundBridge + property SELECT (read-only)     │
│  - CRM: previewCrmPipeline (NO executeV3Crm writes)    │
└─────────────────────────────────────────────────────────┘
```

- `conversationId` sintético: `argos:${session_id}` (solo para `sessionStore` V3).
- Allowlist: en modo ARGOS, `evaluateV3PrimaryGate` debe permitir `phone_sim` cuando `PERSEO_ARGOS_ENABLED=true` (nuevo gate `argos_mode`).

## B.3 Archivos exactos (PERSEO)

### B.3.1 Archivos nuevos

| Archivo | Propósito |
|---------|-----------|
| `config/argosFlags.js` | `isArgosEnabled()`, `getArgosConfig()`, validación secret |
| `argos/middleware/argosAuth.js` | Valida `X-Argos-Service-Secret` + opcional admin user id |
| `argos/routes/internalArgosRouter.js` | Express router montado en `index.js` |
| `argos/argosSessionStore.js` | Map `session_id` → estado; CRUD sesión |
| `argos/processInboundForArgos.js` | Orquesta un turno sin persistencia operativa |
| `argos/previewCrmPipeline.js` | Preview contacto + lead + asignación |
| `argos/ownershipValidator.js` | Reglas 1–4 sobre resultado preview |
| `argos/technicalPanelBuilder.js` | Construye `technical_panel` JSON |
| `argos/argosNoWriteSupabase.js` | Proxy Supabase: bloquea mutaciones en tablas prohibidas |
| `argos/constants.js` | Tablas prohibidas, códigos error, límites anti-loop |
| `argos/argosTrace.js` | `events[]` + `debug_trace[]` en memoria por sesión/turno |
| `argos/conversationSnapshot.js` | `buildConversationSnapshot(state)` |
| `argos/scenarioRunner.js` | `run-scenario` + asserts + `must_not` + timeouts |
| `argos/deterministicMode.js` | Seed / stub OpenAI cuando `deterministic_mode` |
| `services/argosSafeWhatsApp.js` | Wrapper o guard en `sendPerseoAutomatedWhatsApp` |
| `test/argosDryRunNoWrites.test.js` | Contador mutaciones = 0 |
| `test/argosOwnershipRules.test.js` | Matriz reglas ownership |
| `test/argosInternalApi.test.js` | HTTP tests simulate-turn / run-scenario / crm-dry-run / reset |
| `test/argosPreviewParity.test.js` | **Obligatorio:** preview vs execute misma decisión CRM |
| `test/argosAntiLoop.test.js` | `LOOP_DETECTED` + límites |
| `test/argosWhatsAppBlocked.test.js` | `argosMode` → throw si outbound Graph |
| `docs/argos/postman/ARGOS-1-Internal-API.postman_collection.json` | Colección Postman (entregable previo a código) |

### B.3.2 Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `index.js` | `app.use('/internal/argos', argosAuth, internalArgosRouter)` **antes** de `listen`; export opcional `processInboundForArgos` en `_private` |
| `config/perseoV3Flags.js` | En `evaluateV3PrimaryGate`: si `argosMode` → `allowlist_match: true` (sin depender QA allowlist WhatsApp) |
| `services/contactProvisioning.js` | Exportar `previewContactForConversation` + `_planContact` compartido con execute |
| `services/leadAutomation.js` | Exportar `previewLeadFromConversation` + `_planLead` compartido con execute |
| `conversation/v3/crm/crmExecutor.js` | Exportar helpers para preview parity test |
| `services/perseoAutomatedWhatsApp.js` | Guard duro: `if (argosMode) throw ARGOS_WHATSAPP_BLOCKED` |
| `package.json` | Script `"test:argos": "node --test test/argos*.test.js"` |

### B.3.3 Archivos que NO se modifican en ARGOS-1

- Cualquier migración ATENA / Supabase
- `services/saveConversationMessage.js` (no usar en path ARGOS)
- Webhook `POST /webhook` comportamiento producción (solo extraer función compartida si conviene, sin cambiar semántica)

## B.4 Funciones nuevas (detalle)

### `config/argosFlags.js`

```javascript
function isArgosEnabled() // PERSEO_ARGOS_ENABLED === 'true'
function getArgosConfig() // { enabled, serviceSecret, allowArgosAllowlistBypass: true }
function assertArgosEnabled() // throw 403
```

### `argos/middleware/argosAuth.js`

```javascript
function argosAuthMiddleware(req, res, next)
// Header: X-Argos-Service-Secret === process.env.ARGOS_SERVICE_SECRET
// Opcional: X-Argos-Admin-User-Id (log)
// 401 argos_unauthorized | 403 argos_disabled
```

### `argos/argosSessionStore.js`

```javascript
function createSession({ phone_sim, flags })
function getSession(session_id)
function updateSession(session_id, patch)
function appendTranscript(session_id, { role, text, meta })
function resetSession(session_id, { mode: 'crm' | 'full' })
function deleteSession(session_id)
```

- `reset` mode `crm`: equivalente `qaCrmReset` en memoria (strip CRM keys, `qa_crm_force_new_lead=true`).
- `reset` mode `full`: `resetSession` V3 + legacy ai state default.

### `argos/argosNoWriteSupabase.js`

Wrapper sobre cliente Supabase real:

| Operación | `contacts` | `leads` | `conversations` | `conversation_messages` |
|-----------|-------------|---------|-----------------|-------------------------|
| SELECT | ✅ | ✅ | ✅ (solo lectura si se usa) | ✅ |
| INSERT/UPDATE/DELETE | ❌ throw | ❌ throw | ❌ throw | ❌ throw |

- `conversation_events`: **recomendado bloquear también** en ARGOS-1 para "cero writes" estricto.
- `properties` / `property_*`: SELECT permitido (inventario).

### `argos/processInboundForArgos.js`

```javascript
async function processInboundForArgos({
  session_id,
  phone_sim,
  text,
  flags = {},
  logEvent = argosLog,
})
```

**Pasos (orden):**

1. `assertArgosEnabled()`.
2. Cargar/crear sesión ARGOS.
3. **No** llamar `getOrCreateConversation` ni `saveConversationMessage`.
4. Construir `previousAiState` desde sesión (legacy + V3 map).
5. Reutilizar parsers: `parseMessageSignals`, `buildNextState`, `propertyIntentResolver`, etc. (mismo imports que `index.js`).
6. Property fetch: `propertyInventoryService.findPropertyByInventoryReference(argosNoWriteSupabase, ...)` — solo lectura.
7. `v3InboundBridge.tryV3PrimaryReply({ conversationId: 'argos:'+session_id, phone: phone_sim, argosMode: true, ... })`.
8. `technicalPanelBuilder.build({ v3State, legacyAiState, gates, preview: null })`.
9. Si gate CRM eligible → `previewCrmPipeline(...)` → merge panel + `crm_dry_run`.
10. `appendTranscript` user + assistant.
11. Persistir estado en `argosSessionStore` + `setSession` V3.
12. Retornar `{ reply, technical_panel, ai_state, crm_dry_run, gates, events }`.

**No llamar:** `sendPerseoAutomatedWhatsApp`, `executeV3CrmIfEligible` (path write).

### `argos/previewCrmPipeline.js`

```javascript
async function previewCrmPipeline({
  v3State,
  phone_sim,
  sessionMeta, // contact_id/lead_id conocidos en memoria si hubo preview previo
  supabase,    // argosNoWriteSupabase
  property,
  propertyId,
  waProfileName,
  logEvent,
})
```

**Flujo:**

1. `evaluateV3CrmExecutionGate` — si no eligible, retornar `{ skipped: true, reason }`.
2. `buildV3CrmExecutionPayload` + `mapV3StateToLeadAutomationAiState`.
3. `previewContactForConversation` → `{ action: 'would_create'|'would_reuse'|'would_skip', contactId?, assigned_agent_profile_id?, normalized_whatsapp }`.
4. `previewLeadFromConversation` → `{ action, leadId?, lead_type, operation, interested_property_id, assigned_agent_profile_id, reuse_reason? }`.
5. Resolver asignación (misma función interna que `buildAssignmentPriorityCandidates` / engine) sin persistir.
6. `ownershipValidator.validate({ contactPreview, leadPreview, property, aiState })`.
7. Armar objeto `crm_dry_run` (contrato abajo).

**Refactor mínimo sugerido en servicios:**

- `contactProvisioning.js`: extraer `_planContact(...)` usado por `ensureContactForConversationCore` y `previewContactForConversation`.
- `leadAutomation.js`: extraer `_planLead(...)` usado por `createOrReuseLeadFromConversation` y `previewLeadFromConversation`.

### `argos/ownershipValidator.js`

```javascript
function validateOwnership({
  contactPreview,
  leadPreview,
  propertyAgentProfileId,
  aiState,
})
// Returns { passed, rule, violations[] }
```

| Regla | ID | Validación |
|-------|-----|------------|
| Contacto existente con asesor | `RULE_1_CONTACT_OWNER_DEMAND` | `lead.assigned === contact.owner` para demanda compra/renta |
| Contacto nuevo + propiedad | `RULE_2_PROPERTY_AGENT_NEW_CONTACT` | contact + lead agent = property.agent |
| Sin contacto ni propiedad | `RULE_3_ENGINE_FALLBACK` | strategy ∈ `assignment_engine`, `dios_*`, `fallback` |
| interested_property_id | `RULE_4_PROPERTY_INTEREST_ONLY` | si contact reused con owner: property id set, agent unchanged |

### `argos/technicalPanelBuilder.js`

```javascript
function buildTechnicalPanel({ v3State, legacyAiState, gates, crmDryRun, reply })
```

Mapea a campos requeridos por producto (ver contrato §B.6).

## B.5 Endpoints

Montaje: `app.use('/internal/argos', argosAuthMiddleware, internalArgosRouter)`

| Método | Ruta | Handler |
|--------|------|---------|
| POST | `/internal/argos/simulate-turn` | `handleSimulateTurn` |
| POST | `/internal/argos/run-scenario` | `handleRunScenario` |
| POST | `/internal/argos/crm-dry-run` | `handleCrmDryRun` |
| POST | `/internal/argos/reset-session` | `handleResetSession` |
| GET | `/internal/argos/health` | `handleHealth` (solo enabled check) |

**Todos requieren** `PERSEO_ARGOS_ENABLED=true` + secret válido.

## B.6 Contratos JSON

### POST `/internal/argos/simulate-turn`

**Request:**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "phone_sim": "5218100000001",
  "text": "Busco casa en Cumbres",
  "flags": {
    "v3_enabled": true,
    "crm_dry_run": true
  }
}
```

- Si `session_id` omitido → servidor genera UUID y lo devuelve.

**Response 200:**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "reply": "string o string[]",
  "technical_panel": {
    "intent": "buy",
    "lead_type": "demand",
    "operation": "purchase",
    "detected_name": null,
    "zone": "Cumbres",
    "budget": null,
    "urgency": null,
    "property_code": null,
    "interested_property_id": null,
    "conversation_stage": "QUALIFYING",
    "ai_state": {},
    "would_ask_name": true,
    "would_handoff": false,
    "would_create_contact": false,
    "would_reuse_contact": false,
    "would_create_lead": false,
    "would_reuse_lead": false,
    "would_link_conversation": true,
    "assignment_strategy": null,
    "assigned_agent_profile_id": null,
    "warnings": [],
    "critical_errors": []
  },
  "crm_dry_run": null,
  "gates": {
    "argos_enabled": true,
    "v3_primary_allowed": true,
    "crm_execution_eligible": false,
    "crm_skip_reason": "stage_not_crm_ready"
  },
  "events": []
}
```

Cuando CRM eligible, `crm_dry_run` populated (ver abajo).

---

### POST `/internal/argos/run-scenario`

**Request:**

```json
{
  "session_id": null,
  "phone_sim": "5218100000999",
  "scenario": {
    "scenario_code": "DEMAND_001",
    "messages": ["Hola", "Busco casa en Cumbres", "5 millones", "Sí"],
    "expected": {
      "intent": "buy",
      "lead_type": "demand",
      "should_ask_name": true
    }
  },
  "flags": { "crm_dry_run": true }
}
```

**Response 200:**

```json
{
  "session_id": "...",
  "scenario_code": "DEMAND_001",
  "status": "pass",
  "transcript": [
    { "role": "user", "text": "Hola" },
    { "role": "assistant", "text": "..." }
  ],
  "actual": {
    "intent": "buy",
    "lead_type": "demand",
    "would_create_contact": true,
    "would_create_lead": true,
    "assignment_strategy": "contact_owner",
    "assigned_agent_profile_id": "uuid"
  },
  "diff": [],
  "crm_dry_run": { },
  "ownership_validation": { "passed": true, "rule": "RULE_1_CONTACT_OWNER_DEMAND", "violations": [] },
  "duration_ms": 3200
}
```

- `status`: `pass` | `fail` | `error`.
- `diff`: array `{ field, expected, actual, severity }` — comparación simple con `scenario.expected` (sin BD).

---

### POST `/internal/argos/crm-dry-run`

**Request:**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "phone_sim": "5218100000001",
  "v3_state": null
}
```

- Si `v3_state` null → usar estado V3 de sesión ARGOS.

**Response 200 — `crm_dry_run`:**

```json
{
  "crm_dry_run": {
    "skipped": false,
    "contact": {
      "action": "would_create",
      "would_create_contact": true,
      "would_reuse_contact": false,
      "normalized_whatsapp": "5218100000001",
      "assigned_agent_profile_id": "uuid-or-null",
      "contact_id": null
    },
    "lead": {
      "action": "would_create",
      "would_create_lead": true,
      "would_reuse_lead": false,
      "lead_type": "demand",
      "operation": "purchase",
      "interested_property_id": "LUX-A0470",
      "assigned_agent_profile_id": "uuid",
      "lead_id": null
    },
    "conversation": {
      "action": "would_link",
      "would_link_conversation": true,
      "would_update_ai_state": true
    },
    "assignment": {
      "assignment_strategy": "contact_owner",
      "assigned_agent_profile_id": "uuid"
    },
    "ownership_validation": {
      "passed": true,
      "rule": "RULE_1_CONTACT_OWNER_DEMAND",
      "violations": []
    },
    "notifications": {
      "would_notify_agent": true
    },
    "errors": [],
    "warnings": []
  }
}
```

**Campos top-level requeridos por producto (mapeo):**

| Requerimiento | Campo en respuesta |
|---------------|-------------------|
| would_create_contact | `contact.would_create_contact` |
| would_reuse_contact | `contact.would_reuse_contact` |
| would_create_lead | `lead.would_create_lead` |
| would_reuse_lead | `lead.would_reuse_lead` |
| would_link_conversation | `conversation.would_link_conversation` |
| assignment_strategy | `assignment.assignment_strategy` |
| assigned_agent_profile_id | `assignment.assigned_agent_profile_id` |
| ownership_validation | `ownership_validation` |
| errors / warnings | arrays |

---

### POST `/internal/argos/reset-session`

**Request:**

```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "crm"
}
```

| mode | Efecto |
|------|--------|
| `crm` | Strip CRM ids en sesión; `qa_crm_force_new_lead=true`; V3 reset parcial |
| `full` | Sesión nueva + `resetSession` V3 |

**Response:**

```json
{
  "session_id": "...",
  "ok": true,
  "mode": "crm"
}
```

---

### Errores HTTP

| HTTP | code | Cuándo |
|------|------|--------|
| 401 | `argos_unauthorized` | Secret inválido |
| 403 | `argos_disabled` | `PERSEO_ARGOS_ENABLED` false |
| 422 | `invalid_request` | body inválido |
| 404 | `session_not_found` | session_id desconocido |
| 500 | `argos_internal_error` | excepción no manejada |

## B.7 Variables de entorno (ARGOS-1)

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `PERSEO_ARGOS_ENABLED` | Sí (QA) | `true` habilita rutas `/internal/argos` |
| `ARGOS_SERVICE_SECRET` | Sí | Secret compartido con caller (futuro Edge ATENA) |
| `PERSEO_V3_ENABLED` | Sí | `true` |
| `PERSEO_V3_CRM_DRY_RUN` | Recomendado `true` | Capa adicional F3 |
| `PERSEO_V3_CRM_EXECUTE` | `false` en ARGOS | **Crítico:** no ejecutar writes F6 reales |
| `PERSEO_V3_QA_ALLOWLIST` | Opcional en ARGOS | Bypass si `argosMode` (ver `perseoV3Flags`) |

**Railway QA ejemplo:**

```env
PERSEO_ARGOS_ENABLED=true
ARGOS_SERVICE_SECRET=<rotated-secret>
PERSEO_V3_ENABLED=true
PERSEO_V3_CRM_EXECUTE=false
PERSEO_V3_CRM_DRY_RUN=true
```

## B.8 Pruebas (ARGOS-1)

### Tests nuevos (obligatorios)

| Archivo | Casos |
|---------|-------|
| `test/argosDryRunNoWrites.test.js` | Wrapper supabase: INSERT contacts → throw; contador 0 tras `previewCrmPipeline` + `processInboundForArgos` |
| `test/argosOwnershipRules.test.js` | RULE_1–4 con mocks contact/lead/property agents |
| `test/argosInternalApi.test.js` | supertest contra `app`: simulate-turn, reset-session, crm-dry-run |
| `test/argosRunScenario.test.js` | run-scenario 3 turns; diff cuando expected falla |

### Comandos CI

```bash
npm test
npm run test:perseo
node --test test/argos*.test.js
```

### Manual (Postman)

1. `GET /internal/argos/health` + secret.
2. `simulate-turn` × 5 → flujo compra hasta consent.
3. `crm-dry-run` → JSON completo + `ownership_validation.passed`.
4. `reset-session` mode `crm` → `would_create_lead` en siguiente ciclo.
5. Verificar en logs: **no** `LEAD_CREATED` con insert real (solo `*_preview` events).

## B.9 Criterios de aceptación (ARGOS-1)

- [ ] Con `PERSEO_ARGOS_ENABLED=false`, todos los endpoints responden 403.
- [ ] Con secret inválido → 401.
- [ ] `simulate-turn` devuelve `reply` + `technical_panel` sin crear filas en contacts/leads/conversations/messages.
- [ ] `crm-dry-run` devuelve todos los campos `would_*`, `assignment_strategy`, `assigned_agent_profile_id`, `ownership_validation`, `errors`, `warnings`.
- [ ] No se usa `public.requests` en ningún path ARGOS (grep + test).
- [ ] Se usa lógica `leadAutomation` / `contactProvisioning` (preview refactor), no reimplementación paralela.
- [ ] RULE_1–4 cubiertas por `argosOwnershipRules.test.js`.
- [ ] `npm test` y `npm run test:perseo` green.
- [ ] Webhook producción sin regresión (smoke: 1 inbound WhatsApp QA allowlist).
- [ ] Documentado en README o `conversation/v3/README.md` sección ARGOS.

## B.10 Riesgos (ARGOS-1)

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Preview diverge de execute real | Alta | Compartir `_planContact` / `_planLead`; test parity con `crmCreationAuditV2` mocks |
| ARGOS endpoint expuesto públicamente | Crítica | Secret fuerte; no habilitar en prod customer; IP allowlist Railway |
| V3 session memory leak | Media | TTL sesiones ARGOS (ej. 2h) + max 500 sesiones |
| Property SELECT contra prod | Media | Usar env Supabase QA |
| Refactor leadAutomation grande | Media | Alcance mínimo: preview functions al inicio de archivo, no mover todo |
| `PERSEO_V3_CRM_EXECUTE=true` + ARGOS | Crítica | `previewCrmPipeline` ignora execute; test + assert env en CI |

## B.11 Rollback (ARGOS-1)

1. `PERSEO_ARGOS_ENABLED=false` en Railway (instantáneo).
2. Revert PR PERSEO (quita router `/internal/argos`).
3. Sin migración BD.
4. Webhook vuelve a comportamiento previo si refactor `index.js` fue mínimo.

---

# PARTE C — Secuencia de implementación recomendada

```
Semana 1: ARGOS-0 (ATENA) ─────────────────────────────────────────
  D1: ArgosQaPage + rutas + sidebar + redirect
  D2: useArgosSelectedAuditRun + ArgosRunSelector
  D3: Filtrar hooks/secciones por auditRunId + entregables
  D4: ArgosDashboard + links conversaciones-ia
  D5: build + QA manual + PR

Semana 2-3: ARGOS-1 (PERSEO) ────────────────────────────────────
  D1: argosFlags + auth + router + session store + noWrite supabase
  D2: processInboundForArgos (turno sin DB)
  D3: previewContact + previewLead refactor
  D4: previewCrmPipeline + ownershipValidator + technicalPanelBuilder
  D5: run-scenario + reset-session
  D6-7: tests argos* + test:perseo green + Postman collection
  D8: PR + deploy QA con flags
```

**Gate para ARGOS-2:** checklist B.9 completo + demo Postman grabada + aprobación explícita para migraciones `argos_*`.

---

# PARTE D — Qué queda explícitamente fuera (ARGOS-2+)

- Tablas `argos_*`, Edge `argos-perseo-runner`
- UI Simulador / Matriz en ATENA
- Runner batch 20/50/100 persistido
- Dashboard avanzado / hallazgos unificados
- Auditoría SQL v5 con contacts

---

---

# PARTE E — Ajustes finales v1.2 (aprobados)

## E.1 Trazabilidad: `events[]` + `debug_trace[]`

Aunque no existan tablas `argos_*`, **cada response importante** incluye:

| Campo | Contenido |
|-------|-----------|
| `events[]` | Eventos de negocio ordenados (subset público para UI futura) |
| `debug_trace[]` | Traza técnica detallada (gates, parsers, CRM, ownership) |

**Módulo:** `argos/argosTrace.js`

```javascript
function createArgosTrace(session_id)
function traceEvent(trace, { type, phase, payload })  // → events + debug_trace
function flushTraceToResponse(trace)  // { events, debug_trace }
```

**Fases mínimas en `debug_trace`:**

| phase | Ejemplos `type` |
|-------|-----------------|
| `gate` | `v3_primary_gate`, `crm_execution_gate`, `argos_enabled` |
| `parser` | `message_signals`, `state_change`, `intent_detected` |
| `property` | `property_match_start`, `property_match_result`, `property_code_resolved` |
| `v3` | `v3_stage_transition`, `v3_composer_source`, `v3_handoff_eval` |
| `crm_preview` | `contact_plan`, `lead_plan`, `assignment_strategy`, `crm_skip_reason` |
| `ownership` | `ownership_validation_pass`, `ownership_validation_fail` |
| `safety` | `loop_guard`, `timeout`, `whatsapp_blocked` |

**Persistencia:** append a `argosSessionStore` → `session.trace_log[]` (ring buffer max 500 entradas).

**Responses que deben incluir traza:** `simulate-turn`, `run-scenario` (por turno y resumen), `crm-dry-run`, `reset-session`.

---

## E.2 Modo determinístico

**Flag opcional en body:**

```json
{
  "flags": {
    "deterministic_mode": true
  }
}
```

**Comportamiento cuando `true`:**

| Área | Acción |
|------|--------|
| OpenAI / composer V3 | Usar `minimalInterpreter` / stub documentado en V3 tests; **no** llamadas OpenAI reales |
| Random / timestamps | Seed fijo `ARGOS_DETERMINISTIC_SEED=42` en sesión |
| Wording | Comparar asserts sobre **estructura** (`would_ask_name`, stage) no texto exacto salvo `expected.reply_contains` opcional |
| Property tie-break | Primera coincidencia estable por código |

**Env opcional:** `ARGOS_DETERMINISTIC_MODE_DEFAULT=true` (solo QA).

**Trace:** `debug_trace` entry `deterministic_mode_enabled: true`.

---

## E.3 `run-scenario`: asserts positivos + `must_not`

**Schema escenario extendido:**

```json
{
  "scenario_code": "PROP_003",
  "messages": ["¿Cuánto cuesta LUX-INVALID?"],
  "expected": {
    "intent": "buy",
    "must_not_invent_property": true
  },
  "must_not": {
    "invent_property": true,
    "invent_price": true,
    "invent_link": true,
    "use_requests_table": true,
    "change_contact_owner": true,
    "write_contacts": true,
    "write_leads": true,
    "send_whatsapp": true
  }
}
```

**Validación `must_not` (implementación):**

| Key | Cómo se detecta |
|-----|-----------------|
| `invent_property` | `debug_trace` sin `invented_property_code`; reply no contiene códigos LUX- no en inventario |
| `invent_price` | regex precio + property sin facts |
| `invent_link` | URLs no allowlisted |
| `use_requests_table` | `argosNoWriteSupabase` sin touch `requests`; trace sin `requests_*` |
| `change_contact_owner` | preview: owner id unchanged vs snapshot previo |
| `write_*` | no mutations en wrapper |
| `send_whatsapp` | trace sin `whatsapp_send`; guard no throw |

**Resultado:** `diff[]` incluye entradas `constraint: "must_not.invent_property"`.

---

## E.4 Timeout y anti-loop

**Constantes (`argos/constants.js`):**

```javascript
ARGOS_MAX_TURNS_PER_SCENARIO = 30
ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE = 8
ARGOS_MAX_RECURSIVE_RETRIES = 3
ARGOS_SCENARIO_TIMEOUT_MS = 120_000   // 2 min
ARGOS_TURN_TIMEOUT_MS = 30_000
```

**Detección loop:**

- Misma etapa V3 + mismo `reply_strategy` 3 turnos seguidos → `LOOP_DETECTED`
- O ≥ `ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE` outbound sin inbound intermedio en runner
- Integrar señales existentes `antiLoopGuardrails` donde aplique

**Response en error:**

```json
{
  "status": "error",
  "error_code": "LOOP_DETECTED",
  "message": "Conversation loop detected at turn 7",
  "events": [],
  "debug_trace": []
}
```

---

## E.5 `conversation_snapshot`

**En cada response de:** `simulate-turn`, `crm-dry-run`, `run-scenario` (final y opcional por turno).

```json
{
  "conversation_snapshot": {
    "detected_intent": "buy",
    "conversation_stage": "QUALIFYING",
    "conversation_goal": "purchase",
    "lead_flow": "demand",
    "operation_type": "purchase",
    "known_name": null,
    "known_budget": 5000000,
    "known_zone": "Cumbres",
    "property_code": null,
    "interested_property_id": null,
    "crm_ready": false,
    "advisor_contact_consent": "PENDING",
    "handoff_sent": false
  }
}
```

**Módulo:** `argos/conversationSnapshot.js` — lee V3 state + legacy ai_state unificado.

---

## E.6 `argosNoWriteSupabase` — bloqueo ampliado

**Tablas / operaciones bloqueadas (INSERT/UPDATE/DELETE/RPC mutante):**

| Recurso | Motivo |
|---------|--------|
| `contacts`, `leads` | CRM writes |
| `conversations`, `conversation_messages` | Persistencia chat |
| `conversation_events` | Side-effect auditoría |
| `notifications`, `notification_*` | No notificar agentes reales |
| `opportunities`, `opportunity_*` | No crear pipeline |
| `assignment_logs`, `agent_*` mutaciones | Side-effect asignación |
| RPC `assign_*`, `create_*_request`, `resolve_assignment_for_request` | Si persisten — **mock return** o throw `ARGOS_SIDE_EFFECT_BLOCKED` |
| Cualquier `.from('requests')` | Prohibido |

**RPC de solo lectura permitidas:** SELECT properties, contacts, leads para preview.

**Funciones side-effect en Node (bloquear por inyección):**

- `saveConversationEvent` → noop en ARGOS
- `updateConversationMeta` → noop
- Notification dispatchers → noop

---

## E.7 Test obligatorio: preview parity

**Archivo:** `test/argosPreviewParity.test.js`

**Método:**

1. Mismo fixture: ai_state CRM-ready, phone, property mock.
2. Ejecutar `_planContact` + `_planLead` vía `previewCrmPipeline`.
3. Ejecutar `ensureContactForConversationCore` + `createOrReuseLeadFromConversation` con **mock Supabase** (captura intentos write).
4. Comparar decisión normalizada:

```javascript
{
  contactAction,      // create | reuse
  leadAction,
  lead_type,
  operation,
  interested_property_id,
  assignment_strategy,
  assigned_agent_profile_id,
  ownership_rule,
}
```

**Assert:** objetos iguales; única diferencia permitida: preview sin `id` persistido.

**CI:** incluir en `npm run test:argos` y gate PR ARGOS-1.

---

## E.8 Health endpoint extendido

**GET `/internal/argos/health`**

**Response 200:**

```json
{
  "ok": true,
  "argos_enabled": true,
  "v3_enabled": true,
  "crm_execute": false,
  "crm_dry_run": true,
  "environment": "qa",
  "openai_available": true,
  "supabase_available": true,
  "build_sha": "abc1234",
  "version": "1.0.0-argos",
  "limits": {
    "max_turns_per_scenario": 30,
    "scenario_timeout_ms": 120000
  }
}
```

| Campo | Fuente |
|-------|--------|
| `openai_available` | `!!process.env.OPENAI_API_KEY` + optional ping deshabilitado en deterministic |
| `supabase_available` | `SELECT 1` ligero o `from('properties').limit(1)` |
| `build_sha` | `process.env.RAILWAY_GIT_COMMIT_SHA` \|\| `GIT_SHA` \|\| `"local"` |
| `version` | `package.json` version + `-argos` |

**401/403** si secret requerido incluso en health (configurable `ARGOS_HEALTH_PUBLIC=false` default false).

---

## E.9 Protección WhatsApp (assertion dura)

**En `services/perseoAutomatedWhatsApp.js` (inicio de función):**

```javascript
if (rawPayload?.argosMode === true || rawPayload?.perseo_metadata?.argos_mode === true) {
  const err = new Error('ARGOS_WHATSAPP_BLOCKED');
  err.code = 'ARGOS_WHATSAPP_BLOCKED';
  throw err;
}
```

**En `processInboundForArgos`:** nunca invocar `sendPerseoAutomatedWhatsApp`; pasar `skipWhatsAppSend: true` en contexto.

**Test:** `test/argosWhatsAppBlocked.test.js` — llamada directa con `argosMode` → throw.

**Trace:** si se intenta, `debug_trace` → `whatsapp_blocked`.

---

## E.10 Orden de entrega actualizado

```
1. Colección Postman ARGOS-1 (contrato congelado)     ← ANTES de código
2. ARGOS-0 (ATENA UI)
3. ARGOS-1 (PERSEO) según plan + Parte E
4. Gate → ARGOS-2 (tablas argos_*)
```

**Colección:** `docs/argos/postman/ARGOS-1-Internal-API.postman_collection.json`

---

*Plan v1.2 listo para implementación. No autoriza cambios de esquema ni deploy a producción sin checklist de aceptación.*
