# PR: V3-F0 — Congelamiento y contención del core legacy (PERSEO)

## Objetivo

Ejecutar **V3-F0** del roadmap conversacional: congelar el motor legacy, documentar alcance y riesgos, preparar carpetas `*/v3/` en paralelo, e introducir **`PERSEO_ENGINE`** (`legacy` | `v3` reservado) **sin** activar V3 ni cambiar lógica comercial, prompts, CRM, multimedia, parser u orquestador.

## Alcance

- Estructura oficial paralela: `conversation/v3/`, `orchestrator/v3/`, `state/v3/`, `handlers/v3/`, `qa/v3/` (README en cada una).
- Documentación: `docs/sprints/perseo-v3-f0-legacy-freeze.md` + actualización menor en `perseo-conversational-core-v3-roadmap.md` (tabla de flags).
- `config/perseoEngine.js` + export `getPerseoEngineRuntime` vía `config/env.js`.
- Log `server_started` ampliado con campos `perseo_engine_*`.
- `scripts/check-perseo-sprint2-env.js` + `.env.example` documentan `PERSEO_ENGINE`.
- Comentarios **V3-F0 LEGACY FREEZE** en puntos calientes (sin cambiar comportamiento): `index.js` (cabecera + `buildConsultiveFallbackReply`), `playbooks.js`, `conversationOrchestrator.js`, `parsers.js`, `conversationEngineV2.js`.
- Test unitario: `test/perseoEngineConfig.test.js`.

## Archivos modificados / agregados

- `config/env.js`
- `config/perseoEngine.js` **(nuevo)**
- `index.js`
- `conversation/playbooks.js`
- `conversation/conversationOrchestrator.js`
- `conversation/parsers.js`
- `conversation/conversationEngineV2.js`
- `scripts/check-perseo-sprint2-env.js`
- `.env.example`
- `conversation/v3/README.md` **(nuevo)**
- `orchestrator/v3/README.md` **(nuevo)**
- `state/v3/README.md` **(nuevo)**
- `handlers/v3/README.md` **(nuevo)**
- `qa/v3/README.md` **(nuevo)**
- `docs/sprints/perseo-v3-f0-legacy-freeze.md` **(nuevo)**
- `docs/sprints/perseo-conversational-core-v3-roadmap.md`
- `test/perseoEngineConfig.test.js` **(nuevo)**

## Pruebas realizadas

- `npm test` (suite completa `node --test`).
- `node scripts/check-perseo-sprint2-env.js` (verificar JSON incluye nuevos campos).

## Riesgos

- Operadores que configuren `PERSEO_ENGINE=v3` antes de tiempo: el runtime **sigue siendo legacy**; `server_started` y el script de env muestran `perseo_engine_v3_reserved_ignored: true`.
- Confusión entre `PERSEO_ENGINE_V2` (OpenAI engine) y `PERSEO_ENGINE` (legacy vs V3): documentado en freeze doc; nombres distintos a propósito.

## Rollback

- Revert del merge o redeploy del SHA anterior.
- Quitar o ignorar `PERSEO_ENGINE` (default = legacy).

## Fuera de alcance

- Implementación del motor V3, shadow mode, stage engine, composer, cambios ATENA, migraciones Supabase, cambios a prompts, cambios a CRM/assignment/multimedia/parser/orquestador más allá de comentarios de política.
