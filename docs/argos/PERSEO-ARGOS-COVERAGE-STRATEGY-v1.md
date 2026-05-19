# PERSEO — Estrategia oficial de cobertura conversacional ARGOS v1

**Versión:** 1.0  
**Estado:** Propuesta ejecutiva — arquitectura y operación  
**Fecha:** 2026-05-18  
**Audiencia:** Producto, QA, ingeniería PERSEO  
**Prerrequisitos:** ARGOS-1 en `main`, S1 (`DEMAND_002_FULL`) mergeado, Training Strategy v1, Scenario Versioning v1  

**Documentos fuente (corpus humano):**

| Corpus | Volumen | Tipología | Uso en esta estrategia |
|--------|---------|-----------|------------------------|
| Captación (oferta) | ~100 pláticas | Bloques A–H | Familias F1–F8 carril oferta |
| Compradores (demanda) | ~100 pláticas | Bloques A–D | Familias F1–F8 carril demanda |
| **Total referencia** | **~200–210** | 12 bloques × perfiles | **Dataset**, no 210 escenarios CI |

**Principio rector:** ARGOS-TDD obliga regresión por **comportamiento**, no por **transcripción literal** de cada plática del catálogo.

---

## Resumen ejecutivo

| Pregunta | Respuesta oficial |
|----------|-------------------|
| ¿Convertir los 210 a JSON? | **No.** ~45–70 escenarios ejecutables en CI + corpus indexado + composición. |
| ¿Cómo escalar sin caos? | Olas por familia (F1–F8), PRs de 3–8 escenarios, suite runner por manifest. |
| ¿Qué bloquea release? | Suite **P0** (8–12 escenarios) al 100% en Railway QA. |
| ¿Dónde vive la “verdad”? | `manifest.json` + escenarios versionados + `datasets/corpus/*.yaml` (referencia). |

---

# 1. Estrategia de cobertura conversacional

## 1.1 Modelo de tres capas

```text
┌─────────────────────────────────────────────────────────────────┐
│ CAPA A — Corpus documentado (~210 pláticas, MD/DOCX en proyecto)   │
│ Rol: inventario, tipología, lenguaje real, backlog de gaps         │
│ NO corre en CI; se indexa y muestrea                               │
└───────────────────────────────┬─────────────────────────────────┘
                                │ mapeo 1:N (familia + tags)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ CAPA B — Specs ejecutables (~45–70 escenarios ARGOS en repo)      │
│ Rol: regresión, release gate, ARGOS-TDD por bug                    │
│ JSON versionado + manifest suites P0/P1/P2/HUMANITY/EDGE/CHAOS   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ opcional: derive / fuzz (QA manual)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ CAPA C — Exploración (futuro ARGOS-2 / sampling)                  │
│ Rol: ampliar wording sin congelar 210 contratos                   │
│ Runs no bloqueantes; métricas HUMANITY                            │
└─────────────────────────────────────────────────────────────────┘
```

**Regla anti-redundancia:** un escenario ARGOS = **una hipótesis de comportamiento** verificable en `expected` + `must_not`. Si dos pláticas del corpus prueban lo mismo (p. ej. “compra Cumbres 5M con nombre”), comparten **un** escenario canónico y el resto queda como **variante documentada** en el corpus (`corpus_ref`), no como archivo duplicado.

## 1.2 Taxonomía oficial de prioridad

| Nivel | Propósito | % del “comportamiento real” objetivo | % del corpus ~210 | Escenarios CI objetivo | Gate |
|-------|-----------|--------------------------------------|---------------------|------------------------|------|
| **P0** | Supervivencia comercial + seguridad | **~25–30%** (paths que generan 80% del valor/riesgo) | ~8–12 casos oro traducidos | **8–12** | **100% pass** cada deploy QA |
| **P1** | Cobertura operativa diaria | **+25–30%** acumulado (~55%) | ~25–35 representantes por familia | **25–35** | **≥90%** suite P0+P1 |
| **P2** | Amplitud, campañas, rarezas | **+15–20%** acumulado (~70–75%) | resto muestreado por familia | **15–25** | ≥85% + triage semanal |
| **HUMANITY** | Tono, naturalidad, anti-robótico | Transversal (100% de replies revisables) | 5 arquetipos × 2 carriles | **8–12** (manual+heurística v1) | No bloquea CRM; bloquea percepción V1 |
| **EDGE** | Ownership, CRM reuse, duplicados, reset | **~5%** casos pero **alto impacto** legal/ops | casos F6–F7 | **6–10** | 100% en P1 de edge |
| **CHAOS** | Anti-loop, flooding, jailbreak, spam | **~3%** | bloque H / F8 | **3–5** | 100% en P0 para anti-loop |

**Nota:** el 25–30% de P0 no significa “solo 30% de frases”; significa que **con ~12 escenarios** cubrimos los **outcomes** críticos (intent lock, slots, consent, CRM gate, no inventar, handoff). El 100% del corpus se cubre **progresivamente** vía P1/P2 + muestreo, no en el primer trimestre.

## 1.3 Dimensiones de división (ortogonales)

| Dimensión | Valores | Escenario típico |
|-----------|---------|------------------|
| **Carril** | `demand`, `offer`, `property`, `cross` | Prefijo `DEMAND_`, `OFFER_`, `PROP_` |
| **Familia tipología** | F1…F8 (roadmap V3 §1.1) | Tag `family:F3` |
| **Outcome** | `crm_ready`, `handoff_only`, `qa_only`, `blocked` | `expected.crm_ready` |
| **Slot bajo prueba** | identity, zone, budget, consent, listing | Escenario **unitario** 3–4 turnos |
| **Arquetipo usuario** | cortante, emocional, confundido, agresivo, evasivo | Tag + suite HUMANITY |
| **Modo entrada** | orgánico, código LUX, pauta Meta (futuro F7) | Tag `entry:listing_code` |

## 1.4 Transformación corpus → ARGOS ejecutable

| Paso | Acción | Responsable |
|------|--------|-------------|
| 1 | Clasificar plática del corpus: familia F*, carril, bloque A–H | QA + producto |
| 2 | Extraer **outcome esperado** (no transcript obligatorio) | QA |
| 3 | Si outcome ya cubierto → `corpus_ref` en escenario existente | Dev |
| 4 | Si gap nuevo → nuevo `SCENARIO_CODE` + PR | Dev (ARGOS-TDD) |
| 5 | Wording alternativo → variante en `datasets/variants/` o mensaje en changelog | QA opcional |

**Criterio de promoción a P0:** el fallo del escenario habría causado **pérdida de lead**, **CRM incorrecto**, **inventario falso** o **bloqueo de release**.

---

# 2. Uso oficial de los ~210 ejemplos

## 2.1 Rol del corpus

| Rol | ¿Sí? | Detalle |
|-----|------|---------|
| Dataset oficial de referencia | **Sí** | Fuente de verdad narrativa; vive en docs/sprints + archivos compartidos (DOCX/MD). |
| 210 JSON en repo | **No** | Mantenimiento insostenible; divergencia con producto. |
| Índice machine-readable | **Sí** | `docs/argos/datasets/corpus-index.yaml` (~210 filas, 15 campos). |
| Generación automática de variantes | **Parcial** | Solo **surface forms** (ortografía, slang); **no** outcomes. |
| Resumen/agrupación | **Sí** | Por familia F* y bloque tipología; 1 “caso oro” por grupo. |

## 2.2 Arquitectura escalable del corpus

```yaml
# docs/argos/datasets/corpus-index.yaml (ejemplo fila)
- id: CAP-A-012          # estable, no renumera
  source: captacion
  typology_block: A
  family: F1
  title: "Venta feliz — nombre tarde"
  rail: offer
  goal: SELL_PROPERTY
  promoted_scenario: OFFER_001   # null si aún no hay spec
  tags: [structured, identity_late]
  status: indexed | promoted | deprecated
```

**Flujo:**

1. **210 filas** en índice (ligero, reviewable en PR).
2. **~50–70 promoted** a `scenarios/{rail}/*.v1.json` cuando hay contrato `expected`.
3. **Variantes lingüísticas** en `datasets/variants/{SCENARIO_CODE}.yaml`:

```yaml
scenario_code: DEMAND_002_FULL
base_messages_ref: scenarios/demand/DEMAND_002_FULL.v1.json
variants:
  - id: slang-norte-01
    messages_override:
      4: "me llamo jorge"
      5: "simon que me contacten"
  - id: typo-budget
    messages_override:
      3: "tengo como 5 millones mas o menos"
```

Runner futuro: `--variant slang-norte-01` (no en CI por defecto; nightly QA).

## 2.3 Qué NO hacer

| Anti-patrón | Por qué |
|-------------|---------|
| 1 plática = 1 JSON obligatorio | Explosión de PRs; mismos bugs duplicados. |
| Expected relajado para “pasar” | Destruye ARGOS-TDD. |
| Variantes automáticas de stage/consent | Falsos positivos/negativos masivos. |
| OpenAI generando escenarios sin revisión | No reproducible; no auditable. |

## 2.4 Cobertura del corpus sin 210 archivos

| Mecanismo | Cobertura estimada del corpus |
|-----------|-------------------------------|
| 12 escenarios P0 (familias críticas) | ~15% pláticas, **~80% outcomes críticos** |
| 35 escenarios P1 | +35% pláticas representadas |
| 20 escenarios P2 + edge | +25% |
| Muestreo manual mensual (20 pláticas) | resto auditado sin congelar |
| WhatsApp QA allowlist (20 pláticas reales) | validación humana V1 milestone |

**Meta realista año 1:** **~70 escenarios congelados** + índice 210 **100% mapeado** (`promoted_scenario` o `gap` explícito).

---

# 3. Estructura de escenarios ARGOS

## 3.1 Árbol de directorios (propuesta oficial)

```text
docs/argos/
  PERSEO-ARGOS-COVERAGE-STRATEGY-v1.md    # este documento
  ARGOS-CONVERSATIONAL-TRAINING-STRATEGY-v1.md
  ARGOS-SCENARIO-VERSIONING-v1.md
  scenarios/
    manifest.json
    _schema/
      scenario.v1.schema.json            # JSON Schema (validación CI)
    demand/
      DEMAND_001.v1.json
      DEMAND_002_FULL.v1.json
      DEMAND_002_SLOTS.v1.json
      ...
    offer/
      OFFER_001.v1.json
      ...
    property/
      PROP_001.v1.json
      ...
    humanity/
      HUMANITY_001.v1.json
      ...
    chaos/
      CHAOS_001.v1.json
      ...
    edge/
      EDGE_001.v1.json
      ...
    regression/                          # bugs de producción con ID issue
      REG-ARGOS-42.v1.json
  datasets/
    corpus-index.yaml
    variants/
      DEMAND_002_FULL.variants.yaml
    fragments/                           # mensajes reutilizables
      greetings.yaml
      consent_accept.yaml
      consent_decline.yaml
      handoff_triggers.yaml
  suites/
    release-p0.json                      # lista explícita + thresholds
    nightly-p1.json
```

**Compatibilidad:** escenarios en raíz `scenarios/` pueden migrarse por PR incremental; `manifest` referencia path relativo.

## 3.2 Naming

| Elemento | Convención | Ejemplo |
|----------|------------|---------|
| Código | `{RAIL}_{NNN}` o `{RAIL}_{NNN}_{QUALIFIER}` | `DEMAND_002_FULL`, `DEMAND_002_SLOTS` |
| Archivo | `{CODE}.v{MAJOR}.json` | `DEMAND_002_FULL.v1.json` |
| Regresión bug | `REG-{issue}.v1.json` | `REG-ARGOS-87.v1.json` |
| Variante | `{CODE}@{variant_id}` en runner | `DEMAND_002_FULL@slang-norte-01` |

## 3.3 Metadata extendida (v1.1 schema)

```json
{
  "schema_version": "1.1",
  "scenario_code": "DEMAND_002_FULL",
  "scenario_version": 1,
  "priority": "P0",
  "family": "demand",
  "category": "compra_demanda_e2e",
  "tags": ["F1", "F3", "identity", "consent", "crm_ready"],
  "typology": { "rail": "demand", "block": "A", "corpus_ids": ["DEM-A-001", "DEM-A-014"] },
  "title": "...",
  "description": "...",
  "messages": [],
  "flags": { "deterministic_mode": true, "crm_dry_run": true },
  "expected": {},
  "must_not": {},
  "human_review": {},
  "changelog": []
}
```

## 3.4 Manifest y suites

`manifest.json` evoluciona a:

```json
{
  "manifest_version": 2,
  "scenarios": {
    "demand/DEMAND_002_FULL.v1.json": {
      "priority": "P0",
      "tags": ["F1", "crm_ready"],
      "suite": ["release-p0", "demand-core"]
    }
  },
  "suites": {
    "release-p0": {
      "paths": ["demand/DEMAND_002_FULL.v1.json", "..."],
      "threshold": { "pass_rate": 1.0 }
    },
    "nightly-p1": { "threshold": { "pass_rate": 0.9 } }
  }
}
```

## 3.5 Fragments y composición (fase 2 — no bloqueante v1)

```json
{
  "scenario_code": "DEMAND_004",
  "compose": {
    "prefix": "fragments/greeting_buy.yaml",
    "body": ["Busco en San Pedro", "¿qué tienen?"],
    "suffix": null
  },
  "expected": { "conversation_stage": "QUALIFYING" }
}
```

**Inheritance:** `extends: DEMAND_002_FULL` con `messages_override` en turnos 3–4 (reduce copy-paste). Implementar en `argos-run-suite.js` cuando haya >30 escenarios.

## 3.6 `expected` y `must_not` — perfiles por tipo

| Tipo escenario | expected mínimo | must_not mínimo |
|--------------|-----------------|-----------------|
| E2E CRM | stage, crm_ready, consent, slots, would_create/reuse | invent_*, writes, whatsapp |
| Slot unit | stage, slot parcial, crm_ready false | writes |
| Property QA | listing context, no crm_ready prematuro | invent_price, invent_property |
| HUMANITY | human_review flags | robotic, repeated, hard_template |
| CHAOS | error_code o max_turns | send_whatsapp |
| EDGE | ownership pass o documented warn | wrong_owner_assignment |

---

# 4. Estrategia de variantes

## 4.1 Matriz manual vs automático vs plantilla

| Dimensión | Manual (obligatorio CI) | Plantilla / tipología | Automático (nightly, no gate) |
|-----------|-------------------------|------------------------|-------------------------------|
| Flujo stage/consent/CRM | ✓ escenario oro | ✓ `extends` | ✗ |
| Intent / lead_type | ✓ | ✓ familia F* | ✗ |
| Nombre, zona, budget slots | ✓ 1 oro + 1 negativo | ✓ fragments | ortografía menor |
| Slang regio (“simón”, “nel”) | 1 por carril en P1 | variants YAML | fuzz léxico |
| Errores ortográficos | 2–3 en P2 | variants | generador typo |
| Mensajes incompletos (“5m”, “?”) | ✓ P1 | tipología B | ✗ |
| Usuario sin nombre | ✓ DEMAND_002_SLOTS | plantilla | ✗ |
| Repite pregunta 10× | ✓ CHAOS | — | simulación loop |
| Agresivo / insulto | ✓ HUMANITY + handoff | copy guidelines | ✗ |
| Emocional / premium | ✓ HUMANITY_004 | corpus ref | ✗ |
| Cambio de tema | ✓ HUMANITY_005 | explicit_flow_switch | ✗ |
| Audio / imagen | P2 (post F8) | tag `media:audio` | mock transcript |
| Cambio compra↔venta | ✓ P1 sticky | rule_guard tests | ✗ |

## 4.2 Arquetipos HUMANITY (oficial)

| ID | Comportamiento usuario | Assert v1 | Assert v2 (ARGOS-2) |
|----|------------------------|-----------|---------------------|
| H1 Amable | coopera, saluda | manual transcript | robotic heuristic |
| H2 Confundido | “no entiendo” | no loop stage | repeated openings |
| H3 Cortante | monosílabos | brevedad | max_chars |
| H4 Emocional | ansiedad/urgencia | empatía + next step | sentiment guard |
| H5 Cambiante | switch rent/buy | confirm o switch flag | flow_switch trace |
| H6 Evasivo | no da nombre | no CRM_READY | slot persistence |
| H7 Agresivo | insulto | handoff sin escalar | toxicity template |
| H8 Repetidor | misma pregunta | no identical reply ×N | anti-loop |

## 4.3 Regla de oro de variantes

> **Solo se automatiza lo que no cambia el contrato de `expected`.**  
> Si la variante puede cambiar `conversation_stage` o `consent`, es escenario manual separado o variante **explícitamente listada** con `expected` propio.

---

# 5. Roadmap realista

## Fase 1 — Plataforma y P0 (semanas 1–3)

**Objetivo:** suite release bloqueante, runner, índice corpus iniciado.

| # | Entregable | Escenarios |
|---|------------|------------|
| 1 | `argos-run-suite.js --suite release-p0` | — |
| 2 | Migrar layout `scenarios/{rail}/` | — |
| 3 | P0 demanda | DEMAND_001, 002_FULL, 002_SLOTS, 004 |
| 4 | P0 oferta | OFFER_001 |
| 5 | P0 property | PROP_003 |
| 6 | P0 chaos | CHAOS_001 |
| 7 | P0 humanity | HUMANITY_001 (manual review) |
| 8 | `corpus-index.yaml` | 210 filas mapeadas (status: indexed) |

**PRs:** 1 PR infra (runner + manifest v2 + schema); luego **PRs de 3–5 escenarios** cada uno.

**Gate:** P0 100% Railway QA post-deploy.

## Fase 2 — P1 olas D1/O1 (semanas 4–8)

| Ola | Escenarios nuevos (~3–6 por PR) |
|-----|----------------------------------|
| D1 demanda anclada | DEMAND_005, 006, PROP_001, 002 |
| O1 oferta estructurada | OFFER_002, 003, 004 |
| P1 edge | EDGE_001 |
| HUMANITY | 002, 003 |

**Gate:** P0+P1 ≥ 90%; corpus ≥ 40% `promoted`.

## Fase 3 — Amplitud P2 + familias B–D (semanas 9–16)

| Bloque | +15–20 escenarios |
|--------|-------------------|
| Ambigüedad F4 | DEMAND/OFFER mensajes cortos |
| Objeciones F5 | OFFER comisión, DEMAND precio |
| Delicado F6 | legal, premium |
| CRM F7 | reuse lead, reset session |
| Variants YAML | top 10 escenarios P0/P1 |

**Gate:** ~70 escenarios; corpus ≥ 65% promoted o `wont_automate` justificado.

## Fase 4 — Mejora continua (mes 4+)

| Práctica | Frecuencia |
|----------|------------|
| Cada bug conversacional → `REG-*` o extensión escenario | Por ticket |
| Suite nightly P1+P2 | Diario |
| Muestreo 20 pláticas corpus no promoted | Semanal QA |
| Métricas HUMANITY en hoja de run | Semanal |
| WhatsApp allowlist 20 pláticas | Hito V1 producto |
| ARGOS-2 UI | Tras 4 semanas P0 100% |

## 5.1 Tamaño de PR y sprint

| Métrica | Valor recomendado |
|---------|-------------------|
| Escenarios por PR | **3–5** (máx. 8 si solo JSON) |
| Líneas PERSEO por PR bugfix | Separado: 1 comportamiento + 1 escenario |
| Escenarios por sprint (2 sem) | **10–15** nuevos o promovidos |
| Tiempo suite P0 en Railway | < 2 min (objetivo) |

## 5.2 Comandos operativos (objetivo)

```bash
npm run test:argos                              # unit + escenarios embebidos
node scripts/argos-run-suite.js --suite release-p0 --local
PERSEO_BASE_URL=... ARGOS_SERVICE_SECRET=... \
  node scripts/argos-run-suite.js --suite release-p0 --remote
node scripts/argos-run-demand002-full.js --remote   # smoke canónico
```

## 5.3 Anti-regresión

| Capa | Mecanismo |
|------|-----------|
| CI | `test:argos` + escenarios críticos en memoria |
| Pre-release QA | `release-p0` remote 100% |
| Bug | Issue ARGOS template + `REG-*` escenario |
| Degradar expected | major++ + aprobación producto |

---

# 6. Riesgos reales

## 6.1 Técnicos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Runner lento (CRM dry-run × N) | CI/QA fricción | Paralelizar; cache session; P0 solo |
| Supabase QA distinto a prod | falsos fail pass | Documentar seeds; ownership warn OK |
| `deterministic_mode` ≠ WhatsApp real | gaps en prod | 20 pláticas allowlist humanas |
| Fragment/composer no implementado | deuda copy-paste | Fase 2; hasta entonces DRY manual |

## 6.2 Operativos

| Riesgo | Mitigación |
|--------|------------|
| PRs gigantes de escenarios | Límite 5/PR; manifest auto-check |
| QA agotado revisando 210 | Solo P0 gate; P1 sample |
| Secret/flags Railway drift | Health check en suite |
| Dos verdades (MD corpus vs JSON) | `corpus-index.yaml` único índice |

## 6.3 Mantenimiento

| Riesgo | Mitigación |
|--------|------------|
| Escenarios obsoletos | `deprecated` en manifest; changelog obligatorio |
| Versionado major caótico | Reglas en ARGOS-SCENARIO-VERSIONING |
| 210 filas índice sin dueño | QA owner actualiza `promoted_scenario` |

## 6.4 Falsos positivos / negativos

| Tipo | Causa | Mitigación |
|------|-------|------------|
| FP | must_not semántico agresivo | Ajustar heurística; human_review |
| FN | expected demasiado laxo | No relajar; split escenario |
| FP | variantes slang en CI | Solo nightly |
| FN | Railway sin HANDOFF flag | `applyArgosSimulationEnv` documentado |

## 6.5 Sobre-entrenamiento / rigidez

| Riesgo | Señal | Contrapeso |
|--------|-------|------------|
| PERSEO “memoriza” 12 guiones | Pasa CI, falla WhatsApp | Allowlist real + HUMANITY |
| Copy idéntico siempre | repeated_phrase must_not | Composer variety rules |
| Rechaza frases válidas no en oro | Quejas usuarios | Variants nightly; no gate |
| Ingredientar más reglas if | Código ilegible | Familia F* + rule_guard acotado |

---

# 7. Recomendación oficial

## 7.1 Decisión

Adoptar **modelo de tres capas** (corpus indexado ~210 → **~70 escenarios congelados** → exploración muestreada) como **matriz conversacional oficial de PERSEO**, operada por **ARGOS-TDD** y suites versionadas.

**No** adoptar conversión 1:1 de las 210 pláticas a JSON.

## 7.2 Próximos pasos inmediatos (orden)

1. **`corpus-index.yaml`** — inventariar las 210 con `family`, `rail`, `promoted_scenario|null`.
2. **`argos-run-suite.js`** + `suites/release-p0.json`.
3. **Completar 6 JSON P0 faltantes** (001, 004, OFFER_001, PROP_003, CHAOS_001, HUMANITY_001) en PRs pequeños.
4. **Validar DEMAND_002_SLOTS** en Railway (negativo oficial).
5. **Rituales:** post-deploy `release-p0` remote; bug → `REG-*`.

## 7.3 Cómo ARGOS se vuelve mejora continua sostenible

| Pilar | Implementación |
|-------|----------------|
| **Contrato** | 4 puntos ARGOS-TDD por bug |
| **Prioridad** | P0 bloquea; P1 alerta; P2 informa |
| **Trazabilidad** | `corpus_ids` + `typology` en metadata |
| **Escala lingüística** | variants YAML, no nuevos outcomes |
| **Humano en el loop** | HUMANITY + 20 WhatsApp reales |
| **Visibilidad futura** | ARGOS-2 cuando P0 4 semanas verde |

## 7.4 Alineación con roadmap V3

Las **olas O/D/P** del roadmap V3 se mapean 1:1 a **suites ARGOS**, no a ramas de código por plática. Cada fase V3 (F4 campañas, F8 multimedia) añade **tags** y escenarios P1/P2, no reescribe P0.

---

## 7.5 Bloque futuro — Learning, Policy & Multimodal (no bloquea M1)

Tras **M1-D** y estabilización de `release-p1`, la escala conversacional no debe resolverse con más JSON congelados solamente. **Orden de ejecución post-M1:** `PERSEO-ARGOS-INTEGRATED-ROADMAP-v2.md`. El documento rector de arquitectura:

**`docs/argos/PERSEO-ARGOS-LEARNING-POLICY-MULTIMODAL-ROADMAP-v1.md`**

Resume arquitectura para:

- **Ingesta masiva** (JSON/MD/TXT/CSV/DOCX/PDF) → corpus vivo → promoción selectiva a escenarios.
- **Policy layer** — montos mínimos, zonas activas, descarte amable desde config/tablas (no hardcode).
- **Multimodal** — audio (transcript como turno), imagen (señales + confirmación).
- **Mensajes multintención** — `message → segments → response plan`.

Relación con capas §1.1: L0/L1 amplían Capa A; Capa P (Policy) es transversal; exploratory runs amplían Capa C.

---

## Referencias

- `docs/argos/PERSEO-ARGOS-LEARNING-POLICY-MULTIMODAL-ROADMAP-v1.md`
- `docs/argos/ARGOS-CONVERSATIONAL-TRAINING-STRATEGY-v1.md`
- `docs/argos/ARGOS-SCENARIO-VERSIONING-v1.md`
- `docs/sprints/perseo-conversational-core-v3-roadmap.md` (§1.1 familias F1–F8, olas)
- `docs/sprints/plan-oficial-perseo-madurez-conversacional-p0-p6.md`
- `docs/argos/scenarios/manifest.json`

---

*Documento de arquitectura v1.0 — listo para revisión de producto y ejecución en Fase 1 (P0 seed + suite runner).*
