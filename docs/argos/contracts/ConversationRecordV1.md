# ConversationRecordV1 — contrato corpus ARGOS

**Versión:** `1.0`  
**Estado:** Activo (PR-M2-02)  
**Alcance:** ingest offline / batch. **No** afecta runtime WhatsApp.

---

## Propósito

Modelo canónico para importar, validar, deduplicar y gobernar pláticas masivas sin auto-promoverlas a escenarios ARGOS.

**Promoción manual únicamente** — vía PR separado que congela `docs/argos/scenarios/*.v1.json`.

---

## Campos raíz

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `record_schema_version` | string | sí | Siempre `"1.0"` |
| `corpus_id` | string | sí | ID estable único en el índice |
| `source` | object | sí | Origen del archivo importado |
| `metadata` | object | sí | Hints de clasificación (no vinculantes) |
| `turns` | array | sí | ≥1 turno ordenado |
| `labels` | object | sí | Familias, outcomes, risk |
| `promotion` | object | sí | Estado de gobernanza |
| `attachments` | array | no | Adjuntos a nivel registro |
| `risk_tags` | string[] | no | Alias top-level de riesgo |
| `policy_tags` | string[] | no | Tags policy (`below_min_sale`, etc.) |
| `outcome_hash` | string | recomendado | Fingerprint dedupe (16 hex) |

---

## `source`

```json
{
  "format": "md | txt | csv | json",
  "file": "relative/path.md",
  "imported_at": "2026-05-19T12:00:00.000Z",
  "import_batch_id": "batch-2026-05-19-pilot"
}
```

`docx` / `pdf`: **stub** (`NOT_IMPLEMENTED`) — no usar en CI.

---

## `metadata`

```json
{
  "rail_hint": "offer | demand | property | humanity",
  "typology_block": "A",
  "language": "es-MX",
  "channel": "whatsapp"
}
```

---

## `turns[]`

| Campo | Tipo | Requerido |
|-------|------|-----------|
| `index` | number | sí (0..n-1) |
| `role` | string | sí: `user`, `assistant`, `system`, `tool` |
| `text` | string | sí, no vacío |
| `attachments` | array | no |
| `trace_ref` | string | no |

---

## `labels`

```json
{
  "families": ["F1"],
  "outcomes": ["qualification_partial"],
  "risk_tags": ["no_invent_price"]
}
```

---

## `promotion`

| `status` | Significado |
|----------|-------------|
| `indexed` | Importado al índice, sin candidatura |
| `candidate` | Candidato manual a escenario |
| `promoted` | Ya promovido (`promoted_scenario` requerido) |
| `rejected` | Rechazado para automatización |
| `wont_automate` | No se automatizará |

**Prohibido:** `auto_promoted` o cualquier promoción automática a `scenarios/`.

```json
{
  "status": "indexed",
  "promoted_scenario": null,
  "reject_reason": null
}
```

---

## `outcome_hash`

SHA-256 truncado (16 hex) sobre payload estable:

- `record_schema_version`
- `metadata.rail_hint`, `typology_block`, `channel`
- `labels` (families, outcomes, risk_tags, policy_tags)
- `turns[]` normalizados (`role` + texto lower/trim)

Implementación: `corpus/outcomeHash.js`.

---

## Parsers soportados

| Formato | Módulo | Notas |
|---------|--------|-------|
| MD | `corpus/parsers/mdParser.js` | Front-matter YAML + `**User:**` / bullet roles |
| TXT | `corpus/parsers/txtParser.js` | `[user]` o `user:` por línea |
| CSV | `corpus/parsers/csvParser.js` | columnas `corpus_id,role,text` |
| JSON | `corpus/parsers/jsonParser.js` | Record nativo |
| DOCX | stub | `NOT_IMPLEMENTED` |
| PDF | stub | `NOT_IMPLEMENTED` |

Adapter: `corpus/parsers/index.js`.

---

## Validación y dedupe

- `corpus/validateConversationRecord.js` — schema + turnos + promotion
- `corpus/dedupe.js` — duplicados por `outcome_hash` y `corpus_id`
- CLI: `node scripts/corpus-validate.js`

---

## Extensión `corpus-index.yaml`

Campos M2-02 por entrada:

| Campo | Descripción |
|-------|-------------|
| `import_batch_id` | Lote de import |
| `turn_count` | Turnos en record (0 si solo índice tipología) |
| `outcome_hash` | Fingerprint dedupe |
| `promotion_status` | `indexed` \| `candidate` \| `promoted` \| `rejected` \| `wont_automate` |
| `scenario_candidate_id` | Borrador / escenario candidato |
| `last_exploratory_run_id` | Último run exploratorio |
| `policy_tags` | Tags policy acumulados |

---

## Cero impacto runtime

Este contrato y tooling **no** importan `conversation/v3/*` ni webhooks WhatsApp.
