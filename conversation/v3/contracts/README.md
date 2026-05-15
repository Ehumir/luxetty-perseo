# Contratos V3 (`conversation/v3/contracts`)

Los contratos ejecutables viven como módulos CommonJS + JSDoc:

| Contrato | Módulo |
|----------|--------|
| Estado conversacional | `types/conversationState.js`, `types/constants.js` |
| Decisión interpretada | `types/conversationDecision.js` |
| Reglas duras | `rules/ruleGuard.js` |
| Etapas | `stages/stageEngine.js` |
| Identidad | `identity/identityResolver.js` |
| Composición | `composer/composerStub.js` (stub F1) |

No hay TypeScript en runtime; los typedefs sirven para IDE y documentación.
