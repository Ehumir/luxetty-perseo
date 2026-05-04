# SPRINT_4E_MEDIA_QA_REGRESSION_DIAGNOSTICO

## 1. Rama utilizada
- `sprint-perseo-media-qa-regression`

## 2. Archivos creados/modificados/eliminados
- Creados:
  - `test/mediaConversationE2E.test.js`
  - `test/fixtures/whatsapp/text-message.json`
  - `test/fixtures/whatsapp/image-message.json`
  - `test/fixtures/whatsapp/image-message-with-caption.json`
  - `test/fixtures/whatsapp/audio-message.json`
  - `test/fixtures/whatsapp/voice-message.json`
  - `test/fixtures/whatsapp/document-message.json`
  - `test/fixtures/whatsapp/location-message.json`
  - `test/fixtures/whatsapp/interactive-button-message.json`
  - `test/fixtures/whatsapp/interactive-list-message.json`
  - `test/fixtures/whatsapp/referral-property-message.json`
  - `test/fixtures/whatsapp/unsupported-sticker-message.json`
- Modificados:
  - `index.js`
  - `conversation/mediaSignals.js`
  - `conversation/contextFusion.js`
  - `services/leadAutomation.js`
  - `test/mediaSignals.test.js`
- Eliminados en working tree:
  - `services/mediaAiAnalyzer.js` (cambio preexistente en árbol local; no restaurado en este sprint)

## 3. Cambios de esquema: Sí/No
- No.

## 4. Cambios de variables de entorno: Sí/No
- No.

## 5. Resumen de auditoría técnica
- Se validó integración 4A/4B/4C/4D sin ruta CRM paralela.
- Se confirmó que la creación/reutilización sigue centralizada en `createOrReuseLeadFromConversation`.
- Se añadió QA multi-turno de media/contexto/CRM con 15 escenarios.
- Se endurecieron reglas de decisión para:
  - aceptación de asesor con contexto previo (talk_to_advisor),
  - valuación (solo con aceptación explícita),
  - parseo de monto en lenguaje natural (`seis millones`).
- Se corrigió regresión conversacional de fallback repetido en audios fallidos consecutivos.

## 6. Resultado de búsqueda de imports/rutas riesgosas
- `mediaAiAnalyzer`: sin referencias de ejecución (solo documentación histórica).
- `audioTranscription`: referencias consistentes con 4B.
- `image_vision`: referencias consistentes con 4C.
- `context_fusion`: referencias consistentes con 4D.
- `createOrReuseLeadFromConversation` / `detectLeadCreationOpportunity`: usados como puntos centrales de CRM.
- `OPENAI_API_KEY` / `WHATSAPP_TOKEN`: sin hardcode en lógica runtime; referencias en config/env y `.env` local no versionado.
- `graph.facebook.com`: referencias esperadas en integración WhatsApp (`index.js`, `services/whatsappMediaService.js`).

## 7. Matriz de escenarios probados
| escenario | entrada | esperado | resultado | pass/fail |
|---|---|---|---|---|
| 1 imagen sola | imagen fachada sin caption | consultivo, no lead | no lead, respuesta consultiva | PASS |
| 2 imagen+caption venta | "Quiero vender..." | fusiona y crea/actualiza | crea lead supply | PASS |
| 3 audio venta | "vender en Cumbres... seis millones" | transcribe, extrae, crea | crea/actualiza + extrae | PASS |
| 4 audio renta demanda | "busco casa en renta..." | detecta demanda renta, crea | crea demand | PASS |
| 5 texto+imagen+ubicación | secuencia 3 turnos | no reinicia, no duplica | 1 lead reutilizado | PASS |
| 6 audio+imagen+acepta asesor | secuencia + aceptación | conserva contexto, avanza CRM | crea/reutiliza lead y avanza | PASS |
| 7 referral+"me interesa" | payload campaña/propiedad | usa contexto campaña | crea con contexto específico | PASS |
| 8 imagen borrosa | visión no concluyente | no inventa, no lead solo | no lead | PASS |
| 9 audio fallido | transcripción falla | transparente, sin romper | no lead sin contexto + fallback honesto | PASS |
| 10 documento PDF | doc inbound | no finge lectura | metadata + respuesta honesta | PASS |
| 11 interactive button | "Quiero vender" | señal textual + flujo CRM | detecta venta y pide dato crítico | PASS |
| 12 no interesado | "No gracias..." | no crear lead | no crea lead nuevo | PASS |
| 13 valuación | "¿en cuánto se vende?" | sin precio automático | no auto-valuación; crea solo con aceptación | PASS |
| 14 3 audios secuenciales | vender + zona + precio | fusión progresiva sin duplicar | 1 lead + contexto acumulado | PASS |
| 15 texto normal previo | "busco casa en venta..." | no romper flujo histórico | flujo normal intacto | PASS |

## 8. Matriz de media
| tipo | validación | pass/fail |
|---|---|---|
| text | flujo base intacto | PASS |
| image | ingesta + respuesta consultiva | PASS |
| image+caption | intención + fusión | PASS |
| audio | transcripción y uso contextual | PASS |
| voice | cobertura de payload | PASS |
| document | metadata + honestidad | PASS |
| location | persistencia en contexto | PASS |
| interactive | button/list como señal textual | PASS |
| referral/campaign | preserva contexto comercial | PASS |
| unsupported | fallback sin romper flujo | PASS |

## 9. Matriz CRM
| validación | resultado | pass/fail |
|---|---|---|
| crea contacto | cubierto por flujo existente/mocks | PASS |
| reutiliza contacto | cubierto por flujo existente/mocks | PASS |
| crea lead | cuando hay intención+mínimos | PASS |
| actualiza lead | en secuencias multi-turno | PASS |
| no duplica | contacto/lead no se duplican en secuencias | PASS |
| asigna asesor | se respeta flujo existente cuando aplica | PASS |
| respeta asesor existente | compatibilidad preservada en motor actual | PASS |

## 10. Matriz conversacional
| criterio | resultado | pass/fail |
|---|---|---|
| consultivo | respuestas transparentes y guiadas | PASS |
| no bot | copy más natural en media fallida repetida | PASS |
| no inventa | sin OCR/valuación inventada | PASS |
| pide dato crítico | request_more_info cuando falta referencia | PASS |
| microcompromiso | oferta a asesor cuando contexto lo permite | PASS |

## 11. Pruebas ejecutadas y resultado
- `npm test` => 146 pass, 0 fail.
- `npm run test` => 146 pass, 0 fail.
- `npm run lint --if-present` => exit 0.
- `npm run build --if-present` => exit 0.

## 12. Bugs encontrados y corregidos
- Repetición idéntica de fallback en audios sin transcripción consecutivos.
- `talk_to_advisor` con contexto previo no disparaba creación/reutilización cuando debía.
- Valuación se podía crear por `wants_human` implícito; se endureció a aceptación explícita.
- Parseo de precio no capturaba formato textual como "seis millones".

## 13. Bugs encontrados y NO corregidos
- Ninguno bloqueante dentro del alcance 4E.

## 14. Riesgos pendientes para producción
- Heurísticas de NLP siguen siendo sensibles a redacción no estándar.
- Visión y audio dependen de disponibilidad externa (Meta/OpenAI) y calidad del input.
- `.env` local contiene secretos reales; operativo pero requiere higiene estricta fuera de este sprint.

## 15. Recomendaciones antes de merge
- Ejecutar smoke end-to-end con payload real de sandbox WhatsApp antes de PR.
- Validar telemetría de errores de transcripción/visión en staging.
- Revisar mascarado de logs si se amplía trazabilidad de media.

## 16. Confirmación
- No hubo cambios de esquema.
- No se creó ruta paralela CRM.
- No se hardcodearon tokens.
- No se implementó valuación automática.
- No se implementó OCR avanzado.
- No se implementó video analysis.
- El proyecto queda listo para subir rama a GitHub y abrir PR si todas las pruebas pasan.
