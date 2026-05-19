# M4-03 — Runtime Stabilization & Production Readiness

**Rama:** `feat/m4-03-runtime-stabilization`  
**Base:** `main` (post M4-02)  
**Estado:** implementado — flags default OFF

---

## 1. Objetivo

Convertir PERSEO en sistema **resistente, observable, recuperable, multi-instancia y production-safe** para conversaciones reales de alto volumen.

M4-02 activó runtime. M4-03 **endurece, observa, recupera y escala QA**.

---

## 2. Arquitectura

```txt
Webhook (index.js)
  ├─ runtimeSafety (flood, webhook timing)
  ├─ mediaHardening → inboundMediaV3Bridge
  └─ v3Runtime → applyM403Finishing → runtimeMetricsCollector

CRM Worker (Railway)
  ├─ crmOutboxWorker
  ├─ crmDurability (stuck recovery, heartbeat, retry storm)
  └─ crmReplay (dry-run replay)

ARGOS
  ├─ 110 escenarios / 8 suites
  └─ replayEngine + docs/replay-packs/
```

### Módulos nuevos

| Módulo | Rol |
|--------|-----|
| `config/perseoM403Flags.js` | Flags M4-03 (default OFF) |
| `runtime/observability/runtimeMetricsCollector.js` | Métricas in-memory + snapshots |
| `runtime/crmDurability.js` | Stuck jobs, heartbeat, retry storm, reconciliation |
| `runtime/crmReplay.js` | Replay outbox dry-run |
| `runtime/mediaHardening.js` | Payload/mime/size validation |
| `runtime/runtimeSafety.js` | Flood, queue overflow, starvation |
| `runtime/applyM403Finishing.js` | Hook V3 turn |
| `argos/replay/replayEngine.js` | Transcript replay packs |

### Migración propuesta

`20260521120000_m4_03_runtime_metrics.sql` — `runtime_metrics_rollup`, `crm_worker_heartbeats`

---

## 3. CRM durability

| Capacidad | Implementación |
|-----------|----------------|
| Stuck job recovery | `recoverStuckJobs()` reclaim processing locks |
| Worker heartbeat | `recordWorkerHeartbeat()` cada batch |
| Retry storm | `recordRetryAttempt()` threshold/min |
| Reconciliation | `reconcileCrmOutbox()` dry-run report |
| Replay | `replayOutboxJobs()` dry-run default |
| DLQ tooling | `buildDlqExportSnapshot()` |

---

## 4. Observability

Collector registra: webhook/worker latency p95, retries, DLQ, timeouts, loop score, policy hits, media rejects, flood blocks, escalations.

`buildRuntimeHealthSnapshot()` — sin UI dashboard; structured JSON para logs/DB futuro.

---

## 5. Media hardening

- Max payload 16MB (configurable)
- MIME allowlist
- Malformed/corrupt flags
- Never throws — fail-open path

---

## 6. Runtime safety

- Flood: 10 msg / 30s per conversation
- Queue overflow detection
- Worker starvation detection
- Webhook timing metrics

---

## 7. Replay system

- Packs en `docs/replay-packs/*.json`
- `runReplayPack()` — deterministic, crm_dry_run
- Production-safe: no writes CRM

---

## 8. Escenarios (110)

| Suite | # |
|-------|---|
| `crm-durability-p0` | 18 |
| `crm-concurrency-p0` | 12 |
| `runtime-observability-p0` | 12 |
| `media-hardening-p0` | 14 |
| `robustness-p0` | 18 |
| `runtime-safety-p0` | 12 |
| `replay-p0` | 12 |
| `replay-regression-p0` | 12 |

---

## 9. Flags (default OFF)

| Variable | Rol |
|----------|-----|
| `PERSEO_RUNTIME_OBSERVABILITY_ENABLED` | Collectors + snapshots |
| `PERSEO_CRM_DURABILITY_ENABLED` | Stuck recovery, heartbeat, storm |
| `PERSEO_CRM_RECONCILIATION_ENABLED` | Reconcile dry-run |
| `PERSEO_CRM_REPLAY_ENABLED` | Outbox replay |
| `PERSEO_MEDIA_HARDENING_ENABLED` | Payload validation |
| `PERSEO_RUNTIME_SAFETY_ENABLED` | Flood + starvation |
| `PERSEO_REPLAY_ENGINE_ENABLED` | Replay packs |

---

## 10. Staging strategy

1. Merge M4-03 — flags OFF
2. Apply migration metrics (staging only)
3. Enable `PERSEO_RUNTIME_OBSERVABILITY_ENABLED` + `PERSEO_CRM_DURABILITY_ENABLED`
4. Monitor `runtime_health` logs 48h
5. Enable media hardening + safety on allowlist
6. Replay pack smoke en staging

---

## 11. Rollback

- Flags → OFF (inmediato)
- Migration DROP: `runtime_metrics_rollup`, `crm_worker_heartbeats`
- Código: revert PR

---

## 12. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Flood false positives | Threshold configurable |
| Metrics memory growth | Reset en ARGOS; rollup DB futuro |
| Replay diverge prod | Packs anonimizados, dry-run |

---

## 13. Fuera de scope

- ARGOS-2 UI, dashboards frontend
- Decision core refactor
- Auto-promote learning
- Prod flags ON por defecto
