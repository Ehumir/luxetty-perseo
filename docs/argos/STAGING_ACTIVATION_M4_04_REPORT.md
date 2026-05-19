# Staging Activation Report — M4-04

**Entorno:** staging (`.env` local apunta a ref `pjoxytwsvbeoivppczdx` — confirmar nombre en dashboard)  
**Período:** 2026-05-19 → _en curso_  
**Operador:** agente M4-04 + revisión humana pendiente  
**Rama:** `feat/m4-04-staging-activation-runtime-verification`  
**Versión deploy Railway:** _pendiente — flags OFF hasta post-migración_

---

## 1. Resumen ejecutivo

| Área | Estado | Notas |
|------|--------|-------|
| Migraciones DB | **FAIL** | Tablas M4 ausentes en schema cache (migraciones no aplicadas aún) |
| Railway worker | **PENDIENTE** | Requiere deploy post-migración + Fase 2 flags |
| Fase 1 Observability | **PENDIENTE** | Scripts memoria OK; DB insert pendiente |
| Fase 2 CRM | **PENDIENTE** | Smoke memoria OK (`claimed:1`, `processed:1`) |
| Fase 3 Media | **PASS (local)** | Hardening + fail-open + timeout |
| Fase 4 Safety/Replay | **PASS (local)** | RPACK_001 — 3 turns, 0 violations |
| WA smoke 10 | **PENDIENTE** | Manual — `docs/argos/whatsapp-smoke/m4-02/` |
| **Decisión prod prep** | **NO-GO** | Bloqueado por migraciones + WA smoke |

**Prod:** confirmado **OFF** — ninguna activación prod en este sprint.

---

## 2. Migraciones aplicadas

| Archivo | Fecha | Proyecto Supabase ref | Estado |
|---------|-------|------------------------|--------|
| `20260519121000_m4_wa_operational_telemetry.sql` | — | `pjoxytwsvbeoivppczdx` | ☐ No aplicada |
| `20260520000000_m4_02_crm_runtime_hardened.sql` | — | idem | ☐ No aplicada |
| `20260521120000_m4_03_runtime_metrics.sql` | — | idem | ☐ No aplicada |

**Evidencia pre-apply (`staging-verify-db.js`):**

```json
{
  "crm_outbox": "Could not find the table 'public.crm_outbox' in the schema cache",
  "wa_operational_telemetry": "Could not find the table 'public.wa_operational_telemetry' in the schema cache",
  "runtime_metrics_rollup": "Could not find the table 'public.runtime_metrics_rollup' in the schema cache"
}
```

**Aplicar (solo tras confirmar dashboard = STAGING):**

```bash
# Supabase SQL Editor — en orden:
# 1. supabase/migrations/20260519121000_m4_wa_operational_telemetry.sql
# 2. supabase/migrations/20260520000000_m4_02_crm_runtime_hardened.sql
# 3. supabase/migrations/20260521120000_m4_03_runtime_metrics.sql

PERSEO_STAGING_CONFIRMED=true npm run staging:verify-db
```

**Validación post-apply:**

```txt
Tablas: crm_outbox, crm_idempotency_keys, crm_execution_logs, crm_dead_letters,
        wa_operational_telemetry, runtime_metrics_rollup, crm_worker_heartbeats
Índices worker: idx_crm_outbox_status_scheduled, idx_crm_outbox_worker_poll
RLS: verificar service_role + políticas en dashboard
```

---

## 3. Flags activados (por fase)

### Fase 1 — _pendiente deploy_

```env
PERSEO_RUNTIME_OBSERVABILITY_ENABLED=false
PERSEO_WA_TELEMETRY_ENABLED=false
```

### Fase 2 — _pendiente_

```env
PERSEO_CRM_DURABILITY_ENABLED=false
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=false
PERSEO_CRM_WORKER_ASYNC_ENABLED=false
PERSEO_V3_CRM_EXECUTE=false
```

### Fase 3 — _pendiente_

```env
PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=false
PERSEO_MEDIA_HARDENING_ENABLED=false
PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED=false
```

### Fase 4 — _pendiente_

```env
PERSEO_RUNTIME_SAFETY_ENABLED=false
PERSEO_REPLAY_ENGINE_ENABLED=false
```

---

## 4. Worker Railway

| Métrica | Valor |
|---------|-------|
| Heartbeat DB | _pendiente migración + worker deploy_ |
| Smoke memoria | `claimed: 1`, `processed: 1`, `reconcile.pending: 0` |
| DLQ count | _pendiente_ |
| Jobs perdidos | _pendiente_ |

---

## 5. Resultados scripts staging

| Script | Resultado | Modo |
|--------|-----------|------|
| `staging-media-smoke.js` | **PASS** | local |
| `staging-crm-worker-smoke.js` | **PASS** | memory |
| `staging-replay-smoke.js` | **PASS** | RPACK_001 |
| `staging-runtime-health.js` | **PASS** | memory |
| `staging-telemetry-smoke.js` | **PASS** | memory (DB insert skipped sin confirm) |
| `staging-verify-db.js` | **FAIL** | 0/7 tablas |
| `staging-duplicate-check.js` | **SKIP** | requiere migraciones + `PERSEO_STAGING_CONFIRMED=true` |

**Regresión local pre-staging:**

```txt
npm run test:argos → 60/60 PASS (254s)
```

---

## 6. Smoke WA — 10 pilotos

| # | Teléfono (mask) | Humanity /5 | Duplicado CRM | Invento crítico | Loop | Media fallback |
|---|-----------------|-------------|---------------|-----------------|------|----------------|
| 1 | _pendiente_ | | | | | |
| … | | | | | | |
| 10 | | | | | | |

**Criterio:** ≥8/10 con HUMANITY ≥4/5.

Plantilla: `docs/argos/whatsapp-smoke/m4-02/runs/TEMPLATE.md`

---

## 7. Duplicados CRM

| Check | Resultado |
|-------|-----------|
| Leads duplicados (7d) | _pendiente post-migración_ |
| Idempotency keys duplicadas | _pendiente_ |
| DLQ count | _pendiente_ |

---

## 8. Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Migraciones no aplicadas en staging | **Alta** | Aplicar orden aprobado; re-ejecutar `staging:verify-db` |
| `.env` local puede no ser staging nominal | **Media** | Verificar nombre proyecto dashboard antes de SQL |
| WA smoke manual no ejecutado | **Alta** | 10 pilotos con allowlist |
| Worker Railway sin deploy | **Media** | Deploy con flags OFF, luego Fase 2 |

---

## 9. Decisión GO / NO-GO

| Criterio | OK |
|----------|-----|
| Migraciones staging | ☐ |
| Worker heartbeat | ☐ |
| Telemetry DB | ☐ |
| Replay | ☑ (local) |
| Media fallback | ☑ (local) |
| Duplicate check | ☐ |
| 10 pilotos WA | ☐ |
| ≥8/10 humanity ≥4/5 | ☐ |
| 0 duplicados CRM | ☐ |
| 0 inventos críticos | ☐ |
| 0 loops / jobs perdidos | ☐ |

### **Decisión: NO-GO** (staging activation incompleta)

**Motivo:** migraciones M4 no presentes en Supabase conectado; smoke WA y worker Railway pendientes.

**Prod:** permanece **OFF**.

---

## 10. Próximos pasos (humano)

1. Confirmar proyecto Supabase = **STAGING** en dashboard.
2. Snapshot schema staging.
3. Aplicar las 3 migraciones en orden.
4. `PERSEO_STAGING_CONFIRMED=true npm run staging:all`
5. Deploy Railway staging — flags OFF → activar por fases (checklist).
6. Ejecutar smoke WA 10 pilotos y actualizar §6.
7. Re-evaluar GO/NO-GO.
