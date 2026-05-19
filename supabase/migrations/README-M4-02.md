# M4-02 migrations — staging activation

## ⚠️ No aplicar sin confirmación explícita

1. Confirmar proyecto Supabase (staging vs prod).
2. Revisar diseño: `docs/sprints/M4-02-production-activation-design.md`.
3. Ejecutar runbook: `docs/runbooks/M4-02-production-activation.md`.

## Archivos

| Archivo | Estado |
|---------|--------|
| `20260519120000_m4_crm_runtime_outbox.sql` | M4-01 baseline |
| `20260519121000_m4_wa_operational_telemetry.sql` | M4-01 baseline |
| `20260520000000_m4_02_crm_runtime_hardened.sql` | M4-02 hardened (worker columns + indexes) |

Si M4-01 **no** se aplicó en staging: usar solo `20260520000000` + telemetry M4-01.

Si M4-01 **ya** se aplicó: crear migración ALTER incremental (no incluida hasta confirmar estado real).

## Rollback

```sql
DROP TABLE IF EXISTS crm_dead_letters;
DROP TABLE IF EXISTS crm_execution_logs;
DROP TABLE IF EXISTS crm_idempotency_keys;
DROP TABLE IF EXISTS crm_outbox;
DROP TABLE IF EXISTS wa_operational_telemetry;
```

Exportar `crm_dead_letters` antes si hay incidencias abiertas.
