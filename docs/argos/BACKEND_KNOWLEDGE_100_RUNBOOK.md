# Runbook — RAG Premium Consultivo (canary → prod)

## Flags Railway (PERSEO)

| Variable | Default | Rol |
|----------|---------|-----|
| `PERSEO_INVENTORY_OPTIONS_ENABLED` | `false` | Master inventario demanda |
| `PERSEO_INVENTORY_OPTIONS_GLOBAL` | `false` | Si true, todos los usuarios |
| `PERSEO_INVENTORY_OPTIONS_ALLOWLIST` | vacío | Teléfonos canary (coma-separados) |
| `RAG_P0_ENABLED` | `false` | Master RAG |
| `RAG_INVENTORY_ENABLED` / `RAG_RULES_ENABLED` | `false` | Subflags RAG |
| `RAG_P0_ALLOWLIST` | vacío | Canary RAG |
| `RAG_DOMAIN_ROUTING_ENABLED` | `false` | Clasificador + orchestrator dominio |
| `RAG_ADAPTIVE_THRESHOLD_ENABLED` | `false` | Umbrales por dominio |
| `RAG_DOMAIN_THRESHOLDS_JSON` | vacío | JSON opcional umbrales |
| `RAG_HYBRID_ENABLED` | `false` | FTS + vector RRF |
| `RAG_RC12_CAMPAIGN_ENTITY_VALIDATION_ENABLED` | `false` | Gate entidad campaña |

## Flags ATENA (CDC)

| Variable | Default | Rol |
|----------|---------|-----|
| `KNOWLEDGE_CDC_WORKER_ENABLED` | `false` | Procesar `knowledge_reindex_jobs` |

Migración CDC: `supabase/migrations/20260721220000_knowledge_reindex_cdc.sql`  
Worker: `scripts/knowledge/processKnowledgeReindexJobs.mjs`  
Migración hybrid: `supabase/migrations/20260722120000_knowledge_hybrid_search.sql`

## KPIs GO canary / producción (congelados)

| KPI | Umbral |
|-----|--------|
| Opciones con link resoluble (muestra) | ≥95% |
| Listings / precios / URLs inventados | 0 |
| Anti-PII audit | 0 |
| Freshness lag p95 CDC | documentado y sin jobs stuck |
| Certificación funcional | PASS antes de GLOBAL |
| Wrong-domain / hallucination en muestra canary | 0 |
| CRM writes desde RAG | 0 |

## Rollout

1. Deploy código PERSEO + migraciones ATENA (flags OFF).
2. Cobertura Knowledge Store ≥95% publicables + CDC staging.
3. Canary allowlist 1–3 teléfonos QA:
   ```text
   PERSEO_INVENTORY_OPTIONS_ENABLED=true
   PERSEO_INVENTORY_OPTIONS_GLOBAL=false
   PERSEO_INVENTORY_OPTIONS_ALLOWLIST=<phones>
   RAG_P0_ENABLED=true
   RAG_INVENTORY_ENABLED=true
   RAG_RULES_ENABLED=true
   RAG_P0_ALLOWLIST=<phones>
   RAG_DOMAIN_ROUTING_ENABLED=true
   RAG_ADAPTIVE_THRESHOLD_ENABLED=true
   RAG_HYBRID_ENABLED=true
   RAG_RC12_CAMPAIGN_ENTITY_VALIDATION_ENABLED=true
   ```
4. Smoke: renta, venta, PROPERTY_QA, objeción, campaña, sin stock → fallback.
5. `node scripts/qa/perseoFunctionalCertification.js` → PASS.
6. CDC worker prod si staging OK.
7. Expandir allowlist 48–72h → `GLOBAL=true` solo tras KPIs verdes.
8. Rollback: todas las flags `false`.

## Suites unitarias baseline (deben permanecer verdes)

```bash
node --test test/ragService.test.js test/ragRulesService.test.js \
  test/inventoryOptionsAndBuySide.test.js test/ragCanaryP0.test.js
```

## Contrato

Ver `docs/architecture/BACKEND_KNOWLEDGE_UTILIZATION_100.md`.
