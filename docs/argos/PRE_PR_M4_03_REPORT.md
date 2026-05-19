# PRE-PR — M4-03 Runtime Stabilization & Production Readiness

**Rama:** `feat/m4-03-runtime-stabilization`  
**Base:** `main` (post M4-02)

---

## Resumen

M4-03 convierte PERSEO en sistema operacional a escala real: **110 escenarios ARGOS**, observability layer, CRM durability (stuck recovery, heartbeat, retry storm, reconciliation, replay), media hardening, runtime safety (flood), y replay engine con packs.

**Flags default OFF.** Migración metrics **propuesta, no aplicada**.

---

## Suites M4-03 (110/110 PASS)

| Suite | Escenarios |
|-------|------------|
| `crm-durability-p0` | 18/18 |
| `crm-concurrency-p0` | 12/12 |
| `runtime-observability-p0` | 12/12 |
| `media-hardening-p0` | 14/14 |
| `robustness-p0` | 18/18 |
| `runtime-safety-p0` | 12/12 |
| `replay-p0` | 12/12 |
| `replay-regression-p0` | 12/12 |

**Total nuevos M4-03:** 110  
**Total ARGOS tests:** 60/60 pass (M1–M4)

---

## Regresión

| Comando | Resultado |
|---------|-----------|
| `npm run test:argos` | **60/60** |
| `test/m4RuntimeStabilization.test.js` | **7/7** |
| `npm run test:perseo` | **103/103** |
| `test:corpus` + `corpus-validate` | PASS |
| `npm test` | Ver CI (legacy F2/F3 fails pre-existentes) |

---

## Módulos principales

| Área | Archivos |
|------|----------|
| Flags | `config/perseoM403Flags.js` |
| Observability | `conversation/v3/runtime/observability/runtimeMetricsCollector.js` |
| CRM durability | `crmDurability.js`, `crmReplay.js` |
| Media | `mediaHardening.js` |
| Safety | `runtimeSafety.js` |
| V3 hook | `applyM403Finishing.js` |
| Replay | `argos/replay/replayEngine.js`, `docs/replay-packs/RPACK_001.json` |
| SQL propuesto | `supabase/migrations/20260521120000_m4_03_runtime_metrics.sql` |

---

## Integraciones

- `index.js` — flood protection, webhook latency
- `crmOutboxWorker.js` — stuck recovery, heartbeat, retry storm, worker metrics
- `v3Runtime.js` — media hardening + M403 finishing
- `deterministicMode.js` — M403 flags en ARGOS

---

## Flags nuevos (OFF)

`PERSEO_RUNTIME_OBSERVABILITY_ENABLED`, `PERSEO_CRM_DURABILITY_ENABLED`, `PERSEO_CRM_RECONCILIATION_ENABLED`, `PERSEO_CRM_REPLAY_ENABLED`, `PERSEO_MEDIA_HARDENING_ENABLED`, `PERSEO_RUNTIME_SAFETY_ENABLED`, `PERSEO_REPLAY_ENGINE_ENABLED`

---

## Staging post-merge

1. Deploy flags OFF
2. Apply `20260521120000_m4_03_runtime_metrics.sql` (staging only)
3. Enable observability + durability
4. Monitor `runtime_health` logs 48h
5. Replay pack `RPACK_001` en staging

---

## Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Flood false positive | Env thresholds |
| 110 escenarios CI time | ~5min added to argos suite |
| Metrics memory | Reset per ARGOS session |

---

## Fuera de scope (cumplido)

- No ARGOS-2 UI
- No dashboards
- No prod activation
