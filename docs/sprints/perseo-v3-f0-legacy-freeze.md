# V3-F0 — Congelamiento y contención del core legacy (PERSEO)

**Sprint:** V3-F0  
**Objetivo:** estabilizar, contener, documentar y preparar `*/v3/` **sin** nuevas capacidades conversacionales, **sin** cambiar CRM/multimedia/parser/orquestador productivos.

**Referencias:** `docs/sprints/perseo-conversational-core-v3-roadmap.md`, política ATENA (no nueva funcionalidad hasta base estable).

---

## 1. Estado actual del core (resumen)

| Capa | Entrada productiva | Notas |
|------|-------------------|--------|
| Webhook | `index.js` (`POST` WhatsApp) | Persistencia mensajes, `ai_state`, gatekeeper, engine V2, fallback consultivo, CRM phase, outbound |
| QA | `conversation/qaCommands.js`, `qaSprint1Commands.js` | `!reset`, `!state`, `!close`, `!leadcheck` (allowlist) |
| Estado | `conversation/aiState.js`, `stateUpdater.js` | Merge incremental; riesgo de drift con muchos parches |
| Señales | `conversation/parsers.js`, `intent.js`, `multiSignalExtractor.js` | Comportamiento productivo **intacto** en F0 |
| OpenAI | `conversationEngineV2.js`, `conversationOrchestrator.js`, `perseoConsultantPrompt.js` | Sin cambios de prompts en F0 |
| Plantillas / fallback | `index.js` (`buildConsultiveFallbackReply`), `contextualMemoryResolver.js`, `responseBuilder.js`, `r0ContextContinuity.js` | **Congelados** para evolución; solo hotfix |
| CRM | `runCleanOrchestratorCrmPhase` en `index.js`, `services/leadAutomation.js`, `contactProvisioning.js` | **No tocar** en F0 |
| Multimedia | `mediaIngestion.js`, `inboundMediaStorageIngest.js`, `mediaSignals.js` | **No tocar** en F0 |
| Política / humano | `perseoGatekeeper.js`, ATENA `ai_conversation_channel_settings` | Fuente de verdad backend |

---

## 2. Alcance legacy — archivos productivos y política

### 2.1 Legacy productivo (corazón conversacional)

- `index.js` — orquestación principal.
- `conversation/conversationEngineV2.js`
- `conversation/conversationOrchestrator.js`
- `conversation/perseoConsultantPrompt.js`
- `conversation/parsers.js`, `conversation/intent.js`, `conversation/stateUpdater.js`, `conversation/aiState.js`
- `conversation/contextualMemoryResolver.js`, `conversation/responseBuilder.js`, `conversation/realEstateAdvisorReply.js`
- `conversation/playbooks.js`, `conversation/nextStep.js`
- `conversation/r0ContextContinuity.js`, `conversation/antiLoopGuardrails.js`, `conversation/namePrompt.js`, `conversation/nameFirstGuardrail.js`
- `conversation/leadEntryPointRouter.js`, `conversation/propertyIntentResolver.js`, `conversation/propertySpecificFlow.js`
- `conversation/perseoGatekeeper.js`, `conversation/routeEvaluator.js`, `conversation/searchRules.js`
- `conversation/qaCommands.js`, `conversation/qaSprint1Commands.js`
- `conversation/mediaSignals.js`, `conversation/mediaIngestion.js`, `conversation/inboundReliability.js`, `conversation/contextFusion.js`, `conversation/contextPreservation.js`

### 2.2 No tocar salvo **hotfix** (definición)

Cambios solo si: seguridad, legal, caída de webhook, pérdida de datos CRM, o bug **P0** con ticket y plan de rollback. Cada hotfix debe:

1. Documentar por qué escapa de la congelación.  
2. Preferir revert tras parche temporal.  
3. No añadir “mejoras de tono” ni nuevos playbooks bajo esta vía.

### 2.3 Deprecado pero activo (`deprecated but active`)

- `buildConsultiveFallbackReply` y ramas consultivas en `index.js`: siguen en producción; **deprecación = no crecer**, no apagar.
- `conversation/r0ContextContinuity.js`: capa de guard sobre legacy; no expandir; migrar lógica a V3 cuando exista rule guard + composer.

### 2.4 Flujos que siguen siendo productivos (sin cambio F0)

Inbound texto → estado → (V2 u orquestador) → outbound; comandos QA; modo humano (sin respuesta PERSEO); modo IA; CRM create/reuse; multimedia condicionada por env existentes.

---

## 3. Preparado para V3 (F0)

| Elemento | Ubicación |
|----------|-----------|
| Carpetas paralelas | `conversation/v3/`, `orchestrator/v3/`, `state/v3/`, `handlers/v3/`, `qa/v3/` (README en cada una) |
| Flag motor | `PERSEO_ENGINE` vía `config/perseoEngine.js` (efectivo siempre `legacy` en F0; `v3` reservado) |
| Log arranque | `server_started` en `index.js` incluye `perseo_engine_*` para auditoría operativa |

---

## 4. Explícitamente prohibido tocar (F0; salvo hotfix §2.2)

- Lógica comercial y reglas de negocio ya acordadas en CRM/assignment.
- Prompts en `perseoConsultantPrompt.js` (strings sistema).
- Comportamiento de `parseMessageSignals` / heurísticas de intención salvo P0.
- Decisiones del orquestador OpenAI (JSON paths) salvo P0.
- Flujos multimedia y storage.
- Creación de leads/contactos salvo P0.

---

## 5. Deuda conocida y riesgos

| Deuda / riesgo | Nota |
|----------------|------|
| Plantillas + fallback | Tonos rígidos (“una frase”, anglicismos) — se atiende en V3-F4 Composer, no con más `if` aquí |
| `operation_type` vs comprador/vendedor | Semántica heredada en `intent.js` — R1/V3 state contract |
| Duplicación consultiva | `index.js` vs `contextualMemoryResolver` — strangler V3 |
| **Riesgo F0:** confusión operativa si alguien pone `PERSEO_ENGINE=v3` esperando motor nuevo | Mitigación: efectivo `legacy` + log `perseo_engine_v3_reserved_ignored: true` |

---

## 6. Estrategia de migración (recordatorio)

1. F0 — congelar + flags + docs (este sprint).  
2. F1 — contratos en `conversation/v3/` + tests sin webhook.  
3. F2+ — stage/identity, shadow, allowlist (ver roadmap).

---

## 7. Rollback

- Revert del commit F0 o redeploy del SHA anterior en Railway.  
- Variables: quitar `PERSEO_ENGINE` o dejarla en `legacy` (comportamiento idéntico al pre-F0).  
- No hay migraciones de schema en F0.

---

## 8. QA manual obligatorio (regresión cero esperada)

| # | Caso | Criterio |
|---|------|----------|
| 1 | `Hola` | Misma familia de respuesta que antes |
| 2 | `Info` / `Información` | Igual |
| 3 | `Me interesa` | Igual |
| 4 | `Quiero vender mi casa` | Igual pipeline |
| 5 | `Busco casa en Cumbres` | Igual |
| 6–9 | `!reset`, `!state`, `!leadcheck`, `!close` | Mismo comportamiento (allowlist QA) |
| 10 | Conversación en atención humana | PERSEO no responde |
| 11 | Modo IA permitido | PERSEO responde |
| 12 | Flujo lead/contacto | Sin regresión en creación/reuso |
| 13 | `npm test` | PASS |
| 14 | Snapshots automatizados | N/A en repo (no jest snapshots) |
| 15 | Build / deploy | Sin script `build` en `package.json`; `node --test` + arranque servidor |

---

## 9. Entregables de este documento

Lista de archivos tocados: ver **PR description** y `git diff --name-only` del branch F0.

**Confirmaciones F0:**

- No se cambia lógica de negocio conversacional en ramas productivas de código (solo comentarios + config motor + logs arranque + docs + carpetas).
- `npm test` debe PASS en CI/local tras el PR.
