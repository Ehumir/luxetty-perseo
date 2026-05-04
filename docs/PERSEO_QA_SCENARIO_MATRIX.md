# PERSEO QA Scenario Matrix (Sprint 5)

Estado de referencia: validacion de regresion para Sprints 1-4 + cobertura QA Sprint 5.

## Matriz

| ID | Categoria | Mensaje inbound de ejemplo | Tipo inbound | Intencion esperada | Nivel esperado de respuesta | Debe crear contacto | Debe crear lead/solicitud | Debe asignar asesor | Debe considerar campana/referral | Respuesta esperada resumida | Riesgo si falla | Estado de cobertura actual |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Demanda propiedad especifica | Me interesa la LUX-A0453 que vi en landing | text | property_interest demand | consultiva | Si | Si | Si | Si si viene de pauta | Contexto de propiedad + CTA a visita/asesor | Perdida de lead caliente | cubierto por test |
| 2 | Demanda precio propiedad | Precio de la LUX-A0453 | text | price query demand | operativa natural | Si | Si | Si | Opcional | Precio real y siguiente paso comercial | Respuesta robotica/sin cierre | cubierto por test |
| 3 | Demanda credito | Aceptan credito hipotecario? | text | buyer qualification | consultiva | Si | Si | Si | Opcional | Respuesta orientativa + siguiente dato minimo | Friccion y fuga de lead | cubierto parcialmente |
| 4 | Demanda ubicacion | Donde esta ubicada? | text | location request | operativa natural | Si | Si | Si | Opcional | Ubicacion o paso para compartir mapa/asesor | Mala experiencia por vaguedad | cubierto parcialmente |
| 5 | Demanda visita | Quiero agendar visita | text | wants_visit demand | handoff humano | Si | Si | Si | Opcional | Captura contacto/consentimiento y handoff | Oportunidad perdida de conversion | cubierto por test |
| 6 | Cambio de zona | Mejor busco en San Jeronimo | text | search refinement | consultiva | Si | Si | Si | Opcional | Actualizar filtros sin reiniciar contexto | Recomendaciones irrelevantes | pendiente |
| 7 | Cambio presupuesto | Mejor hasta 3.2 millones | text | budget refinement | consultiva | Si | Si | Si | Opcional | Ajustar busqueda y confirmar rango | Inventario incorrecto | pendiente |
| 8 | Alto interes | Me interesa | text | commercial interest | consultiva | Si | Si | Si | Opcional | Pregunta minima + propuesta asesor | Respuesta fria/generica | cubierto parcialmente |
| 9 | Solicita contacto | Quiero que me contacten | text | explicit human handoff | handoff humano | Si | Si | Si | Opcional | Consentimiento de contacto + asignacion | Cliente molesto por no seguimiento | cubierto parcialmente |
| 10 | Rechaza asesor temporalmente | Aun no quiero asesor | text | continue self-service | consultiva | Si | No aun | No aun | Opcional | Mantener guia sin presionar | Percepcion agresiva | pendiente |
| 11 | Similares | Tienes casas similares? | text | similar inventory search | consultiva | Si | Si | Si | Opcional | Buscar similares y proponer asesor | Inventar inventario | cubierto parcialmente |
| 12 | Busca renta | Busco renta en Cumbres | text | demand rent | consultiva | Si | Si | Si | Opcional | Flujo demanda renta | Enrutamiento incorrecto | cubierto parcialmente |
| 13 | Busca compra | Busco comprar casa | text | demand sale | consultiva | Si | Si | Si | Opcional | Flujo compra + siguiente dato minimo | Conversacion estancada | cubierto parcialmente |
| 14 | Quiere vender | Quiero vender mi casa | text | offer supply | consultiva | Si | Si | Si | Opcional | Calificacion vendedor + CTA asesor | Perdida de captacion | cubierto por test |
| 15 | Quiere valuacion | Quiero valuacion | text | valuation supply | consultiva | Si | Si | Si | Opcional | No tratar como comprador; orientar comparables | Mala clasificacion comercial | cubierto por test |
| 16 | Valuacion por zona | Cuanto vale mi casa en Cumbres | text | valuation supply zone-specific | consultiva | Si | Si | Si | Opcional | Solicitar datos minimos + propuesta visita | Falsa precision de precio | cubierto parcialmente |
| 17 | Imagen + pregunta venta | (imagen) se puede vender? | image | offer with media context | consultiva | Si | Si | Si | Opcional | Revision preliminar + datos minimos | Mentir sobre media | cubierto parcialmente |
| 18 | Imagen sin texto | (imagen sin caption) | image | unknown media intent | fallback transparente | Si | No aun | No aun | No | Reconocer imagen y pedir contexto | Respuesta confusa | cubierto por test |
| 19 | Imagen con caption | (imagen) Quiero vender esta casa | image | offer intent from caption | consultiva | Si | Si | Si | Opcional | Detectar intencion desde caption | Perder señal comercial | cubierto por test |
| 20 | Audio | (audio) | audio | possible commercial intent pending text | fallback transparente | Si | No aun | No aun | No | Transparencia por falta transcripcion | Mentir sobre audio | cubierto por test |
| 21 | Voice note | (voice) | voice | possible commercial intent pending text | fallback transparente | Si | No aun | No aun | No | Pedir resumen en texto o asesor | Mala experiencia por opacidad | cubierto por test |
| 22 | Documento | (documento escritura.pdf) | document | legal/document support | fallback transparente | Si | Segun contexto | Segun contexto | No | No afirmar lectura legal; ofrecer revision | Riesgo legal/comercial | cubierto por test |
| 23 | Video | (video) | video | possible media context | fallback transparente | Si | Segun contexto | Segun contexto | No | Transparencia y solicitud de contexto textual | Mentir sobre video | cubierto parcialmente |
| 24 | Sticker | (sticker) | sticker | no clear intent | fallback transparente | Si | No | No | No | Solicitar texto de necesidad | Conversacion sin avance | cubierto por test |
| 25 | Contacto enviado | (contacts payload) | contact | contact share | operativa natural | Si/actualizar | Segun contexto | Segun contexto | No | Agradecer contacto y pedir objetivo | Friccion de seguimiento | cubierto por test |
| 26 | Interactive button | Boton: Quiero visita | interactive/button | explicit commercial action | consultiva | Si | Si | Si | Opcional | Convertir opcion a texto util y avanzar | Se ignora señal fuerte | cubierto por test |
| 27 | Interactive list | Lista: Ver rentas | interactive | demand rent browse | consultiva | Si | Si | Si | Opcional | Ajustar flujo a opcion elegida | Respuesta desconectada | cubierto por test |
| 28 | Llega por pauta/referral | Hola vi su anuncio en Facebook | referral/text | campaign-origin demand | consultiva | Si | Si | Si | Si | Conservar contexto de campana | Perder atribucion/cierre | cubierto por test |
| 29 | Ambiguo info | info | text | low-info | operativa natural | Si | No aun | No | Si si hay referral | Pregunta corta de clarificacion | Loop improductivo | cubierto parcialmente |
| 30 | Ambiguo precio | precio | text | ask price depends context | consultiva | Si | Segun contexto | Segun contexto | Opcional | Si hay propiedad: responder precio; si no: pedir referencia | Respuesta vacia o inventada | cubierto por test |
| 31 | Usuario molesto | Ya me cansaron, no contestan | text | complaint_followup | handoff humano | Si | Si si hay contexto comercial | Si | Opcional | Empatia + priorizar humano | Escalada negativa | cubierto parcialmente |
| 32 | Pide humano | Quiero hablar con humano | text | wants_human | handoff humano | Si | Si | Si | Opcional | Confirmar canal de contacto y asignar | Churn inmediato | cubierto parcialmente |
| 33 | Pregunta comision | Cuanto cobran de comision? | text | objection/offer consultative | consultiva | Si | Si | Si | Opcional | Respuesta por valor + siguiente paso | Objecion mal manejada | cubierto por test |
| 34 | Requisitos vender | Que piden para vender? | text | offer qualification | consultiva | Si | Si | Si | Opcional | Checklist minimo + asesoria | Abandono por incertidumbre | cubierto parcialmente |
| 35 | Tiempo de venta | Cuanto tarda en venderse? | text | offer expectation mgmt | consultiva | Si | Si | Si | Opcional | Rangos realistas + factores | Promesas irreales | cubierto parcialmente |
| 36 | Zona sin inventario | Busco en zona no cubierta | text | demand out-of-coverage | consultiva | Si | Si | Si | Opcional | Transparencia + alternativas/asesor | Inventar disponibilidad | cubierto parcialmente |
| 37 | Propiedad no existe | Me interesa LUX-Z9999 | text | direct reference not found | consultiva | Si | No hasta validar | No hasta validar | Opcional | No encontrada + ofrecer similares | Inventar propiedad | cubierto por test |
| 38 | Fuera del giro | Necesito plomeria | text | non_real_estate_or_provider | operativa natural | Si | No | No | No | Redirigir canal de forma cordial | Mala reputacion | cubierto parcialmente |
| 39 | Media no descargable | (media id invalido) | image/audio/video/document | media failure | fallback transparente | Si | Segun contexto | Segun contexto | No | No mentir + pedir reenvio/descripcion | Perdida de confianza | cubierto por test |
| 40 | Falla WhatsApp media API | Error 5xx metadata/download | image/audio/video/document | technical fallback | fallback transparente | Si | Segun contexto | Segun contexto | No | Reconocer problema temporal + alternativa | Caida silenciosa del flujo | cubierto parcialmente |
| 41 | Falla OpenAI vision | timeout/error vision | image | image analysis degraded | fallback transparente | Si | Segun contexto | Segun contexto | No | No conclusiones visuales definitivas | Alucinacion visual | cubierto parcialmente |
| 42 | Falla Supabase contacto | error en contactos insert/update | text | CRM failure handling | fallback transparente | Intentado | No confirmar exito | No confirmar exito | Opcional | No afirmar creacion; loggear error | Inconsistencia CRM | pendiente |
| 43 | Falla Supabase lead | error en leads insert | text | CRM failure handling | fallback transparente | Si | Intentado sin afirmar exito | No | Opcional | No afirmar solicitud creada | Falsa promesa comercial | cubierto por test |
| 44 | Falla asignacion | error assignment rpc/update | text | assignment degraded | fallback transparente/handoff | Si | Si | Intentado sin exito | Opcional | No afirmar asesor asignado si fallo | Caso sin seguimiento | cubierto por test |
| 45 | Lead/contact ya existe | mensaje comercial con registros previos | text | idempotent reuse | operativa natural | Reusar | Reusar | Reusar/confirmar | Opcional | Evitar duplicados y continuar | Datos duplicados | cubierto por test |
| 46 | Contacto existe sin lead | nuevo interes comercial | text | create lead from existing contact | consultiva | Reusar | Si | Si | Opcional | Crear lead y continuar | Fuga de oportunidad | cubierto por test |
| 47 | Lead ya existe en conversacion | follow-up misma propiedad | text | idempotent conversation lead | operativa natural | Reusar | Reusar | Reusar | Opcional | No duplicar lead | Ruido en pipeline | cubierto por test |
| 48 | IA pausada por asesor | estado conversacion pausada | text | human takeover respected | handoff humano | N/A | N/A | N/A | Opcional | IA no debe intervenir | Colision humano-IA | pendiente |
| 49 | Conversacion modo humano | canal en human mode | text | human mode respected | handoff humano | N/A | N/A | N/A | Opcional | IA no responder automaticamente | Mala experiencia operativa | pendiente |
| 50 | Legacy sin ai_state | mensaje en conversacion antigua | text | graceful default state | operativa natural | Si | Segun contexto | Segun contexto | Opcional | Inicializar estado seguro y continuar | Caida por null state | pendiente |

## Notas

- La cobertura marcada como "cubierto por test" incluye pruebas existentes de Sprints 1-4 y nuevas pruebas Sprint 5.
- "Cubierto parcialmente" significa que hay pruebas de componentes (intent/parser/reply/automation) pero no E2E webhook completo.
- "Pendiente" se recomienda para Sprint 6 con pruebas de integracion del webhook y mocks de Supabase/WhatsApp por flujo completo.
