# M4-04 — Staging Activation Checklist (ejecución)

**Solo staging. NO prod.**  
**Ejecutor:** _______________ **Fecha inicio:** _______________

---

## A. Pre-regresión local (antes de tocar staging)

```bash
cd luxetty-perseo
npm run test:argos
npm run test:perseo
npm run test:corpus && npm run corpus-validate
npm test   # esperado: 763/776, 13 legacy
```

| Check | PASS | Notas |
|-------|------|-------|
| test:argos 60/60 | ☐ | |
| test:perseo 103/103 | ☐ | |
| corpus validate | ☐ | |
| npm test sin delta nuevo | ☐ | |

---

## B. Confirmación proyecto Supabase

| Check | PASS |
|-------|------|
| Dashboard proyecto = **STAGING** (nombre: ____________) | ☐ |
| `SUPABASE_URL` Railway staging coincide | ☐ |
| Prod URL **diferente** — verificado | ☐ |
| Snapshot/export realizado | ☐ |
| Autorización escrita migrations | ☐ |

**Export sugerido:**

```bash
# Ejemplo — ajustar connection string staging
pg_dump "$STAGING_DATABASE_URL" --schema-only -t crm_outbox -t contacts -t leads > backup-m4-04-schema.sql
```

---

## C. Migraciones (orden)

| # | Migración | Aplicada | Verificada |
|---|-----------|----------|------------|
| 0 | `20260519121000_m4_wa_operational_telemetry.sql` (si falta) | ☐ | ☐ |
| 1 | `20260520000000_m4_02_crm_runtime_hardened.sql` | ☐ | ☐ |
| 2 | `20260521120000_m4_03_runtime_metrics.sql` | ☐ | ☐ |

**Post-apply SQL:**

```sql
SELECT COUNT(*) FROM crm_outbox;
SELECT COUNT(*) FROM wa_operational_telemetry;
SELECT COUNT(*) FROM runtime_metrics_rollup;
SELECT COUNT(*) FROM crm_worker_heartbeats;
```

| Check | PASS |
|-------|------|
| 7 tablas existen | ☐ |
| Índice `idx_crm_outbox_worker_poll` existe | ☐ |
| RLS service_role policies | ☐ |
| Deploy staging flags **OFF** — sin writes anómalos 10 min | ☐ |

```bash
node scripts/m4-probe-runtime-tables.js
# Tras implementar M4-04:
node scripts/staging-verify-db.js
```

---

## D. Railway — servicios

| Servicio | Repo | Start command | PASS |
|----------|------|---------------|------|
| Webhook | perseo | `node index.js` | ☐ |
| CRM Worker | perseo | `node workers/crmOutboxRailwayWorker.js` | ☐ |

Worker env mínimos (Fase 2+):

```env
PERSEO_CRM_WORKER_PROCESS_ENABLED=true
PERSEO_CRM_WORKER_ASYNC_ENABLED=true
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true
PERSEO_CRM_DURABILITY_ENABLED=true
SUPABASE_URL=<staging>
SUPABASE_SERVICE_ROLE_KEY=<staging>
```

| Check | PASS |
|-------|------|
| Worker arranca sin exit 1 | ☐ |
| Logs `crm_worker_tick` visibles | ☐ |
| Heartbeat en DB o logs | ☐ |

---

## E. Flags por fase

### Fase 1 — Observability

```env
PERSEO_RUNTIME_OBSERVABILITY_ENABLED=true
PERSEO_WA_TELEMETRY_ENABLED=true
```

| Check | PASS | Fecha |
|-------|------|-------|
| Deploy Fase 1 | ☐ | |
| `wa_operational_telemetry` inserts OK | ☐ | |
| Logs `runtime_health` sin error | ☐ | |
| 24h sin incidentes | ☐ | |

### Fase 2 — CRM

```env
PERSEO_CRM_DURABILITY_ENABLED=true
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true
PERSEO_CRM_WORKER_ASYNC_ENABLED=true
```

| Check | PASS | Fecha |
|-------|------|-------|
| Outbox enqueue en conversación piloto | ☐ | |
| Worker completa o dry-run skip | ☐ | |
| DLQ count = 0 anómalo | ☐ | |
| Stuck recovery tras restart worker | ☐ | |
| Duplicate check SQL = 0 | ☐ | |

### Fase 3 — Media (allowlist)

```env
PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=true
PERSEO_MEDIA_HARDENING_ENABLED=true
PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED=true
PERSEO_MEDIA_REAL_V1_ENABLED=true
PERSEO_MEDIA_INTAKE_V1_ENABLED=true
```

| Check | PASS | Fecha |
|-------|------|-------|
| Audio piloto — transcript o fallback | ☐ | |
| Imagen piloto — hints o fallback | ☐ | |
| Sin invento precio/propiedad | ☐ | |

### Fase 4 — Safety + replay

```env
PERSEO_RUNTIME_SAFETY_ENABLED=true
PERSEO_REPLAY_ENGINE_ENABLED=true
```

| Check | PASS | Fecha |
|-------|------|-------|
| `node scripts/staging-replay-pack.js RPACK_001` | ☐ | |
| Flood no rompe webhook (burst test interno) | ☐ | |

---

## F. Staging verification suites (checklist)

| Suite | Script / acción | PASS |
|-------|-----------------|------|
| staging-runtime-p0 | `staging-runtime-health.js` | ☐ |
| staging-crm-worker-p0 | `staging-crm-worker-smoke.js` | ☐ |
| staging-media-p0 | Piloto media allowlist | ☐ |
| staging-telemetry-p0 | `staging-telemetry-smoke.js` | ☐ |
| staging-replay-p0 | `staging-replay-pack.js` | ☐ |

---

## G. WhatsApp smoke 10 pilotos

Plantilla: `docs/argos/whatsapp-smoke/m4-02/runs/YYYY-MM-DD-staging-m4-04.md`  
Schema: `run-record-schema.yaml`

| Piloto | HUMANITY 4/5 | Media | CRM | Duplicado | Loop |
|--------|--------------|-------|-----|-----------|------|
| 001 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 002 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 003 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 004 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 005 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 006 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 007 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 008 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 009 | ☐ | ☐ | ☐ | ☐ | ☐ |
| 010 | ☐ | ☐ | ☐ | ☐ | ☐ |

**Meta:** ≥8/10 humanity ≥4/5, 0 críticos, 0 duplicados, 0 loops, 0 media sin fallback.

---

## H. Duplicate CRM check (SQL staging)

```sql
-- Leads duplicados mismo contacto reciente (ajustar ventana)
SELECT contact_id, COUNT(*) AS n
FROM leads
WHERE created_at > now() - interval '7 days'
GROUP BY contact_id
HAVING COUNT(*) > 1;

-- Idempotency keys duplicados (no debería)
SELECT conversation_id, idempotency_key, COUNT(*)
FROM crm_idempotency_keys
GROUP BY conversation_id, idempotency_key
HAVING COUNT(*) > 1;
```

| Resultado | PASS |
|-----------|------|
| 0 filas duplicados anómalos | ☐ |

---

## I. Rollback

### Flags (inmediato)

```env
# Todas PERSEO_* M4 = false o unset
```

### SQL (solo si crítico)

```sql
DROP TABLE IF EXISTS crm_dead_letters;
DROP TABLE IF EXISTS crm_execution_logs;
DROP TABLE IF EXISTS crm_idempotency_keys;
DROP TABLE IF EXISTS crm_outbox;
DROP TABLE IF EXISTS crm_worker_heartbeats;
DROP TABLE IF EXISTS runtime_metrics_rollup;
-- wa_operational_telemetry: evaluar si M4-01 ya en uso
```

Exportar DLQ antes: `SELECT * FROM crm_dead_letters;`

---

## J. Decisión final

| Veredicto | ☐ GO prod prep | ☐ NO-GO |
|-----------|----------------|---------|
| Firmado por | | Fecha |

Completar: `docs/argos/STAGING_ACTIVATION_M4_04_REPORT.md`
