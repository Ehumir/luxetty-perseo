# M4-04 — Staging verification suites (operativas)

Estas suites **no son ARGOS sintéticos** — son checklists + scripts contra **staging real**.

---

## staging-runtime-p0

| # | Check | Comando / acción |
|---|-------|------------------|
| 1 | DB probe | `node scripts/m4-probe-runtime-tables.js` |
| 2 | DB verify | `node scripts/staging-verify-db.js` |
| 3 | Health snapshot | `node scripts/staging-runtime-health.js` |
| 4 | Webhook responde 200 | curl health / webhook test |
| 5 | Flags OFF no writes | count telemetry antes/después 5 min |

**PASS:** 5/5

---

## staging-crm-worker-p0

| # | Check | Comando / acción |
|---|-------|------------------|
| 1 | Worker process running | Railway dashboard |
| 2 | Heartbeat < 2× poll interval | SQL `crm_worker_heartbeats` |
| 3 | Enqueue test conversation | piloto CRM path |
| 4 | Job completed or skipped (dry) | `crm_outbox` status |
| 5 | Restart reclaim | redeploy worker |
| 6 | DLQ empty or explained | `crm_dead_letters` |
| 7 | Duplicate SQL | `staging-crm-duplicate-check.js` |

**PASS:** 7/7

---

## staging-telemetry-p0

| # | Check | Comando / acción |
|---|-------|------------------|
| 1 | Fase 1 flags ON | env |
| 2 | Insert row | 1 conversación piloto |
| 3 | Query last hour | SQL |
| 4 | No RLS errors in logs | Railway logs |
| 5 | runtime_metrics optional | rollup table |

**PASS:** 5/5

---

## staging-media-p0

| # | Check | Comando / acción |
|---|-------|------------------|
| 1 | Audio allowlist | WA real |
| 2 | Image allowlist | WA real |
| 3 | Timeout → fallback | simular slow si posible |
| 4 | No price invent | humanity H3 |
| 5 | Hardening reject large | optional test |

**PASS:** 5/5

---

## staging-replay-p0

| # | Check | Comando / acción |
|---|-------|------------------|
| 1 | RPACK_001 local | `node scripts/staging-replay-pack.js RPACK_001` |
| 2 | 0 violations | output |
| 3 | deterministic | repeat run same result |
| 4 | no CRM writes | dry-run |

**PASS:** 4/4

---

## Implementación scripts (M4-04 código)

| Script | Estado |
|--------|--------|
| `scripts/staging-verify-db.js` | Pendiente implementación |
| `scripts/staging-crm-worker-smoke.js` | Pendiente |
| `scripts/staging-telemetry-smoke.js` | Pendiente |
| `scripts/staging-replay-pack.js` | Pendiente |
| `scripts/staging-crm-duplicate-check.js` | Pendiente |
| `scripts/staging-runtime-health.js` | Pendiente |

Se implementan en el PR `feat/m4-04-staging-activation-runtime-verification` tras aprobación del diseño.
