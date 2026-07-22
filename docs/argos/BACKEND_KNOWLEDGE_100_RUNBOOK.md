# Runbook — Backend Knowledge Utilization 100% (canary → prod)

## Flags Railway (PERSEO)

| Variable | Default | Rol |
|----------|---------|-----|
| `PERSEO_INVENTORY_OPTIONS_ENABLED` | `false` | Master inventario demanda |
| `PERSEO_INVENTORY_OPTIONS_GLOBAL` | `false` | Si true, todos los usuarios |
| `PERSEO_INVENTORY_OPTIONS_ALLOWLIST` | vacío | Teléfonos canary (coma-separados) |
| `RAG_P0_ENABLED` | `false` | Master RAG |
| `RAG_INVENTORY_ENABLED` / `RAG_RULES_ENABLED` | `false` | Subflags RAG |
| `RAG_P0_ALLOWLIST` | vacío | Canary RAG |

## Flags ATENA (CDC)

| Variable | Default | Rol |
|----------|---------|-----|
| `KNOWLEDGE_CDC_WORKER_ENABLED` | `false` | Procesar `knowledge_reindex_jobs` |

Migración: `supabase/migrations/20260721220000_knowledge_reindex_cdc.sql`  
Worker: `scripts/knowledge/processKnowledgeReindexJobs.mjs`

## Rollout

1. Deploy código PERSEO + aplicar migración ATENA (flags OFF).
2. Canary: allowlist 1–3 teléfonos QA → `PERSEO_INVENTORY_OPTIONS_ENABLED=true`.
3. Validar: renta/venta opciones con link; PROPERTY_QA precio/zona; anti-PII.
4. Activar CDC worker en staging, luego prod.
5. Expandir allowlist → `GLOBAL=true` solo tras cert funcional PASS.
6. Rollback: poner flags `false` (respuesta vuelve a handoff sin inventario).

## KPIs GO producción

- Certificación funcional PASS
- Anti-PII audit = 0
- Freshness lag p95 aceptable / jobs CDC no stuck
- 0 CRM writes desde RAG
- Hallucination / wrong-domain = 0 en muestra canary

## Contrato

Ver `docs/architecture/BACKEND_KNOWLEDGE_UTILIZATION_100.md`.
