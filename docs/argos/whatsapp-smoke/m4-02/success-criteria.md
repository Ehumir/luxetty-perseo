# M4-02 — Criterios de éxito (WhatsApp real smoke)

## Meta global

| Métrica | Umbral |
|---------|--------|
| HUMANITY (H1–H5) | **≥8/10** pláticas con promedio ≥4/5 |
| Inventos críticos (H3) | **0** |
| Duplicados CRM (mismo contacto/lead) | **0** |
| Loops (misma respuesta 3×) | **0** |
| Media sin fallback cuando no hay señal | **0** |

## Checklist extendido M4-02

Además de `checklist-humanity.md` (H1–H5, M1–M2):

| ID | Criterio | PASS si |
|----|----------|---------|
| T1 | Telemetry registrada | Evento en logs o tabla (staging) |
| T2 | policy_hit coherente | No decline erróneo en zona válida |
| C1 | CRM outbox | Si CRM_READY: job completed o dry-run preview OK; sin duplicate |
| C2 | Worker async | Si async ON: respuesta WA no espera >15s por CRM |

## Registro

Usar `runs/YYYY-MM-DD-run-01.md` por sesión de prueba.
