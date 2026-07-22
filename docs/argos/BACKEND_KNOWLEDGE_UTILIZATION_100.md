# ARGOS — Backend Knowledge Utilization 100% (madurez)

Sección ARGOS para seguimiento del plan 1A+2A. Fuente: contrato + telemetría + certificación.

## Madurez objetivo (8 capacidades)

| # | Capacidad | Objetivo | Estado implementación |
|---|-----------|----------|------------------------|
| 1 | Info propiedades (SoT) | ≥90% | Hydrate + PROPERTY_QA facts |
| 2 | Identificar necesidad | ≥90% | Buy/rent demand + guards |
| 3 | Opciones reales sin inventar | ≥90% | `inventoryOptionsTurn` → V3 |
| 4 | Fallback red post-search | ≥90% | `networkFallback` composer |
| 5 | Tono consultivo | ≥90% | Templates consultivos |
| 6 | Anti-loops | ≥90% | Guardrails existentes |
| 7 | Campañas consultivas | ≥80% | Entity validation campaigns |
| 8 | Imágenes | ≥80% | Media flags (existente) |

## Telemetría clave

- `conversation_events.type = rag_retrieval` — `domain_selected`, `domain_filter_applied`
- `logEvent inventory_options_search` — count, source, empty
- `rag_query_logs` + `retrieval_citations` (con `rank`)
- CDC: `knowledge_reindex_jobs` (pending/done/failed)

## Certificación

Re-ejecutar:

```bash
node scripts/qa/perseoFunctionalCertification.js
```

Veredicto binario en `docs/argos/PERSEO_FUNCTIONAL_CERTIFICATION.md`.

## Panel ATENA

Extensión sugerida en `AccRagP0Panel`: tarjeta "Knowledge 100%" con flags inventory options + freshness jobs. Ver snapshot JSON `src/lib/argos/backendKnowledge100Snapshot.json`.
