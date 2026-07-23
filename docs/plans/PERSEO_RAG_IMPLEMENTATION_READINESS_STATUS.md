# PERSEO RAG — Implementation Readiness Status

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-07-22 |
| **Master Plan** | V2.1 |
| **Actualizado** | post F0A/F0B PRs + F1A código en rama |

## Workstreams

| Workstream | Estado | Evidencia | Bloqueador | Siguiente acción |
| ---------- | ------ | --------- | ---------- | ---------------- |
| F0A Documentación | **PASS** | [`PERSEO_RAG_DOCUMENTATION_SOURCE_OF_TRUTH.md`](../argos/PERSEO_RAG_DOCUMENTATION_SOURCE_OF_TRUTH.md); cert MD PASS/YES; snapshot ATENA ALIGNED | — | Mantener |
| F0B PERSEO | **READY_FOR_REVIEW** | PR https://github.com/Ehumir/luxetty-perseo/pull/112 · branch `chore/reconcile-main-production-perseo-20260722` · P0 local 55/55 | Autorización merge Dir + CI | Review → merge → deploy from main |
| F0B ATENA | **READY_FOR_REVIEW** | PR https://github.com/Ehumir/luxetty-atena/pull/119 · cherry-pick CDC `5e924a7` | Verificar cron ya aplicado | Review → merge |
| Deploy desde main | **NOT_STARTED** | Prod Railway aún `fix/rag-rq47-quality-hardening@ca4cccb` · deploy `d8655e81` | Merge PRs | Deploy + smoke equivalencia |
| F1A Telemetría | **READY_FOR_REVIEW** | clasificación + skip emit en PR 112; tests 5/5; [`PERSEO_RAG_F1A_TELEMETRY_BASELINE.md`](../argos/PERSEO_RAG_F1A_TELEMETRY_BASELINE.md) | Deploy | Baseline post-deploy |
| F1B Trajectory | **PASS** (diseño) | [`PERSEO_ARGOS_TRAJECTORY_LOGGING_DESIGN.md`](../architecture/PERSEO_ARGOS_TRAJECTORY_LOGGING_DESIGN.md) · D13 preferir events | Firma D13 | No migrate |
| Decision Pack | **PASS** (UNSIGNED) | [`PERSEO_RAG_DIRECTION_DECISIONS.md`](./PERSEO_RAG_DIRECTION_DECISIONS.md) | Firmas Dir | Usar provisionales |
| Contrato F2 | **PASS** (diseño) | SQL drafts `docs/plans/sql-drafts/` + F2 contract | Review + §40 | **No apply** |
| Contrato F3 | **PASS** (diseño) | `conversation/v3/context/*` unwired; contract tests 7/7 | — | No wire `index.js` |
| ARGOS 100 | **PASS** (fixtures) | 100× `ARGOS_PC_*.v1.json` · suite matrix · 53 runnable / 23 xfail / 24 not_run | Runner xfail credit; ejecutar subset | No marcar 100/100 PASS runtime |
| KPI comercial | **PASS** | [`PERSEO_COMMERCIAL_KPI_BASELINE.md`](../argos/PERSEO_COMMERCIAL_KPI_BASELINE.md) | Features F2+ | No inventar futuros |
| Backlog F2/F3 | **PASS** | [`PERSEO_RAG_F2_F3_IMPLEMENTATION_BACKLOG.md`](./PERSEO_RAG_F2_F3_IMPLEMENTATION_BACKLOG.md) | IMPLEMENTATION_READY | No iniciar F2 |
| Flags plaintext Railway | **BLOCKED** | Nombres documentados; valores ocultos | Dashboard humano | Completar matriz |

## Causa raíz F1A (resumen)

Tras GLOBAL, la mayoría del tráfico comercial es **inventory SQL** (`inventory_only`). `rag_query_logs` solo se escribe en path de **rules RAG** (`persistRagQueryLog`). Telemetría de skips estaba detrás de `RAG_RC11_TELEMETRY_ENABLED` → 0 `rag_retrieval` desde 2026-07-08 mientras `conversation_events` generales seguían vivos. Fix: clasificación siempre + skips siempre; **no** inventar filas en `rag_query_logs` para inventory-only.

## Veredicto

```text
IMPLEMENTATION_READY = NO
F2_GO_RECOMMENDATION = NO-GO
```

### Por qué NO

1. `main` aún no es la rama desplegada (drift abierto hasta merge+deploy PRs).
2. F1A no medido post-deploy.
3. Decisiones D1–D13 **UNSIGNED**.
4. SQL F2 solo drafts — sin review de migración en pipeline autorizado.
5. Matriz 100: fixtures listos, **no** ejecutados 100/100 en runtime.
6. Valores de flags Railway plaintext incompletos.

### Qué falta para YES

1. Merge autorizado PR PERSEO #112 + ATENA #119.  
2. Deploy Railway **desde main** + smoke equivalencia.  
3. Baseline F1A post-deploy (eventos `retrieval_turn_classification` <24h).  
4. Firma Dirección D1–D3 (+ D12/D13).  
5. Review contratos/SQL drafts.  
6. Runnable ARGOS subset verde + política xfail documentada.

**F2 permanece prohibido** hasta `IMPLEMENTATION_READY = YES` y autorización expresa.
