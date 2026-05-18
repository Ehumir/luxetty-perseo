## Resumen ejecutivo

**Corpus Governance v1** cataloga las **211 pláticas** del corpus de entrenamiento como referencia gobernada (`corpus-index.yaml`), separada de los **escenarios ARGOS congelados** que endurecen comportamiento en CI.

Este PR añade el índice, la gobernanza documentada, **5 escenarios P0 seed** nuevos, la suite **`release-p0`** (7 escenarios), el runner batch `argos-run-suite.js`, y el **contrato `expected.loop_detected`** en `scenarioRunner` para que `CHAOS_001` sea PASS cuando el anti-loop dispara correctamente.

**Sin workaround:** `CHAOS_001` permanece en `release-p0`. No se relaja `expected`. No se excluye del gate.

**Sin migraciones** · **Sin tablas `argos_*`** · **Sin cambios al motor conversacional V3** (solo contrato ARGOS del runner).

---

## Alcance

### Incluido

| Área | Entregable |
|------|------------|
| **Corpus** | `corpus-index.yaml` — **211 entradas** (99 offer + 95 demand + 5 property + 8 humanity + 1 chaos + 3 edge) |
| **Gobernanza** | `CORPUS-GOVERNANCE-v1.md` — dimensiones, duplicados, gaps, promoción (≤70 escenarios) |
| **Scripts** | `generate-corpus-index.js`, `validate-corpus-index.js`, `argos-run-suite.js` |
| **Suite gate** | `docs/argos/suites/release-p0.json` — **7 escenarios**, `pass_rate: 1.0` |
| **Escenarios nuevos** | `DEMAND_001`, `DEMAND_004`, `OFFER_001`, `PROP_003`, `CHAOS_001` (+ manifest) |
| **Runner fix** | `argos/scenarioRunner.js` — `expected.loop_detected: true` → loop es **éxito**, no violación |
| **Tests** | `argosCorpusGovernance.test.js`, `argosReleaseP0Suite.test.js` |

### Fuera de alcance

- ARGOS-2 (UI ATENA, tablas `argos_*`)
- Promoción masiva de las ~210 pláticas a JSON congelado
- `PERSEO-ARGOS-COVERAGE-STRATEGY-v1.md` (documento aparte; no bloquea este PR)
- Parche temporal que excluya `CHAOS_001` de `release-p0`

---

## Corpus — 211 entradas

Artefacto maestro: [`docs/argos/datasets/corpus-index.yaml`](../docs/argos/datasets/corpus-index.yaml)

```yaml
stats:
  total_entries: 211
  promoted_count: 7   # alineado con escenarios release-p0 + DEMAND_002_* existentes
```

Gobernanza: [`docs/argos/datasets/CORPUS-GOVERNANCE-v1.md`](../docs/argos/datasets/CORPUS-GOVERNANCE-v1.md)

```bash
node scripts/validate-corpus-index.js          # estructura + duplicados + gaps
node scripts/validate-corpus-index.js --duplicates
node scripts/validate-corpus-index.js --gaps
node scripts/generate-corpus-index.js        # regenerar desde plantillas de bloque
```

---

## Scripts

| Script | Uso |
|--------|-----|
| `scripts/generate-corpus-index.js` | Genera / regenera `corpus-index.yaml` desde bloques tipología |
| `scripts/validate-corpus-index.js` | Valida estructura, `dedup_key`, gaps de cobertura crítica |
| `scripts/argos-run-suite.js` | Ejecuta suite (`--suite release-p0`, `--local` / `--remote`, `--list`) |

```bash
# Local (gate completo — requiere PERSEO_ARGOS_ENABLED, V3, CRM_EXECUTE=false)
node scripts/argos-run-suite.js --suite release-p0

# Railway QA (post-merge + redeploy)
PERSEO_BASE_URL=https://luxetty-agent-production.up.railway.app \
ARGOS_SERVICE_SECRET=<secret> \
  node scripts/argos-run-suite.js --suite release-p0 --remote
```

---

## Suite `release-p0` — 7 escenarios

Definición: [`docs/argos/suites/release-p0.json`](../docs/argos/suites/release-p0.json)

| # | Escenario | Rol |
|---|-----------|-----|
| 1 | `DEMAND_001` | Demanda — apertura / slots mínimos |
| 2 | `DEMAND_002_FULL` | Demanda — flujo completo → `CRM_READY` (S1) |
| 3 | `DEMAND_002_SLOTS` | Demanda — slots parciales |
| 4 | `DEMAND_004` | Demanda — variante P0 |
| 5 | `OFFER_001` | Oferta — captación |
| 6 | `PROP_003` | Propiedad |
| 7 | **`CHAOS_001`** | **Anti-loop** — ver sección dedicada |

Umbral: **`pass_rate: 1.0`** (7/7 obligatorio tras deploy).

---

## `CHAOS_001` — nota explícita (sin ocultar el fallo actual)

### Diseño del escenario

- **8×** mensaje `"hola"`.
- **`expected.loop_detected: true`** — el escenario **provoca** respuestas idénticas hasta que el guard anti-loop de ARGOS dispara; el éxito es **detectar** el loop, no evitarlo.
- **`must_not`:** sin WhatsApp, sin writes CRM (igual que el resto de ARGOS QA).

### Diagnóstico aprobado (pre-PR)

| Pregunta | Respuesta |
|----------|-----------|
| ¿Es bug de PERSEO / V3? | **No.** El anti-loop funciona; V3 repite apertura (deuda HUMANITY aparte). |
| ¿Por qué FAIL en Railway hoy? | **Falso negativo del gate:** Railway build `51d75b4` usa `scenarioRunner` de `main` que **siempre** marca `LOOP_DETECTED` como violación, ignorando `expected.loop_detected`. |
| ¿Qué corrige este PR? | Si `expected.loop_detected === true`, el loop **no** se añade a `violations`; si no hay loop → `expected_loop_not_detected`. |

### Contrato en código

```javascript
// argos/scenarioRunner.js — turno con LOOP_DETECTED
if (expected.loop_detected !== true) {
  violations.push({ code: 'LOOP_DETECTED', turn: i + 1 });
}
```

### Estado Railway **antes** de merge (documentado, no workaround)

Ejecutado contra `https://luxetty-agent-production.up.railway.app` (build `51d75b4`):

| Gate | Resultado |
|------|-----------|
| **release-p0 comercial** (6 escenarios sin CHAOS) | **6/6 PASS** |
| **release-p0 completo** (incluye CHAOS) | **6/7** — único FAIL: `CHAOS_001` → `LOOP_DETECTED` turn 8 |
| **Causa** | Runner viejo en servidor, no escenario mal diseñado |

**No relajar `expected`. No quitar CHAOS. No excluir del suite.**

### Estado esperado **post-merge + redeploy**

| Gate | Esperado |
|------|----------|
| Local `argos-run-suite --suite release-p0` | **7/7 PASS** (verificado en rama) |
| Railway `--remote` | **7/7 PASS** tras desplegar este commit |

---

## Cambio en `scenarioRunner`

- `collectExpectedViolations`: assert `expected_loop_not_detected` si se esperaba loop y no ocurrió.
- Loop en turno N: violación solo si `expected.loop_detected !== true`.

---

## Tests

```bash
npm run test:argos   # 19/19 pass (incl. release-p0 local 7/7)
npm test             # 680/680 pass
```

| Suite | Qué valida |
|-------|------------|
| `argosCorpusGovernance.test.js` | Índice 211 entradas, validate script |
| `argosReleaseP0Suite.test.js` | `release-p0` local → `pass=7/7` |

---

## Railway QA — resumen gate

| Métrica | Pre-merge (main en Railway) | Post-merge (esta rama desplegada) |
|---------|----------------------------|-----------------------------------|
| Comercial (6 escenarios) | **6/6 PASS** | **6/6 PASS** (sin regresión esperada) |
| Completo con CHAOS | **6/7** — falso negativo runner | **7/7 PASS** |
| Build referencia pre-merge | `51d75b4` | — |

### Checklist post-merge (obligatorio)

- [ ] Merge a `main`
- [ ] **Redeploy Railway** (confirmar build ≠ `51d75b4` e incluye `f56347b` o posterior)
- [ ] `node scripts/argos-run-suite.js --suite release-p0 --remote`
- [ ] Confirmar **`pass=7/7`** y `CHAOS_001` → `ok: true`, `violations: []`
- [ ] Registrar build hash en comentario del PR o release note

---

## Archivos tocados (15)

```
argos/scenarioRunner.js
docs/argos/datasets/CORPUS-GOVERNANCE-v1.md
docs/argos/datasets/corpus-index.yaml
docs/argos/scenarios/{CHAOS_001,DEMAND_001,DEMAND_004,OFFER_001,PROP_003}.v1.json
docs/argos/scenarios/manifest.json
docs/argos/suites/release-p0.json
scripts/{generate-corpus-index,validate-corpus-index,argos-run-suite}.js
test/{argosCorpusGovernance,argosReleaseP0Suite}.test.js
```

---

## Relacionado

- S1 mergeado: `DEMAND_002_FULL` → `CRM_READY` en Railway (PR #81)
- Estrategia de cobertura (fuera de este diff): `PERSEO-ARGOS-COVERANCE-STRATEGY-v1.md`
- ARGOS-1 base: `.github/PR_BODY_ARGOS_1.md`
