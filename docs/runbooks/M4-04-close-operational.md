# M4-04 — Cierre operativo (carriles A / B1 / B2)

**Prod:** OFF. **M4-05:** solo tras 04A + 04B GO mínimo; prod candidate tras 04A + 04C.

| Carril | Comando | Teléfonos |
|--------|---------|-----------|
| **04A Technical** | `npm run staging:close:technical` | 0 | **GO** |
| **04B WA B1** | `npm run staging:wa-b1-prep` → pilotos → `staging:wa-collect` → `staging:close:wa-b1` | 3 |
| **04C WA B2** | `npm run staging:close:wa-b2` | 10 |
| Full | `npm run staging:close` | 10 |

Allowlist parcial: `M4_WA_ALLOWLIST_MIN=3` o `npm run staging:wa-allowlist -- --min=3`

---

## Prerrequisitos (humano)

| Variable / artefacto | Descripción |
|---------------------|-------------|
| `PERSEO_BASE_URL_STAGING` | URL pública del servicio webhook en Railway staging |
| `allowlist-10.local.yaml` | 10 teléfonos QA (copiar desde `allowlist-10.local.yaml.example`) |
| Railway worker service | `node workers/crmOutboxRailwayWorker.js` + env Fase 2 |
| Supabase staging | Migraciones M4 ya aplicadas (`pjoxytwsvbeoivppczdx` o ref confirmado) |

```bash
# .env local (no commitear secretos)
PERSEO_STAGING_CONFIRMED=true
PERSEO_BASE_URL_STAGING=https://<tu-servicio-staging>.up.railway.app
VERIFY_TOKEN=<mismo que Railway staging>
```

---

## Paso 1 — Allowlist real

```bash
cp docs/argos/whatsapp-smoke/m4-02/allowlist-10.local.yaml.example \
   docs/argos/whatsapp-smoke/m4-02/allowlist-10.local.yaml
# Editar 10 teléfonos reales

npm run staging:wa-allowlist
# debe PASS
```

Opcional: sincronizar `PERSEO_V3_QA_ALLOWLIST` en Railway staging con los mismos 10 números (formato `521…` sin `+`).

---

## Paso 2 — Railway staging

### Webhook service

- Deploy rama `feat/m4-04-staging-activation-runtime-verification` (o merge a staging branch).
- Flags **Fase 0** (todo OFF) 30 min → subir por fases.

### Worker service (separado)

```env
PERSEO_CRM_WORKER_PROCESS_ENABLED=true
PERSEO_CRM_WORKER_ASYNC_ENABLED=true
PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED=true
PERSEO_CRM_DURABILITY_ENABLED=true
PERSEO_V3_CRM_EXECUTE=false
SUPABASE_URL=<staging>
SUPABASE_SERVICE_ROLE_KEY=<staging>
```

Start command: `node workers/crmOutboxRailwayWorker.js`

### Validar

```bash
M4_RAILWAY_REQUIRE_HEARTBEAT=true npm run staging:railway
```

Esperado: webhook 200 + challenge; `crm_worker_heartbeats` con fila &lt; 15 min.

---

## Paso 3 — WA 10 pilotos (manual)

Por cada piloto en allowlist:

1. Enviar mensajes según `objetivo` (+ media si aplica).
2. Anotar humanity 1–5 manual si hace falta (criterio ≥4/5).
3. Verificar respuesta sin invento crítico, sin loop, fallback si media falla.

---

## Paso 4 — Re-run staging automatizado

```bash
PERSEO_STAGING_CONFIRMED=true npm run staging:phases
PERSEO_STAGING_CONFIRMED=true npm run staging:duplicates
PERSEO_STAGING_CONFIRMED=true npm run staging:wa-collect
```

O todo junto:

```bash
PERSEO_BASE_URL_STAGING=https://... \
M4_RAILWAY_REQUIRE_HEARTBEAT=true \
PERSEO_STAGING_CONFIRMED=true \
npm run staging:close
```

---

## Paso 5 — Reporte final

Actualizar `docs/argos/STAGING_ACTIVATION_M4_04_REPORT.md`:

- Evidencia Railway (URL enmascarada, heartbeat, logs).
- Tabla 10 pilotos desde `runs/M4-04-STAGING-20260520.md`.
- Decisión **GO operativo completo** solo si todos los criterios PASS.

---

## GO operativo completo (checklist)

| # | Criterio |
|---|----------|
| 1 | `staging:verify-db` PASS |
| 2 | `staging:phases` PASS |
| 3 | `staging:railway` PASS (+ heartbeat si worker ON) |
| 4 | Allowlist 10 reales validados |
| 5 | ≥8/10 pilotos humanity ≥4/5 |
| 6 | 0 duplicados CRM en ventana activación |
| 7 | 0 loops / 0 jobs perdidos |
| 8 | Prod OFF confirmado |
