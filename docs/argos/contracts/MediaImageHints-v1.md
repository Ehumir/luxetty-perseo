# MediaImageHints v1

**Estado:** Activo (M3-01)  
**Flag:** `PERSEO_MEDIA_INTAKE_V1_ENABLED=true`

## Reglas

| Caso | `media_intake.mode` | Comportamiento |
|------|---------------------|----------------|
| Imagen + texto/caption | `image_with_text` | **Texto del usuario gana**; hints solo en trace |
| Solo hints | `image_hints_only` | Turno lógico describe referencia visual **no confirmada** |
| Ilegible | `image_illegible` | Fallback: pedir descripción textual |

## Hints

```json
{ "hint": "fachada | interior | mapa | documento", "confidence": 0.0-1.0 }
```

Los hints **no son verdad absoluta**. No derivar precio, m², disponibilidad ni ubicación exacta.

## Prohibido

- Inventar precio/metros/recámaras desde imagen.
- Sustituir slots capturados por texto con datos solo visuales.

## Trace

`debug_trace.media_intake` — `{ mode, hints, hints_are_non_authoritative: true }`
