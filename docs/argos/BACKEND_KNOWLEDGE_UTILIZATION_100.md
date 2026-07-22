# ARGOS — RAG Premium Consultivo (madurez)

Sección ARGOS para seguimiento del plan Premium Consultivo ≥90%. Fuente: contrato + telemetría + certificación.

## Madurez objetivo (8 capacidades)

| # | Capacidad | Objetivo | Estado implementación |
|---|-----------|----------|------------------------|
| 1 | Info propiedades (SoT) | ≥90% | Hydrate + PROPERTY_QA facts |
| 2 | Identificar necesidad | ≥90% | Buy/rent demand + search memory slots |
| 3 | Opciones reales sin inventar | ≥90% | `inventoryOptionsTurn` → V3 |
| 4 | Fallback red post-search | ≥90% | `networkFallback` composer |
| 5 | Tono consultivo | ≥90% | Templates consultivos |
| 6 | Anti-loops | ≥90% | Guardrails existentes |
| 7 | Campañas consultivas | ≥80% | Entity validation RC12 |
| 8 | Imágenes | ≥80% | Media flags (existente; no multimodal RAG) |

## Telemetría clave

- `conversation_events.type = rag_retrieval` — `domain_selected`, `domain_filter_applied`, hybrid flag
- `logEvent inventory_options_search` — count, source, empty
- `rag_query_logs` + `retrieval_citations` (con `rank`)
- CDC: `knowledge_reindex_jobs` (pending/done/failed)
- Domain metrics: `ragRetrievalMetrics` isolation / wrong-domain

## Certificación

```bash
node scripts/qa/perseoFunctionalCertification.js
```

Veredicto binario en `docs/argos/PERSEO_FUNCTIONAL_CERTIFICATION.md`.

**Gate GLOBAL:** PASS + KPIs runbook 48–72h + anti-PII 0.

## Panel ATENA

`AccRagP0Panel` + snapshot `src/lib/argos/backendKnowledge100Snapshot.json`.
