# PR-M2-02 — Pre-PR Report (Corpus Foundation v1)

**Branch:** `feat/m2-02-corpus-foundation`  
**Date:** 2026-05-19  
**Tipo:** Tooling offline / batch — **cero impacto runtime WhatsApp**

---

## 1. Archivos modificados / creados

| Área | Archivos |
|------|----------|
| Contrato | `docs/argos/contracts/ConversationRecordV1.md` |
| Core | `corpus/constants.js`, `outcomeHash.js`, `validateConversationRecord.js`, `dedupe.js` |
| Parsers | `corpus/parsers/{md,txt,csv,json,docx,pdf}Parser.js`, `_shared.js`, `index.js` |
| CLI | `scripts/corpus-validate.js` |
| Fixtures | `docs/argos/corpus/fixtures/*` (9 archivos) |
| Suite meta | `docs/argos/suites/corpus-p0.json` |
| Tests | `test/corpusFoundation.test.js` |
| Índice | `docs/argos/datasets/corpus-index.yaml` (+ `scripts/generate-corpus-index.js`) |
| Package | `package.json` (`corpus-validate`, `test:corpus`) |

**No tocado:** `conversation/v3/*`, webhooks, ATENA, Supabase, ARGOS scenario runner runtime.

---

## 2. Contrato ConversationRecordV1

Ver `docs/argos/contracts/ConversationRecordV1.md`.

Campos raíz: `record_schema_version`, `corpus_id`, `source`, `metadata`, `turns`, `labels`, `promotion`, `attachments`, `risk_tags`, `policy_tags`, `outcome_hash`.

**Promotion statuses:** `indexed` | `candidate` | `promoted` | `rejected` | `wont_automate` — **prohibido** `auto_promoted`.

---

## 3. Ejemplos parseados por formato

| Formato | corpus_id | turns | outcome_hash |
|---------|-----------|-------|----------------|
| MD | FIXTURE-MD-001 | 3 | `a2781893d7c2925a` |
| TXT | FIXTURE-TXT-001 | 3 | `3d9a6d64749d2d73` |
| CSV | FIXTURE-CSV-001 | 3 | `3d3e071567287d2f` |
| JSON | FIXTURE-JSON-001 | 2 | `08cb278b4be2d8e0` |

Ejecutar: `node scripts/corpus-validate.js` para ver hashes en batch.

---

## 4. Resultado `corpus-validate`

```
corpus-validate: PASS
  by_format: {"md":1,"txt":1,"csv":1,"json":6}
  records: 9
  valid: 6
  expected_invalid: 3
  unexpected_invalid: 0
  dedupe_duplicates: 1 (FIXTURE-DUP-A / FIXTURE-DUP-B)
```

---

## 5. Reporte dedupe

| outcome_hash | corpus_ids |
|--------------|------------|
| `3aec01cdd1a360d8` | FIXTURE-DUP-A, FIXTURE-DUP-B |

Algoritmo: `corpus/outcomeHash.js` (SHA-256 truncado 16 hex sobre turns normalizados + metadata + labels).

---

## 6. Cambios `corpus-index.yaml`

211 entradas regeneradas con campos M2-02:

- `import_batch_id: legacy-tipologia-v1`
- `turn_count: 0` (índice tipología sin transcript aún)
- `outcome_hash` (derivado de `behavior_cluster`)
- `promotion_status` (`promoted` | `candidate` | `indexed`)
- `scenario_candidate_id` (null o scenario_code)
- `last_exploratory_run_id: null`
- `policy_tags: []`

---

## 7. Regresión

| Check | Resultado |
|-------|-----------|
| `npm run test:corpus` | **7/7 PASS** |
| `npm run corpus-validate` | **PASS** |
| `npm run test:argos` | **33/33 PASS** |
| `npm run test:perseo` | **103/103 PASS** |
| `release-p0` | **7/7** |
| `release-p1` | **11/11** |
| `policy-p0` | **8/8** |
| `cross-intent-p0` | **6/6** |
| `humanity-p0` | **2/2** |
| `reg-sticky-p0` | **2/2** |
| `reg-short-msg-p0` | **1/1** |
| `humanity-handoff-p0` | **2/2** |

---

## 8. Baseline `npm test`

| Métrica | Valor |
|---------|-------|
| tests | **716** (+7 corpus) |
| pass | **709** |
| fail | **7** (legacy baseline sin delta) |

---

## 9. Riesgos

1. **Índice regenerado** — diff grande en YAML; sin cambio semántico en entradas existentes salvo campos nuevos.
2. **Parser heurístico** — MD/TXT asumen formatos documentados; corpus real puede requerir ajustes incrementales.
3. **DOCX/PDF** — stub; ingest real en bloque posterior.
4. **Sin auto-promote** — operadores deben promover manualmente vía PR de escenarios.

---

## 10. Cero impacto runtime

- Módulo `corpus/` **no importa** `conversation/v3`, Express ni webhooks.
- Flags M2-01 **no leídos** por corpus tooling.
- `corpus-validate` y tests son **offline/batch** únicamente.
