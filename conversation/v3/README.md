# PERSEO Conversational Core V3 — `conversation/v3/`

**Fase:** V3-F1 — contratos ejecutables + tests; evolución F2+ vive aquí sin ampliar legacy.

## Propósito

Núcleo conversacional desacoplado: estado, intérprete, rule guard, stages, composer. El motor **legacy** permanece en `conversation/*.js` fuera de esta carpeta.

## Contratos F1 (`contracts/`)

Validación de forma para:

- `ConversationState` — etapa, identidad, goals, slots económicos
- `ConversationDecision` — intención, confianza, flags de acción
- Stages / goals / intents / slot names
- `RuleGuardResult` — invariantes offer↔demand, humano, CRM, inventario
- Salida composer — `responseText`, `followUpQuestion`, `toneFlags`

Ver `contracts/README.md` y `require('./contracts')`.

## Capas

| Directorio | Rol |
|------------|-----|
| `types/` | Factories y typedefs |
| `contracts/` | Validadores F1 (sin side effects) |
| `state/` | Merge + bridge legacy |
| `rules/` | `evaluateRuleGuard` |
| `stages/` | `resolveNextStage` |
| `identity/` | `resolveIdentityState` |
| `interpreter/` | `minimalInterpreter` (+ mock para harness) |
| `composer/` | `humanComposer` + `composerStub` (contrato) |
| `planner/` | F3+ handoff / qualification |
| `crm/` | Dry-run F3 (sin write F6) |
| `core/` | `v3Runtime`, `v3InboundBridge`, shadow |

## Webhook y producción (importante)

`index.js` **ya importa** `v3InboundBridge` (F2+). Eso **no** activa V3 para todos los contactos:

| Condición | Ruta |
|-----------|------|
| `PERSEO_V3_ENABLED=false` o allowlist vacía | **legacy primary** |
| `PERSEO_V3_ENABLED=true` + teléfono en `PERSEO_V3_QA_ALLOWLIST` | **v3 primary** |

F1 **no añade** cableado nuevo al webhook. Operador prod estable: ver Etapa 0 §3 en `perseo-etapa-0-congelamiento-control.md`.

## Flags

| Variable | Rol |
|----------|-----|
| `PERSEO_V3_ENABLED` | **Maestro operativo** |
| `PERSEO_V3_QA_ALLOWLIST` | Allowlist QA |
| `PERSEO_V3_SHADOW_MODE` | Sombra (legacy responde) |
| `PERSEO_ENGINE` | Efectivo `legacy`; `v3` = log reservado |
| `PERSEO_ENGINE_V2` | OpenAI engine legacy (**distinto**) |

`PERSEO_CONVERSATIONAL_CORE_V3_ENABLED` — solo alias en documentación (roadmap).

## Documentación

- `docs/sprints/perseo-v3-f1-conversational-core.md`
- `docs/sprints/perseo-etapa-0-congelamiento-control.md`
- `docs/sprints/perseo-conversational-core-v3-roadmap.md`

## Tests F1

```bash
npm test -- test/v3F1Contracts.test.js test/v3ConversationCore.test.js test/v3EngineAndFlags.test.js
```

Suite completa: `npm test`.
