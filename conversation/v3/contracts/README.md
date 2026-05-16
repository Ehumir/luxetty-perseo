# Contratos V3 (`conversation/v3/contracts`)

Validadores **puros** (sin red, sin CRM, sin webhook) para el núcleo F1.

| Módulo | Función |
|--------|---------|
| `conversationState.contract.js` | `validateConversationState`, `createInitialConversationState` |
| `conversationDecision.contract.js` | `validateConversationDecision`, `createEmptyDecision` |
| `goalsAndStages.contract.js` | `validateStage`, `validateConversationGoal`, `validateIntent`, `validateSlotName` |
| `ruleGuard.contract.js` | `validateRuleGuardResult`, `runRuleGuardContract` |
| `composer.contract.js` | `validateComposerOutput`, `runComposerContract` |
| `productionIsolation.contract.js` | `describeV3ProductionGate`, `isProductionSafeV3Config` |

## Flag operativo

- **Real (runtime):** `PERSEO_V3_ENABLED`
- **Alias documental:** `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED` (roadmap; no leer en código hasta F1+ alias explícito)

## Producción

`index.js` importa `v3InboundBridge`, pero **V3 primary solo corre** con `PERSEO_V3_ENABLED=true` y número en `PERSEO_V3_QA_ALLOWLIST`. Con flags por defecto (`.env.example`), prod permanece **legacy primary**.

## Tests

- `test/v3F1Contracts.test.js`
- `test/v3ConversationCore.test.js`
- `test/v3EngineAndFlags.test.js`
