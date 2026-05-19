## Objetivo

Crear la base offline para importar, normalizar, validar, deduplicar y gobernar conversaciones masivas sin convertir cada plática en un escenario ARGOS rígido.

## Incluye

- `ConversationRecordV1` (`docs/argos/contracts/ConversationRecordV1.md`)
- Parsers MD / TXT / CSV / JSON (`corpus/parsers/*`)
- Stubs DOCX / PDF (`NOT_IMPLEMENTED`)
- CLI `scripts/corpus-validate.js` + `npm run corpus-validate`
- Dedupe por `outcome_hash` (`corpus/dedupe.js`, `corpus/outcomeHash.js`)
- Fixtures corpus (`docs/argos/corpus/fixtures/`, 9 archivos)
- `corpus-index.yaml` extendido (211 entradas: `import_batch_id`, `turn_count`, `outcome_hash`, `promotion_status`, etc.)
- `npm run test:corpus` + suite meta `corpus-p0`

## Resultados

| Check | Resultado |
|-------|-----------|
| `test:corpus` | 7/7 PASS |
| `corpus-validate` | PASS |
| `test:argos` | 33/33 PASS |
| `test:perseo` | 103/103 PASS |
| Suites ARGOS (release-p0/p1, policy, cross, humanity, reg-*) | PASS |
| `npm test` (flags OFF) | 709/716 pass, **7 fail** (= baseline legacy en `main`) |

**Cero regresión** en runtime conversacional.

## Puntos importantes

- **No auto-promote** — `promotion.status` prohibe `auto_promoted`; promoción a escenario solo manual vía PR separado.
- DOCX/PDF: stub `NOT_IMPLEMENTED` únicamente.
- **Tooling offline** — sin webhooks ni flags M2-01.
- **Sin impacto runtime WhatsApp.**
- `corpus/` **no importa** `conversation/v3`.

## Riesgos

- Diff grande de YAML por extensión de campos en `corpus-index.yaml` (regenerado, sin cambio semántico en rails).
- Parsers heurísticos (MD/TXT); corpus real puede requerir ajustes incrementales.
- Dedupe inicial por `outcome_hash`, no similitud semántica avanzada.

## Fuera de alcance

ARGOS-2, ATENA, migraciones, Supabase, DOCX/PDF real, multimedia, CRM execute, dashboards, runtime WhatsApp, auto-promoción de escenarios.

## Test plan

- [ ] CI: `npm run test:corpus` + `npm run corpus-validate`
- [ ] CI: `npm run test:argos` + regresión suites existentes
- [ ] Confirmar que deploy no activa ningún path `corpus/` en producción

## Docs

- `docs/argos/PRE_PR_M2_02_REPORT.md`
- `docs/argos/contracts/ConversationRecordV1.md`
