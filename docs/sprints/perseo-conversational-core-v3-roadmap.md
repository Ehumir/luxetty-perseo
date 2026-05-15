# PERSEO — Conversational Core V3 (reconstrucción total)

**Estado:** dirección aprobada — **no sustituir producción con parches incrementales al motor legacy.**  
**Objetivo:** reemplazar **progresivamente** el motor actual por un núcleo centralizado: continuidad, etapas, identidad, decisión acotada, validación de negocio y redacción humana.

**Relación con roadmap anterior:** lo que antes se agrupaba como “P0 parches + R0 guardrails” queda **congelado como legacy**; el avance oficial pasa a ser **V3-F0 … V3-F9** bajo este documento.

---

## 1. Plan de refactorización por fases (V3-F0 … F9)

| Fase | Nombre | Objetivo | Producción |
|------|--------|----------|------------|
| **V3-F0** | Congelamiento y contención | Dejar de expandir el motor legacy; solo hotfixes críticos documentados. | 100 % legacy |
| **V3-F1** | Núcleo en paralelo | `conversation/v3/`: contratos + tests; sin cablear al webhook. | Legacy + flag `false` |
| **V3-F2** | Stage + identidad mínimo | Flujo venta básico con nombre y zona; sin CRM duro. | Legacy; V3 solo tests / dev |
| **V3-F3** | Decision Core shadow | JSON OpenAI; comparar vs legacy; logs de diff. | Legacy ejecuta; V3 observa |
| **V3-F4** | Human Composer V3 | Redacción MX, frustración, una pregunta, sin “house”/menús. | Tras F2 en ramas QA |
| **V3-F5** | Activación QA allowlist | WhatsApp real; números autorizados; ~20 conversaciones. | Subconjunto controlado |
| **V3-F6** | CRM execution | Contacto, lead, idempotencia, eventos — **después** de conversación estable. | Tras PASS F5 |
| **V3-F7** | Campaigns / Meta Ads | Referral, info/precio/ubicación/me interesa, propiedad desde pauta. | Tras F6 estable |
| **V3-F8** | Multimedia | Audio, imagen, PDF, ubicación, interactive; honestidad. | Tras conversación base |
| **V3-F9** | Release estable y retiro legacy | Matriz grande, deprecación gradual, runbook. | Rollout parcial → total |

Cada fase debe tener **tests automatizados** y **criterios PASS/FAIL** explícitos antes de avanzar.

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

---

## 7. Orden de implementación (resumen)

1. **F0** — Política de congelación + lista de “solo emergencia”.  
2. **F1** — Carpeta `conversation/v3/` + contratos + tests unitarios.  
3. **F2** — State manager + stage + identity mínimos en V3 (sin CRM).  
4. **F3** — Interpreter + JSON + rule guard **solo shadow**.  
5. **F4** — Composer V3 + frustración + una pregunta.  
6. **F5** — Allowlist QA en Railway.  
7. **F6** — CRM execution detrás de “READY_FOR_CRM”.  
8. **F7** — Ads/campañas.  
9. **F8** — Multimedia.  
10. **F9** — Matriz 100, deprecación legacy, documentación final.

---

## 8. Matriz QA (mínima ampliable)

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

### 8.3 F5 — Lote corto (20 conversaciones)

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

- Matriz **≥100** conversaciones (F9) con PASS en tono, identidad, stage, CRM cuando aplique.  
- **0** incidentes críticos abiertos en ventana acordada (p. ej. 2 semanas).  
- Cobertura de tests V3 ≥ umbral definido por el equipo.  
- Runbook y owner de on-call.  
- Deprecación explícita: lista de archivos legacy en “solo lectura / archivados” antes de borrar código muerto.

---

## 15. Primera fase exacta a implementar: **V3-F0**

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
3. **Rule Guard / Business Validator** — invariantes (lead_flow, CRM, inventario, humano).  
4. **Conversation Stage Engine** — enum mínimo (NEW → … → CLOSED).  
5. **Human Conversation Composer** — español MX, una pregunda, frustración, sin menús ni “house”.  
6. **CRM Execution Layer** — solo tras gate explícito; nunca mezclado con redacción.

---

*Documento vivo: actualizar al cerrar cada fase (fecha, SHA, owner).*
