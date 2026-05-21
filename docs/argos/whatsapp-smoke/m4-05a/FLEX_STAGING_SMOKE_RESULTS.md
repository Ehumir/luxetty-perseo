# M4-05a — Resultados smoke WA staging

**Piloto:** `5218181877351` (o el de allowlist QA)  
**Flag:** `PERSEO_CONVERSATIONAL_FLEX_ENABLED=true` (solo QA/staging; prod default OFF)  
**Fecha:** 2026-05-20

| Smoke | WA real | Notas |
|-------|---------|-------|
| FLEX1 | **PASS** | typo zona, slang, sin IVR, consent, terminal close |
| FLEX2 | **PASS** | (incluido en flujo FLEX1) consent MX compuesto |
| FLEX3 | _pendiente / local OK_ | ver abajo |
| FLEX4 | _pendiente WA audio_ | proxy texto OK local |

---

## FLEX1 — typo zona + slang dinero

> **Fix `7631ff6+`:** `hola`+compra ya no cae en `GREETING`; `comprar` menú → `BUY_PROPERTY`; zona vía `normalizeLocationFromUserText` antes de loose phrase. **Re-smoke tras deploy.**

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

> **Fix post-FLEX1:** `sale y vale, me late.` y compuestos MX → `ACCEPTED` vía `shortReplyLexicon` + `isPositiveHandoffAck`. Re-smoke tras deploy.

**Inbound:** `Simón jalo` o `sale y vale, me late.` (tras pregunta contacto asesor)

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

- [x] FLEX1 PASS WA
- [x] FLEX2 PASS WA (consent + cierre)
- [ ] FLEX3 PASS WA
- [ ] FLEX4 PASS WA
- [x] GO merge M4-05a → `main` (FLEX1/2 aprobados; FLEX3/4 sin bloqueo crítico en ARGOS local)
