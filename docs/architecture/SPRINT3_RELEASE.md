# Sprint 3 Release — PERSEO RAG Integration (Flags OFF)

## Qué se implementó

PERSEO puede consultar el Knowledge Store de forma controlada:

- `services/ragService.js` — retrieval semántico vía RPC, ContextPack, logging sin PII
- `services/ragInventoryService.js` — resolución de inventario vía `match_property_chunks`
- `services/ragRulesService.js` — recuperación de reglas vía `match_knowledge_chunks`
- `conversation/v3/rag/` — `buildContextPack`, `ragPolicy`, `contextBudget`
- Rama única en `propertyInventoryService.resolveInboundPropertyReference()` detrás de `RAG_INVENTORY_ENABLED`
- Suite ARGOS `rag-acc-p0.v1` (30 escenarios definidos, 53 tests automatizados PASS)

## Qué NO se implementó

- Conversation Memory
- Hybrid Search / Reranking / Knowledge Graph
- Planner / Agentic AI / MCP tool calls
- Integración RAG en pipeline de respuesta al usuario
- Nuevos canales (Facebook, Instagram gateway)
- Cambios CRM, leads, assignments, WhatsApp webhook

## Qué quedó protegido

- Jerarquía de flags: `RAG_P0_ENABLED` → Inventory / Rules
- Fallback legacy obligatorio (timeout 1.2s, RPC fail, score bajo, propiedad oculta)
- `ragPolicy` bloquea claims sin citation
- Retrieval solo vía RPC (nunca SQL directo a tablas knowledge)
- Logging: `rag_query_logs` + `retrieval_citations` (hash de query, sin teléfonos ni prompts)

## Qué permanece apagado

```
RAG_P0_ENABLED=false
RAG_INVENTORY_ENABLED=false
RAG_RULES_ENABLED=false
```

## Qué cambia con Flags OFF

**Nada.** Comportamiento 100% idéntico al pre-Sprint 3. WhatsApp, CRM, pipeline y property resolution legacy sin alteración observable.

## Qué cambiará cuando exista Sprint 4+

Sprint 4+ (no autorizado) podría cablear ContextPack al compositor de respuesta, activar reglas en pipeline, y eventualmente canary con flags ON. Eso requiere autorización explícita separada.

---

Certificación: `docs/argos/evidence/acc-rag-p0-sprint3/SPRINT3_CERTIFICATION.json`  
Restore point: `docs/argos/evidence/acc-rag-p0-sprint3/RESTORE_POINT_SPRINT3.md`
