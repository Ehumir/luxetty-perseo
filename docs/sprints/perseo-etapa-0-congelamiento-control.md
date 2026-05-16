# ETAPA 0 — Congelamiento y control del núcleo conversacional PERSEO

**Estado:** **cerrada (documental)** — 2026-05-15  
**Fecha apertura:** 2026-05-15  
**Objetivo:** dejar de romper el motor legacy mientras se reconstruye el Conversational Core V3 de forma ordenada.  
**Equivalente roadmap:** V3-F0 (`perseo-conversational-core-v3-roadmap.md`).

**Rama de control (solo documentación / coordinación):** `refactor/perseo-conversational-core-control` → apunta a `origin/main` (`6bef624` al diagnóstico).

**Referencias congeladas:**

- `docs/sprints/perseo-v3-f0-legacy-freeze.md` — alcance legacy y hotfix
- `docs/sprints/perseo-conversational-core-v3-roadmap.md` — fases F0–F9
- `docs/sprints/perseo-v3-f3-qualification-handoff.md` — handoff + fallback §5.1
- `docs/sprints/plan-oficial-perseo-madurez-conversacional-p0-p6.md` — tesis rectora v2.1

---

## 1. Diagnóstico de estado del repo (2026-05-15)

### 1.1 Git

| Campo | Valor |
|-------|--------|
| **Base de cierre** | `origin/main` @ `6bef624` (Merge PR #65) |
| **Rama de cierre** | `refactor/perseo-conversational-core-control` |
| **Nota histórica** | Diagnóstico inicial tomado en `feat/perseo-v3-f32-campaign-intake` @ `3969588` (ya integrado en main) |

### 1.2 Working tree (sin commitear)

**Modificados:**

- `docs/sprints/perseo-conversational-core-v3-roadmap.md`
- `docs/sprints/perseo-v3-f3-qualification-handoff.md`

**Sin seguimiento:**

- `docs/sprints/plan-oficial-perseo-madurez-conversacional-p0-p6.md`
- `docs/sprints/perseo-ai-decision-core-rearchitecture.md`
- `.github-pr-body-r0-p012.md`
- `test/conversationOrchestrator.harness.test.js`
- `test/crmCreationAuditV2.test.js`

**Acción recomendada antes de Etapa 1:** `git fetch origin && git checkout main && git pull` (actualizar `main` local); decidir stash/commit de docs en rama de control; **no** seguir feature en `feat/perseo-v3-f32-campaign-intake` (ya integrada en main).

### 1.3 Rama de control

```text
refactor/perseo-conversational-core-control  →  6bef624  (= origin/main al diagnóstico)
```

Creada localmente desde `origin/main`. **No** hacer merge ni deploy desde Etapa 0.

---

## 2. Producción / Railway (inferencia desde repo)

**No se modificó Railway ni variables remotas en Etapa 0.**

| Pregunta | Respuesta |
|----------|-----------|
| ¿Commit en producción? | **No verificable** desde este entorno (`gh` sin auth). **Referencia estable en GitHub:** `origin/main` @ `6bef624`. |
| ¿Rama que despliega Railway? | **No hay** `railway.toml` ni manifest en repo. Convención habitual: servicio enlazado a rama **`main`** del repo `luxetty-perseo`. **Confirmar** en Railway → Settings → Source / Deployments. |
| ¿Cómo confirmar SHA en prod? | Railway → último deploy → commit SHA; o logs al arranque: evento `server_started` (`index.js`) con `perseo_engine_requested`, `perseo_engine_effective`, `perseo_engine_v3_reserved_ignored` (**no** incluye git SHA hoy). |
| ¿PR #65 en main? | Sí — `6bef624` merge `feat/perseo-v3-f32-campaign-intake`. Si prod sigue `main`, el **código** de F3.3A/campaign intake **puede** estar desplegado; el **comportamiento** depende de flags (§3). |

---

## 3. Flags PERSEO (código vs documentación)

### 3.1 Implementados en runtime (`config/perseoV3Flags.js`, `config/perseoEngine.js`, `.env.example`)

| Variable | Default documentado | Efecto real |
|----------|---------------------|-------------|
| `PERSEO_ENGINE` | `legacy` | **Efectivo siempre `legacy`** en `getPerseoEngineRuntime()`; `v3` solo log `perseo_engine_v3_reserved_ignored` |
| `PERSEO_V3_ENABLED` | `false` | Maestro V3 primary |
| `PERSEO_V3_SHADOW_MODE` | `false` | V3 en sombra (legacy responde) |
| `PERSEO_V3_QA_ALLOWLIST` | vacío | CSV/`;` — solo estos números pueden ir a **v3_primary** si `ENABLED=true` |
| `PERSEO_V3_LOG` | `false` | Logs `[V3]` / `v3_primary_gate` |
| `PERSEO_V3_HANDOFF_ENABLED` | `false` | Handoff F3.1+ |
| `PERSEO_V3_CRM_DRY_RUN` | `true` | Sin create CRM real vía path V3 |
| `PERSEO_POLICY_V2_ENABLED` | `true` (prod) | Gatekeeper lee `ai_conversation_channel_settings` |
| `PERSEO_ENGINE_V2` | — | **Distinto** de `PERSEO_ENGINE`: activa `conversationEngineV2.js` (OpenAI) |
| `PERSEO_INBOUND_MEDIA_STORAGE_ENABLED` | `false` | Pipeline media storage |

**Gate V3 primary:** `evaluateV3PrimaryGate()` — requiere `PERSEO_V3_ENABLED=true` + allowlist no vacía + match teléfono. **No** usa `PERSEO_ENGINE=v3`.

### 3.2 Solo en documentación (aún no cableado en código)

| Variable | Notas |
|----------|--------|
| `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED` | Nombre en roadmap; **usar `PERSEO_V3_ENABLED`** en operación |
| `PERSEO_V3_LOG_DECISION_DIFF` | Roadmap F3 shadow |
| `PERSEO_V3_COMPOSER_ONLY` | Roadmap F4 |
| `PERSEO_AI_DECISION_CORE_ENABLED` | Plan oficial R2 — no en `perseoV3Flags.js` |
| `PERSEO_V3_QUALIFICATION_STRICT` | Plan F3.2 |
| `PERSEO_V3_CRM_EXECUTE` | Reservado F6 |

### 3.3 Valores típicos QA (documentados en PRs — **no** asumir en prod)

```env
PERSEO_ENGINE=legacy
PERSEO_V3_ENABLED=true
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_QA_ALLOWLIST=<número QA MX 521…>
PERSEO_V3_LOG=true
PERSEO_V3_HANDOFF_ENABLED=true   # solo si probando F3.1+
PERSEO_V3_CRM_DRY_RUN=true
```

**Producción global segura (Etapa 0):** `PERSEO_V3_ENABLED=false`, allowlist vacía, `PERSEO_V3_SHADOW_MODE=false`, `PERSEO_V3_HANDOFF_ENABLED=false`.

---

## 4. Política de congelamiento (Etapa 0)

Vigente hasta cierre formal de Etapa 0 y apertura controlada de **Etapa 1 (V3-F1)**.

### 4.1 Prohibido (sin excepción salvo hotfix §4.3)

- Multimedia **nueva** (pipelines, vision, audio nuevos)
- CRM **real nuevo** (creates, reglas, scoring, matching complejo)
- Scoring / matching avanzado de leads
- Nuevos **templates reactivos** en `buildConsultiveFallbackReply`, `contextualMemoryResolver`, `responseBuilder`
- Nuevos **`if` sueltos** en `index.js` para tono o intención
- Cambios de **prompts** en `perseoConsultantPrompt.js` por “mejora de plática”
- Expansión de **playbooks** legacy salvo hotfix
- **Merge a main**, **deploy**, cambios **Railway**, **Supabase**, migraciones
- Implementar **F3.3B fallback forzado** u otras features conversacionales (siguiente etapas)

### 4.2 Permitido

- Documentación de arquitectura, roadmap, runbooks (este doc)
- Tests que **no** cambien comportamiento productivo
- Scripts de diagnóstico (`check-perseo-sprint2-env.js`)
- Revisión / alineación de docs oficiales
- Crear ramas de **control** sin deploy

### 4.3 Hotfix crítico (única excepción de código productivo)

Solo si: seguridad, legal, caída webhook, pérdida datos CRM, bug **P0** en producción.

Cada hotfix:

1. Ticket con motivo y enlace a incumplimiento de congelamiento  
2. PR mínimo + plan de revert  
3. QA regresión §6 de `perseo-v3-f0-legacy-freeze.md`  
4. Postmortem si toca `index.js` o fallback consultivo  

### 4.4 Regla de producto (ya en roadmap — no implementar en Etapa 0)

Si PERSEO no puede manejar la plática → canalizar con asesor + promesa de contacto (roadmap §1.3, F3 §5.1). Implementación en **F3.3B+**, no en Etapa 0.

---

## 5. Checklist de rollback

### 5.1 Commit estable de referencia

| Referencia | SHA | Notas |
|------------|-----|--------|
| **`origin/main` (GitHub)** | `6bef624` | Incluye merge PR #65 (F3.2 campaign / PROPERTY_QA hydration) |
| Pre-f32 (si rollback de features V3 campaign) | `13ff0b9` | Merge PR #59 (F2 stage identity) — solo si negocio confirma |
| Rama control local | `refactor/perseo-conversational-core-control` @ `6bef624` | Puntero documental |

### 5.2 Volver a comportamiento 100 % legacy

1. Railway → redeploy commit anterior **o** revert merge en `main` (según política del equipo)  
2. Variables:

   ```env
   PERSEO_V3_ENABLED=false
   PERSEO_V3_SHADOW_MODE=false
   PERSEO_V3_QA_ALLOWLIST=
   PERSEO_V3_HANDOFF_ENABLED=false
   PERSEO_ENGINE=legacy
   ```

3. Reiniciar servicio (Railway restart)  
4. **No** tocar Supabase en rollback conversacional  

### 5.3 Validación post-rollback

| # | Check |
|---|--------|
| 1 | Log `server_started`: `perseo_engine_effective: legacy` |
| 2 | Número QA no allowlist → respuesta legacy (sin `[V3]` primary) |
| 3 | `!reset` / `!state` operativos en allowlist QA histórico |
| 4 | Guion: `Hola` → `Quiero vender mi casa` → sin flip a demanda |
| 5 | `npm test` en SHA desplegado — PASS |
| 6 | Sin duplicados CRM anómalos en ventana 1 h (monitor operativo) |

### 5.4 Rollback parcial (solo V3 primary, sin revertir código)

Útil si el código en main es correcto pero QA/prod se degradó por flags:

- `PERSEO_V3_ENABLED=false` **o** vaciar `PERSEO_V3_QA_ALLOWLIST`  
- `PERSEO_V3_SHADOW_MODE=false`  
- Redeploy **mismo** SHA (solo refresh env)  

---

## 6. Qué NO se toca en Etapa 0

| Área | Archivos / sistemas |
|------|---------------------|
| Lógica conversacional productiva | `index.js` ramas inbound, `conversation/*` legacy listados en F0 freeze |
| V3 runtime en producción | `conversation/v3/core/v3Runtime.js` salvo hotfix P0 |
| CRM | `runCleanOrchestratorCrmPhase`, `leadAutomation`, creates |
| Supabase | Esquema, RPCs, políticas |
| Railway | Variables remotas, branch, deploys |
| Multimedia | `inboundMediaStorageIngest`, flags media |

---

## 7. Riesgos antes de seguir a Etapa 1

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Trabajar en rama **f32** ya mergeada | Media | Cambiar a `main` actualizado o `refactor/perseo-conversational-core-control` |
| `main` local **14 commits** detrás | Media | `git pull origin main` |
| Docs oficiales **sin commit** en repo remoto | Baja | Commit en rama control cuando el equipo apruebe |
| Flags prod **desconocidos** | Alta | Auditar Railway env antes de activar más V3 |
| Confusión `PERSEO_ENGINE` vs `PERSEO_V3_ENABLED` vs `PERSEO_ENGINE_V2` | Media | Usar tabla §3; script `node scripts/check-perseo-sprint2-env.js` |
| `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED` en docs pero no en código | Baja | Renombrar mentalmente a `PERSEO_V3_ENABLED` hasta alinear código |
| Código F3.3A en main con allowlist activa en prod | Alta | Verificar allowlist; riesgo de comportamiento distinto legacy |

---

## 8. Alineación documentación oficial

| Documento | Estado Etapa 0 |
|-----------|----------------|
| `perseo-conversational-core-v3-roadmap.md` | Alineado — F0, catálogo ~200, fallback §1.3, olas O/D |
| `perseo-v3-f3-qualification-handoff.md` | Alineado — F3 + §5.1 fallback (planificado F3.3B) |
| `plan-oficial-perseo-madurez-conversacional-p0-p6.md` | v2.1 — tesis + §2.1 fallback; enlaza V3 |
| `perseo-v3-f0-legacy-freeze.md` | Complemento técnico F0 — lista archivos congelados |

**Discrepancia menor:** roadmap menciona `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED`; código usa `PERSEO_V3_ENABLED`. Corregir en doc o alias en F1 — **no** en Etapa 0 código.

---

## 9. Cierre Etapa 0 — checklist

- [x] Diagnóstico git / HEAD / main  
- [x] Rama `refactor/perseo-conversational-core-control` desde `origin/main`  
- [x] Política de congelamiento documentada  
- [x] Checklist rollback  
- [x] Flags inventariados (código vs plan)  
- [x] `main` local actualizado (`git pull`) al cierre documental  
- [x] Commit documental en rama control + PR hacia `main`  
- [ ] Confirmar SHA deploy Railway (operador)  
- [ ] Confirmar env vars Railway (operador)  

---

## 10. Siguiente sprint — Etapa 1 (V3-F1)

**Nombre roadmap:** Núcleo en paralelo.

**Objetivo:** ampliar `conversation/v3/` con contratos, tests unitarios, **sin** cablear al webhook productivo.

**Entregables F1 (sin tocar prod):**

1. Contratos JSDoc / schemas de estado y decisión  
2. Tests que importan V3 sin ejecutar en `index.js`  
3. Alinear nombre de flag maestro (`PERSEO_V3_ENABLED` vs doc `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED`)  
4. `PERSEO_CONVERSATIONAL_CORE_V3_ENABLED=false` efectivo = sin ruta V3 en prod  

**Pre-requisito:** Etapa 0 cerrada documentalmente; **pendiente operador:** env Railway auditado antes de abrir F1 en prod.

---

*Documento vivo. Actualizar al cerrar Etapa 0 (fecha, owner, SHA prod confirmado).*
