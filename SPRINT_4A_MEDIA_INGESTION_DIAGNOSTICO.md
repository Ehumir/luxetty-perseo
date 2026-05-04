# Sprint 4A - Media Ingestion Diagnostico

## Objetivo del sprint

Implementar ingesta real de media desde WhatsApp Cloud API para detectar tipos, extraer metadata, intentar descarga segura cuando aplique y registrar trazabilidad sin interpretar contenido multimedia.

## Archivos modificados

- [index.js](index.js)
- [config/env.js](config/env.js)
- [conversation/mediaSignals.js](conversation/mediaSignals.js)
- [services/whatsappMediaService.js](services/whatsappMediaService.js)
- [conversation/mediaIngestion.js](conversation/mediaIngestion.js)
- [test/mediaSignals.test.js](test/mediaSignals.test.js)
- [test/conversationRegression.test.js](test/conversationRegression.test.js)
- [test/whatsappMediaService.test.js](test/whatsappMediaService.test.js)
- [test/mediaIngestion.test.js](test/mediaIngestion.test.js)

## Flujo implementado

1. Webhook identifica tipo real de mensaje de WhatsApp.
2. Se construye contexto de mensaje con `buildInboundMessageContext`.
3. Se extrae metadata estructurada de ingesta con `extractInboundMediaMetadata`.
4. Se extrae señal textual conversacional (caption, interactive title, location data) con `extractInboundSignalText` para intención.
5. Si es media descargable permitida, se consulta metadata de media y se intenta descarga desde Meta.
6. Se registra estado de descarga (`received`, `downloaded`, `failed`, `skipped_unsupported`) en metadata y eventos.
7. Se persiste metadata en `rawPayload.perseo_metadata.media_ingestion` de cada mensaje inbound.
8. Se mantiene respuesta conversacional realista sin afirmar lectura/escucha/visión real.

## Tipos soportados en detección

- text
- image
- audio
- voice
- document
- video
- sticker
- location
- interactive
- button
- list_reply
- button_reply
- contacts
- unknown/unsupported

## Tipos descargados en Sprint 4A

- image/jpeg
- image/png
- image/webp
- audio/ogg
- audio/opus
- audio/mpeg
- audio/mp4
- audio/aac
- audio/amr
- application/pdf

## Tipos solo registrados/no procesados

- video (incluido video/mp4): recibido y registrado, no descargado/procesado en 4A.
- sticker: recibido y registrado como `skipped_unsupported`.
- interactive/button/list_reply/button_reply: convertidos a señal textual, sin descarga.
- location: registrada como metadata de ubicación, sin descarga.

## Variables de entorno usadas

- WHATSAPP_TOKEN
- META_ACCESS_TOKEN (fallback)
- GRAPH_API_VERSION
- WHATSAPP_API_VERSION (fallback para versión)
- MEDIA_DOWNLOAD_MAX_BYTES

## Cambios de esquema

- No hubo cambios de esquema de base de datos.
- Se reutilizó persistencia existente en `rawPayload` y eventos de conversación.

## Pruebas ejecutadas

- `npm test`

## Riesgos pendientes

- Falta integración de transcripción real de audio (Sprint 4B).
- Falta interpretación real de imágenes/visión (Sprint 4C).
- Video queda solo registrado en 4A; no hay procesamiento profundo.
- Descargas grandes dependen de límites configurados y disponibilidad de Meta.

## Qué queda para Sprint 4B (audio)

- Transcripción real server-side (ASR) con manejo de idiomas.
- Pipeline de limpieza y confianza de transcripción.
- Integración de transcripción en intención y CRM con auditoría por confianza.

## Qué queda para Sprint 4C (imágenes)

- Interpretación visual real con restricciones de seguridad y precisión.
- Extracción de señales inmobiliarias visuales con disclaimers.
- Política de no conclusiones definitivas sin validación humana.
