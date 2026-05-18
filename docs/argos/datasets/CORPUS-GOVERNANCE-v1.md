# ARGOS — Corpus Governance v1

**Estado:** Activo  
**Artefacto maestro:** `corpus-index.yaml`  
**Relacionado:** `PERSEO-ARGOS-COVERAGE-STRATEGY-v1.md`, `ARGOS-CONVERSATIONAL-TRAINING-STRATEGY-v1.md`

---

## 1. Propósito

El **corpus index** cataloga las ~210 pláticas documentadas (y futuras) como **referencia gobernada**, separada de los **~70 escenarios ARGOS congelados** que endurecen comportamiento en CI.

**PERSEO no memoriza scripts.** El índice describe **capacidades** a entrenar, no transcripts obligatorios.

---

## 2. Dimensiones de clasificación (cruce obligatorio)

Una fila del corpus se evalúa en **cinco ejes** independientes:

| Eje | Pregunta | Ejemplo mismo `buy` demand |
|-----|----------|---------------------------|
| **Intención / rail** | ¿Qué negocio? | compra abierta vs anclada a LUX |
| **Dificultad / familia F*** | ¿Qué tan ordenado? | F1 estructurado vs F4 fragmentado |
| **Personalidad** | ¿Cómo habla el humano? | racional vs cortante vs evasivo |
| **Emoción / confianza** | ¿Qué tono exige PERSEO? | calmado vs ansioso vs desconfiado |
| **Riesgo operativo** | ¿Qué puede romper? | inventario, loop, CRM, ownership |

Dos entradas con mismo `intent` **pueden** requerir escenarios ARGOS distintos si difieren en personalidad o riesgo.

---

## 3. Campos obligatorios por entrada

Ver comentarios en cabecera de `corpus-index.yaml`. Resumen:

| Grupo | Campos |
|-------|--------|
| Metadata | `corpus_id`, `source_document`, `category`, `rail`, `priority_candidate` |
| Conversacional | `intent`, `operation_type`, `conversation_stage`, `outcome`, `slots_present`, `slots_missing` |
| Perfil humano | `personality_type`, `emotional_profile`, `difficulty_level`, `trust_level`, `verbosity`, `cooperativeness` |
| Riesgo | `hallucination_risk`, `loop_risk`, `crm_risk`, `ownership_risk` |
| ARGOS | `promoted_to_scenario`, `scenario_code`, `regression_critical`, `reusable_patterns` |
| Governance | `family`, `typology_block`, `behavior_cluster`, `dedup_key`, `status` |

`behavior_cluster` agrupa pláticas similares del corpus (~25 por bloque tipología).  
`dedup_key` es único por entrada (`corpus_id`) — evita falsos positivos de “duplicado” en el índice.

---

## 4. Detección de duplicados

### 4.1 `behavior_cluster` (agrupación)

```text
{rail}|{intent}|{outcome}|{family}|{personality_type}|{difficulty_level}
```

Muchas filas del corpus comparten cluster (esperado). Solo **1** escenario ARGOS promoted por cluster.

| Regla | Acción |
|-------|--------|
| Misma `dedup_key`, mismo `corpus_id` prefix block | **Redundante** — marcar `status: duplicate_candidate` |
| Misma `dedup_key`, distinto bloque tipología | Revisar manual — puede ser variante legítima de wording |
| >3 entradas activas misma `dedup_key` | **Consolidar** — 1 oro en corpus, resto `archived` |

### 4.2 Comando

```bash
node scripts/validate-corpus-index.js --duplicates
```

---

## 5. Detección de gaps

### 5.1 Matriz de cobertura

Cada combinación **crítica** debe tener ≥1 entrada `status: active` con `priority_candidate: P0|P1`:

| Rail | Familias mínimas | Personalidades mínimas |
|------|------------------|------------------------|
| demand | F1, F2, F4, F5 | cooperative, evasive, blunt, emotional |
| offer | F1, F4, F5 | cooperative, skeptical, emotional |
| property | F2 | cooperative, blunt |
| humanity | — | all HUMANITY arquetipos |
| chaos | F8 | — |
| edge | F6, F7 | — |

### 5.2 Comando

```bash
node scripts/validate-corpus-index.js --gaps
```

Emite `coverage_gaps` en stderr si falta celda crítica.

---

## 6. Promoción a escenario ARGOS

### 6.1 Criterios (todas requeridas)

1. **Outcome único** no cubierto por escenario ya `promoted_to_scenario: true`.
2. **Regresión** — bug real, riesgo P0, o gate de release.
3. **Contrato claro** — `expected` + `must_not` definibles sin relajar.
4. **Aprobación QA** en PR (checkbox manifest).

### 6.2 Anti-caos

| Límite | Valor |
|--------|-------|
| Escenarios promoted totales | **≤ 70** (objetivo año 1) |
| Nuevos promoted por sprint | **≤ 5** |
| Promoted por misma `dedup_key` | **1** |

### 6.3 Des-promoción

`status: deprecated` en escenario JSON + `promoted_to_scenario: false` en corpus; nunca borrar `corpus_id`.

---

## 7. Flujo operativo

```text
Nueva plática documentada
  → Agregar fila corpus-index (PR pequeño, solo datasets/)
  → validate-corpus-index.js
  → Si gap/bug → promover a scenario (PR separado PERSEO)
  → manifest + suite release-p0 si P0
```

---

## 8. Regeneración del índice

El archivo `corpus-index.yaml` se genera desde `scripts/generate-corpus-index.js` para mantener consistencia de bloques A–H / A–D.

**Edición manual:** solo `promoted_to_scenario`, `scenario_code`, `notes`, `status` override — el script preserva overrides vía `corpus-overrides.yaml` (futuro).

---

## 9. Referencias fuente

| `source_document` | Contenido |
|-------------------|-----------|
| `tipologia-captadores` | Bloques A–H, ~100 pláticas |
| `tipologia-compradores` | Bloques A–D, ~100 pláticas |
| `matriz-qa-captacion` | Matriz QA captación |
| `matriz-qa-compradores` | Matriz QA compradores |
| `perseo-qa-matrix-s5` | IDs 1–50 legacy (mapeo parcial) |
| `manual-qa` | Entradas ad hoc |

---

*Corpus Governance v1 — no sustituye juicio humano en copy HUMANITY.*
