# M4-01 migrations — READ BEFORE APPLY

**Status:** PROPOSED in PR only. Do **not** run `supabase db push` until:

1. DBA/product review of SQL in this folder (`20260519*_m4_*`).
2. Confirm target project (perseo vs atena shared Supabase).
3. Staging apply + smoke `crm-runtime-p0` / `wa-telemetry-p0`.

**Rollback:** see `docs/sprints/M4-01-operational-runtime-foundation-design.md` §4.2.

**Runtime:** `PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED` and `PERSEO_WA_TELEMETRY_ENABLED` must stay `false` until migrations are applied in that environment.
