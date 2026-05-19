# MediaAudioLogicalTurn v1

**Estado:** Activo (M3-01)  
**Flag:** `PERSEO_MEDIA_INTAKE_V1_ENABLED=true`

## Reglas

| Caso | `media_intake.mode` | `logical_turn` | Respuesta |
|------|---------------------|----------------|-----------|
| Transcript presente, confianza ≥ 0.55 | `transcript_used` | Texto = transcript | Flujo V3 normal |
| Sin transcript | `audio_no_transcript` | Vacío | Fallback: pedir texto |
| Confianza < 0.55 | `audio_low_confidence` | Transcript + confirmación | Fallback: pedir confirmación escrita |

## Prohibido

- Inventar contenido no presente en el transcript.
- Actuar como si se entendió audio cuando `audio_no_transcript`.

## Trace

`debug_trace.media_intake` — `{ mode, kind, transcript, confidence }`
