# M4-04 — Staging Activation & Runtime Verification (diseño)

**Rama:** `feat/m4-04-staging-activation-runtime-verification`  
**Base:** `main` (post M4-03 merge)  
**Estado:** diseño + checklist — **sin aplicar staging hasta confirmación explícita**

---

## 0. Cambio de fase

| Antes (M4-01 → M4-03) | M4-04 |
|----------------------|-------|
| Foundation en código | **Activación real en staging** |
| ARGOS sintético 110+ | **Evidencia operativa + smoke WA real** |
| Flags OFF, SQL propuesto | **Flags ON por fases, SQL aplicado en staging** |
| Teoría de recovery | **Verificación heartbeat, DLQ, replay, duplicados** |

**M4-04 no añade features grandes.** Entrega activación, scripts de verificación, smoke real y reporte GO/NO-GO prod.

---

## 1. Objetivo

Activar y verificar en **staging** todo lo construido en M4-02 + M4-03:

1. Migraciones DB staging.
2. Worker Railway dedicado operativo.
3. Flags por fases (4 fases).
4. Replay real (`RPACK_001` + pilotos).
5. Telemetry operativa en DB/logs.
6. CRM durability (outbox, worker, idempotency).
7. Media runtime + hardening + fail-open.
8. Smoke WhatsApp 10 pilotos.
9. Validación anti-duplicación CRM.
10. Decisión documentada **GO / NO-GO** para preparar prod rollout.

---

## 2. Prerrequisitos

| Requisito | Verificación |
|-----------|--------------|
| M4-03 mergeado en `main` | CI green |
| PERSEO staging deploy = `main` | Railway revision actual |
| Acceso Supabase **staging** | URL + service role |
| Railway: 2 servicios | Webhook HTTP + CRM worker |
| Allowlist WA staging | `docs/argos/whatsapp-smoke/m4-02/allowlist-10.yaml` |
| `gh`/ops autoriza ventana | Checklist firmado |

---

## 3. Migraciones staging (SOLO staging)

### 3.1 Orden de aplicación

| # | Archivo | Tablas |
|---|---------|--------|
| 0 | `20260519121000_m4_wa_operational_telemetry.sql` | Si **no** existe aún `wa_operational_telemetry` |
| 1 | `20260520000000_m4_02_crm_runtime_hardened.sql` | `crm_outbox`, `crm_idempotency_keys`, `crm_execution_logs`, `crm_dead_letters` |
| 2 | `20260521120000_m4_03_runtime_metrics.sql` | `runtime_metrics_rollup`, `crm_worker_heartbeats` |

**Nota:** Si M4-01 CRM SQL ya se aplicó parcialmente, usar path ALTER documentado en `README-M4-02.md` — no duplicar tablas.

### 3.2 Pre-flight (obligatorio)

```txt
□ SUPABASE_URL = proyecto STAGING (verificar ref en dashboard)
□ Snapshot: contacts, leads, conversations, crm_* (si existen)
□ Rollback SQL impreso y probado en clone
□ Confirmación escrita: "AUTORIZADO aplicar M4-04 staging migrations"
□ Prod URL distinta — doble check env Railway staging
```

### 3.3 Post-apply validation

```sql
-- Tablas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'crm_outbox','crm_idempotency_keys','crm_execution_logs','crm_dead_letters',
    'wa_operational_telemetry','runtime_metrics_rollup','crm_worker_heartbeats'
  );

-- Índices worker
SELECT indexname FROM pg_indexes WHERE tablename = 'crm_outbox';

-- RLS
SELECT tablename, policyname FROM pg_policies
WHERE tablename LIKE 'crm_%' OR tablename LIKE 'wa_operational%' OR tablename LIKE 'runtime_%';

-- Flags OFF: cero filas nuevas en 10 min (solo probe)
-- (medir antes/después de deploy OFF)
```

Scripts: `node scripts/m4-probe-runtime-tables.js`, `node scripts/staging-verify-db.js` (M4-04).

### 3.3 Rollback

Ver `docs/runbooks/M4-04-staging-activation-checklist.md` § Rollback.

---

## 4. Railway worker

### 4.1 Servicio dedicado

| Servicio | Comando | Env mínimos |
|----------|---------|-------------|
| `perseo-webhook` | `node index.js` | Sin worker flags |
| `perseo-crm-worker` | `node workers/crmOutboxRailwayWorker.js` | Ver fase 2 |

Worker **no** comparte proceso con webhook.

### 4.2 Validaciones

| Check | Cómo |
|-------|------|
| Heartbeat | `crm_worker_heartbeats` o logs `crm_worker_heartbeat` |
| Polling | Logs cada `PERSEO_CRM_WORKER_POLL_MS` |
| Lock | `processing` + `locked_by` en outbox |
| Retry | Job failed → `next_attempt_at` futuro |
| DLQ | `crm_dead_letters` tras max attempts |
| Restart | Redeploy worker → locks reclaim |
| No poisoning | Mismo error 2× → freeze, no loop infinito |
| No duplicates | SQL idempotency + 0 duplicate leads en pilotos |

---

## 5. Activación por fases (staging)

### Fase 0 — Deploy código, flags OFF (30 min)

- Deploy `main` en staging.
- Todas las flags M4 = `false`.
- Regresión local completa (ver §8).
- Probe DB post-migración.

### Fase 1 — Observability (24h)

```env
PERSEO_RUNTIME_OBSERVABILITY_ENABLED=true
PERSEO_WA_TELEMETRY_ENABLED=true
```

Validar: inserts `wa_operational_telemetry`, logs `runtime_health`, sin errores RLS.

### Fase 2 — CRM worker (24–48h)

```env
PERSEO_CRM_DURABILITY_ENABLED=true
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true
PERSEO_CRM_WORKER_ASYNC_ENABLED=true
PERSEO_CRM_WORKER_PROCESS_ENABLED=true
PERSEO_CRM_WORKER_ASYNC_ENABLED=true
```

`PERSEO_V3_CRM_EXECUTE` — **solo** si negocio autoriza en staging (recomendado: dry-run / preview primero).

Validar: outbox enqueue, worker process, heartbeat, no DLQ anómalo.

### Fase 3 — Media (allowlist 3–5 números, 24h)

```env
PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=true
PERSEO_MEDIA_HARDENING_ENABLED=true
PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED=true
PERSEO_MEDIA_REAL_V1_ENABLED=true
PERSEO_MEDIA_INTAKE_V1_ENABLED=true
```

Validar: audio/imagen en allowlist, fallback en timeout, no inventos.

### Fase 4 — Safety + replay (12h)

```env
PERSEO_RUNTIME_SAFETY_ENABLED=true
PERSEO_REPLAY_ENGINE_ENABLED=true
```

Validar: `node scripts/staging-replay-pack.js RPACK_001`, flood no rompe webhook.

---

## 6. Staging verification (scripts / suites)

M4-04 añade **scripts operativos** (no 80 escenarios ARGOS nuevos):

| Script / suite | Propósito |
|----------------|-----------|
| `scripts/staging-verify-db.js` | Tablas, índices, RLS probe |
| `scripts/staging-crm-worker-smoke.js` | Enqueue test job dry-run |
| `scripts/staging-telemetry-smoke.js` | Insert + read telemetry |
| `scripts/staging-replay-pack.js` | Run RPACK_001 against staging URL |
| `scripts/staging-crm-duplicate-check.js` | SQL duplicate detection |
| `scripts/staging-runtime-health.js` | Dump `buildRuntimeHealthSnapshot` |

Suites documentales (checklist PASS/FAIL):

- `staging-runtime-p0`
- `staging-crm-worker-p0`
- `staging-media-p0`
- `staging-telemetry-p0`
- `staging-replay-p0`

Cada suite = checklist ejecutable + evidencia en reporte.

---

## 7. WhatsApp smoke real (10 pilotos)

Ruta: `docs/argos/whatsapp-smoke/m4-02/`

Registrar con `run-record-schema.yaml` → `runs/YYYY-MM-DD-staging-m4-04.md`

| Meta | Umbral |
|------|--------|
| HUMANITY | ≥8/10 con ≥4/5 |
| Duplicados CRM | 0 |
| Inventos críticos | 0 |
| Loops | 0 |
| Media sin fallback | 0 |
| Jobs perdidos | 0 |

---

## 8. Regresión obligatoria (pre-staging)

Ejecutar en local/CI **antes** de tocar staging:

```bash
npm run test:argos      # 60 suites incl. M4-01/02/03
npm run test:perseo
npm run test:corpus
npm run corpus-validate
npm test                # documentar 13 legacy fail
```

Suites ARGOS existentes: release-p0, release-p1, policy-p0, cross-intent-p0, media-p0, whatsapp-smoke, wa-hardening-p0, media-real-p0, resilience-p0, humanity-wave2-p0, crm-execute-p0, crm-runtime-p0, media-runtime-p0, crm-worker-p0, webhook-media-p0, wa-telemetry-runtime-p0, rollout-flags-p0, wa-real-smoke-p0, + M4-03 8 suites.

---

## 9. Reporte final

`docs/argos/STAGING_ACTIVATION_M4_04_REPORT.md` — plantilla en repo.

Decisión:

- **GO** — preparar M4-05 prod rollout plan.
- **NO-GO** — bugs listados, flags rollback, no prod.

---

## 10. Implementación M4-04 (código)

| Entregable | Tipo |
|------------|------|
| Scripts staging verify (6) | Código |
| Checklist ejecutable | Docs |
| Plantilla reporte | Docs |
| `docs/runbooks/M4-04-staging-activation-checklist.md` | Docs |
| Opcional: 5–10 escenarios ARGOS `staging-*-p0` dry-run | ARGOS |

**NO en M4-04:** aplicar migraciones desde CI, prod flags, dashboards.

---

## 11. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Migración en prod | Triple-check SUPABASE_URL |
| CRM execute real en staging | Gate negocio + allowlist |
| Whisper cost en media pilots | Allowlist corta |
| Worker doble deploy | Un solo servicio worker |
| Duplicados | Idempotency + SQL check post-smoke |

---

## 12. Timeline sugerido

```txt
D0: Regresión local + autorización migrations
D1: Apply SQL staging + deploy OFF + verify DB
D2: Fase 1 observability
D3–D4: Fase 2 CRM worker
D5: Fase 3 media allowlist
D6: Fase 4 safety + replay
D7: WA smoke 10 pilotos + reporte GO/NO-GO
```

---

## 13. Aprobación requerida

- [ ] Diseño M4-04 OK
- [ ] Autorización explícita aplicar migraciones **staging**
- [ ] Autorización activar flags por fase
- [ ] Autorización smoke WA 10 pilotos (números reales en allowlist)
