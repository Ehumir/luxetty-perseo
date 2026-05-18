# ARGOS — Conversational Training Strategy v1

**Versión:** 1.0  
**Estado:** Aprobado — reglas obligatorias de equipo  
**Repositorio:** `luxetty-perseo` (motor) + coordinación ATENA (ARGOS-2 futuro)  
**Prerrequisito:** ARGOS-1 validado en QA Railway (health, auth, run-scenario, traces, no-write)  
**Relacionado:** `docs/sprints/argos-qa-plan-argos-0-1.md`, `docs/argos/ARGOS-1-PRE-PR-REPORT.md`, `ARGOS-2-UX-CONCEPT-v1.md`

---

## 1. Propósito

ARGOS deja de ser solo infraestructura de QA y pasa a ser el **sistema oficial de entrenamiento y regresión conversacional** de PERSEO.

**Objetivo:** madurar PERSEO hasta que conversaciones reales (WhatsApp) lleguen de forma natural a calificación completa, consentimiento y `CRM_READY`, con tono humano y sin inventar datos de inventario.

**ARGOS no reemplaza** el juicio humano en copy fino; **sí obliga** a que cada corrección de comportamiento sea reproducible, medible y regresable.

---

## 2. Regla obligatoria (adoptada oficialmente)

> **Cada bug conversacional corregido en PERSEO debe terminar con:**
>
> 1. **Escenario ARGOS reproducible** (`run-scenario` o `simulate-turn` documentado).
> 2. **`expected` definido** (estado, intents, flags CRM, stages).
> 3. **`must_not` definido** (técnico y/o semántico).
> 4. **Regresión automatizable** (`test:argos`, test V3, o assert en escenario).

**Sin estos cuatro elementos no se considera cerrado el bug** para fines de madurez conversacional.

### 2.1 Excepciones (muy acotadas)

| Caso | Qué se exige igualmente |
|------|------------------------|
| Hotfix producción crítico (caída, PII) | Escenario + regresión en **72 h** |
| Copy menor sin cambio de stage | Escenario HUMANITY o ampliación `must_not` |
| Solo infra (Railway, secret) | No aplica regla conversacional |

---

## 3. Metodología: ARGOS-TDD conversacional

### 3.1 Ciclo

```text
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. Escenario │───▶│ 2. FAIL      │───▶│ 3. Diagnóstico│
│   (JSON)     │    │  run-scenario│    │  debug_trace │
└──────────────┘    └──────────────┘    └──────┬───────┘
       ▲                                        │
       │         ┌──────────────┐    ┌──────────▼───────┐
       └─────────│ 6. Congelar  │◀───│ 4. Fix PERSEO   │
                 │   versión    │    │    (mínimo)     │
                 └──────────────┘    └──────────┬───────┘
                                                │
                                       ┌────────▼───────┐
                                       │ 5. PASS + tests │
                                       └────────────────┘
```

### 3.2 Orden de diagnóstico (siempre igual)

| # | Fuente | Pregunta |
|---|--------|----------|
| 1 | `parser_winner` | ¿Qué intent ganó este turno? |
| 2 | `conversation_snapshot` | ¿Stage, slots, consent? |
| 3 | `rule_guard_result` | ¿Sticky flow bloqueó algo legítimo? |
| 4 | `state_transition` | ¿Transición esperada? |
| 5 | `crm_gate_blockers` | ¿Por qué no CRM_READY? |
| 6 | `assignment_decision` | ¿Preview CRM coherente? |
| 7 | `must_not_violations` | ¿Inventó precio/código/URL? |
| 8 | Reply + HUMANITY heuristics | ¿Suena robótico o repetido? |

### 3.3 Principios

- **No** acortar mensajes del escenario para “hacer pasar” PERSEO (p. ej. omitir nombre y exigir `CRM_READY`).
- **Sí** separar escenarios: uno por slot, uno E2E completo.
- **Sí** un fix = un comportamiento = un escenario (o ampliación explícita de uno existente).
- **Sí** `deterministic_mode: true` en CI; QA Railway puede correr con wording real.

---

## 4. Roadmap de estabilización (S1–S4)

| Fase | Semana orient. | Foco PERSEO | Gate de salida |
|------|----------------|-------------|----------------|
| **S1** | 1 | Slots críticos: identidad, budget, consent, sticky flow | P0 demanda/oferta básicos pass |
| **S2** | 1–2 | `CRM_READY` natural, `crm_gate_blockers` claros | `DEMAND_002_FULL` + `crm-dry-run` |
| **S3** | 2–3 | Ola O1+D1 (~20 escenarios) | ≥90% P0+P1 pass en QA |
| **S4** | 3–4 | Ownership + edge (`EDGE_*`, `DEMAND_OWNER_*`) | Matriz P1 ownership green |

**HUMANITY** corre en paralelo desde S1 (no bloquea CRM, sí bloquea percepción de producto).

---

## 5. Métricas

### 5.1 Métricas técnicas (ya soportadas por ARGOS-1)

| Métrica | Definición | Fuente |
|---------|------------|--------|
| `% scenarios pass` | `ok: true` / total run | `run-scenario` |
| `% CRM_READY when eligible` | Escenarios E2E con slots completos → `crm_ready: true` | snapshot final |
| `% ownership pass` | `ownership_validation.passed` | `crm_dry_run` |
| `% must_not clean` | Sin violaciones semánticas/técnicas | `must_not_violations` |
| `% loops` | `LOOP_DETECTED` en CHAOS o producción | anti-loop trace |

### 5.2 Métricas conversacionales (nueva categoría — v1 manual + v2 automatizada)

| Métrica | Definición | Cómo medir v1 | Meta orientativa |
|---------|------------|---------------|------------------|
| **`% robotic responses`** | Respuestas con patrones de plantilla dura, tono sistema, o lista de opciones mecánica | Checklist HUMANITY + revisión humana en transcript | < 10% en P0 |
| **`% repeated openings`** | Misma apertura/cierre en ≥2 turnos consecutivos (anti-loop parcial) | Diff firmas de texto entre turnos assistant | < 5% |
| **`% natural flow success`** | Usuario no necesita repetir slot ya dado; no reinicio de “¿vender o comprar?” | Escenarios E2E sin regresión de stage | > 85% P0 |
| **`% consent achieved naturally`** | Consent tras handoff coherente, no “sí” huérfano fuera de contexto | `advisor_contact_consent: ACCEPTED` + stage HANDOFF | > 90% E2E |
| **`% conversations reaching CRM_READY`** | Solo escenarios con mensajes completos | `expected.crm_ready: true` | 100% en E2E definidos |
| **`% hallucination incidents`** | Precio/código/URL/disponibilidad inventados | `must_not` semántico | 0 en PROP_* |
| **`% loops`** | Misma respuesta ≥ N veces | CHAOS_001 + trace | 0 en P0 |
| **`% abandoned before handoff`** | Stage queda en UNDERSTANDING/IDENTITY sin progresión tras N turnos | Escenarios con max turns + expected stage | < 15% (simulado) |

**Nota v1:** métricas HUMANITY y robotic/repeated se registran en **plantilla de run** (ver §7). ARGOS-2 automatizará contadores en `argos_runs.summary`.

### 5.3 Dashboard manual semanal (hasta ARGOS-2)

| Columna | Fuente |
|---------|--------|
| Fecha / build_sha | Railway + health |
| Escenarios ejecutados | Lista P0/P1/HUMANITY |
| Pass rate | JSON export local |
| Top 3 `crm_gate_blockers` | Agregado manual de traces |
| Incidentes HUMANITY | Tag en hallazgos |

---

## 6. Familia HUMANITY (oficial)

PERSEO debe sonar como **asesor humano**, no como formulario ni IVR.

### 6.1 Objetivo de la familia

Validar **tono, continuidad y naturalidad** independientemente de si el CRM ya está listo.

### 6.2 Escenarios iniciales

| Código | Persona | Mensajes (resumen) | Expected (estructural) | must_not |
|--------|---------|-------------------|------------------------|----------|
| **HUMANITY_001** | Casual/amable | Hola → “todo bien gracias” → busco depa → va | Progresión sin reinicio; tono cálido | `robotic_response`, `repeated_phrase`, `hard_template_response` |
| **HUMANITY_002** | Confundido | “no entiendo” → “¿qué necesitas?” → datos dispersos | Re-explica sin frustrar; no loop | idem + `forced_handoff` prematuro |
| **HUMANITY_003** | Cortante | “solo dime precio” / respuestas mínimas | Respuesta directa; no párrafos largos | `robotic_response`, repetición |
| **HUMANITY_004** | Emocional | “estoy preocupado por vender rápido” | Empatía breve + siguiente paso útil | tono frío / plantilla |
| **HUMANITY_005** | Cambio de tema | Compra → “ahora mejor rento” | `explicit_flow_switch` o confirmación | mezclar oferta/demanda sin confirmar |

### 6.3 must_not conversacionales (definición v1)

| Clave | Criterio de violación (revisión humana v1; heurística v2) |
|-------|-----------------------------------------------------------|
| `robotic_response` | Frases tipo “Procesando tu solicitud”, “Como asistente virtual”, listas numeradas rígidas sin contexto |
| `repeated_phrase` | ≥2 turnos assistant con apertura idéntica (>80% similitud normalizada) |
| `hard_template_response` | Misma cadena exacta de >120 chars que catálogo de plantillas prohibidas |
| `forced_handoff` | Canalización sin agotar slot mínimo o sin señal de frustración/legal/media |

**Implementación:** v1 = checklist en matriz + revisión QA; extensión futura `mustNotValidator` con fingerprints (ARGOS-1.1).

### 6.4 Expected HUMANITY (no solo CRM)

```json
{
  "expected": {
    "natural_flow_success": true,
    "no_stage_regression": true,
    "max_repeated_openings": 0
  }
}
```

*(Campos a soportar en `run-scenario` en iteración futura; v1 se valida manualmente contra transcript.)*

---

## 7. Matriz completa inicial de escenarios

Convención de códigos: `{FAMILIA}_{NNN}`. Archivos versionados: `docs/argos/scenarios/{CODE}.v1.json` (ver `ARGOS-SCENARIO-VERSIONING-v1.md`).

### 7.1 P0 — Bloqueante (ejecutar cada release QA)

| Código | Cat. | Mensajes clave | expected clave | must_not clave |
|--------|------|----------------|----------------|----------------|
| **DEMAND_001** | compra_demanda | Hola → busco casa → (sin nombre aún) | `intent: buy`, pide nombre | writes, whatsapp |
| **DEMAND_002_FULL** | compra_demanda E2E | Hola → Cumbres → 5M → **Jorge** → sí contacto | `crm_ready: true`, `consent: ACCEPTED`, `would_create_*` | invent_*, writes, whatsapp |
| **DEMAND_002_SLOTS** | compra_demanda | Cumbres + 5M **sin nombre** | `crm_ready: false`, `stage: IDENTITY_PENDING` | idem |
| **DEMAND_004** | compra_demanda | Zona sin presupuesto | pregunta budget, no handoff prematuro | idem |
| **OFFER_001** | venta_captacion | Hola → vender → zona → nombre | `intent: sell`, `lead_flow: offer` | idem |
| **PROP_003** | propiedad | Código inválido + precio | must_not semántico pass | invent_price, invent_property |
| **CHAOS_001** | anti-loop | 12× hola | loop detectado o diversidad | send_whatsapp |
| **HUMANITY_001** | humanidad | Amable, flujo compra | natural_flow (manual) | robotic, repeated |

### 7.2 P1 — Alta prioridad

| Código | Cat. | Notas |
|--------|------|-------|
| DEMAND_003 | renta demanda | operation rent |
| DEMAND_005 | propiedad código | listing QA Supabase |
| DEMAND_006 | visitas | “quiero verla” con contexto |
| DEMAND_009 | handoff humano | pide asesor explícito |
| OFFER_002 | venta directa | casa Cumbres |
| OFFER_003 | valuación | sin precio / valuation |
| OFFER_004 | renta oferta | poner en renta |
| PROP_001 | propiedad válida | LUX real |
| PROP_002 | código inválido | no inventar ficha |
| PROP_004 | disponibilidad | no afirmar sin dato |
| EDGE_001 | ownership | contact owner demand |
| HUMANITY_002 | confundido | re-explicación |
| HUMANITY_003 | cortante | brevedad |

### 7.3 P2 — Cobertura ampliada

| Bloque | Códigos |
|--------|---------|
| Demanda | DEMAND_007–010 (inversionista, campaña, queja, venta+compra) |
| Oferta | OFFER_005–010 (código, saludo, objeción, legal, foráneo, caos largo) |
| Propiedad | PROP_005 (link) |
| Edge CRM | EDGE_002–005 (owner variants, resetcrm, reuse, duplicado WA) |
| Humanidad | HUMANITY_004–005 |

### 7.4 Referencia DEMAND_002 (lección validada)

| Escenario | ¿Legítimo CRM_READY? |
|-----------|----------------------|
| Sin turno nombre explícito | **No** → `IDENTITY_PENDING` correcto |
| 5 turnos con Jorge + consent | **Sí** → `CRM_READY` |

---

## 8. Versionado de escenarios

Ver documento dedicado: **`ARGOS-SCENARIO-VERSIONING-v1.md`**.

Resumen:

- Archivo: `docs/argos/scenarios/{SCENARIO_CODE}.v{MAJOR}.json`
- Cambio breaking en `expected` → major++
- Solo mensajes/copy → minor en metadata
- `scenario_version` en body `run-scenario` para auditoría

---

## 9. Artefactos y responsabilidades

| Rol | Responsabilidad |
|-----|-----------------|
| **Dev PERSEO** | Fix + escenario + tests |
| **QA** | Ejecuta matriz P0 cada deploy QA; registra métricas |
| **Producto** | Prioriza P1/P2 y thresholds HUMANITY |
| **Ops** | Flags Railway, secret rotation, ARGOS off en prod |

---

## 10. Gates hacia ARGOS-2

No implementar ARGOS-2 hasta:

1. P0 ≥ 100% pass (incl. `DEMAND_002_FULL`).
2. Smoke webhook documentado.
3. Catálogo JSON en repo bajo `docs/argos/scenarios/`.
4. Métricas conversacionales v1 registradas al menos 2 semanas.
5. Kickoff UX aprobado (`ARGOS-2-UX-CONCEPT-v1.md`).

---

## 11. Referencias

- API: `docs/argos/postman/ARGOS-1-Internal-API.postman_collection.json`
- Plan ARGOS-0/1: `docs/sprints/argos-qa-plan-argos-0-1.md`
- Madurez PERSEO: `docs/sprints/plan-oficial-perseo-madurez-conversacional-p0-p6.md`
- UX ARGOS-2: `docs/argos/ARGOS-2-UX-CONCEPT-v1.md`
- Versionado: `docs/argos/ARGOS-SCENARIO-VERSIONING-v1.md`

---

*Documento v1.0 — adoptado como estándar de equipo. Cambios vía PR con revisión producto + QA.*
