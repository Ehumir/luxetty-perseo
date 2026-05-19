# PRE-PR — M4-02 Production Activation & Hardening

**Rama:** `feat/m4-02-production-activation`  
**Fecha:** 2026-05-19  
**Migraciones aplicadas:** **NO** (staging autorizado pero pendiente checklist)

---

## Resumen ejecutivo

M4-02 activa en código la foundation M4-01: **worker CRM async** (proceso Railway dedicado), **webhook media** con timeouts aprobados y fail-open, **telemetry operacional** acotada, **32 escenarios ARGOS** en 5 suites, runbooks y smoke WA estructurado.

Todo flag **default OFF**. Sin writes CRM reales en ARGOS.

---

## Suites ARGOS M4-02 (32/32 PASS)

| Suite | Resultado |
|-------|-----------|
| `crm-worker-p0` | 8/8 |
| `webhook-media-p0` | 8/8 |
| `wa-telemetry-runtime-p0` | 6/6 |
| `rollout-flags-p0` | 4/4 |
| `wa-real-smoke-p0` | 6/6 |

**Total nuevas:** 32 escenarios.

---

## Regresión

| Comando | Resultado |
|---------|-----------|
| `npm run test:argos` | **52/52 PASS** (incl. M4-01 + M4-02) |
| `npm run test:perseo` | **103/103 PASS** |
| `npm run test:corpus` | **7/7 PASS** |
| `npm run corpus-validate` | **PASS** |
| `npm test` | **748/761 PASS**, **13 fail** (legacy F2/F3/F4 / v3PrimaryGate — sin delta atribuible a M4-02) |
| `test/m4ProductionActivation.test.js` | **7/7 PASS** |
| `test/m4RuntimeFoundation.test.js` | **7/7 PASS** |

---

## Componentes entregados

### CRM worker (Railway dedicado)

- Entry: `workers/crmOutboxRailwayWorker.js`
- Core: `conversation/v3/runtime/crmOutboxWorker.js`
- Poisoning: `conversation/v3/runtime/crmWorkerPoisoning.js` (DLQ, freeze, alert reason)
- Async enqueue: `crmRuntime.js` cuando `PERSEO_CRM_WORKER_ASYNC_ENABLED=true`
- Poll: `PERSEO_CRM_WORKER_POLL_MS` (default 5s), batch 5, lock TTL 120s, `SKIP LOCKED` pattern (DB)

### Webhook media

- `services/inboundMediaV3Bridge.js` cableado en `index.js`
- Timeouts: audio **12s**, image **15s**, doc **8s**
- `PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED` — timeout ≠ fail duro
- Política: `docs/sprints/M4-02-media-non-authoritative.md`

### Telemetry

- Solo operacional (retries, fallback, media, crm, loop_score) — no analytics BI
- `waTelemetry.js` metadata acotada

### Learning foundation

- `corpus/learningReviewQueue.js` — confidence + human review queue
- `learningRuntime.js` — confidence en candidates

### Docs / runbooks

- `docs/runbooks/M4-02-production-activation.md`
- `docs/runbooks/M4-02-staging-migration-checklist.md`
- `docs/argos/whatsapp-smoke/m4-02/run-record-schema.yaml`

### SQL (propuesto, NO aplicado)

- `supabase/migrations/20260520000000_m4_02_crm_runtime_hardened.sql`

---

## Evidencia: no duplicación CRM

- ARGOS: `must_not.write_leads` / `write_contacts` en todas las suites CRM/worker
- Idempotency: `crm_idempotency_keys` + `UNIQUE (conversation_id, idempotency_key)` en SQL propuesto
- Tests: `CRMW_003`, `CRMW_005`, `CRMW_008` + memory store idempotency en `m4ProductionActivation.test.js`
- Worker no re-ejecuta si idempotency key completada (store.enqueue collision/skip)

---

## Evidencia: graceful fallback media

- `WHM_006` — `media_timeout` + `media_fail_open` en snapshot
- `inboundMediaV3Bridge.withTimeout` — no lanza al webhook
- Fail-open copy: `FAIL_OPEN_USER_HINT` cuando flag ON
- `WHM_002`, `WHM_004` — modos intake honestos (low confidence / hints only)

---

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Migración en prod por error | Checklist staging-only; flags OFF en deploy |
| Worker multi-réplica | Lock TTL + claim atómico |
| Whisper lento | Timeout 12s + fail-open |
| 13 tests legacy npm | Pre-existentes; no bloquean M4-02 ARGOS |

---

## Staging siguiente paso (humano)

1. `docs/runbooks/M4-02-staging-migration-checklist.md`
2. Aplicar SQL staging
3. Railway: segundo servicio `node workers/crmOutboxRailwayWorker.js`
4. Flags según runbook
5. Smoke WA 10 pilotos con `run-record-schema.yaml`

---

## Flags nuevos (default OFF)

| Variable | Rol |
|----------|-----|
| `PERSEO_CRM_WORKER_ASYNC_ENABLED` | Enqueue sin execute en request |
| `PERSEO_CRM_WORKER_PROCESS_ENABLED` | Loop worker Railway |
| `PERSEO_CRM_WORKER_POLL_MS` | Frecuencia poll |
| `PERSEO_CRM_WORKER_BATCH_SIZE` | Batch |
| `PERSEO_CRM_WORKER_LOCK_TTL_SEC` | Stale lock recovery |
| `PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED` | Media error/timeout no rompe turno |

---

## NO incluido (explícito)

- Migraciones aplicadas en Supabase
- ARGOS-2 UI
- WhatsApp real ejecutado (solo plantillas)
- Commit / push (pendiente autorización)
