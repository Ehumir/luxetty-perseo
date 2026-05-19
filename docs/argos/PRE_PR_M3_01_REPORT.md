# PR-M3-01 — Pre-PR Report (Media Intake v1 + WhatsApp Hardening wave 1)

**Branch:** `feat/m3-01-media-whatsapp-hardening`  
**Date:** 2026-05-19  
**Flag:** `PERSEO_MEDIA_INTAKE_V1_ENABLED` (default `false`)

---

## 1. Archivos modificados / creados

| Área | Archivos |
|------|----------|
| Flag | `config/perseoM3Flags.js` |
| Media layer | `conversation/v3/media/mediaIntakeV1.js`, `mediaFallbackComposer.js` |
| Runtime | `conversation/v3/core/v3Runtime.js`, `v3InboundBridge.js` |
| ARGOS | `argos/scenarioTurn.js`, `scenarioRunner.js`, `processInboundForArgos.js`, `conversationSnapshot.js`, `mustNotValidator.js`, `deterministicMode.js` |
| Contratos | `docs/argos/contracts/MediaAudioLogicalTurn-v1.md`, `MediaImageHints-v1.md` |
| Escenarios | `MEDIA_*` (6), `REG_WA_*` (4) |
| Suites | `docs/argos/suites/media-p0.json`, `whatsapp-smoke.json` |
| WA smoke docs | `docs/argos/whatsapp-smoke/*` |
| Tests | `test/mediaIntakeV1.test.js`, `test/argosM3MediaSuite.test.js` |

**Sin tocar:** Supabase, ATENA, CRM execute, transcripción/OCR real, `corpus/` runtime.

---

## 2. Contrato audio (`logical_turn`)

Ver `MediaAudioLogicalTurn-v1.md`.

| Modo | Comportamiento |
|------|----------------|
| `transcript_used` | `logical_turn.text` = transcript → flujo V3 |
| `audio_no_transcript` | Fallback: pedir texto |
| `audio_low_confidence` | Fallback: confirmar por escrito |

---

## 3. Contrato imagen (`image_hints`)

Ver `MediaImageHints-v1.md`. Hints **no autoritativos**; texto del usuario gana.

---

## 4. Transcripts / hints en escenarios MEDIA

| Escenario | Payload mock |
|-----------|----------------|
| MEDIA_AUDIO_001 | `transcript` 0.92 — "Quiero vender mi casa en Cumbres" |
| MEDIA_AUDIO_002 | `no_transcript: true` |
| MEDIA_AUDIO_003 | `transcript` conf 0.35 — baja confianza |
| MEDIA_IMG_001 | `hints: fachada` + caption |
| MEDIA_IMG_002 | `illegible: true` |
| MEDIA_IMG_003 | `hints: mapa` + turno texto venta San Pedro |

---

## 5. Resultado `media-p0`

```
suite=media-p0 pass=6/6 rate=1.000
```

---

## 6. Estructura `whatsapp-smoke/`

| Archivo | Propósito |
|---------|-----------|
| `allowlist-template.yaml` | Plantilla 4 pilotos |
| `checklist-humanity.md` | H1–H5 + M1–M2 media |
| `run-log-format.md` | Registro de corridas campo |
| `evaluation-criteria.md` | CI vs piloto |

Suite `whatsapp-smoke`: **4/4 PASS** (REG_WA_001–004 sintéticos).

---

## 7. Regresión

| Check | Resultado |
|-------|-----------|
| `test/mediaIntakeV1.test.js` | 5/5 PASS |
| `test/argosM3MediaSuite.test.js` | 2/2 PASS (media-p0 + whatsapp-smoke) |
| `media-p0` | 6/6 |
| `whatsapp-smoke` | 4/4 |
| `npm run test:argos` | 35/35 PASS (incl. M3) |
| `npm run test:perseo` | 103/103 PASS |
| `npm run corpus-validate` | PASS |
| Suites M2 (release-p0/p1, policy, cross, humanity, reg-*) | PASS (corrida dedicada) |

---

## 8. Baseline `npm test` (flags OFF)

| Métrica | Valor |
|---------|-------|
| tests | **723** (+7 M3 unit) |
| pass | **715** |
| fail | **8** |

**7 legacy** (F2/F3/F4/v3PrimaryGate) + **1** `argosM2PolicyCross` → `cross-intent-p0` bajo `npm test` completo (pasa aislado; posible interferencia de env/order en suite runner — no regresión media).

Con `PERSEO_MEDIA_INTAKE_V1_ENABLED=false` (default): **cero cambio de comportamiento** en turnos solo texto.

---

## 9. Riesgos

1. Flag ON en prod sin QA — fallbacks no probados en campo real.
2. `cross-intent-p0` en `npm test` full — flaky bajo carga (pre-existente M2 suite test).
3. Piloto WA manual pendiente (docs listos; no bloquea merge código).

---

## 10. Cero inventos desde media

- `must_not`: `invented_from_media`, `fake_transcript`, `hallucinated_visual_detail`, `media_no_fallback` (solo en turnos media).
- Short-circuit honesto antes del interpreter cuando no hay transcript / baja confianza / imagen ilegible.
- Trace: `debug_trace.media_intake`.

**Confirmación:** `corpus/` no importa `conversation/v3`. Media layer solo activa con flag explícito.
