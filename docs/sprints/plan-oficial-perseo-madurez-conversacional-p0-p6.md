# Plan oficial PERSEO — Madurez conversacional y arquitectura híbrida

**Versión:** 2.1  
**Estado:** Activo — documento rector (reemplaza la tesis 1.0 centrada solo en anti-loop / parches)  
**Alcance:** `luxetty-perseo` (núcleo WhatsApp), coordinación con ATENA / Supabase / Railway según fase.  
**Implementación V3:** ver `docs/sprints/perseo-conversational-core-v3-roadmap.md` (fases F0–F9, catálogo ~200 escenarios, fallback §1.3).

---

## 0. Changelog de versión

| Versión | Fecha | Cambios |
|---------|--------|---------|
| 1.0 | 2026-05-14 | Plan P0–P6 por capas (anti-loop, nombre, mensajes cortos, memoria, CRM, campañas, multimedia, operación, métricas). |
| **2.0** | **2026-05-15** | **Nueva tesis estratégica:** arquitectura conversacional centralizada, estado persistente prioritario, Stage Engine + Identity Layer, Intent Locking, **OpenAI Decision Core acotado** + **Rule Guard / Business Validator** + **Human Conversation Composer**. Roadmap reorganizado en **fases R0–R7**. Mapeo explícito del plan P0–P6 heredado y qué se congela vs qué se ejecuta ya. |
| **2.1** | **2026-05-15** | **Catálogo oficial ~200 escenarios** (captación oferta + compradores demanda). **Regla inviolable de fallback:** si PERSEO no puede manejar la plática → **canalizar con asesor** + **promesa de contacto**. Enlace explícito a roadmap V3 §1.1–§1.3. |

---

## 1. Conclusión estratégica (por qué PERSEO “falla” hoy)

El foco del trabajo **ya no** es únicamente **anti-loop**, **parches de templates** o **ifs aislados**.

**Tesis:** PERSEO falla en producción porque **no tiene una arquitectura conversacional centralizada**. Hoy predomina un modelo **reactivo por mensaje**: varios módulos compiten (parser, `ai_state`, fallback consultivo, sustitución contextual, anti-loop, guardrails de nombre, CRM), el **estado se pisa** entre turnos, y las **plantillas mezclan oferta y demanda** cuando el mensaje actual no lleva palabras clave de venta (p. ej. solo “Cumbres” o “está en Cumbres”).

Evidencia reciente (datos Luxetty / Supabase, ventana 96 h, conversaciones/mensajes): aparecen salidas tipo **“te ayudo a buscar casa…”** con **`lead_flow: demand`** y **`operation_type: sale`** a la vez — patrón coherente con **señal del turno ganando al hilo persistido**.

**Consecuencia comercial:** pérdida de confianza, sensación de bot, abandono **antes** de que importe el pipeline de leads — independientemente de cuántos parches locales se apliquen.

---

## 2. Objetivo del producto (nuevo)

Aplicar una **reestructura controlada** para dar **continuidad**, **control** y **coherencia** conversacional **sin** perder el efecto **“plática con asesor humano”**.

**Explícitamente NO se busca:**

- convertir PERSEO en **formulario**;
- acumular **ifs sueltos** sin capa de decisión;
- dejar a **OpenAI libre** mutando CRM, duplicando contactos o inventando inventario.

**Sí se busca — arquitectura híbrida:**

| Capa | Rol |
|------|-----|
| **Reglas duras** | Estado protegido, permisos, modo humano/IA, CRM idempotente, no inventar propiedades/precios/disponibilidad, anti-duplicados. |
| **OpenAI (acotado)** | Motor conversacional principal: interpretar contexto, proponer siguiente mejor paso, redactar como asesor — **salida estructurada** validada antes de persistir. |
| **Backend** | Validador y ejecutor de negocio: aplica solo lo permitido; rechaza o corrige propuestas inválidas; **fallback = canalización a asesor** (ver §2.1). |

### 2.1 Regla inviolable — cuando PERSEO no puede manejar la plática

**Obligatorio en producto y QA:** si el sistema **no puede** continuar de forma segura, útil y honesta (intención desconocida, violación de reglas, bucle, multimedia no soportado, error técnico, legal fuera de alcance, escenario fuera del catálogo activo, etc.), el **último mensaje al contacto** debe:

1. Reconocer el límite con tono consultivo (sin culpar al usuario).  
2. Indicar que **canalizará su caso con un asesor** de Luxetty.  
3. Indicar que **lo contactarán** (preferentemente por WhatsApp / el mismo medio).

**Prohibido:** dejar al usuario sin salida, inventar datos para “responder algo”, o solo pedir que “vuelva a escribir”.

**Única excepción habitual:** el contacto **rechaza explícitamente** ser contactado → cierre cordial sin promesa de llamada.

Detalle de triggers, copy y fases de implementación: **`perseo-conversational-core-v3-roadmap.md` §1.3** y **`perseo-v3-f3-qualification-handoff.md` §5.1**.

### 2.2 Alcance conversacional oficial (~200 escenarios)

PERSEO debe cubrir, por **familias** implementables (no 200 ramas `if`):

| Carril | Intención de negocio | Fuentes QA |
|--------|----------------------|------------|
| **Oferta** | Captación: vender / rentar inmueble del contacto | Tipología captadores A–H; matriz captación; ~100 pláticas captación |
| **Demanda anclada** | Interés en propiedad concreta (código, pauta) | Tipología compradores; guiones LUX-Axxxx |
| **Demanda abierta** | Búsqueda compra/renta sin código fijo | Tipología compradores A–D; casos 2–25 y bloques B–D |

Priorización: plataforma handoff (ola **P**) → carriles **O1+D1** en paralelo → ambigüedad → objeciones → delicado → CRM/multimedia. Tabla completa en roadmap V3 §1.1.

---

## 3. Transformación del pipeline (tesis operativa)

**De (hoy, simplificado):**

```txt
mensaje → parser → ifs → templates → respuesta
```

**A (objetivo):**

```txt
estado persistente → interpretación contextual → reglas duras → decisión conversacional → respuesta humana → ejecución CRM controlada
```

---

## 4. Arquitectura objetivo (bloques)

### 4.1 Persistent Conversation State

El **estado persistente manda más que el mensaje actual** cuando ya hay contexto válido.

Debe proteger y versionar lógicamente (donde viva hoy `ai_state` y extensiones acordadas):

- `lead_flow`, `operation_type`
- `conversation_stage` (nuevo — ver §5)
- `identity_state` (capa identidad — ver §6)
- `active_property_id` / `property_code`
- `location_text`
- **Valor económico según contexto:** p. ej. `expected_price` / rango venta vs `budget_max` compra — sin mezclar semántica
- `last_user_confirmed_fields` / huella de confirmación
- `awaiting_field`, `last_assistant_question`
- modo IA / humano / escalamiento

**Regla dura (Intent Locking — ver §7):** mensajes cortos (“Cumbres”, “está en Cumbres”, “8 millones”, “Jorge”, “sí”, “ok”) **no** deben poder **voltear** el flujo principal (p. ej. de **offer/sale** a **demand/search**) sin **intención explícita** del usuario.

---

### 4.2 Conversation Stage Engine

Etapas oficiales propuestas:

| Etapa | Significado breve |
|-------|---------------------|
| `NEW` | Sin contexto operativo aún. |
| `UNDERSTANDING` | Intención en clarificación (compra/renta/venta/visita/valuación). |
| `IDENTITY_PENDING` | Falta identidad usable; se puede conversar pero no “cerrar” CRM duro. |
| `QUALIFYING` | Captación de datos comerciales con orden y límites. |
| `PROPERTY_CONTEXT` | Propiedad/código activo o anuncio resuelto. |
| `READY_FOR_CRM` | Criterios mínimos para crear/actualizar lead sin basura. |
| `HANDOFF_READY` | Listo para asesor humano o canal operativo. |
| `HUMAN_ESCALATION` | Modo humano / takeover. |
| `CLOSED` | Conversación cerrada o archivada (según producto). |

Cada transición debe ser **explícita** (evento + regla), no side-effect de un template.

---

### 4.3 Identity Layer

El nombre **no** es un formulario al inicio.

**Regla de producto:** PERSEO **primero** escucha / interpreta, **luego** responde reconociendo contexto y, si falta identidad, pide nombre **en la misma respuesta**.

- **Correcto:** “Claro, te ayudo con la venta. Antes de avanzar, ¿cómo te llamas?”
- **Incorrecto:** “¿Cómo te llamas?” solo.

**Estados de identidad (contrato):**

| Estado | Significado |
|--------|-------------|
| `unknown` | Sin nombre usable. |
| `inferred` | Inferido (WA o texto), no confirmado. |
| `confirmed` | Usuario confirmó o nombre claro persistido en conversación. |
| `crm_linked` | Alineado con contacto CRM. |

---

### 4.4 Intent Locking / Flow Guard

Si el hilo ya es **offer / venta** (`lead_flow` y/o `operation_type` según política única documentada), **no** puede pasar a **demand / búsqueda** por mensajes cortos, ubicación, monto o nombre.

**Cambio de flujo permitido** solo con intención explícita, p. ej.:

- “también quiero comprar”, “no, en realidad busco casa”, “además quiero rentar”, “quiero vender y comprar”.

El backend debe **rechazar** propuestas de modelo que violen el lock salvo confianza alta + texto explícito (política a definir en R2).

---

### 4.5 OpenAI Decision Core

OpenAI es el **motor conversacional principal**, **no** el legislador del CRM.

**Entrada (mínimo conceptual):** mensaje actual, resumen de estado persistente, historial reciente acotado, invariantes de negocio, datos reales disponibles (inventario/propiedad si aplica), campos faltantes, tono, **lista de campos/flags que NO puede cambiar sin validación**.

**Salida:** JSON estructurado (ejemplo orientativo — el schema final vive en el doc de re-arquitectura R2):

- `interpreted_intent`
- `proposed_lead_flow` / `proposed_operation_type` (sujetos a guard)
- `detected_fields`
- `identity_update`
- `next_stage`
- `next_best_question`
- `confidence`
- `should_escalate`
- `reply_draft`

**Persistencia:** solo después de **Rule Guard / Business Validator** (§4.6).

---

### 4.6 Rule Guard / Business Validator

El backend **bloquea o corrige** propuestas inválidas, por ejemplo:

- offer → demand sin intención explícita;
- crear lead sin contacto válido / identidad mínima acordada;
- inventar propiedad, precio, disponibilidad;
- responder automatizado si humano tiene control;
- duplicar contacto/lead (idempotencia);
- uso indebido de `public.requests` (si sigue prohibido por política);
- modificar estado crítico por mensajes ambiguos.

---

### 4.7 Human Conversation Composer

Capa final (puede ser el mismo modelo en segunda pasada **o** plantilla mínima supervisada) para:

- máximo **una** pregunta principal por turno;
- no menús largos ni “dime en una frase” robótico;
- no repetir saludo sin motivo;
- reconocer lo dicho por el usuario;
- nombre natural cuando falte;
- siguiente paso claro.

---

## 5. Roadmap oficial — Fases R0–R7

### FASE R0 — Stabilization Guardrails (inmediato)

**Objetivo:** producción deja de mezclar **offer/demand** por mensajes cortos.

**Incluye:**

- **P0.1.2 Context Continuity Guardrail** (nombre interno; entrega mínima antes de R1 amplio).
- **Sticky** `lead_flow` / `operation_type` con reglas documentadas.
- **No flip** por mensajes cortos / ubicación / monto / nombre / “sí” / “ok”.
- **Regression test** obligatorio del guion:

  `!reset` → “Quiero vender mi casa” → “8 millones” → “está en Cumbres” → “Jorge”

  **PASS:** sin “buscar casa” ni presupuesto de comprador; `lead_flow` coherente con venta; nombre pedido de forma natural.

**Schema:** preferible **sin** migración obligatoria en R0 (campos extra en `ai_state` JSON si hace falta).  
**ATENA:** sin cambios obligatorios.  
**Railway:** solo si se activa flag puntual (recomendado default `false` si se toca motor).

---

### FASE R1 — Conversation State & Stage Engine

**Objetivo:** capa central de continuidad.

**Incluye:** `conversation_stage`, `identity_state`, **protected intent**, últimos campos confirmados, `awaiting_field` coherente, transiciones de etapa, telemetría de transición.

**CRM:** solo lo **existente**; no reescribir `leadAutomation` completo aquí.

**Schema:** posible migración ligera o convivencia en `ai_state` hasta decidir columna dedicada (decisión de ingeniería en el sprint R1).

---

### FASE R2 — OpenAI Decision Core

**Objetivo:** modelo como **decisor conversacional acotado** + validación dura.

**Incluye:** prompt de decisión estructurada, **JSON schema**, validador, fallback determinista, tests de contrato, **feature flag** de rollout.

**Railway:** `PERSEO_AI_DECISION_CORE_ENABLED` (nombre orientativo), keys OpenAI ya usadas o dedicadas.

---

### FASE R3 — Human Conversation Composer

**Objetivo:** “plática humana” estable bajo el Decision Core.

**Incluye:** tono consultivo, una pregunta por turno, nombre con contexto, anti-menú, coherencia con Stage Engine.

---

### FASE R4 — CRM Execution Hardening

**Objetivo:** cuando la conversación es estable, **endurecer** contacto, lead, asignación, eventos, notificaciones, idempotencia.

**Incluye:** alineación de umbrales, `conversation_events`, reducción de leads basura.

---

### FASE R5 — Campaign & Referral Intelligence

**Objetivo:** pautas reales con contexto (Meta referral, campaña, CTA, “info/me interesa/precio” con recuperación de contexto de anuncio).

**Dependencia:** R1 mínimo + señales de campaña; R4 recomendable para no contaminar CRM.

---

### FASE R6 — Multimedia & Advanced Channels

**Objetivo:** multimedia **honesto** (audio, imagen, documentos, ubicación, interactive, quick replies).

**Dependencia:** políticas de no alucinar; flags de ingest existentes.

---

### FASE R7 — QA, Metrics & ARGOS

**Objetivo:** medir calidad real (matrices grandes, métricas anti-loop, conversión, fallas por etapa, ATENA Insight / ARGOS).

---

### Bloque futuro — Learning, Policy & Multimodal (LP0–LP8)

**No bloquea M1 ni cierre M1-D.** Documento rector:

`docs/argos/PERSEO-ARGOS-LEARNING-POLICY-MULTIMODAL-ROADMAP-v1.md`

| Tema | Fases roadmap LP | Relación R0–R7 |
|------|------------------|----------------|
| Corpus masivo + promoción a escenarios | LP1–LP2, LP8 | Amplía **R7** (ARGOS); evita 10k JSON |
| Policy comercial (montos, zonas, descarte) | LP0, LP3 | Complementa **R2** RuleGuard / negocio |
| Exploratory runs no bloqueantes | LP4 | **R7** métricas |
| Audio / imagen | LP5–LP6 | **R6** multimedia |
| Mensajes multintención | LP7 | **R2–R3** Decision Core + composer |

**Prioridad post M1:** ver **`docs/argos/PERSEO-ARGOS-INTEGRATED-ROADMAP-v2.md`** (M2: bloques A–C; M3: D–E; M4: UI/exploratory). Arquitectura LP: `PERSEO-ARGOS-LEARNING-POLICY-MULTIMODAL-ROADMAP-v1.md`.

---

## 6. Qué queda del plan P0–P6 y cómo se mapea

| Bloque heredado (P0–P6) | Destino en roadmap 2.0 |
|-------------------------|-------------------------|
| P0.1 Anti-loop, dedupe, frustración | **R0** (guardrails mínimos) + **R3** (composer) + métricas **R7** |
| P0.1.1 Estabilización offer/demand en templates | **R0** (continuidad) — absorbido por tesis, no como “parche infinito” |
| P0.1.2 Continuidad contextual / sticky intent | **R0** (entrega crítica) |
| P0.2 Nombre humano + `identity_state` | **R1** + **R3** (Identity Layer + composer) |
| P0.3 Mensajes cortos | **R1**–**R3** (estado + decisión + tono); **R5** con campaña |
| P0.4 Memoria mínima | **R1** (estado + last confirmed / last question) |
| P1 Conversión comercial | **R3** principalmente; profundización bajo Decision Core **R2** |
| P2 CRM hardening | **R4** |
| P3 Campaign intelligence | **R5** |
| P4 Multimedia | **R6** |
| P5 Operación humana | **R1** (`HUMAN_ESCALATION`) + **R4**–**R7** según política |
| P6 Intelligence / métricas | **R7** |

---

## 7. Sprints / enfoques congelados o subsumidos

- **Congelado como “estrategia sola”:** crecer **solo** con nuevos `if` en `buildConsultiveFallbackReply` / sustitutos sin **Stage Engine** y sin **Intent Lock** — se aceptan **parches mínimos** únicamente dentro de **R0** para contener producción.
- **Subsumido:** el plan 1.0 que trataba P0 como “anti-loop primero y ya” pasa a ser **parte** de R0–R3 bajo la tesis híbrida.
- **P0.2–P0.4** no se cancelan conceptualmente: se **reordenan** bajo R1–R3 con contratos claros.

---

## 8. Qué se ejecuta inmediatamente (orden)

1. **R0 — P0.1.2** Context Continuity + sticky intent + test de regresión del guion venta/Cumbres/Jorge.  
2. Documentar en código el **contrato de estado** que R1 va a formalizar (aunque el campo `conversation_stage` llegue en un segundo PR).  
3. Preparar **spec** del JSON del Decision Core (enlace al doc `perseo-ai-decision-core-rearchitecture.md`).  
4. **No** iniciar R4 (CRM duro amplio) hasta PASS de R0 en WhatsApp real.

---

## 9. Schema Supabase — qué requiere y qué no

| Fase | Schema |
|------|--------|
| **R0** | Ideal **sin** migraciones obligatorias; usar `ai_state` JSON y flags. |
| **R1** | Opcional: columnas dedicadas o JSON schema versionado; si hay migración, debe ser **acotada** y reversible. |
| **R2+** | Posibles tablas de auditoría de decisiones (opcional); no bloquear R0 por esto. |

---

## 10. ATENA — qué requiere y qué no

| Fase | ATENA |
|------|--------|
| **R0–R3** | **No** requerido para cerrar continuidad PERSEO; coordinación solo si política global afecta respuesta automática. |
| **R5–R7** | Paneles, insight, handoff UI según producto. |

---

## 11. Railway / variables de entorno

| Variable (orientativa) | Uso |
|------------------------|-----|
| `PERSEO_AI_DECISION_CORE_ENABLED` | Rollout del núcleo de decisión OpenAI (R2), default `false`. |
| `PERSEO_CONVERSATION_STAGE_ENGINE_ENABLED` | Rollout Stage Engine (R1), default `false` hasta estabilizar. |
| Keys / modelos OpenAI existentes | Reutilizar o separar “decisión” vs “redacción” según costo. |

R0 puede desplegarse **sin** nuevas variables si solo hay cambios deterministas en código.

---

## 12. Feature flags recomendadas

- `PERSEO_AI_DECISION_CORE_ENABLED` — R2.  
- `PERSEO_STAGE_ENGINE_ENABLED` — R1.  
- `PERSEO_HUMAN_COMPOSER_V2_ENABLED` — R3 (opcional, si se separa pasada de redacción).  

Principio: **default false**, rollout por porcentaje o allowlist QA.

---

## 13. Riesgos

| Riesgo | Mitigación |
|--------|------------|
| Complejidad de transición R0→R1→R2 | Entregar R0 congelado y medible antes de abrir R2 en prod. |
| Modelo propone cambios de estado inválidos | Validator duro + tests de contrato + flag. |
| Costo/latencia duoble pasada (decidir + redactar) | Cache, resumen de estado, modelo único con schema si basta. |
| Sobre-corrección anti-flip | Frases explícitas de cambio de intención + tests. |
| Desalineación PERSEO/ATENA en modo humano | Reglas en R1/R4 y eventos explícitos. |

---

## 14. Criterios de cierre (por fase)

| Fase | Cierre (resumen) |
|------|------------------|
| **R0** | Guion venta + Cumbres + Jorge en WhatsApp real **PASS**; 0 casos `demand`+`sale`+“buscar casa” en matriz mínima de QA. |
| **R1** | Todas las transiciones de `conversation_stage` auditables; `awaiting_field` alineado con copy. |
| **R2** | ≥X% turnos con JSON válido; 0 violaciones de invariantes en logs de validación. |
| **R3** | Checklist “no formulario”, 1 pregunta principal, tono consultivo en panel ciego. |
| **R4** | Leads sin duplicados basura; idempotencia verificada. |
| **R5–R7** | KPIs acordados con negocio. |

**Milestone V1 (reafirmado):** **20** conversaciones reales consecutivas (WhatsApp, tráfico típico) **sin parecer bot** — ahora interpretado también como **coherencia de flujo** (no solo ausencia de loops).

---

## 15. Matriz de QA en producción (mínima post-R0)

| # | Caso | PASS |
|---|------|------|
| 1 | `!reset` | Estado limpio, sin lead basura por comando. |
| 2 | Hola | Sin falsa recuperación anti-loop. |
| 3 | Info | Respuesta útil, no idéntica a hola si no aplica. |
| 4 | Quiero vender mi casa | Lenguaje venta/captación. |
| 5 | 8 millones / valor | No convierte a “presupuesto de compra” en hilo venta. |
| 6 | está en Cumbres / Cumbres | **No** “buscar casa”; no flip a demand. |
| 7 | Jorge | Identidad reconocida; no bucle nombre. |
| 8 | “No, busco casa” | **Sí** permite cambio explícito a demanda. |
| 9 | Modo humano / IA | Sin respuesta automática cuando humano controla. |

Ampliar a las matrices históricas (50/100 conversaciones) en **R7**.

---

## 16. Pruebas obligatorias con WhatsApp real

- Toda fase **R0–R3** debe incluir al menos un ciclo de **QA en número allowlisted** antes de merge a producción.  
- Registro de conversación en Supabase revisado (mensaje + metadata si existe) para casos FAIL.  
- `!state` como herramienta de depuración hasta tener panel en R7.

---

## 17. Definición: “PERSEO puede atender una persona sin fallar”

**Incluye escenarios fuera de catálogo:** “no fallar” = **canalizar correctamente** con mensaje de asesor + contacto (§2.1), no quedarse colgado ni alucinar.

**Mínimo aceptable (post R0 + R1 + R3, antes de CRM duro amplio):**

Un usuario puede completar en WhatsApp, sin asesor intermedio:

```txt
!reset
Hola
Quiero vender mi casa
Jorge
Está en Cumbres
Vale como 8 millones
```

**PASS obligatorio:**

- no cambia a **demand/search** sin intención explícita;
- pide nombre de forma **natural** y lo **usa** en turnos siguientes;
- habla de **venta/captación**, no de “búsqueda”;
- no repite la misma pregunta sin motivo;
- no inventa propiedades ni disponibilidad;
- no crea **lead basura** por ruido (según política vigente; endurecimiento total en R4);
- cierra cada turno con **un** siguiente paso claro.

---

## 18. Grafo de dependencias (R0–R7)

```txt
R0 Stabilization ──► R1 State & Stage ──► R2 Decision Core ──► R3 Composer
        │                    │                    │
        └────────────────────┴────────────────────┴──► R4 CRM Hardening
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
                 R5 Campaigns    R6 Multimedia     R7 Metrics/ARGOS
```

---

## 19. Mantenimiento del documento

- Actualizar **versión** y **changelog** al cierre de cada fase.  
- Enlazar PRs y resultados de QA en anexo (tabla por fase R*).

### Documentos complementarios

- **`docs/sprints/perseo-conversational-core-v3-roadmap.md`** — fases F0–F9, catálogo ~200 escenarios, olas QA, **fallback universal §1.3** (implementación).  
- **`docs/sprints/perseo-v3-f3-qualification-handoff.md`** — handoff, consent, stages, copy de canalización.  
- **`docs/sprints/perseo-ai-decision-core-rearchitecture.md`** — Decision Core, schema JSON, validador, flags.

---

*Fin del plan oficial v2.1.*
