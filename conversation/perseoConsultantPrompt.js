const { normalizeText, cleanSpaces } = require('../utils/text');

const ACCEPTED_ZONE_HINT =
  'Monterrey, Zona Cumbres, García, San Pedro Garza García, Carretera Nacional y zonas residenciales de alto valor en Guadalupe, San Nicolás, Apodaca y Santa Catarina';

const ACCEPTED_ZONES = [
  'monterrey',
  'cumbres',
  'zona cumbres',
  'garcia',
  'garcía',
  'san pedro',
  'san pedro garza garcia',
  'san pedro garza garcía',
  'carretera nacional',
  'santa catarina',
  'guadalupe',
  'san nicolas',
  'san nicolás',
  'apodaca',
];

const MIN_SALE_VALUE_MXN = 3000000;
const MIN_RENT_VALUE_MXN = 10000;

const PERSEO_CONSULTANT_SYSTEM_PROMPT = `
Eres PERSEO, asesor inmobiliario IA experto en captación de propiedades y calificación de leads para Luxetty.

ROL Y FUNCIÓN (RECTOR):
- Tu función es filtrar, calificar, generar interés y convertir leads en citas con asesores humanos especialistas de Luxetty.
- Actúas como consultor estratégico: orientas a propietarios (vender o poner en renta) y a buscadores (comprar o rentar).
- Siempre debes filtrar, calificar, generar interés y llevar a cita; no eres un formulario ni un cuestionario.

INICIO NATURAL OBLIGATORIO (cuando aplique como primera interacción o reinicio cordial):
"Hola, soy el asistente de Luxetty 😊
Con gusto te ayudo.
Para ubicarte mejor, ¿estás buscando comprar, rentar, vender o poner en renta una propiedad?"

TONO Y ESTILO:
- Comunicación profesional, natural, consultiva, estratégica, conversacional, clara, directa y amable.
- Máximo 1–2 preguntas por mensaje.
- Evita sonar robótico o interrogatorio.
- Usa microvalidaciones breves: "Perfecto", "Claro", "Entiendo".
- Mantén el control de la conversación sin apresurar ni atropellar.

REGLAS COMERCIALES DURAS:
- Solo atiendes cobertura en: ${ACCEPTED_ZONE_HINT}.
- Si la ubicación queda fuera de zona, responde con cordialidad, explica el enfoque geográfico de Luxetty y cierra la conversación sin forzar seguimiento.
- Propietarios: descarta venta menor a $3,000,000 MXN y renta menor a $10,000 MXN.
- Buscadores: descarta compra menor a $3,000,000 MXN y renta menor a $10,000 MXN.
- Respuesta para descartados por monto o enfoque (ajústala al caso, sin ser fría):
  "Por el momento estamos enfocados en propiedades de mayor valor en ciertas zonas, pero con gusto puedo orientarte brevemente si lo necesitas."
- Solo enlaces y referencias a https://luxetty.com.
- Nunca inventar propiedades, disponibilidad, datos legales ni precios no confirmados.
- Nunca recomendar propiedades de otras inmobiliarias ni sitios externos.
- Refuerza que Luxetty trabaja con propiedades previamente filtradas del portafolio (sin inventar listados).

ESTRUCTURA OBLIGATORIA DE CONVERSACIÓN:
- Si no tienes nombre del prospecto: "¿Me compartes tu nombre?"
- Identifica intención: comprar, rentar, vender o poner en renta.
- Filtro rápido obligatorio en este orden:
  1) Zona
  2) Precio / presupuesto
- Si es propietario (oferta), pregunta:
  "¿La propiedad es tuya o estás apoyando a alguien?"
- Oferta: tipo, ubicación, características, estado, aspectos legales relevantes (sin inventar).
- Demanda: tipo, zona, características y si ya trabaja con algún asesor.
- Nunca validar precio como definitivo. Usa:
  "Para darte un valor real, hacemos un análisis comparativo de mercado y así te damos una referencia mucho más precisa."
- Siempre indaga motivo y tiempo/urgencia.
- Si hay urgencia alta, puedes usar:
  "Podemos mover esto rápido."
  "Vale la pena revisarlo lo antes posible."
- Antes del cierre hacia cita, usa microcompromiso:
  "Si quieres, puedo darte una recomendación mucho más precisa basada en tu caso."

CIERRE OBLIGATORIO — OFERTA (vender / poner en renta), cuando los datos lo permitan:
- "Por la zona y el tipo de propiedad que me comentas, sí vale la pena revisarla bien para posicionarla correctamente en el mercado."
- "Te damos un análisis real de mercado y una estrategia para evitar que se quede estancada."
- "Podemos agendar una visita rápida (20 min)."
- "¿Te queda mejor entre semana o fin de semana?"

CIERRE OBLIGATORIO — DEMANDA (comprar / rentar), cuando los datos lo permitan:
- "Por lo que buscas, podemos proponerte opciones muy alineadas dentro de nuestro portafolio."
- "Trabajamos con propiedades previamente filtradas para ahorrarte tiempo."
- "Podemos agendar una llamada breve (20 min)."
- "¿Qué te queda mejor, entre semana o fin de semana?"

TRAS ACEPTAR AGENDAR:
"Perfecto 👍
¿Este es el mejor número para contactarte o prefieres llamada?"

SI DUDA:
"Sin problema, si prefieres puedo prepararte un análisis inicial y con eso decides con más claridad."

RESPUESTAS CORTAS O AMBIGUAS:
- Valida con empatía y avanza con una sola pregunta clara.

NUNCA ENVIAR RESUMEN AL PROSPECTO:
- Nunca enviar resumen al prospecto (ni recapitulación larga tipo informe).

CONTEXTO DE PROPIEDAD / CÓDIGO LUX:
- Si ya hay propiedad o código en contexto, prioriza esa propiedad y no reinicies como si no hubiera contexto.
- No repitas preguntas que el usuario ya contestó en el historial reciente.

COMISIÓN (texto exacto si preguntan por comisión, porcentaje o cuánto cobran):
"Normalmente manejamos entre 3.5% y 5%, dependiendo del tipo de propiedad y la estrategia de comercialización.

Más que el porcentaje, lo importante es que incluye el servicio y cómo se va a implementar."
Después pregunta por exclusividad.
`.trim();

function hasCommissionQuestion(text) {
  const t = normalizeText(text || '');
  if (!t) return false;
  return (
    t.includes('comision') ||
    t.includes('comisión') ||
    t.includes('porcentaje') ||
    t.includes('cuanto cobran') ||
    t.includes('cuánto cobran')
  );
}

function isAcceptedZone(locationText) {
  const t = normalizeText(locationText || '');
  if (!t) return null;
  return ACCEPTED_ZONES.some((zone) => t.includes(normalizeText(zone)));
}

function formatRecentMessages(recentMessages = []) {
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    return 'Sin historial reciente.';
  }

  return recentMessages
    .slice(-8)
    .map((msg) => {
      const role = msg?.role || 'user';
      const content = cleanSpaces(msg?.content || '');
      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

function buildPerseoConsultantContext(aiState = {}, recentMessages = [], externalContext = {}) {
  const state = aiState && typeof aiState === 'object' ? aiState : {};
  const locationText = cleanSpaces(state.location_text || '');
  const leadFlow = state.lead_flow || null;
  const operationType = state.operation_type || null;
  const budgetMax = Number(state.budget_max || 0) || null;

  const zoneAccepted = isAcceptedZone(locationText);
  const isRentFlow = operationType === 'rent';
  const minRequired = isRentFlow ? MIN_RENT_VALUE_MXN : MIN_SALE_VALUE_MXN;
  const belowMinimum = budgetMax != null && budgetMax > 0 && budgetMax < minRequired;

  const latestUserText = cleanSpaces(
    externalContext.userMessage ||
      recentMessages
        .slice()
        .reverse()
        .find((m) => m?.role === 'user')?.content ||
      ''
  );

  const commissionQuestion = hasCommissionQuestion(latestUserText);

  const offerMissing = [
    !locationText && 'zona',
    budgetMax == null && 'precio',
    !state.owner_relation && 'confirmar si la propiedad es suya o si está apoyando a alguien',
    !state.property_type && 'tipo de propiedad',
    (!state.must_have_features || state.must_have_features.length === 0) && 'caracteristicas',
    !state.urgency_level && 'urgencia',
    !state.works_with_realtor && 'si trabaja con inmobiliaria',
    !state.has_exclusivity && 'exclusividad',
    !state.availability_for_visit && 'disponibilidad para visita',
  ].filter(Boolean);

  const ownerCaptureSnapshot = [
    state.terrain_m2 != null ? `terreno_m2=${state.terrain_m2}` : null,
    state.construction_m2 != null ? `construccion_m2=${state.construction_m2}` : null,
    state.floors_count != null ? `plantas=${state.floors_count}` : null,
    state.bedrooms != null ? `recamaras=${state.bedrooms}` : null,
    state.bathrooms != null ? `banos=${state.bathrooms}` : null,
    state.occupancy_status ? `ocupacion=${state.occupancy_status}` : null,
    state.legal_deeded != null ? `escriturada=${state.legal_deeded ? 'si' : 'no'}` : null,
    state.has_mortgage != null ? `credito_hipotecario=${state.has_mortgage ? 'si' : 'no'}` : null,
    state.works_with_realtor != null ? `trabaja_con_inmobiliaria=${state.works_with_realtor ? 'si' : 'no'}` : null,
    state.exclusivity_type ? `exclusividad=${state.exclusivity_type}` : null,
    state.expected_price != null ? `precio_esperado=${state.expected_price}` : null,
  ].filter(Boolean);

  const demandMissing = [
    !locationText && 'zona',
    budgetMax == null && 'presupuesto',
    !state.property_type && 'tipo de propiedad',
    (!state.must_have_features || state.must_have_features.length === 0) && 'caracteristicas principales',
    !state.contact_preference && 'disponibilidad para llamada o visita',
  ].filter(Boolean);

  const guidance = [];

  if (leadFlow === 'offer' || leadFlow === 'demand') {
    guidance.push(
      'Orden obligatorio de filtro: primero Zona, luego Precio o presupuesto; no repitas preguntas ya contestadas en el historial; en oferta confirma si la propiedad es suya o si está apoyando a alguien; antes del cierre usa microcompromiso y cierra en visita o llamada breve (20 min).'
    );
  }

  if (!leadFlow) {
    guidance.push('Primero identifica si el prospecto quiere ofertar (vender/rentar su propiedad) o demandar (comprar/rentar).');
  }

  if (state.direct_property_reference || state.property_code || state.campaign_context?.property_code) {
    guidance.push(
      'Contexto de propiedad o pauta activo: prioriza responder sobre esa propiedad y evita respuestas genericas de bienvenida.',
    );
  }

  if (zoneAccepted === false) {
    guidance.push(
      `La zona parece fuera de cobertura. Explica con tacto el enfoque geografico de Luxetty y confirma si tiene opcion en estas zonas: ${ACCEPTED_ZONE_HINT}.`
    );
  }

  if (belowMinimum) {
    guidance.push(
      `El monto esta por debajo del minimo (${isRentFlow ? '$10,000 MXN renta' : '$3,000,000 MXN compra/venta'}). Explicalo con respeto y ofrece ajustar criterios o canalizar orientacion.`
    );
  }

  if (commissionQuestion) {
    guidance.push('Detectaste pregunta de comision: responde con el texto exacto de politicas y luego pregunta por exclusividad.');
  }

  if (state.asks_only_valuation) {
    guidance.push('Detectaste objecion de solo valuacion: explica comparables, cierres reales, competencia y absorcion antes de dar orientacion inicial.');
  }

  if (state.objection_higher_other_agency) {
    guidance.push('Detectaste comparacion con otra inmobiliaria: explica diferencia entre oferta publicada vs cierres reales y riesgo de sobreprecio.');
  }

  if (leadFlow === 'offer' && offerMissing.length > 0) {
    guidance.push(`Oferta en calificacion. Prioriza confirmar estos datos con maximo 1-2 preguntas: ${offerMissing.join(', ')}.`);
  }

  if (leadFlow === 'demand' && demandMissing.length > 0) {
    guidance.push(`Demanda en calificacion. Prioriza confirmar estos datos con maximo 1-2 preguntas: ${demandMissing.join(', ')}.`);
  }

  if (
    (leadFlow === 'offer' && offerMissing.length > 0 && offerMissing.length <= 3) ||
    (leadFlow === 'demand' && demandMissing.length > 0 && demandMissing.length <= 3)
  ) {
    guidance.push('Antes del cierre incluye microcompromiso consultivo y luego propón cita o llamada de 20 min con preferencia entre semana o fin de semana.');
  }

  if (
    (leadFlow === 'offer' && offerMissing.length <= 2 && offerMissing.length > 0) ||
    (leadFlow === 'demand' && demandMissing.length <= 2 && demandMissing.length > 0)
  ) {
    guidance.push('Si ya casi completas datos, orienta a cierre consultivo con propuesta de llamada o visita de 20 minutos.');
  }

  if (
    (leadFlow === 'offer' && offerMissing.length === 0) ||
    (leadFlow === 'demand' && demandMissing.length === 0)
  ) {
    guidance.push(
      'Ya hay informacion suficiente para cierre: propone llamada o visita de 20 minutos y pregunta si le queda entre semana o fin de semana.'
    );
  }

  const locationCatalog = Array.isArray(externalContext.locationCatalog)
    ? externalContext.locationCatalog.join(', ')
    : '';

  return [
    'CONTEXTO_CONSULTIVO_PERSEO:',
    `lead_flow=${leadFlow || 'unknown'}`,
    `operation_type=${operationType || 'unknown'}`,
    `location_text=${locationText || 'unknown'}`,
    `zone_accepted=${zoneAccepted === null ? 'unknown' : zoneAccepted ? 'yes' : 'no'}`,
    `budget_max=${budgetMax == null ? 'unknown' : budgetMax}`,
    `minimum_required_mxn=${minRequired}`,
    `below_minimum=${belowMinimum ? 'yes' : 'no'}`,
    `change_type=${externalContext.changeType || 'unknown'}`,
    `matched_properties_count=${externalContext.matchedPropertiesCount ?? 0}`,
    ownerCaptureSnapshot.length ? `owner_capture_snapshot=${ownerCaptureSnapshot.join(', ')}` : null,
    locationCatalog ? `location_catalog=${locationCatalog}` : null,
    guidance.length ? `guidance=${guidance.join(' ')}` : 'guidance=Mantener avance consultivo y comercial sin sonar a formulario.',
    'historial_reciente:',
    formatRecentMessages(recentMessages),
    latestUserText ? `ultimo_mensaje_usuario=${latestUserText}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  PERSEO_CONSULTANT_SYSTEM_PROMPT,
  buildPerseoConsultantContext,
};
