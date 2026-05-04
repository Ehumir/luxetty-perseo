# PERSEO QA Coverage Report (Sprint 5)

## 1) Resumen ejecutivo

Sprint 5 incorpora una capa formal de QA conversacional y regresion CRM para PERSEO, enfocada en:

- deteccion de intencion comercial,
- tono consultivo y no robotico,
- transparencia en media,
- robustez de flujo CRM (contacto + lead/solicitud + asignacion),
- conservacion de contexto referral/campana,
- compatibilidad con Sprints 1-4.

Se agregaron suites de pruebas y fixtures de WhatsApp para ampliar cobertura de escenarios criticos sin cambiar esquema de Supabase ni variables de entorno reales.

## 2) Escenarios ya cubiertos por tests

Cobiertos por pruebas nuevas de Sprint 5 y/o pruebas existentes:

- Interes comercial sobre propiedad especifica y conduccion a visita/asesor.
- "Precio" con contexto de propiedad y siguiente paso comercial.
- Flujo vendedor: "quiero vender mi casa" con tono consultivo.
- Flujo valuacion: "quiero una valuacion" sin tratarlo como comprador.
- Conservacion de contexto referral/campana en parsing de automatizacion.
- Imagen con analisis preliminar exitoso: lenguaje transparente de revision automatica preliminar.
- Imagen con falla de descarga: fallback transparente sin mentir.
- Audio/voice sin transcripcion: no finge escucha, pide texto o alternativa.
- Documento sin OCR real: no afirma lectura definitiva.
- Interactive/button/contacts: transformacion a texto util.
- Idempotencia de lead para conversacion/contacto/propiedad.
- Falla de creacion de lead: no simula exito.
- Falla de asignacion: no marca asignacion exitosa y deja rastro de evento.

## 3) Escenarios cubiertos por logica pero no totalmente por tests

- Ajustes dinamicos por cambio de zona/presupuesto dentro del flujo completo webhook.
- Rutas de media WhatsApp API 5xx y degradacion por timeout intermitente en entorno real.
- Ruta de vision OpenAI degradada en ejecucion real webhook end-to-end.
- Handoff por queja/agresividad con variaciones de tono en mensajes largos.
- Reglas de no inventar disponibilidad/precio en combinaciones menos frecuentes.

## 4) Escenarios pendientes

Pendientes recomendados para Sprint 6 (pruebas de integracion/end-to-end):

- Conversacion en modo humano/IA pausada para validar no intervencion.
- Conversaciones legacy sin ai_state con webhook completo.
- Falla de creacion/actualizacion de contacto en Supabase desde flujo webhook real.
- Validaciones de regresion sobre estado de followups y pausas por agente humano.
- Matriz completa de 50 escenarios en ejecucion automatizada por lotes.

## 5) Riesgos criticos antes de produccion

- Falta de pruebas E2E del webhook para algunos escenarios de error operativo (media API / OpenAI / contacto).
- Riesgo de drift conversacional en textos exactos por cambios futuros de copy sin ajustar tests.
- Modo humano/pausa IA aun requiere test dedicado para blindar no-intervencion automatica.

## 6) Recomendaciones para Sprint 6

1. Añadir una suite de integracion del webhook con mocks de Supabase + WhatsApp Graph + OpenAI para cubrir rutas de error extremo.
2. Incluir tests de contrato de eventos (`conversation_events`) por escenario para auditoria CRM.
3. Implementar un smoke pack de "escenarios comerciales criticos" ejecutable en CI previo a release.
4. Agregar prueba explicita de "conversation en modo humano" para bloqueo de respuesta IA.
5. Definir umbrales de calidad conversacional (longitud, preguntas maximas, prohibiciones de frases roboticas) como assertions reutilizables.

## 7) Confirmaciones de control

- No hubo cambios de esquema Supabase.
- No se hicieron commits en este Sprint 5.
- Tests ejecutados: `npm test`.
- Resultado final de tests: registrado en ejecucion local del sprint (se reporta en el resumen final de entrega).
