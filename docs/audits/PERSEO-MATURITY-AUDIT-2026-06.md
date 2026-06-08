# PERSEO — Auditoría de madurez y versiones APA

| Campo | Valor |
|-------|--------|
| **Fecha** | 2026-06-08 (MC-7 certificación Cuarzo) |
| **Repos** | `luxetty-perseo` prod `@026669e` · main `@610af08` |
| **Fuente roadmap** | `luxetty-atena/docs/APA-OFFICIAL-VERSIONING-ROADMAP.md` |
| **Fuente única de verdad** | `luxetty-atena/docs/audits/CUARZO-V1-MASTER-CLOSURE-PLAN.md` v1.4 |
| **Alcance Cuarzo canónico** | Master Plan §4 + [`CUARZO-V1-SCOPE-AND-PROGRESS.md`](../../luxetty-atena/docs/audits/CUARZO-V1-SCOPE-AND-PROGRESS.md) |
| **Madurez global PERSEO** | **~89%** |
| **Estado Cuarzo** | **✅ CERRADO MC-7** |

> Snapshot PERSEO. **Estados #1–46:** ver Master Plan §4. Este doc mapea capacidades técnicas PERSEO → ítems APA.

## Criterios oficiales de cierre de versión

Ver APA §4. Resumen operativo:

| Regla | Detalle |
|-------|---------|
| Cierre binario | Cada ítem del tier debe estar **✅**; 🟡 no cuenta |
| % orientativo PERSEO | **≥95%** por ítem + smoke/ARGOS PASS + deploy prod |
| Gate secuencial | No iniciar versión N+1 hasta cerrar N |
| P0 | Cero P0 abiertos **para el alcance de la versión** |

---

## Mapeo — capacidades técnicas PERSEO → ítems APA

Todas las capacidades huérfanas quedan bajo un **# existente** del catálogo APA (sin IDs P-xxx).  
**Cuarzo · no puede esperar** = bloquea GO pauta, cierre #8/#9/#15/#21/#46 o ya está en prod y debe certificarse en V1.0.

### Cuarzo (V1.0) — incluir ya · no puede esperar

| Capacidad técnica PERSEO | Ítem APA | Madurez | Acción para cerrar ítem |
|--------------------------|----------|---------|-------------------------|
| Resolución propiedad unificada (LUX, slug, título, fuzzy) | **#2** Motor V3 + **#27** URLs/mensajes WA | 75% | Certificar 11 entry points en prod; V3 allowlist sin caída a legacy |
| Desambiguación 2–3 opciones + `interested_property_id` | **#2** | 75% | Smoke WA ambiguo; persistir pick en `ai_state` |
| Entry points landing (`isPropertyAdEntry` ampliado) | **#17** CTAs WA + **#27** | 80% | Matriz 11/11 post-deploy documentada |
| `diagnose-property-landing-wa-v3` (8 turnos × 11) | **#40** Smoke WA + **#46** GO pauta | 85% | Ejecutar en CI/pre-deploy; adjuntar a release notes |
| Meta Lead Form (payload colapsado) | **#3** Calificación + **#16** canal WA | 76% | Smoke formulario Meta en staging/prod |
| Referral / CTWA persist (`extractCampaignReferralContext`) | **#16** + **#46** | 70% | Verificar `whatsapp_referral` en conversaciones pauta |
| C2 seller retargeting capture | **#3** calificación venta | 72% | ARGOS + smoke captación C2 |
| Organic offer CRM bypass | **#15** CRM execute prod | 95% | MC-4 certificado 2026-06-06 |
| M401 CRM worker / outbox (cuando persistent ON) | **#15** | 55% | Workers OFF prod — correcto |
| Sesión durable V3 + hidratación `ai_state` / inventario | **#8** | 96% | MC-5 prod certificado |
| Dedup inbound + burst (`inboundReliability` wiring) | **#9** | 88% | UNIQUE prod ✅; cablear burst + S4 |
| Fail-closed gatekeeper / policy ilegible | **#21** | 96% | MC-1 certificado |
| Handoff Cuarzo + cierre (`cuarzoHandoff`, `closureIntegrity`) | **#4** + **#5** | 73% | Terminal ack; no re-preguntar post-consent |
| Fallback consultivo + anti-loop + anti-eco | **#6** + **#5** | 94% | **4.7%** fallback 72h post-F2 ✅ |
| Comandos QA (`!reset`, `!state`, `!close`) | **#38** Suites P0 | 93% | mc6:pauta 15/15 MC-7 |
| ARGOS internal API + scenario runner | **#36–#39** Panel ARGOS | 92% | 6 suite runs DB MC-7 |
| Allowlist / flags / rollback (`phonesEquivalent` fix) | **#43** + **#44** | 88–94% | F2 ON · bypass×7 |
| Pauta detection + property CRM bypass | **#46** GO pauta escalable | 96% | ✅ MC-6 F2 GO · MC-7 certificado |
| Spanish outbound sanitizer + slot/location sanitizers | **#7** Español MX | 74% | Regresión copy robot |
| Name-first guardrails | **#3** | 78% | Sin eco de nombre en legacy |
| Contextual memory / R0 sticky (`r0ContextContinuity`) | **#3** | 70% | Sticky zone/intent en demanda y oferta |
| Supabase tiered property select | **#26** catálogo + **#8** | 72% | Auditoría 27/27 listings activos |
| Gatekeeper ATENA↔PERSEO | **#19–#20** + **#21** | 82% | V2 ON; 22 skip events 90d |

### Amatista (V1.1) — puede esperar

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Policy cross-layer M2 (`policyCrossLayer`) | **#47** Flex conversacional prod | 60% | Encendido prod junto flex |
| Flex M4-05 (conversational flex) | **#47** | 25% | OFF prod hoy |
| `property_history` / contexto por código | **#49** Historial operativo | 40% | Extender más allá de 5 entradas |
| Asignación asesor (`assignmentDecision`) | **#48** | 68% | Falta SLA y notificación |
| Handoff resumen estructurado al asesor | **#52** | 35% | Hoy copy handoff; no resumen CRM |
| Shadow mode V3 (validación pre-rollout) | **#43** rollout | 55% | Herramienta ops, no usuario final |
| Follow-ups inactividad (cron básico) | **#50** notificaciones → puente a **#61** | 58% | MVP cron; nurture completo en Topacio |
| Telemetry `v3_primary_gate` / eventos | **#37** KPIs | 70% | Base para Overview Amatista |

### Ágata (V1.2)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Audio Whisper + fallbacks | **#58** | 62% | Prod estable + respuesta útil |
| Image vision + context fusion | **#57** | 60% | |
| PDF / documento inbound | **#57** | 45% | Hoy fallback honesto Cuarzo |
| `inboundMediaV3Bridge` / media intake V3 | **#57** + **#58** | 55% | |
| Cuarzo fallbacks multimedia (legal/doc) | **#6** fallback | 70% | Certificado Cuarzo; respuesta rica en Ágata |

### Topacio (V2.0)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Follow-ups / abandon pauta → lead | **#61** Drip/nurture | 18% | Evolución del cron actual |
| Scripts / variantes composer | **#62** | 15% | |
| Recomendación “opciones similares” en chat | **#64** | 28% | Hoy ATENA similar + copy WA |
| Eventos conductuales (GTM ↔ agente) | **#65–#67** | 10–20% | |
| KPIs negocio en ARGOS | **#69** | 35% | Extender gate telemetry |

### Turquesa (V2.1)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Fuzzy title match / token overlap (proto-retrieval) | **#70** RAG inventario | 15% | Reemplazar heurística por RAG |
| Zone hints / `extractZoneFromPropertyPhrase` | **#73** Neighborhood intelligence | 10% | |
| Comparables en conversación | **#74** | 12% | |

### Peridoto (V2.2)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Intent “agendar visita” (sin calendario) | **#79** Agendamiento tours | 25% | Solo copy; calendario en V2.2 |

### Zafiro (V3.0)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| V3 `sessionStore` in-memory → multi-réplica | **#86** | 5% | Depende cerrar #8 en Cuarzo |
| Runtime metrics / health snapshot | **#84–#85** | 20% | `staging-runtime-health.js` |
| Model routing (OpenAI vs reglas) | **#87** | 5% | |

### Rubí (V3.1)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Redacción PII en logs / traces ARGOS | **#91** | 20% | |
| Consent parser → ledger auditable | **#89** | 15% | Extender #42 Cuarzo |

### Diamante (V4.0)

| Capacidad técnica PERSEO | Ítem APA | Madurez | Notas |
|--------------------------|----------|---------|-------|
| Engine V2 / OpenAI orchestrator | **#97** LLM hot path | 55% | **Deprecar** si V3+#97 lo sustituye |
| PRE-engine M4-05b | **#97** | 5% | |
| ARGOS corpus + learning governance | **#100** | 55% | |
| ARGOS trace export / auditoría prompts | **#101** | 10% | |
| Internal API → API pública terceros | **#98** | 8% | Evolución de `/internal/argos` |
| `conversationOrchestrator.harness` (WIP) | **#100** | 30% | Tests corpus, no prod |

### Tanzanita / Alejandrita / Benitoíta

| Capacidad técnica PERSEO | Ítem APA | Versión | Notas |
|--------------------------|----------|---------|-------|
| Human-in-the-loop sistemático ARGOS | **#106** | Tanzanita | Suites 365 días |
| A/B prompts (composer variants) | **#107** | Alejandrita | Hoy variant picker manual |
| Fine-tuning por cliente | **#109** | Benitoíta | — |

### Deprecación explícita

| Capacidad | Sustituida por | Cuándo |
|-----------|----------------|--------|
| Engine V2 / `conversationOrchestrator` prod | **#97** V3 + tool-calling | Al cerrar Diamante; mantener solo ARGOS/regresión hasta entonces |
| Legacy consultive fallback (objetivo) | **#2** V3 primary generalizado | Meta #46: &lt;5% tráfico pauta en fallback |

---

## Resumen por versión (conteo capacidades técnicas mapeadas)

| Versión | # ítems APA tocados | Capacidades PERSEO mapeadas | Prioridad |
|---------|---------------------|----------------------------|-----------|
| **Cuarzo** | 2–9, 15–17, 21–22, 26–27, 36–40, 43–46 | **22** | Cierre V1.0 |
| **Amatista** | 37, 43, 47–52 | **8** | Post-GO |
| **Ágata** | 6, 57–58 | **5** | Multimodal |
| **Topacio** | 61–67, 69 | **5** | Nurture |
| **Turquesa** | 70, 73–74 | **3** | RAG |
| **Peridoto** | 79 | **1** | Calendario |
| **Zafiro** | 84–87 | **3** | Escala |
| **Rubí** | 89, 91 | **2** | Compliance |
| **Diamante** | 97–98, 100–101 | **5** | Plataforma |
| **Tanzanita+** | 106–109 | **3** | Largo plazo |

**Governanza:** nuevas capacidades PERSEO se asignan al **# APA más cercano** en este anexo; si no encaja, proponer ampliación de redacción del ítem en `APA-OFFICIAL-VERSIONING-ROADMAP.md` §9 (sin inventar numeración nueva salvo aprobación producto).

---

*Plantilla viva — formato completo en `.cursor/rules/perseo-version-maturity-report.mdc`*
