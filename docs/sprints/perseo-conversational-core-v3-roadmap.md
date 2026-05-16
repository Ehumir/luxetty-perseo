# PERSEO — Conversational Core V3 (reconstrucción total)

**Estado:** dirección aprobada — **no sustituir producción con parches incrementales al motor legacy.**  
**Objetivo:** reemplazar **progresivamente** el motor actual por un núcleo centralizado: continuidad, etapas, identidad, decisión acotada, validación de negocio y redacción humana.

**Relación con roadmap anterior:** lo que antes se agrupaba como “P0 parches + R0 guardrails” queda **congelado como legacy**; el avance oficial pasa a ser **V3-F0 … V3-F9** bajo este documento.

**Catálogo de escenarios (oficial):** ~**200 pláticas** de QA — captación (oferta) + compradores (demanda) + tipologías A–H / A–D. Cobertura por **olas** (familias), no por 200 ramas en código. Detalle en **§1.1** y **§1.2**.

**Regla de producto (inviolable):** si PERSEO **no puede manejar** la plática de forma segura y útil, **debe** informar que **canalizará el caso con un asesor** y que **lo contactarán** (ver **§1.3**). Sin excepciones silenciosas ni “me quedo callado”.

---

## 1. Plan de refactorización por fases (V3-F0 … F9)

| Fase | Nombre | Objetivo | Producción |
|------|--------|----------|------------|
| **V3-F0** | Congelamiento y contención | Dejar de expandir el motor legacy; solo hotfixes críticos documentados. | 100 % legacy |
| **V3-F1** | Núcleo en paralelo | `conversation/v3/`: contratos + tests; sin cablear al webhook. | Legacy + flag `false` |
| **V3-F2** | Stage + identidad mínimo | Flujo venta básico con nombre y zona; sin CRM duro. | Legacy; V3 solo tests / dev |
| **V3-F3** | Calificación + handoff + CRM dry-run | Planner conversión, consent asesor, stages `QUALIFICATION_COMPLETE`→`CRM_READY`; sin CRM write. | Allowlist QA |
| **V3-F4** | Comercial avanzado + shadow opcional | `owner_relation`, motivación, objeciones, OpenAI diff opcional. | Tras F3.3 |
| **V3-F5** | ~~Activación QA allowlist~~ | **Hecho en F2** (primary + allowlist Railway). | — |
| **V3-F6** | CRM execution | Contacto, lead, idempotencia, eventos — **después** de conversación estable. | Tras PASS F5 |
| **V3-F7** | Campaigns / Meta Ads | Referral, info/precio/ubicación/me interesa, propiedad desde pauta. | Tras F6 estable |
| **V3-F8** | Multimedia | Audio, imagen, PDF, ubicación, interactive; honestidad. | Tras conversación base |
| **V3-F9** | Release estable y retiro legacy | Matriz **~200** pláticas (oferta + demanda), deprecación gradual, runbook. | Rollout parcial → total |

Cada fase debe tener **tests automatizados** y **criterios PASS/FAIL** explícitos antes de avanzar.

### 1.1 Alcance conversacional oficial (~200 escenarios)

PERSEO debe poder **atender o canalizar correctamente** el universo acordado con negocio/QA. No implica automatizar el 100 % sin humano: implica **flujo correcto** (calificar, responder con inventario cuando aplique, o **handoff obligatorio**).

| Carril | Documentos fuente | Goals V3 | Bloques tipología | Casos referencia |
|--------|-------------------|----------|-------------------|------------------|
| **Oferta (captación)** | Tipología captadores A–H; Matriz QA captación; *Ejemplo pláticas captación* (~100) | `SELL_PROPERTY`, `RENT_OUT_PROPERTY` | A estructurado → H caos | Vender/rentar **su** inmueble; pauta confusa; objeciones; legal; CRM |
| **Demanda anclada** | Tipología compradores A–D; *Pláticas compradores* (oro LUX-Axxxx + bloque A parcial) | `PROPERTY_INQUIRY` + `PROPERTY_QA` | A–B inicial | Código, ficha, link, Q&A factual, visita, “quiero agente” |
| **Demanda abierta** | Mismo catálogo compradores | `BUY_PROPERTY` (+ renta demanda) | A–D | Búsqueda sin código: zona, presupuesto, crédito/contado, comparación, premium |

**Familias de implementación** (8 familias compartidas; cada caso MD mapea a una):

| Familia | Oferta (ej.) | Demanda (ej.) | Fases V3 principales |
|---------|--------------|---------------|----------------------|
| **F1** Estructurado | Venta feliz, nombre→zona→precio | CASO 1–25 comprador | F2–F3 |
| **F2** Anclado pauta/código | Meta captación | LUX-Axxxx, Instagram | F3.3A, F7 |
| **F3** Búsqueda abierta | — | Crédito, contado, zona | F3.2, F4 |
| **F4** Ambiguo / fragmentado | “Info”, mensajes cortos | CASO 26–50 | F4 + goal lock |
| **F5** Objeciones comerciales | Comisión, exclusiva, bot | CASO 51–75 | F4 |
| **F6** Delicado / premium / legal | Herencia, intestada | Foráneo, Infonavit, confidencialidad | F4 + escalada |
| **F7** CRM / continuidad | Reapertura, otro número | Multi-propiedad, hilo viejo | F6 |
| **F8** Caos / abuso / multimedia | Flooding, jailbreak | Audio, screenshot, ubicación | F8, F9 |

**Olas de cobertura QA** (orden recomendado; paralelizable **solo** tras plataforma P — ver §1.4):

| Ola | Contenido | PASS mínimo |
|-----|-----------|-------------|
| **P** | Plataforma: identidad, handoff, consent, cierre, payload dry-run | 2 guiones oro (1 oferta + 1 demanda anclada) |
| **O1–O2** | Oferta estructurada + `owner_relation` / premium | Bloque A captación |
| **D1–D2** | Demanda anclada + abierta | Bloque A comprador + guiones LUX-Axxxx |
| **O3 / D3** | Ambigüedad oferta y demanda | Bloques B |
| **O4–O5 / D4–D5** | Objeciones + delicado | Bloques C–D |
| **O6–O7 / D6** | CRM + caos + multimedia | Bloques F–H + F8 |

### 1.2 Objetivos comerciales por carril (F3+)

| Carril | Objetivo | Cierre esperado (pláticas oro) |
|--------|----------|-------------------------------|
| Oferta | Calificar captación → consentimiento asesor | “Ya notifiqué al asesor…” + cierre conversión |
| Demanda anclada | Resolver Q&A con inventario → visita/interés | Mismo + código de propiedad en payload |
| Demanda abierta | Calificar búsqueda → asesor con opciones | Canalización con zona/presupuesto en payload |

Ver `docs/sprints/perseo-v3-f3-qualification-handoff.md` para stages y copy de handoff.

### 1.3 Fallback universal — canalización obligatoria al asesor

**Principio:** PERSEO **nunca** debe dejar al contacto sin salida cuando **no puede** continuar la plática de forma responsable. El fallback **no** es “respuesta genérica vaga”: es **compromiso explícito de canalización** con un asesor Luxetty y **contacto posterior** (idealmente por el mismo WhatsApp, sujeto a consentimiento cuando aplique).

#### Cuándo activar fallback (lista no exhaustiva)

| Trigger | Ejemplos | Acción |
|---------|----------|--------|
| **Intención no clasificable** | Mensaje fuera de giro, señal contradictoria persistente | Handoff forzado |
| **Confianza baja / fuera de catálogo** | Escenario no cubierto por familia activa tras N turnos | Handoff forzado |
| **Rule guard / violación** | Inventario inexistente, dato que no puede inventar, flip offer↔demand no resuelto | Handoff forzado |
| **Bucle / frustración** | Anti-loop agotado; usuario reclama tono o repite queja | Handoff forzado |
| **Multimedia no procesable** (pre-F8) | Audio, imagen, PDF sin pipeline | Handoff forzado + honestidad (“no puedo procesar X aquí”) |
| **Legal / riesgo alto** | Asesoría legal cerrada, disputa, amenaza | Handoff forzado + tono prudente |
| **Error técnico** | Timeout V3, JSON inválido, fallo runtime → **no** caer a legacy silencioso en allowlist V3 | Handoff forzado |
| **Usuario pide humano** | “Quiero hablar con alguien real” | Handoff forzado (prioridad) |
| **Descalificación comercial** | Geo/precio bajo piso | Cierre cordial **con oferta** de asesor si el usuario quiere revisar; si insiste → handoff |

**Excepciones estrechas** (documentar en tests):

- Usuario **rechaza explícitamente** contacto (`declined`) → cierre cordial sin prometer llamada; **sí** dejar puerta abierta (“cuando gustes, aquí seguimos”).
- Abuso/spam tras política F9 → cierre mínimo; **no** crear lead basura.

#### Copy obligatorio (plantilla — Composer V3)

Debe incluir **las tres ideas** (redacción natural, no literal única):

1. **Reconocimiento** breve del límite o de la situación (“para ayudarte bien con esto…”).
2. **Canalización:** “voy a **canalizar tu caso** con un **asesor** de Luxetty”.
3. **Seguimiento:** “te **contactará** / te **escribirá** por **WhatsApp**” (o “por este medio” si ya hay consentimiento de canal).

**Ejemplo de referencia:**

> Entiendo, [nombre]. Para ayudarte bien con esto, voy a **canalizar tu caso con un asesor de Luxetty**. En breve **te contactará por WhatsApp** para continuar contigo y afinar los detalles.

**Prohibido en fallback:**

- “No puedo ayudarte” sin ofrecer asesor.
- “Intenta más tarde” / “escribe de nuevo” como única salida.
- Inventar datos (precio, disponibilidad, legal) para “responder algo”.
- Quedarse en loop de preguntas cuando ya se disparó el trigger.

#### Implementación (fases)

| Fase | Entregable |
|------|------------|
| **F3.3B** | `handoffPlanner.forceHandoff({ reason })`; stage `HANDOFF_PENDING` o `HUMAN_ESCALATION` según consent; flag `unhandledReason` en state |
| **F3** | `ruleGuard` y `v3Runtime`: violación → **no** solo `fallbackToLegacy`; en V3 primary → handoff copy |
| **F4** | Plantillas por `reason` (legal, media, frustration, unknown) — misma estructura de 3 ideas |
| **F6** | Payload CRM con `handoff_reason` + resumen para asesor aunque calificación incompleta |
| **F9** | Tests: cada trigger de la tabla → assert copy contiene canalización + contacto |

### 1.4 Paralelismo oferta vs demanda

- **Plataforma P** (§1.1 ola P) es **bloqueante** para ambos carriles.
- Tras P: **O1** (oferta) y **D1** (demanda anclada) pueden avanzar en paralelo si hay capacidad; comparten handoff/composer.
- **No** retrasar D1 por cerrar las 100 pláticas de captación ni al revés; **sí** compartir tests de fallback (§1.3).

### Objetivo comercial obligatorio (F3+)

PERSEO debe lograr que el contacto **acepte ser contactado por un asesor inmobiliario Luxetty**, como **continuación consultiva** (no “transferencia de bot”). Ver `docs/sprints/perseo-v3-f3-qualification-handoff.md`.

**Definición:** PERSEO es un asesor IA comercial con slots internos invisibles — **no** un formulario conversacional.

**Stages F3:** `QUALIFICATION_COMPLETE` → `HANDOFF_PENDING` → `HANDOFF_READY` → `CRM_READY` (dry-run; sin create hasta F6).

---

## 2. Mapa de módulos legacy a reemplazar (por responsabilidad)

Los siguientes quedan como **candidatos a sustitución** por las capas V3 (no borrar al inicio; **dejar de crecer** salvo emergencia).

| Capa V3 | Módulos legacy principales (PERSEO) |
|---------|-------------------------------------|
| **State Manager** | `conversation/aiState.js`, `conversation/stateUpdater.js`, partes de `conversation/contextPreservation.js`, `conversation/contextFusion.js` |
| **Intent & contexto** | `conversation/intent.js`, `conversation/parsers.js`, `conversation/multiSignalExtractor.js`, `conversation/leadEntryPointRouter.js`, `conversation/sellerScenarioClassifier.js` |
| **Rule guard / negocio** | `conversation/searchRules.js`, `conversation/perseoGatekeeper.js`, `conversation/routeEvaluator.js`, `conversation/propertyIntentResolver.js`, `conversation/propertySpecificFlow.js` |
| **Stage / flujo** | `conversation/playbooks.js`, `conversation/nextStep.js`, `conversation/conversationClose.js` |
| **Composición / tono** | `index.js` (`buildConsultiveFallbackReply`, consultive paths), `conversation/responseBuilder.js`, `conversation/realEstateAdvisorReply.js`, `conversation/contextualMemoryResolver.js` (sustitución plantillas), `conversation/r0ContextContinuity.js` (guardrails sobre templates) |
| **OpenAI orquestación** | `conversation/conversationEngineV2.js`, `conversation/perseoConsultantPrompt.js`, `conversation/conversationOrchestrator.js` |
| **CRM (no mezclar con V3 composer)** | Rutas en `index.js` y módulos CRM/orquestador limpio (ya separados conceptualmente; en V3 solo **ejecución** tras decisión validada) |

**Atraviesa todo:** `conversation/antiLoopGuardrails.js`, `conversation/nameFirstGuardrail.js`, `conversation/namePrompt.js`, `conversation/mediaSignals.js`, `conversation/mediaIngestion.js`, `conversation/inboundReliability.js`, `conversation/qaCommands.js`, `conversation/qaSprint1Commands.js` — se **reimplementan o adaptan** contra contratos V3 cuando toque cada vertical (F2, F6, F8).

---

## 3. Qué conservar temporalmente del legacy

| Área | Conservar (temporal) | Motivo |
|------|----------------------|--------|
| **Webhook + persistencia** | Inbound/outbound, guardado de mensajes, `ai_state` en `conversations` | Sin esto no hay WhatsApp ni QA |
| **Comandos QA** | `!reset`, `!state`, otros acordados | Operación y rollback en sombra |
| **Modo humano / IA** | Conmutación actual | Negocio y compliance |
| **Storage multimedia** | Subida/almacenamiento ya existente | F8 lo consumirá |
| **CRM idempotente ya probado** | Create/reuse contact/lead **solo vía paths actuales** hasta F6 | Evitar doble sistema hasta que V3 decida “READY” |
| **Infra Railway / env** | Variables actuales + nuevas flags | Deploy incremental |

---

## 4. Qué se congela (V3-F0 en la práctica)

- **No** nuevos guardrails tipo “un `if` más en `buildConsultiveFallbackReply`”.
- **No** expandir plantillas consultivas ni sustituciones reactivas en `contextualMemoryResolver` salvo **incidente de seguridad o legal** (documentado + revert plan).
- **No** nuevos “strings mágicos” de tono en dispersión; cualquier copy urgente va con ticket y fecha de retiro al Composer V3.
- **No** acoplar Decision Core JSON a producción sin shadow + allowlist (reglas de reingeniería §4–6).

---

## 5. Feature flags (propuesta)

| Variable | Default | Fase introducida | Propósito |
|----------|---------|------------------|-----------|
| `PERSEO_ENGINE` | `legacy` (o sin definir) | **F0** | Selector documentado: `legacy` productivo; `v3` reservado (F0 fuerza efectivo legacy). |
| `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED` | `false` | F1 | Maestro: enrutar inbound a motor V3 |
| `PERSEO_V3_SHADOW_MODE` | `false` | F3 | Calcular decisión V3 sin aplicar a estado ni copy |
| `PERSEO_V3_QA_ALLOWLIST` | vacío | F5 | Lista JSON o CSV de `wa_id` / tel normalizado permitidos |
| `PERSEO_V3_LOG_DECISION_DIFF` | `false` | F3 | Log estructurado legacy vs V3 (sin PII en claro si policy lo exige) |
| `PERSEO_V3_COMPOSER_ONLY` | `false` | F4 (opcional) | Solo redacción V3 sobre decisión legacy (experimento controlado) |

Convención: flags **explícitos**; nunca “activado por omisión” en `main` hasta F5/F9 según tabla de release.

---

## 6. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| **Doble fuente de verdad** (legacy + V3) | Shadow primero; una sola escritura a `ai_state` por request; contrato de merge documentado |
| **Drift de esquema** `ai_state` | Campos V3 con prefijo `v3_` o namespace JSON acordado hasta migración formal |
| **Costo/latencia OpenAI** | Timeouts, modelo acotado, caché de decisión por turno donde aplique |
| **Regresión CRM** | F6 explícitamente después de conversación; tests de idempotencia |
| **Complejidad operativa** | Runbook, dashboards de diff shadow, allowlist pequeña |
| **Expectativa de “plática”** | Composer V3 con criterios de aceptación y pruebas ciegas (F4/F5) |
| **Escenario fuera de catálogo** | Fallback §1.3 obligatorio; tests por trigger en F3.3B+ |
| **Usuario atrapado sin salida** | Prohibido: siempre canalización a asesor salvo `declined` explícito |

---

## 7. Orden de implementación (resumen)

1. **F0** — Política de congelación + lista de “solo emergencia”.  
2. **F1** — Carpeta `conversation/v3/` + contratos + tests unitarios.  
3. **F2** — State manager + stage + identity mínimos en V3 (sin CRM).  
4. **F3** — Calificación + handoff + **F3.3B fallback forzado** (§1.3).  
5. **F3.3A / F7** — Demanda anclada (`PROPERTY_INQUIRY`) + campañas.  
6. **F3.2** — Demanda abierta (`BUY_PROPERTY`) + oferta multi-flujo.  
7. **F4** — Composer + objeciones + plantillas fallback por `reason`.  
8. **F5** — Allowlist QA (hecho en F2; extender matrices).  
9. **F6** — CRM execution + payload con `handoff_reason`.  
10. **F8** — Multimedia (reduce triggers de fallback media).  
11. **F9** — Matriz **~200** pláticas (olas §1.1), deprecación legacy, runbook.

**Olas QA en paralelo** (tras F3.3B): ver §1.1 — **O1+D1** primero; luego B/C/D por familia, no por documento completo.

---

## 8. Matriz QA (mínima ampliable)

### 8.0 Fallback — criterios PASS globales (todas las fases F3+)

Aplica a **cualquier** guion (oferta, demanda, fuera de catálogo):

| # | Criterio | PASS |
|---|----------|------|
| F1 | Ante trigger §1.3, el último mensaje ofrece **canalización con asesor** | Sí |
| F2 | El mensaje indica que el contacto **será contactado** (WhatsApp / este medio) | Sí |
| F3 | **No** inventa precio, disponibilidad ni asesoría legal definitiva | Sí |
| F4 | Stage coherente (`HANDOFF_*`, `HUMAN_ESCALATION` o `CLOSED` con razón) | Sí |
| F5 | Error técnico V3 en allowlist → mismo comportamiento (no silencio) | Sí |

### 8.1 Definición de éxito mínima (antes de CRM / campañas / multimedia)

Script:

```text
!reset
Hola
Quiero vender mi casa
Jorge
Está en Cumbres
Vale como 8 millones
```

| # | Criterio | PASS |
|---|----------|------|
| 1 | Saludo natural (MX), sin repetir plantilla genérica | Sí |
| 2 | Mantiene venta/captación; **no** pasa a demanda | Sí |
| 3 | Pide **nombre** de forma natural antes o justo después del primer avance útil | Sí |
| 4 | Tras “Jorge”, usa el nombre sin forzar formulario | Sí |
| 5 | **No** aparece “house” ni anglicismos forzados | Sí |
| 6 | **No** “dime en una frase / una línea” como eje del turno | Sí |
| 7 | Ubicación reconocida (Cumbres) en estado y/o copy | Sí |
| 8 | Valor esperado reconocido como **venta** (no presupuesto comprador) | Sí |
| 9 | Una pregunta principal clara hacia siguiente paso útil | Sí |
| 10 | Reclamo de tono (“¿por qué hablas así?”) → reconocimiento breve + ajuste (F4) | Sí |
| 11 | **No** crea lead basura antes de criterio F6 | Sí |

### 8.2 Regresión comprador (no romper al activar V3 en allowlist)

| # | Script corto | PASS |
|---|----------------|------|
| A | “Busco casa en Cumbres” → presupuesto → opciones | Copy comprador; montos como presupuesto |
| B | `LUX-A0462` → nombre → “me interesa verla” → consent | Ficha + link; handoff; cierre oro |
| C | “Info” (sin contexto) → nombre → zona | Recuperación bloque B; no loop |
| D | “¿Eres bot?” / mensaje ilegible tras 2 turnos | Fallback §1.3 (canalización + contacto) |

### 8.3 Catálogo ~200 pláticas (F9)

| Bloque | Fuente | Meta PASS (F9) |
|--------|--------|----------------|
| Captación A–H | Matriz + tipología captadores + MD captación | ≥90 % familia F1–F5 automatizado o handoff correcto |
| Comprador A–D | Tipología compradores + MD compradores | Idem |
| Fallback | §8.0 | **100 %** triggers críticos |

Checklist por conversación: stage correcto, identidad, no flip `lead_flow`, **fallback si aplica**, latencia &lt; umbral.

### 8.4 F5 — Lote corto (20 conversaciones)

Checklist por conversación: stage correcto, identidad, no flip de `lead_flow`, latencia &lt; umbral, cero errores CRM si F6 aún off.

---

## 9. Estrategia deploy (Railway)

- **F0–F1:** deploy solo si hay hotfix; sin flags V3 en prod.  
- **F2–F4:** rama dedicada + entorno staging o servicio duplicado si existe; flags en `false` en prod.  
- **F5:** mismo servicio prod **solo** si allowlist está vacía por defecto; activar allowlist vía env en ventana QA; monitor logs `PERSEO_V3_LOG_DECISION_DIFF`.  
- **F6+:** canary por flag + allowlist extendida o porcentaje (si se introduce en F9).  
- **Versionado:** etiquetar release Git por fase; anotar SHA en runbook.

---

## 10. Estrategia rollback

| Situación | Acción |
|-----------|--------|
| Degradación en allowlist | `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED=false`; vaciar allowlist; redeploy SHA anterior |
| CRM duplicado / ruido | Flag V3 off + revisar idempotencia F6; no re-parchear legacy sin postmortem |
| Copy incorrecto | Composer rollback por flag `PERSEO_V3_COMPOSER_ONLY` / versión prompt versionada |

Siempre: **`!reset`** disponible para QA; conservar comandos `!state` para auditoría.

---

## 11. Qué **no** requiere Supabase todavía (F1–F4)

- Diseño de **contratos** TypeScript/JSDoc o JSON Schema en repo.  
- **Tests unitarios** puros del state machine y del composer (fixtures en memoria).  
- **Shadow logging** puede ir a stdout/Logtail sin nuevas tablas (evitar PII).

---

## 12. Qué **podría** requerir Supabase después

| Necesidad | Posible cambio |
|-----------|------------------|
| Auditoría de decisiones V3 | Tabla `conversation_decision_log` o JSON append-only en columna existente (evaluar tamaño) |
| Allowlist persistente | Tabla small config vs env (preferencia operativa) |
| `conversation_stage` / `identity_state` formales | Extensión de `ai_state` JSON (sin migración destructiva) o columnas nuevas si se exige reporting SQL |
| Retiro legacy | Ningún cambio obligatorio hasta que reporting lo pida |

**Principio:** maximizar campos dentro de `ai_state` JSON hasta que el volumen o reporting exija columnas.

---

## 13. Convivencia legacy + V3

```
Inbound → [flag V3?]
           ├─ false → legacy path (actual), sin nuevos parches salvo F0
           └─ true  → V3 pipeline:
                      Interpreter (+ OpenAI acotado)
                      → Rule guard
                      → Stage engine
                      → (shadow: comparar con legacy sin persistir decisión V3)
                      → Composer V3
                      → persistir solo salida validada + patch de estado acordado
```

- **F3 shadow:** ejecutar V3 en paralelo; persistir solo legacy; opcionalmente log diff.  
- **F5:** una sola escritura autoritativa; legacy desactivado **solo** para allowlist.  
- **Transición:** “strangler fig” — sustituir función por función detrás del mismo webhook.

---

## 14. Criterios para retirar legacy

- Matriz **≥200** conversaciones documentadas (100 oferta + 100 demanda) o muestreo estratificado por **familia** §1.1 con PASS en tono, identidad, stage, **fallback §1.3**, CRM cuando aplique.  
- **0** incidentes críticos abiertos en ventana acordada (p. ej. 2 semanas).  
- Cobertura de tests V3 ≥ umbral definido por el equipo.  
- Runbook y owner de on-call.  
- Deprecación explícita: lista de archivos legacy en “solo lectura / archivados” antes de borrar código muerto.

---

## 15. Primera fase exacta a implementar: **V3-F0**

**Estado ETAPA 0:** ver checklist operativo en `docs/sprints/perseo-etapa-0-congelamiento-control.md` (diagnóstico, flags, rollback, rama control).

**Entregables concretos de F0 (sin reconstruir aún el motor):**

1. **ADR o sección en este doc** firmando congelación + excepciones (“solo emergencia”).  
2. **Lista versionada** de rutas prohibidas de modificación sin revisión (p. ej. `buildConsultiveFallbackReply`, nuevos guards en `contextualMemoryResolver`).  
3. **Runbook** one-pager: flags actuales, quién aprueba hotfix, cómo revert.  
4. **Esqueleto de carpeta** `conversation/v3/README.md` + `PERSEO_ENGINE=legacy|v3(reservado)` vía `config/perseoEngine.js` (ver `docs/sprints/perseo-v3-f0-legacy-freeze.md`).  
5. **Ticket template** para bugs: “¿es hotfix legacy o trabajo V3-Fn?”.

Inmediatamente después, **V3-F1**: ampliar `conversation/v3/` con interfaces / stubs + `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED=false` + tests que importan el paquete sin ejecutar en webhook.

---

## Apéndice — Arquitectura objetivo (resumen)

1. **Conversation State Manager** — estado protegido y merges auditables.  
2. **Intent & Context Interpreter** — OpenAI principal con salida **estructurada y validada**.  
3. **Rule Guard / Business Validator** — invariantes (lead_flow, CRM, inventario, humano); violación → **fallback §1.3**.  
4. **Conversation Stage Engine** — enum mínimo (NEW → … → CLOSED / HANDOFF_* / HUMAN_ESCALATION).  
5. **Human Conversation Composer** — español MX, una pregunda, frustración, **copy de canalización obligatoria** en fallback.  
6. **CRM Execution Layer** — solo tras gate explícito; nunca mezclado con redacción; admite handoff con calificación parcial + `handoff_reason`.

### Apéndice B — Documentos fuente del catálogo QA

| Documento | Rol |
|-----------|-----|
| Tipología conversacional captadores (A–H) | Priorización oferta |
| Matriz QA captación PERSEO | Casos y PASS/FAIL |
| *Ejemplo pláticas captación* | Guiones oro + ~100 casos |
| Tipología conversacional compradores (A–D) | Priorización demanda |
| *Ejemplo pláticas compradores* | Guiones LUX-Axxxx + ~100 casos |
| `perseo-v3-f3-qualification-handoff.md` | Handoff, consent, stages |
| `plan-oficial-perseo-madurez-conversacional-p0-p6.md` | Tesis rectora v2.x |

---

*Documento vivo: actualizar al cerrar cada fase (fecha, SHA, owner). Última ampliación: catálogo ~200 escenarios + fallback universal §1.3.*
