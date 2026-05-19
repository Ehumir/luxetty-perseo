# M4-02 — Staging migration checklist

**Autorizado:** staging ONLY. **NO prod** en este paso.

## Pre-flight

- [ ] Confirmar `SUPABASE_URL` apunta a **staging** (no prod)
- [ ] Snapshot / export tablas críticas (`contacts`, `leads`, `conversations`)
- [ ] Revisar SQL: `20260520000000_m4_02_crm_runtime_hardened.sql` + `20260519121000_m4_wa_operational_telemetry.sql`
- [ ] Rollback SQL probado en branch local o staging clone
- [ ] Equipo notificado (ventana)

## Aplicación

- [ ] `supabase migration list` sin drift bloqueante
- [ ] Aplicar migraciones M4 (solo staging)
- [ ] `SELECT 1 FROM crm_outbox LIMIT 0;`
- [ ] `SELECT 1 FROM wa_operational_telemetry LIMIT 0;`
- [ ] Verificar RLS service_role en tablas nuevas

## Post-apply smoke

- [ ] Deploy PERSEO código M4-02 con **todos flags OFF**
- [ ] `node scripts/m4-probe-runtime-tables.js` (si existe) o SQL probe
- [ ] `npm run test:argos` — suites M4-01 + M4-02
- [ ] Activar flags según `docs/runbooks/M4-02-production-activation.md`
- [ ] WhatsApp smoke `docs/argos/whatsapp-smoke/m4-02/`

## Abort criteria

- [ ] Duplicados CRM detectados → rollback flags + investigar DLQ
- [ ] Inserts telemetry fallan >5 min → desactivar `PERSEO_WA_TELEMETRY_ENABLED`
- [ ] Worker no reclaim locks → revisar `lock_expires_at`

## Rollback

```sql
DROP TABLE IF EXISTS crm_dead_letters;
DROP TABLE IF EXISTS crm_execution_logs;
DROP TABLE IF EXISTS crm_idempotency_keys;
DROP TABLE IF EXISTS crm_outbox;
DROP TABLE IF EXISTS wa_operational_telemetry;
```

Exportar `crm_dead_letters` antes si hubo jobs.
