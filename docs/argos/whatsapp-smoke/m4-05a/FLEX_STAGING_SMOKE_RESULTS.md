# M4-05a — Resultados smoke WA staging

**Piloto:** `5218181877351` (o el de allowlist QA)  
**Flag:** `PERSEO_CONVERSATIONAL_FLEX_ENABLED=true`  
**Fecha:** _pendiente ejecución manual_

---

## FLEX1 — typo zona + slang dinero

**Inbound:** `Hola busco casa en cumpres elite como de unos 6 melones`

| Campo | Esperado | Observado |
|-------|----------|-----------|
| `location_text` | Cumbres Elite | |
| `budget_max` | 6000000 | |
| `response_source` | v3_core_* | |
| Reinicio flujo | NO | |

**Screenshot:** _adjuntar_

```bash
node scripts/staging-wa-flex-smoke-check.js <phone> FLEX1
```

```json
(paste JSON aquí)
```

---

## FLEX2 — slang consent

**Inbound:** `Simón jalo` (tras pregunta contacto asesor)

| Campo | Esperado | Observado |
|-------|----------|-----------|
| `advisor_contact_consent` | ACCEPTED | |
| `response_source` | v3_core_* | |

**Screenshot:** _adjuntar_

---

## FLEX3 — occupancy negation

**Inbound:** `No está libre, vive mi familia ahí`

| Campo | Esperado | Observado |
|-------|----------|-----------|
| `occupancy_status` | habitada | |
| Falso `libre` | NO | |

**Screenshot:** _adjuntar_

---

## FLEX4 — audio imperfecto

**Notas audio:** _duración, transcripción STT si visible_

| Campo | Esperado | Observado |
|-------|----------|-----------|
| `response_source` | ≠ fallback_consultive | |
| Menú IVR | NO | |
| Loop | NO | |

**Screenshot:** _adjuntar_

---

## Veredicto

- [ ] GO merge M4-05a → `main`
- [ ] NO-GO — bloqueador: ___
