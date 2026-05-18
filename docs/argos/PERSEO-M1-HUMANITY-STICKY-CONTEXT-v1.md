# PERSEO M1 — HUMANITY, sticky intent y continuidad contextual

**Versión:** 1.0  
**Estado:** Aprobado conceptualmente — documento rector del bloque M1  
**Repositorio:** `luxetty-perseo`  
**Prerrequisito de producto:** motor V3 + ARGOS-1 operativo en QA (escenarios congelados, `run-scenario`, traces, no-write)  
**Relacionado:** `ARGOS-CONVERSATIONAL-TRAINING-STRATEGY-v1.md`, `plan-oficial-perseo-madurez-conversacional-p0-p6.md` (tesis R0–R3), `perseo-conversational-core-v3-roadmap.md`

---

## 1. Tesis M1

PERSEO ya puede **calificar y llegar a preview CRM** en flujos definidos, pero en WhatsApp real aún **suena a bot**: repite aperturas, reinicia el menú de intención, ignora rapport social y canaliza antes de tiempo.

**Tesis del bloque M1:** la madurez conversacional no es “más escenarios”, sino **estado que manda**, **redacción variable y contextual**, y **handoff solo por reglas de negocio** — todo **medible y regresable** con ARGOS-TDD, sin nueva plataforma de laboratorio.

**Principio rector (plan 2.0):**

```text
estado persistente → reglas duras (sticky, stage) → decisión acotada → respuesta humana → CRM preview (sin execute en QA)
```

**Regla de equipo (heredada):** cada bug conversacional corregido termina en escenario ARGOS + `expected` + `must_not` + regresión automatizable.

---

## 2. Objetivos

| # | Objetivo | Resultado observable |
|---|----------|----------------------|
| O1 | **HUMANITY** | Tono asesor; reconoce lo dicho; una pregunta útil por turno |
| O2 | **Sticky intent** | `lead_flow` / `operation_type` estables ante mensajes cortos (zona, monto, nombre, “sí”) |
| O3 | **Anti-repetición** | Sin misma apertura/cierre en turnos consecutivos cuando ya hay contexto |
| O4 | **Continuidad contextual** | No reiniciar “¿vender, comprar o rentar?” tras intención fijada |
| O5 | **Handoff disciplinado** | Canalización solo por triggers V3 (legal, media, loop, humano, límite real) |
| O6 | **P1 progresivo** | Olas D1/O1/EDGE/HUMANITY con regresión acumulativa en suite P1 |

---

## 3. No-objetivos

| Tema | Motivo |
|------|--------|
| ARGOS-2 (UI, timeline, persistencia de runs) | Fuera de M1; no bloquea percepción humana |
| Tablas `argos_*` o migraciones Supabase | Infra futura; M1 usa sesión en memoria ARGOS-1 |
| CRM execute en QA | `PERSEO_V3_CRM_EXECUTE=false` se mantiene |
| Decision Core R2 completo | M1 endurece composer + ruleGuard + state; no re-arquitectura del decisor |
| Convertir ~210 pláticas del corpus en JSON congelado | Corpus sigue como mapa; M1 promueve **comportamientos**, no transcripts |
| Multimedia, campañas Meta, CRM hardening R4–R6 | Bloques posteriores |

---

## 4. Roadmap M1-A → M1-D

### M1-A — HUMANITY fundacional y anti-repetición básica

**Duración orientativa:** 1–2 semanas  

| Entregable | Descripción |
|------------|-------------|
| Escenario `HUMANITY_001` congelado | Rapport + renta abierta sin menú IVR repetido |
| Heurísticas `must_not` v1 | `robotic_response`, `repeated_phrase`, `hard_template_response` |
| Variantes de apertura | Pool mínimo por `conversation_stage`; no repetir firma del turno anterior |
| Firma en state | `lastAssistantReplySignature` (o equivalente) para anti-repetición |
| Suite `humanity-p0` | Gate de percepción (paralelo; ver §7) |

**Salida:** `HUMANITY_001` PASS en local; checklist humano ≥4/5 en ítems HUMANITY.

---

### M1-B — Sticky intent y continuidad contextual (R0 operativo)

**Duración orientativa:** 1–2 semanas  

| Entregable | Descripción |
|------------|-------------|
| Guion oro venta | “Quiero vender” → monto → zona → nombre sin flip a demanda |
| Mensajes cortos | Ubicación, precio, nombre, “sí”/“ok” no cambian `lead_flow` |
| `awaiting_field` | No re-preguntar slots ya en `collectedFields` |
| Escenarios REG sticky | `REG_STICKY_SELL_001`, `REG_STICKY_BUY_001`, `REG_SHORT_MSG_001` |
| Trace | Assert `rule_guard_result` / snapshot en escenarios |

**Salida:** 0 flips offer↔demand en escenarios REG; sin reinicio de menú tras intención fijada.

---

### M1-C — Naturalidad avanzada y handoff disciplinado

**Duración orientativa:** 1–2 semanas  

| Entregable | Descripción |
|------------|-------------|
| Matriz handoff | Cuándo canalizar vs cuándo aclarar (turnos 1–3 vs señales duras) |
| `HUMANITY_002`, `HUMANITY_003` | Confundido y cortante |
| `must_not: forced_handoff` | En escenarios de primeros turnos sin trigger válido |
| Reconocimiento en composer | Eco breve del último mensaje usuario antes de la pregunta |

**Salida:** 0 handoffs prematuros en HUMANITY_001–003; re-explicación útil en confundido.

---

### M1-D — Olas P1 reales

**Duración orientativa:** 2–3 semanas  

| Ola | Escenarios (3–5 por PR) |
|-----|-------------------------|
| D1 demanda | `DEMAND_003`, `DEMAND_005`, `DEMAND_006` |
| O1 oferta | `OFFER_002`, `OFFER_003`, `OFFER_004` |
| Property + edge | `PROP_001`, `PROP_002`, `EDGE_001` |
| HUMANITY ampliado | `HUMANITY_004`, `HUMANITY_005` |

**Salida:** suite `release-p1` ≥90% pass en QA Railway; ~18–22 escenarios ejecutables acumulados.

---

## 5. Escenarios iniciales

### 5.1 Familia HUMANITY (prioridad M1-A/C)

| Código | Persona | Guion resumido | Hipótesis bajo prueba |
|--------|---------|----------------|------------------------|
| **HUMANITY_001** | Amable | Hola → rapport → renta → zona → presupuesto → nombre | Progresión sin menú repetido; tono cálido |
| **HUMANITY_002** | Confundido | “no entiendo” → datos dispersos | Re-explica; no handoff prematuro |
| **HUMANITY_003** | Cortante | “solo dime precio” / monosílabos | Brevedad; no párrafos IVR |
| **HUMANITY_004** | Emocional | urgencia venta | Empatía + siguiente paso |
| **HUMANITY_005** | Cambiante | compra → “mejor rento” | `explicit_flow_switch` o confirmación |

### 5.2 REG — continuidad y sticky (M1-B)

| Código | Guion resumido |
|--------|----------------|
| **REG_STICKY_SELL_001** | Venta → 8M → Cumbres → Jorge (sin “buscar casa”) |
| **REG_STICKY_BUY_001** | Compra abierta; “Cumbres” no activa flujo venta |
| **REG_SHORT_MSG_001** | Tras intención fijada: “sí”, “ok”, zona suelta |

### 5.3 REG — anti-repetición (M1-A, complemento HUMANITY)

| Código | Guion resumido |
|--------|----------------|
| **REG_GREETING_001** | Saludos sucesivos → variante o continuidad, no copy idéntica ×N |

> **Nota:** escenarios de **seguridad anti-loop** (familia CHAOS) viven en su propia familia y documentación; **no forman parte del alcance ni gates de M1**.

### 5.4 P1 — primeras olas (M1-D)

| Código | Comportamiento |
|--------|----------------|
| `DEMAND_003` | Código LUX / ficha sin inventar |
| `DEMAND_005` | Interés post-ficha → handoff coherente |
| `DEMAND_006` | Presupuesto + zona sin reinicio |
| `OFFER_002` | Venta estructurada sticky |
| `OFFER_003` | Renta + ocupación |
| `PROP_001`, `PROP_002` | Consulta honesta; `must_not` inventario |
| `EDGE_001` | Reset / continuidad sesión |

---

## 6. Criterios de éxito

### 6.1 Por ola

| Ola | Criterio de cierre |
|-----|-------------------|
| **M1-A** | `HUMANITY_001` PASS ARGOS + HUMANITY Score manual ≥4.0 + `repeated_phrase` 0 en ese escenario |
| **M1-B** | REG sticky 3/3 PASS; 0 `offer_to_demand` / `demand_to_offer` sin confirmación en traces |
| **M1-C** | `HUMANITY_002`–`003` PASS; 0 `forced_handoff` indebido en must_not |
| **M1-D** | `release-p1` ≥90% remoto QA; muestra 20 pláticas WhatsApp ≥80% “suena humano” |

### 6.2 Globales del bloque M1

| Criterio | Meta |
|----------|------|
| Reinicio de menú tras intención fijada | 0 en escenarios M1 |
| Handoff antes de contexto mínimo (HUMANITY) | 0 |
| Flip offer↔demand sin confirmación | 0 en REG sticky |
| Regresión ARGOS-TDD por bug | 100% con escenario |

---

## 7. Métricas HUMANITY

### 7.1 Automatizables (ARGOS-1, sin DB)

| Métrica | Definición | Meta M1 |
|---------|------------|---------|
| `% repeated_phrase` | ≥2 turnos assistant con apertura normalizada ≥80% similar | <5% en suite humanity-p0 |
| `% robotic_response` | Match `FORBIDDEN_COMPOSER_PATTERNS` + lista M1 | <10% |
| `% forced_handoff` indebido | Handoff en stage/torno prohibido por escenario | 0 en HUMANITY_001–003 |
| `% flow_restart` | Menú vender/comprar/rentar con `lead_flow` ya definido | 0 |
| `% natural_flow_success` | Escenario cumple `expected` de stage/slots sin regresión | >85% E2E M1 |

**Implementación progresiva:** v1 checklist + diff de firmas en script; v1.1 asserts en `scenarioRunner` para campos `max_repeated_openings`, `natural_flow_success`.

### 7.2 Checklist humano (semanal)

Escala 1–5 por dimensión:

1. Continuidad — retoma lo dicho  
2. Economía — una pregunta útil  
3. Calidez — tono asesor Luxetty  
4. No IVR — evita menú genérico  
5. Confianza — daría WhatsApp a este interlocutor  

**HUMANITY Score** = promedio de las 5. Meta: **≥4.0** en `humanity-p0` para cerrar M1-A.

### 7.3 Producción WhatsApp (hito salida M1)

| Proxy | Señal de problema |
|-------|-------------------|
| Usuario repite el mismo slot | No se escuchó |
| Abandono tras menú genérico | Reinicio de flujo |
| Mensajes de frustración | Repetición o tono sistema |

Meta salida M1: **≥16/20** pláticas muestreadas calificadas “humano” por dos revisores.

### 7.4 Gates de suite (M1)

| Suite | Rol | Umbral |
|-------|-----|--------|
| `humanity-p0` | Percepción (M1-A en adelante) | 100% tras estabilizar heurísticas |
| `release-p1` | Cobertura operativa (M1-D) | ≥90% remoto QA |

> M1 **no redefine** suites de infraestructura ni gates de otros bloques; solo introduce **`humanity-p0`** y **`release-p1`**.

---

## 8. Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Variantes de apertura incoherentes | Medio | Pool por `conversation_stage`, no texto aleatorio |
| Sticky excesivo | Alto | `explicit_flow_switch` + `HUMANITY_005` |
| Falsos positivos `robotic_response` | Medio | Gate humanity advisory 2 semanas; tunear fingerprints |
| `deterministic_mode` ≠ WhatsApp real | Medio | Smoke manual 10 pláticas post-deploy |
| Proliferación de ifs en composer | Alto | `pickOpeningVariant(state)` central |
| Menos handoff → usuario atascado | Alto | Matriz escrita; handoff permitido turno 6+ o señal dura |
| Relajar `expected` para verde | Crítico | Política: major++ escenario + aprobación producto |

---

## 9. Plan de implementación por PRs pequeños

**Reglas:** máx. **3–5 escenarios** por PR JSON; **1 comportamiento** por PR de motor; `PERSEO_V3_CRM_EXECUTE=false`; sin tablas nuevas.

| PR | Ola | Alcance PERSEO | Escenarios / suite |
|----|-----|----------------|-------------------|
| **M1-PR-01** | M1-A | Anti-repetición básica + variantes apertura + firma state | `HUMANITY_001`, `REG_GREETING_001`, `suites/humanity-p0.json` (2 escenarios) |
| **M1-PR-02** | M1-A | `mustNotValidator`: `repeated_phrase`, `robotic_response` | Extiende M1-PR-01 tests |
| **M1-PR-03** | M1-B | Sticky ruleGuard + mensajes cortos | `REG_STICKY_SELL_001`, `REG_STICKY_BUY_001` |
| **M1-PR-04** | M1-B | `awaiting_field` / no re-preguntar slot | `REG_SHORT_MSG_001` |
| **M1-PR-05** | M1-C | Matriz handoff + `forced_handoff` must_not | `HUMANITY_002` |
| **M1-PR-06** | M1-C | Composer breve + reconocimiento usuario | `HUMANITY_003` |
| **M1-PR-07** | M1-D | Ola D1 (3 escenarios) | `DEMAND_003`, `005`, `006` + `release-p1.json` |
| **M1-PR-08** | M1-D | Ola O1 (3 escenarios) | `OFFER_002`, `003`, `004` |
| **M1-PR-09** | M1-D | PROP + EDGE + HUMANITY 004–005 | cierre M1-D |

**Orden obligatorio:** M1-PR-01 antes que P1; M1-B antes que handoff avanzado; no mezclar sticky + 6 escenarios P1 en un solo PR.

**Tests por PR:** `npm run test:argos` + test V3 focal si toca motor + escenario nuevo en rojo→verde.

---

## 10. Referencias

| Documento | Uso |
|-----------|-----|
| `ARGOS-CONVERSATIONAL-TRAINING-STRATEGY-v1.md` | ARGOS-TDD, familia HUMANITY §6 |
| `plan-oficial-perseo-madurez-conversacional-p0-p6.md` | R0 sticky, composer, stages |
| `perseo-v3-f3-qualification-handoff.md` | Handoff y consent |
| `docs/argos/datasets/corpus-index.yaml` | Backlog y promoción (no implementación M1) |

---

*M1 — Madurez conversacional. Percepción humana medible antes de ampliar plataforma ARGOS.*
