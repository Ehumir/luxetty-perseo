# sprint-perseo-consultor-base - Diagnostico de flujo actual

Fecha: 2026-05-03

## Hallazgos

1. Clasificacion de intencion:
- `conversation/intent.js` y `conversation/parsers.js` detectan oferta/demanda e interes comercial.
- El flujo de oferta estaba orientado a checklist corto; faltaba progresion consultiva por etapas.

2. Conversaciones largas y memoria:
- `conversations.ai_state` guarda contexto y evita loops con `awaiting_field` en `index.js`.
- Faltaban campos ricos para captacion de propietarios (m2, legal/comercial, motivacion, objeciones).

3. Inbound media/audio:
- En `index.js`, audio/imagen se convertian a texto generico.
- No habia uso operativo de transcripcion cuando llegara en payload.
- No habia fallback especifico para audio sin transcripcion ni respuestas especializadas para imagen/documento.

4. Creacion/actualizacion de lead/contacto:
- `services/leadAutomation.js` reutiliza/crea leads correctamente y calcula scoring.
- Notas disponibles, pero requerian mayor densidad consultiva para captar contexto util de propietario para ATENA.

5. Cierre a cita/handoff:
- Ya existe logica de handoff en `index.js` y `leadAutomation.js`.
- Faltaba narrativa consultiva para llevar al cierre de visita en captacion de propietarios sin sonar formulario.

## Decision de sprint
- No se realizaron cambios de esquema de base de datos.
- Se implementaron cambios de comportamiento en capa conversacional, parser, estado, inbound media/audio y notas.
