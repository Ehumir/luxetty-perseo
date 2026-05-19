# Runbook — M4-02 Production Activation

**Versión:** 0.1 (borrador diseño)  
**Estado:** No ejecutar hasta aprobación de diseño + migraciones staging

---

## 1. Flags (default OFF en prod)

| Variable | Capa | Activar cuando |
|----------|------|----------------|
| `PERSEO_WA_TELEMETRY_ENABLED` | Telemetry | Migraciones telemetry OK en entorno |
| `PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED` | Media webhook | Telemetry estable 24h |
| `PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED` | CRM outbox DB | Migraciones CRM OK + worker probado |
| `PERSEO_CRM_WORKER_ASYNC_ENABLED` | Worker async | Sync path validado en staging |
| `PERSEO_CRM_WORKER_ENABLED` | Poll loop en Railway | Async ON |
| `PERSEO_UNDERSTANDING_RUNTIME_ENABLED` | Opcional | Tras core estable |
| `PERSEO_RESILIENCE_RUNTIME_ENABLED` | Opcional | Tras core estable |
| `PERSEO_POLICY_RUNTIME_ENABLED` | Opcional | Policy QA OK |

M2/M3 flags (`PERSEO_POLICY_ENGINE_ENABLED`, etc.) independientes.

---

## 1b. Railway worker process (dedicado)

Servicio separado del HTTP webhook:

```bash
node workers/crmOutboxRailwayWorker.js
```

| Parámetro | Default | Notas |
|-----------|---------|-------|
| Poll | `PERSEO_CRM_WORKER_POLL_MS=5000` | 5s entre ticks |
| Batch | `PERSEO_CRM_WORKER_BATCH_SIZE=5` | Jobs por tick |
| Lock TTL | `PERSEO_CRM_WORKER_LOCK_TTL_SEC=120` | Reclaim stale locks |
| Worker ID | `PERSEO_CRM_WORKER_ID` | Opcional; default `worker_<pid>` |

**Restart safety:** locks expiran; jobs `failed` reintentan con backoff (30s, 2min). Poisoning: mismo error 2× → freeze + alert; max attempts → DLQ.

## 2. Orden de activación (staging)

```txt
Paso 0: Deploy código M4-02 (todos M4 flags OFF)
Paso 1: Aplicar migraciones (confirmación explícita DBA)
Paso 2: Probe tablas (script o SQL)
Paso 3: PERSEO_WA_TELEMETRY_ENABLED=true (allowlist 1–3 tel)
Paso 4: PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=true (misma allowlist)
Paso 5: PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true (sync enqueue, worker OFF)
Paso 6: Validar outbox rows + logs sin execute real
Paso 7: PERSEO_CRM_WORKER_ASYNC_ENABLED=true + worker ON
Paso 8: PERSEO_V3_CRM_EXECUTE=true solo si negocio autoriza (subset)
Paso 9: WhatsApp smoke 10 pláticas (docs/argos/whatsapp-smoke/m4-02/)
```

---

## 3. Prod gradual

1. Repetir pasos 1–2 en prod (ventana mantenimiento si aplica).
2. Deploy con flags OFF.
3. Allowlist ampliada (5 → 20 → all QA phones).
4. Activar telemetry → media → CRM (mismo orden que staging).
5. Monitorear 48h antes de quitar allowlist restrictiva.

---

## 4. Smoke tests

```bash
# Tras deploy staging
npm run test:argos
node scripts/argos-run-suite.js --suite crm-worker-p0
node scripts/argos-run-suite.js --suite webhook-media-p0
node scripts/argos-run-suite.js --suite wa-telemetry-runtime-p0

# Worker one-shot
node scripts/crm-outbox-worker.js --once

# Probe tablas
node scripts/m4-probe-runtime-tables.js   # (a implementar en M4-02)
```

---

## 5. Métricas a monitorear

| Métrica | Umbral alerta |
|---------|---------------|
| `crm_outbox` pending age p95 | > 5 min |
| `crm_dead_letters` count / hour | > 3 |
| Webhook latency p95 | > 25s |
| OpenAI vision/transcribe errors | > 10% |
| Duplicate leads (manual SQL) | > 0 |
| `wa_operational_telemetry` insert errors | any sustained |

Queries útiles:

```sql
SELECT status, count(*) FROM crm_outbox GROUP BY status;
SELECT * FROM crm_dead_letters ORDER BY created_at DESC LIMIT 20;
SELECT count(*) FROM wa_operational_telemetry WHERE created_at > now() - interval '1 hour';
```

---

## 6. Criterios de abortar rollout

Detener y flags → OFF si:

- Duplicado de lead/contact confirmado por runtime.
- DLQ > 5% de jobs en 1h.
- p95 webhook > 30s sostenido.
- Error de migración / RLS en inserts.
- Hallazgo H3 (inventos) en ≥2/10 smokes reales.

---

## 7. Rollback

### Código (inmediato)

```bash
# Railway / env
PERSEO_CRM_WORKER_ENABLED=false
PERSEO_CRM_WORKER_ASYNC_ENABLED=false
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=false
PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED=false
PERSEO_WA_TELEMETRY_ENABLED=false
```

Redeploy versión anterior si necesario.

### Base de datos (solo si crítico)

Ver `docs/sprints/M4-02-production-activation-design.md` §1.3 — exportar DLQ antes.

---

## 8. Contactos

| Rol | Acción |
|-----|--------|
| Ingeniería PERSEO | Deploy, flags, worker |
| DBA / Supabase | Aplicar migraciones |
| QA | Smoke 10 pláticas + checklist |
| Producto | Autorizar CRM_EXECUTE en staging |
