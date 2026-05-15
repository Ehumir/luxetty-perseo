# PERSEO Conversational Core V3 — `conversation/v3/`

**Fase:** V3-F1 — núcleo paralelo en código; **sin** imports productivos desde `index.js` hasta rollout (F5+).

## Propósito

Núcleo conversacional desacoplado (state, interpreter, rule guard, composer). El motor **legacy** permanece en `conversation/*.js` fuera de esta carpeta.

## Contenido (F1)

| Directorio | Rol |
|------------|-----|
| `types/` | `ConversationState`, `ConversationDecision`, enums |
| `state/` | `stateManager` — merges puros + guard |
| `rules/` | `ruleGuard` — invariantes sin side effects |
| `stages/` | `resolveNextStage` determinista |
| `identity/` | `resolveIdentityState` |
| `interpreter/` | `mockInterpreter` (tests/harness solamente) |
| `composer/` | Stub de contrato de redacción |
| `crm/` | Placeholder F6 |
| `core/` | `v3Logger`, `shadowHarness` |
| `contracts/` | Índice documental de contratos |
| `qa/` | Notas de fixtures V3 |

## Otras carpetas `*/v3/` (F0)

| Carpeta | Rol |
|---------|-----|
| `orchestrator/v3/` | Orquestación futura (paralela a `index.js`) |
| `state/v3/` | Placeholder de modelos de estado |
| `handlers/v3/` | Handlers por canal |
| `qa/v3/` | Harness QA de repo |

## Reglas

- No cablear CRM, multimedia ni webhooks hasta la fase aprobada en `docs/sprints/perseo-conversational-core-v3-roadmap.md`.
- Evitar crecer plantillas en `index.js` / `contextualMemoryResolver.js`; evolución conversacional nueva → aquí.

## Documentación

- `docs/sprints/perseo-v3-f0-legacy-freeze.md`
- `docs/sprints/perseo-v3-f1-conversational-core.md`

## Flags

`config/perseoEngine.js`, `config/perseoV3Flags.js`, `.env.example`.
