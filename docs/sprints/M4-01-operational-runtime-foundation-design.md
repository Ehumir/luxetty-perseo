# M4-01 — Operational Runtime Foundation (diseño técnico)

**Rama:** `feat/m4-01-operational-runtime-foundation`  
**Base:** `main` (M1 + M2 + M3 mergeados)  
**Estado:** diseño aprobado para implementación — **migraciones NO aplicadas** hasta revisión explícita

---

## 1. Objetivo

Pasar de **motor QA avanzado** a **runtime operativo persistente** preparado para producción real, sin romper flags OFF ni dry-run ARGOS.

| Pilar | Hoy (M3) | M4-01 target |
|-------|----------|--------------|
| CRM execute | Foundation in-memory | Outbox durable + logs + DLQ + idempotency DB |
| Media | Bridge + simulates ARGOS; prod unwired | Whisper/Vision/PDF wired con confidence + fallback |
| Understanding | Resilience heuristics | Chunking, fusion, threads, timeline, memory summary |
| Resilience | Multi-Q, interruption | Anti-loop score, confusion, escalation, recovery planner |
| Telemetry | `logEvent` / `conversation_events` ad hoc | Schema operativo WA unificado |
| Learning | Corpus MD/TXT/CSV/JSON; DOCX/PDF stub | DOCX/PDF real, clasificación, scenario candidates (no auto-promote) |
| Policy | JSON estático v1 | Runtime zones/colonias/montos/campañas/temporales/allowlists/idioma |

---

## 2. Arquitectura (capas)

```
WhatsApp / ARGOS inbound
        │
        ▼
┌───────────────────────────────────────┐
│  v3InboundBridge + index.js webhook   │
│  (media async, telemetry emit)        │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  understandingRuntime (M4)            │
│  chunk → fuse → thread → timeline     │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  v3Runtime (existing)                 │
│  + resilienceRuntime (M4)             │
│  + policyRuntime (M4)                 │
│  + humanity / media intake (M3)       │
└───────────────────────────────────────┘
        │
        ├──► waTelemetry.record(...)
        │
        └──► crmRuntime.execute(...)
                  │
                  ├─ flag OFF → legacy path
                  ├─ foundation only (M3) → in-memory
                  └─ persistent ON → crm_outbox worker
```

**Principio:** cada pilar detrás de flag M4; OFF = comportamiento actual idéntico.

---

## 3. Flags M4-01 (default `false`)

Archivo: `config/perseoM401Flags.js`

| Variable | Pilar |
|----------|--------|
| `PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED` | CRM outbox durable |
| `PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED` | Media real prod (async bridge + providers) |
| `PERSEO_UNDERSTANDING_RUNTIME_ENABLED` | Multi-message understanding |
| `PERSEO_RESILIENCE_RUNTIME_ENABLED` | Anti-loop, confusion, escalation, recovery |
| `PERSEO_WA_TELEMETRY_ENABLED` | Telemetría operativa WA |
| `PERSEO_LEARNING_RUNTIME_ENABLED` | Corpus DOCX/PDF + clasificación + candidates |
| `PERSEO_POLICY_RUNTIME_ENABLED` | Policy operativo extendido |

**Compatibilidad M3:** flags M2/M3 siguen independientes. ARGOS mapea flags M4 en `argos/deterministicMode.js` vía escenario JSON (`crm_runtime_persistent`, etc.).

**Prod rollout:** activar por flag + allowlist (`PERSEO_V3_QA_ALLOWLIST`) antes de global.

---

## 4. Migraciones propuestas (⚠️ NO APLICADAS)

Archivos en `supabase/migrations/` con prefijo `20260519*_m4_*`:

### 4.1 Por qué son necesarias

| Tabla | Motivo |
|-------|--------|
| `crm_outbox` | Cola durable multi-instancia; reemplaza `Map` in-process |
| `crm_execution_logs` | Audit trail queryable (compliance, debug prod) |
| `crm_idempotency_keys` | Evitar duplicar leads/contactos entre retries/restarts |
| `crm_dead_letters` | Jobs fallidos tras max retries; revisión manual |
| `wa_operational_telemetry` | Métricas operativas sin dashboard aún |

**Nota:** `contacts` / `leads` viven en schema ATENA compartido. Las tablas M4 son **operativas PERSEO** (outbox/telemetry), no duplican CRM core.

### 4.2 Rollback migraciones

```sql
DROP TABLE IF EXISTS crm_dead_letters;
DROP TABLE IF EXISTS crm_execution_logs;
DROP TABLE IF EXISTS crm_idempotency_keys;
DROP TABLE IF EXISTS crm_outbox;
DROP TABLE IF EXISTS wa_operational_telemetry;
```

Orden inverso por FKs. **Impacto:** con flag OFF el código no escribe estas tablas; rollback seguro si no se activó persistent CRM.

### 4.3 RLS / seguridad

- Service role only para worker PERSEO.
- Sin exposición a clientes anon/authenticated.
- Policies: `service_role` INSERT/UPDATE/SELECT; deny public.

### 4.4 Coordinación ATENA

Si el proyecto despliega migraciones solo desde `luxetty-atena`, **copiar SQL** allí con mismo timestamp o aplicar desde perseo si comparten Supabase project (actual).

**Acción requerida del equipo:** revisar SQL en PR antes de `supabase db push` / merge a prod.

---

## 5. Pilar 1 — CRM Execute persistente

### Módulos

| Archivo | Rol |
|---------|-----|
| `conversation/v3/runtime/crmOutboxStore.js` | CRUD outbox + idempotency + DLQ |
| `conversation/v3/runtime/crmOutboxWorker.js` | Poll, lock, retry, reconcile |
| `conversation/v3/crm/crmExecuteFoundation.js` | **Mantiene** fallback in-memory si persistent OFF |
| `conversation/v3/crm/crmExecutor.js` | Enruta: persistent → foundation → impl |

### Flujo

1. Gate existente (`evaluateV3CrmExecutionGate`) sin cambios.
2. Si `PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED`:
   - `enqueueCrmJob()` → `crm_outbox` (status `pending`).
   - Worker (sync en request o async job futuro) claim → `processing`.
   - Llama `executeV3CrmIfEligibleImpl` **una vez** por idempotency key.
   - Success → `completed` + row en `crm_idempotency_keys`.
   - Fail → retry hasta `max_attempts` → `crm_dead_letters`.
3. Cada transición → `crm_execution_logs`.
4. Collision: unique `(conversation_id, idempotency_key)` en outbox + idempotency table.

### No duplicación

- Misma fórmula `buildCrmIdempotencyKey` (M3).
- Before execute: `SELECT` idempotency_keys WHERE completed.
- Lead create sigue en `leadAutomation` con reuse logic existente.

### Suite `crm-runtime-p0` — 8 escenarios

| ID | Tema |
|----|------|
| CRMR_001 | Enqueue dry-run no write |
| CRMR_002 | Idempotency skip segundo execute |
| CRMR_003 | Retry tras fallo transitorio (simulated) |
| CRMR_004 | Dead letter tras max retries |
| CRMR_005 | Collision blocked |
| CRMR_006 | Reconciliation inconsistent state |
| CRMR_007 | Audit trail phases presentes |
| CRMR_008 | ARGOS must_not writes + queue status |

**ARGOS:** `crm_dry_run: true` por defecto; persistent layer usa Supabase mock o `createArgosNoWriteSupabase` + tablas in-memory test double.

---

## 6. Pilar 2 — Media real producción

### Módulos

| Archivo | Rol |
|---------|-----|
| `conversation/v3/runtime/mediaProduction.js` | Factory `transcribeFn` / `analyzeImageFn` / `extractDocumentFn` |
| `services/audioTranscriptionService.js` | **Existente** — reusar `transcribeAudio` |
| `services/imageVisionService.js` | **Existente** — reusar vision |
| `conversation/v3/media/mediaRealBridge.js` | **Existente** — `resolveMediaForIntakeAsync` |
| `corpus/parsers/pdfParser.js` / `docxParser.js` | Implementar extracción básica (learning overlap) |

### Wiring prod

`index.js` webhook path:

```js
const media = await resolveMediaForIntakeAsync(inboundMedia, {
  transcribeFn: mediaProduction.transcribeFromRef,
  analyzeImageFn: mediaProduction.analyzeFromRef,
  extractDocumentFn: mediaProduction.extractDocument,
});
```

### Reglas honestas

| Tipo | Real | Fallback |
|------|------|----------|
| Audio | OpenAI transcribe + confidence | `no_transcript`, no inventar texto |
| Imagen | Vision hints **non-authoritative** | `illegible`, sin precio/dirección/m² |
| PDF/DOCX | Text extract si parser ok | `extracted_text: null`, mensaje honesto |

### Suite `media-runtime-p0` — 8 escenarios

| ID | Tema |
|----|------|
| MRUN_001–002 | Audio high/low confidence |
| MRUN_003–004 | Image hints vs illegible |
| MRUN_005–006 | PDF extract vs empty |
| MRUN_007 | must_not invent listing/price |
| MRUN_008 | provider failure → fallback |

---

## 7. Pilar 3 — Multi-message understanding

### Módulo: `conversation/v3/runtime/understandingRuntime.js`

| Función | Descripción |
|---------|-------------|
| `chunkInboundMessages` | Split por longitud / pausa lógica |
| `fuseTurns` | Combinar burst corto en un logical turn |
| `updateTopicThread` | Compra vs venta vs renta threads |
| `buildIntentTimeline` | Secuencia intent por turn |
| `mergeEntityTracker` | Extiende M3 resilience tracker |
| `buildConversationMemorySummary` | Resumen compacto en state (max tokens) |

### State fields (v3)

```js
understanding: {
  chunks, fused_turn, threads[], intent_timeline[],
  memory_summary, last_fusion_at
}
```

### Suite `runtime-understanding-p0` — 10 escenarios

| ID | Tema |
|----|------|
| UNDR_001 | 5 mensajes cortos → slots completos |
| UNDR_002 | Mensaje largo compuesto (Jorge + Cumbres + venta + renta) |
| UNDR_003 | Thread dual compra/venta |
| UNDR_004 | Fusion sin perder nombre |
| UNDR_005 | Timeline intent order |
| UNDR_006 | Memory summary no vacío tras 4 turns |
| UNDR_007–010 | Edge: saludo, corrección, emoji-only, vacío |

---

## 8. Pilar 4 — Runtime resilience

### Módulo: `conversation/v3/runtime/resilienceRuntime.js`

| Señal | Uso |
|-------|-----|
| `anti_loop_score` | Repetición reply/slot (0–1) |
| `confusion_detected` | Contradicciones nombre/zona/presupuesto |
| `escalation_confidence` | Cuándo handoff humano |
| `recovery_plan` | Siguiente acción (re-ask, clarify, handoff) |
| `contradiction_flags` | budget vs zone mismatch |

Integración: patch en `v3Runtime` post-resilience M3 si `PERSEO_RESILIENCE_RUNTIME_ENABLED`.

### Suite `runtime-resilience-p0` — 8 escenarios

| ID | Tema |
|----|------|
| RESR_001 | Anti-loop trigger |
| RESR_002 | Confusion → clarify |
| RESR_003 | Escalation high → handoff hint |
| RESR_004 | Recovery tras interrupción |
| RESR_005 | Contradiction budget |
| RESR_006–008 | must_not repeat_reply / flow_restart |

---

## 9. Pilar 5 — WhatsApp production telemetry

### Módulo: `conversation/v3/runtime/waTelemetry.js`

```js
recordOperationalEvent({
  conversation_id, channel: 'whatsapp',
  policy_hit, handoff_quality, humanity_score,
  drop_reason, media_processed, crm_execution_result,
  fallback_reason, metadata
})
```

- Flag OFF: no-op (opcional debug log).
- Flag ON: insert `wa_operational_telemetry` + mirror `logEvent('wa_operational', ...)`.

Snapshot ARGOS: `telemetry_recorded`, `telemetry_policy_hit`, etc.

### Suite `wa-telemetry-p0` — 6 escenarios

| ID | Tema |
|----|------|
| TEL_001–006 | policy hit, handoff, humanity, drop, media, crm result |

---

## 10. Pilar 6 — Learning ingestion ampliado

### Módulos

| Archivo | Rol |
|---------|-----|
| `corpus/parsers/pdfParser.js` | `pdf-parse` o fallback stub honesto |
| `corpus/parsers/docxParser.js` | `mammoth` text extract |
| `corpus/learningRuntime.js` | classify, suggest scenarios, exploratory metadata |

### Reglas

- **NO auto-promote:** `suggestScenarioCandidates()` retorna JSON review-only.
- `corpus-validate` acepta PDF/DOCX con fixtures.
- Exploratory runs: metadata `exploratory: true`, `promoted: false`.

### Suite `learning-runtime-p0` — 6 escenarios

| ID | Tema |
|----|------|
| LRNG_001–004 | parse pdf/docx/fixture/classify |
| LRNG_005 | candidate suggestion sin write manifest |
| LRNG_006 | exploratory metadata |

---

## 11. Pilar 7 — Policy runtime operativo

### Config extendido: `config/policy/runtime-policy.v1.json`

```json
{
  "active_zones": [],
  "active_colonias": [],
  "amount_rules": [],
  "campaigns": [],
  "temporary_rules": [],
  "allowlists": { "phones": [], "conversation_ids": [] },
  "languages": ["es"],
  "version": 1,
  "effective_at": null
}
```

### Módulo: `conversation/v3/policy/policyRuntime.js`

- Carga bundle M2 + runtime overlay.
- Evalúa campañas/temporales antes de `PolicyEngine`.
- Preparado para UI (read-only API shape).

### Suite `policy-runtime-p0` — 8 escenarios

| ID | Tema |
|----|------|
| POLR_001–008 | zona activa, colonia, monto min, campaña, temporal, allowlist, idioma, decline |

---

## 12. Escenarios totales (54)

| Suite | Count |
|-------|-------|
| `crm-runtime-p0` | 8 |
| `media-runtime-p0` | 8 |
| `runtime-understanding-p0` | 10 |
| `runtime-resilience-p0` | 8 |
| `wa-telemetry-p0` | 6 |
| `learning-runtime-p0` | 6 |
| `policy-runtime-p0` | 8 |
| **Total M4-01** | **54** |

**manifest.json:** no modificar entradas release; suites M4 aisladas como M3.

---

## 13. ARGOS extensions

`argos/deterministicMode.js` — flags M4:

```js
crm_runtime_persistent, media_runtime_production, understanding_runtime,
resilience_runtime, wa_telemetry, learning_runtime, policy_runtime
```

`argos/conversationSnapshot.js` — campos:

```js
crm_outbox_status, understanding_fused, anti_loop_score,
telemetry_recorded, policy_runtime_rule_id, media_runtime_provider
```

`argos/scenarioRunner.js` — asserts nuevos en `expected`.

Tests: `test/argosM401Suites.test.js` (7 suites).

---

## 14. Simulado vs real

| Componente | ARGOS / flag OFF | Prod flag ON |
|------------|------------------|--------------|
| CRM execute | dry-run / preview / in-memory | Outbox DB + real execute si `CRM_EXECUTE` |
| Audio | `simulate_transcript` | `transcribeAudio` |
| Imagen | `simulate_hints` | `imageVisionService` |
| PDF | `simulate_text` | parser o fallback null |
| Understanding | passthrough single-turn | fusion + timeline |
| Telemetry | trace events only | DB insert |
| Learning | fixtures | real parsers |
| Policy | JSON v1 | runtime overlay |

---

## 15. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Migración en prod sin review | SQL en PR + README; no auto-apply |
| Duplicar leads | Idempotency DB + existing reuse |
| Hallucination media | hints non-authoritative + must_not |
| Latencia webhook | media async antes de V3; timeout budget |
| Worker multi-instance | `locked_at` + `locked_by` en outbox |
| Corpus auto-promote | API review-only |

---

## 16. Rollback

1. Flags M4 → `false` (inmediato).
2. Revert branch.
3. Si migraciones aplicadas: ejecutar rollback SQL §4.2 (ventana de mantenimiento).

---

## 17. Plan de implementación (orden)

1. ✅ Diseño (este doc) + flags + migraciones **propuestas**
2. CRM outbox store + worker + tests unitarios
3. Media production wiring + parsers
4. Understanding + resilience runtime
5. WA telemetry
6. Learning runtime + policy runtime
7. 54 escenarios + 7 suites + argos runner
8. Regresión completa + PRE_PR_M4_01_REPORT

---

## 18. Qué queda listo para prod vs foundation

| Listo prod (con flags + migraciones aplicadas) | Foundation (requiere follow-up) |
|-----------------------------------------------|--------------------------------|
| CRM outbox durable | Dashboard CRM queue |
| Telemetry DB | Dashboards WA |
| Media whisper/vision wired | OCR avanzado PDF escaneado |
| Policy runtime JSON | Policy UI ATENA |
| Understanding fusion | LLM summary memory |
| Learning classify/suggest | Auto-promote pipeline |

---

## 19. Regresión obligatoria (pre-PR)

Mismos comandos M3-02 + 7 suites M4 nuevas. Criterio: 0 delta fail en `npm test` flags OFF vs `main`.
