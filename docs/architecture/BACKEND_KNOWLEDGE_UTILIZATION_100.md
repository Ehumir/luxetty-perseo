# Backend Knowledge Utilization 100% — Contrato (1A + 2A)

| Campo | Valor |
|-------|--------|
| **Estado** | CONTRATO ACTIVO |
| **Definición 100%** | 1A — conocimiento comercial autorizado y relevante por conversación |
| **Alcance** | 2A — ATENA + PERSEO + ARGOS |
| **Fecha** | 2026-07-21 |

```text
PLAN_APPROVED = YES
IMPLEMENTATION_GO = IN_PROGRESS
SCHEMA_MIGRATION_GO = FASE_E_ONLY
PRODUCTION_RAG_GO = NO (canary first)
```

## Principio rector

Backend ATENA = fuente de verdad. RAG recupera y rankea. Claims al usuario solo con `canAssertClaim` + hechos SQL publicables. Flags OFF = comportamiento idéntico a producción.

## Matriz SoT vs RAG

| Tipo de dato | Canal | Motivo |
|--------------|-------|--------|
| Precio, status, publicabilidad, código LUX | **SoT siempre** (post-RAG hydrate) | Frescura + anti-alucinación |
| Filtros demanda (op, zona, budget) | **SQL primero**; RAG solo **rerank** | `inventoryOptionsService` |
| Descripción/amenities/tono/objeciones/scripts | **RAG + citation** | Semántica |
| Ownership / create lead / assignment | **Motor SoT** | Prioridad oficial |
| Teléfono, mensajes, leads, contactos | **Nunca RAG** | PII / ownership |
| Campaña activa / copy real | **SoT property fields** | Entity validation |
| Colonia canónica | **Location Intelligence SoT** | Evitar inventar zona |

## TurnContextPack (contrato runtime)

```js
{
  activeProperty: object|null,       // hechos SoT normalizados
  matchedOptions: object[],          // opciones publicables (id, title, price, public_url, …)
  inventorySearchMeta: {
    attempted: boolean,
    source: 'none'|'structured'|'structured+rag',
    operation: 'rent'|'sale'|null,
    zone: string|null,
    budgetMax: number|null,
    relaxedZone: boolean,
    emptyAfterSearch: boolean,
  }|null,
  ragContextPack: ContextPackV1|null,
  networkFallback: boolean,          // true solo post-search vacío
  freshness: { lagSeconds: number|null }|null,
}
```

Inyectado vía `legacyHydration` → `v3Runtime.applyLegacyHydrationToSession`.

## Owners

| Área | Owner |
|------|--------|
| Runtime conversacional / composer | PERSEO |
| Knowledge Store / CDC / index | ATENA |
| Certificación / panel madurez | ARGOS |

## Go / No-Go por fase

| Fase | GO | NO-GO |
|------|----|-------|
| A Domain filter | RQ-3 isolation | cross-domain grounding |
| B URLs | ≥95% activas con link resoluble | inventar links / no publicables |
| C Inventario V3 | renta/venta opciones reales canary | opciones inventadas / misroute |
| D Grounding | claims con citation + PROPERTY_QA SoT | claim sin citation |
| E CDC | freshness KPI + entity campaigns | seeds genéricos en claims |
| F Cert | functional PASS + anti-PII 0 | suite FAIL |

## Anti-PII gate

Mantener `luxetty-atena/supabase/validation/rag_p0_no_pii_audit.sql` como gate de release. Nunca indexar contacts/leads/conversations/opportunities/transactions.
