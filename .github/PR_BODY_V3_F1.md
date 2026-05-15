# PR: V3-F1 — Núcleo conversacional V3 en paralelo (sin producción)

## Objetivo

Implementar **PERSEO Conversational Core V3** como módulos **reales y testeables** bajo `conversation/v3/`, con contratos (`ConversationState`, `ConversationDecision`), rule guard, stage engine, identidad, intérprete **mock**, composer **stub**, logger y shadow harness — **sin** cablear el webhook, **sin** OpenAI real, **sin** CRM, **sin** cambiar respuestas legacy.

**Base:** `main` con **V3-F0** ya mergeado (#51). Rama rebaseada sobre `origin/main` (sin conflictos pendientes).

## Alcance

- Árbol `conversation/v3/{types,state,rules,stages,identity,interpreter,composer,crm,core,contracts,qa}` + `index.js` barrel.
- `config/perseoEngine.js`, `config/perseoV3Flags.js`; export en `config/env.js`.
- `.env.example` + `scripts/check-perseo-sprint2-env.js` (observabilidad de flags).
- Documentación: `docs/sprints/perseo-v3-f1-conversational-core.md`.
- Tests: `test/v3ConversationCore.test.js`, `test/v3EngineAndFlags.test.js`.

## Fuera de alcance

- `index.js` orchestrator, `buildConsultiveFallbackReply`, playbooks, parsers productivos, CRM, multimedia, Meta, WhatsApp interactive, OpenAI real.

## Pruebas

- `npm test` — 502 passed (incl. V3 + tests F0).
- `node scripts/lint.js` — LINT_OK.

## Riesgos

- `shouldRouteInboundToV3Core()` puede ser `true` si ambos env están en modo “listo”; **ningún** código productivo lo invoca en F1.
- Mock interpreter ≠ comportamiento legacy; solo contrato y regresión V3.

## Rollback

Revert del commit o no desplegar; sin migraciones.
