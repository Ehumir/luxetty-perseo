# ARGOS — Scenario Versioning v1

**Estado:** Aprobado (sin código — convención de repo)  
**Ubicación canónica:** `docs/argos/scenarios/`

---

## 1. Objetivo

Que cada comportamiento conversacional esperado sea **reproducible**, **comparable en el tiempo** y **vinculado a un build** de PERSEO, sin depender de Postman ad hoc ni evidencia local en `docs/argos/evidence/` (gitignored).

---

## 2. Convención de nombres de archivo

```text
docs/argos/scenarios/
  DEMAND_002_FULL.v1.json
  DEMAND_002_SLOTS.v1.json
  HUMANITY_001.v1.json
  manifest.json
```

| Parte | Significado |
|-------|-------------|
| `{SCENARIO_CODE}` | Código estable (`DEMAND_002_FULL`, no `DEMAND_002` ambiguo) |
| `.v{MAJOR}` | Versión mayor del contrato del escenario |
| `manifest.json` | Índice de escenarios activos, prioridad, tags |

---

## 3. Esquema JSON del escenario (v1)

```json
{
  "schema_version": "1.0",
  "scenario_code": "DEMAND_002_FULL",
  "scenario_version": 1,
  "priority": "P0",
  "family": "demand",
  "category": "compra_demanda_e2e",
  "title": "Compra Cumbres 5M con nombre y consentimiento",
  "description": "E2E legítimo a CRM_READY; requiere turno nombre explícito.",
  "messages": [
    "Hola",
    "Busco casa en Cumbres",
    "Tengo presupuesto de 5 millones",
    "Jorge",
    "Sí, que me contacte un asesor"
  ],
  "flags": {
    "deterministic_mode": true,
    "crm_dry_run": true
  },
  "expected": {
    "intent": "buy",
    "lead_type": "demand",
    "conversation_stage": "CRM_READY",
    "crm_ready": true,
    "advisor_contact_consent": "ACCEPTED",
    "should_create_contact": true,
    "should_create_lead": true
  },
  "must_not": {
    "invent_property": true,
    "invent_price": true,
    "invent_link": true,
    "send_whatsapp": true,
    "write_contacts": true,
    "write_leads": true,
    "use_requests_table": true,
    "robotic_response": false,
    "repeated_phrase": true,
    "hard_template_response": true,
    "forced_handoff": true
  },
  "human_review": {
    "natural_flow_success": true,
    "notes": "Validar tono en turno handoff manualmente hasta HUMANITY automation."
  },
  "changelog": [
    { "version": 1, "date": "2026-05-18", "change": "Split from DEMAND_002; nombre en turno 4 obligatorio." }
  ]
}
```

---

## 4. Reglas de versionado semántico

| Cambio | Acción |
|--------|--------|
| Nuevo mensaje en `messages` | **major++** si altera stage esperado; else minor en changelog |
| Nuevo campo en `expected` más estricto | **major++** |
| Relajar `expected` (degradación) | **major++** + requiere justificación producto |
| Solo `must_not` adicional | **minor** (mismo major, changelog) |
| Renombrar `scenario_code` | Nuevo archivo; deprecar anterior con `"deprecated": true` en manifest |

---

## 5. manifest.json

```json
{
  "manifest_version": 1,
  "updated_at": "2026-05-18",
  "suites": {
    "P0": ["DEMAND_001.v1", "DEMAND_002_FULL.v1", "DEMAND_002_SLOTS.v1", "..."],
    "P1": ["..."],
    "P2": ["..."],
    "HUMANITY": ["HUMANITY_001.v1", "..."]
  },
  "deprecated": []
}
```

Script futuro (ARGOS-1.1): `node scripts/argos-run-suite.js --suite P0` lee manifest y llama `run-scenario` por archivo.

---

## 6. Integración con run-scenario

**Hoy (ARGOS-1):** body Postman manual.

**Próximo paso (sin ARGOS-2):** script lee JSON y POST a Railway.

```json
{
  "phone_sim": "5218100000999",
  "flags": { "deterministic_mode": true, "crm_dry_run": true },
  "scenario": { /* contenido del archivo sin schema_version wrapper */ }
}
```

Incluir en response/log: `scenario_code`, `scenario_version`, `build_sha` (desde health).

---

## 7. Regresión y CI

| Nivel | Qué corre |
|-------|-----------|
| PR PERSEO | P0 subset (≤8 escenarios) contra mock o QA si label `argos` |
| Nightly QA | manifest `P0` + `P1` |
| Pre-release | `P0` + `HUMANITY` P0 |

Cada bugfix PR debe **añadir o bump** al menos un archivo en `docs/argos/scenarios/`.

---

## 8. Qué no versionar en git

| Artefacto | Ubicación |
|-----------|-----------|
| Resultados de corrida | `docs/argos/evidence/` (gitignored) |
| Exports Postman environment | local / 1Password |
| Traces completos masivos | adjunto en issue, no repo |

---

## 9. Relación con ARGOS-2

Cuando existan tablas `argos_scenarios`:

- `scenario_code` + `scenario_version` = unique key
- JSON en repo = **source of truth**; DB = cache/sync para UI
- Migración seed desde `docs/argos/scenarios/*.json`

---

*ARGOS Scenario Versioning v1 — convención obligatoria junto con Conversational Training Strategy v1.*
