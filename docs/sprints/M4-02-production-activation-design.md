# M4-02 — Production Activation & Hardening (diseño técnico)

**Rama:** `feat/m4-02-production-activation`  
**Base:** `main` (post M4-01 merge)  
**Estado:** **diseño para aprobación** — sin implementación ni `supabase db push` hasta confirmación explícita

---

## 0. Objetivo

Convertir la **foundation M4-01** en valor operativo en **staging primero**, con rollout gradual por flags y rollback documentado. Prod solo tras gates de smoke.

```txt
M4-01 (foundation, flags OFF, memory fallback)
        ↓
M4-02 (staging activation: DB + worker + webhook + telemetry + runbook)
        ↓
Prod gradual (allowlist → flags ON por capa)
```

---

## 1. Proyecto Supabase y alcance de migraciones

### 1.1 ¿Dónde viven las tablas?

| Artefacto | Repo | Proyecto Supabase |
|-----------|------|-------------------|
| `contacts`, `leads`, `conversations` | ATENA (DDL histórico) + PERSEO (runtime) | **Proyecto compartido Luxetty** (mismo `SUPABASE_URL` en Railway) |
| `crm_outbox`, `wa_operational_telemetry` | PERSEO `supabase/migrations/` | **Mismo proyecto** — tablas operativas PERSEO |

**Confirmación requerida antes de aplicar:** DBA confirma que `supabase db push` / migración se ejecuta contra el proyecto correcto (staging vs prod).

### 1.2 Impacto

| Aspecto | Impacto |
|---------|---------|
| Nuevas tablas | 5 tablas PERSEO-operativas; **no** alteran `contacts`/`leads` |
| RLS | Solo `service_role`; PERSEO webhook ya usa service role |
| Tamaño | Bajo inicial; crecimiento en `crm_execution_logs` y `wa_operational_telemetry` |
| Downtime | `CREATE TABLE` — sin lock en tablas CRM existentes |

### 1.3 Rollback SQL (orden)

```sql
DROP TABLE IF EXISTS crm_dead_letters;
DROP TABLE IF EXISTS crm_execution_logs;
DROP TABLE IF EXISTS crm_idempotency_keys;
DROP TABLE IF EXISTS crm_outbox;
DROP TABLE IF EXISTS wa_operational_telemetry;
```

**Nota:** rollback destruye audit trail; exportar DLQ antes si hay jobs pendientes.

---

## 2. Migraciones revisadas (M4-01 → M4-02 hardened)

Archivos actuales: `20260519120000_m4_crm_runtime_outbox.sql`, `20260519121000_m4_wa_operational_telemetry.sql`.

### 2.1 Cambios propuestos al SQL (antes de aplicar)

#### `crm_outbox`

| Tema | M4-01 | M4-02 propuesto |
|------|-------|----------------|
| Worker poll | Índice parcial OK | Añadir índice `(status, scheduled_at) WHERE status IN ('pending','failed')` — ya existe |
| Lock | `locked_at`, `locked_by` | Añadir `lock_expires_at timestamptz` para reclaim stale locks |
| Backoff | Solo `scheduled_at` | Usar `scheduled_at = now() + backoff(attempts)` en retry |
| Status | `dead_letter` en CHECK | Mantener; DLQ también en `crm_dead_letters` |

```sql
-- Añadir a crm_outbox:
lock_expires_at timestamptz,
next_attempt_at timestamptz NOT NULL DEFAULT now()
-- Índice worker:
CREATE INDEX idx_crm_outbox_worker_poll
  ON crm_outbox (next_attempt_at)
  WHERE status IN ('pending', 'failed');
```

#### `crm_idempotency_keys`

- OK como está: `UNIQUE (conversation_id, idempotency_key)`.
- Añadir índice por `completed_at` para housekeeping futuro (opcional M4-02).

#### `crm_execution_logs`

- OK; retención 90d vía job futuro (fuera M4-02, documentar en runbook).

#### `crm_dead_letters`

- OK; enlace `outbox_id` ON DELETE CASCADE.

#### `wa_operational_telemetry`

| Tema | M4-02 propuesto |
|------|----------------|
| Particionado | No en M4-02 (YAGNI) |
| Índices | `(conversation_id, created_at DESC)` — existe |
| Payload | `metadata jsonb` — OK |

### 2.2 RLS

Mantener **service_role only**. Verificar que Railway PERSEO usa `SUPABASE_SERVICE_ROLE_KEY`, no anon.

### 2.3 Procedimiento de aplicación (staging)

1. Backup snapshot / confirmar proyecto staging.
2. `supabase migration list` — sin drift crítico.
3. Aplicar solo migraciones `20260519*_m4_*`.
4. Probe: `SELECT 1 FROM crm_outbox LIMIT 0;`
5. Smoke PERSEO con flags OFF (sin writes).
6. Smoke con flags ON en allowlist 1 conversación.

**⚠️ NO aplicar en prod en el mismo PR que el código.**

---

## 3. CRM worker — diseño

### 3.1 Problema M4-01

`executeV3CrmWithRuntime` procesa el job **en el mismo request** que el webhook. Eso:

- No escala multi-instancia,
- Bloquea respuesta WA,
- No es un outbox pattern real.

### 3.2 Arquitectura M4-02

```txt
Webhook / ARGOS
    │
    ├─► enqueue crm_outbox (status=pending)  [rápido]
    │
    └─► respuesta al usuario (sin esperar CRM execute)

Worker (mismo proceso o script cron)
    │
    ├─► claim batch (FOR UPDATE SKIP LOCKED / RPC)
    ├─► evaluateV3CrmExecutionGate + dry-run / execute
    ├─► mark completed → idempotency_keys
    └─► on fail → backoff o dead_letter
```

### 3.3 Módulos nuevos

| Archivo | Rol |
|---------|-----|
| `conversation/v3/runtime/crmOutboxWorker.js` | `pollCrmOutbox`, `claimJobs`, `processJob`, backoff |
| `conversation/v3/runtime/crmRuntime.js` | **Cambio:** enqueue-only en request path cuando `PERSEO_CRM_WORKER_ASYNC=true` |
| `scripts/crm-outbox-worker.js` | CLI: `node scripts/crm-outbox-worker.js --once` o loop |
| `index.js` (opcional) | `setInterval` en proceso Railway si `PERSEO_CRM_WORKER_ENABLED=true` |

### 3.4 Flag nuevo (M4-02)

| Variable | Default | Significado |
|----------|---------|-------------|
| `PERSEO_CRM_WORKER_ASYNC_ENABLED` | `false` | Request path solo enqueue; worker ejecuta |
| `PERSEO_CRM_WORKER_POLL_MS` | `5000` | Intervalo poll en proceso |
| `PERSEO_CRM_WORKER_BATCH_SIZE` | `5` | Jobs por tick |

Sin flag async: comportamiento M4-01 (sync en request) para compatibilidad ARGOS/tests.

### 3.5 Claim / lock

```sql
-- Patrón claim (en store DbCrmRuntimeStore):
UPDATE crm_outbox
SET status = 'processing',
    locked_at = now(),
    locked_by = $worker_id,
    lock_expires_at = now() + interval '120 seconds'
WHERE id IN (
  SELECT id FROM crm_outbox
  WHERE status IN ('pending', 'failed')
    AND next_attempt_at <= now()
    AND (locked_at IS NULL OR lock_expires_at < now())
  ORDER BY next_attempt_at
  LIMIT $batch
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

### 3.6 Retry / backoff

| Intento | Backoff |
|---------|---------|
| 1 | inmediato |
| 2 | +30s |
| 3 | +2min |
| ≥ max | `crm_dead_letters` + status `dead_letter` |

### 3.7 Dry-run y gates

Worker llama **misma** `executeV3CrmIfEligibleImpl` con:

- `crmDryRun` según env / gate preview,
- `PERSEO_V3_CRM_EXECUTE` sin cambios,
- ARGOS: nunca worker real contra prod DB CRM (tests usan memory store).

### 3.8 Suite `crm-worker-p0` (8 escenarios)

| ID | Tema |
|----|------|
| CRMW_001 | Enqueue async; worker no run → pending |
| CRMW_002 | Worker claim + dry-run complete |
| CRMW_003 | Idempotency skip segundo job |
| CRMW_004 | Retry tras fail transitorio (mock) |
| CRMW_005 | Dead letter max attempts |
| CRMW_006 | Stale lock reclaim |
| CRMW_007 | Collision unique key |
| CRMW_008 | must_not writes ARGOS |

---

## 4. Webhook media real — diseño

### 4.1 Estado actual

- `inboundMediaStorageIngest` descarga a Storage (flag `PERSEO_INBOUND_MEDIA_STORAGE_ENABLED`).
- `v3InboundBridge.tryV3PrimaryReply` recibe `media: { type }` sin buffer.
- `mediaProduction.js` + `resolveMediaForIntakeAsync` existen pero **no** se invocan en webhook.

### 4.2 Pipeline propuesto

```txt
WhatsApp message (audio/image/document)
    │
    ├─► [existente] scheduleInboundMediaIngest → Storage (async)
    │
    └─► [M4-02] buildInboundMediaForV3(message, storageRef?)
            │
            ├─► download buffer (Graph o Storage) si PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED
            ├─► resolveMediaForIntakeAsync (transcribe / vision / extract)
            └─► media object → v3InboundBridge → processV3Turn
```

### 4.3 Módulo nuevo

`services/inboundMediaV3Bridge.js`:

| Función | Descripción |
|---------|-------------|
| `buildV3MediaFromWhatsAppMessage` | Mapea WA type → `{ kind, mime_type, audio_buffer, ... }` |
| `resolveInboundMediaForV3Turn` | Async; timeout budget 8s audio / 12s image |
| `attachMediaToV3Try` | Wrapper usado en `index.js` antes de `tryV3PrimaryReply` |

### 4.4 Timeouts y fallback

| Tipo | Timeout | Fallback |
|------|---------|----------|
| Audio | 8s | `no_transcript` + copy honesto |
| Imagen | 12s | `illegible` o hints non-authoritative |
| PDF/doc | 5s extract | `document_no_text` |

Si timeout: responder texto sin bloquear webhook >20s total.

### 4.5 Flag

`PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED` (M4-01) — en staging ON solo allowlist.

Opcional M4-02: `PERSEO_MEDIA_RUNTIME_TIMEOUT_MS`.

### 4.6 Suite `webhook-media-p0` (8 escenarios)

| ID | Tema |
|----|------|
| WHM_001 | Audio simulate → logical_turn transcript |
| WHM_002 | Audio low confidence |
| WHM_003 | Image + caption |
| WHM_004 | Image illegible |
| WHM_005 | PDF extract |
| WHM_006 | Provider timeout → fallback |
| WHM_007 | must_not invent price |
| WHM_008 | Flags OFF → text only path |

ARGOS: buffers inyectados en scenario turn (sin Graph).

---

## 5. Telemetry operativa — diseño

### 5.1 M4-01

- Sync record en `applyM4RuntimeFinishing`.
- DB: fire-and-forget async si tabla existe.
- ARGOS: `memory_argos` only.

### 5.2 M4-02 mejoras

| Mejora | Detalle |
|--------|---------|
| Sync insert opcional | `PERSEO_WA_TELEMETRY_SYNC_INSERT=true` en staging para debug |
| Batch buffer | Opcional: queue en memoria, flush cada N s (M4-02.1 si retrasa) |
| Campos | Mapear `humanity_score` desde `lastResilienceRuntime` + `lastHumanityTone` |
| CRM result | Post worker: evento `crm_worker_result` |

### 5.3 Suite `wa-telemetry-runtime-p0` (6 escenarios)

| ID | Tema |
|----|------|
| TELR_001 | Flag ON + memory_argos |
| TELR_002 | policy_hit captured |
| TELR_003 | media_processed |
| TELR_004 | crm_execution_result after worker mock |
| TELR_005 | fallback_reason |
| TELR_006 | Flags OFF → no DB insert |

---

## 6. Rollout flags — runbook

Ver documento operativo: [`docs/runbooks/M4-02-production-activation.md`](../runbooks/M4-02-production-activation.md)

Orden de activación staging:

1. Aplicar migraciones (gate explícito).
2. Deploy código M4-02 (todos flags OFF).
3. `PERSEO_WA_TELEMETRY_ENABLED=true` (allowlist).
4. `PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=true` (allowlist).
5. `PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true` + worker async OFF (sync validate).
6. `PERSEO_CRM_WORKER_ASYNC_ENABLED=true` + worker process ON.
7. Understanding/resilience/policy M4 según necesidad (ya en M4-01).

Criterio abort: error rate DLQ > 5%, duplicados CRM, latencia p95 webhook >25s.

---

## 7. WhatsApp real smoke — paquete piloto

Ruta: `docs/argos/whatsapp-smoke/m4-02/`

| Archivo | Contenido |
|---------|-----------|
| `allowlist-10.yaml` | 10 conversaciones piloto (IDs, carril, objetivo) |
| `checklist-m4-02.yaml` | H1–H5 + M1–M3 + T1–T3 (telemetry) + C1 (CRM) |
| `runs/TEMPLATE.md` | Formato de corrida |
| `success-criteria.md` | 8/10 humanity ≥4/5, 0 críticos |

**Meta:** 8/10 ≥4/5 HUMANITY, 0 inventos, 0 duplicados CRM, 0 loops, 0 media sin fallback.

Suite ARGOS `wa-real-smoke-p0`: 6 escenarios sintéticos que reflejan hallazgos típicos (no sustituye las 10 reales).

---

## 8. Escenarios ARGOS M4-02 (30 total)

| Suite | # | IDs |
|-------|---|-----|
| `crm-worker-p0` | 8 | CRMW_001–008 |
| `webhook-media-p0` | 8 | WHM_001–008 |
| `wa-telemetry-runtime-p0` | 6 | TELR_001–006 |
| `rollout-flags-p0` | 4 | ROL_001–004 |
| `wa-real-smoke-p0` | 6 | WRS_001–006 |
| **Total** | **32** | ≥25 ✓ |

`rollout-flags-p0`: verifica snapshot `crm_runtime_mode`, `telemetry_mode`, flags OFF path, probe fallback.

---

## 9. Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Migración en prod equivocado | Alta | Solo staging primero; checklist proyecto |
| Worker doble claim multi-instancia | Media | SKIP LOCKED + lock_expires |
| Webhook lento por media | Alta | Timeouts + async ingest paralelo |
| Duplicar lead | Alta | Idempotency keys + gates existentes |
| Telemetry volume | Baja | Retención futura; índices |
| DOCX/PDF sin parser | Baja | Fallback honesto (fuera scope parser real salvo quick win) |

---

## 10. Rollback

| Nivel | Acción |
|-------|--------|
| Código | Revert PR; flags OFF |
| Runtime | `PERSEO_CRM_WORKER_ASYNC_ENABLED=false` |
| DB | SQL rollback §1.3 (solo si se aplicó) |
| Datos | Export DLQ antes de DROP |

---

## 11. Staging-only vs prod gradual

| Capacidad | Staging | Prod gradual |
|-----------|---------|--------------|
| Migraciones aplicadas | ✅ Primero | Después de 1 semana staging OK |
| Worker async | ✅ | Tras validar DLQ=0 anómalo |
| Media real | ✅ Allowlist 5 números | +10 → +50 → all allowlist |
| Telemetry DB | ✅ | Tras revisar volumen |
| CRM execute real | Solo si `CRM_EXECUTE=true` + gate | Mismo, muy restrictivo |
| WhatsApp smoke 10 | ✅ Obligatorio pre-prod | Repetir post-deploy |

---

## 12. Qué queda listo tras M4-02 (expectativa)

| Listo staging | Listo prod gradual | Sigue foundation |
|---------------|-------------------|------------------|
| Outbox DB + worker | Tras flags + smoke | ARGOS-2 UI |
| Webhook media wired | Tras allowlist media | Dashboards |
| Telemetry en DB | Tras flag telemetry | OCR avanzado |
| Runbook | Ops playbook | Auto-promote learning |
| 32 escenarios ARGOS | CI gate | release-p2 masivo |

---

## 13. Plan de implementación (post-aprobación)

1. Migraciones hardened (nuevo revision `20260520*_m4_*` o amend — **no apply**).
2. `crmOutboxWorker` + flags async.
3. `inboundMediaV3Bridge` + `index.js` wiring.
4. Telemetry sync option + worker hook.
5. Runbook final + whatsapp-smoke/m4-02 pack.
6. 32 escenarios + 5 suites + tests.
7. Regresión completa + PRE_PR_M4_02.
8. **Gate humano:** aplicar migraciones staging.
9. Smoke manual 10 pláticas.
10. PR merge → prod rollout por runbook.

---

## 14. Aprobación requerida

- [ ] Proyecto Supabase staging confirmado
- [ ] SQL revisado (§2)
- [ ] Worker async design OK
- [ ] Webhook media design OK
- [ ] Autorización para **aplicar migraciones en staging** (paso separado del merge)
