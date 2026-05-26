# BASELINE — Plan Integral de Remediación Luxetty (PERSEO side)

**Bloque:** 0 — Congelamiento, baseline y control de riesgo
**Fecha:** 2026-05-26
**Repo:** `luxetty-perseo`
**Repo principal del baseline:** `luxetty-atena`

> Este documento es el "lado PERSEO" del Bloque 0. El baseline completo del ecosistema vive en `luxetty-atena/docs/remediation/BASELINE-2026-05-26.md` para evitar duplicación. Aquí solo se documentan los puntos específicos del repo PERSEO y las acciones de control aplicadas localmente.

---

## 1. Documentos rectores (en repo `luxetty-atena`)

| Documento | Ruta | Propósito |
|---|---|---|
| BASELINE general del ecosistema | `luxetty-atena/docs/remediation/BASELINE-2026-05-26.md` | Mapa completo (Git, Vercel, Railway, Supabase, Lovable, riesgos) |
| ROLLBACK PLAN general | `luxetty-atena/docs/remediation/ROLLBACK-PLAN-GENERAL-2026-05-26.md` | Estrategia rollback por capa, incluido Railway/PERSEO |
| REQUESTS DEPRECATION PATH | `luxetty-atena/docs/remediation/REQUESTS-DEPRECATION-PATH-2026-05-26.md` | 7 fases para sacar `public.requests` de operación |
| Plan rector por bloques | `luxetty-atena/docs/remediation/LUXETTY_REMEDIATION_EXECUTION_BLOCKS_2026-05-26.md` | Bloques 0–8 con sub-bloques |
| Master plan estratégico | `luxetty-atena/docs/remediation/LUXETTY_REMEDIATION_MASTER_PLAN_2026-05-26.md` | Versión estratégica narrativa |

---

## 2. Estado Git capturado en este repo (`luxetty-perseo`)

| Campo | Valor |
|---|---|
| Rama actual local | `fix/cuarzo-v1-p0-closure` |
| HEAD local | `57b6bc2de0de5efe18519f47842e6f0dce096030` |
| HEAD `origin/main` | `4d8a978` = `Merge pull request #105 from Ehumir/fix/cuarzo-v1-p0-closure` |
| `origin/fix/cuarzo-v1-p0-closure` | `57b6bc2` (idéntico al HEAD local) |
| **¿Cuarzo en `main`?** | **SÍ — PR #105 mergeado en `origin/main` (commit `4d8a978`).** Verificado con `git branch --contains 57b6bc2` que devuelve `remotes/origin/main`. |
| Rama `remediation/0-baseline` | Creada apuntando a `origin/main` ✓ |
| Stashes activos | 2 |
| Working tree archivos sin trackear | 18 (docs + scripts huérfanos; cero archivos de aplicación modificados) |

---

## 3. Hitos Cuarzo verificados (PRs en `main`)

| PR | Commit | Estado |
|---|---|---|
| #105 — P0-A/C closure (handoff, anti-loop, fallbacks) | `4d8a978` (merge) / `57b6bc2` (rama) | ✓ Mergeado a main |
| #104 — Sprint 0A stabilization | `e5b5b7c` (merge) / `b4be845` (rama) | ✓ Mergeado a main |
| #103 — CRM execute allowlist gate | `73194b6` (merge) / `ac3419d` (rama) | ✓ Mergeado a main |
| Hotfix 0A — followup cron outbound persist | `110098d` / `39dd567` | ✓ Mergeado a main |
| Sprint 0C — blindaje conversacional | `71b86cf` (incluido en PR #105) | ✓ Mergeado a main |
| `crm_execute_gate` persist a `conversation_events` | `287f861` | ✓ Mergeado a main |
| Script publicar suite ARGOS → Supabase ATENA | `23e19c4` | ✓ Mergeado a main |

---

## 4. Variables de entorno detectadas en código (sin valores)

Extraídas con `grep "process.env.[A-Z_]*" conversation/v3/**`:

| Variable | Default `.env.example` | Función |
|---|---|---|
| `PERSEO_ENGINE` | `legacy` | Flag de log; no activa V3 por sí solo |
| `PERSEO_V3_ENABLED` | (no documentado) | Activa runtime V3 |
| `PERSEO_V3_QA_ALLOWLIST` | (oculto) | Lista teléfonos autorizados |
| `PERSEO_V3_CRM_EXECUTE` | `false` (default seguro) | Dry-run si no `'true'` |
| `PERSEO_V3_CRM_DRY_RUN` | (derivado) | Idem |
| `PERSEO_ARGOS_ENABLED` | (no documentado) | Modo ARGOS bloquea side-effects |
| `PERSEO_CRM_WORKER_ID` | (auto) | Worker identifier |
| `PERSEO_CRM_QUEUE_MAX_PENDING` | `500` | Backpressure outbox |
| `PERSEO_BASE_URL_STAGING` | (oculto) | URL staging |
| `PERSEO_ENV` | (oculto) | Env tag |
| `SUPABASE_URL` | (oculto) | Conexión |
| `SUPABASE_SERVICE_ROLE_KEY` | (oculto) | Service role |
| `RAILWAY_*` (5) | (auto Railway) | Observabilidad |

---

## 5. Gaps pendientes para Bloque 0.5 (verificación productiva)

| Gap | Severidad | Responsable |
|---|---|---|
| Commit real Railway desplegado | **P0** | Ehumir / Railway dashboard |
| Valor real `PERSEO_ENGINE` en producción | **P0** | Ehumir |
| Valor real `PERSEO_V3_CRM_EXECUTE` en producción | **P0** | Ehumir |
| Valor / longitud `PERSEO_V3_QA_ALLOWLIST` en producción | P1 | Ehumir |
| Cron jobs activos en Railway | P1 | Ehumir |
| Service ID Railway / réplicas activas | P1 | Ehumir |

---

## 6. Referencias a `public.requests` detectadas en este repo

| Archivo | Línea | Naturaleza | Riesgo |
|---|---|---|---|
| `argos/constants.js` | 20-21 | Constants list `'assign_request'`, `'resolve_assignment_for_request'` marcadas como **prohibidas** (side-effects bloqueados) | Cero — guardarail |
| `docs/sprints/argos-qa-plan-argos-0-1.md` | 943-944 | Doc dice "Cualquier `.from('requests')` | Prohibido" y "Si persisten — mock return o throw ARGOS_SIDE_EFFECT_BLOCKED" | Cero — doc |
| `docs/sprints/argos-qa-propuesta-implementacion.md` | 214 | Doc menciona la RPC como legacy | Cero — doc |

**Conclusión:** Cero uso operativo. Las menciones son guardarails defensivos. No requieren acción en Bloque 2 desde este repo.

---

## 7. Acción aplicada en este Bloque 0

- ✓ Rama `remediation/0-baseline` creada apuntando a `origin/main` (no a la rama feature local obsoleta).
- ✓ Este documento creado como "puente" para que el repo `luxetty-perseo` quede sincronizado con el plan de remediación, sin duplicar el baseline maestro.
- ❌ Cero cambios en código de aplicación.
- ❌ Cero cambios en `.env.example`, `package.json`, scripts.
- ❌ Cero PR mergeado.

---

## 8. Próximos pasos para este repo

Hasta que el Bloque 0.5 (verificación Railway) cierre, **NO** se autorizan cambios en este repo. Cuando se autoricen:

| Bloque | Acción esperada en `luxetty-perseo` |
|---|---|
| 0.5 | Documentar Railway en `docs/remediation/RAILWAY-SNAPSHOT-2026-05-XX.md` (sin commits a runtime) |
| 1 (RLS Supabase) | Sin cambios — todo en repo ATENA |
| 2 (requests deprecation) | Sin cambios — `argos/constants.js` ya cubre el caso |
| 3 (sitio público) | Sin cambios |
| 4 (Edge Functions verify_jwt) | Sin cambios — todo en repo ATENA |
| 5 (UX panel) | Sin cambios |
| 6 (backups y schema legacy) | Sin cambios |
| 7 (KPIs ARGOS) | Posibles ajustes en `argos/processInboundForArgos.js` y en la EF `panel-argos` (en repo ATENA) |
| 8 (snapshot Railway → repo) | **Crear** `railway.json` o equivalente como documentación viva |

---

**Fin del BASELINE-LINK 2026-05-26 (lado PERSEO).**
