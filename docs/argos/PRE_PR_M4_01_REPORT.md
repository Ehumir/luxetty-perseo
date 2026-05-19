# PRE-PR M4-01 — Operational Runtime Foundation

**Branch:** `feat/m4-01-operational-runtime-foundation`  
**Estado:** Fase 2 implementada — listo para revisión (sin commit hasta autorización)

## Regla M4-01 (cumplida)

- Tests/suites **no requieren** migraciones aplicadas.
- Flags OFF → comportamiento M3 idéntico.
- Sin writes reales si flag OFF, ARGOS, dry-run, o tablas no disponibles.
- Fallback: memory / log-only / dry-run preview.

## Matriz de readiness

| Modo | CRM | Telemetry | Media prod |
|------|-----|-----------|------------|
| Flags OFF / sin DB | M3 foundation path | disabled | M3 bridge only |
| Flags ON / sin DB | `memory` o `memory_argos` | `memory` / `memory_argos` | simulate + bridge |
| Flags ON / DB aplicada | `db` (outbox tables) | `db_async` insert | Whisper/Vision si wired |

## Suites M4 (54/54 PASS local)

| Suite | Resultado |
|-------|-----------|
| `crm-runtime-p0` | 8/8 |
| `media-runtime-p0` | 8/8 |
| `runtime-understanding-p0` | 10/10 |
| `runtime-resilience-p0` | 8/8 |
| `wa-telemetry-p0` | 6/6 |
| `learning-runtime-p0` | 6/6 |
| `policy-runtime-p0` | 8/8 |

## Migraciones (propuesta — NO aplicadas)

Ver `supabase/migrations/README-M4-01.md` y SQL `20260519*_m4_*`.

## Flags (default `false`)

- `PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED`
- `PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED`
- `PERSEO_UNDERSTANDING_RUNTIME_ENABLED`
- `PERSEO_RESILIENCE_RUNTIME_ENABLED`
- `PERSEO_WA_TELEMETRY_ENABLED`
- `PERSEO_LEARNING_RUNTIME_ENABLED`
- `PERSEO_POLICY_RUNTIME_ENABLED`

## Seguridad

- ARGOS: `createArgosNoWriteSupabase` + `crm_dry_run` + memory stores.
- CRM runtime no escribe leads/contacts; delega a `executeV3CrmIfEligibleImpl` con gates.
- Telemetry DB insert solo async si flag + tabla probe OK + no ARGOS.
