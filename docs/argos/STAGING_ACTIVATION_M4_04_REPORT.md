# Staging Activation Report — M4-04

**Entorno:** Supabase staging (`project_ref: pjoxytwsvbeoivppczdx`)  
**Período:** 2026-05-19 → 2026-05-20  
**Operador:** M4-04 automated staging run + revisión humana pendiente (WA / Railway)  
**Rama:** `feat/m4-04-staging-activation-runtime-verification`  
**Evidencia JSON:** `docs/argos/evidence/m4-04/`

---

## 1. Resumen ejecutivo

| Área | Estado | Notas |
|------|--------|-------|
| Migraciones DB | **PASS** | 7/7 tablas; RLS write OK; heartbeat PK `worker_id` |
| `staging-verify-db` | **PASS** | Tras fix probe (ver §2) |
| Fases 0–4 scripts | **PASS** | `staging-execute-phases.js --phase=all` → `ok: true` |
| CRM DB pipeline | **PASS** | enqueue → claim → process → idempotency |
| Worker heartbeat DB | **PASS** | `crm_worker_heartbeats` upsert + read |
| Telemetry DB | **PASS** | insert + read + delete probe |
| Media / replay | **PASS** | local deterministic |
| Railway deploy | **PENDIENTE** | No `PERSEO_BASE_URL` staging en `.env` local |
| WA smoke 10 | **BLOQUEADO** | allowlist sin teléfonos reales |
| **Decisión M4-04 completa** | **NO-GO** | Infra staging OK; falta WA + Railway confirm |
| **Prod** | **OFF** | Sin cambios prod |

---

## 2. Diagnóstico `staging-verify-db` (resuelto)

### Síntoma inicial

```txt
FAIL — 7 tablas ausentes / crm_worker_heartbeats exists: false
```

### Causa raíz (confirmada, no schema cache stale)

| Hipótesis | Resultado |
|-----------|-----------|
| Schema cache stale | **Descartada** — tras SQL, 6 tablas respondían HEAD; solo heartbeats fallaba |
| Project mismatch | **Descartada** — mismo ref antes/después migración |
| Service role | **OK** — RLS write probe PASS |
| **Lectura incorrecta** | **CONFIRMADA** — probe usaba `select('id')` pero `crm_worker_heartbeats` tiene PK `worker_id`, no `id` |

Error PostgREST exacto:

```txt
column crm_worker_heartbeats.id does not exist
```

### Fix aplicado

1. `probeTable` / `probeTableDetailed` → `select('*', { count: 'exact', head: true })` (agnóstico de PK).
2. `staging-verify-db` → probes RLS, heartbeat upsert, outbox insert/poll.
3. **Bug adicional encontrado:** `isArgosOrDryContext` trataba `crmDryRun:true` como modo memoria → worker Railway no usaba DB. **Corregido** (solo `argosMode` / `PERSEO_ARGOS_ENABLED`).

### Re-run

```bash
PERSEO_STAGING_CONFIRMED=true npm run staging:verify-db
# exit 0 — 7/7 tablas, rls_telemetry_write.ok, heartbeat_table.ok, crm_outbox_poll.ok
```

---

## 3. Migraciones aplicadas

| Archivo | Estado | Verificado |
|---------|--------|------------|
| `20260519121000_m4_wa_operational_telemetry.sql` | Aplicada | `wa_operational_telemetry` count probe |
| `20260520000000_m4_02_crm_runtime_hardened.sql` | Aplicada | `crm_outbox` + índices |
| `20260521120000_m4_03_runtime_metrics.sql` | Aplicada | `runtime_metrics_rollup`, `crm_worker_heartbeats` |

---

## 4. Flags activados (ejecución por fases)

Scripts ejecutados con env acumulativo por fase (`staging-execute-phases.js`).

### Fase 1 — Observability

```env
PERSEO_RUNTIME_OBSERVABILITY_ENABLED=true
PERSEO_WA_TELEMETRY_ENABLED=true
```

| Check | Resultado |
|-------|-----------|
| `staging-telemetry-smoke` | PASS — memory + DB insert/read |
| `staging-runtime-health` | PASS — p95 webhook 42ms (probe) |

### Fase 2 — CRM

```env
PERSEO_CRM_DURABILITY_ENABLED=true
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true
PERSEO_CRM_WORKER_ASYNC_ENABLED=true
PERSEO_CRM_WORKER_PROCESS_ENABLED=true
PERSEO_V3_CRM_EXECUTE=false
```

| Check | Resultado |
|-------|-----------|
| `staging-crm-db-smoke` | PASS — mode `db`, claimed 1, processed 1 |
| `staging-worker-tick` | PASS — mode `db`, heartbeat persisted |
| `staging-duplicate-check` | PASS — 0 idempotency dupes; 0 lead dupes en ventana 48h |
| DLQ | 0 |
| Outbox pending | 0 post-smoke |

**Evidencia CRM DB (extracto):**

```json
{
  "mode": "db",
  "enqueue": { "enqueued": true },
  "worker_batch": { "claimed": 1, "processed": 1 },
  "heartbeat_db": { "metadata": { "claimed": 1, "processed": 1, "latency_ms": 1024 } },
  "outbox_pending_after": 0,
  "idempotency_rows": 1
}
```

### Fase 3 — Media

```env
PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=true
PERSEO_MEDIA_HARDENING_ENABLED=true
PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED=true
```

| Check | Resultado |
|-------|-----------|
| `staging-media-smoke` | PASS — oversized, bad_mime, corrupt_audio, timeout |

### Fase 4 — Safety + replay

```env
PERSEO_RUNTIME_SAFETY_ENABLED=true
PERSEO_REPLAY_ENGINE_ENABLED=true
```

| Check | Resultado |
|-------|-----------|
| `staging-replay-smoke` | PASS — RPACK_001, 3 turns, 0 violations |
| Flood (unit) | PASS — `m4RuntimeStabilization.test.js` |

---

## 5. Worker Railway

| Métrica | Valor | Fuente |
|---------|-------|--------|
| Lógica worker | OK | `staging-worker-tick.js` = mismo path que `workers/crmOutboxRailwayWorker.js` |
| Store mode | `db` | Tras fix `isArgosOrDryContext` |
| Heartbeat DB | OK | `crm_worker_heartbeats` row con `worker_id`, `last_seen_at` |
| Polling Railway | **No verificado** | Falta URL/logs Railway staging |
| Restart safety | **No verificado** | Requiere redeploy manual |

**Acción humana:** deploy servicio `node workers/crmOutboxRailwayWorker.js` en Railway staging con env Fase 2; confirmar logs `crm_worker_tick`.

---

## 6. WhatsApp smoke — 10 pilotos

**Estado: BLOQUEADO**

`docs/argos/whatsapp-smoke/m4-02/allowlist-10.yaml` contiene placeholders `+52XXXXXXXXXX`.

Run log: `docs/argos/whatsapp-smoke/m4-02/runs/M4-04-STAGING-20260520.md`

| Criterio | Resultado |
|----------|-----------|
| ≥8/10 humanity ≥4/5 | N/A |
| 0 inventos críticos | N/A |
| 0 duplicados piloto | N/A (ventana activación limpia en SQL) |
| 0 loops / jobs perdidos | N/A |

**Sustituto técnico:** ARGOS 60/60 + RPACK_001 — no reemplaza smoke WA.

---

## 7. Duplicados CRM

| Check | Ventana | Resultado |
|-------|---------|-----------|
| Idempotency keys duplicadas | all | **0** |
| Leads duplicados | 48h activación | **0** |
| Leads duplicados | 7d histórico | **1 contacto ×5** (pre-existente staging; no bloquea M4 pipeline) |
| DLQ | all | **0** |
| Outbox stuck | pending+processing | **0** post-run |

---

## 8. Bugs encontrados y fixes

| Bug | Severidad | Fix |
|-----|-----------|-----|
| Probe asumía columna `id` en todas las tablas | Alta (falso FAIL) | HEAD count probe |
| `crmDryRun` forzaba memory store en worker | **Crítica** | `isArgosOrDryContext` sin `crmDryRun` |
| Heartbeat DB fire-and-forget | Media | `await persistWorkerHeartbeatToDb` |
| `staging-crm-db-smoke` pasaba `crmDryRun:true` al resolver store | Alta | `crmDryRun:false` + `PERSEO_ARGOS_ENABLED=false` |

---

## 9. Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| WA smoke no ejecutado | **Alta** | Completar allowlist + 10 conversaciones |
| Railway worker no desplegado/verificado | **Media** | Deploy staging + logs 24h |
| Duplicados históricos staging (leads) | Baja | No en ventana 48h; limpiar datos QA si molesta |
| `PERSEO_V3_CRM_EXECUTE=false` | Esperado | Mantener hasta M4-05 |

---

## 10. Decisión GO / NO-GO

### Criterios técnicos staging (automatizados)

| Criterio | OK |
|----------|-----|
| Migraciones staging | ☑ |
| verify-db PASS | ☑ |
| Worker DB mode + heartbeat | ☑ |
| Telemetry DB | ☑ |
| Replay | ☑ |
| Media fallback (script) | ☑ |
| Duplicate check (M4 window) | ☑ |
| Fases 0–4 scripts | ☑ |

### Criterios operativos completos M4-04

| Criterio | OK |
|----------|-----|
| Railway worker logs 24h | ☐ |
| WA 10 pilotos ≥8/10 | ☐ |
| Sin degradación grave observada | ☑ (scripts) |

### **Decisión: NO-GO** (cierre M4-04 operativo)

**Motivo:** smoke WA bloqueado; Railway staging no confirmado desde este entorno.

### **Decisión parcial: GO infra staging**

Migraciones + CRM durable + telemetry + scripts PASS — listo para completar WA/Railway y preparar **M4-05 Controlled Production Rollout**.

**Prod:** permanece **OFF**.

---

## 11. Próximos pasos

1. Completar `allowlist-10.yaml` con teléfonos staging autorizados.
2. Ejecutar 10 pilotos WA; actualizar §6 y run log.
3. Deploy Railway staging (webhook + worker) con flags por fase del checklist.
4. Re-ejecutar: `PERSEO_STAGING_CONFIRMED=true npm run staging:phases`
5. Si todo PASS → abrir diseño **M4-05 — Controlled Production Rollout**.
