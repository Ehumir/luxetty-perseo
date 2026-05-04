# Sprint 4C - Interpretacion real de imagenes

## 1) Rama utilizada
- sprint-perseo-image-vision

## 2) Archivos creados/modificados
### Creados
- services/imageVisionService.js
- test/imageVisionService.test.js
- SPRINT_4C_IMAGE_VISION_DIAGNOSTICO.md

### Modificados (Sprint 4C)
- config/env.js
- conversation/aiState.js
- conversation/mediaSignals.js
- index.js
- test/mediaSignals.test.js
- test/conversationRegression.test.js

### Estado adicional existente en rama (4A/4B)
- services/audioTranscriptionService.js
- conversation/mediaIngestion.js
- test/audioTranscriptionService.test.js
- test/mediaIngestion.test.js
- SPRINT_4A_MEDIA_INGESTION_DIAGNOSTICO.md
- SPRINT_4B_AUDIO_TRANSCRIPTION_DIAGNOSTICO.md

## 3) Proveedor/modelo usado
- Proveedor: OpenAI
- Modelo por defecto: gpt-4o-mini
- Configurable via IMAGE_VISION_MODEL

## 4) Tipos de imagen soportados
- image/jpeg
- image/png
- image/webp

## 5) Metadata guardada
- rawPayload.perseo_metadata.image_vision
- Tambien se conserva dentro de rawPayload.perseo_metadata.media_ingestion como referencia de flujo de media.
- Campos principales:
  - status
  - success
  - provider
  - model
  - summary
  - property_signals
  - suggested_follow_up
  - caution
  - error_code
  - error_message

## 6) Integracion con conversacion
- Si llega imagen descargada correctamente y MIME permitido, se ejecuta analyzeImage().
- Si vision OK:
  - Se responde en tono consultivo inmobiliario con limites claros ("por lo visible", "con una foto no puedo confirmar").
  - Se usa prefijo contextual para no reiniciar casos activos (venta/busqueda).
- Si vision falla/no concluyente:
  - Fallback honesto sin romper webhook.
  - Se solicita confirmacion comercial minima (vender/rentar/buscar).
- Si hay caption:
  - Caption sigue siendo texto efectivo para deteccion de intencion.
  - La vision se usa como contexto adicional, sin duplicar respuesta de "archivo".

## 7) Integracion con intencion/CRM
- La vision agrega senales visuales para contexto inmobiliario.
- No crea lead por si sola sin intencion clara.
- Si existe intencion por caption o contexto previo, el flujo usa la ruta CRM endurecida existente:
  - contacto
  - lead/solicitud
  - asignacion
  - idempotencia
- No se creo ruta paralela para imagenes.

## 8) Que NO hace todavia
- No hace valuacion automatica.
- No calcula precio por imagen.
- No infiere colonia/ubicacion exacta por imagen.
- No estima metros cuadrados por imagen.
- No confirma numero de recamaras/banos si no es concluyente.
- No implementa OCR avanzado de documentos.
- No implementa analisis de video.

## 9) Pruebas ejecutadas
- npm test
- npm run test

Resultado:
- tests: 115
- pass: 115
- fail: 0

## 10) Riesgos pendientes
- Calidad variable de fotos (borrosas/obstruidas) puede bajar utilidad del resumen visual.
- Sin OCR avanzado, imagenes tipo documento solo se clasifican de forma superficial.
- Se requiere calibracion continua de prompt/modelo para reducir sobreinterpretacion.

## 11) Confirmaciones
- No se implemento valuacion automatica.
- No se implemento OCR avanzado de documentos.
- No se implemento analisis de video.
- No hubo cambios de esquema de Supabase.
- El proyecto queda preparado para Sprint 4D - Fusion de contexto + creacion/actualizacion de solicitud.
