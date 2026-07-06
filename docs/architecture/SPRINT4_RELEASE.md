# Sprint 4 Release — RAG Canary PERSEO

## Qué se implementó

- **Allowlist canary:** `isRagCanaryEligible`, `isRagInventoryEffectiveForUser`, `isRagRulesEffectiveForUser`
- **Inventario conversacional:** `canaryPhone` en `resolveInboundPropertyReference` + eventos `rag_retrieval`
- **Reglas conversacionales:** `ragTurnOrchestrator.enrichTurnWithRagContext` → `legacyHydration.ragContextPack` → V3 state
- **Composer grounded:** objeción comisión enriquecida solo con excerpt validado (sin % inventado)
- **Logging:** `conversation_events` tipo `rag_retrieval` + `rag_query_logs` / `retrieval_citations`
- **Suite ARGOS:** `rag-perseo-canary-p0.json` + `test/ragCanaryP0.test.js`

## Qué NO se implementó

Conversation Memory, reranking, hybrid search, gateway FB/IG, CRM writes, lead automation, assignment changes, webhook changes, nuevas migraciones.

## Activación (solo QA)

```text
RAG_P0_ENABLED=true
RAG_INVENTORY_ENABLED=true
RAG_RULES_ENABLED=true
RAG_P0_ALLOWLIST=5218181877351
```

## Producción

Flags **OFF**. Código desplegado; sin llamadas RAG en tráfico general.

## Jerarquía

`RAG_P0_ENABLED` → sub-flags → `RAG_P0_ALLOWLIST` → usuario elegible → RAG; si falla → legacy.
