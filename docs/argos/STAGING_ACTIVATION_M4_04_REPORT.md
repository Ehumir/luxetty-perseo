# Staging Activation Report — M4-04

**Entorno:** Supabase staging (`project_ref: pjoxytwsvbeoivppczdx`)  
**Rama:** `feat/m4-04-staging-activation-runtime-verification`  
**Última actualización:** 2026-05-20  
**Prod:** **OFF**

---

## Criterios GO por carril

| Nivel | Significado | Comando cierre | Estado |
|-------|-------------|----------------|--------|
| **M4-04A Technical GO** | DB + Railway worker `mode=db` + scripts | `npm run staging:close:technical` | **GO** |
| **M4-04B WA B1 GO** | 3 pilotos QA | `npm run staging:close:wa-b1` | **PENDIENTE** |
| **M4-04C WA B2 GO** | 10 pilotos QA | `npm run staging:close:wa-b2` | **PENDIENTE** |
| **M4-05 inicio** | 04A + 04B GO | — | Bloqueado hasta 04B |
| **Prod candidate** | 04A + 04C GO | — | — |

---

## M4-04A — Technical Staging — **GO**

**Cerrado:** 2026-05-20. M4 runtime persistent operativo en Railway QA.

### Evidencia Railway QA worker

```txt
event=crm_worker_startup
selectedStoreMode=db
memoryFallbackReason=null

event=crm_worker_batch
mode=db
```

### Checklist técnico

| # | Check | Estado |
|---|-------|--------|
| 1 | DB 7 tablas + RLS + heartbeat | **PASS** |
| 2 | Worker Railway `mode=db` | **PASS** (confirmado QA) |
| 3 | Probe cache fix (`ea7af86`) | **PASS** — ya no pinnea `memory` |
| 4 | `staging:phases` (0–4) | **PASS** |
| 5 | CRM outbox DB enqueue/process | **PASS** |
| 6 | Telemetry DB insert/read | **PASS** |
| 7 | Replay RPACK_001 | **PASS** |
| 8 | Duplicate check (ventana 48h) | **PASS** |

### Fixes relevantes en rama

| Commit | Tema |
|--------|------|
| `ea7af86` | Probe negativo no cacheado; worker bootstrap `mode=db` |
| `a8d6f72` | Carriles A/B1/B2 + close scripts |
| `132702a` | verify-db probe PK `worker_id` |

### Veredicto

| | |
|--|--|
| **M4-04A Technical GO** | **GO** |
| **Prod** | **OFF** |

---

## M4-04B — WhatsApp Smoke B1 (3 pilotos) — **PENDIENTE**

**Checklist humano (30–45 min):** `docs/runbooks/M4-04B-wa-pilot-checklist.md`

### Meta B1

| Criterio | Umbral |
|----------|--------|
| Pilotos con mensajes | **3/3** |
| Humanity ≥4/5 | **≥2/3** (manual o proxy telemetry ≥0.8) |
| Inventos críticos | **0** |
| Loops | **0** |
| Duplicados CRM | **0** |

### Flujo mínimo (sin fricción)

```bash
# Prep (valida allowlist + imprime guía)
npm run staging:wa-b1-prep

# Tras 3 conversaciones WA en staging:
npm run staging:wa-collect      # → runs/M4-04-B1-evidence.json + markdown
npm run staging:close:wa-b1     # → exit 0 = M4-04B GO
```

### Setup allowlist

```bash
cp docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml.example \
   docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml
# 3 teléfonos reales (gitignored)
```

Railway webhook: mismos 3 números en `PERSEO_V3_QA_ALLOWLIST` (`521…` sin `+`).

### Tres casos

| ID | Qué hacer |
|----|-----------|
| B1_DEMAND_LONG | Comprador, mensaje largo + nombre aparte |
| B1_OFFER_POLICY | Propietario, venta + policy/valor |
| B1_MEDIA_FALLBACK | Audio/imagen → fallback graceful si falla |

### Cómo medir (resumen)

- **Humanity:** escala 1–5 por piloto; B1 pasa con ≥2 pilotos ≥4/5. Ver checklist § "Cómo medir".
- **Invento crítico:** precio/dirección/propiedad inventados sin dato usuario → FAIL.
- **Loop:** misma pregunta 3× sin avance → FAIL.
- **Duplicados / telemetry:** automático vía `staging:wa-collect`.

### Evidencia auto-generada

| Archivo | Contenido |
|---------|-----------|
| `runs/M4-04-STAGING-20260520.md` | Tabla por piloto |
| `runs/M4-04-B1-evidence.json` | Transcript preview, telemetry, verdicts |

### Veredicto M4-04B

| | |
|--|--|
| **WA B1 GO** | **PENDIENTE** — ejecutar 3 pilotos + `staging:close:wa-b1` |

---

## M4-04C — WhatsApp Smoke B2 (10 pilotos) — **PENDIENTE**

Tras **04B GO**. Misma mecánica con `allowlist-10.local.yaml` y `npm run staging:close:wa-b2`.

| | |
|--|--|
| **WA B2 GO** | **PENDIENTE** |

---

## Resumen ejecutivo

| Carril | Veredicto |
|--------|-----------|
| **M4-04A Technical** | **GO** |
| **M4-04B WA B1** | **PENDIENTE** |
| **M4-04C WA B2** | **PENDIENTE** |
| **M4-04 completo** | **PENDIENTE** (A cerrado; falta B) |
| **Prod** | **OFF** |

---

## Próximo paso inmediato

1. `allowlist-b1.local.yaml` con 3 teléfonos  
2. `npm run staging:wa-b1-prep` → 3 chats WA  
3. `npm run staging:wa-collect` + `npm run staging:close:wa-b1`  
4. Actualizar este reporte → **M4-04B GO**  
5. Luego escalar a 10 pilotos (04C) antes de M4-05 prod candidate

**Runbooks:** `docs/runbooks/M4-04-close-operational.md` · `docs/runbooks/M4-04B-wa-pilot-checklist.md`
