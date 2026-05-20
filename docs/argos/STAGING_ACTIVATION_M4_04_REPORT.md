# Staging Activation Report — M4-04

**Entorno:** Supabase staging (`project_ref: pjoxytwsvbeoivppczdx`)  
**Rama:** `feat/m4-04-staging-activation-runtime-verification`  
**Prod:** **OFF** (sin variables ni flags en prod)

---

## Criterios GO por carril

| Nivel | Significado | Comando cierre |
|-------|-------------|----------------|
| **M4-04A Technical GO** | DB + Railway + worker heartbeat + telemetry + replay + duplicates | `npm run staging:close:technical` |
| **M4-04B WA B1 GO** | 3 pilotos QA reales OK | `npm run staging:close:wa-b1` |
| **M4-04C WA B2 GO** | 10 pilotos QA reales OK | `npm run staging:close:wa-b2` |
| **M4-05 candidato** | Solo tras **04A + 04C** GO | — |
| **M4-05 inicio mínimo** | **04A + 04B** GO | — |

---

## M4-04A — Technical Staging

**Objetivo:** validar infraestructura real sin depender de 10 teléfonos WA.

### Checklist

| # | Check | Script | Estado |
|---|-------|--------|--------|
| 1 | DB 7 tablas + RLS + heartbeat PK | `npm run staging:verify-db` | **PASS** |
| 2 | Railway webhook | `npm run staging:railway` | **PENDIENTE** — `PERSEO_BASE_URL_STAGING` vacía |
| 3 | Worker heartbeat DB (15m) | `staging:railway` + Railway worker | **PENDIENTE** |
| 4 | Fases 0–4 flags | `npm run staging:phases` | **PASS** |
| 5 | CRM outbox DB | incluido en phases | **PASS** |
| 6 | Telemetry DB | incluido en phases | **PASS** |
| 7 | Replay RPACK_001 | incluido en phases | **PASS** |
| 8 | Duplicate check ventana activación | `npm run staging:duplicates` | **PASS** |

### Comando

```bash
M4_RAILWAY_REQUIRE_HEARTBEAT=true npm run staging:close:technical
```

### Veredicto M4-04A

| | |
|--|--|
| **Technical GO** | **NO-GO** (bloqueado por Railway URL + heartbeat remoto) |
| **Infra DB/scripts** | **GO** (local contra Supabase staging) |

**Desbloqueo:** setear en `.env`:

```env
PERSEO_BASE_URL_STAGING=https://<webhook-staging>.up.railway.app
```

Deploy worker: `node workers/crmOutboxRailwayWorker.js` → re-run `staging:close:technical`.

---

## M4-04B — WhatsApp Smoke B1 (3 pilotos)

**Meta B1:**

| Criterio | Umbral |
|----------|--------|
| Pilotos con conversación | 3/3 |
| Humanity ≥4/5 (proxy ≥0.8) | ≥2/3 |
| Inventos críticos | 0 |
| Duplicados CRM | 0 |
| Loops | 0 |

### Casos mínimos

1. **B1_DEMAND_LONG** — comprador, mensaje largo  
2. **B1_OFFER_POLICY** — propietario, policy/valor  
3. **B1_MEDIA_FALLBACK** — audio/media o interrupción + fallback  

### Setup

```bash
cp docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml.example \
   docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml
# 3 teléfonos reales

M4_WA_ALLOWLIST_MIN=3 npm run staging:wa-allowlist
# Ejecutar 3 conversaciones WA manualmente
npm run staging:close:wa-b1
```

### Veredicto M4-04B

| | |
|--|--|
| **WA B1 GO** | **NO-GO** — allowlist B1 sin teléfonos reales |

---

## M4-04C — WhatsApp Smoke B2 (10 pilotos)

**Meta B2:** ≥8/10 humanity ≥4/5, 0 inventos, 0 dupes, 0 loops, 0 media sin fallback, 0 jobs perdidos.

```bash
# allowlist-10.local.yaml — 10 teléfonos
npm run staging:close:wa-b2
```

### Veredicto M4-04C

| | |
|--|--|
| **WA B2 GO** | **NO-GO** — pendiente B1 + expansión a 10 |

---

## Resumen ejecutivo

| Carril | Veredicto |
|--------|-----------|
| M4-04A Technical | **NO-GO** (Railway pendiente) / DB **GO** |
| M4-04B WA B1 | **NO-GO** |
| M4-04C WA B2 | **NO-GO** |
| M4-04 completo | **NO-GO** |
| Prod | **OFF** |

---

## Evidencia técnica (local → staging Supabase)

- `staging:phases` → `ok: true` (verify-db, telemetry, crm-db, media, replay)
- `staging:duplicates` → 0 idempotency dupes; ventana 48h limpia
- Fix crítico: `crmDryRun` ya no fuerza memory store en worker Railway

---

## Próximos pasos (orden)

1. `PERSEO_BASE_URL_STAGING` → `npm run staging:close:technical` → **M4-04A GO**  
2. `allowlist-b1.local.yaml` (3 teléfonos) → pilotos → `npm run staging:close:wa-b1` → **M4-04B GO**  
3. `allowlist-10.local.yaml` → `npm run staging:close:wa-b2` → **M4-04C GO**  
4. Entonces diseñar **M4-05 Controlled Production Rollout** (prod sigue OFF hasta aviso explícito)

**Runbook:** `docs/runbooks/M4-04-close-operational.md`
