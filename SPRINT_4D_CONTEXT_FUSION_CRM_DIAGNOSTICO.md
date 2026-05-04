# Sprint 4D - Fusion de contexto + creacion/actualizacion de solicitud

## 1. Rama utilizada
- sprint-perseo-context-fusion-crm

## 2. Archivos creados/modificados/eliminados
### Creados (4D)
- conversation/contextFusion.js
- test/contextFusion.test.js
- SPRINT_4D_CONTEXT_FUSION_CRM_DIAGNOSTICO.md

### Modificados (4D)
- index.js
- services/leadAutomation.js
- conversation/aiState.js
- test/crmFlowRegression.test.js

### Estado adicional presente en rama por sprints previos (4A/4B/4C)
- config/env.js
- conversation/mediaSignals.js
- services/whatsappMediaService.js
- test/conversationRegression.test.js
- test/mediaSignals.test.js
- test/sprint3Playbooks.test.js
- test/whatsappMediaService.test.js
- conversation/mediaIngestion.js
- services/audioTranscriptionService.js
- services/imageVisionService.js
- test/audioTranscriptionService.test.js
- test/imageVisionService.test.js
- test/mediaIngestion.test.js
- SPRINT_4A_MEDIA_INGESTION_DIAGNOSTICO.md
- SPRINT_4B_AUDIO_TRANSCRIPTION_DIAGNOSTICO.md
- SPRINT_4C_IMAGE_VISION_DIAGNOSTICO.md

### Eliminados (ya presente en rama)
- services/mediaAiAnalyzer.js

## 3. Si hubo cambios de esquema
- No.

## 4. Si hubo cambios de variables de entorno
- No se agregaron variables nuevas en Sprint 4D.

## 5. Como funciona contextFusion
- Se implemento conversation/contextFusion.js con buildUnifiedConversationContext().
- Toma senales multi-origen (texto, caption, transcripcion, vision, ubicacion, interactive, historial, campaign/property context, lead/contacto existentes).
- Construye:
  - sourceSignals
  - effectiveText
  - normalizedIntent
  - propertyDemand
  - propertyOffer
  - missingCriticalFields
  - crmAction
  - advisorRouting
- El resultado se usa en index.js para:
  - enriquecer metadata inbound (rawPayload.perseo_metadata.context_fusion)
  - alimentar ai_state.context_fusion
  - reforzar decision de creacion/actualizacion de lead en el flujo existente
  - sugerir una sola pregunta critica cuando falta contexto.

## 6. Que senales fusiona
- Texto directo.
- Caption de imagen/documento.
- Audio transcrito.
- Resultado de vision de imagen.
- Ubicacion enviada por WhatsApp.
- Interactive/button/list.
- Historial previo (previousAiState).
- Contexto de campana/referral.
- Contexto de propiedad (cuando aplica).
- Entidades existentes (contacto/lead vinculados a la conversacion).

## 7. Reglas para crear lead
- Se permite crear/actualizar cuando contextFusion marca intencion accionable y contexto minimo suficiente.
- Casos cubiertos en reglas/tests:
  - sell_property / rent_out_property con senales de propiedad.
  - buy_property / rent_property con senales minimas de demanda.
  - ask_property_info / visit_property con campaign/property context.
  - valuate_property cuando hay aceptacion de asesor (o contexto comercial claro).
- Se mantiene el motor existente:
  - detectLeadCreationOpportunity
  - buildLeadContextFromConversation
  - createOrReuseLeadFromConversation
- No se creo ruta paralela.

## 8. Reglas para NO crear lead
- Imagen/media sola sin intencion accionable.
- unknown / not_interested.
- Referencia de propiedad no resuelta.
- Ambiguedad comercial sin contexto minimo.
- Se pide 1 pregunta critica cuando falte informacion (request_more_info).

## 9. Como actualiza ai_state
- Se agrega/usa ai_state.context_fusion con:
  - last_intent_category
  - last_intent_confidence
  - lead_type
  - offer_context
  - demand_context
  - last_media_summary
  - last_audio_text
  - last_image_summary
  - last_location
  - missing_critical_fields
  - pending_question
  - crm_action_last_decision
  - source_signals
  - should_create_or_update_lead
  - updated_at
- Tambien se sincroniza nextAiState con intencion fusionada (lead_flow/operation_type/wants_human/asks_property_details cuando corresponde).

## 10. Como evita duplicados
- Sigue reutilizando idempotencia y compatibilidad en createOrReuseLeadFromConversation:
  - reuse por conversation lead_id
  - reuse por lead compatible de contacto
  - reuse por telefono/whatsapp
- Se agregaron regresiones para:
  - no duplicar lead por audio repetido
  - actualizar lead existente con nueva ubicacion sin crear uno nuevo
  - no duplicar contacto/lead en flujo existente.

## 11. Como respeta asignacion de asesor
- Se mantiene prioridad existente:
  - agente de propiedad cuando aplica
  - reglas de asignacion
  - fallback engine
  - respeto de lead/contacto previamente asignado
- Regresion agregada para validar que no se pisen asignaciones existentes.

## 12. Como se conecta con campana/pauta/propiedad
- contextFusion incorpora sourceSignals.hasCampaignContext y hasPropertyContext.
- detectLeadCreationOpportunity ahora puede usar unifiedContext para permitir decision accionable con campaign/property context.
- En index.js se inyecta unifiedContext en maybeCreateOrReuseLeadWithEngine y se conserva campaign_context/whatsapp_referral existentes.

## 13. Pruebas ejecutadas y resultado
- npm test
- npm run test
- npm run lint --if-present
- npm run build --if-present

Resultado final:
- tests: 129
- pass: 129
- fail: 0

## 14. Riesgos pendientes
- La clasificacion de intencion por reglas heuristicas puede requerir ajuste fino con nuevos patrones linguisticos.
- Para campanas sin propiedad ligada explicita, la precision depende de calidad del referral/contexto de entrada.
- Conviene agregar pruebas end-to-end de webhook con fixtures multi-turno para validar fusiones largas de contexto.

## 15. Confirmacion
- No se creo ruta paralela de CRM.
- No se hicieron cambios de esquema.
- No se inventan datos inmobiliarios.
- El proyecto queda preparado para Sprint 4E - QA tecnico y conversacional de media.
