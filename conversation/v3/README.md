# PERSEO Conversational Core V3 — `conversation/v3/`

**Fase:** V3-F0 (estructura paralela; **sin** imports productivos desde `index.js` todavía).

## Propósito

Contratos e implementación futura del núcleo conversacional (state, interpreter, rule guard, composer). El motor **legacy** permanece en `conversation/*.js` fuera de esta carpeta.

## Reglas

- No cablear aquí CRM, multimedia ni webhooks hasta las fases aprobadas en `docs/sprints/perseo-conversational-core-v3-roadmap.md`.
- Cambios de lógica conversacional nueva: preferir esta área tras F1; evitar crecer plantillas en `index.js` / `contextualMemoryResolver.js`.

## Relación con otras carpetas `*/v3/`

| Carpeta | Rol |
|---------|-----|
| `orchestrator/v3/` | Orquestación inbound/outbound futura (paralela a `index.js` + `conversationOrchestrator.js`). |
| `state/v3/` | Modelos / merges de estado protegido (paralelo a `aiState.js` + `stateUpdater.js`). |
| `handlers/v3/` | Handlers por canal o tipo de mensaje. |
| `qa/v3/` | Harness y fixtures QA específicos de V3. |
